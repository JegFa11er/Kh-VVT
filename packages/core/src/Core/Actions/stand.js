/**
 * PF2E REMASTERED — STAND ACTION (HEADLESS CORE)
 *
 * Stand costs 1 action and removes the `prone` condition. It has the `move`
 * trait. In the Remastered rules, Stand no longer carries the legacy
 * "this movement doesn't trigger reactions" exception, so using a move action
 * provokes Reactive Strike from an enemy that threatens the creature's square.
 *
 * Reaction timing:
 *   - Reactive Strike resolves when the move action is used, before Stand
 *     finishes. The reacting enemy therefore attacks the creature while it is
 *     still prone (Off-Guard, -2 circumstance AC) and before the prone
 *     condition is removed.
 *   - If the reaction defeats the creature, the Stand is interrupted and the
 *     prone condition remains. Otherwise the condition is removed when the
 *     action completes.
 *
 * This mirrors the trigger scan used by Stride: the first eligible enemy in
 * roster order with a reaction reacts. A failed reaction attempt (for example
 * no line of sight) spends nothing and the scan continues.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./reactive-strike.js"),
      require("../Entities/conditions.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.Stand = factory(
      root.PF2e.Core.Actions.ReactiveStrike,
      root.PF2e.Core.Conditions,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  ReactiveStrike,
  Conditions,
) {
  "use strict";

  const STAND_REASONS = Object.freeze({
    NO_ACTIONS: "no-actions",
    IMMOBILIZED: "immobilized",
    NOT_PRONE: "not-prone",
    DEFEATED: "defeated",
  });

  const ACTION_COST = 1;
  const PRONE = "prone";

  function assertCombatant(combatant) {
    if (combatant === null || typeof combatant !== "object") {
      throw new TypeError("Stand requires a Combatant.");
    }
    if (
      typeof combatant.canSpendActions !== "function" ||
      typeof combatant.spendActions !== "function"
    ) {
      throw new TypeError("Stand requires a Combatant with an action pool.");
    }
    if (
      typeof combatant.addCondition !== "function" ||
      typeof combatant.removeCondition !== "function"
    ) {
      throw new TypeError("Stand requires a Combatant with a condition store.");
    }
  }

  function isProne(combatant) {
    return (
      combatant !== null &&
      typeof combatant === "object" &&
      typeof combatant.hasCondition === "function" &&
      combatant.hasCondition(PRONE)
    );
  }

  /**
   * Geometry-free availability check used by the View button.
   *
   * @param {object} combatant
   * @returns {{ok:true} | {ok:false, reason:string}}
   */
  function canStand(combatant) {
    assertCombatant(combatant);
    if (combatant.isDefeated === true) {
      return { ok: false, reason: STAND_REASONS.DEFEATED };
    }
    if (!isProne(combatant)) {
      return { ok: false, reason: STAND_REASONS.NOT_PRONE };
    }
    if (
      (typeof combatant.isImmobilized === "function" && combatant.isImmobilized()) ||
      Conditions.isImmobilized(combatant)
    ) {
      return { ok: false, reason: STAND_REASONS.IMMOBILIZED };
    }
    if (!combatant.canSpendActions(ACTION_COST)) {
      return { ok: false, reason: STAND_REASONS.NO_ACTIONS };
    }
    return { ok: true };
  }

  /**
   * @param {{
   *   combatant: object,
   *   map?: object,
   *   combatants?: object[],
   *   allies?: object[],
   *   reachFeet?: number,
   *   rollD20?: () => number,
   *   rollDamageDie?: (sides:number) => number,
   *   rollDie?: (sides:number) => number
   * }} options
   * @returns {{
   *   ok:true,
   *   actionsLeft:number,
   *   wasProne:boolean,
   *   proneRemoved:boolean,
   *   reactions:object[],
   *   reaction:object|null,
   *   defeated:boolean
   * } | {ok:false, reason:string}}
   */
  function performStand(options) {
    const opts = options || {};
    const combatant = opts.combatant;

    assertCombatant(combatant);

    const availability = canStand(combatant);
    if (!availability.ok) {
      return availability;
    }

    combatant.spendActions(ACTION_COST);

    const roster = Array.isArray(opts.combatants)
      ? opts.combatants
      : Array.isArray(opts.allies)
        ? opts.allies
        : [];
    const reactions = [];
    const cell = { x: combatant.x, y: combatant.y };

    // Stand is a move action. Resolve the provoking reaction while the
    // combatant is still prone, matching PF2e interrupt timing.
    if (roster.length > 0 && opts.map) {
      const threats = ReactiveStrike.findThreatenedEnemies({
        mover: combatant,
        cell: cell,
        combatants: roster,
        reachFeet: opts.reachFeet,
      });

      for (const enemy of threats) {
        const reaction = ReactiveStrike.performReactiveStrike({
          attacker: enemy,
          target: combatant,
          map: opts.map,
          reachFeet: opts.reachFeet,
          combatants: roster,
          allies: roster,
          rollD20: opts.rollD20,
          rollDamageDie: opts.rollDamageDie,
          rollDie: opts.rollDie,
        });

        // A failed attempt (for example no line of sight) spends nothing;
        // continue with the next eligible enemy.
        if (reaction.ok) {
          reactions.push(reaction);
          break;
        }
      }
    }

    const defeated = combatant.isDefeated === true;
    if (!defeated) {
      combatant.removeCondition(PRONE);
    }

    return {
      ok: true,
      actionsLeft: combatant.actionsRemaining,
      wasProne: true,
      proneRemoved: !defeated && !isProne(combatant),
      reactions: reactions,
      reaction: reactions.length > 0 ? reactions[0] : null,
      defeated: defeated,
      reactionTrigger: "stand-from-prone",
    };
  }

  return Object.freeze({
    STAND_REASONS: STAND_REASONS,
    ACTION_COST: ACTION_COST,
    PRONE: PRONE,
    isProne: isProne,
    canStand: canStand,
    performStand: performStand,
  });
});
