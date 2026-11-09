/**
 * PF2E REMASTERED — TAKE COVER ACTION (HEADLESS CORE)
 *
 * Take Cover costs 1 action. A creature can only take cover when it already
 * has standard cover or better from a visible obstacle or attacker. The action
 * applies the `greater-cover` condition:
 *
 *   +4 circumstance bonus to AC until the start of the creature's next turn
 *   or until it next moves (Stride or Step).
 *
 * The bonus is owned by the condition and flows through the central modifier
 * resolver. It therefore does not stack with Shield Raised (+2 circumstance)
 * or geometric cover; the resolver keeps the highest circumstance bonus.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../Grid/cover.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.TakeCover = factory(root.PF2e.Core.Cover);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Cover) {
  "use strict";

  const TAKE_COVER_REASONS = Object.freeze({
    NO_ACTIONS: "no-actions",
    INSUFFICIENT_COVER: "insufficient-cover",
  });

  const ACTION_COST = 1;
  const GREATER_COVER = "greater-cover";
  const GREATER_COVER_AC = 4;

  function assertCombatant(combatant) {
    if (combatant === null || typeof combatant !== "object") {
      throw new TypeError("Take Cover requires a Combatant.");
    }
    if (
      typeof combatant.canSpendActions !== "function" ||
      typeof combatant.spendActions !== "function"
    ) {
      throw new TypeError("Take Cover requires a Combatant with an action pool.");
    }
    if (typeof combatant.addCondition !== "function") {
      throw new TypeError("Take Cover requires a Combatant with a condition store.");
    }
  }

  function resolveCover(options) {
    const opts = options || {};
    const combatant = opts.combatant;

    if (opts.attacker !== undefined && opts.attacker !== null) {
      return Cover.determineCover(
        opts.attacker,
        combatant,
        opts.map,
        opts.combatants,
      );
    }

    return Cover.getBestCover(
      combatant,
      opts.combatants,
      opts.map,
      { hostileOnly: true },
    );
  }

  /**
   * Geometry-only check. Does not spend an action.
   *
   * @param {{
   *   combatant: object,
   *   map: object,
   *   combatants?: object[],
   *   attacker?: object
   * }} options
   * @returns {{ok:true, cover:object} | {ok:false, reason:string, cover:object}}
   */
  function canTakeCover(options) {
    const opts = options || {};
    assertCombatant(opts.combatant);
    if (!opts.map || typeof opts.map.hasObstacle !== "function") {
      throw new TypeError("Take Cover requires a GridMap.");
    }

    const cover = resolveCover(opts);
    if (!Cover.isStandardOrGreater(cover)) {
      return {
        ok: false,
        reason: TAKE_COVER_REASONS.INSUFFICIENT_COVER,
        cover: cover,
      };
    }

    return { ok: true, cover: cover };
  }

  /**
   * @param {{
   *   combatant: object,
   *   map: object,
   *   combatants?: object[],
   *   attacker?: object
   * }} options
   * @returns {{
   *   ok: true,
   *   actionsLeft: number,
   *   condition: object|null,
   *   cover: object,
   *   coverDegree: "greater",
   *   acBonus: 4
   * } | {
   *   ok: false,
   *   reason: "no-actions"|"insufficient-cover",
   *   cover?: object
   * }}
   */
  function performTakeCover(options) {
    const opts = options || {};
    const combatant = opts.combatant;

    assertCombatant(combatant);

    if (!combatant.canSpendActions(ACTION_COST)) {
      return { ok: false, reason: TAKE_COVER_REASONS.NO_ACTIONS };
    }

    const evaluation = canTakeCover(opts);
    if (!evaluation.ok) {
      return evaluation;
    }

    combatant.spendActions(ACTION_COST);
    const condition = combatant.addCondition(GREATER_COVER);

    return {
      ok: true,
      actionsLeft: combatant.actionsRemaining,
      condition: condition,
      cover: evaluation.cover,
      coverDegree: Cover.COVER_DEGREES.GREATER,
      acBonus: GREATER_COVER_AC,
      requiredCover: evaluation.cover.degree,
    };
  }

  return Object.freeze({
    TAKE_COVER_REASONS: TAKE_COVER_REASONS,
    ACTION_COST: ACTION_COST,
    GREATER_COVER: GREATER_COVER,
    GREATER_COVER_AC: GREATER_COVER_AC,
    canTakeCover: canTakeCover,
    performTakeCover: performTakeCover,
  });
});
