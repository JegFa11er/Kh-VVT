/**
 * PF2E REMASTERED — AFFLICTION STAGE ENGINE (HEADLESS CORE)
 *
 * Owns the reusable machinery for poisons, diseases, and other afflictions.
 * This slice deliberately implements only the stage engine and the
 * end-of-turn saving throw; no concrete poison or disease data is authored.
 *
 * Affliction record:
 *   {
 *     type: "affliction",
 *     id: string,
 *     name: string,
 *     saveType: "fortitude" | "reflex" | "will",
 *     saveDC: integer,
 *     maxStage: positive integer,
 *     stage: integer from 1 to maxStage,
 *     sourceId: string | null
 *   }
 *
 * End-of-turn save (Remastered degree of success):
 *   - critical success: stage -2;
 *   - success:          stage -1;
 *   - failure:          stage +1;
 *   - critical failure: stage +2.
 * A stage at or below 0 cures the affliction and removes it. The stage is
 * capped at `maxStage`, so a critical failure cannot exceed the authored
 * maximum.
 *
 * Saving throws use the same modifier pipeline as every other check:
 * `10 + ...` DCs are not involved here (the affliction supplies its DC), but
 * the d20 + save modifier is still resolved through Checks.evaluateCheck so
 * natural 20/1 degree shifts and ±10 thresholds are canonical.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./checks.js"),
      require("./modifiers.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Rules = root.PF2e.Core.Rules || {};
    root.PF2e.Core.Rules.Afflictions = factory(
      root.PF2e.Core.Rules.Checks,
      root.PF2e.Core.Rules.Modifiers,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Checks,
  Modifiers,
) {
  "use strict";

  const SAVE_TYPES = Object.freeze(["fortitude", "reflex", "will"]);
  const DEFAULT_MAX_STAGE = 3;

  /** Stage change per degree of success. */
  const STAGE_DELTAS = Object.freeze({
    CRITICAL_SUCCESS: -2,
    SUCCESS: -1,
    FAILURE: 1,
    CRITICAL_FAILURE: 2,
  });

  function assertInteger(value, label) {
    if (!Number.isInteger(value)) {
      throw new TypeError(label + " must be an integer; received " + String(value) + ".");
    }
  }

  function assertNonEmptyString(value, label) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(label + " must be a non-empty string.");
    }
  }

  function normalizeSaveType(value) {
    if (typeof value !== "string") {
      throw new TypeError("saveType must be a string.");
    }
    const normalized = value.trim().toLowerCase();
    if (SAVE_TYPES.indexOf(normalized) === -1) {
      throw new RangeError(
        'saveType must be "fortitude", "reflex", or "will"; received ' +
          String(value) +
          ".",
      );
    }
    return normalized;
  }

  /**
   * Build and validate a mutable affliction record.
   *
   * @param {{
   *   id?:string,
   *   name:string,
   *   saveType:string,
   *   saveDC:number,
   *   maxStage?:number,
   *   stage?:number,
   *   sourceId?:string
   * }} input
   * @returns {object}
   */
  function createAffliction(input) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("affliction must be an object.");
    }

    assertNonEmptyString(input.name, "affliction name");
    const name = input.name.trim();
    const derivedId = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const id =
      input.id === undefined ? derivedId || "affliction" : input.id;
    assertNonEmptyString(id, "affliction id");

    const saveType = normalizeSaveType(input.saveType);
    assertInteger(input.saveDC, "affliction saveDC");
    if (input.saveDC < 0) {
      throw new RangeError("affliction saveDC must be a non-negative integer.");
    }

    const maxStage =
      input.maxStage === undefined ? DEFAULT_MAX_STAGE : input.maxStage;
    if (!Number.isInteger(maxStage) || maxStage <= 0) {
      throw new RangeError("affliction maxStage must be a positive integer.");
    }

    const stage = input.stage === undefined ? 1 : input.stage;
    if (!Number.isInteger(stage) || stage < 1 || stage > maxStage) {
      throw new RangeError(
        "affliction stage must be an integer from 1 to maxStage.",
      );
    }

    return {
      type: "affliction",
      id: id,
      name: name,
      saveType: saveType,
      saveDC: input.saveDC,
      maxStage: maxStage,
      stage: stage,
      sourceId:
        typeof input.sourceId === "string" && input.sourceId.trim() !== ""
          ? input.sourceId
          : null,
    };
  }

  /**
   * Defensive copy of an affliction record.
   *
   * @param {object} affliction
   * @returns {object}
   */
  function copyAffliction(affliction) {
    return {
      type: "affliction",
      id: affliction.id,
      name: affliction.name,
      saveType: affliction.saveType,
      saveDC: affliction.saveDC,
      maxStage: affliction.maxStage,
      stage: affliction.stage,
      sourceId: affliction.sourceId === undefined ? null : affliction.sourceId,
    };
  }

  /**
   * Pure stage arithmetic, clamped to [0, maxStage]. Stage 0 means cured.
   *
   * @param {object} affliction
   * @param {number} delta
   * @returns {number}
   */
  function applyStageChange(affliction, delta) {
    assertInteger(delta, "stage delta");
    return Math.max(0, Math.min(affliction.maxStage, affliction.stage + delta));
  }

  /**
   * Resolve the d20 for an affliction save. `rollAfflictionSave` is the
   * dedicated callback; the generic callbacks keep the engine compatible with
   * `Combatant.endTurn()` and with deterministic tests.
   *
   * @param {object} options
   * @returns {number}
   */
  function resolveD20(options) {
    const opts = options || {};
    let value;
    if (opts.d20 !== undefined) {
      value = opts.d20;
    } else if (typeof opts.rollAfflictionSave === "function") {
      value = opts.rollAfflictionSave();
    } else if (typeof opts.rollD20 === "function") {
      value = opts.rollD20();
    } else if (typeof opts.rollDie === "function") {
      value = opts.rollDie(20);
    } else {
      value = 1 + Math.floor(Math.random() * 20);
    }

    assertInteger(value, "d20");
    if (value < 1 || value > 20) {
      throw new RangeError("d20 must be an integer from 1 to 20.");
    }
    return value;
  }

  /**
   * Save modifier for an affliction, including situation conditions such as
   * Frightened through the canonical modifier resolver.
   *
   * @param {object} combatant
   * @param {string} saveType
   * @returns {number}
   */
  function resolveSaveModifier(combatant, saveType) {
    if (combatant === null || typeof combatant !== "object") {
      return 0;
    }
    const base =
      typeof combatant.getSaveModifier === "function"
        ? combatant.getSaveModifier(saveType)
        : 0;
    const situational =
      typeof combatant.getSaveModifiers === "function"
        ? combatant.getSaveModifiers(saveType)
        : [];
    return Modifiers.resolveModifiers(base, situational).total;
  }

  /**
   * Roll one end-of-turn affliction save and mutate the record's stage.
   *
   * @param {{
   *   affliction: object,
   *   combatant: object,
   *   d20?:number,
   *   rollAfflictionSave?:Function,
   *   rollD20?:Function,
   *   rollDie?:Function
   * }} options
   * @returns {{
   *   id:string,
   *   name:string,
   *   saveType:string,
   *   saveDC:number,
   *   d20:number,
   *   modifier:number,
   *   total:number,
   *   degree:string,
   *   from:number,
   *   to:number,
   *   delta:number,
   *   cured:boolean,
   *   maxStage:number
   * }}
   */
  function resolveAfflictionSave(options) {
    const opts = options || {};
    const affliction = opts.affliction;
    if (affliction === null || typeof affliction !== "object") {
      throw new TypeError("resolveAfflictionSave requires an affliction.");
    }

    const d20 = resolveD20(opts);
    const modifier = resolveSaveModifier(opts.combatant, affliction.saveType);
    const check = Checks.evaluateCheck({
      d20: d20,
      modifier: modifier,
      dc: affliction.saveDC,
    });

    const delta = STAGE_DELTAS[check.degree];
    const from = affliction.stage;
    const to = applyStageChange(affliction, delta);
    const cured = to <= 0;
    affliction.stage = to;

    return {
      id: affliction.id,
      name: affliction.name,
      saveType: affliction.saveType,
      saveDC: affliction.saveDC,
      d20: d20,
      modifier: modifier,
      total: check.total,
      degree: check.degree,
      from: from,
      to: to,
      delta: delta,
      cured: cured,
      maxStage: affliction.maxStage,
    };
  }

  /**
   * Resolve every affliction on a combatant at the end of its turn. Cured
   * afflictions are removed from `combatant.afflictions`.
   *
   * @param {{
   *   combatant: object,
   *   d20?:number,
   *   rollAfflictionSave?:Function,
   *   rollD20?:Function,
   *   rollDie?:Function
   * }} options
   * @returns {{results:object[], changed:boolean, cured:object[]}}
   */
  function tickAfflictions(options) {
    const opts = options || {};
    const combatant = opts.combatant;
    if (
      combatant === null ||
      typeof combatant !== "object" ||
      !Array.isArray(combatant.afflictions) ||
      combatant.afflictions.length === 0
    ) {
      return { results: [], changed: false, cured: [] };
    }

    const results = [];
    const cured = [];
    for (const affliction of combatant.afflictions.slice()) {
      const result = resolveAfflictionSave(
        Object.assign({}, opts, { affliction: affliction }),
      );
      results.push(result);
      if (result.cured) {
        cured.push(copyAffliction(affliction));
        const index = combatant.afflictions.indexOf(affliction);
        if (index !== -1) {
          combatant.afflictions.splice(index, 1);
        }
      }
    }

    return {
      results: results,
      changed: results.length > 0,
      cured: cured,
    };
  }

  return Object.freeze({
    SAVE_TYPES: SAVE_TYPES,
    STAGE_DELTAS: STAGE_DELTAS,
    DEFAULT_MAX_STAGE: DEFAULT_MAX_STAGE,
    createAffliction: createAffliction,
    copyAffliction: copyAffliction,
    applyStageChange: applyStageChange,
    resolveAfflictionSave: resolveAfflictionSave,
    tickAfflictions: tickAfflictions,
  });
});
