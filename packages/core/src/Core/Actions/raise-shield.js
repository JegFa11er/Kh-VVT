/**
 * PF2E REMASTERED — RAISE A SHIELD ACTION (HEADLESS CORE)
 *
 * Raise a Shield: 1 action. The combatant gains a +2 circumstance bonus to AC
 * until the start of its next turn. The bonus itself is owned by the
 * `shield-raised` condition and flows through the central modifier resolver, so
 * it never stacks with another circumstance bonus and remains independent from
 * same-type circumstance penalties such as Off-Guard.
 *
 * Raising the shield again while the condition is already active still spends
 * an action, matching the table rules. Because the condition is keyed by slug,
 * the second application refreshes the same condition and does not double the
 * AC bonus.
 *
 * Combatant.resetTurn() removes the condition at the start of the raiser's next
 * turn.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../Entities/shield.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.RaiseShield = factory(root.PF2e.Core.Shield);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Shield) {
  "use strict";

  const RAISE_SHIELD_REASONS = Object.freeze({
    NO_ACTIONS: "no-actions",
    SHIELD_BROKEN: "shield-broken",
    SHIELD_DESTROYED: "shield-destroyed",
  });

  const ACTION_COST = 1;
  const SHIELD_RAISED = "shield-raised";

  function assertCombatant(combatant) {
    if (combatant === null || typeof combatant !== "object") {
      throw new TypeError("Raise a Shield requires a Combatant.");
    }
    if (
      typeof combatant.canSpendActions !== "function" ||
      typeof combatant.spendActions !== "function"
    ) {
      throw new TypeError("Raise a Shield requires a Combatant with an action pool.");
    }
    if (typeof combatant.addCondition !== "function") {
      throw new TypeError("Raise a Shield requires a Combatant with a condition store.");
    }
  }

  /**
   * Spend one action and apply (or refresh) the shield-raised condition.
   *
   * @param {{combatant: object}} options
   * @returns {{
   *   ok: true,
   *   actionsLeft: number,
   *   condition: object|null
   * } | { ok: false, reason: "no-actions" }}
   */
  function performRaiseShield(options) {
    const opts = options || {};
    const combatant = opts.combatant;

    assertCombatant(combatant);

    // A broken or destroyed shield cannot be raised. Combatants without an
    // authored shield keep the legacy condition-only behaviour used by the
    // isolated headless fixtures.
    if (Shield && combatant.shield) {
      if (Shield.isShieldDestroyed(combatant.shield)) {
        return { ok: false, reason: RAISE_SHIELD_REASONS.SHIELD_DESTROYED };
      }
      if (Shield.isShieldBroken(combatant.shield)) {
        return { ok: false, reason: RAISE_SHIELD_REASONS.SHIELD_BROKEN };
      }
    }

    if (!combatant.canSpendActions(ACTION_COST)) {
      return { ok: false, reason: RAISE_SHIELD_REASONS.NO_ACTIONS };
    }

    combatant.spendActions(ACTION_COST);
    const condition = combatant.addCondition(SHIELD_RAISED);

    return {
      ok: true,
      actionsLeft: combatant.actionsRemaining,
      condition: condition,
    };
  }

  return Object.freeze({
    RAISE_SHIELD_REASONS: RAISE_SHIELD_REASONS,
    ACTION_COST: ACTION_COST,
    SHIELD_RAISED: SHIELD_RAISED,
    performRaiseShield: performRaiseShield,
  });
});
