/**
 * PF2E REMASTERED — HAZARDS & TRAPS (HEADLESS CORE)
 *
 * Presentation-free hazard/trap model used by the Disable a Device action and
 * by movement (Stride) trap triggering. A hazard is armed until it is disarmed
 * or destroyed; entering its trigger area while armed fires its reaction.
 *
 * Data contract:
 *   {
 *     id, name,
 *     stealthDC, disableDC, disableSkill,
 *     hp, maxHP, hardness, brokenThreshold,
 *     isBroken, isArmed, reset,
 *     triggerArea: [{ x, y }],
 *     reaction: { trigger, formula, type, saveType?, saveDC? }
 *   }
 *
 * A hazard whose HP reaches its broken threshold (or 0) is disabled.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Rules/damage.js"),
      require("../Rules/spells.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Hazard = factory(
      root.PF2e.Core.Rules.Damage,
      root.PF2e.Core.Rules.Spells,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Damage, Spells) {
  "use strict";

  const DEFAULT_DISABLE_SKILL = "thievery";
  const DEFAULT_DISABLE_DC = 15;
  const DEFAULT_STEALTH_DC = 10;
  const DEFAULT_REACTION = Object.freeze({
    trigger: "enter",
    formula: "2d6",
    type: "piercing",
  });

  function assertNonEmptyString(value, label) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(label + " must be a non-empty string.");
    }
  }

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

  function copyTriggerArea(area) {
    if (!Array.isArray(area)) {
      throw new TypeError("triggerArea must be an array of { x, y } cells.");
    }
    return area.map(function (cell) {
      if (
        cell === null ||
        typeof cell !== "object" ||
        !Number.isInteger(cell.x) ||
        !Number.isInteger(cell.y)
      ) {
        throw new TypeError("triggerArea entries must be integer { x, y } cells.");
      }
      return { x: cell.x, y: cell.y };
    });
  }

  function normalizeReaction(reaction) {
    if (reaction === undefined || reaction === null) {
      return {
        trigger: DEFAULT_REACTION.trigger,
        formula: DEFAULT_REACTION.formula,
        type: DEFAULT_REACTION.type,
        saveType: null,
        saveDC: null,
      };
    }
    if (typeof reaction !== "object" || Array.isArray(reaction)) {
      throw new TypeError("reaction must be an object.");
    }

    const spec = Damage.parseDamageSpec(
      { formula: reaction.formula, type: reaction.type },
      reaction.type,
    );

    let saveType = null;
    let saveDC = null;
    if (reaction.saveType !== undefined && reaction.saveType !== null) {
      saveType = Spells.normalizeSaveType(reaction.saveType);
      saveDC = reaction.saveDC === undefined ? null : reaction.saveDC;
      if (saveDC !== null) {
        assertInteger(saveDC, "reaction.saveDC");
      }
    }

    return {
      trigger:
        typeof reaction.trigger === "string" && reaction.trigger.trim() !== ""
          ? reaction.trigger.trim().toLowerCase()
          : DEFAULT_REACTION.trigger,
      formula: spec.formula,
      type: spec.type,
      saveType: saveType,
      saveDC: saveDC,
    };
  }

  /**
   * Resolve the d20 for a hazard save. Deterministic callers inject `rollD20`
   * or `rollDie`; the host falls back to Math.random.
   */
  function resolveD20(options) {
    const opts = options || {};
    let value;
    if (typeof opts.rollD20 === "function") {
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
   * Roll and apply a hazard's reaction against a target. Pure with respect to
   * the hazard's armed state: `isArmed` is NOT mutated here, so the same
   * resolution can drive both Stride triggering and the Disable critical
   * failure (which keeps the trap armed).
   *
   * @param {object} hazard
   * @param {object} target a Combatant with `takeDamage` and `getSaveModifier`
   * @param {{rollD20?:Function, rollDamageDie?:Function, rollDie?:Function}} [options]
   * @returns {object}
   */
  function resolveReaction(hazard, target, options) {
    const opts = options || {};
    const reaction = hazard.reaction;
    const rollDie =
      typeof opts.rollDamageDie === "function"
        ? opts.rollDamageDie
        : typeof opts.rollDie === "function"
          ? opts.rollDie
          : Damage.defaultRollDie;

    const damage = Damage.rollDamage({
      formula: reaction.formula,
      type: reaction.type,
      rollDie: rollDie,
    });

    let rawDamage = damage.total;
    let save = null;

    if (reaction.saveType !== null && reaction.saveDC !== null) {
      const saveModifier =
        typeof target.getSaveModifier === "function"
          ? target.getSaveModifier(reaction.saveType)
          : 0;
      const d20 = resolveD20(opts);
      save = Spells.evaluateBasicSave({
        saveRoll: d20,
        saveModifier: saveModifier,
        saveDC: reaction.saveDC,
        rawDamage: rawDamage,
      });
      rawDamage = save.damage;
    }

    const hpBefore = Number.isInteger(target.currentHP) ? target.currentHP : null;
    const applied = target.takeDamage(rawDamage, { type: reaction.type });

    return {
      hazardId: hazard.id,
      hazardName: hazard.name,
      formula: reaction.formula,
      type: reaction.type,
      saveType: reaction.saveType,
      saveDC: reaction.saveDC,
      trigger: reaction.trigger,
      damage: damage,
      rawDamage: damage.total,
      save: save,
      damageDealt:
        applied.damageApplied === undefined ? rawDamage : applied.damageApplied,
      hpBefore: hpBefore,
      hpAfter: applied.currentHP,
      targetDefeated: applied.isDefeated,
      iwr: applied.iwr || null,
    };
  }

  class Hazard {
    constructor(options) {
      const opts = options || {};
      assertNonEmptyString(opts.id, "id");
      const name = opts.name === undefined ? opts.id : opts.name;
      assertNonEmptyString(name, "name");

      const stealthDC = opts.stealthDC === undefined ? DEFAULT_STEALTH_DC : opts.stealthDC;
      assertInteger(stealthDC, "stealthDC");

      const disableDC = opts.disableDC === undefined ? DEFAULT_DISABLE_DC : opts.disableDC;
      assertInteger(disableDC, "disableDC");

      const disableSkill =
        opts.disableSkill === undefined ? DEFAULT_DISABLE_SKILL : opts.disableSkill;
      if (typeof disableSkill !== "string" || disableSkill.trim() === "") {
        throw new TypeError("disableSkill must be a non-empty string.");
      }

      const maxHP = opts.maxHP === undefined ? (opts.hp === undefined ? 8 : opts.hp) : opts.maxHP;
      if (!Number.isInteger(maxHP) || maxHP <= 0) {
        throw new RangeError("maxHP must be a positive integer.");
      }
      const hp = opts.hp === undefined ? (opts.currentHP === undefined ? maxHP : opts.currentHP) : opts.hp;
      if (!Number.isInteger(hp) || hp < 0 || hp > maxHP) {
        throw new RangeError("hp must be an integer between 0 and maxHP.");
      }

      const hardness = opts.hardness === undefined ? 0 : opts.hardness;
      assertNonNegativeInteger(hardness, "hardness");

      const brokenThreshold =
        opts.brokenThreshold === undefined ? Math.floor(maxHP / 2) : opts.brokenThreshold;
      assertNonNegativeInteger(brokenThreshold, "brokenThreshold");

      this.id = opts.id;
      this.name = name;
      this.stealthDC = stealthDC;
      this.disableDC = disableDC;
      this.disableSkill = disableSkill.trim().toLowerCase();
      this.hp = hp;
      this.maxHP = maxHP;
      this.hardness = hardness;
      this.brokenThreshold = brokenThreshold;
      this.isBroken = opts.isBroken === true;
      this.reset = opts.reset === true;
      this.triggerArea = copyTriggerArea(opts.triggerArea === undefined ? [] : opts.triggerArea);
      this.reaction = normalizeReaction(opts.reaction);
      // Optional event bridge. Hazards stay headless when no bus is supplied.
      this.eventBus = opts.eventBus || opts.bus || null;

      // A destroyed (0 HP) or broken hazard is disarmed.
      const authoredArmed = opts.isArmed === undefined ? true : opts.isArmed === true;
      this.isArmed = authoredArmed && !(this.isBroken || this.hp <= 0);
    }

    /**
     * @param {object|null} bus
     * @returns {Hazard}
     */
    setEventBus(bus) {
      this.eventBus = bus || null;
      return this;
    }

    /**
     * @param {string} eventType
     * @param {object} [payload]
     * @returns {number}
     */
    emitEvent(eventType, payload) {
      if (!this.eventBus || typeof this.eventBus.emit !== "function") {
        return 0;
      }
      return this.eventBus.emit(
        eventType,
        Object.assign(
          { hazardId: this.id, hazardName: this.name },
          payload || {},
        ),
      );
    }

    /**
     * @returns {{x:number,y:number}[]} defensive copy of the trigger area
     */
    getTriggerArea() {
      return this.triggerArea.map(function (cell) {
        return { x: cell.x, y: cell.y };
      });
    }

    /**
     * @returns {object} defensive copy of the reaction profile
     */
    getReaction() {
      return Object.assign({}, this.reaction);
    }

    /**
     * Whether a cell lies inside this hazard's trigger area.
     *
     * @param {{x:number,y:number}} cell
     * @returns {boolean}
     */
    containsTriggerCell(cell) {
      if (cell === null || typeof cell !== "object") {
        return false;
      }
      return this.triggerArea.some(function (area) {
        return area.x === cell.x && area.y === cell.y;
      });
    }

    /**
     * Apply damage to the hazard. Reaching the broken threshold (or 0 HP)
     * marks it broken and disarms it.
     *
     * @param {number} amount
     * @returns {{
     *   hpBefore:number, hpAfter:number, isBroken:boolean, isDestroyed:boolean,
     *   deactivated:boolean, isArmed:boolean
     * }}
     */
    takeDamage(amount) {
      assertNonNegativeInteger(amount, "amount");
      const before = this.hp;
      const after = Math.max(0, before - amount);
      this.hp = after;

      this.isBroken = this.isBroken || (after > 0 && after <= this.brokenThreshold);
      const isDestroyed = after <= 0;
      const wasArmed = this.isArmed;
      if (this.isBroken || isDestroyed) {
        this.isArmed = false;
      }

      const result = {
        hpBefore: before,
        hpAfter: after,
        isBroken: this.isBroken,
        isDestroyed: isDestroyed,
        deactivated: wasArmed && this.isArmed === false,
        isArmed: this.isArmed,
      };

      if (result.deactivated) {
        this.emitEvent("hazard:disabled", {
          reason: isDestroyed ? "destroyed" : "broken",
          hpBefore: result.hpBefore,
          hpAfter: result.hpAfter,
          isBroken: result.isBroken,
          isDestroyed: result.isDestroyed,
        });
      }

      return result;
    }

    /** Re-arm the hazard (used by traps with the `reset` property). */
    arm() {
      if (this.isBroken || this.hp <= 0) {
        return false;
      }
      this.isArmed = true;
      return true;
    }

    /** Disarm the hazard without destroying it. */
    disarm() {
      const wasArmed = this.isArmed;
      this.isArmed = false;
      if (wasArmed) {
        this.emitEvent("hazard:disabled", { reason: "disarmed" });
      }
      return wasArmed;
    }

    /**
     * Trigger this hazard's reaction against a target and discharge it.
     *
     * @param {object} target
     * @param {{rollD20?:Function, rollDamageDie?:Function, rollDie?:Function}} [options]
     * @returns {object}
     */
    trigger(target, options) {
      const result = resolveReaction(this, target, options);
      this.isArmed = false;
      result.isArmed = false;
      this.emitEvent("hazard:triggered", {
        targetId: target && target.id ? target.id : null,
        targetName: target && target.name ? target.name : null,
        reaction: this.getReaction(),
        result: result,
      });
      return result;
    }
  }

  Hazard.DEFAULT_DISABLE_SKILL = DEFAULT_DISABLE_SKILL;
  Hazard.DEFAULT_DISABLE_DC = DEFAULT_DISABLE_DC;
  Hazard.DEFAULT_STEALTH_DC = DEFAULT_STEALTH_DC;
  Hazard.DEFAULT_REACTION = DEFAULT_REACTION;
  Hazard.resolveReaction = resolveReaction;
  Hazard.resolveD20 = resolveD20;
  Hazard.Hazard = Hazard;

  return Hazard;
});
