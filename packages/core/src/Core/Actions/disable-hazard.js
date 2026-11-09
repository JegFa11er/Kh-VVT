/**
 * PF2E REMASTERED — DISABLE A HAZARD ACTION (HEADLESS CORE)
 *
 * Two-action, manipulate activity. The combatant rolls the hazard's listed
 * disable skill (default Thievery) against `hazard.disableDC`:
 *
 *   - Critical Success / Success: the hazard is disarmed (`isArmed = false`).
 *   - Failure: no effect.
 *   - Critical Failure: the hazard immediately triggers its reaction against
 *     the disabler (and discharges).
 *
 * The action cost is spent only after the attempt passes basic validation.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Rules/checks.js"),
      require("../Rules/modifiers.js"),
      require("../Entities/hazard.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.DisableHazard = factory(
      root.PF2e.Core.Rules.Checks,
      root.PF2e.Core.Rules.Modifiers,
      root.PF2e.Core.Hazard,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Checks,
  Modifiers,
  Hazard,
) {
  "use strict";

  const DISABLE_HAZARD_REASONS = Object.freeze({
    NO_ACTIONS: "no-actions",
    NOT_ARMED: "not-armed",
    INVALID_HAZARD: "invalid-hazard",
    RESTRAINED_ACTION_BLOCKED: "restrained-action-blocked",
    GRABBED_MANIPULATE_FAILED: "grabbed-manipulate-failed",
  });

  const DISABLE_ACTION_COST = 2;
  const DISABLE_TRAITS = Object.freeze(["manipulate"]);

  function resolveD20(options) {
    const opts = options || {};
    let value;
    if (typeof opts.rollD20 === "function") {
      value = opts.rollD20();
    } else if (typeof opts.rollDie === "function") {
      value = opts.rollDie(20);
    } else {
      value = 1 + Math.floor(Math.random() * 20);
    }
    if (!Number.isInteger(value) || value < 1 || value > 20) {
      throw new RangeError("rollD20 must return an integer from 1 to 20.");
    }
    return value;
  }

  function normalizeSkill(hazard) {
    const skill =
      hazard.disableSkill === undefined || hazard.disableSkill === null
        ? Hazard.DEFAULT_DISABLE_SKILL
        : hazard.disableSkill;
    return String(skill).trim().toLowerCase();
  }

  /**
   * @param {{
   *   combatant: object,
   *   hazard: object,
   *   rollD20?: () => number,
   *   rollDie?: (sides:number) => number,
   *   rollDamageDie?: (sides:number) => number
   * }} options
   * @returns {object}
   */
  function performDisableHazard(options) {
    const opts = options || {};
    const combatant = opts.combatant;
    const hazard = opts.hazard;

    if (!combatant || typeof combatant.canSpendActions !== "function") {
      throw new TypeError("performDisableHazard requires a Combatant instance.");
    }
    if (
      !hazard ||
      typeof hazard !== "object" ||
      !Number.isInteger(hazard.disableDC) ||
      typeof hazard.isArmed !== "boolean"
    ) {
      return { ok: false, reason: DISABLE_HAZARD_REASONS.INVALID_HAZARD };
    }

    if (!combatant.canSpendActions(DISABLE_ACTION_COST)) {
      return { ok: false, reason: DISABLE_HAZARD_REASONS.NO_ACTIONS };
    }

    if (hazard.isArmed !== true) {
      return { ok: false, reason: DISABLE_HAZARD_REASONS.NOT_ARMED };
    }

    // Disable a Hazard is a manipulate activity: Restrained blocks it and
    // Grabbed requires a successful DC 5 flat check.
    if (typeof combatant.canAct === "function") {
      const gate = combatant.canAct({
        traits: DISABLE_TRAITS,
        action: "disable-hazard",
      });
      if (!gate.ok) {
        return {
          ok: false,
          reason: gate.reason,
          canActReason: gate.reason,
          actionsLeft: combatant.actionsRemaining,
        };
      }
    }

    if (typeof combatant.resolveGrabbedManipulate === "function") {
      const grabCheck = combatant.resolveGrabbedManipulate({
        traits: DISABLE_TRAITS,
        d20: opts.d20,
        rollFlatCheck: opts.rollFlatCheck,
        rollD20: opts.rollD20,
        rollDie: opts.rollDie,
      });
      if (grabCheck.required && !grabCheck.passed) {
        combatant.spendActions(DISABLE_ACTION_COST);
        return {
          ok: false,
          reason: DISABLE_HAZARD_REASONS.GRABBED_MANIPULATE_FAILED,
          traits: DISABLE_TRAITS,
          flatCheck: grabCheck.flatCheck,
          actionsLeft: combatant.actionsRemaining,
        };
      }
    }

    const skill = normalizeSkill(hazard);
    const baseModifier =
      typeof combatant.getSkillModifier === "function"
        ? combatant.getSkillModifier(skill)
        : 0;
    const conditionModifiers =
      typeof combatant.getSkillModifiers === "function"
        ? combatant.getSkillModifiers(skill)
        : [];
    const resolution = Modifiers.resolveModifiers(baseModifier, conditionModifiers);
    const totalModifier = resolution.total;

    const d20 = resolveD20(opts);
    const check = Checks.evaluateCheck({
      d20: d20,
      modifier: totalModifier,
      dc: hazard.disableDC,
    });

    const success =
      check.degree === Checks.DEGREES.SUCCESS ||
      check.degree === Checks.DEGREES.CRITICAL_SUCCESS;
    const criticalFailure = check.degree === Checks.DEGREES.CRITICAL_FAILURE;

    let disarmed = false;
    let triggeredReaction = null;

    if (success) {
      // Use the hazard's own disarm path when available so the
      // `hazard:disabled` event is emitted for listeners/logs.
      if (typeof hazard.disarm === "function") {
        hazard.disarm();
      } else {
        hazard.isArmed = false;
      }
      disarmed = true;
    } else if (criticalFailure) {
      if (typeof hazard.trigger === "function") {
        triggeredReaction = hazard.trigger(combatant, {
          rollD20: opts.rollD20,
          rollDie: opts.rollDie,
          rollDamageDie: opts.rollDamageDie,
        });
      } else {
        triggeredReaction = Hazard.resolveReaction(hazard, combatant, {
          rollD20: opts.rollD20,
          rollDie: opts.rollDie,
          rollDamageDie: opts.rollDamageDie,
        });
        hazard.isArmed = false;
        triggeredReaction.isArmed = false;
      }
    }

    combatant.spendActions(DISABLE_ACTION_COST);

    return {
      ok: true,
      actionCost: DISABLE_ACTION_COST,
      traits: DISABLE_TRAITS,
      actionsLeft: combatant.actionsRemaining,
      skill: skill,
      disableDC: hazard.disableDC,
      baseModifier: baseModifier,
      totalModifier: totalModifier,
      modifiers: resolution.effectiveModifiers,
      attackRoll: d20,
      total: check.total,
      degree: check.degree,
      isNatural20: check.isNatural20,
      isNatural1: check.isNatural1,
      disarmed: disarmed,
      triggeredReaction: triggeredReaction,
      hazardIsArmed: hazard.isArmed,
    };
  }

  return Object.freeze({
    DISABLE_HAZARD_REASONS: DISABLE_HAZARD_REASONS,
    DISABLE_ACTION_COST: DISABLE_ACTION_COST,
    DISABLE_TRAITS: DISABLE_TRAITS,
    performDisableHazard: performDisableHazard,
  });
});
