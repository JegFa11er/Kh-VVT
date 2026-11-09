/**
 * PF2E REMASTERED — TRIP ACTION (HEADLESS CORE)
 *
 * Trip is a 1-action skill action with the `attack` trait:
 *   - it uses Athletics against the target's Reflex DC (`10 + Reflex + mods`);
 *   - it uses and advances the Multiple Attack Penalty;
 *   - it requires melee reach and line of sight;
 *   - Critical Success: the target falls prone and takes 1d6 bludgeoning;
 *   - Success: the target falls prone;
 *   - Critical Failure: the attacker loses balance and falls prone.
 *
 * The check, the target DC, and the critical damage all flow through the same
 * pipelines as Strike:
 *   - `Modifiers.resolveModifiers` for attack and DC math;
 *   - `Checks.evaluateCheck` for the four degrees of success;
 *   - `Damage.rollDamage` for the 1d6 bludgeoning die;
 *   - `Combatant.takeDamage(amount, { type })` for the target's IWR.
 *
 * Requirements that need data this engine does not model (a free hand and the
 * target's size category) are intentionally not enforced in this slice.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Rules/checks.js"),
      require("../Rules/damage.js"),
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
    root.PF2e.Core.Actions.Trip = factory(
      root.PF2e.Core.Rules.Checks,
      root.PF2e.Core.Rules.Damage,
      root.PF2e.Core.Rules.MultipleAttack,
      root.PF2e.Core.Rules.Modifiers,
      root.PF2e.Core.Actions.Strike,
      root.PF2e.Core.Equipment,
      root.PF2e.Core.Rules.Size,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Checks,
  Damage,
  MultipleAttack,
  Modifiers,
  Strike,
  Equipment,
  Size,
) {
  "use strict";

  const TRIP_REASONS = Object.freeze({
    NO_ACTIONS: "no-actions",
    ATTACKER_DEFEATED: "attacker-defeated",
    TARGET_DEFEATED: "target-defeated",
    NO_FREE_HAND: "no-free-hand",
    TARGET_TOO_LARGE: "target-too-large",
  });

  const ACTION_COST = 1;
  const SKILL = "athletics";
  const SKILL_LABEL = "Athletics";
  const DEFENSE = "reflex";
  const DEFENSE_LABEL = "Reflex DC";
  const PRONE = "prone";
  const CRITICAL_DAMAGE_FORMULA = "1d6";
  const CRITICAL_DAMAGE_TYPE = "bludgeoning";

  function skillsOf(combatant) {
    return combatant && combatant.skills && typeof combatant.skills === "object"
      ? combatant.skills
      : {};
  }

  function savesOf(combatant) {
    return combatant && combatant.saves && typeof combatant.saves === "object"
      ? combatant.saves
      : {};
  }

  function skillBaseOf(attacker) {
    const value = skillsOf(attacker)[SKILL];
    return Number.isInteger(value) ? value : 0;
  }

  function reflexBaseOf(target) {
    const value = savesOf(target)[DEFENSE];
    return Number.isInteger(value) ? value : 0;
  }

  function collectSkillModifiers(attacker) {
    if (typeof attacker.getSkillModifiers === "function") {
      // Trip has the attack trait for MAP, but the roll is an Athletics skill
      // check, not an attack roll. Prone's -2 attack penalty therefore does not
      // apply; Frightened still does.
      return attacker.getSkillModifiers(SKILL);
    }
    return typeof attacker.getConditionModifiers === "function"
      ? attacker.getConditionModifiers(["skill", "skill:" + SKILL, "check"])
      : [];
  }

  function collectReflexDCModifiers(target, cover) {
    if (typeof target.getDCModifiers === "function") {
      return target.getDCModifiers(DEFENSE, { cover: cover });
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

  function resolveCover(options, evaluation) {
    if (options.cover !== undefined) {
      return options.cover;
    }
    return evaluation.cover || null;
  }

  /**
   * Validation and math without spending an action, rolling the d20, or
   * mutating either combatant. Used by `performTrip` and the View hover.
   *
   * @param {{
   *   attacker: object,
   *   target: object,
   *   map: object,
   *   combatants?: object[],
   *   allies?: object[],
   *   reachFeet?: number,
   *   agile?: boolean,
   *   cover?: object|string|null
   * }} options
   * @returns {object}
   */
  function evaluateTrip(options) {
    const opts = options || {};
    const attacker = opts.attacker;
    const target = opts.target;

    if (!attacker || typeof attacker !== "object") {
      throw new TypeError("Trip requires an attacker.");
    }
    if (!target || typeof target !== "object") {
      throw new TypeError("Trip requires a target.");
    }

    if (attacker.isDefeated === true) {
      return { ok: false, reason: TRIP_REASONS.ATTACKER_DEFEATED };
    }

    // Trip needs one free hand unless the wielded weapon has the trip trait.
    const handCheck = Equipment.checkManeuverHands(attacker, "trip");
    if (!handCheck.ok) {
      return {
        ok: false,
        reason: TRIP_REASONS.NO_FREE_HAND,
        freeHands: handCheck.freeHands,
        handRequirement: handCheck,
      };
    }

    // Trip cannot target a creature more than one size category larger.
    if (!Size.canManeuverTarget(attacker, target)) {
      return {
        ok: false,
        reason: TRIP_REASONS.TARGET_TOO_LARGE,
        attackerSize: Size.normalizeSize(attacker.size),
        targetSize: Size.normalizeSize(target.size),
        attackerSizeRank: Size.sizeRankOf(attacker),
        targetSizeRank: Size.sizeRankOf(target),
      };
    }

    // Strike validation covers target identity, alliance, reach, visibility,
    // and line of sight. Trip adds no separate geometry of its own.
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

    const cover = resolveCover(opts, evaluation);
    const reflexBase = reflexBaseOf(target);
    const dcModifiers = collectReflexDCModifiers(target, cover);
    const dcResolution = Checks.resolveDC(reflexBase, dcModifiers);

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
      targetDCBaseValue: reflexBase,
      targetDCBase: 10 + reflexBase,
      targetDC: dcResolution.total,
      reflexDC: dcResolution.total,
      targetDCModifiers: dcResolution.effectiveModifiers,
      targetDCBreakdown: dcResolution.breakdown,
      cover: cover,
      coverDegree: cover && cover.degree ? cover.degree : "none",
      distanceFeet: evaluation.distanceFeet,
      reachFeet: evaluation.reachFeet,
      flanked: evaluation.flanked === true,
      visibility: evaluation.visibility || null,
      flatCheckDC: evaluation.flatCheckDC,
      flatCheckCondition: evaluation.flatCheckCondition,
      hiddenAttacker: evaluation.hiddenAttacker === true,
      attackerSize: Size.normalizeSize(attacker.size),
      targetSize: Size.normalizeSize(target.size),
      attackerSizeRank: Size.sizeRankOf(attacker),
      targetSizeRank: Size.sizeRankOf(target),
      handRequirement: {
        ok: true,
        freeHands: handCheck.freeHands,
        viaTrait: handCheck.viaTrait,
      },
    };
  }

  /**
   * @param {{
   *   attacker: object,
   *   target: object,
   *   map: object,
   *   combatants?: object[],
   *   allies?: object[],
   *   reachFeet?: number,
   *   agile?: boolean,
   *   cover?: object|string|null,
   *   damage?: string,
   *   rollD20?: () => number,
   *   rollDamageDie?: (sides:number) => number,
   *   rollDie?: (sides:number) => number
   * }} options
   * @returns {object}
   */
  function performTrip(options) {
    const opts = options || {};
    const attacker = opts.attacker;
    const target = opts.target;

    if (!attacker || typeof attacker.canSpendActions !== "function") {
      throw new TypeError("Trip requires a Combatant with an action pool.");
    }

    if (!canSpendAction(attacker)) {
      return { ok: false, reason: TRIP_REASONS.NO_ACTIONS };
    }

    const evaluation = evaluateTrip(opts);
    if (!evaluation.ok) {
      return evaluation;
    }

    if (target.isDefeated === true) {
      return { ok: false, reason: TRIP_REASONS.TARGET_DEFEATED };
    }

    // Trip targets a creature, so Concealed/Hidden still impose their flat
    // check before the Athletics roll. A failure spends the action and advances
    // MAP but produces no check and no Prone.
    let flatCheck = null;
    if (
      evaluation.visibility &&
      evaluation.flatCheckCondition &&
      evaluation.flatCheckDC !== null &&
      evaluation.flatCheckDC !== undefined
    ) {
      flatCheck = Strike.rollVisibilityFlatCheck(
        opts,
        evaluation.flatCheckDC,
        evaluation.flatCheckCondition,
      );

      if (!flatCheck.passed) {
        attacker.spendActions(ACTION_COST);
        attacker.attacksThisTurn = Number.isInteger(attacker.attacksThisTurn)
          ? attacker.attacksThisTurn + 1
          : 1;
        return {
          ok: true,
          automaticMiss: true,
          actionCost: ACTION_COST,
          attackerId: attacker.id,
          attackerName: attacker.name,
          targetId: target.id,
          targetName: target.name,
          skill: SKILL,
          skillLabel: SKILL_LABEL,
          skillBase: evaluation.skillBase,
          skillModifiers: evaluation.skillModifiers,
          flatCheck: flatCheck,
          visibility: evaluation.visibility,
          attackRoll: null,
          attackBonus: evaluation.skillBase,
          attackModifier: evaluation.attackModifier,
          mapPenalty: evaluation.mapPenalty,
          multipleAttackPenalty: evaluation.mapPenalty,
          total: null,
          dc: evaluation.reflexDC,
          targetDC: evaluation.reflexDC,
          reflexDC: evaluation.reflexDC,
          targetDCBaseValue: evaluation.targetDCBaseValue,
          targetDCBase: evaluation.targetDCBase,
          targetDCModifiers: evaluation.targetDCModifiers,
          degree: null,
          success: false,
          hit: false,
          critical: false,
          targetProne: false,
          attackerProne: false,
          damage: null,
          iwr: null,
          damageDealt: 0,
          hpDamage: 0,
          hpBefore: null,
          hpAfter: null,
          targetDefeated: target.isDefeated === true,
          attacksThisTurn: attacker.attacksThisTurn,
          mapAfter:
            typeof attacker.getMultipleAttackPenalty === "function"
              ? attacker.getMultipleAttackPenalty(evaluation.agile)
              : null,
          actionsLeft: attacker.actionsRemaining,
        };
      }
    }

    const d20 = Strike.rollAttack(opts);
    const check = Checks.evaluateCheck({
      d20: d20,
      modifier: evaluation.attackModifier,
      dc: evaluation.reflexDC,
    });

    const critical =
      check.degree === Checks.DEGREES.CRITICAL_SUCCESS;
    const success =
      critical || check.degree === Checks.DEGREES.SUCCESS;
    const targetProne = success;
    const attackerProne =
      check.degree === Checks.DEGREES.CRITICAL_FAILURE;

    // The attack trait advances MAP after the check, including a miss.
    attacker.spendActions(ACTION_COST);
    attacker.attacksThisTurn = Number.isInteger(attacker.attacksThisTurn)
      ? attacker.attacksThisTurn + 1
      : 1;

    let condition = null;
    let damage = null;
    let iwr = null;
    let damageDealt = 0;
    let hpDamage = 0;
    let hpBefore = null;
    let hpAfter = null;
    let targetDefeated = target.isDefeated === true;

    if (targetProne) {
      condition = target.addCondition(PRONE);
    }

    if (critical) {
      if (typeof target.takeDamage !== "function") {
        throw new TypeError("Trip target must implement takeDamage(amount).");
      }

      const damageSpec = Damage.parseDamageSpec(
        opts.damage === undefined ? CRITICAL_DAMAGE_FORMULA : opts.damage,
        CRITICAL_DAMAGE_TYPE,
      );
      const rolled = Damage.rollDamage({
        formula: damageSpec.formula,
        type: CRITICAL_DAMAGE_TYPE,
        rollDie: Strike.resolveDamageDie(opts),
      });
      damage = Object.assign({}, rolled, {
        type: CRITICAL_DAMAGE_TYPE,
        source: "trip",
      });

      hpBefore = Number.isInteger(target.currentHP) ? target.currentHP : null;
      const applied = target.takeDamage(damage.total, {
        type: CRITICAL_DAMAGE_TYPE,
      });
      iwr = applied.iwr || null;
      damageDealt =
        applied.damageApplied === undefined
          ? damage.total
          : applied.damageApplied;
      hpDamage = applied.damageTaken;
      hpAfter = applied.currentHP;
      targetDefeated = applied.isDefeated;
    } else if (attackerProne) {
      targetDefeated = target.isDefeated === true;
    }

    if (attackerProne) {
      attacker.addCondition(PRONE);
    }

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
      reflexDC: evaluation.reflexDC,
      targetDCBaseValue: evaluation.targetDCBaseValue,
      targetDCBase: evaluation.targetDCBase,
      targetDCModifiers: evaluation.targetDCModifiers,
      targetDCBreakdown: evaluation.targetDCBreakdown,
      defense: evaluation.defense,
      defenseLabel: evaluation.defenseLabel,
      cover: evaluation.cover,
      coverDegree: evaluation.coverDegree,
      distanceFeet: evaluation.distanceFeet,
      reachFeet: evaluation.reachFeet,
      flatCheck: flatCheck,
      visibility: evaluation.visibility,
      hiddenAttacker: evaluation.hiddenAttacker,
      degree: check.degree,
      isNatural20: check.isNatural20,
      isNatural1: check.isNatural1,
      success: success,
      critical: critical,
      hit: success,
      isHit: success,
      targetProne: targetProne,
      attackerProne: attackerProne,
      proneAppliedTo: targetProne ? target.id : attackerProne ? attacker.id : null,
      condition: condition,
      damage: damage,
      iwr: iwr,
      damageDealt: damageDealt,
      damageAmount: damageDealt,
      hpDamage: hpDamage,
      hpBefore: hpBefore,
      hpAfter: hpAfter,
      targetMaxHP: Number.isInteger(target.maxHP) ? target.maxHP : null,
      targetDefeated: targetDefeated,
      attacksThisTurn: attacker.attacksThisTurn,
      mapAfter:
        typeof attacker.getMultipleAttackPenalty === "function"
          ? attacker.getMultipleAttackPenalty(evaluation.agile)
          : null,
      actionsLeft: attacker.actionsRemaining,
    };
  }

  return Object.freeze({
    TRIP_REASONS: TRIP_REASONS,
    ACTION_COST: ACTION_COST,
    SKILL: SKILL,
    DEFENSE: DEFENSE,
    PRONE: PRONE,
    CRITICAL_DAMAGE_FORMULA: CRITICAL_DAMAGE_FORMULA,
    CRITICAL_DAMAGE_TYPE: CRITICAL_DAMAGE_TYPE,
    evaluateTrip: evaluateTrip,
    performTrip: performTrip,
  });
});
