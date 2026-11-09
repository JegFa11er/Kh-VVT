/**
 * PF2E REMASTERED — INITIATIVE ENGINE (HEADLESS CORE)
 *
 * PF2e initiative is a skill check: d20 + the modifier of the statistic the
 * creature uses. Perception is the default; Stealth is used when the creature
 * begins the encounter hidden, concealed, or otherwise from cover/stealth.
 *
 * Canonical tie-breaking implemented here (deterministic and total):
 *   1. Enemies act before allies/PCs.
 *   2. Within the same alliance, the higher base statistic modifier acts first.
 *   3. An absolute tie preserves stable registration order, then id order.
 *
 * The module is pure: it mutates only the initiative fields on the supplied
 * combatants and returns an audit. Randomness is injectable so tests can feed
 * exact d20 faces.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Initiative = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const INITIATIVE_STATISTICS = Object.freeze(["perception", "stealth"]);
  const DEFAULT_STATISTIC = "perception";

  const STEALTH_CONDITIONS = Object.freeze([
    "concealed",
    "hidden",
    "undetected",
  ]);

  const STEALTH_FLAGS = Object.freeze([
    "startsInCover",
    "startsHidden",
    "startsFromStealth",
    "fromCover",
    "inCover",
    "fromStealth",
    "fromHide",
    "stealthInitiative",
    "hidden",
    "concealed",
    "undetected",
  ]);

  function assertCombatants(combatants) {
    if (!Array.isArray(combatants)) {
      throw new TypeError("combatants must be an array.");
    }
    const ids = new Set();
    for (const combatant of combatants) {
      if (combatant === null || typeof combatant !== "object") {
        throw new TypeError("Every combatant must be an object.");
      }
      if (typeof combatant.id !== "string" || combatant.id.trim() === "") {
        throw new TypeError("Every combatant must have a non-empty string id.");
      }
      if (ids.has(combatant.id)) {
        throw new RangeError("Duplicate combatant id: " + combatant.id + ".");
      }
      ids.add(combatant.id);
    }
    return combatants;
  }

  function normalizeStatistic(value, label) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(label + " must be a non-empty statistic name.");
    }
    return value.trim().toLowerCase();
  }

  function hasStealthCondition(combatant) {
    if (typeof combatant.hasCondition === "function") {
      return STEALTH_CONDITIONS.some(function (name) {
        return combatant.hasCondition(name) === true;
      });
    }
    if (combatant.conditions instanceof Map) {
      return STEALTH_CONDITIONS.some(function (name) {
        return combatant.conditions.has(name);
      });
    }
    return false;
  }

  /**
   * Decide which statistic a combatant uses for initiative.
   *
   * Precedence:
   *   - explicit per-combatant entry in `options.statistics`;
   *   - a global `options.statistic`;
   *   - a previously authored `combatant.initiativeStatistic`;
   *   - Stealth when the combatant starts concealed/hidden/undetected or an
   *     authored cover/stealth flag is set;
   *   - Perception.
   *
   * @param {object} combatant
   * @param {{statistic?:string, statistics?:Object<string,string>, stealth?:boolean, useStealth?:boolean}} [options]
   * @returns {string}
   */
  function resolveInitiativeStatistic(combatant, options) {
    const opts = options || {};
    if (
      opts.statistics !== undefined &&
      opts.statistics !== null &&
      typeof opts.statistics === "object" &&
      typeof opts.statistics[combatant.id] === "string"
    ) {
      return normalizeStatistic(
        opts.statistics[combatant.id],
        "statistics[" + combatant.id + "]",
      );
    }
    if (opts.statistic !== undefined && opts.statistic !== null) {
      return normalizeStatistic(opts.statistic, "statistic");
    }
    if (
      typeof combatant.initiativeStatistic === "string" &&
      combatant.initiativeStatistic.trim() !== ""
    ) {
      return normalizeStatistic(
        combatant.initiativeStatistic,
        "combatant.initiativeStatistic",
      );
    }
    if (opts.stealth === true || opts.useStealth === true) {
      return "stealth";
    }
    for (const flag of STEALTH_FLAGS) {
      if (combatant[flag] === true) {
        return "stealth";
      }
    }
    if (hasStealthCondition(combatant)) {
      return "stealth";
    }
    return DEFAULT_STATISTIC;
  }

  /**
   * Base modifier of the statistic used for initiative.
   *
   * @param {object} combatant
   * @param {string} statistic
   * @returns {number}
   */
  function getInitiativeModifier(combatant, statistic) {
    const name = normalizeStatistic(statistic, "statistic");
    if (typeof combatant.getSkillModifier === "function") {
      const value = combatant.getSkillModifier(name);
      if (Number.isInteger(value)) {
        return value;
      }
    }
    if (
      combatant.skills !== null &&
      typeof combatant.skills === "object" &&
      Number.isInteger(combatant.skills[name])
    ) {
      return combatant.skills[name];
    }
    return 0;
  }

  function readRollValue(entry) {
    if (Number.isInteger(entry)) {
      return entry;
    }
    if (entry !== null && typeof entry === "object") {
      if (Number.isInteger(entry.d20)) {
        return entry.d20;
      }
      if (Number.isInteger(entry.roll)) {
        return entry.roll;
      }
      if (Number.isInteger(entry.value)) {
        return entry.value;
      }
    }
    return undefined;
  }

  /**
   * Resolve the d20 for one combatant. Deterministic callers may supply:
   *   - `options.rolls[id] = 12` (or `{ d20: 12 }`);
   *   - `options.rolls = [12, 7, ...]` in roster order;
   *   - `options.rollD20(combatant)` / `options.rollDie(20)`.
   *
   * @param {object} combatant
   * @param {object} options
   * @param {number} index roster index for array-form rolls
   * @returns {number}
   */
  function resolveD20(combatant, options, index) {
    const opts = options || {};
    const rolls = opts.rolls;
    let value;

    if (Array.isArray(rolls)) {
      value = readRollValue(rolls[index]);
    } else if (rolls !== null && typeof rolls === "object") {
      value = readRollValue(rolls[combatant.id]);
    } else if (typeof rolls === "function") {
      value = rolls(combatant, index);
    }

    if (value === undefined) {
      if (typeof opts.rollD20 === "function") {
        value = opts.rollD20(combatant, index);
      } else if (typeof opts.rollDie === "function") {
        value = opts.rollDie(20);
      } else {
        value = 1 + Math.floor(Math.random() * 20);
      }
    }

    if (!Number.isInteger(value)) {
      throw new TypeError("Initiative d20 must be an integer.");
    }
    if (value < 1 || value > 20) {
      throw new RangeError("Initiative d20 must be between 1 and 20.");
    }
    return value;
  }

  /**
   * Enemy/allied priority: enemies (hostile) sort before allies and PCs.
   *
   * @param {object} combatant
   * @returns {number} 0 for enemy, 1 otherwise
   */
  function alliancePriority(combatant) {
    return combatant.alliance === "enemy" ? 0 : 1;
  }

  function registrationIndex(combatant, registration) {
    if (registration instanceof Map) {
      return registration.has(combatant.id)
        ? registration.get(combatant.id)
        : Number.MAX_SAFE_INTEGER;
    }
    if (
      registration !== null &&
      typeof registration === "object" &&
      Object.prototype.hasOwnProperty.call(registration, combatant.id)
    ) {
      return registration[combatant.id];
    }
    if (Number.isInteger(combatant.initiativeOrder)) {
      return combatant.initiativeOrder;
    }
    return Number.MAX_SAFE_INTEGER;
  }

  function compareIds(a, b) {
    const left = String(a.id);
    const right = String(b.id);
    if (left < right) {
      return -1;
    }
    if (left > right) {
      return 1;
    }
    return 0;
  }

  /**
   * Canonical PF2e Remastered tie-break comparator.
   *
   * @param {object} a
   * @param {object} b
   * @param {{registration?:Map<string,number>|Object<string,number>}} [options]
   * @returns {number}
   */
  function compareInitiative(a, b, options) {
    const opts = options || {};
    const aTotal = Number.isInteger(a.initiative) ? a.initiative : 0;
    const bTotal = Number.isInteger(b.initiative) ? b.initiative : 0;
    if (aTotal !== bTotal) {
      return bTotal - aTotal;
    }

    // 1. Enemies always act before allies.
    const allianceDelta = alliancePriority(a) - alliancePriority(b);
    if (allianceDelta !== 0) {
      return allianceDelta;
    }

    // 2. Same alliance: the higher base statistic modifier wins.
    const aModifier = Number.isInteger(a.initiativeModifier)
      ? a.initiativeModifier
      : getInitiativeModifier(
          a,
          typeof a.initiativeStatistic === "string"
            ? a.initiativeStatistic
            : DEFAULT_STATISTIC,
        );
    const bModifier = Number.isInteger(b.initiativeModifier)
      ? b.initiativeModifier
      : getInitiativeModifier(
          b,
          typeof b.initiativeStatistic === "string"
            ? b.initiativeStatistic
            : DEFAULT_STATISTIC,
        );
    if (aModifier !== bModifier) {
      return bModifier - aModifier;
    }

    // 3. Absolute tie: stable registration order, then stable id order.
    const aIndex = registrationIndex(a, opts.registration);
    const bIndex = registrationIndex(b, opts.registration);
    if (aIndex !== bIndex) {
      return aIndex - bIndex;
    }
    return compareIds(a, b);
  }

  /**
   * Sort a roster without mutating the input array.
   *
   * @param {object[]} combatants
   * @param {Map<string,number>|Object<string,number>} [registration]
   * @returns {object[]}
   */
  function sortInitiative(combatants, registration) {
    const roster = assertCombatants(combatants);
    const stableRegistration =
      registration === undefined || registration === null
        ? new Map(
            roster.map(function (combatant, index) {
              return [combatant.id, index];
            }),
          )
        : registration;
    return roster.slice().sort(function (a, b) {
      return compareInitiative(a, b, { registration: stableRegistration });
    });
  }

  /**
   * Roll initiative for every combatant, mutate their initiative fields, and
   * return the audit plus the sorted order.
   *
   * Each combatant receives:
   *   - `initiative`: d20 + statistic modifier;
   *   - `initiativeRoll`: the raw d20;
   *   - `initiativeStatistic`: "perception" or "stealth";
   *   - `initiativeModifier`: the base statistic modifier.
   *
   * @param {object[]} combatants
   * @param {{
   *   rolls?: Object<string,number>|number[]|Function,
   *   rollD20?: Function,
   *   rollDie?: Function,
   *   statistic?: string,
   *   statistics?: Object<string,string>,
   *   stealth?: boolean,
   *   registration?: Map<string,number>|Object<string,number>
   * }} [options]
   * @returns {{entries:object[], order:object[], rolls:Object<string,number>}}
   */
  function rollInitiative(combatants, options) {
    const opts = options || {};
    const roster = assertCombatants(combatants);
    const entries = [];
    const rolls = {};

    for (let index = 0; index < roster.length; index += 1) {
      const combatant = roster[index];
      const statistic = resolveInitiativeStatistic(combatant, opts);
      const modifier = getInitiativeModifier(combatant, statistic);
      const d20 = resolveD20(combatant, opts, index);
      const total = d20 + modifier;

      combatant.initiative = total;
      combatant.initiativeRoll = d20;
      combatant.initiativeStatistic = statistic;
      combatant.initiativeModifier = modifier;

      entries.push({
        combatantId: combatant.id,
        combatantName: combatant.name,
        d20: d20,
        modifier: modifier,
        statistic: statistic,
        total: total,
        alliance: combatant.alliance,
      });
      rolls[combatant.id] = d20;
    }

    const order = sortInitiative(roster, opts.registration);
    return { entries: entries, order: order, rolls: rolls };
  }

  return Object.freeze({
    INITIATIVE_STATISTICS: INITIATIVE_STATISTICS,
    DEFAULT_STATISTIC: DEFAULT_STATISTIC,
    STEALTH_CONDITIONS: STEALTH_CONDITIONS,
    resolveInitiativeStatistic: resolveInitiativeStatistic,
    getInitiativeModifier: getInitiativeModifier,
    resolveD20: resolveD20,
    alliancePriority: alliancePriority,
    compareInitiative: compareInitiative,
    sortInitiative: sortInitiative,
    rollInitiative: rollInitiative,
  });
});
