/**
 * PF2E REMASTERED — CREATURE SIZE CATEGORIES (HEADLESS CORE)
 *
 * Canonical size ladder used by Athletics maneuvers and footprint geometry:
 *
 *   tiny (0) -> small (1) -> medium (1) -> large (2) -> huge (3)
 *   -> gargantuan (4)
 *
 * Small and Medium share rank 1 exactly as the Remastered size table does.
 * A Trip/Shove/Grapple may target a creature at most one rank larger than the
 * attacker; the rank comparison is the single source of truth for that rule.
 *
 * Footprints are the number of 5-ft squares along one edge:
 * tiny/small/medium = 1x1, large = 2x2, huge = 3x3, gargantuan = 4x4.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Rules = root.PF2e.Core.Rules || {};
    root.PF2e.Core.Rules.Size = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SIZE_RANKS = Object.freeze({
    tiny: 0,
    small: 1,
    medium: 1,
    large: 2,
    huge: 3,
    gargantuan: 4,
  });

  const SIZE_NAMES = Object.freeze([
    "tiny",
    "small",
    "medium",
    "large",
    "huge",
    "gargantuan",
  ]);

  const SIZE_FOOTPRINTS = Object.freeze({
    tiny: 1,
    small: 1,
    medium: 1,
    large: 2,
    huge: 3,
    gargantuan: 4,
  });

  const SIZE_ALIASES = Object.freeze({
    tiny: "tiny",
    sm: "small",
    small: "small",
    med: "medium",
    medium: "medium",
    md: "medium",
    large: "large",
    lg: "large",
    huge: "huge",
    hg: "huge",
    gargantuan: "gargantuan",
    grg: "gargantuan",
  });

  /**
   * Normalize an authored size token. Unknown or omitted sizes default to
   * medium, preserving the legacy fixtures that let `size` fall back.
   *
   * @param {string} [value]
   * @returns {"tiny"|"small"|"medium"|"large"|"huge"|"gargantuan"}
   */
  function normalizeSize(value) {
    if (value === undefined || value === null || value === "") {
      return "medium";
    }
    const text = String(value)
      .trim()
      .toLowerCase()
      .replace(/[_\s-]+/g, " ");
    return SIZE_ALIASES[text] || "medium";
  }

  /**
   * @param {string} [size]
   * @returns {number} rank from 0 (tiny) through 4 (gargantuan)
   */
  function sizeRankOfName(size) {
    return SIZE_RANKS[normalizeSize(size)];
  }

  /**
   * @param {string} [size]
   * @returns {number} squares along one edge of the footprint
   */
  function getFootprintForSize(size) {
    return SIZE_FOOTPRINTS[normalizeSize(size)];
  }

  /**
   * Rank of a combatant or a plain `{ size }` record. Combatants expose
   * `getSizeRank()`; plain fixtures fall back to their authored `size`.
   *
   * @param {object} unit
   * @returns {number}
   */
  function sizeRankOf(unit) {
    if (unit !== null && typeof unit === "object") {
      if (typeof unit.getSizeRank === "function") {
        const rank = unit.getSizeRank();
        if (Number.isInteger(rank)) {
          return rank;
        }
      }
      return sizeRankOfName(unit.size);
    }
    return sizeRankOfName(undefined);
  }

  /**
   * Trip, Shove, and Grapple may target a creature no more than one size
   * category larger than the attacker (CRB p.242 / Remastered p.236).
   *
   * @param {object} attacker
   * @param {object} target
   * @returns {boolean}
   */
  function canManeuverTarget(attacker, target) {
    const attackerRank = sizeRankOf(attacker);
    const targetRank = sizeRankOf(target);
    return targetRank <= attackerRank + 1;
  }

  return Object.freeze({
    SIZE_RANKS: SIZE_RANKS,
    SIZE_NAMES: SIZE_NAMES,
    SIZE_FOOTPRINTS: SIZE_FOOTPRINTS,
    normalizeSize: normalizeSize,
    sizeRankOfName: sizeRankOfName,
    getFootprintForSize: getFootprintForSize,
    sizeRankOf: sizeRankOf,
    canManeuverTarget: canManeuverTarget,
  });
});
