/**
 * PF2E REMASTERED — SHIELD, HARDNESS & BROKEN STATE (HEADLESS CORE)
 *
 * Shield record:
 *   { id, name, type: "shield", hands: 1, hardness, hp, maxHP,
 *     brokenThreshold, acBonus, speedPenalty, broken, destroyed }
 *
 * Remastered durability rules implemented here:
 *   - a shield is Broken when `hp <= brokenThreshold` (the threshold defaults
 *     to half of max HP, rounded down);
 *   - a shield is Destroyed when `hp <= 0`;
 *   - a Broken/Destroyed shield grants no AC bonus and cannot Shield Block;
 *   - Shield Block reduces incoming physical damage by Hardness, then the
 *     remainder damages the shield and the wielder simultaneously.
 *
 * This module owns the pure shield math. `Actions/shield-block.js` is the thin
 * action wrapper, and `Combatant.takeDamage(..., { shieldBlock: true })` calls
 * `resolveShieldBlock` directly so every damage path shares one implementation.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./equipment.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Shield = factory(root.PF2e.Core.Equipment);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Equipment) {
  "use strict";

  const SHIELD_DEFAULTS = Object.freeze({
    hardness: 5,
    maxHP: 20,
    acBonus: 2,
    speedPenalty: 0,
  });

  const PHYSICAL_DAMAGE_TYPES = Object.freeze([
    "bludgeoning",
    "piercing",
    "slashing",
  ]);

  const SHIELD_REASONS = Object.freeze({
    NO_SHIELD: "no-shield",
    NO_SHIELD_HELD: "shield-not-held",
    SHIELD_BROKEN: "shield-broken",
    SHIELD_DESTROYED: "shield-destroyed",
    SHIELD_NOT_RAISED: "shield-not-raised",
    NO_REACTION: "no-reaction",
    NON_PHYSICAL_DAMAGE: "non-physical-damage",
    NO_DAMAGE: "no-damage",
  });

  function isPhysicalDamageType(type) {
    if (typeof type !== "string") {
      return false;
    }
    return PHYSICAL_DAMAGE_TYPES.indexOf(type.trim().toLowerCase()) !== -1;
  }

  function assertInteger(value, label, minimum) {
    if (!Number.isInteger(value)) {
      throw new TypeError(label + " must be an integer.");
    }
    if (minimum !== undefined && value < minimum) {
      throw new RangeError(label + " must be at least " + minimum + ".");
    }
  }

  function normalizeDamageType(value) {
    if (value === undefined || value === null || value === "") {
      return "untyped";
    }
    return String(value).trim().toLowerCase();
  }

  /**
   * Normalize a shield authoring record.
   *
   * `hp` accepts a direct number or the physical-item shape `{ value, max }`.
   *
   * @param {object} input
   * @returns {object}
   */
  function normalizeShield(input) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("Shield must be an object.");
    }

    const hpSource = input.hp !== undefined ? input.hp : input.hpValue;
    const hpObject =
      hpSource !== null && typeof hpSource === "object" ? hpSource : null;
    const currentHPSource =
      hpObject === null
        ? hpSource
        : hpObject.value !== undefined
          ? hpObject.value
          : hpObject.current;

    const maxHPSource =
      input.maxHP !== undefined
        ? input.maxHP
        : hpObject !== null && hpObject.max !== undefined
          ? hpObject.max
          : hpSource !== undefined && typeof hpSource === "number"
            ? hpSource
            : SHIELD_DEFAULTS.maxHP;

    const maxHP = Number.isInteger(maxHPSource)
      ? maxHPSource
      : Number(maxHPSource);
    assertInteger(maxHP, "shield maxHP", 1);

    const hp = currentHPSource === undefined ? maxHP : Number(currentHPSource);
    assertInteger(hp, "shield hp", 0);
    if (hp > maxHP) {
      throw new RangeError("shield hp cannot exceed maxHP.");
    }

    const hardness =
      input.hardness === undefined ? SHIELD_DEFAULTS.hardness : input.hardness;
    assertInteger(hardness, "shield hardness", 0);

    const brokenThreshold =
      input.brokenThreshold === undefined
        ? Math.floor(maxHP / 2)
        : input.brokenThreshold;
    assertInteger(brokenThreshold, "shield brokenThreshold", 0);
    if (brokenThreshold > maxHP) {
      throw new RangeError("shield brokenThreshold cannot exceed maxHP.");
    }

    const acBonus =
      input.acBonus === undefined ? SHIELD_DEFAULTS.acBonus : input.acBonus;
    assertInteger(acBonus, "shield acBonus", 0);

    const speedPenalty =
      input.speedPenalty === undefined
        ? SHIELD_DEFAULTS.speedPenalty
        : input.speedPenalty;
    assertInteger(speedPenalty, "shield speedPenalty");

    const item = Equipment.createInventoryItem(
      Object.assign({}, input, {
        type: "shield",
        name: input.name === undefined ? input.id : input.name,
      }),
    );

    item.hands = Equipment.ITEM_HANDS.ONE;
    item.hp = hp;
    item.maxHP = maxHP;
    item.hardness = hardness;
    item.brokenThreshold = brokenThreshold;
    item.acBonus = acBonus;
    item.speedPenalty = speedPenalty;
    item.hpValue = { value: hp, max: maxHP, brokenThreshold: brokenThreshold };
    refreshShieldState(item);
    return item;
  }

  function createShield(input) {
    return normalizeShield(input);
  }

  function copyShield(shield) {
    const copy = Equipment.copyItem(shield);
    if (copy && copy.hpValue) {
      copy.hpValue = Object.assign({}, copy.hpValue);
    }
    return copy;
  }

  function isShieldBroken(shield) {
    if (shield === null || typeof shield !== "object") {
      return false;
    }
    if (!Number.isInteger(shield.hp) || !Number.isInteger(shield.brokenThreshold)) {
      return shield.broken === true;
    }
    return shield.hp > 0 && shield.hp <= shield.brokenThreshold;
  }

  function isShieldDestroyed(shield) {
    if (shield === null || typeof shield !== "object") {
      return false;
    }
    if (!Number.isInteger(shield.hp)) {
      return shield.destroyed === true;
    }
    return shield.hp <= 0;
  }

  /**
   * Recompute the derived `broken`/`destroyed` flags after HP changes.
   *
   * @param {object} shield
   * @returns {object} the same shield
   */
  function refreshShieldState(shield) {
    if (shield === null || typeof shield !== "object") {
      return shield;
    }
    shield.broken = isShieldBroken(shield);
    shield.destroyed = isShieldDestroyed(shield);
    if (shield.hpValue && typeof shield.hpValue === "object") {
      shield.hpValue.value = shield.hp;
      shield.hpValue.max = shield.maxHP;
      shield.hpValue.brokenThreshold = shield.brokenThreshold;
    }
    return shield;
  }

  /**
   * Apply object damage to a shield.
   *
   * @param {object} shield
   * @param {number} amount non-negative integer
   * @returns {{
   *   shield: object,
   *   hpBefore: number,
   *   hpAfter: number,
   *   damageApplied: number,
   *   broken: boolean,
   *   destroyed: boolean,
   *   justBroken: boolean,
   *   justDestroyed: boolean
   * }}
   */
  function applyShieldDamage(shield, amount) {
    if (shield === null || typeof shield !== "object") {
      throw new TypeError("Shield damage requires a shield object.");
    }
    assertInteger(amount, "shield damage", 0);

    const hpBefore = shield.hp;
    const brokenBefore = isShieldBroken(shield);
    const destroyedBefore = isShieldDestroyed(shield);

    shield.hp = Math.max(0, hpBefore - amount);
    refreshShieldState(shield);

    return {
      shield: shield,
      hpBefore: hpBefore,
      hpAfter: shield.hp,
      damageApplied: hpBefore - shield.hp,
      broken: shield.broken === true,
      destroyed: shield.destroyed === true,
      justBroken:
        !brokenBefore && shield.broken === true && shield.destroyed !== true,
      justDestroyed: !destroyedBefore && shield.destroyed === true,
    };
  }

  /**
   * AC contribution of a shield. Broken and destroyed shields give none.
   *
   * @param {object} shield
   * @returns {number}
   */
  function getACBonus(shield) {
    if (shield === null || typeof shield !== "object") {
      return 0;
    }
    if (isShieldBroken(shield) || isShieldDestroyed(shield)) {
      return 0;
    }
    return Number.isInteger(shield.acBonus) ? shield.acBonus : SHIELD_DEFAULTS.acBonus;
  }

  function resolveCombatantShield(combatant) {
    if (!combatant || typeof combatant !== "object") {
      return null;
    }
    if (combatant.shield && typeof combatant.shield === "object") {
      return combatant.shield;
    }
    if (typeof combatant.getShield === "function") {
      return combatant.getShield();
    }
    return null;
  }

  function isShieldHeld(combatant, shield) {
    if (!combatant || typeof combatant !== "object" || !shield) {
      return false;
    }
    if (typeof combatant.isItemHeld === "function") {
      return combatant.isItemHeld(shield) === true;
    }
    // Combatants without a hands model cannot disprove that the shield is held.
    return true;
  }

  /**
   * Validate the Shield Block reaction trigger.
   *
   * Required state: a non-broken shield, the `shield-raised` condition, at
   * least one unspent reaction, and physical damage greater than zero.
   *
   * @param {object} combatant
   * @param {{damage?:number,damageType?:string,type?:string}} [options]
   * @returns {{ok:boolean,reason?:string,shield?:object}}
   */
  function canShieldBlock(combatant, options) {
    const opts = options || {};
    const shield = resolveCombatantShield(combatant);
    if (shield === null) {
      return { ok: false, reason: SHIELD_REASONS.NO_SHIELD };
    }
    if (isShieldDestroyed(shield)) {
      return { ok: false, reason: SHIELD_REASONS.SHIELD_DESTROYED, shield: shield };
    }
    if (isShieldBroken(shield)) {
      return { ok: false, reason: SHIELD_REASONS.SHIELD_BROKEN, shield: shield };
    }
    if (
      typeof combatant.hasCondition === "function" &&
      !combatant.hasCondition("shield-raised")
    ) {
      return { ok: false, reason: SHIELD_REASONS.SHIELD_NOT_RAISED, shield: shield };
    }

    const reactions = Number.isInteger(combatant.reactionsRemaining)
      ? combatant.reactionsRemaining
      : 0;
    if (reactions <= 0) {
      return { ok: false, reason: SHIELD_REASONS.NO_REACTION, shield: shield };
    }

    if (opts.damage !== undefined) {
      assertInteger(opts.damage, "damage", 0);
      if (opts.damage <= 0) {
        return { ok: false, reason: SHIELD_REASONS.NO_DAMAGE, shield: shield };
      }
    }

    const damageType = normalizeDamageType(
      opts.damageType === undefined ? opts.type : opts.damageType,
    );
    if (
      opts.damageType !== undefined ||
      opts.type !== undefined
    ) {
      if (!isPhysicalDamageType(damageType)) {
        return {
          ok: false,
          reason: SHIELD_REASONS.NON_PHYSICAL_DAMAGE,
          shield: shield,
        };
      }
    }

    return { ok: true, shield: shield };
  }

  /**
   * Resolve the Shield Block reaction math. The caller supplies damage that is
   * already past IWR (the canonical `takeDamage` pipeline applies IWR first).
   *
   * @param {{
   *   combatant: object,
   *   damage: number,
   *   damageType?: string,
   *   type?: string
   * }} options
   * @returns {{
   *   ok: boolean,
   *   reason?: string,
   *   absorbedByHardness: number,
   *   damageToShield: number,
   *   damageToActor: number,
   *   shieldBroken: boolean,
   *   shieldDestroyed: boolean,
   *   shieldJustBroken: boolean,
   *   shieldJustDestroyed: boolean,
   *   hardness: number,
   *   shieldHpBefore: number,
   *   shieldHpAfter: number,
   *   shieldRaisedRemoved: boolean,
   *   reactionSpent: boolean,
   *   reactionsLeft: number,
   *   shield: object
   * }}
   */
  function resolveShieldBlock(options) {
    const opts = options || {};
    const combatant = opts.combatant;
    const damage = opts.damage === undefined ? 0 : opts.damage;
    const damageType = normalizeDamageType(
      opts.damageType === undefined ? opts.type : opts.damageType,
    );

    if (!combatant || typeof combatant !== "object") {
      throw new TypeError("Shield Block requires a Combatant.");
    }
    assertInteger(damage, "damage", 0);

    const eligibility = canShieldBlock(combatant, {
      damage: damage,
      damageType: damageType,
    });
    if (!eligibility.ok) {
      return {
        ok: false,
        reason: eligibility.reason,
        absorbedByHardness: 0,
        damageToShield: 0,
        damageToActor: damage,
        shieldBroken: eligibility.shield
          ? isShieldBroken(eligibility.shield)
          : false,
        shieldDestroyed: eligibility.shield
          ? isShieldDestroyed(eligibility.shield)
          : false,
        shieldJustBroken: false,
        shieldJustDestroyed: false,
        hardness: eligibility.shield ? eligibility.shield.hardness : 0,
        shieldHpBefore: eligibility.shield ? eligibility.shield.hp : 0,
        shieldHpAfter: eligibility.shield ? eligibility.shield.hp : 0,
        shieldRaisedRemoved: false,
        reactionSpent: false,
        reactionsLeft: Number.isInteger(combatant.reactionsRemaining)
          ? combatant.reactionsRemaining
          : 0,
        shield: eligibility.shield || null,
      };
    }

    const shield = eligibility.shield;
    const hardness = Number.isInteger(shield.hardness)
      ? shield.hardness
      : SHIELD_DEFAULTS.hardness;

    // 1. Hardness reduces the incoming damage, but never below 0.
    const absorbedByHardness = Math.min(hardness, damage);
    const remaining = damage - absorbedByHardness;

    // 2. The shield takes the remainder, capped by its current HP. The wielder
    //    still takes the full remainder even when the shield is destroyed.
    const shieldDamage = Math.min(shield.hp, remaining);
    const shieldHpBefore = shield.hp;
    const damageResult = applyShieldDamage(shield, shieldDamage);
    const shieldHpAfter = shield.hp;

    // 3. Spend the reaction.
    if (typeof combatant.spendReaction === "function") {
      combatant.spendReaction(1, {
        type: "shield-block",
        damage: damage,
        damageType: damageType,
        absorbedByHardness: absorbedByHardness,
        damageToActor: remaining,
      });
    } else if (Number.isInteger(combatant.reactionsRemaining)) {
      combatant.reactionsRemaining = Math.max(0, combatant.reactionsRemaining - 1);
    }

    // 4. A broken or destroyed shield can no longer stay raised.
    let shieldRaisedRemoved = false;
    if (
      (damageResult.broken || damageResult.destroyed) &&
      typeof combatant.removeCondition === "function"
    ) {
      shieldRaisedRemoved = combatant.removeCondition("shield-raised");
    }

    return {
      ok: true,
      absorbedByHardness: absorbedByHardness,
      damageToShield: damageResult.damageApplied,
      damageToActor: remaining,
      shieldBroken: damageResult.broken,
      shieldDestroyed: damageResult.destroyed,
      shieldJustBroken: damageResult.justBroken,
      shieldJustDestroyed: damageResult.justDestroyed,
      hardness: hardness,
      shieldHpBefore: shieldHpBefore,
      shieldHpAfter: shieldHpAfter,
      shieldRaisedRemoved: shieldRaisedRemoved,
      reactionSpent: true,
      reactionsLeft: Number.isInteger(combatant.reactionsRemaining)
        ? combatant.reactionsRemaining
        : 0,
      shield: shield,
    };
  }

  function getShieldState(shield) {
    if (shield === null || typeof shield !== "object") {
      return null;
    }
    return {
      id: shield.id,
      name: shield.name,
      hardness: shield.hardness,
      hp: shield.hp,
      maxHP: shield.maxHP,
      brokenThreshold: shield.brokenThreshold,
      acBonus: shield.acBonus,
      speedPenalty: shield.speedPenalty,
      broken: isShieldBroken(shield),
      destroyed: isShieldDestroyed(shield),
      effectiveACBonus: getACBonus(shield),
    };
  }

  return Object.freeze({
    SHIELD_DEFAULTS: SHIELD_DEFAULTS,
    PHYSICAL_DAMAGE_TYPES: PHYSICAL_DAMAGE_TYPES,
    SHIELD_REASONS: SHIELD_REASONS,
    isPhysicalDamageType: isPhysicalDamageType,
    normalizeDamageType: normalizeDamageType,
    normalizeShield: normalizeShield,
    createShield: createShield,
    copyShield: copyShield,
    isShieldBroken: isShieldBroken,
    isShieldDestroyed: isShieldDestroyed,
    refreshShieldState: refreshShieldState,
    applyShieldDamage: applyShieldDamage,
    getACBonus: getACBonus,
    canShieldBlock: canShieldBlock,
    resolveShieldBlock: resolveShieldBlock,
    getShieldState: getShieldState,
  });
});
