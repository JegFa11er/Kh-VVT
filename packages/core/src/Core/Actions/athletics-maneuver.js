/**
 * PF2E REMASTERED — ATHLETICS MANEUVER PIPELINE (HEADLESS CORE)
 *
 * Shove and Grapple are the same check in the Remastered rules:
 *   - 1 action, `attack` trait, melee reach;
 *   - Athletics (the attacker's skill) against the target's Fortitude DC;
 *   - the current Multiple Attack Penalty applies and advances afterwards;
 *   - Concealed/Hidden targets impose their flat check before the roll.
 *
 * This module owns that shared math so neither action duplicates the modifier
 * pipeline. Each action module adds only its degree-of-success effects.
 *
 * The roll is an Athletics skill check, not an attack roll, so Prone's -2
 * attack penalty does not apply. MAP still does because the action has the
 * attack trait (identical to Trip).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Rules/checks.js"),
      require("../Rules/map.js"),
      require("../Rules/modifiers.js"),
      require("./strike.js"),
      require("../Entities/equipment.js"),
      require("../Rules/size.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.AthleticsManeuver = factory(
      root.PF2e.Core.Rules.Checks,
      root.PF2e.Core.Rules.MultipleAttack,
      root.PF2e.Core.Rules.Modifiers,
      root.PF2e.Core.Actions.Strike,
      root.PF2e.Core.Equipment,
      root.PF2e.Core.Rules.Size,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Checks,
  MultipleAttack,
  Modifiers,
  Strike,
  Equipment,
  Size,
) {
  "use strict";

  const ACTION_COST = 1;
  const SKILL = "athletics";
  const SKILL_LABEL = "Athletics";
  const DEFENSE = "fortitude";
  const DEFENSE_LABEL = "Fortitude DC";

  const MANEUVER_REASONS = Object.freeze({
    NO_ACTIONS: "no-actions",
    ATTACKER_DEFEATED: "attacker-defeated",
    TARGET_DEFEATED: "target-defeated",
    NO_FREE_HAND: "no-free-hand",
    TARGET_TOO_LARGE: "target-too-large",
  });

  function assertCombatant(combatant, label) {
    if (
      combatant === null ||
      typeof combatant !== "object" ||
      !Number.isInteger(combatant.x) ||
      !Number.isInteger(combatant.y)
    ) {
      throw new TypeError(label + " must be a positioned Combatant.");
    }
  }

  function skillBaseOf(combatant) {
    if (typeof combatant.getSkillModifier === "function") {
      return combatant.getSkillModifier(SKILL);
    }
    const skills =
      combatant.skills && typeof combatant.skills === "object"
        ? combatant.skills
        : {};
    return Number.isInteger(skills[SKILL]) ? skills[SKILL] : 0;
  }

  function fortitudeBaseOf(combatant) {
    if (typeof combatant.getSaveModifier === "function") {
      return combatant.getSaveModifier(DEFENSE);
    }
    const saves =
      combatant.saves && typeof combatant.saves === "object"
        ? combatant.saves
        : {};
    return Number.isInteger(saves[DEFENSE]) ? saves[DEFENSE] : 0;
  }

  function collectSkillModifiers(attacker) {
    if (typeof attacker.getSkillModifiers === "function") {
      return attacker.getSkillModifiers(SKILL);
    }
    return typeof attacker.getConditionModifiers === "function"
      ? attacker.getConditionModifiers(["skill", "skill:" + SKILL, "check"])
      : [];
  }

  function collectFortitudeDCModifiers(target) {
    if (typeof target.getDCModifiers === "function") {
      return target.getDCModifiers(DEFENSE);
    }
    return typeof target.getConditionModifiers === "function"
      ? target.getConditionModifiers(["dc", "dc:" + DEFENSE])
      : [];
  }

  function resolveMapPenalty(attacker, agile) {
    if (typeof attacker.getMultipleAttackPenalty === "function") {
      return attacker.getMultipleAttackPenalty(agile);
    }
    const attacksMade = Number.isInteger(attacker.attacksThisTurn)
      ? attacker.attacksThisTurn
      : 0;
    return MultipleAttack.multipleAttackPenalty(attacksMade, agile);
  }

  function canSpendAction(combatant) {
    if (typeof combatant.canSpendActions === "function") {
      return combatant.canSpendActions(ACTION_COST);
    }
    return Number.isInteger(combatant.actionsRemaining)
      ? combatant.actionsRemaining >= ACTION_COST
      : false;
  }

  /**
   * Validation, reach/LoS/visibility, Athletics modifier, MAP, and Fortitude
   * DC without spending an action or rolling dice.
   *
   * @param {{
   *   attacker: object,
   *   target: object,
   *   map: object,
   *   combatants?: object[],
   *   allies?: object[],
   *   reachFeet?: number,
   *   agile?: boolean
   * }} options
   * @param {"shove"|"grapple"} [maneuver] hand-requirement trait to check
   * @returns {object}
   */
  function evaluate(options, maneuver) {
    const opts = options || {};
    const attacker = opts.attacker;
    const target = opts.target;

    assertCombatant(attacker, "attacker");
    assertCombatant(target, "target");

    if (attacker.isDefeated === true) {
      return { ok: false, reason: MANEUVER_REASONS.ATTACKER_DEFEATED };
    }

    // Shove and Grapple need one free hand unless the wielded weapon carries
    // the matching trait. This is checked before geometry/MAP so an illegal
    // action spends nothing.
    let handCheck = null;
    if (maneuver !== undefined && maneuver !== null) {
      handCheck = Equipment.checkManeuverHands(attacker, maneuver);
      if (!handCheck.ok) {
        return {
          ok: false,
          reason: MANEUVER_REASONS.NO_FREE_HAND,
          freeHands: handCheck.freeHands,
          handRequirement: handCheck,
        };
      }
    }

    // A maneuver can target a creature at most one size category larger than
    // the attacker (tiny 0 .. gargantuan 4). Checked before geometry/MAP so an
    // illegal attempt spends nothing.
    if (!Size.canManeuverTarget(attacker, target)) {
      return {
        ok: false,
        reason: MANEUVER_REASONS.TARGET_TOO_LARGE,
        attackerSize: Size.normalizeSize(attacker.size),
        targetSize: Size.normalizeSize(target.size),
        attackerSizeRank: Size.sizeRankOf(attacker),
        targetSizeRank: Size.sizeRankOf(target),
      };
    }

    // Strike validation supplies identity, alliance, reach, visibility, and
    // line-of-sight checks. It also computes cover/flanking, which are not
    // used by a Fortitude-DC maneuver but keep the geometry audit consistent.
    const evaluation = Strike.evaluateStrike(opts);
    if (!evaluation.ok) {
      return evaluation;
    }

    const agile = opts.agile === true;
    const skillBase = skillBaseOf(attacker);
    const skillModifiers = collectSkillModifiers(attacker);
    const mapPenalty = resolveMapPenalty(attacker, agile);

    const attackModifiers = skillModifiers.slice();
    if (mapPenalty !== 0) {
      attackModifiers.push({
        name: "MAP",
        type: Modifiers.MODIFIER_TYPES.UNTYPED,
        value: mapPenalty,
        source: "multiple-attack-penalty",
      });
    }
    const attackResolution = Modifiers.resolveModifiers(
      skillBase,
      attackModifiers,
    );

    const fortitudeBase = fortitudeBaseOf(target);
    const dcModifiers = collectFortitudeDCModifiers(target);
    const dcResolution = Checks.resolveDC(fortitudeBase, dcModifiers);

    return {
      ok: true,
      skill: SKILL,
      skillLabel: SKILL_LABEL,
      skillBase: skillBase,
      skillModifiers: skillModifiers,
      mapPenalty: mapPenalty,
      agile: agile,
      attackModifier: attackResolution.total,
      attackModifiers: attackResolution.effectiveModifiers,
      attackBreakdown: attackResolution.breakdown,
      defense: DEFENSE,
      defenseLabel: DEFENSE_LABEL,
      targetDCBaseValue: fortitudeBase,
      targetDCBase: 10 + fortitudeBase,
      targetDC: dcResolution.total,
      fortitudeDC: dcResolution.total,
      targetDCModifiers: dcResolution.effectiveModifiers,
      targetDCBreakdown: dcResolution.breakdown,
      distanceFeet: evaluation.distanceFeet,
      reachFeet: evaluation.reachFeet,
      visibility: evaluation.visibility || null,
      flatCheckDC: evaluation.flatCheckDC,
      flatCheckCondition: evaluation.flatCheckCondition,
      hiddenAttacker: evaluation.hiddenAttacker === true,
      attackerSize: Size.normalizeSize(attacker.size),
      targetSize: Size.normalizeSize(target.size),
      attackerSizeRank: Size.sizeRankOf(attacker),
      targetSizeRank: Size.sizeRankOf(target),
      cover: evaluation.cover || null,
      coverDegree: evaluation.coverDegree || "none",
      handRequirement:
        handCheck === null
          ? null
          : {
              ok: true,
              freeHands: handCheck.freeHands,
              viaTrait: handCheck.viaTrait,
            },
    };
  }

  function needsFlatCheck(evaluation) {
    return (
      evaluation.visibility !== null &&
      evaluation.visibility !== undefined &&
      evaluation.flatCheckCondition !== null &&
      evaluation.flatCheckCondition !== undefined &&
      evaluation.flatCheckDC !== null &&
      evaluation.flatCheckDC !== undefined
    );
  }

  function rollFlatCheck(options, evaluation) {
    if (!needsFlatCheck(evaluation)) {
      return null;
    }
    // Undetected is a targeting rule handled by evaluateStrike, not a flat
    // check. getVisibility exposes it with a null DC, so only Concealed/Hidden
    // reach this branch.
    return Strike.rollVisibilityFlatCheck(
      options,
      evaluation.flatCheckDC,
      evaluation.flatCheckCondition,
    );
  }

  function advanceMap(attacker) {
    attacker.spendActions(ACTION_COST);
    attacker.attacksThisTurn = Number.isInteger(attacker.attacksThisTurn)
      ? attacker.attacksThisTurn + 1
      : 1;
    return attacker.attacksThisTurn;
  }

  /**
   * Roll the shared maneuver check. The caller is responsible for spending the
   * action and advancing MAP after this returns, because a failed flat check
   * and a failed check both still cost the action.
   *
   * @param {object} options
   * @param {object} evaluation
   * @returns {{
   *   automaticMiss: boolean,
   *   flatCheck: object|null,
   *   d20: number|null,
   *   check: object|null
   * }}
   */
  function resolveCheck(options, evaluation) {
    const flatCheck = rollFlatCheck(options, evaluation);
    if (flatCheck !== null && !flatCheck.passed) {
      return {
        automaticMiss: true,
        flatCheck: flatCheck,
        d20: null,
        check: null,
      };
    }

    const d20 = Strike.rollAttack(options);
    const check = Checks.evaluateCheck({
      d20: d20,
      modifier: evaluation.attackModifier,
      dc: evaluation.targetDC,
    });

    return {
      automaticMiss: false,
      flatCheck: flatCheck,
      d20: d20,
      check: check,
    };
  }

  function mapAfter(attacker, agile) {
    return typeof attacker.getMultipleAttackPenalty === "function"
      ? attacker.getMultipleAttackPenalty(agile)
      : null;
  }

  return Object.freeze({
    ACTION_COST: ACTION_COST,
    SKILL: SKILL,
    SKILL_LABEL: SKILL_LABEL,
    DEFENSE: DEFENSE,
    DEFENSE_LABEL: DEFENSE_LABEL,
    MANEUVER_REASONS: MANEUVER_REASONS,
    assertCombatant: assertCombatant,
    canSpendAction: canSpendAction,
    evaluate: evaluate,
    resolveCheck: resolveCheck,
    advanceMap: advanceMap,
    mapAfter: mapAfter,
  });
});
