/**
 * PF2E REMASTERED — STRIDE ACTION (HEADLESS CORE)
 *
 * PF2e Stride: 1 action, move up to Speed along a valid path.
 * The action is spent only after a reachable route within Speed is found.
 *
 * Reactive Strike window:
 *   - Before each step of the route the mover leaves its current square.
 *   - If a living hostile with a reaction threatens that square within reach,
 *     the first such enemy automatically spends 1 reaction and makes a
 *     Reactive Strike. The attack ignores MAP (see reactive-strike.js).
 *   - A defeated mover stops immediately on the square it was leaving; the
 *     remaining route is discarded.
 *   - Step uses a separate action and deliberately never enters this scan.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Grid/grid-math.js"),
      require("../Grid/pathfinding.js"),
      require("./reactive-strike.js"),
      require("../Entities/conditions.js"),
      require("../Rules/damage.js"),
      require("../Entities/hazard.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.Stride = factory(
      root.PF2e.Core.Grid,
      root.PF2e.Core.Pathfinding,
      root.PF2e.Core.Actions.ReactiveStrike,
      root.PF2e.Core.Conditions,
      root.PF2e.Core.Rules.Damage,
      root.PF2e.Core.Hazard,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Grid,
  Pathfinding,
  ReactiveStrike,
  Conditions,
  Damage,
  Hazard,
) {
  "use strict";

  const STRIDE_REASONS = Object.freeze({
    NO_ACTIONS: "no-actions",
    IMMOBILIZED: "immobilized",
    ALREADY_THERE: "already-there",
    OUT_OF_BOUNDS: "out-of-bounds",
    BLOCKED_START: "blocked-start",
    BLOCKED_DESTINATION: "blocked-destination",
    DESTINATION_OCCUPIED: "destination-occupied",
    UNREACHABLE: "unreachable",
    EXCEEDS_SPEED: "exceeds-speed",
  });

  const DEFAULT_REACH_FEET = 5;

  function mapPathfindingFailure(reason) {
    if (reason === "out-of-bounds") {
      return STRIDE_REASONS.OUT_OF_BOUNDS;
    }
    if (reason === "blocked-start") {
      return STRIDE_REASONS.BLOCKED_START;
    }
    if (reason === "blocked-goal") {
      return STRIDE_REASONS.BLOCKED_DESTINATION;
    }
    if (reason === "goal-occupied") {
      return STRIDE_REASONS.DESTINATION_OCCUPIED;
    }
    return STRIDE_REASONS.UNREACHABLE;
  }

  function normalizeReach(reachFeet) {
    const reach = reachFeet === undefined ? DEFAULT_REACH_FEET : reachFeet;
    if (!Number.isInteger(reach) || reach <= 0 || reach % 5 !== 0) {
      throw new RangeError("reachFeet must be a positive multiple of 5.");
    }
    return reach;
  }

  function normalizeCombatants(options) {
    if (Array.isArray(options.combatants)) {
      return options.combatants;
    }
    if (Array.isArray(options.allies)) {
      return options.allies;
    }
    return [];
  }

  function stepCostFeet(map, destination, diagonalIndex) {
    const diagonal = destination.diagonal === true;
    let cost = diagonal
      ? Grid.diagonalStepCostFeet(diagonalIndex)
      : Grid.FEET_PER_SQUARE;
    if (
      typeof map.hasDifficultTerrain === "function" &&
      map.hasDifficultTerrain(destination.x, destination.y)
    ) {
      cost += Grid.DIFFICULT_TERRAIN_EXTRA_FEET;
    }
    return cost;
  }

  /**
   * Roll and apply hazardous-terrain damage when a mover enters a cell.
   *
   * @returns {object} a structured record for `hazardousDamageTaken`
   */
  function applyHazardousDamage(combatant, cell, hazardRecord, options) {
    const opts = options || {};
    const rollDie =
      typeof opts.rollDamageDie === "function"
        ? opts.rollDamageDie
        : typeof opts.rollDie === "function"
          ? opts.rollDie
          : Damage.defaultRollDie;

    const damage = Damage.rollDamage({
      formula: hazardRecord.damage,
      type: hazardRecord.type,
      rollDie: rollDie,
    });
    const hpBefore = Number.isInteger(combatant.currentHP)
      ? combatant.currentHP
      : null;
    const applied = combatant.takeDamage(damage.total, { type: damage.type });

    return {
      cell: { x: cell.x, y: cell.y },
      formula: hazardRecord.damage,
      type: damage.type,
      damage: damage,
      damageDealt:
        applied.damageApplied === undefined ? damage.total : applied.damageApplied,
      hpBefore: hpBefore,
      hpAfter: applied.currentHP,
      defeated: applied.isDefeated,
    };
  }

  /**
   * Whether an armed hazard's trigger area contains a cell. Works for Hazard
   * instances and plain objects.
   */
  function hazardContainsCell(hazard, cell) {
    if (!hazard) {
      return false;
    }
    if (typeof hazard.containsTriggerCell === "function") {
      return hazard.containsTriggerCell(cell);
    }
    return (
      Array.isArray(hazard.triggerArea) &&
      hazard.triggerArea.some(function (area) {
        return area.x === cell.x && area.y === cell.y;
      })
    );
  }

  /**
   * Fire an armed hazard's reaction against a mover and discharge it. Works for
   * Hazard instances and plain objects.
   */
  function triggerHazard(hazard, target, options) {
    const opts = options || {};
    let reaction;
    if (typeof hazard.trigger === "function") {
      reaction = hazard.trigger(target, {
        rollD20: opts.rollD20,
        rollDie: opts.rollDie,
        rollDamageDie: opts.rollDamageDie,
      });
    } else {
      reaction = Hazard.resolveReaction(hazard, target, {
        rollD20: opts.rollD20,
        rollDie: opts.rollDie,
        rollDamageDie: opts.rollDamageDie,
      });
      hazard.isArmed = false;
      reaction.isArmed = false;
    }
    return reaction;
  }

  /**
   * Walk the validated route one square at a time, checking the Reactive
   * Strike window before each departure. Mutates the combatant's position and
   * diagonal-step counter.
   */
  function traversePath(options) {
    const opts = options || {};
    const combatant = opts.combatant;
    const map = opts.map;
    const path = opts.path;
    const roster = normalizeCombatants(opts);
    // Do not force the default 5 ft here: each threatening enemy contributes
    // its own weapon reach (`reach` trait = 10 ft). An explicit override is
    // forwarded as-is for tests and special effects.
    const reachOverride = opts.reachFeet;

    const startDiagonalSteps = Number.isInteger(combatant.diagonalStepsThisTurn)
      ? combatant.diagonalStepsThisTurn
      : 0;
    const movedPath = [{ x: path[0].x, y: path[0].y }];
    const reactions = [];
    const hazardousDamageTaken = [];
    const triggeredHazards = [];
    let movedCostFeet = 0;
    let movedDiagonalSteps = 0;
    let interrupted = false;
    let stoppedAt = null;

    for (let index = 1; index < path.length; index += 1) {
      const from = path[index - 1];
      const to = path[index];

      // The trigger is checked while the mover is still on `from`. Step never
      // reaches this path because Step owns its own one-square movement.
      if (roster.length > 0) {
        const threats = ReactiveStrike.findThreatenedEnemies({
          mover: combatant,
          cell: from,
          combatants: roster,
          reachFeet: reachOverride,
        });

        for (const enemy of threats) {
          const reaction = ReactiveStrike.performReactiveStrike({
            attacker: enemy,
            target: combatant,
            map: map,
            reachFeet: reachOverride,
            combatants: roster,
            allies: roster,
            rollD20: opts.rollD20,
            rollDamageDie: opts.rollDamageDie,
            rollDie: opts.rollDie,
          });

          // A failed attempt (for example no line of sight) spends nothing;
          // try the next eligible enemy, otherwise keep moving.
          if (reaction.ok) {
            reactions.push(reaction);
            break;
          }
        }

        if (combatant.isDefeated === true) {
          interrupted = true;
          stoppedAt = { x: from.x, y: from.y };
          break;
        }
      }

      const diagonal = from.x !== to.x && from.y !== to.y;
      movedCostFeet += stepCostFeet(
        map,
        { x: to.x, y: to.y, diagonal: diagonal },
        diagonal ? (startDiagonalSteps + movedDiagonalSteps) % 2 : 0,
      );
      if (diagonal) {
        movedDiagonalSteps += 1;
      }

      combatant.setPosition(to.x, to.y);
      movedPath.push({ x: to.x, y: to.y });

      // Hazardous terrain: entering the cell deals damage immediately.
      if (typeof map.getHazardous === "function") {
        const hazardRecord = map.getHazardous(to.x, to.y);
        if (hazardRecord) {
          const record = applyHazardousDamage(combatant, to, hazardRecord, opts);
          hazardousDamageTaken.push(record);
          if (record.defeated) {
            interrupted = true;
            stoppedAt = { x: to.x, y: to.y };
            break;
          }
        }
      }

      // Armed traps whose trigger area contains the entered cell fire now and
      // stop the mover on that square.
      const hazards = Array.isArray(opts.hazards) ? opts.hazards : [];
      for (const hazard of hazards) {
        if (!hazard || hazard.isArmed !== true) {
          continue;
        }
        if (!hazardContainsCell(hazard, to)) {
          continue;
        }
        const reaction = triggerHazard(hazard, combatant, opts);
        reaction.cell = { x: to.x, y: to.y };
        triggeredHazards.push(reaction);
        interrupted = true;
        stoppedAt = { x: to.x, y: to.y };
        break;
      }

      if (interrupted) {
        break;
      }
    }

    combatant.registerDiagonalSteps(movedDiagonalSteps);

    return {
      reactions: reactions,
      reaction: reactions.length > 0 ? reactions[0] : null,
      movementInterrupted: interrupted,
      stoppedAt: stoppedAt,
      movedPath: movedPath,
      movedCostFeet: movedCostFeet,
      movedDiagonalSteps: movedDiagonalSteps,
      destinationReached: !interrupted,
      hazardousDamageTaken: hazardousDamageTaken,
      triggeredHazards: triggeredHazards,
    };
  }

  /**
   * @param {{
   *   combatant: object,
   *   map: object,
   *   destination: {x:number,y:number},
   *   diagonalCornerPolicy?: string,
   *   occupancy?: object,
   *   combatants?: object[],
   *   allies?: object[],
   *   reachFeet?: number,
   *   hazards?: object[],
   *   rollD20?: () => number,
   *   rollDamageDie?: (sides:number) => number,
   *   rollDie?: (sides:number) => number
   * }} options
   * @returns {{
   *   ok: true, path: {x:number,y:number}[], costFeet: number,
   *   actionsLeft: number, diagonalSteps: number, diagonalParity: number,
   *   reactions: object[], reaction: object|null,
   *   movementInterrupted: boolean, stoppedAt: {x:number,y:number}|null,
   *   movedPath: {x:number,y:number}[], movedCostFeet: number,
   *   movedDiagonalSteps: number, destinationReached: boolean
   * } | {
   *   ok: false, reason: string, path?: {x:number,y:number}[], costFeet?: number
   * }}
   */
  function performStride(options) {
    const opts = options || {};
    const combatant = opts.combatant;
    const map = opts.map;
    const destination = opts.destination;

    if (!combatant || typeof combatant.canSpendActions !== "function") {
      throw new TypeError("performStride requires a Combatant instance.");
    }
    if (!map) {
      throw new TypeError("performStride requires a GridMap.");
    }
    if (destination === null || typeof destination !== "object") {
      throw new TypeError("performStride requires a destination cell.");
    }

    if (!combatant.canSpendActions(1)) {
      return { ok: false, reason: STRIDE_REASONS.NO_ACTIONS };
    }

    // Immobilized (including Grabbed/Restrained) sets Speed to 0 and forbids
    // move actions. Reject before any geometry or die roll.
    if (
      (typeof combatant.isImmobilized === "function" && combatant.isImmobilized()) ||
      Conditions.isImmobilized(combatant)
    ) {
      return { ok: false, reason: STRIDE_REASONS.IMMOBILIZED };
    }

    if (destination.x === combatant.x && destination.y === combatant.y) {
      return { ok: false, reason: STRIDE_REASONS.ALREADY_THERE };
    }

    const result = Pathfinding.findPath(
      { x: combatant.x, y: combatant.y },
      { x: destination.x, y: destination.y },
      {
        map: map,
        startDiagonalParity: combatant.diagonalParity,
        diagonalCornerPolicy: opts.diagonalCornerPolicy,
        occupancy: opts.occupancy,
        footprint:
          typeof combatant.getFootprint === "function"
            ? combatant.getFootprint()
            : 1,
      },
    );

    if (!result.found) {
      return { ok: false, reason: mapPathfindingFailure(result.reason) };
    }

    if (result.costFeet > combatant.speedFeet) {
      return {
        ok: false,
        reason: STRIDE_REASONS.EXCEEDS_SPEED,
        path: result.path,
        costFeet: result.costFeet,
      };
    }

    combatant.spendActions(1);

    const movement = traversePath({
      combatant: combatant,
      map: map,
      path: result.path,
      combatants: opts.combatants,
      allies: opts.allies,
      reachFeet: opts.reachFeet,
      hazards: opts.hazards,
      rollD20: opts.rollD20,
      rollDamageDie: opts.rollDamageDie,
      rollDie: opts.rollDie,
    });

    // Take Cover's greater cover ends as soon as the creature moves, even if
    // the Stride was interrupted by a Reactive Strike.
    if (typeof combatant.removeCondition === "function") {
      combatant.removeCondition("greater-cover");
    }

    // A grappler that moves loses its hold. This is checked once the action is
    // committed, before the target can act again.
    const releasedGrapples = Conditions.releaseGrapplesBySource(
      normalizeCombatants(opts),
      combatant.id,
    );

    const strideResult = Object.assign(
      {
        ok: true,
        path: result.path,
        costFeet: result.costFeet,
        actionsLeft: combatant.actionsRemaining,
        diagonalSteps: result.diagonalSteps,
        diagonalParity: combatant.diagonalParity,
        releasedGrapples: releasedGrapples,
      },
      movement,
    );

    if (typeof combatant.emitEvent === "function") {
      combatant.emitEvent("combatant:moved", {
        movementType: "stride",
        path: strideResult.movedPath || strideResult.path,
        fullPath: strideResult.path,
        costFeet:
          strideResult.movedCostFeet === undefined
            ? strideResult.costFeet
            : strideResult.movedCostFeet,
        actionsSpent: 1,
        actionsLeft: combatant.actionsRemaining,
        from: strideResult.path[0],
        to: { x: combatant.x, y: combatant.y },
        interrupted: strideResult.movementInterrupted === true,
        destinationReached: strideResult.destinationReached === true,
      });
    }

    return strideResult;
  }

  return Object.freeze({
    STRIDE_REASONS: STRIDE_REASONS,
    DEFAULT_REACH_FEET: DEFAULT_REACH_FEET,
    performStride: performStride,
    traversePath: traversePath,
  });
});
