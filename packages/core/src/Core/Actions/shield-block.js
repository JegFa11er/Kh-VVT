/**
 * PF2E REMASTERED — SHIELD BLOCK REACTION (HEADLESS CORE)
 *
 * Trigger: the wielder takes physical damage (bludgeoning/piercing/slashing)
 * after a hit while a shield is raised and at least one reaction remains.
 *
 * Remastered resolution:
 *   1. Hardness reduces the incoming damage;
 *   2. the remainder is dealt simultaneously to the shield and the wielder;
 *   3. one reaction is spent;
 *   4. if the shield reaches its Broken Threshold (or 0 HP) it breaks and
 *      Shield Raised is removed immediately.
 *
 * This wrapper delegates to `Combatant.takeDamage(damage, { shieldBlock: true })`
 * so IWR, shield durability, and the wielder's HP all resolve in one place.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../Entities/shield.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.ShieldBlock = factory(root.PF2e.Core.Shield);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Shield) {
  "use strict";

  const ACTION_COST = 0; // Shield Block is a reaction, not an action.
  const REACTION_COST = 1;

  const SHIELD_BLOCK_REASONS = Shield.SHIELD_REASONS;

  function assertCombatant(combatant) {
    if (combatant === null || typeof combatant !== "object") {
      throw new TypeError("Shield Block requires a Combatant.");
    }
    if (typeof combatant.takeDamage !== "function") {
      throw new TypeError("Shield Block requires a Combatant with takeDamage().");
    }
    if (typeof combatant.canShieldBlock !== "function") {
      throw new TypeError("Shield Block requires a Combatant with a shield state.");
    }
  }

  /**
   * Validate the reaction without rolling or mutating state.
   *
   * @param {object} combatant
   * @param {{damage?:number,damageType?:string,type?:string}} [options]
   * @returns {{ok:boolean,reason?:string,shield?:object}}
   */
  function canShieldBlock(combatant, options) {
    assertCombatant(combatant);
    return Shield.canShieldBlock(combatant, options);
  }

  /**
   * Perform Shield Block.
   *
   * @param {{
   *   combatant: object,
   *   damage: number,
   *   damageType?: string,
   *   type?: string,
   *   isCrit?: boolean,
   *   applyIWR?: boolean
   * }} options
   * @returns {object}
   */
  function performShieldBlock(options) {
    const opts = options || {};
    const combatant = opts.combatant;
    assertCombatant(combatant);

    const damage = opts.damage;
    if (!Number.isInteger(damage) || damage < 0) {
      throw new RangeError("Shield Block damage must be a non-negative integer.");
    }
    const damageType =
      opts.damageType === undefined
        ? opts.type === undefined
          ? "untyped"
          : opts.type
        : opts.damageType;

    const eligibility = Shield.canShieldBlock(combatant, {
      damage: damage,
      damageType: damageType,
    });
    if (!eligibility.ok) {
      return {
        ok: false,
        reason: eligibility.reason,
        reactionSpent: false,
        reactionsLeft: Number.isInteger(combatant.reactionsRemaining)
          ? combatant.reactionsRemaining
          : 0,
        shield: eligibility.shield || null,
      };
    }

    const applied = combatant.takeDamage(damage, {
      type: damageType,
      shieldBlock: true,
      isCrit: opts.isCrit === true,
      applyIWR: opts.applyIWR,
    });

    const report = applied.shieldBlock;
    if (!report || report.ok !== true) {
      return {
        ok: false,
        reason: report && report.reason ? report.reason : "shield-block-failed",
        reactionSpent: false,
        reactionsLeft: Number.isInteger(combatant.reactionsRemaining)
          ? combatant.reactionsRemaining
          : 0,
        shield: eligibility.shield,
        actorDamage: applied,
      };
    }

    return {
      ok: true,
      actionCost: ACTION_COST,
      reactionCost: REACTION_COST,
      reactionSpent: true,
      reactionsLeft: report.reactionsLeft,
      absorbedByHardness: report.absorbedByHardness,
      damageToShield: report.damageToShield,
      damageToActor: report.damageToActor,
      shieldBroken: report.shieldBroken,
      shieldDestroyed: report.shieldDestroyed,
      shieldJustBroken: report.shieldJustBroken,
      shieldJustDestroyed: report.shieldJustDestroyed,
      shieldRaisedRemoved: report.shieldRaisedRemoved,
      hardness: report.hardness,
      shieldHpBefore: report.shieldHpBefore,
      shieldHpAfter: report.shieldHpAfter,
      shield: report.shield,
      shieldState: Shield.getShieldState(report.shield),
      damage: damage,
      damageType: damageType,
      baseDamage: applied.baseDamage,
      damageTaken: applied.damageTaken,
      actorDamageApplied: applied.actorDamageApplied,
      currentHP: applied.currentHP,
      isDefeated: applied.isDefeated,
      iwr: applied.iwr,
      actorDamage: applied,
    };
  }

  return Object.freeze({
    ACTION_COST: ACTION_COST,
    REACTION_COST: REACTION_COST,
    SHIELD_BLOCK_REASONS: SHIELD_BLOCK_REASONS,
    canShieldBlock: canShieldBlock,
    performShieldBlock: performShieldBlock,
  });
});
