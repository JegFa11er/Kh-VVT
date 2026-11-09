/**
 * PF2E REMASTERED — SUSTAIN A SPELL (HEADLESS CORE)
 *
 * Sustain a Spell costs 1 action and has the `concentrate` trait. It keeps one
 * active sustained spell alive for another round: the expiry moves to the end
 * of the caster's next turn (`round + 1`).
 *
 * Every spell with the `sustained` trait is registered by `performCastSpell`
 * with `expiresAtRound = encounter.round + 1`. At the end of the caster's turn
 * `Combatant.endTurn()` removes any record whose expiry has been reached and
 * reports it through `expiredSustainedSpells`. Sustaining before then pushes
 * the expiry out by one round.
 *
 * Invalid attempts (no active spell, no action, unconscious) change nothing.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.SustainSpell = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SUSTAIN_REASONS = Object.freeze({
    NO_ACTIONS: "no-actions",
    UNCONSCIOUS: "unconscious",
    DEFEATED: "defeated",
    NOT_SUSTAINED: "not-sustained",
    INVALID_ACTIVE_SPELL: "invalid-active-spell",
  });

  const ACTION_COST = 1;
  const TRAITS = Object.freeze(["concentrate"]);

  function assertCaster(caster) {
    if (caster === null || typeof caster !== "object") {
      throw new TypeError("Sustain a Spell requires a Combatant.");
    }
    if (
      typeof caster.spendActions !== "function" ||
      typeof caster.canSpendActions !== "function"
    ) {
      throw new TypeError("Sustain a Spell requires a Combatant with an action pool.");
    }
  }

  function findActiveSpell(caster, activeSpellId) {
    if (typeof caster.getActiveSustainedSpell === "function") {
      return caster.getActiveSustainedSpell(activeSpellId);
    }
    if (!Array.isArray(caster.activeSustainedSpells)) {
      return null;
    }
    let found = caster.activeSustainedSpells.find(function (entry) {
      return entry.id === activeSpellId;
    });
    if (found === undefined) {
      found = caster.activeSustainedSpells.find(function (entry) {
        return entry.spellId === activeSpellId;
      });
    }
    return found === undefined ? null : found;
  }

  function resolveRound(encounter, caster) {
    if (
      encounter !== null &&
      encounter !== undefined &&
      Number.isInteger(encounter.round)
    ) {
      return encounter.round;
    }
    if (Number.isInteger(caster.encounterRound)) {
      return caster.encounterRound;
    }
    return 0;
  }

  function extendActiveSpell(caster, activeSpell, expiresAtRound) {
    if (typeof caster.extendSustainedSpell === "function") {
      return caster.extendSustainedSpell(activeSpell.id, expiresAtRound);
    }
    activeSpell.expiresAtRound = expiresAtRound;
    return {
      id: activeSpell.id,
      spellId: activeSpell.spellId,
      spell: activeSpell.spell,
      target: activeSpell.target,
      expiresAtRound: activeSpell.expiresAtRound,
    };
  }

  /**
   * Sustain one active spell.
   *
   * @param {{
   *   caster: object,
   *   activeSpellId: string,
   *   encounter?: {round:number}
   * }} options
   * @returns {{
   *   ok: true,
   *   actionCost: number,
   *   traits: string[],
   *   activeSpellId: string,
   *   spellId: string|null,
   *   previousExpiresAtRound: number|null,
   *   expiresAtRound: number,
   *   actionsLeft: number,
   *   sustainedSpell: object
   * } | { ok: false, reason: string, actionsLeft?: number }}
   */
  function performSustainSpell(options) {
    const opts = options || {};
    const caster = opts.caster;
    assertCaster(caster);

    if (typeof caster.canAct === "function") {
      const gate = caster.canAct();
      if (!gate.ok) {
        return {
          ok: false,
          reason:
            gate.reason === "defeated"
              ? SUSTAIN_REASONS.DEFEATED
              : gate.reason === "unconscious"
                ? SUSTAIN_REASONS.UNCONSCIOUS
                : gate.reason,
          actionsLeft: caster.actionsRemaining,
        };
      }
    }

    const activeSpellId = opts.activeSpellId;
    if (typeof activeSpellId !== "string" || activeSpellId.trim() === "") {
      return {
        ok: false,
        reason: SUSTAIN_REASONS.INVALID_ACTIVE_SPELL,
        actionsLeft: caster.actionsRemaining,
      };
    }

    const activeSpell = findActiveSpell(caster, activeSpellId);
    if (activeSpell === null) {
      return {
        ok: false,
        reason: SUSTAIN_REASONS.NOT_SUSTAINED,
        activeSpellId: activeSpellId,
        actionsLeft: caster.actionsRemaining,
      };
    }

    if (!caster.canSpendActions(ACTION_COST)) {
      return {
        ok: false,
        reason: SUSTAIN_REASONS.NO_ACTIONS,
        activeSpellId: activeSpell.id,
        actionsLeft: caster.actionsRemaining,
      };
    }

    const round = resolveRound(opts.encounter, caster);
    const previousExpiresAtRound = Number.isInteger(activeSpell.expiresAtRound)
      ? activeSpell.expiresAtRound
      : null;
    // "Until the end of your next turn": extend by one full round from the
    // later of the current expiry and the current encounter round.
    const expiresAtRound =
      Math.max(
        previousExpiresAtRound === null ? round : previousExpiresAtRound,
        round,
      ) + 1;

    caster.spendActions(ACTION_COST);
    const sustainedSpell = extendActiveSpell(
      caster,
      activeSpell,
      expiresAtRound,
    );

    return {
      ok: true,
      actionCost: ACTION_COST,
      traits: TRAITS.slice(),
      activeSpellId: activeSpell.id,
      spellId:
        activeSpell.spellId === undefined ? null : activeSpell.spellId,
      previousExpiresAtRound: previousExpiresAtRound,
      expiresAtRound: expiresAtRound,
      actionsLeft: caster.actionsRemaining,
      sustainedSpell: sustainedSpell,
    };
  }

  return Object.freeze({
    SUSTAIN_REASONS: SUSTAIN_REASONS,
    ACTION_COST: ACTION_COST,
    TRAITS: TRAITS,
    performSustainSpell: performSustainSpell,
  });
});
