/**
 * PF2E REMASTERED — ESCAPE ACTION (HEADLESS CORE)
 *
 * Escape is a 1-action action with the `attack` trait:
 *   - only a Grabbed or Restrained creature can use it;
 *   - the escaper picks the highest of Unarmed Attack, Athletics, or Acrobatics;
 *   - the DC is the grappler's Athletics DC (`10 + Athletics + mods`);
 *   - the current Multiple Attack Penalty applies and advances afterwards;
 *   - Success or Critical Success removes Grabbed/Restrained (and the
 *     companion Immobilized condition) applied by that grappler.
 *
 * Visibility follows the same rule as the other attack-trait actions: a
 * Concealed/Hidden grappler imposes its flat check before the roll. A defeated
 * grappler cannot maintain a hold, so the attempt releases the condition
 * without spending an action.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Entities/conditions.js"),
      require("../Rules/checks.js"),
      require("../Rules/map.js"),
      require("../Rules/modifiers.js"),
      require("./strike.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.Escape = factory(
      root.PF2e.Core.Conditions,
      root.PF2e.Core.Rules.Checks,
      root.PF2e.Core.Rules.MultipleAttack,
      root.PF2e.Core.Rules.Modifiers,
      root.PF2e.Core.Actions.Strike,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Conditions,
  Checks,
  MultipleAttack,
  Modifiers,
  Strike,
) {
  "use strict";

  const ACTION_COST = 1;
  const DEFENSE = "athletics";
  const DEFENSE_LABEL = "Athletics DC";

  const ESCAPE_REASONS = Object.freeze({
    NO_ACTIONS: "no-actions",
    ACTOR_DEFEATED: "actor-defeated",
    NOT_GRABBED: "not-grabbed",
    NO_SOURCE: "no-source",
    SOURCE_DEFEATED: "source-defeated",
  });

  const OPTION_PREFERENCE = Object.freeze([
    "unarmed",
    "athletics",
    "acrobatics",
  ]);

  function resolveMapPenalty(actor, agile) {
    if (typeof actor.getMultipleAttackPenalty === "function") {
      return actor.getMultipleAttackPenalty(agile);
    }
    const attacksMade = Number.isInteger(actor.attacksThisTurn)
      ? actor.attacksThisTurn
      : 0;
    return MultipleAttack.multipleAttackPenalty(attacksMade, agile);
  }

  function mapModifier(mapPenalty) {
    if (mapPenalty === 0) {
      return [];
    }
    return [
      {
        name: "MAP",
        type: Modifiers.MODIFIER_TYPES.UNTYPED,
        value: mapPenalty,
        source: "multiple-attack-penalty",
      },
    ];
  }

  function skillBaseOf(actor, skill) {
    if (typeof actor.getSkillModifier === "function") {
      return actor.getSkillModifier(skill);
    }
    const skills =
      actor.skills && typeof actor.skills === "object" ? actor.skills : {};
    return Number.isInteger(skills[skill]) ? skills[skill] : 0;
  }

  function skillModifiersOf(actor, skill) {
    if (typeof actor.getSkillModifiers === "function") {
      return actor.getSkillModifiers(skill);
    }
    return typeof actor.getConditionModifiers === "function"
      ? actor.getConditionModifiers(["skill", "skill:" + skill, "check"])
      : [];
  }

  function unarmedBaseOf(actor) {
    return Number.isInteger(actor.attackBonus) ? actor.attackBonus : 0;
  }

  function unarmedModifiersOf(actor) {
    return typeof actor.getConditionModifiers === "function"
      ? actor.getConditionModifiers("attack")
      : [];
  }

  /**
   * The three legal Escape options with MAP applied. The highest total wins;
   * ties fall back to the higher base value and then the fixed preference
   * order Unarmed -> Athletics -> Acrobatics.
   *
   * @param {object} actor
   * @param {number} mapPenalty
   * @returns {object[]}
   */
  function getEscapeOptions(actor, mapPenalty) {
    const extra = mapModifier(mapPenalty);
    const definitions = [
      {
        key: "unarmed",
        label: "Unarmed Attack",
        base: unarmedBaseOf(actor),
        modifiers: unarmedModifiersOf(actor),
      },
      {
        key: "athletics",
        label: "Athletics",
        base: skillBaseOf(actor, "athletics"),
        modifiers: skillModifiersOf(actor, "athletics"),
      },
      {
        key: "acrobatics",
        label: "Acrobatics",
        base: skillBaseOf(actor, "acrobatics"),
        modifiers: skillModifiersOf(actor, "acrobatics"),
      },
    ];

    const options = definitions.map(function (definition, index) {
      const modifiers = definition.modifiers.concat(extra);
      const resolution = Modifiers.resolveModifiers(definition.base, modifiers);
      return {
        key: definition.key,
        label: definition.label,
        skill: definition.key,
        skillLabel: definition.label,
        base: definition.base,
        baseValue: definition.base,
        total: resolution.total,
        modifier: resolution.total,
        modifiers: resolution.effectiveModifiers,
        breakdown: resolution.breakdown,
        preference: index,
      };
    });

    options.sort(function (a, b) {
      return (
        b.total - a.total ||
        b.base - a.base ||
        OPTION_PREFERENCE.indexOf(a.key) - OPTION_PREFERENCE.indexOf(b.key)
      );
    });
    return options;
  }

  function findSource(options, condition) {
    if (options.source && typeof options.source === "object") {
      return options.source;
    }
    const sourceId =
      typeof options.sourceId === "string"
        ? options.sourceId
        : condition
          ? condition.sourceId
          : null;
    if (typeof sourceId !== "string" || !Array.isArray(options.combatants)) {
      return null;
    }
    return (
      options.combatants.find(function (combatant) {
        return combatant && combatant.id === sourceId;
      }) || null
    );
  }

  /**
   * Pick the grapple record maintained by the chosen source when the victim is
   * held by more than one creature. Falls back to the canonical primary record.
   *
   * @param {object} actor
   * @param {object} options
   * @returns {object|null}
   */
  function grappleConditionFor(actor, options) {
    const sourceId =
      options.source && typeof options.source === "object"
        ? options.source.id
        : typeof options.sourceId === "string"
          ? options.sourceId
          : null;

    if (
      typeof sourceId === "string" &&
      typeof actor.getConditionFrom === "function"
    ) {
      const restrained = actor.getConditionFrom("restrained", sourceId);
      if (restrained !== null) {
        return restrained;
      }
      const grabbed = actor.getConditionFrom("grabbed", sourceId);
      if (grabbed !== null) {
        return grabbed;
      }
    }

    return typeof actor.getGrappleCondition === "function"
      ? actor.getGrappleCondition()
      : Conditions.getGrappleCondition(actor);
  }

  function athleticsDCOf(grappler) {
    const base =
      typeof grappler.getSkillModifier === "function"
        ? grappler.getSkillModifier("athletics")
        : Number.isInteger(grappler.skills && grappler.skills.athletics)
          ? grappler.skills.athletics
          : 0;
    const modifiers =
      typeof grappler.getDCModifiers === "function"
        ? grappler.getDCModifiers("athletics")
        : typeof grappler.getConditionModifiers === "function"
          ? grappler.getConditionModifiers(["dc", "dc:athletics"])
          : [];
    return {
      base: base,
      resolution: Checks.resolveDC(base, modifiers),
    };
  }

  /**
   * Validation and math without spending an action or rolling dice.
   *
   * @param {{
   *   actor: object,
   *   source?: object,
   *   combatants?: object[],
   *   agile?: boolean
   * }} options
   * @returns {object}
   */
  function evaluateEscape(options) {
    const opts = options || {};
    const actor = opts.actor;

    if (actor === null || typeof actor !== "object") {
      throw new TypeError("Escape requires an actor.");
    }
    if (actor.isDefeated === true) {
      return { ok: false, reason: ESCAPE_REASONS.ACTOR_DEFEATED };
    }

    const condition = grappleConditionFor(actor, opts);
    if (condition === null) {
      return { ok: false, reason: ESCAPE_REASONS.NOT_GRABBED };
    }

    const source = findSource(opts, condition);
    if (source === null) {
      return {
        ok: false,
        reason: ESCAPE_REASONS.NO_SOURCE,
        sourceId: condition.sourceId,
        condition: condition,
      };
    }
    if (source.isDefeated === true) {
      return {
        ok: false,
        reason: ESCAPE_REASONS.SOURCE_DEFEATED,
        source: source,
        sourceId: source.id,
        sourceName: source.name,
        condition: condition,
      };
    }

    const agile = opts.agile === true;
    const mapPenalty = resolveMapPenalty(actor, agile);
    const escapeOptions = getEscapeOptions(actor, mapPenalty);
    const bestOption = escapeOptions[0];
    const dc = athleticsDCOf(source);
    const visibility = Conditions.getVisibility(source);
    const usesFlatCheck =
      visibility.undetected !== true && visibility.flatCheckDC !== null;

    return {
      ok: true,
      actionCost: ACTION_COST,
      actorId: actor.id,
      actorName: actor.name,
      source: source,
      sourceId: source.id,
      sourceName: source.name,
      condition: condition,
      conditionName: condition.name,
      conditionLabel: condition.label,
      grappleCondition: condition.name,
      defense: DEFENSE,
      defenseLabel: DEFENSE_LABEL,
      targetDCBaseValue: dc.base,
      targetDCBase: 10 + dc.base,
      targetDC: dc.resolution.total,
      athleticsDC: dc.resolution.total,
      targetDCModifiers: dc.resolution.effectiveModifiers,
      targetDCBreakdown: dc.resolution.breakdown,
      mapPenalty: mapPenalty,
      multipleAttackPenalty: mapPenalty,
      agile: agile,
      options: escapeOptions,
      bestOption: bestOption,
      skill: bestOption.key,
      skillLabel: bestOption.label,
      skillBase: bestOption.base,
      attackModifier: bestOption.total,
      attackModifiers: bestOption.modifiers,
      attackBreakdown: bestOption.breakdown,
      visibility: visibility,
      flatCheckCondition: usesFlatCheck ? visibility.condition : null,
      flatCheckDC: usesFlatCheck ? visibility.flatCheckDC : null,
    };
  }

  function hasActions(actor) {
    if (typeof actor.canSpendActions === "function") {
      return actor.canSpendActions(ACTION_COST);
    }
    return Number.isInteger(actor.actionsRemaining)
      ? actor.actionsRemaining >= ACTION_COST
      : false;
  }

  function advanceMap(actor) {
    actor.spendActions(ACTION_COST);
    actor.attacksThisTurn = Number.isInteger(actor.attacksThisTurn)
      ? actor.attacksThisTurn + 1
      : 1;
  }

  function mapAfter(actor, agile) {
    return typeof actor.getMultipleAttackPenalty === "function"
      ? actor.getMultipleAttackPenalty(agile)
      : null;
  }

  /**
   * @param {object} options
   * @returns {object}
   */
  function performEscape(options) {
    const opts = options || {};
    const actor = opts.actor;

    if (!actor || typeof actor.canSpendActions !== "function") {
      throw new TypeError("Escape requires a Combatant with an action pool.");
    }
    if (!hasActions(actor)) {
      return { ok: false, reason: ESCAPE_REASONS.NO_ACTIONS };
    }

    const evaluation = evaluateEscape(opts);
    if (!evaluation.ok) {
      if (
        evaluation.reason === ESCAPE_REASONS.SOURCE_DEFEATED &&
        typeof actor.releaseGrappleFrom === "function"
      ) {
        const removed = actor.releaseGrappleFrom(evaluation.sourceId);
        return Object.assign({}, evaluation, {
          released: removed.length > 0,
          removed: removed,
          actionsLeft: actor.actionsRemaining,
          attacksThisTurn: actor.attacksThisTurn,
        });
      }
      return evaluation;
    }

    let flatCheck = null;
    if (evaluation.flatCheckDC !== null) {
      flatCheck = Strike.rollVisibilityFlatCheck(
        opts,
        evaluation.flatCheckDC,
        evaluation.flatCheckCondition,
      );
    }

    if (flatCheck !== null && !flatCheck.passed) {
      advanceMap(actor);
      return {
        ok: true,
        actionCost: ACTION_COST,
        automaticMiss: true,
        escaped: false,
        actorId: actor.id,
        actorName: actor.name,
        sourceId: evaluation.sourceId,
        sourceName: evaluation.sourceName,
        conditionName: evaluation.conditionName,
        conditionLabel: evaluation.conditionLabel,
        skill: evaluation.skill,
        skillLabel: evaluation.skillLabel,
        skillBase: evaluation.skillBase,
        attackRoll: null,
        attackModifier: evaluation.attackModifier,
        attackModifiers: evaluation.attackModifiers,
        attackBreakdown: evaluation.attackBreakdown,
        mapPenalty: evaluation.mapPenalty,
        multipleAttackPenalty: evaluation.mapPenalty,
        total: null,
        dc: evaluation.targetDC,
        targetDC: evaluation.targetDC,
        athleticsDC: evaluation.athleticsDC,
        targetDCBaseValue: evaluation.targetDCBaseValue,
        targetDCBase: evaluation.targetDCBase,
        targetDCModifiers: evaluation.targetDCModifiers,
        targetDCBreakdown: evaluation.targetDCBreakdown,
        defense: evaluation.defense,
        defenseLabel: evaluation.defenseLabel,
        options: evaluation.options,
        bestOption: evaluation.bestOption,
        flatCheck: flatCheck,
        visibility: evaluation.visibility,
        degree: null,
        success: false,
        critical: false,
        removed: [],
        actionsLeft: actor.actionsRemaining,
        attacksThisTurn: actor.attacksThisTurn,
        mapAfter: mapAfter(actor, evaluation.agile),
      };
    }

    const d20 = Strike.rollAttack(opts);
    const check = Checks.evaluateCheck({
      d20: d20,
      modifier: evaluation.attackModifier,
      dc: evaluation.targetDC,
    });

    advanceMap(actor);

    const escaped =
      check.degree === Checks.DEGREES.SUCCESS ||
      check.degree === Checks.DEGREES.CRITICAL_SUCCESS;

    let removed = [];
    if (escaped) {
      removed =
        typeof actor.releaseGrappleFrom === "function"
          ? actor.releaseGrappleFrom(evaluation.sourceId)
          : [];
    }

    return {
      ok: true,
      actionCost: ACTION_COST,
      automaticMiss: false,
      escaped: escaped,
      actorId: actor.id,
      actorName: actor.name,
      sourceId: evaluation.sourceId,
      sourceName: evaluation.sourceName,
      conditionName: evaluation.conditionName,
      conditionLabel: evaluation.conditionLabel,
      skill: evaluation.skill,
      skillLabel: evaluation.skillLabel,
      skillBase: evaluation.skillBase,
      attackRoll: d20,
      attackBonus: evaluation.skillBase,
      baseAttackBonus: evaluation.skillBase,
      attackModifier: evaluation.attackModifier,
      attackModifiers: evaluation.attackModifiers,
      attackBreakdown: evaluation.attackBreakdown,
      mapPenalty: evaluation.mapPenalty,
      multipleAttackPenalty: evaluation.mapPenalty,
      total: check.total,
      attackTotal: check.total,
      dc: evaluation.targetDC,
      targetDC: evaluation.targetDC,
      athleticsDC: evaluation.athleticsDC,
      targetDCBaseValue: evaluation.targetDCBaseValue,
      targetDCBase: evaluation.targetDCBase,
      targetDCModifiers: evaluation.targetDCModifiers,
      targetDCBreakdown: evaluation.targetDCBreakdown,
      defense: evaluation.defense,
      defenseLabel: evaluation.defenseLabel,
      options: evaluation.options,
      bestOption: evaluation.bestOption,
      flatCheck: flatCheck,
      visibility: evaluation.visibility,
      degree: check.degree,
      isNatural20: check.isNatural20,
      isNatural1: check.isNatural1,
      success:
        check.degree === Checks.DEGREES.SUCCESS ||
        check.degree === Checks.DEGREES.CRITICAL_SUCCESS,
      critical: check.degree === Checks.DEGREES.CRITICAL_SUCCESS,
      removed: removed,
      actionsLeft: actor.actionsRemaining,
      attacksThisTurn: actor.attacksThisTurn,
      mapAfter: mapAfter(actor, evaluation.agile),
    };
  }

  return Object.freeze({
    ESCAPE_REASONS: ESCAPE_REASONS,
    ACTION_COST: ACTION_COST,
    DEFENSE: DEFENSE,
    DEFENSE_LABEL: DEFENSE_LABEL,
    OPTION_PREFERENCE: OPTION_PREFERENCE,
    getEscapeOptions: getEscapeOptions,
    evaluateEscape: evaluateEscape,
    performEscape: performEscape,
  });
});
