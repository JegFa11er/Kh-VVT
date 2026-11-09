/**
 * PF2E REMASTERED — D20 CHECKS & DEGREES OF SUCCESS (HEADLESS CORE)
 *
 * Implements the Remastered check pipeline:
 *   total = d20 + modifier
 *   total >= DC + 10  -> CRITICAL_SUCCESS
 *   total >= DC       -> SUCCESS
 *   total <= DC - 10  -> CRITICAL_FAILURE
 *   otherwise         -> FAILURE
 *
 * A natural 20 increases the degree one step; a natural 1 decreases it one
 * step. Both adjustments are capped at CRITICAL_SUCCESS / CRITICAL_FAILURE.
 *
 * No presentation state and no random source live here: the caller supplies
 * the d20 result.
 *
 * A defended saving-throw or skill DC (Reflex DC, Will DC, Fortitude DC, or a
 * skill-based DC) is `10 + base value + situational modifiers`. `calculateDC`
 * routes the modifiers through the same typed modifier resolver as attack
 * rolls, so Frightened, cover, and other typed bonuses never stack incorrectly
 * at the DC boundary. AC is already a DC and is resolved directly by Strike.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./modifiers.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Rules = root.PF2e.Core.Rules || {};
    root.PF2e.Core.Rules.Checks = factory(root.PF2e.Core.Rules.Modifiers);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Modifiers) {
  "use strict";

  const DEGREES = Object.freeze({
    CRITICAL_FAILURE: "CRITICAL_FAILURE",
    FAILURE: "FAILURE",
    SUCCESS: "SUCCESS",
    CRITICAL_SUCCESS: "CRITICAL_SUCCESS",
  });

  /** Lowest to highest. Used for natural 20 / natural 1 shifts. */
  const DEGREE_ORDER = Object.freeze([
    DEGREES.CRITICAL_FAILURE,
    DEGREES.FAILURE,
    DEGREES.SUCCESS,
    DEGREES.CRITICAL_SUCCESS,
  ]);

  function assertInteger(value, label) {
    if (!Number.isInteger(value)) {
      throw new TypeError(label + " must be an integer; received " + String(value) + ".");
    }
  }

  /**
   * Shift a degree by whole steps, clamped to the legal range.
   *
   * @param {string} degree
   * @param {number} steps
   * @returns {string}
   */
  function shiftDegree(degree, steps) {
    assertInteger(steps, "steps");
    const index = DEGREE_ORDER.indexOf(degree);
    if (index === -1) {
      throw new RangeError("Unknown degree of success: " + String(degree) + ".");
    }
    const next = Math.max(0, Math.min(DEGREE_ORDER.length - 1, index + steps));
    return DEGREE_ORDER[next];
  }

  /**
   * Base degree from the total versus the DC, before natural 20/1 adjustment.
   *
   * @param {number} total
   * @param {number} dc
   * @returns {string}
   */
  function classifyTotal(total, dc) {
    assertInteger(total, "total");
    assertInteger(dc, "dc");

    if (total >= dc + 10) {
      return DEGREES.CRITICAL_SUCCESS;
    }
    if (total >= dc) {
      return DEGREES.SUCCESS;
    }
    if (total <= dc - 10) {
      return DEGREES.CRITICAL_FAILURE;
    }
    return DEGREES.FAILURE;
  }

  /**
   * Resolve the d20 value for a flat check. Tests inject `d20` or `rollD20`;
   * the browser host relies on the Math.random fallback.
   *
   * @param {object} options
   * @returns {number}
   */
  function resolveFlatCheckD20(options) {
    const opts = options || {};
    let value;

    if (opts.d20 !== undefined) {
      value = opts.d20;
    } else if (typeof opts.rollD20 === "function") {
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
   * PF2e Remastered flat check: a d20 with no modifiers against a fixed DC.
   * Used for Concealed (DC 5), Hidden (DC 11), persistent damage, and recovery.
   *
   * @param {{ d20?: number, dc: number, rollD20?: () => number, rollDie?: (sides:number)=>number }} options
   * @returns {{ passed: boolean, d20: number, dc: number }}
   */
  function evaluateFlatCheck(options) {
    const opts = options || {};
    assertInteger(opts.dc, "dc");

    const d20 = resolveFlatCheckD20(opts);
    return {
      passed: d20 >= opts.dc,
      d20: d20,
      dc: opts.dc,
    };
  }

  /**
   * @param {{ d20: number, modifier: number, dc: number }} options
   * @returns {{
   *   d20: number,
   *   modifier: number,
   *   total: number,
   *   dc: number,
   *   degree: string,
   *   isNatural20: boolean,
   *   isNatural1: boolean
   * }}
   */
  function evaluateCheck(options) {
    const opts = options || {};

    assertInteger(opts.d20, "d20");
    if (opts.d20 < 1 || opts.d20 > 20) {
      throw new RangeError("d20 must be an integer from 1 to 20.");
    }
    assertInteger(opts.modifier, "modifier");
    assertInteger(opts.dc, "dc");

    const total = opts.d20 + opts.modifier;
    const isNatural20 = opts.d20 === 20;
    const isNatural1 = opts.d20 === 1;

    let degree = classifyTotal(total, opts.dc);
    if (isNatural20) {
      degree = shiftDegree(degree, 1);
    } else if (isNatural1) {
      degree = shiftDegree(degree, -1);
    }

    return {
      d20: opts.d20,
      modifier: opts.modifier,
      total: total,
      dc: opts.dc,
      degree: degree,
      isNatural20: isNatural20,
      isNatural1: isNatural1,
    };
  }

  /**
   * Defended DC formula: `10 + baseValue + modifiers`.
   *
   * `baseValue` is the defender's saving-throw or skill modifier. Situational
   * modifiers (Frightened, cover, and future item/status effects) flow through
   * `resolveModifiers`, so same-type bonuses and penalties do not stack.
   *
   * @param {number} baseValue
   * @param {{name?:string,type?:string,value:number,source?:string}[]} [modifiers]
   * @returns {number}
   */
  function calculateDC(baseValue, modifiers) {
    return resolveDC(baseValue, modifiers).total;
  }

  /**
   * Full audit form of `calculateDC`, used by Trip and the combat log.
   *
   * @param {number} baseValue
   * @param {object[]} [modifiers]
   * @returns {object} the `resolveModifiers` result with the DC in `total`
   */
  function resolveDC(baseValue, modifiers) {
    assertInteger(baseValue, "baseValue");
    const list = modifiers === undefined || modifiers === null ? [] : modifiers;
    if (!Array.isArray(list)) {
      throw new TypeError("modifiers must be an array.");
    }
    if (!Modifiers || typeof Modifiers.resolveModifiers !== "function") {
      throw new Error("calculateDC requires the modifier resolver.");
    }
    return Modifiers.resolveModifiers(10 + baseValue, list);
  }

  return Object.freeze({
    DEGREES: DEGREES,
    DEGREE_ORDER: DEGREE_ORDER,
    shiftDegree: shiftDegree,
    classifyTotal: classifyTotal,
    evaluateCheck: evaluateCheck,
    evaluateFlatCheck: evaluateFlatCheck,
    calculateDC: calculateDC,
    resolveDC: resolveDC,
  });
});
