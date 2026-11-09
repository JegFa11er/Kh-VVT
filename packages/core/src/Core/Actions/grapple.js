/**
 * PF2E REMASTERED — GRAPPLE ACTION (HEADLESS CORE)
 *
 * Grapple is a 1-action skill action with the `attack` trait:
 *   - Athletics against the target's Fortitude DC;
 *   - uses and advances the Multiple Attack Penalty;
 *   - requires melee reach, line of sight, and the usual visibility check;
 *   - Success: the target is Grabbed until the end of the attacker's next turn;
 *   - Critical Success: the target is Restrained instead;
 *   - Critical Failure: the attacker falls prone (deliberate prototype
 *     simplification of the Remastered clause).
 *
 * Grabbed and Restrained both impose Off-Guard (-2 circumstance AC) and
 * Immobilized. The condition record stores the grappler's `sourceId` and the
 * grappler turn on which it expires, so the hold ends on the grappler's turn
 * rather than the victim's. Stepping/Striding or being defeated releases it.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./athletics-maneuver.js"),
      require("../Rules/checks.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.Grapple = factory(
      root.PF2e.Core.Actions.AthleticsManeuver,
      root.PF2e.Core.Rules.Checks,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  AthleticsManeuver,
  Checks,
) {
  "use strict";

  const ACTION_COST = AthleticsManeuver.ACTION_COST;
  const SKILL = AthleticsManeuver.SKILL;
  const SKILL_LABEL = AthleticsManeuver.SKILL_LABEL;
  const DEFENSE = AthleticsManeuver.DEFENSE;
  const DEFENSE_LABEL = AthleticsManeuver.DEFENSE_LABEL;

  const GRAB = "grabbed";
  const RESTRAIN = "restrained";
  const IMMOBILIZED = "immobilized";

  const GRAPPLE_REASONS = Object.freeze({
    NO_ACTIONS: "no-actions",
    ATTACKER_DEFEATED: "attacker-defeated",
    TARGET_DEFEATED: "target-defeated",
    NO_FREE_HAND: "no-free-hand",
    TARGET_TOO_LARGE: "target-too-large",
  });

  function sourceTurnOf(source) {
    return Number.isInteger(source.turnNumber) ? source.turnNumber : 0;
  }

  /**
   * Apply the grapple condition pair (parent + Immobilized) with the source
   * metadata required for turn-end expiry.
   *
   * @param {object} target
   * @param {"grabbed"|"restrained"} name
   * @param {object} source
   * @param {{expiresOnSourceTurn?:number}} [options]
   * @returns {{condition:object,immobilized:object,expiresOnSourceTurn:number}|null}
   */
  function applyGrappleCondition(target, name, source, options) {
    if (name !== GRAB && name !== RESTRAIN) {
      throw new RangeError('Grapple condition must be "grabbed" or "restrained".');
    }
    if (!source || typeof source.id !== "string") {
      throw new TypeError("Grapple requires a source combatant with an id.");
    }
    if (
      typeof target.addCondition !== "function" ||
      typeof target.getCondition !== "function"
    ) {
      throw new TypeError("Grapple target must have a condition store.");
    }

    const opts = options || {};
    const expiresOnSourceTurn = Number.isInteger(opts.expiresOnSourceTurn)
      ? opts.expiresOnSourceTurn
      : sourceTurnOf(source) + 1;

    // Restrained supersedes a Grabbed from the same grappler only. Holds from
    // other sources remain intact. A Grabbed never downgrades an existing
    // Restrained from the same grappler.
    const supportsInstances =
      typeof target.getConditionFrom === "function" &&
      typeof target.removeConditionFrom === "function";
    const grabbed = supportsInstances
      ? target.getConditionFrom(GRAB, source.id)
      : target.getCondition(GRAB);
    const restrained = supportsInstances
      ? target.getConditionFrom(RESTRAIN, source.id)
      : target.getCondition(RESTRAIN);

    if (
      name === RESTRAIN &&
      grabbed !== null &&
      grabbed.sourceId === source.id
    ) {
      if (supportsInstances) {
        target.removeConditionFrom(GRAB, source.id);
      } else {
        target.removeCondition(GRAB);
      }
    }
    if (
      name === GRAB &&
      restrained !== null &&
      restrained.sourceId === source.id
    ) {
      return {
        condition: restrained,
        immobilized: target.getCondition(IMMOBILIZED),
        expiresOnSourceTurn: restrained.expiresOnSourceTurn,
      };
    }

    const condition = target.addCondition(name, undefined, {
      sourceId: source.id,
      expiresOnSourceTurn: expiresOnSourceTurn,
    });
    const immobilized = target.addCondition(IMMOBILIZED, undefined, {
      sourceId: source.id,
      expiresOnSourceTurn: expiresOnSourceTurn,
    });

    return {
      condition: condition,
      immobilized: immobilized,
      expiresOnSourceTurn: expiresOnSourceTurn,
    };
  }

  /**
   * Validation and math without spending an action or rolling dice.
   *
   * @param {object} options
   * @returns {object}
   */
  function evaluateGrapple(options) {
    const evaluation = AthleticsManeuver.evaluate(options || {}, "grapple");
    if (!evaluation.ok) {
      return evaluation;
    }
    return Object.assign({}, evaluation, {
      actionCost: ACTION_COST,
      grabCondition: GRAB,
      restrainCondition: RESTRAIN,
      immobilizedCondition: IMMOBILIZED,
    });
  }

  function baseResult(options, evaluation, checkResult) {
    const attacker = options.attacker;
    const target = options.target;
    return {
      ok: true,
      actionCost: ACTION_COST,
      attackerId: attacker.id,
      attackerName: attacker.name,
      targetId: target.id,
      targetName: target.name,
      skill: SKILL,
      skillLabel: SKILL_LABEL,
      skillBase: evaluation.skillBase,
      skillModifiers: evaluation.skillModifiers,
      attackRoll: checkResult.d20,
      attackBonus: evaluation.skillBase,
      baseAttackBonus: evaluation.skillBase,
      attackModifier: evaluation.attackModifier,
      attackModifiers: evaluation.attackModifiers,
      attackBreakdown: evaluation.attackBreakdown,
      mapPenalty: evaluation.mapPenalty,
      multipleAttackPenalty: evaluation.mapPenalty,
      total: checkResult.check ? checkResult.check.total : null,
      attackTotal: checkResult.check ? checkResult.check.total : null,
      dc: evaluation.targetDC,
      targetDC: evaluation.targetDC,
      fortitudeDC: evaluation.fortitudeDC,
      targetDCBaseValue: evaluation.targetDCBaseValue,
      targetDCBase: evaluation.targetDCBase,
      targetDCModifiers: evaluation.targetDCModifiers,
      targetDCBreakdown: evaluation.targetDCBreakdown,
      defense: DEFENSE,
      defenseLabel: DEFENSE_LABEL,
      distanceFeet: evaluation.distanceFeet,
      reachFeet: evaluation.reachFeet,
      visibility: evaluation.visibility,
      flatCheck: checkResult.flatCheck,
      hiddenAttacker: evaluation.hiddenAttacker,
      degree: checkResult.check ? checkResult.check.degree : null,
      isNatural20: checkResult.check ? checkResult.check.isNatural20 : false,
      isNatural1: checkResult.check ? checkResult.check.isNatural1 : false,
      automaticMiss: checkResult.automaticMiss === true,
      success: false,
      critical: false,
      hit: false,
      attackerProne: false,
      targetGrabbed: false,
      targetRestrained: false,
      targetImmobilized: false,
      condition: null,
      immobilized: null,
      sourceId: attacker.id,
      expiresOnSourceTurn: null,
      released: [],
      actionsLeft: attacker.actionsRemaining,
      attacksThisTurn: attacker.attacksThisTurn,
      mapAfter: AthleticsManeuver.mapAfter(attacker, evaluation.agile),
    };
  }

  /**
   * @param {object} options
   * @returns {object}
   */
  function performGrapple(options) {
    const opts = options || {};
    const attacker = opts.attacker;
    const target = opts.target;

    if (!attacker || typeof attacker.canSpendActions !== "function") {
      throw new TypeError("Grapple requires a Combatant with an action pool.");
    }
    if (!AthleticsManeuver.canSpendAction(attacker)) {
      return { ok: false, reason: GRAPPLE_REASONS.NO_ACTIONS };
    }

    const evaluation = evaluateGrapple(opts);
    if (!evaluation.ok) {
      return evaluation;
    }
    if (target.isDefeated === true) {
      return { ok: false, reason: GRAPPLE_REASONS.TARGET_DEFEATED };
    }

    const checkResult = AthleticsManeuver.resolveCheck(opts, evaluation);
    AthleticsManeuver.advanceMap(attacker);

    const result = baseResult(opts, evaluation, checkResult);
    result.attacksThisTurn = attacker.attacksThisTurn;
    result.mapAfter = AthleticsManeuver.mapAfter(attacker, evaluation.agile);

    if (checkResult.automaticMiss) {
      return result;
    }

    const degree = checkResult.check.degree;
    result.degree = degree;
    result.success =
      degree === Checks.DEGREES.SUCCESS ||
      degree === Checks.DEGREES.CRITICAL_SUCCESS;
    result.critical = degree === Checks.DEGREES.CRITICAL_SUCCESS;
    result.hit = result.success;

    if (degree === Checks.DEGREES.CRITICAL_FAILURE) {
      // Deliberate simplification: the attacker falls prone. Losing the
      // contest also breaks any hold the attacker previously had on this
      // target, so the failure cannot leave a stale grapple behind.
      result.attackerProne = true;
      attacker.addCondition("prone");
      if (typeof target.releaseGrappleFrom === "function") {
        result.released = target.releaseGrappleFrom(attacker.id);
      }
      return result;
    }

    if (!result.success) {
      return result;
    }

    const applied = applyGrappleCondition(
      target,
      result.critical ? RESTRAIN : GRAB,
      attacker,
    );

    result.targetGrabbed = target.hasCondition(GRAB);
    result.targetRestrained = target.hasCondition(RESTRAIN);
    result.targetImmobilized =
      typeof target.isImmobilized === "function"
        ? target.isImmobilized()
        : target.hasCondition(IMMOBILIZED);
    result.condition = applied.condition;
    result.immobilized = applied.immobilized;
    result.expiresOnSourceTurn = applied.expiresOnSourceTurn;
    result.targetOffGuard = true;
    result.grappleCondition = result.targetRestrained ? RESTRAIN : GRAB;

    return result;
  }

  /**
   * Release every grapple a source maintains. Used by the View and by tests
   * that need to model a grappler's death or movement explicitly.
   *
   * @param {object} source
   * @param {object[]} combatants
   * @returns {{combatant:object,combatantId:string,combatantName:string,removed:object[]}[]}
   */
  function releaseGrapplesFromSource(source, combatants) {
    if (!source || typeof source.id !== "string") {
      return [];
    }
    const released = [];
    for (const combatant of combatants || []) {
      if (
        combatant === null ||
        typeof combatant !== "object" ||
        typeof combatant.releaseGrappleFrom !== "function"
      ) {
        continue;
      }
      const removed = combatant.releaseGrappleFrom(source.id);
      if (removed.length > 0) {
        released.push({
          combatant: combatant,
          combatantId: combatant.id,
          combatantName: combatant.name,
          removed: removed,
        });
      }
    }
    return released;
  }

  return Object.freeze({
    GRAPPLE_REASONS: GRAPPLE_REASONS,
    ACTION_COST: ACTION_COST,
    SKILL: SKILL,
    SKILL_LABEL: SKILL_LABEL,
    DEFENSE: DEFENSE,
    DEFENSE_LABEL: DEFENSE_LABEL,
    GRAB: GRAB,
    RESTRAIN: RESTRAIN,
    IMMOBILIZED: IMMOBILIZED,
    applyGrappleCondition: applyGrappleCondition,
    evaluateGrapple: evaluateGrapple,
    performGrapple: performGrapple,
    releaseGrapplesFromSource: releaseGrapplesFromSource,
  });
});
