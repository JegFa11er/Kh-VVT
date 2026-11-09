/**
 * PF2E REMASTERED — SHOVE ACTION (HEADLESS CORE)
 *
 * Shove is a 1-action skill action with the `attack` trait:
 *   - Athletics against the target's Fortitude DC (`10 + Fortitude + mods`);
 *   - uses and advances the Multiple Attack Penalty;
 *   - requires melee reach, line of sight, and the usual visibility check;
 *   - Critical Success: push the target 10 ft (2 squares);
 *   - Success: push the target 5 ft (1 square);
 *   - Critical Failure: the attacker falls prone.
 *
 * The push vector is the attacker-centre -> target-centre line reduced to one
 * of the eight grid directions. Each square is checked in order; the push
 * stops before a wall, another creature, or the grid edge. A partially blocked
 * 10-ft push therefore becomes a 5-ft push (or 0 ft if the first square is
 * blocked). The action is still a success.
 *
 * Shove is forced movement: it does not provoke Reactive Strike and it does
 * not change the target's diagonal-step counter.
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
    root.PF2e.Core.Actions.Shove = factory(
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

  const SHOVE_REASONS = Object.freeze({
    NO_ACTIONS: "no-actions",
    ATTACKER_DEFEATED: "attacker-defeated",
    TARGET_DEFEATED: "target-defeated",
    NO_FREE_HAND: "no-free-hand",
    TARGET_TOO_LARGE: "target-too-large",
  });

  const SUCCESS_SQUARES = 1;
  const CRITICAL_SQUARES = 2;

  function getPushDirection(attacker, target) {
    return {
      x: Math.sign(target.x - attacker.x),
      y: Math.sign(target.y - attacker.y),
    };
  }

  function isCellOccupied(cell, target, combatants) {
    if (!Array.isArray(combatants)) {
      return false;
    }
    return combatants.some(function (combatant) {
      if (combatant === null || typeof combatant !== "object") {
        return false;
      }
      if (combatant === target) {
        return false;
      }
      return combatant.x === cell.x && combatant.y === cell.y;
    });
  }

  /**
   * Walk the push vector one square at a time and stop before the first
   * blocked cell.
   *
   * @param {{
   *   target: object,
   *   map: object,
   *   direction: {x:number,y:number},
   *   squares: number,
   *   combatants?: object[]
   * }} options
   * @returns {{
   *   path: {x:number,y:number}[],
   *   origin: {x:number,y:number},
   *   destination: {x:number,y:number},
   *   pushedSquares: number,
   *   pushedFeet: number,
   *   blockedAt: {x:number,y:number}|null,
   *   blockedReason: string|null,
   *   stoppedEarly: boolean
   * }}
   */
  function computePushPath(options) {
    const opts = options || {};
    const target = opts.target;
    const map = opts.map;
    const direction = opts.direction || { x: 0, y: 0 };
    const squares = Math.max(0, opts.squares || 0);

    const origin = { x: target.x, y: target.y };
    const path = [origin];
    let current = origin;
    let blockedAt = null;
    let blockedReason = null;

    if (direction.x === 0 && direction.y === 0) {
      return {
        path: path,
        origin: origin,
        destination: origin,
        pushedSquares: 0,
        pushedFeet: 0,
        blockedAt: null,
        blockedReason: "no-direction",
        stoppedEarly: squares > 0,
      };
    }

    for (let step = 0; step < squares; step += 1) {
      const next = {
        x: current.x + direction.x,
        y: current.y + direction.y,
      };

      let reason = null;
      if (!map.isInBounds(next.x, next.y)) {
        reason = "bounds";
      } else if (map.isBlocked(next.x, next.y)) {
        reason = "wall";
      } else if (isCellOccupied(next, target, opts.combatants)) {
        reason = "creature";
      }

      if (reason !== null) {
        blockedAt = next;
        blockedReason = reason;
        break;
      }

      path.push(next);
      current = next;
    }

    return {
      path: path,
      origin: origin,
      destination: current,
      pushedSquares: path.length - 1,
      pushedFeet: (path.length - 1) * 5,
      blockedAt: blockedAt,
      blockedReason: blockedReason,
      stoppedEarly: path.length - 1 < squares,
    };
  }

  /**
   * Validation and math without spending an action or rolling dice.
   *
   * @param {object} options
   * @returns {object}
   */
  function evaluateShove(options) {
    const opts = options || {};
    const evaluation = AthleticsManeuver.evaluate(opts, "shove");
    if (!evaluation.ok) {
      return evaluation;
    }

    const direction = getPushDirection(opts.attacker, opts.target);
    const potentialPath = computePushPath({
      target: opts.target,
      map: opts.map,
      direction: direction,
      squares: CRITICAL_SQUARES,
      combatants: opts.combatants || opts.allies,
    });

    return Object.assign({}, evaluation, {
      actionCost: ACTION_COST,
      pushDirection: direction,
      maxPushSquares: CRITICAL_SQUARES,
      potentialPushPath: potentialPath.path,
      potentialPushedFeet: potentialPath.pushedFeet,
      potentialBlockedAt: potentialPath.blockedAt,
      potentialBlockedReason: potentialPath.blockedReason,
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
      pushDirection: evaluation.pushDirection,
      pushPath: [],
      pushedSquares: 0,
      pushedFeet: 0,
      blockedAt: null,
      blockedReason: null,
      targetPositionBefore: { x: target.x, y: target.y },
      targetPositionAfter: { x: target.x, y: target.y },
      actionsLeft: attacker.actionsRemaining,
      attacksThisTurn: attacker.attacksThisTurn,
      mapAfter: AthleticsManeuver.mapAfter(attacker, evaluation.agile),
    };
  }

  /**
   * @param {object} options
   * @returns {object}
   */
  function performShove(options) {
    const opts = options || {};
    const attacker = opts.attacker;
    const target = opts.target;

    if (!attacker || typeof attacker.canSpendActions !== "function") {
      throw new TypeError("Shove requires a Combatant with an action pool.");
    }
    if (!AthleticsManeuver.canSpendAction(attacker)) {
      return { ok: false, reason: SHOVE_REASONS.NO_ACTIONS };
    }

    const evaluation = evaluateShove(opts);
    if (!evaluation.ok) {
      return evaluation;
    }
    if (target.isDefeated === true) {
      return { ok: false, reason: SHOVE_REASONS.TARGET_DEFEATED };
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
      result.attackerProne = true;
      attacker.addCondition("prone");
      return result;
    }

    if (!result.success) {
      return result;
    }

    const squares = result.critical ? CRITICAL_SQUARES : SUCCESS_SQUARES;
    const push = computePushPath({
      target: target,
      map: opts.map,
      direction: evaluation.pushDirection,
      squares: squares,
      combatants: opts.combatants || opts.allies,
    });

    if (push.pushedSquares > 0) {
      target.setPosition(push.destination.x, push.destination.y);
    }

    result.pushPath = push.path;
    result.pushedSquares = push.pushedSquares;
    result.pushedFeet = push.pushedFeet;
    result.blockedAt = push.blockedAt;
    result.blockedReason = push.blockedReason;
    result.stoppedEarly = push.stoppedEarly;
    result.targetPositionAfter = { x: target.x, y: target.y };

    return result;
  }

  return Object.freeze({
    SHOVE_REASONS: SHOVE_REASONS,
    ACTION_COST: ACTION_COST,
    SKILL: SKILL,
    SKILL_LABEL: SKILL_LABEL,
    DEFENSE: DEFENSE,
    DEFENSE_LABEL: DEFENSE_LABEL,
    SUCCESS_SQUARES: SUCCESS_SQUARES,
    CRITICAL_SQUARES: CRITICAL_SQUARES,
    getPushDirection: getPushDirection,
    computePushPath: computePushPath,
    evaluateShove: evaluateShove,
    performShove: performShove,
  });
});
