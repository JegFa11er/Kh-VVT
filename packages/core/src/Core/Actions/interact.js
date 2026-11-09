/**
 * PF2E REMASTERED - INTERACT ACTION (HEADLESS CORE)
 *
 * Interact handles hand/equipment manipulation:
 *   - draw:  1 action, manipulate, equip an inventory item (both hands for 2H);
 *   - stow:  1 action, manipulate, return a held item to the inventory;
 *   - drop:  free action, release a held item without provoking;
 *   - swap:  1 action, manipulate, release the current loadout and draw a new
 *            item from the inventory.
 *
 * Draw/stow/swap carry the `manipulate` trait. When the caller supplies the
 * combatant roster, the action runs the same Reactive Strike window used by
 * manipulate spells; a disrupting critical hit sets `disrupted: true` and the
 * equipment change does not happen (the action is still spent).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Entities/equipment.js"),
      require("./reactive-strike.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.Interact = factory(
      root.PF2e.Core.Equipment,
      root.PF2e.Core.Actions.ReactiveStrike,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Equipment,
  ReactiveStrike,
) {
  "use strict";

  const ACTION_TYPES = Object.freeze({
    DRAW: "draw",
    STOW: "stow",
    DROP: "drop",
    SWAP: "swap",
  });

  const INTERACT_REASONS = Object.freeze({
    NO_ACTIONS: "no-actions",
    INVALID_ACTION: "invalid-action",
    MISSING_ITEM: "missing-item",
    NO_FREE_HAND: "no-free-hand",
    SLOT_OCCUPIED: "slot-occupied",
    ALREADY_EQUIPPED: "already-equipped",
    EMPTY_HAND: "empty-hand",
    NOT_HELD: "not-held",
    DISRUPTED: "disrupted",
    RESTRAINED_ACTION_BLOCKED: "restrained-action-blocked",
    GRABBED_MANIPULATE_FAILED: "grabbed-manipulate-failed",
  });

  const ACTION_COSTS = Object.freeze({
    draw: 1,
    stow: 1,
    drop: 0,
    swap: 1,
  });

  const MANIPULATE_ACTIONS = Object.freeze(["draw", "stow", "swap"]);

  function assertCombatant(combatant) {
    if (combatant === null || typeof combatant !== "object") {
      throw new TypeError("Interact requires a Combatant.");
    }
    if (
      typeof combatant.canSpendActions !== "function" ||
      typeof combatant.spendActions !== "function"
    ) {
      throw new TypeError("Interact requires a Combatant with an action pool.");
    }
    if (
      typeof combatant.getHands !== "function" ||
      typeof combatant.equipItem !== "function" ||
      typeof combatant.unequipItem !== "function"
    ) {
      throw new TypeError("Interact requires a Combatant with a hands model.");
    }
  }

  function isValidActionType(actionType) {
    return Object.prototype.hasOwnProperty.call(ACTION_COSTS, actionType);
  }

  function resolveInventoryItem(combatant, item) {
    if (item === null || item === undefined) {
      return null;
    }
    if (typeof item === "object") {
      const existing = combatant.findInventoryItem(item);
      if (existing !== null) {
        return existing;
      }
      return combatant.addInventoryItem(item);
    }
    return combatant.findInventoryItem(item);
  }

  function resolveHeldItem(combatant, opts) {
    if (opts.item !== undefined && opts.item !== null) {
      return resolveInventoryItem(combatant, opts.item);
    }
    if (opts.slot !== undefined && opts.slot !== null) {
      const slot = Equipment.normalizeSlot(opts.slot);
      return combatant.hands[slot];
    }
    return null;
  }

  function isDead(combatant) {
    if (!combatant || typeof combatant !== "object") {
      return true;
    }
    if (combatant.isDefeated === true) {
      return true;
    }
    return Number.isInteger(combatant.currentHP) && combatant.currentHP <= 0;
  }

  /**
   * Resolve the manipulate-trait Reactive Strike window. When no roster is
   * supplied (isolated headless math) the phase is inert.
   *
   * @param {object} options
   * @param {object} combatant
   * @returns {{disrupted:boolean,reactions:object[],threats:object[]}}
   */
  function resolveManipulateReactions(options, combatant) {
    const combatants = Array.isArray(options.combatants)
      ? options.combatants
      : [];
    if (combatants.length === 0 || !ReactiveStrike) {
      return { disrupted: false, reactions: [], threats: [] };
    }

    const cell =
      combatant.position !== undefined && combatant.position !== null
        ? combatant.position
        : { x: combatant.x, y: combatant.y };

    const threats = ReactiveStrike.findThreatenedEnemies({
      mover: combatant,
      cell: cell,
      combatants: combatants,
      reachFeet: options.reactionReachFeet,
    });

    const reactions = [];
    let disrupted = false;

    for (const threat of threats) {
      const reaction = ReactiveStrike.performReactiveStrike({
        attacker: threat,
        target: combatant,
        map: options.map,
        combatants: combatants,
        allies: options.allies,
        rollD20:
          typeof options.rollReactionD20 === "function"
            ? options.rollReactionD20
            : options.rollD20,
        rollDamageDie:
          typeof options.rollReactionDamageDie === "function"
            ? options.rollReactionDamageDie
            : options.rollDamageDie,
        rollDie:
          typeof options.rollReactionDie === "function"
            ? options.rollReactionDie
            : options.rollDie,
      });
      reactions.push(reaction);

      if (
        reaction.ok === true &&
        (reaction.critical === true || isDead(combatant))
      ) {
        disrupted = true;
        break;
      }
    }

    return { disrupted: disrupted, reactions: reactions, threats: threats };
  }

  /**
   * Perform an equipment Interact.
   *
   * @param {{
   *   combatant: object,
   *   actionType: "draw"|"stow"|"drop"|"swap",
   *   item?: object|string,
   *   slot?: "mainHand"|"offHand",
   *   combatants?: object[],
   *   map?: object,
   *   allies?: object[],
   *   reactionReachFeet?: number,
   *   rollD20?: Function,
   *   rollDamageDie?: Function,
   *   rollDie?: Function
   * }} options
   * @returns {object}
   */
  function performInteract(options) {
    const opts = options || {};
    const combatant = opts.combatant;
    assertCombatant(combatant);

    const actionType = opts.actionType;
    if (!isValidActionType(actionType)) {
      return { ok: false, reason: INTERACT_REASONS.INVALID_ACTION };
    }

    const actionCost = ACTION_COSTS[actionType];
    if (actionCost > 0 && !combatant.canSpendActions(actionCost)) {
      return {
        ok: false,
        reason: INTERACT_REASONS.NO_ACTIONS,
        actionType: actionType,
        actionCost: actionCost,
        actionsLeft: combatant.actionsRemaining,
      };
    }

    const manipulate = MANIPULATE_ACTIONS.indexOf(actionType) !== -1;
    let targetItem = null;
    let previousItems = [];

    if (actionType === ACTION_TYPES.DRAW) {
      targetItem = resolveInventoryItem(combatant, opts.item);
      if (targetItem === null) {
        return {
          ok: false,
          reason: INTERACT_REASONS.MISSING_ITEM,
          actionType: actionType,
        };
      }
      if (combatant.isItemHeld(targetItem)) {
        return {
          ok: false,
          reason: INTERACT_REASONS.ALREADY_EQUIPPED,
          actionType: actionType,
          item: targetItem,
        };
      }
      const validation = combatant.canEquipItem(targetItem, { slot: opts.slot });
      if (!validation.ok) {
        return Object.assign(
          {
            ok: false,
            actionType: actionType,
            item: targetItem,
          },
          validation,
        );
      }
    } else if (
      actionType === ACTION_TYPES.STOW ||
      actionType === ACTION_TYPES.DROP
    ) {
      targetItem = resolveHeldItem(combatant, opts);
      if (targetItem === null) {
        return {
          ok: false,
          reason: INTERACT_REASONS.EMPTY_HAND,
          actionType: actionType,
        };
      }
      if (!combatant.isItemHeld(targetItem)) {
        return {
          ok: false,
          reason: INTERACT_REASONS.NOT_HELD,
          actionType: actionType,
          item: targetItem,
        };
      }
    } else if (actionType === ACTION_TYPES.SWAP) {
      targetItem = resolveInventoryItem(combatant, opts.item);
      if (targetItem === null) {
        return {
          ok: false,
          reason: INTERACT_REASONS.MISSING_ITEM,
          actionType: actionType,
        };
      }
      if (
        combatant.isItemHeld(targetItem) &&
        combatant.getHeldItems().length === 1
      ) {
        return {
          ok: false,
          reason: INTERACT_REASONS.ALREADY_EQUIPPED,
          actionType: actionType,
          item: targetItem,
        };
      }
    }

    // Restrained blocks manipulate actions outright; Grabbed forces a DC 5
    // flat check. Both are resolved before the action is committed.
    if (manipulate && typeof combatant.canAct === "function") {
      const gate = combatant.canAct({
        traits: ["manipulate"],
        action: "interact",
      });
      if (!gate.ok) {
        return {
          ok: false,
          reason:
            gate.reason === "restrained-action-blocked"
              ? INTERACT_REASONS.RESTRAINED_ACTION_BLOCKED
              : gate.reason,
          actionType: actionType,
          canActReason: gate.reason,
          actionsLeft: combatant.actionsRemaining,
        };
      }
    }

    if (
      manipulate &&
      typeof combatant.resolveGrabbedManipulate === "function"
    ) {
      const grabCheck = combatant.resolveGrabbedManipulate({
        traits: ["manipulate"],
        d20: opts.d20,
        rollFlatCheck: opts.rollFlatCheck,
        rollD20: opts.rollD20,
        rollDie: opts.rollDie,
      });
      if (grabCheck.required && !grabCheck.passed) {
        if (actionCost > 0) {
          combatant.spendActions(actionCost);
        }
        return {
          ok: false,
          reason: INTERACT_REASONS.GRABBED_MANIPULATE_FAILED,
          actionType: actionType,
          actionCost: actionCost,
          flatCheck: grabCheck.flatCheck,
          actionsLeft: combatant.actionsRemaining,
        };
      }
    }

    if (actionCost > 0) {
      combatant.spendActions(actionCost);
    }

    if (manipulate) {
      const reactionPhase = resolveManipulateReactions(opts, combatant);
      if (reactionPhase.disrupted) {
        return {
          ok: false,
          disrupted: true,
          reason: INTERACT_REASONS.DISRUPTED,
          actionType: actionType,
          actionCost: actionCost,
          actionsLeft: combatant.actionsRemaining,
          hands: combatant.hands,
          manipulate: true,
          traits: ["manipulate"],
          reactionStrikes: reactionPhase.reactions,
          reactionStrike:
            reactionPhase.reactions.length > 0
              ? reactionPhase.reactions[reactionPhase.reactions.length - 1]
              : null,
          reactionThreats: reactionPhase.threats,
        };
      }
    }

    let applied = null;

    if (actionType === ACTION_TYPES.DRAW) {
      applied = combatant.equipItem(targetItem, { slot: opts.slot });
      if (!applied.ok) {
        return Object.assign(
          {
            ok: false,
            actionType: actionType,
            actionsLeft: combatant.actionsRemaining,
          },
          applied,
        );
      }
    } else if (actionType === ACTION_TYPES.STOW) {
      applied = combatant.unequipItem(targetItem);
    } else if (actionType === ACTION_TYPES.DROP) {
      applied = combatant.unequipItem(targetItem);
      if (targetItem !== null && typeof targetItem === "object") {
        targetItem.dropped = true;
      }
    } else if (actionType === ACTION_TYPES.SWAP) {
      previousItems = combatant.clearHands();
      applied = combatant.equipItem(targetItem, { slot: opts.slot });
      if (!applied.ok) {
        return Object.assign(
          {
            ok: false,
            actionType: actionType,
            actionsLeft: combatant.actionsRemaining,
            previousItems: previousItems,
          },
          applied,
        );
      }
    }

    return {
      ok: true,
      actionType: actionType,
      actionCost: actionCost,
      actionsLeft: combatant.actionsRemaining,
      item: targetItem,
      previousItems: previousItems,
      hands: combatant.hands,
      slot: applied && applied.slot !== undefined ? applied.slot : opts.slot,
      manipulate: manipulate,
      traits: manipulate ? ["manipulate"] : [],
      freeHands: combatant.getFreeHandsCount(),
    };
  }

  return Object.freeze({
    ACTION_TYPES: ACTION_TYPES,
    INTERACT_REASONS: INTERACT_REASONS,
    ACTION_COST: ACTION_COSTS,
    MANIPULATE_ACTIONS: MANIPULATE_ACTIONS,
    performInteract: performInteract,
  });
});
