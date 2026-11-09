/**
 * PF2E REMASTERED — SPELLS & BASIC SAVING THROWS (HEADLESS CORE)
 *
 * A spell is authored presentation-free data:
 *
 *   {
 *     id: "fireball",
 *     cost: 2,                       // actions, 1-3
 *     type: "attack" | "save",
 *     traits: ["attack", "fire", "manipulate"],
 *     saveType: "reflex",            // save spells
 *     basic: true,                   // basic saving throw
 *     area: { type: "burst", radiusFeet: 20 },
 *     damage: { formula: "6d6", type: "fire" }
 *   }
 *
 * This module owns the Basic Saving Throw damage contract:
 *
 *   Critical Success -> 0 damage
 *   Success          -> floor(damage / 2)
 *   Failure          -> damage
 *   Critical Failure -> damage * 2
 *
 * Degree resolution always goes through Rules/checks.js. `saveRoll` may be a
 * final save total (d20 + save modifier) or a raw d20 when `saveModifier` is
 * supplied. Natural 20 / natural 1 adjustments are applied exactly once.
 *
 * No presentation state and no random source live here: the caller supplies
 * the d20 and the already-rolled damage.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./checks.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Rules = root.PF2e.Core.Rules || {};
    root.PF2e.Core.Rules.Spells = factory(root.PF2e.Core.Rules.Checks);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Checks) {
  "use strict";

  const SPELL_TYPES = Object.freeze({
    ATTACK: "attack",
    SAVE: "save",
  });

  const SAVE_TYPES = Object.freeze(["fortitude", "reflex", "will"]);

  const BASIC_SAVE_MULTIPLIERS = Object.freeze({
    CRITICAL_SUCCESS: 0,
    SUCCESS: 0.5,
    FAILURE: 1,
    CRITICAL_FAILURE: 2,
  });

  // A neutral d20 keeps evaluateCheck from applying a spurious natural 20/1
  // shift when `saveRoll` is a final total rather than a raw die face.
  const NEUTRAL_D20 = 10;

  function assertInteger(value, label) {
    if (!Number.isInteger(value)) {
      throw new TypeError(label + " must be an integer; received " + String(value) + ".");
    }
  }

  function assertNonNegativeInteger(value, label) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(label + " must be a non-negative integer.");
    }
  }

  function normalizeSaveType(value) {
    const name = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (SAVE_TYPES.indexOf(name) === -1) {
      throw new RangeError(
        'saveType must be "fortitude", "reflex", or "will"; received ' +
          String(value) +
          ".",
      );
    }
    return name;
  }

  /**
   * Trait lookup shared by casting, costs, and Reactive Strike triggers.
   * Accepts strings or `{ slug }` / `{ name }` trait objects.
   *
   * @param {object} spell
   * @param {string} name
   * @returns {boolean}
   */
  function hasTrait(spell, name) {
    if (spell === null || typeof spell !== "object") {
      return false;
    }
    if (!Array.isArray(spell.traits)) {
      return false;
    }
    const wanted = String(name).trim().toLowerCase();
    return spell.traits.some(function (trait) {
      let value;
      if (typeof trait === "string") {
        value = trait;
      } else if (trait !== null && typeof trait === "object") {
        value = trait.slug === undefined ? trait.name : trait.slug;
      }
      return typeof value === "string" && value.trim().toLowerCase() === wanted;
    });
  }

  /**
   * PF2e Basic Saving Throw damage applied to already-rolled raw damage.
   *
   * @param {number} rawDamage non-negative integer
   * @param {string} degree one of Checks.DEGREES
   * @returns {number}
   */
  function basicSaveDamage(rawDamage, degree) {
    assertNonNegativeInteger(rawDamage, "rawDamage");
    const multiplier = BASIC_SAVE_MULTIPLIERS[degree];
    if (multiplier === undefined) {
      throw new RangeError("Unknown degree of success: " + String(degree) + ".");
    }
    if (multiplier === 0) {
      return 0;
    }
    if (multiplier === 0.5) {
      return Math.floor(rawDamage / 2);
    }
    return rawDamage * multiplier;
  }

  /**
   * Resolve a Basic Saving Throw.
   *
   * `saveRoll` is normally the final total (d20 + save modifier). Supplying
   * `saveModifier` instead treats `saveRoll` as the raw d20, which lets
   * Checks.evaluateCheck apply natural 20 / natural 1 automatically. The
   * explicit `isNatural20` / `isNatural1` flags are honoured in total mode.
   *
   * @param {{
   *   saveRoll: number,
   *   saveDC: number,
   *   rawDamage: number,
   *   saveModifier?: number,
   *   isNatural20?: boolean,
   *   isNatural1?: boolean
   * }} options
   * @returns {{
   *   saveRoll: number,
   *   saveDC: number,
   *   rawDamage: number,
   *   total: number,
   *   degree: string,
   *   damageMultiplier: number,
   *   damage: number,
   *   isNatural20: boolean,
   *   isNatural1: boolean
   * }}
   */
  function evaluateBasicSave(options) {
    const opts = options || {};
    assertInteger(opts.saveRoll, "saveRoll");
    assertInteger(opts.saveDC, "saveDC");
    assertNonNegativeInteger(opts.rawDamage, "rawDamage");

    let check;
    let isNatural20 = opts.isNatural20 === true;
    let isNatural1 = opts.isNatural1 === true;

    if (opts.saveModifier !== undefined) {
      assertInteger(opts.saveModifier, "saveModifier");
      check = Checks.evaluateCheck({
        d20: opts.saveRoll,
        modifier: opts.saveModifier,
        dc: opts.saveDC,
      });
      isNatural20 = check.isNatural20;
      isNatural1 = check.isNatural1;
    } else {
      // Total mode: preserve the exact total while preventing evaluateCheck
      // from mistaking a total of 20 for a natural 20.
      check = Checks.evaluateCheck({
        d20: NEUTRAL_D20,
        modifier: opts.saveRoll - NEUTRAL_D20,
        dc: opts.saveDC,
      });
      if (isNatural20) {
        check = Object.assign({}, check, {
          degree: Checks.shiftDegree(check.degree, 1),
        });
      } else if (isNatural1) {
        check = Object.assign({}, check, {
          degree: Checks.shiftDegree(check.degree, -1),
        });
      }
    }

    const damage = basicSaveDamage(opts.rawDamage, check.degree);
    return {
      saveRoll: opts.saveRoll,
      saveDC: opts.saveDC,
      rawDamage: opts.rawDamage,
      total: check.total,
      degree: check.degree,
      damageMultiplier: BASIC_SAVE_MULTIPLIERS[check.degree],
      damage: damage,
      finalDamage: damage,
      isNatural20: isNatural20,
      isNatural1: isNatural1,
    };
  }

  return Object.freeze({
    SPELL_TYPES: SPELL_TYPES,
    SAVE_TYPES: SAVE_TYPES,
    BASIC_SAVE_MULTIPLIERS: BASIC_SAVE_MULTIPLIERS,
    hasTrait: hasTrait,
    normalizeSaveType: normalizeSaveType,
    basicSaveDamage: basicSaveDamage,
    evaluateBasicSave: evaluateBasicSave,
  });
});
