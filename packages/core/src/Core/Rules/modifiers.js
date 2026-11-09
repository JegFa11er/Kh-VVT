/**
 * PF2E REMASTERED — MODIFIER RESOLVER (HEADLESS CORE)
 *
 * Central stacking math for every d20 check, DC, AC, and damage-adjacent
 * statistic in the core.
 *
 * PF2e Remastered stacking rules implemented here:
 *   - circumstance, status, and item modifiers are typed;
 *   - a typed bonus does not stack with another bonus of the same type: keep
 *     the highest bonus;
 *   - a typed penalty does not stack with another penalty of the same type:
 *     keep the worst (most negative) penalty;
 *   - untyped modifiers stack across different sources, but an untyped
 *     modifier from the same source does not stack with itself.
 *
 * The resolver is a pure function. It never rolls dice and never mutates the
 * supplied modifier array.
 *
 * Modifier shape:
 *   { name: string, type: ModifierType, value: number, source?: string }
 *
 * `source` is only used to deduplicate untyped modifiers. When omitted, the
 * modifier name is used as its source.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Rules = root.PF2e.Core.Rules || {};
    root.PF2e.Core.Rules.Modifiers = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MODIFIER_TYPES = Object.freeze({
    CIRCUMSTANCE: "circumstance",
    STATUS: "status",
    ITEM: "item",
    UNTYPED: "untyped",
  });

  const TYPE_ORDER = Object.freeze([
    MODIFIER_TYPES.CIRCUMSTANCE,
    MODIFIER_TYPES.STATUS,
    MODIFIER_TYPES.ITEM,
    MODIFIER_TYPES.UNTYPED,
  ]);

  const TYPED_TYPES = Object.freeze([
    MODIFIER_TYPES.CIRCUMSTANCE,
    MODIFIER_TYPES.STATUS,
    MODIFIER_TYPES.ITEM,
  ]);

  function assertInteger(value, label) {
    if (!Number.isInteger(value)) {
      throw new TypeError(label + " must be an integer; received " + String(value) + ".");
    }
  }

  function isModifierType(value) {
    if (typeof value !== "string") {
      return false;
    }
    return TYPE_ORDER.indexOf(value.toLowerCase()) !== -1;
  }

  function normalizeModifier(raw, index) {
    if (raw === null || typeof raw !== "object") {
      throw new TypeError("modifier[" + index + "] must be an object.");
    }

    const type =
      raw.type === undefined
        ? MODIFIER_TYPES.UNTYPED
        : String(raw.type).toLowerCase();
    if (!isModifierType(type)) {
      throw new RangeError(
        "modifier[" + index + "].type must be circumstance, status, item, or untyped.",
      );
    }
    assertInteger(raw.value, "modifier[" + index + "].value");

    const name =
      typeof raw.name === "string" && raw.name.trim() !== ""
        ? raw.name
        : "Unnamed " + type + " modifier";
    const source =
      typeof raw.source === "string" && raw.source.trim() !== ""
        ? raw.source
        : name;

    return {
      name: name,
      type: type,
      value: raw.value,
      source: source,
      _index: index,
    };
  }

  function publicModifier(modifier) {
    return {
      name: modifier.name,
      type: modifier.type,
      value: modifier.value,
      source: modifier.source,
    };
  }

  function byIndex(a, b) {
    return a._index - b._index;
  }

  function sumValues(modifiers) {
    return modifiers.reduce(function (total, modifier) {
      return total + modifier.value;
    }, 0);
  }

  /**
   * Resolve typed modifiers for a single type.
   * Keep the highest bonus and the worst penalty. All other same-type
   * modifiers are suppressed.
   */
  function resolveTypedGroup(type, group) {
    let bestBonus = null;
    let worstPenalty = null;
    const suppressed = [];

    for (const modifier of group) {
      if (modifier.value > 0) {
        if (bestBonus === null || modifier.value > bestBonus.value) {
          if (bestBonus !== null) {
            suppressed.push(bestBonus);
          }
          bestBonus = modifier;
        } else {
          suppressed.push(modifier);
        }
      } else if (modifier.value < 0) {
        if (worstPenalty === null || modifier.value < worstPenalty.value) {
          if (worstPenalty !== null) {
            suppressed.push(worstPenalty);
          }
          worstPenalty = modifier;
        } else {
          suppressed.push(modifier);
        }
      } else {
        // A zero modifier is inert but still useful in the audit trail.
        suppressed.push(modifier);
      }
    }

    const applied = [];
    if (bestBonus !== null) {
      applied.push(bestBonus);
    }
    if (worstPenalty !== null) {
      applied.push(worstPenalty);
    }
    applied.sort(byIndex);

    return {
      applied: applied,
      suppressed: suppressed.sort(byIndex),
      bonus: bestBonus === null ? 0 : bestBonus.value,
      penalty: worstPenalty === null ? 0 : worstPenalty.value,
    };
  }

  /**
   * Resolve untyped modifiers. Untyped values from different sources stack,
   * while the best bonus / worst penalty from a single source only applies
   * once. This mirrors the Remastered "untyped penalties stack unless they
   * come from the same source" rule.
   */
  function resolveUntypedGroup(group) {
    const bySource = new Map();
    const sourceOrder = [];

    for (const modifier of group) {
      const key = modifier.source;
      if (!bySource.has(key)) {
        bySource.set(key, []);
        sourceOrder.push(key);
      }
      bySource.get(key).push(modifier);
    }

    const applied = [];
    const suppressed = [];

    for (const source of sourceOrder) {
      const modifiers = bySource.get(source);
      let bestBonus = null;
      let worstPenalty = null;

      for (const modifier of modifiers) {
        if (modifier.value > 0) {
          if (bestBonus === null || modifier.value > bestBonus.value) {
            if (bestBonus !== null) {
              suppressed.push(bestBonus);
            }
            bestBonus = modifier;
          } else {
            suppressed.push(modifier);
          }
        } else if (modifier.value < 0) {
          if (worstPenalty === null || modifier.value < worstPenalty.value) {
            if (worstPenalty !== null) {
              suppressed.push(worstPenalty);
            }
            worstPenalty = modifier;
          } else {
            suppressed.push(modifier);
          }
        } else {
          suppressed.push(modifier);
        }
      }

      if (bestBonus !== null) {
        applied.push(bestBonus);
      }
      if (worstPenalty !== null) {
        applied.push(worstPenalty);
      }
    }

    applied.sort(byIndex);

    return {
      applied: applied,
      suppressed: suppressed.sort(byIndex),
      bonus: sumValues(
        applied.filter(function (modifier) {
          return modifier.value > 0;
        }),
      ),
      penalty: sumValues(
        applied.filter(function (modifier) {
          return modifier.value < 0;
        }),
      ),
    };
  }

  /**
   * @param {number} baseValue
   * @param {{name?:string,type?:string,value:number,source?:string}[]} [modifiers]
   * @returns {{
   *   total: number,
   *   baseValue: number,
   *   modifierTotal: number,
   *   bonusTotal: number,
   *   penaltyTotal: number,
   *   breakdown: object[],
   *   effectiveModifiers: object[],
   *   suppressedModifiers: object[]
   * }}
   */
  function resolveModifiers(baseValue, modifiers) {
    assertInteger(baseValue, "baseValue");

    const raw = modifiers === undefined || modifiers === null ? [] : modifiers;
    if (!Array.isArray(raw)) {
      throw new TypeError("modifiers must be an array.");
    }

    const list = raw.map(normalizeModifier);
    const effective = [];
    const suppressed = [];
    const breakdown = [];

    for (const type of TYPED_TYPES) {
      const group = list.filter(function (modifier) {
        return modifier.type === type;
      });
      const resolved = resolveTypedGroup(type, group);

      effective.push.apply(effective, resolved.applied);
      suppressed.push.apply(suppressed, resolved.suppressed);
      breakdown.push({
        type: type,
        bonus: resolved.bonus,
        penalty: resolved.penalty,
        subtotal: resolved.bonus + resolved.penalty,
        applied: resolved.applied.map(publicModifier),
        suppressed: resolved.suppressed.map(publicModifier),
      });
    }

    const untypedGroup = list.filter(function (modifier) {
      return modifier.type === MODIFIER_TYPES.UNTYPED;
    });
    const untyped = resolveUntypedGroup(untypedGroup);

    effective.push.apply(effective, untyped.applied);
    suppressed.push.apply(suppressed, untyped.suppressed);
    breakdown.push({
      type: MODIFIER_TYPES.UNTYPED,
      bonus: untyped.bonus,
      penalty: untyped.penalty,
      subtotal: untyped.bonus + untyped.penalty,
      applied: untyped.applied.map(publicModifier),
      suppressed: untyped.suppressed.map(publicModifier),
    });

    effective.sort(byIndex);
    suppressed.sort(byIndex);

    const modifierTotal = sumValues(effective);
    const bonusTotal = sumValues(
      effective.filter(function (modifier) {
        return modifier.value > 0;
      }),
    );
    const penaltyTotal = sumValues(
      effective.filter(function (modifier) {
        return modifier.value < 0;
      }),
    );

    return {
      total: baseValue + modifierTotal,
      baseValue: baseValue,
      modifierTotal: modifierTotal,
      bonusTotal: bonusTotal,
      penaltyTotal: penaltyTotal,
      breakdown: breakdown,
      effectiveModifiers: effective.map(publicModifier),
      suppressedModifiers: suppressed.map(publicModifier),
    };
  }

  /**
   * Convenience helper for callers that only need the final number.
   *
   * @param {number} baseValue
   * @param {object[]} [modifiers]
   * @returns {number}
   */
  function totalModifier(baseValue, modifiers) {
    return resolveModifiers(baseValue, modifiers).total;
  }

  return Object.freeze({
    MODIFIER_TYPES: MODIFIER_TYPES,
    ModifierType: MODIFIER_TYPES,
    TYPE_ORDER: TYPE_ORDER,
    isModifierType: isModifierType,
    resolveModifiers: resolveModifiers,
    totalModifier: totalModifier,
  });
});
