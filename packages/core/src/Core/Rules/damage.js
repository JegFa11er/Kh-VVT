/**
 * PF2E REMASTERED — DAMAGE FORMULA PARSING & ROLLING (HEADLESS CORE)
 *
 * Supported formula shape: one dice term plus an optional flat modifier,
 * e.g. "1d8+4", "2d6", "1d6 - 1", or a flat integer such as "3".
 *
 * Damage may also carry a type: { formula: "1d8+4", type: "slashing" }. A plain
 * string remains backwards compatible and resolves as `untyped`. IWR itself
 * lives in Rules/iwr.js; this module only parses and rolls the typed dice.
 *
 * The caller supplies a deterministic die callback in tests/replays. When no
 * callback is supplied, the default uses Math.random so the browser prototype
 * remains playable. The rules engine never decides which die face is rolled.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Rules = root.PF2e.Core.Rules || {};
    root.PF2e.Core.Rules.Damage = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DICE_PATTERN = /^\s*(\d*)d(\d+)\s*([+-]\s*\d+)?\s*$/i;
  const FLAT_PATTERN = /^\s*[+-]?\d+\s*$/;
  const DAMAGE_TYPE_PATTERN = /^[a-z][a-z-]*$/;

  const DEFAULT_DAMAGE_TYPE = "untyped";

  /**
   * Canonical damage types used by PF2e Remastered. Custom single-word slugs
   * are accepted too, because the ruleset keeps adding special damage types
   * (for example vitality/void in the Remaster). The list documents the common
   * values used by the UI and the demo encounter.
   */
  const DAMAGE_TYPES = Object.freeze([
    "acid",
    "bleed",
    "bludgeoning",
    "cold",
    "electricity",
    "fire",
    "force",
    "mental",
    "piercing",
    "poison",
    "precision",
    "slashing",
    "sonic",
    "spirit",
    "untyped",
    "vitality",
    "void",
  ]);

  function normalizeDamageType(type) {
    const value =
      type === undefined || type === null || type === ""
        ? DEFAULT_DAMAGE_TYPE
        : String(type).trim().toLowerCase();

    if (!DAMAGE_TYPE_PATTERN.test(value)) {
      throw new TypeError(
        'damage type must be a lower-case slug such as "slashing" or "fire"; received ' +
          String(type) +
          ".",
      );
    }
    return value;
  }

  function defaultRollDie(sides) {
    return 1 + Math.floor(Math.random() * sides);
  }

  /**
   * @param {string} formula
   * @returns {{ formula: string, diceCount: number, dieSize: number, modifier: number }}
   */
  function parseDamageFormula(formula) {
    if (typeof formula !== "string" || formula.trim() === "") {
      throw new TypeError("damage formula must be a non-empty string.");
    }

    const text = formula.trim();

    if (FLAT_PATTERN.test(text)) {
      return Object.freeze({
        formula: text,
        diceCount: 0,
        dieSize: 0,
        modifier: Number.parseInt(text, 10),
      });
    }

    const match = DICE_PATTERN.exec(text);
    if (!match) {
      throw new RangeError(
        'Unsupported damage formula "' + text + '"; expected NdM or NdM+K.',
      );
    }

    const diceCount = match[1] === "" ? 1 : Number.parseInt(match[1], 10);
    const dieSize = Number.parseInt(match[2], 10);
    const modifier = match[3] ? Number.parseInt(match[3].replace(/\s+/g, ""), 10) : 0;

    if (!Number.isInteger(diceCount) || diceCount <= 0) {
      throw new RangeError("Damage dice count must be a positive integer.");
    }
    if (!Number.isInteger(dieSize) || dieSize <= 0) {
      throw new RangeError("Damage die size must be a positive integer.");
    }
    if (!Number.isInteger(modifier)) {
      throw new RangeError("Damage modifier must be an integer.");
    }

    return Object.freeze({
      formula: text,
      diceCount: diceCount,
      dieSize: dieSize,
      modifier: modifier,
    });
  }

  /**
   * Normalize the damage contract used by Combatant and the attack actions.
   *
   * A plain formula string stays backwards compatible and is treated as
   * `untyped` unless a fallback type is supplied explicitly. The object form
   * carries the weapon/attack damage type:
   *
   *   "1d8+4"                     -> { formula: "1d8+4", type: "untyped" }
   *   { formula: "1d8+4", type: "slashing" }
   *
   * @param {string|{formula:string,type?:string,damageType?:string}} input
   * @param {string} [fallbackType] used for a plain string or when the object
   *   omits its type
   * @returns {{formula:string,type:string}}
   */
  function parseDamageSpec(input, fallbackType) {
    if (typeof input === "string") {
      const parsed = parseDamageFormula(input);
      return Object.freeze({
        formula: parsed.formula,
        type: normalizeDamageType(fallbackType),
      });
    }

    if (input !== null && typeof input === "object" && !Array.isArray(input)) {
      const formula =
        input.formula === undefined ? input.damage : input.formula;
      const declaredType =
        input.type === undefined ? input.damageType : input.type;
      const type = declaredType === undefined ? fallbackType : declaredType;
      const parsed = parseDamageFormula(formula);
      return Object.freeze({
        formula: parsed.formula,
        type: normalizeDamageType(type),
      });
    }

    throw new TypeError(
      "damage must be a formula string or an object { formula, type }.",
    );
  }

  /**
   * Human-readable "1d8+4 slashing" form for logs and the selection panel.
   *
   * @param {string|object} input
   * @param {string} [fallbackType]
   * @returns {string}
   */
  function formatDamageSpec(input, fallbackType) {
    const spec = parseDamageSpec(input, fallbackType);
    return spec.formula + " " + spec.type;
  }

  /**
   * Roll a damage formula once.
   *
   * @param {{
   *   formula: string,
   *   type?: string,
   *   rollDie?: (sides: number) => number
   * }} options
   * @returns {{
   *   formula: string,
   *   type: string|null,
   *   diceCount: number,
   *   dieSize: number,
   *   modifier: number,
   *   rolls: number[],
   *   diceTotal: number,
   *   baseTotal: number,
   *   total: number
   * }}
   */
  function rollDamage(options) {
    const opts = options || {};
    const parsed = parseDamageFormula(opts.formula);
    const type =
      opts.type === undefined || opts.type === null
        ? null
        : normalizeDamageType(opts.type);
    const rollDie =
      typeof opts.rollDie === "function" ? opts.rollDie : defaultRollDie;

    const rolls = [];
    let diceTotal = 0;
    for (let index = 0; index < parsed.diceCount; index += 1) {
      const value = rollDie(parsed.dieSize);
      if (!Number.isInteger(value) || value < 1 || value > parsed.dieSize) {
        throw new RangeError(
          "rollDie(" + parsed.dieSize + ") must return an integer from 1 to " + parsed.dieSize + ".",
        );
      }
      rolls.push(value);
      diceTotal += value;
    }

    const baseTotal = diceTotal + parsed.modifier;

    return {
      formula: parsed.formula,
      type: type,
      diceCount: parsed.diceCount,
      dieSize: parsed.dieSize,
      modifier: parsed.modifier,
      rolls: rolls,
      diceTotal: diceTotal,
      baseTotal: baseTotal,
      total: Math.max(0, baseTotal),
    };
  }

  return Object.freeze({
    DEFAULT_DAMAGE_TYPE: DEFAULT_DAMAGE_TYPE,
    DAMAGE_TYPES: DAMAGE_TYPES,
    defaultRollDie: defaultRollDie,
    normalizeDamageType: normalizeDamageType,
    parseDamageFormula: parseDamageFormula,
    parseDamageSpec: parseDamageSpec,
    formatDamageSpec: formatDamageSpec,
    rollDamage: rollDamage,
  });
});
