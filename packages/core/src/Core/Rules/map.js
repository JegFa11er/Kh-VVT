/**
 * PF2E REMASTERED — MULTIPLE ATTACK PENALTY (HEADLESS CORE)
 *
 * The penalty depends on how many attacks the combatant has already made this
 * turn (0-based count):
 *   - normal weapon: 0 / -5 / -10
 *   - agile weapon:  0 / -4 / -8
 *
 * The penalty is a plain untyped penalty and never stacks with itself.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Rules = root.PF2e.Core.Rules || {};
    root.PF2e.Core.Rules.MultipleAttack = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function assertAttacksMade(value) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError("attacksMade must be a non-negative integer.");
    }
  }

  /**
   * @param {number} attacksMade number of attacks already made this turn
   * @param {boolean} agile whether the weapon has the agile trait
   * @returns {number} 0, -4/-5, or -8/-10
   */
  function multipleAttackPenalty(attacksMade, agile) {
    assertAttacksMade(attacksMade);
    const isAgile = agile === true;

    if (attacksMade === 0) {
      return 0;
    }
    if (attacksMade === 1) {
      return isAgile ? -4 : -5;
    }
    return isAgile ? -8 : -10;
  }

  /**
   * Human-readable form used by logs, e.g. "-0", "-5".
   *
   * @param {number} penalty
   * @returns {string}
   */
  function formatPenalty(penalty) {
    if (!Number.isInteger(penalty)) {
      throw new TypeError("penalty must be an integer.");
    }
    return penalty === 0 ? "-0" : String(penalty);
  }

  return Object.freeze({
    multipleAttackPenalty: multipleAttackPenalty,
    formatPenalty: formatPenalty,
  });
});
