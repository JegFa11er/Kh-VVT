/**
 * PF2E REMASTERED — PERSISTENT DAMAGE (HEADLESS CORE)
 *
 * Persistent damage is resolved at the end of the affected creature's turn:
 *
 *   1. Roll the persistent damage formula (for example 1d6 fire).
 *   2. Apply it through the target's normal IWR pipeline
 *      (`Combatant.takeDamage(amount, { type })`).
 *   3. Roll a recovery flat check against DC 15, with no modifiers.
 *      Success removes that persistent damage instance; failure keeps it.
 *
 * Persistent damage of the same type does not stack: the stronger formula
 * wins. Different types are independent instances and each gets its own
 * damage roll and its own recovery check.
 *
 * This module is pure. Combatant owns the `persistentDamage` array and the
 * public add/remove/query methods; the tick helper here does the end-of-turn
 * work and returns a structured report for the Encounter and combat log.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Rules/damage.js"),
      require("../Rules/checks.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.PersistentDamage = factory(
      root.PF2e.Core.Rules.Damage,
      root.PF2e.Core.Rules.Checks,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Damage, Checks) {
  "use strict";

  const RECOVERY_DC = 15;

  function assertInstances(instances) {
    if (!Array.isArray(instances)) {
      throw new TypeError("persistent damage store must be an array.");
    }
    return instances;
  }

  /**
   * Average damage of a formula, used to decide which same-type instance wins.
   * Example: 1d4 = 2.5, 1d6 = 3.5, 2d6+2 = 9.
   *
   * @param {string} formula
   * @returns {number}
   */
  function formulaWeight(formula) {
    const parsed = Damage.parseDamageFormula(formula);
    if (parsed.diceCount === 0) {
      return parsed.modifier;
    }
    return (
      (parsed.diceCount * (parsed.dieSize + 1)) / 2 + parsed.modifier
    );
  }

  /**
   * Normalize a persistent damage instance to `{ id, formula, type }`.
   *
   * @param {{id?:string,formula:string,type?:string}|string} input
   * @param {string} [fallbackType]
   * @returns {{id:string,formula:string,type:string}}
   */
  function createPersistentDamage(input, fallbackType) {
    const spec = Damage.parseDamageSpec(input, fallbackType);
    const rawId =
      input !== null && typeof input === "object" ? input.id : undefined;
    const id =
      typeof rawId === "string" && rawId.trim() !== ""
        ? rawId.trim()
        : "persistent-" + spec.type;

    return Object.freeze({
      id: id,
      formula: spec.formula,
      type: spec.type,
    });
  }

  function copyInstance(instance) {
    return {
      id: instance.id,
      formula: instance.formula,
      type: instance.type,
    };
  }

  /**
   * Add a persistent damage instance to a mutable array.
   *
   * Same-type instances never stack: if the new formula has a higher average
   * damage it replaces the old formula; otherwise the existing instance is
   * kept. Different types simply coexist.
   *
   * @param {object[]} instances
   * @param {{id?:string,formula:string,type?:string}|string} input
   * @param {string} [fallbackType]
   * @returns {{
   *   instance: object,
   *   added: boolean,
   *   replaced: boolean,
   *   keptExisting: boolean,
   *   previous: object|null
   * }}
   */
  function addPersistentDamage(instances, input, fallbackType) {
    const store = assertInstances(instances);
    const next = createPersistentDamage(input, fallbackType);
    const existingIndex = store.findIndex(function (instance) {
      return instance.type === next.type;
    });

    if (existingIndex === -1) {
      store.push(copyInstance(next));
      return {
        instance: copyInstance(next),
        added: true,
        replaced: false,
        keptExisting: false,
        previous: null,
      };
    }

    const existing = store[existingIndex];
    if (formulaWeight(next.formula) > formulaWeight(existing.formula)) {
      const previous = copyInstance(existing);
      // Keep the stable id of the existing condition; only the formula grows.
      store[existingIndex] = {
        id: existing.id,
        formula: next.formula,
        type: existing.type,
      };
      return {
        instance: copyInstance(store[existingIndex]),
        added: false,
        replaced: true,
        keptExisting: false,
        previous: previous,
      };
    }

    return {
      instance: copyInstance(existing),
      added: false,
      replaced: false,
      keptExisting: true,
      previous: null,
    };
  }

  /**
   * Remove by instance id first, then by damage type. Removing by type clears
   * every instance of that type (there can only be one, by construction).
   *
   * @param {object[]} instances
   * @param {string} idOrType
   * @returns {boolean} true when at least one instance was removed
   */
  function removePersistentDamage(instances, idOrType) {
    const store = assertInstances(instances);
    if (typeof idOrType !== "string" || idOrType.trim() === "") {
      throw new TypeError("removePersistentDamage requires an id or damage type.");
    }

    const value = idOrType.trim();
    const byId = store.findIndex(function (instance) {
      return instance.id === value;
    });

    if (byId !== -1) {
      store.splice(byId, 1);
      return true;
    }

    let type;
    try {
      type = Damage.normalizeDamageType(value);
    } catch (error) {
      return false;
    }

    const before = store.length;
    for (let index = store.length - 1; index >= 0; index -= 1) {
      if (store[index].type === type) {
        store.splice(index, 1);
      }
    }
    return store.length !== before;
  }

  /**
   * @param {object[]} instances
   * @param {string} [type] omit to ask whether any persistent damage is active
   * @returns {boolean}
   */
  function hasPersistentDamage(instances, type) {
    const store = assertInstances(instances);
    if (type === undefined || type === null) {
      return store.length > 0;
    }
    const normalized = Damage.normalizeDamageType(type);
    return store.some(function (instance) {
      return instance.type === normalized;
    });
  }

  /**
   * Defensive copy of the persistent damage store.
   *
   * @param {object[]} instances
   * @returns {{id:string,formula:string,type:string}[]}
   */
  function getPersistentDamage(instances) {
    return assertInstances(instances).map(copyInstance);
  }

  /**
   * Resolve every persistent damage instance at the end of a turn.
   *
   * @param {{
   *   combatant: object,
   *   instances?: object[],
   *   rollDie?: (sides:number)=>number,
   *   rollDamageDie?: (sides:number)=>number,
   *   rollD20?: ()=>number,
   *   rollFlatCheck?: ()=>number
   * }} options
   * @returns {{
   *   combatantId: string,
   *   combatantName: string,
   *   events: object[],
   *   changed: boolean,
   *   anyRemoved: boolean,
   *   defeated: boolean
   * }}
   */
  function tickPersistentDamage(options) {
    const opts = options || {};
    const combatant = opts.combatant;
    if (
      combatant === null ||
      typeof combatant !== "object" ||
      typeof combatant.takeDamage !== "function"
    ) {
      throw new TypeError(
        "tickPersistentDamage requires a combatant with takeDamage().",
      );
    }

    const store = assertInstances(
      opts.instances === undefined ? combatant.persistentDamage : opts.instances,
    );
    const rollDie =
      typeof opts.rollDamageDie === "function"
        ? opts.rollDamageDie
        : typeof opts.rollDie === "function"
          ? opts.rollDie
          : Damage.defaultRollDie;
    const rollD20 =
      typeof opts.rollFlatCheck === "function"
        ? opts.rollFlatCheck
        : typeof opts.rollD20 === "function"
          ? opts.rollD20
          : undefined;

    const events = [];

    // A defeated creature no longer takes end-of-turn persistent damage in
    // this slice (Dying/Death are deliberately deferred).
    if (combatant.isDefeated === true) {
      return {
        combatantId: combatant.id,
        combatantName: combatant.name,
        events: events,
        changed: false,
        anyRemoved: false,
        defeated: true,
      };
    }

    // Snapshot because a successful recovery check mutates the store.
    const snapshot = store.slice();
    for (const instance of snapshot) {
      if (combatant.isDefeated === true) {
        break;
      }

      const rolled = Damage.rollDamage({
        formula: instance.formula,
        type: instance.type,
        rollDie: rollDie,
      });
      const hpBefore = Number.isInteger(combatant.currentHP)
        ? combatant.currentHP
        : null;
      const applied = combatant.takeDamage(rolled.total, {
        type: instance.type,
        source: "persistent",
      });

      const recovery = Checks.evaluateFlatCheck({
        dc: RECOVERY_DC,
        rollD20: rollD20,
        rollDie:
          typeof opts.rollDie === "function" ? opts.rollDie : undefined,
      });
      const removed = recovery.passed
        ? removePersistentDamage(store, instance.id)
        : false;

      events.push({
        instanceId: instance.id,
        formula: instance.formula,
        type: instance.type,
        amount: rolled.total,
        damage: {
          formula: rolled.formula,
          type: rolled.type,
          diceCount: rolled.diceCount,
          dieSize: rolled.dieSize,
          modifier: rolled.modifier,
          rolls: rolled.rolls,
          diceTotal: rolled.diceTotal,
          baseTotal: rolled.baseTotal,
          doubled: false,
          multiplier: 1,
          total: rolled.total,
        },
        iwr: applied.iwr || null,
        damageDealt:
          applied.damageApplied === undefined
            ? rolled.total
            : applied.damageApplied,
        hpDamage: applied.damageTaken,
        hpBefore: hpBefore,
        hpAfter: applied.currentHP,
        defeated: applied.isDefeated === true,
        recovery: {
          passed: recovery.passed,
          d20: recovery.d20,
          dc: recovery.dc,
        },
        removed: removed,
      });
    }

    return {
      combatantId: combatant.id,
      combatantName: combatant.name,
      events: events,
      changed: events.length > 0,
      anyRemoved: events.some(function (event) {
        return event.removed;
      }),
      defeated: combatant.isDefeated === true,
    };
  }

  return Object.freeze({
    RECOVERY_DC: RECOVERY_DC,
    formulaWeight: formulaWeight,
    createPersistentDamage: createPersistentDamage,
    addPersistentDamage: addPersistentDamage,
    removePersistentDamage: removePersistentDamage,
    hasPersistentDamage: hasPersistentDamage,
    getPersistentDamage: getPersistentDamage,
    tickPersistentDamage: tickPersistentDamage,
  });
});
