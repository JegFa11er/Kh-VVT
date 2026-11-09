/**
 * PF2E REMASTERED — REACTIVE STRIKE (HEADLESS CORE)
 *
 * Reactive Strike (formerly Attack of Opportunity) is a reaction:
 *   - it costs 1 reaction from the reactor's separate reaction pool;
 *   - it is a melee Strike against a creature within reach;
 *   - it never uses and never increases the reactor's Multiple Attack
 *     Penalty, so the attack always resolves at the full attack bonus;
 *   - attack and AC flow through the same modifier resolver as a normal Strike
 *     (conditions, flanking, and typed non-stacking rules).
 *
 * The trigger implemented in this slice is "leaves a threatened square during
 * a Stride". Step deliberately never triggers it. The host drives the trigger
 * scan from Stride; this module exposes the attack and the threatened-enemy
 * query.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Grid/grid-math.js"),
      require("../Grid/distance.js"),
      require("../Rules/checks.js"),
      require("../Rules/damage.js"),
      require("../Rules/modifiers.js"),
      require("../Rules/weapon-traits.js"),
      require("./strike.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.ReactiveStrike = factory(
      root.PF2e.Core.Grid,
      root.PF2e.Core.Distance3D,
      root.PF2e.Core.Rules.Checks,
      root.PF2e.Core.Rules.Damage,
      root.PF2e.Core.Rules.Modifiers,
      root.PF2e.Core.Rules.WeaponTraits,
      root.PF2e.Core.Actions.Strike,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Grid,
  Distance3D,
  Checks,
  Damage,
  Modifiers,
  WeaponTraits,
  Strike,
) {
  "use strict";

  const REACTIVE_STRIKE_REASONS = Object.freeze({
    NO_REACTION: "no-reaction",
  });

  const DEFAULT_REACH_FEET = Strike.DEFAULT_REACH_FEET;
  const DEFAULT_AC = Strike.DEFAULT_AC;
  const DEFAULT_ATTACK_BONUS = Strike.DEFAULT_ATTACK_BONUS;
  const DEFAULT_DAMAGE = Strike.DEFAULT_DAMAGE;

  function assertInteger(value, label) {
    if (!Number.isInteger(value)) {
      throw new TypeError(label + " must be an integer; received " + String(value) + ".");
    }
  }

  function assertCell(cell, label) {
    if (
      cell === null ||
      typeof cell !== "object" ||
      !Number.isInteger(cell.x) ||
      !Number.isInteger(cell.y)
    ) {
      throw new TypeError(label + " must be a cell object { x, y }.");
    }
  }

  function normalizeReach(reachFeet) {
    const reach = reachFeet === undefined ? DEFAULT_REACH_FEET : reachFeet;
    if (!Number.isInteger(reach) || reach <= 0 || reach % 5 !== 0) {
      throw new RangeError("reachFeet must be a positive multiple of 5.");
    }
    return reach;
  }

  /**
   * Per-creature threatened reach. An explicit override (used by tests and
   * special effects) applies to every candidate; otherwise each creature uses
   * its own weapon reach, including the `reach` trait.
   *
   * @param {object} combatant
   * @param {number} [overrideFeet]
   * @returns {number}
   */
  function reachOf(combatant, overrideFeet) {
    if (overrideFeet !== undefined) {
      return normalizeReach(overrideFeet);
    }
    if (typeof combatant.getReachFeet === "function") {
      return normalizeReach(combatant.getReachFeet());
    }
    if (combatant.traits !== undefined) {
      return normalizeReach(WeaponTraits.getReachFeet(combatant.traits));
    }
    return DEFAULT_REACH_FEET;
  }

  function isDefeated(unit) {
    return unit.isDefeated === true || unit.currentHP === 0;
  }

  function sameCreature(a, b) {
    if (a === b) {
      return true;
    }
    return a.id !== undefined && b.id !== undefined && a.id === b.id;
  }

  /**
   * Only explicitly authored alliances establish that two combatants are on
   * the same side. Isolated headless fixtures that omit `alliance` both fall
   * back to "player" but are not allies.
   */
  function sameAlliance(a, b) {
    if (!a || !b || a.alliance === undefined || b.alliance === undefined) {
      return false;
    }
    if (a.alliance !== b.alliance) {
      return false;
    }
    return a.allianceExplicit !== false && b.allianceExplicit !== false;
  }

  function normalizeAttackBonus(options, attacker) {
    if (options.attackBonus !== undefined) {
      assertInteger(options.attackBonus, "attackBonus");
      return options.attackBonus;
    }
    return Number.isInteger(attacker.attackBonus)
      ? attacker.attackBonus
      : DEFAULT_ATTACK_BONUS;
  }

  function normalizeTargetAC(options, target) {
    if (options.targetAC !== undefined) {
      assertInteger(options.targetAC, "targetAC");
      return options.targetAC;
    }
    return Number.isInteger(target.ac) ? target.ac : DEFAULT_AC;
  }

  function normalizeDamageSpec(options, attacker) {
    return Strike.normalizeDamageSpec(options, attacker);
  }

  function normalizeCombatants(options) {
    if (Array.isArray(options.combatants)) {
      return options.combatants;
    }
    if (Array.isArray(options.allies)) {
      return options.allies;
    }
    return [];
  }

  /**
   * Enemies that currently threaten `cell` and still have a reaction. Results
   * keep the roster order, which makes the auto-trigger deterministic.
   *
   * @param {{
   *   mover: object,
   *   cell: {x:number,y:number},
   *   combatants: object[],
   *   reachFeet?: number
   * }} options
   * @returns {object[]}
   */
  function findThreatenedEnemies(options) {
    const opts = options || {};
    assertCell(opts.cell, "cell");
    if (!opts.mover || typeof opts.mover !== "object") {
      throw new TypeError("findThreatenedEnemies requires a mover.");
    }
    if (!Array.isArray(opts.combatants)) {
      throw new TypeError("findThreatenedEnemies requires a combatants array.");
    }

    const overrideReach = opts.reachFeet;
    const threats = [];

    // The mover may itself be Large/Huge: measure from every cell it would
    // occupy at the departure square, not only from its anchor cell.
    const moverCells = Grid.getFootprintCells(
      opts.cell.x,
      opts.cell.y,
      Grid.footprintOf(opts.mover),
    );
    const moverAtCell = {
      x: opts.cell.x,
      y: opts.cell.y,
      getOccupiedCells: function () {
        return moverCells;
      },
    };

    for (const candidate of opts.combatants) {
      if (candidate === null || typeof candidate !== "object") {
        continue;
      }
      if (sameCreature(candidate, opts.mover)) {
        continue;
      }
      if (isDefeated(candidate)) {
        continue;
      }
      if (sameAlliance(candidate, opts.mover)) {
        continue;
      }
      if (
        typeof candidate.canSpendReaction !== "function" ||
        !candidate.canSpendReaction(1)
      ) {
        continue;
      }
      if (!Number.isInteger(candidate.x) || !Number.isInteger(candidate.y)) {
        continue;
      }
      // Reach-aware distance: a 10-ft reach also threatens the second
      // diagonal square, which the raw 5-10-5 distance reports as 15 ft.
      const candidateReach = reachOf(candidate, overrideReach);
      if (!Distance3D.canReach(moverAtCell, candidate, candidateReach)) {
        continue;
      }
      threats.push(candidate);
    }

    return threats;
  }

  /**
   * @param {{
   *   attacker: object,
   *   target: object,
   *   map: object,
   *   reachFeet?: number,
   *   attackBonus?: number,
   *   targetAC?: number,
   *   damage?: string,
   *   combatants?: object[],
   *   allies?: object[],
   *   rollD20?: () => number,
   *   rollDamageDie?: (sides: number) => number,
   *   rollDie?: (sides: number) => number
   * }} options
   * @returns {object}
   */
  function performReactiveStrike(options) {
    const opts = options || {};
    const attacker = opts.attacker;
    const target = opts.target;

    if (!attacker || typeof attacker.canSpendReaction !== "function") {
      throw new TypeError(
        "Reactive Strike requires a Combatant with a reaction pool.",
      );
    }

    if (!attacker.canSpendReaction(1)) {
      return {
        ok: false,
        reason: REACTIVE_STRIKE_REASONS.NO_REACTION,
        attackerId: attacker.id,
        attackerName: attacker.name,
        targetId: target && target.id,
        targetName: target && target.name,
        reactionSpent: false,
      };
    }

    // Strike validation covers the target, alliance, reach, and line of sight.
    const evaluation = Strike.evaluateStrike(opts);
    if (!evaluation.ok) {
      return {
        ok: false,
        reason: evaluation.reason,
        distanceFeet: evaluation.distanceFeet,
        blockedBy: evaluation.blockedBy,
        attackerId: attacker.id,
        attackerName: attacker.name,
        targetId: target && target.id,
        targetName: target && target.name,
        reactionSpent: false,
      };
    }

    const attackBonus = normalizeAttackBonus(opts, attacker);
    const targetAC = normalizeTargetAC(opts, target);
    const weaponSpec = Strike.normalizeWeaponSpec(opts, attacker);
    const flanked = evaluation.flanked === true;
    const hiddenAttacker = evaluation.hiddenAttacker === true;
    const offGuard = evaluation.offGuard === true;
    const visibility = evaluation.visibility || { condition: null };
    const flatCheckDC =
      evaluation.flatCheckDC === undefined
        ? visibility.flatCheckDC
        : evaluation.flatCheckDC;
    const flatCheckCondition =
      evaluation.flatCheckCondition === undefined
        ? visibility.condition
        : evaluation.flatCheckCondition;

    // Concealment and Hidden resolve before the attack roll. A failed check
    // still spends the reaction, but the reaction never touches MAP.
    let flatCheck = null;
    if (flatCheckCondition && flatCheckDC !== null && flatCheckDC !== undefined) {
      flatCheck = Strike.rollVisibilityFlatCheck(
        opts,
        flatCheckDC,
        flatCheckCondition,
      );

      if (!flatCheck.passed) {
        attacker.spendReaction(1, {
          type: "reactive-strike",
          trigger: "leave-threatened-square",
          targetId: target.id,
          targetName: target.name,
          automaticMiss: true,
        });
        const reveal = Strike.resolveHostileReveal(attacker);
        return {
          ok: true,
          automaticMiss: true,
          revealed: reveal.revealed,
          revealedConditions: reveal.revealedConditions,
          visibilityAfter: reveal.visibilityAfter,
          reaction: true,
          reactionTrigger: "leave-threatened-square",
          reactionSpent: true,
          attackerId: attacker.id,
          attackerName: attacker.name,
          targetId: target.id,
          targetName: target.name,
          flatCheck: flatCheck,
          visibility: visibility,
          hiddenAttacker: hiddenAttacker,
          attackRoll: null,
          attackBonus: attackBonus,
          baseAttackBonus: attackBonus,
          attackModifier: null,
          mapPenalty: 0,
          multipleAttackPenalty: 0,
          total: null,
          attackTotal: null,
          dc: null,
          targetAC: null,
          targetACBase: targetAC,
          degree: null,
          hit: false,
          isHit: false,
          critical: false,
          isCritical: false,
          damage: null,
          iwr: null,
          damageDealt: 0,
          damageAmount: 0,
          damageTotal: 0,
          hpDamage: 0,
          hpBefore: null,
          hpAfter: null,
          targetMaxHP: Number.isInteger(target.maxHP) ? target.maxHP : null,
          targetDefeated: target.isDefeated === true,
          attacksThisTurn: attacker.attacksThisTurn,
          actionsLeft: attacker.actionsRemaining,
          reactionsLeft: attacker.reactionsRemaining,
        };
      }
    }

    // Reactive Strike ignores the attacker's current MAP entirely: no penalty
    // is applied and attacksThisTurn is not incremented afterwards.
    const attackModifiers = Strike.collectAttackModifiers(attacker, 0);
    const attackResolution = Modifiers.resolveModifiers(
      attackBonus,
      attackModifiers,
    );
    const defenseModifiers = Strike.collectDefenseModifiers(
      target,
      flanked,
      evaluation.cover || null,
      hiddenAttacker,
    );
    const defenseResolution = Modifiers.resolveModifiers(
      targetAC,
      defenseModifiers,
    );

    const d20 = Strike.rollAttack(opts);
    const check = Checks.evaluateCheck({
      d20: d20,
      modifier: attackResolution.total,
      dc: defenseResolution.total,
    });

    const hit =
      check.degree === Checks.DEGREES.SUCCESS ||
      check.degree === Checks.DEGREES.CRITICAL_SUCCESS;
    const critical = check.degree === Checks.DEGREES.CRITICAL_SUCCESS;

    let damage = null;
    if (hit) {
      if (typeof target.takeDamage !== "function") {
        throw new TypeError(
          "Reactive Strike target must implement takeDamage(amount).",
        );
      }
      damage = WeaponTraits.calculateWeaponDamage({
        weapon: weaponSpec,
        degree: check.degree,
        isOffGuard: offGuard,
        rollDamageDie: Strike.resolveDamageDie(opts),
      });
    }

    // Spend the reaction only after every validation and roll succeeded.
    // No action is spent and MAP is neither used nor advanced.
    attacker.spendReaction(1, {
      type: "reactive-strike",
      trigger: "leave-threatened-square",
      targetId: target.id,
      targetName: target.name,
    });

    let hpBefore = null;
    let hpAfter = null;
    let targetDefeated = target.isDefeated === true;
    let damageDealt = 0;
    let hpDamage = 0;
    let iwr = null;

    if (hit) {
      hpBefore = Number.isInteger(target.currentHP) ? target.currentHP : null;
      const applied = target.takeDamage(damage.total, {
        type: damage.type,
      });
      iwr = applied.iwr || null;
      damageDealt =
        applied.damageApplied === undefined
          ? damage.total
          : applied.damageApplied;
      hpDamage = applied.damageTaken;
      hpAfter = applied.currentHP;
      targetDefeated = applied.isDefeated;
    }

    const reveal = Strike.resolveHostileReveal(attacker);

    return {
      ok: true,
      revealed: reveal.revealed,
      revealedConditions: reveal.revealedConditions,
      visibilityAfter: reveal.visibilityAfter,
      reaction: true,
      reactionTrigger: "leave-threatened-square",
      reactionSpent: true,
      attackerId: attacker.id,
      attackerName: attacker.name,
      targetId: target.id,
      targetName: target.name,
      distanceFeet: evaluation.distanceFeet,
      reachFeet: evaluation.reachFeet,
      flatCheck: flatCheck,
      visibility: visibility,
      hiddenAttacker: hiddenAttacker,
      attackRoll: d20,
      attackBonus: attackBonus,
      baseAttackBonus: attackBonus,
      attackModifier: attackResolution.total,
      attackModifiers: attackResolution.effectiveModifiers,
      attackBreakdown: attackResolution.breakdown,
      mapPenalty: 0,
      multipleAttackPenalty: 0,
      total: check.total,
      attackTotal: check.total,
      dc: defenseResolution.total,
      targetAC: defenseResolution.total,
      targetACTotal: defenseResolution.total,
      targetACBase: targetAC,
      baseTargetAC: targetAC,
      targetACModifiers: defenseResolution.effectiveModifiers,
      defenseModifiers: defenseResolution.effectiveModifiers,
      targetACSuppressedModifiers: defenseResolution.suppressedModifiers,
      suppressedACModifiers: defenseResolution.suppressedModifiers,
      targetACBreakdown: defenseResolution.breakdown,
      defenseBreakdown: defenseResolution.breakdown,
      cover: evaluation.cover || null,
      coverDegree: evaluation.coverDegree || "none",
      coverBonus: evaluation.coverBonus || 0,
      coverRays: evaluation.coverRays || [],
      blockedRaysCount: evaluation.blockedRaysCount || 0,
      flanked: flanked,
      flankers: evaluation.flankers || [],
      offGuard: evaluation.offGuard === true,
      degree: check.degree,
      isNatural20: check.isNatural20,
      isNatural1: check.isNatural1,
      hit: hit,
      isHit: hit,
      critical: critical,
      isCritical: critical,
      attack: {
        d20: check.d20,
        attackBonus: attackBonus,
        baseAttackBonus: attackBonus,
        attackModifier: attackResolution.total,
        modifiers: attackResolution.effectiveModifiers,
        breakdown: attackResolution.breakdown,
        mapPenalty: 0,
        modifier: check.modifier,
        total: check.total,
        dc: check.dc,
        degree: check.degree,
        isNatural20: check.isNatural20,
        isNatural1: check.isNatural1,
      },
      damage: damage,
      iwr: iwr,
      damageDealt: damageDealt,
      damageAmount: damageDealt,
      damageTotal: damageDealt,
      hpDamage: hpDamage,
      hpBefore: hpBefore,
      hpAfter: hpAfter,
      targetMaxHP: Number.isInteger(target.maxHP) ? target.maxHP : null,
      targetDefeated: targetDefeated,
      attacksThisTurn: attacker.attacksThisTurn,
      actionsLeft: attacker.actionsRemaining,
      reactionsLeft: attacker.reactionsRemaining,
    };
  }

  return Object.freeze({
    REACTIVE_STRIKE_REASONS: REACTIVE_STRIKE_REASONS,
    DEFAULT_REACH_FEET: DEFAULT_REACH_FEET,
    findThreatenedEnemies: findThreatenedEnemies,
    performReactiveStrike: performReactiveStrike,
  });
});
