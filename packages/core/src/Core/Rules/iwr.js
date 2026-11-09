/**
 * PF2E REMASTERED — IMMUNITY, WEAKNESS & RESISTANCE (HEADLESS CORE)
 *
 * Canonical PF2e Remastered IWR pipeline for one attack:
 *
 *   base damage (after critical multiplier)
 *     -> Immunity   (the instance becomes 0 and later steps do not run)
 *     -> Weakness   (+value, once per attack for an applicable damage type)
 *     -> Resistance (-value, floored at 0 per instance)
 *
 * Damage is modelled as a list of typed instances, e.g.
 *
 *   [{ amount: 8, type: "slashing" }, { amount: 3, type: "fire" }]
 *
 * The module is a pure function with no combat state. The caller supplies the
 * already rolled and multiplied amounts; this module only applies IWR.
 *
 * Returned audit contract:
 *
 *   {
 *     totalDamage, baseTotal,
 *     breakdown: [{ index, type, amount, immune, weakness, resistance,
 *                   resistanceApplied, afterImmunity, afterWeakness,
 *                   finalAmount, steps }],
 *     appliedIWR: [{ kind: "immunity"|"weakness"|"resistance", type, value,
 *                    amount, instanceIndex }]
 *   }
 *
 * A special `"all"` entry in immunities, weaknesses, or resistances matches
 * every damage type. Duplicate weakness/resistance entries for one type keep
 * the highest value, mirroring PF2e's "use the highest" rule.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Rules = root.PF2e.Core.Rules || {};
    root.PF2e.Core.Rules.IWR = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const IWR_KINDS = Object.freeze({
    IMMUNITY: "immunity",
    WEAKNESS: "weakness",
    RESISTANCE: "resistance",
  });

  const ALL_DAMAGE = "all";
  const DAMAGE_TYPE_PATTERN = /^[a-z][a-z-]*$/;

  function assertNonNegativeInteger(value, label) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(label + " must be a non-negative integer.");
    }
  }

  function normalizeDamageType(type, label) {
    const value = typeof type === "string" ? type.trim().toLowerCase() : "";
    if (value === "") {
      throw new TypeError((label || "damage type") + " must be a non-empty string.");
    }
    if (!DAMAGE_TYPE_PATTERN.test(value)) {
      throw new TypeError(
        (label || "damage type") +
          ' must be a lower-case slug such as "slashing" or "fire"; received ' +
          String(type) +
          ".",
      );
    }
    return value;
  }

  /**
   * @param {string[]|{type:string}[]|Record<string,boolean>|undefined|null} source
   * @returns {string[]} unique, normalized damage types
   */
  function normalizeImmunities(source) {
    if (source === undefined || source === null) {
      return [];
    }

    const result = [];
    const seen = new Set();

    function push(type) {
      const normalized = normalizeDamageType(type, "immunity type");
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(normalized);
      }
    }

    if (Array.isArray(source)) {
      for (const entry of source) {
        if (typeof entry === "string") {
          push(entry);
        } else if (entry !== null && typeof entry === "object") {
          push(entry.type === undefined ? entry.damageType : entry.type);
        } else {
          throw new TypeError("immunities must contain strings or { type } objects.");
        }
      }
      return result;
    }

    if (typeof source === "object") {
      for (const key of Object.keys(source)) {
        if (source[key]) {
          push(key);
        }
      }
      return result;
    }

    throw new TypeError("immunities must be an array or an object.");
  }

  /**
   * Normalize weaknesses/resistances into `[{ type, value }]`.
   *
   * Accepts:
   *   [{ type: "slashing", value: 5 }]
   *   { slashing: 5, fire: 3 }
   *
   * The highest value wins when the same type appears more than once.
   *
   * @param {Array|Object|undefined|null} source
   * @param {string} label
   * @returns {{type:string,value:number}[]}
   */
  function normalizeIWRValues(source, label) {
    const name = label || "IWR values";
    if (source === undefined || source === null) {
      return [];
    }

    const byType = new Map();

    function push(type, value) {
      const normalized = normalizeDamageType(type, name + " type");
      const amount = value === undefined ? 0 : value;
      assertNonNegativeInteger(amount, name + " value for " + normalized);
      const existing = byType.get(normalized);
      if (existing === undefined || amount > existing) {
        byType.set(normalized, amount);
      }
    }

    if (Array.isArray(source)) {
      for (const entry of source) {
        if (entry === null || typeof entry !== "object") {
          throw new TypeError(name + " must contain { type, value } objects.");
        }
        push(entry.type === undefined ? entry.damageType : entry.type, entry.value);
      }
    } else if (typeof source === "object") {
      for (const key of Object.keys(source)) {
        push(key, source[key]);
      }
    } else {
      throw new TypeError(name + " must be an array or an object.");
    }

    return Array.from(byType.entries()).map(function (entry) {
      return { type: entry[0], value: entry[1] };
    });
  }

  function buildValueMap(entries) {
    const map = new Map();
    for (const entry of entries) {
      const existing = map.get(entry.type);
      if (existing === undefined || entry.value > existing) {
        map.set(entry.type, entry.value);
      }
    }
    return map;
  }

  function matchesImmunity(set, type) {
    return set.has(ALL_DAMAGE) || set.has(type);
  }

  /**
   * Make the weakness/resistance lookup and report which key matched, so the
   * audit can say whether a type-specific or "all" entry applied.
   */
  function lookupValue(map, type) {
    if (map.has(type)) {
      return { key: type, value: map.get(type) };
    }
    if (map.has(ALL_DAMAGE)) {
      return { key: ALL_DAMAGE, value: map.get(ALL_DAMAGE) };
    }
    return { key: null, value: 0 };
  }

  function normalizeDamageInstances(source) {
    if (!Array.isArray(source)) {
      throw new TypeError("damageInstances must be an array.");
    }

    return source.map(function (entry, index) {
      if (entry === null || typeof entry !== "object") {
        throw new TypeError("damageInstances[" + index + "] must be an object.");
      }
      const amount = entry.amount === undefined ? 0 : entry.amount;
      assertNonNegativeInteger(amount, "damageInstances[" + index + "].amount");
      const type = normalizeDamageType(
        entry.type === undefined ? entry.damageType : entry.type,
        "damageInstances[" + index + "].type",
      );
      return {
        amount: amount,
        type: type,
      };
    });
  }

  /**
   * Apply the canonical PF2e IWR pipeline to one attack's damage instances.
   *
   * @param {{
   *   damageInstances: {amount:number,type:string}[],
   *   immunities?: string[]|object,
   *   weaknesses?: {type:string,value:number}[]|object,
   *   resistances?: {type:string,value:number}[]|object
   * }} options
   * @returns {{
   *   totalDamage: number,
   *   baseTotal: number,
   *   breakdown: object[],
   *   appliedIWR: object[]
   * }}
   */
  function applyIWR(options) {
    const opts = options || {};
    const instances = normalizeDamageInstances(opts.damageInstances);
    const immunities = normalizeImmunities(opts.immunities);
    const weaknesses = normalizeIWRValues(opts.weaknesses, "weaknesses");
    const resistances = normalizeIWRValues(opts.resistances, "resistances");

    const immunitySet = new Set(immunities);
    const weaknessMap = buildValueMap(weaknesses);
    const resistanceMap = buildValueMap(resistances);

    // PF2e weakness applies once per attack for an applicable damage type (or
    // once per attack for an `all` weakness). This set records the matched key.
    const appliedWeaknessKeys = new Set();

    const breakdown = [];
    const appliedIWR = [];
    let totalDamage = 0;
    let baseTotal = 0;

    instances.forEach(function (instance, index) {
      baseTotal += instance.amount;

      const immune = matchesImmunity(immunitySet, instance.type);
      let afterImmunity = instance.amount;
      let weaknessValue = 0;
      let resistanceValue = 0;
      let resistanceApplied = 0;
      const steps = [];

      if (immune) {
        afterImmunity = 0;
        steps.push({
          kind: IWR_KINDS.IMMUNITY,
          type: instance.type,
          value: null,
        });
        appliedIWR.push({
          kind: IWR_KINDS.IMMUNITY,
          type: instance.type,
          value: null,
          amount: instance.amount,
          instanceIndex: index,
        });
      } else {
        // Weakness is applied before resistance. The matched key ("slashing"
        // or "all") may only contribute once per attack.
        const weakness = lookupValue(weaknessMap, instance.type);
        if (weakness.key !== null && !appliedWeaknessKeys.has(weakness.key)) {
          weaknessValue = weakness.value;
          appliedWeaknessKeys.add(weakness.key);
          if (weaknessValue > 0) {
            steps.push({
              kind: IWR_KINDS.WEAKNESS,
              type: instance.type,
              value: weaknessValue,
            });
            appliedIWR.push({
              kind: IWR_KINDS.WEAKNESS,
              type: instance.type,
              value: weaknessValue,
              amount: weaknessValue,
              instanceIndex: index,
            });
          }
        }

        // Resistance is applied to the post-weakness amount and never lowers
        // the instance below 0.
        const resistance = lookupValue(resistanceMap, instance.type);
        const afterWeakness = afterImmunity + weaknessValue;
        if (resistance.key !== null && resistance.value > 0) {
          resistanceValue = resistance.value;
          resistanceApplied = Math.min(resistanceValue, afterWeakness);
          if (resistanceApplied > 0) {
            steps.push({
              kind: IWR_KINDS.RESISTANCE,
              type: instance.type,
              value: resistanceValue,
              amount: resistanceApplied,
            });
            appliedIWR.push({
              kind: IWR_KINDS.RESISTANCE,
              type: instance.type,
              value: resistanceValue,
              amount: resistanceApplied,
              instanceIndex: index,
            });
          }
        }
      }

      const afterWeakness = afterImmunity + weaknessValue;
      const finalAmount = immune
        ? 0
        : Math.max(0, afterWeakness - resistanceApplied);
      totalDamage += finalAmount;

      breakdown.push({
        index: index,
        type: instance.type,
        amount: instance.amount,
        immune: immune,
        weakness: weaknessValue,
        resistance: resistanceValue,
        resistanceApplied: resistanceApplied,
        afterImmunity: afterImmunity,
        afterWeakness: afterWeakness,
        finalAmount: finalAmount,
        steps: steps,
      });
    });

    return {
      totalDamage: totalDamage,
      baseTotal: baseTotal,
      breakdown: breakdown,
      appliedIWR: appliedIWR,
    };
  }

  return Object.freeze({
    IWR_KINDS: IWR_KINDS,
    ALL_DAMAGE: ALL_DAMAGE,
    normalizeDamageType: normalizeDamageType,
    normalizeImmunities: normalizeImmunities,
    normalizeIWRValues: normalizeIWRValues,
    applyIWR: applyIWR,
  });
});
