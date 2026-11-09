/**
 * PF2E REMASTERED — TACTICAL AI CONTROLLER (HEADLESS CORE)
 *
 * Feature Readiness:
 * - goal: a computer-controlled combatant spends its turn like a tactical
 *   PF2e skirmisher: stand up, close on the nearest hostile, flank when an ally
 *   is already engaged, Strike with MAP, and finish the turn behind a shield.
 * - pf2e_remastered_rule: Stand 1 action; Step 5 ft (never provokes);
 *   Stride 1 action up to Speed; Strike 1 action with the -5/-10 MAP; Raise a
 *   Shield 1 action (+2 circumstance AC until the start of the next turn);
 *   Take Cover 1 action (greater cover, +4 circumstance AC). Flanking grants
 *   Off-Guard (-2 circumstance AC) when two allies are on opposite sides.
 * - behavior_and_boundaries: purely deterministic planning and execution over
 *   the existing action modules. No DOM/Canvas, no free-form natural language,
 *   no spell selection, no ranged kiting, no item use, and no encounter turn
 *   advancement (the host still owns initiative).
 * - data_contracts: consumes a positioned Combatant, a GridMap, and the full
 *   combatant roster. Returns a serialisable action plan and an execution log.
 * - acceptance_tests: tests/AI/tactical-ai.test.js covers Stand priority,
 *   Aggro/Stride/Strike, Strike -> Strike -> Raise a Shield, target switching
 *   after a kill, action-pool exhaustion, and the flanking Step.
 * - delegated_assumptions: a corpse is not an obstacle; large-target flanking
 *   still uses anchor-cell directions (documented Phase 9.1 limitation).
 * - confidence: 96%.
 *
 * The controller never mutates the encounter clock. It starts from the current
 * action pool (the caller/Encounter is responsible for resetTurn()) and keeps
 * taking one meaningful action at a time until the pool is empty or no legal
 * action remains. Every loop iteration re-plans from the live state, so a
 * target that dies mid-rotation is dropped immediately.
 *
 * Decision priority:
 *   1. Can the creature act at all? (unconscious / dying / paralyzed / stunned)
 *   2. Stand if Prone.
 *   3. Acquire the nearest living hostile by A* approach cost, then lowest HP.
 *   4. If already in reach AND the target is strikeable (no wall blocks line of
 *      effect), keep the position unless a one-Step flank is free.
 *   5. If out of reach, or in reach but blocked by a wall, Stride/Step toward
 *      the closest reachable attack cell with a clear line of effect. A Step is
 *      preferred when the current square is threatened by a reaction.
 *   6. Rotation: Strike (MAP -0), Strike (MAP -5), then Raise a Shield if the
 *      shield is usable, else Take Cover / a third Strike.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Grid/grid-math.js"),
      require("../Grid/los-math.js"),
      require("../Grid/pathfinding.js"),
      require("../Grid/occupancy.js"),
      require("../Grid/flanking.js"),
      require("../Actions/strike.js"),
      require("../Actions/stride.js"),
      require("../Actions/step.js"),
      require("../Actions/stand.js"),
      require("../Actions/raise-shield.js"),
      require("../Actions/take-cover.js"),
      require("../Actions/reactive-strike.js"),
      require("../Entities/shield.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.AI = root.PF2e.Core.AI || {};
    root.PF2e.Core.AI.TacticalAI = factory(
      root.PF2e.Core.Grid,
      root.PF2e.Core.LosMath,
      root.PF2e.Core.Pathfinding,
      root.PF2e.Core.Occupancy,
      root.PF2e.Core.Flanking,
      root.PF2e.Core.Actions.Strike,
      root.PF2e.Core.Actions.Stride,
      root.PF2e.Core.Actions.Step,
      root.PF2e.Core.Actions.Stand,
      root.PF2e.Core.Actions.RaiseShield,
      root.PF2e.Core.Actions.TakeCover,
      root.PF2e.Core.Actions.ReactiveStrike,
      root.PF2e.Core.Shield,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Grid,
  LosMath,
  Pathfinding,
  Occupancy,
  Flanking,
  Strike,
  Stride,
  Step,
  Stand,
  RaiseShield,
  TakeCover,
  ReactiveStrike,
  Shield,
) {
  "use strict";

  const ACTION_TYPES = Object.freeze({
    STAND: "stand",
    STRIDE: "stride",
    STEP: "step",
    STRIKE: "strike",
    RAISE_SHIELD: "raise-shield",
    TAKE_COVER: "take-cover",
  });

  const TACTICAL_AI_REASONS = Object.freeze({
    CANNOT_ACT: "cannot-act",
    NO_TARGET: "no-target",
    NO_ACTIONS: "no-actions",
    NO_LEGAL_ACTION: "no-legal-action",
  });

  const DEFAULT_SPEED_FEET = 25;
  const DEFAULT_REACH_FEET = Strike.DEFAULT_REACH_FEET;
  const DEFAULT_MAX_ITERATIONS = 16;

  const SHIELD_RAISED = "shield-raised";
  const PRONE = "prone";
  const MOVEMENT_CONDITIONS = ["grabbed", "restrained", "immobilized"];

  const DIRECTIONS = Object.freeze([
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: -1 },
    { dx: 1, dy: 1 },
    { dx: -1, dy: 1 },
    { dx: -1, dy: -1 },
  ]);

  // ---------------------------------------------------------------- validation

  function assertCombatant(combatant, label) {
    if (
      combatant === null ||
      typeof combatant !== "object" ||
      !Number.isInteger(combatant.x) ||
      !Number.isInteger(combatant.y)
    ) {
      throw new TypeError(label + " must be a positioned Combatant.");
    }
    if (
      typeof combatant.canSpendActions !== "function" ||
      typeof combatant.spendActions !== "function"
    ) {
      throw new TypeError(label + " must expose an action pool.");
    }
  }

  function assertMap(map) {
    if (!map || typeof map.isBlocked !== "function" || typeof map.isInBounds !== "function") {
      throw new TypeError("Tactical AI requires a GridMap.");
    }
  }

  function normalizeRoster(combatants) {
    return Array.isArray(combatants) ? combatants : [];
  }

  // ------------------------------------------------------------------ helpers

  function sameCreature(a, b) {
    if (a === b) {
      return true;
    }
    if (!a || !b) {
      return false;
    }
    return a.id !== undefined && b.id !== undefined && a.id === b.id;
  }

  function isDefeated(combatant) {
    return (
      combatant !== null &&
      typeof combatant === "object" &&
      (combatant.isDefeated === true ||
        (Number.isInteger(combatant.currentHP) && combatant.currentHP <= 0))
    );
  }

  function hasCondition(combatant, name) {
    return (
      typeof combatant.hasCondition === "function" && combatant.hasCondition(name)
    );
  }

  function footprintOf(combatant) {
    return typeof combatant.getFootprint === "function"
      ? combatant.getFootprint()
      : 1;
  }

  function reachFeetOf(combatant) {
    return Strike.resolveReachFeet({}, combatant);
  }

  function isImmobilized(combatant) {
    if (typeof combatant.isImmobilized === "function" && combatant.isImmobilized()) {
      return true;
    }
    if (typeof combatant.hasCondition !== "function") {
      return false;
    }
    return MOVEMENT_CONDITIONS.some(function (name) {
      return combatant.hasCondition(name);
    });
  }

  function isLivingHostile(actor, target) {
    if (!target || typeof target !== "object") {
      return false;
    }
    if (sameCreature(actor, target)) {
      return false;
    }
    if (isDefeated(target)) {
      return false;
    }
    if (target.currentHP !== undefined && target.currentHP <= 0) {
      return false;
    }
    return target.alliance !== actor.alliance;
  }

  function livingRoster(combatants) {
    return combatants.filter(function (candidate) {
      return candidate !== null && typeof candidate === "object" && !isDefeated(candidate);
    });
  }

  /**
   * Living hostiles plus the mover. Dead bodies never block movement in this
   * engine, so the pathfinding roster drops them but keeps the mover itself.
   */
  function movementRoster(combatants, mover) {
    const roster = livingRoster(combatants).slice();
    if (!roster.some(function (candidate) {
      return sameCreature(candidate, mover);
    })) {
      roster.push(mover);
    }
    return roster;
  }

  function cellsAt(x, y, footprint) {
    return Grid.getFootprintCells(x, y, footprint);
  }

  function distanceAt(x, y, actor, target) {
    return Grid.getCellsDistance(
      cellsAt(x, y, footprintOf(actor)),
      Occupancy.occupiedCellsOf(target),
    );
  }

  function distanceFeet(actor, target) {
    return Grid.getCombatantDistance(actor, target);
  }

  function speedOf(actor) {
    return Number.isInteger(actor.speedFeet) && actor.speedFeet > 0
      ? actor.speedFeet
      : DEFAULT_SPEED_FEET;
  }

  function getShieldStatus(combatant) {
    const shield =
      typeof combatant.getShield === "function"
        ? combatant.getShield()
        : combatant.shield;

    if (!shield) {
      return { held: false, usable: false, shield: null };
    }
    if (Shield.isShieldBroken(shield) || Shield.isShieldDestroyed(shield)) {
      return { held: true, usable: false, shield: shield };
    }
    return { held: true, usable: true, shield: shield };
  }

  /**
   * Only explicitly authored alliances establish hostility, mirroring Strike.
   */
  function isHostileTo(unit, target) {
    if (!unit || !target) {
      return false;
    }
    if (unit.alliance === undefined || target.alliance === undefined) {
      return true;
    }
    return unit.alliance !== target.alliance;
  }

  /**
   * @param {object} combatant
   * @returns {{ok:boolean, reason?:string}}
   */
  function canTakeTurn(combatant) {
    assertCombatant(combatant, "combatant");
    if (hasCondition(combatant, "dying")) {
      return { ok: false, reason: "dying" };
    }
    if (hasCondition(combatant, "unconscious")) {
      return { ok: false, reason: "unconscious" };
    }
    if (typeof combatant.canAct === "function") {
      const availability = combatant.canAct();
      if (!availability.ok) {
        return availability;
      }
    }
    if (isDefeated(combatant)) {
      return { ok: false, reason: "defeated" };
    }
    return { ok: true };
  }

  function snapshotState(combatant) {
    return {
      actor: combatant,
      x: combatant.x,
      y: combatant.y,
      actionsRemaining: Number.isInteger(combatant.actionsRemaining)
        ? combatant.actionsRemaining
        : 0,
      attacksThisTurn: Number.isInteger(combatant.attacksThisTurn)
        ? combatant.attacksThisTurn
        : 0,
      prone: hasCondition(combatant, PRONE),
      shieldRaised: hasCondition(combatant, SHIELD_RAISED),
      defeated: isDefeated(combatant),
    };
  }

  // --------------------------------------------------------------- movement

  function buildMovementOccupancy(actor, combatants) {
    return Occupancy.buildOccupancy(movementRoster(combatants, actor), actor);
  }

  /**
   * A Step is valid from an arbitrary (possibly projected) anchor. This mirrors
   * Step.evaluateStep but is not tied to the combatant's live x/y.
   */
  function canStepTo(actor, from, destination, map, combatants) {
    if (!map.isInBounds(destination.x, destination.y)) {
      return false;
    }
    const dx = destination.x - from.x;
    const dy = destination.y - from.y;
    if (dx === 0 && dy === 0) {
      return false;
    }
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) {
      return false;
    }
    if (map.isBlocked(destination.x, destination.y)) {
      return false;
    }
    if (
      typeof map.hasDifficultTerrain === "function" &&
      map.hasDifficultTerrain(destination.x, destination.y)
    ) {
      return false;
    }
    if (!Occupancy.canOccupySpace(destination.x, destination.y, actor, map, combatants)) {
      return false;
    }

    const route = Pathfinding.findPath(from, destination, {
      map: map,
      startDiagonalParity: Number.isInteger(actor.diagonalParity)
        ? actor.diagonalParity
        : 0,
      occupancy: buildMovementOccupancy(actor, combatants),
      footprint: footprintOf(actor),
    });

    return route.found === true && route.path.length === 2;
  }

  /**
   * Dry-run Line of Effect check that reuses Strike's own validation. The
   * attacker is wrapped in a prototype-linked projection so
   * `Strike.evaluateStrike` reads the (possibly projected) anchor cell without
   * mutating the live combatant. Returns true only when the Strike would be
   * refused with `no-line-of-sight` — i.e. a wall or total cover sits between
   * the attacker and the target even though they are geometrically in reach.
   */
  function isStrikeBlockedByWall(actor, cell, target, map, combatants) {
    const projected = Object.create(actor);
    projected._x = cell.x;
    projected._y = cell.y;
    try {
      const evaluation = Strike.evaluateStrike({
        attacker: projected,
        target: target,
        map: map,
        allies: combatants,
      });
      return (
        evaluation.ok === false &&
        evaluation.reason === Strike.STRIKE_REASONS.NO_LINE_OF_SIGHT
      );
    } catch (error) {
      // An unexpected evaluation failure is treated as "blocked" so the AI
      // repositions instead of crashing or idling in a reject loop.
      return true;
    }
  }

  /**
   * Cheap centre-to-centre line of sight used to prune candidate attack cells
   * (a single ray, no cover or flanking work). This is the same primary LOS
   * gate `Strike.evaluateStrike` applies via `LosMath.traceLineOfSight`.
   */
  function hasLineOfSight(from, target, map) {
    return LosMath.hasLineOfSight(
      { x: from.x, y: from.y },
      { x: target.x, y: target.y },
      map,
    );
  }

  /**
   * Cells from which a medium-or-larger attacker could Strike the target.
   * Candidates must be fully occupiable, inside the map, and have an
   * unobstructed line of sight to the target.
   */
  function attackCellsAround(actor, target, map, combatants) {
    const reach = reachFeetOf(actor);
    const targetCells = Occupancy.occupiedCellsOf(target);
    const radius = Math.ceil(reach / Grid.FEET_PER_SQUARE);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const cell of targetCells) {
      minX = Math.min(minX, cell.x);
      maxX = Math.max(maxX, cell.x);
      minY = Math.min(minY, cell.y);
      maxY = Math.max(maxY, cell.y);
    }

    const minCellX = Math.max(0, minX - radius);
    const maxCellX = Math.min(map.cols - 1, maxX + radius);
    const minCellY = Math.max(0, minY - radius);
    const maxCellY = Math.min(map.rows - 1, maxY + radius);
    const cells = [];

    for (let y = minCellY; y <= maxCellY; y += 1) {
      for (let x = minCellX; x <= maxCellX; x += 1) {
        if (
          !Occupancy.canOccupySpace(x, y, actor, map, combatants)
        ) {
          continue;
        }
        const distance = Grid.getCellsDistance(
          cellsAt(x, y, footprintOf(actor)),
          targetCells,
        );
        if (distance <= reach) {
          if (!hasLineOfSight({ x: x, y: y }, target, map)) {
            continue;
          }
          cells.push({ x: x, y: y, distanceFeet: distance });
        }
      }
    }

    return cells;
  }

  /**
   * Cheapest A* route to the closest square that can attack the target.
   *
   * @returns {{found:boolean, inReach:boolean, destination:object, path:object[],
   *   costFeet:number, distanceFeet:number} | {found:false}}
   */
  function computeApproach(actor, from, target, map, combatants) {
    const reach = reachFeetOf(actor);
    const currentDistance = distanceAt(from.x, from.y, actor, target);

    if (
      currentDistance <= reach &&
      !isStrikeBlockedByWall(actor, from, target, map, combatants)
    ) {
      return {
        found: true,
        inReach: true,
        destination: { x: from.x, y: from.y },
        path: [{ x: from.x, y: from.y }],
        costFeet: 0,
        distanceFeet: currentDistance,
      };
    }

    const occupancy = buildMovementOccupancy(actor, combatants);
    const candidates = attackCellsAround(actor, target, map, combatants);
    let best = null;

    for (const candidate of candidates) {
      if (candidate.x === from.x && candidate.y === from.y) {
        continue;
      }
      const route = Pathfinding.findPath(from, { x: candidate.x, y: candidate.y }, {
        map: map,
        startDiagonalParity: Number.isInteger(actor.diagonalParity)
          ? actor.diagonalParity
          : 0,
        occupancy: occupancy,
        footprint: footprintOf(actor),
      });
      if (!route.found) {
        continue;
      }

      const entry = {
        found: true,
        inReach: false,
        destination: { x: candidate.x, y: candidate.y },
        path: route.path,
        costFeet: route.costFeet,
        distanceFeet: candidate.distanceFeet,
      };

      if (best === null || compareApproach(entry, best) < 0) {
        best = entry;
      }
    }

    return best === null ? { found: false } : best;
  }

  /**
   * Deterministic ordering: cheapest route, then closest final cell, then a
   * stable row/column order.
   */
  function compareApproach(a, b) {
    return (
      a.costFeet - b.costFeet ||
      a.distanceFeet - b.distanceFeet ||
      a.destination.y - b.destination.y ||
      a.destination.x - b.destination.x
    );
  }

  function movementCostAt(map, from, to, diagonalIndex) {
    const diagonal = from.x !== to.x && from.y !== to.y;
    let cost = diagonal
      ? Grid.diagonalStepCostFeet(diagonalIndex)
      : Grid.FEET_PER_SQUARE;
    if (
      typeof map.hasDifficultTerrain === "function" &&
      map.hasDifficultTerrain(to.x, to.y)
    ) {
      cost += Grid.DIFFICULT_TERRAIN_EXTRA_FEET;
    }
    return cost;
  }

  /**
   * The farthest path square that can be reached in a single Stride. When the
   * whole route fits inside Speed this is simply the final cell.
   */
  function lastReachableWaypoint(actor, path, speed, map, combatants) {
    if (path.length <= 1) {
      return null;
    }

    let diagonalSteps = Number.isInteger(actor.diagonalStepsThisTurn)
      ? actor.diagonalStepsThisTurn
      : 0;
    let cost = 0;
    let best = null;

    for (let index = 1; index < path.length; index += 1) {
      const from = path[index - 1];
      const to = path[index];
      const diagonal = from.x !== to.x && from.y !== to.y;
      cost += movementCostAt(map, from, to, diagonal ? diagonalSteps % 2 : 0);
      if (diagonal) {
        diagonalSteps += 1;
      }
      if (cost > speed) {
        break;
      }
      if (Occupancy.canOccupySpace(to.x, to.y, actor, map, combatants)) {
        best = { x: to.x, y: to.y };
      }
    }

    return best;
  }

  /**
   * When every attack cell is walled off, fall back to the reachable square
   * that gets closest to the target. This keeps the AI from freezing without
   * inventing teleports.
   */
  function computeFallbackMove(actor, from, target, map, combatants) {
    const speed = speedOf(actor);
    const occupancy = buildMovementOccupancy(actor, combatants);
    const reachable = Pathfinding.reachableCells(map, from, speed, {
      startDiagonalParity: Number.isInteger(actor.diagonalParity)
        ? actor.diagonalParity
        : 0,
      occupancy: occupancy,
      footprint: footprintOf(actor),
    });

    const currentDistance = distanceAt(from.x, from.y, actor, target);
    let best = null;

    for (const cell of reachable) {
      const distance = distanceAt(cell.x, cell.y, actor, target);
      if (distance >= currentDistance) {
        continue;
      }
      if (
        best === null ||
        distance < best.distanceFeet ||
        (distance === best.distanceFeet && cell.costFeet < best.costFeet) ||
        (distance === best.distanceFeet &&
          cell.costFeet === best.costFeet &&
          (cell.y < best.y || (cell.y === best.y && cell.x < best.x)))
      ) {
        best = { x: cell.x, y: cell.y, distanceFeet: distance, costFeet: cell.costFeet };
      }
    }

    if (!best) {
      return null;
    }

    return {
      type: ACTION_TYPES.STRIDE,
      actionCost: 1,
      destination: { x: best.x, y: best.y },
      reason: "fallback-approach",
    };
  }

  function isCellThreatened(actor, cell, combatants) {
    if (combatants.length === 0) {
      return false;
    }
    return (
      ReactiveStrike.findThreatenedEnemies({
        mover: actor,
        cell: cell,
        combatants: combatants,
      }).length > 0
    );
  }

  /**
   * Prefer a reaction-free Step when the current square is threatened. The
   * chosen square must be safe and should reduce the distance to the target.
   */
  function findSafeStep(actor, from, target, map, combatants) {
    let best = null;

    for (const direction of DIRECTIONS) {
      const destination = { x: from.x + direction.dx, y: from.y + direction.dy };
      if (!canStepTo(actor, from, destination, map, combatants)) {
        continue;
      }
      if (isCellThreatened(actor, destination, combatants)) {
        continue;
      }

      const distance = distanceAt(destination.x, destination.y, actor, target);
      if (
        best === null ||
        distance < best.distanceFeet ||
        (distance === best.distanceFeet &&
          (destination.y < best.destination.y ||
            (destination.y === best.destination.y &&
              destination.x < best.destination.x)))
      ) {
        best = {
          type: ACTION_TYPES.STEP,
          actionCost: 1,
          destination: destination,
          distanceFeet: distance,
          reason: "avoid-reactive-strike",
        };
      }
    }

    return best;
  }

  function chooseMovement(actor, state, target, map, combatants) {
    if (isImmobilized(actor)) {
      return null;
    }

    const from = { x: state.x, y: state.y };
    const speed = speedOf(actor);
    const approach = computeApproach(actor, from, target, map, combatants);
    let movement = null;

    if (approach.found) {
      if (approach.costFeet <= speed) {
        movement = {
          type: ACTION_TYPES.STRIDE,
          actionCost: 1,
          destination: approach.destination,
          reason: "approach",
          costFeet: approach.costFeet,
        };
      } else {
        const waypoint = lastReachableWaypoint(
          actor,
          approach.path,
          speed,
          map,
          combatants,
        );
        if (waypoint !== null) {
          movement = {
            type: ACTION_TYPES.STRIDE,
            actionCost: 1,
            destination: waypoint,
            reason: "approach-partial",
          };
        }
      }
    }

    if (movement === null) {
      movement = computeFallbackMove(actor, from, target, map, combatants);
    }

    // Leaving a threatened square provokes. A Step never does, so take one when
    // a safe adjacent square still advances the plan.
    if (movement !== null && isCellThreatened(actor, from, combatants)) {
      const step = findSafeStep(actor, from, target, map, combatants);
      if (step !== null) {
        return step;
      }
    }

    return movement;
  }

  // ------------------------------------------------------------- flanking

  /**
   * Whether the actor would already flank the target from `from`.
   */
  function isFlankedAt(actor, from, target, combatants) {
    if (!isHostileTo(actor, target)) {
      return false;
    }
    if (distanceAt(from.x, from.y, actor, target) > reachFeetOf(actor)) {
      return false;
    }
    const actorDirection = Flanking.directionFrom(target, from);
    if (actorDirection.x === 0 && actorDirection.y === 0) {
      return false;
    }

    return combatants.some(function (ally) {
      if (
        !ally ||
        typeof ally !== "object" ||
        sameCreature(ally, actor) ||
        sameCreature(ally, target)
      ) {
        return false;
      }
      if (isDefeated(ally)) {
        return false;
      }
      if (ally.alliance !== actor.alliance) {
        return false;
      }
      if (ally.alliance === target.alliance) {
        return false;
      }
      if (!isHostileTo(ally, target) || !isHostileTo(actor, target)) {
        return false;
      }
      if (distanceFeet(ally, target) > reachFeetOf(ally)) {
        return false;
      }
      const allyDirection = Flanking.directionFrom(target, ally);
      return Flanking.isOppositeDirection(actorDirection, allyDirection);
    });
  }

  /**
   * If an ally is already engaged, find the opposite square that completes the
   * flank and is reachable with a single 5-ft Step.
   */
  function findFlankStep(actor, state, target, map, combatants) {
    if (isFlankedAt(actor, state, target, combatants)) {
      return null;
    }
    // Large-target flank direction is a documented deferred refinement.
    if (footprintOf(target) !== 1) {
      return null;
    }

    const allies = combatants
      .filter(function (candidate) {
        return (
          candidate &&
          typeof candidate === "object" &&
          !sameCreature(candidate, actor) &&
          !sameCreature(candidate, target) &&
          !isDefeated(candidate) &&
          candidate.alliance === actor.alliance &&
          candidate.alliance !== target.alliance &&
          distanceFeet(candidate, target) <= reachFeetOf(candidate)
        );
      })
      .sort(function (a, b) {
        return stableId(a) < stableId(b) ? -1 : stableId(a) > stableId(b) ? 1 : 0;
      });

    for (const ally of allies) {
      const allyDirection = Flanking.directionFrom(target, ally);
      if (allyDirection.x === 0 && allyDirection.y === 0) {
        continue;
      }
      const destination = {
        x: target.x - allyDirection.x,
        y: target.y - allyDirection.y,
      };
      if (!canStepTo(actor, { x: state.x, y: state.y }, destination, map, combatants)) {
        continue;
      }
      if (distanceAt(destination.x, destination.y, actor, target) > reachFeetOf(actor)) {
        continue;
      }
      const destinationDirection = Flanking.directionFrom(target, destination);
      if (!Flanking.isOppositeDirection(destinationDirection, allyDirection)) {
        continue;
      }
      return {
        type: ACTION_TYPES.STEP,
        actionCost: 1,
        destination: destination,
        reason: "flank",
        allyId: ally.id === undefined ? null : ally.id,
      };
    }

    return null;
  }

  function stableId(combatant) {
    return String(combatant.id === undefined ? combatant.name || "" : combatant.id);
  }

  // --------------------------------------------------------------- targeting

  function rankTarget(actor, state, target, map, combatants) {
    const approach = computeApproach(
      actor,
      { x: state.x, y: state.y },
      target,
      map,
      combatants,
    );
    const fallback = distanceAt(state.x, state.y, actor, target) + 100000;
    return {
      target: target,
      approach: approach,
      costFeet: approach.found ? approach.costFeet : fallback,
    };
  }

  function selectTargetForState(actor, state, map, combatants) {
    const candidates = combatants.filter(function (candidate) {
      return isLivingHostile(actor, candidate);
    });
    if (candidates.length === 0) {
      return null;
    }

    const ranked = candidates.map(function (target) {
      return rankTarget(actor, state, target, map, combatants);
    });

    ranked.sort(function (a, b) {
      return (
        a.costFeet - b.costFeet ||
        a.target.currentHP - b.target.currentHP ||
        (stableId(a.target) < stableId(b.target) ? -1 : stableId(a.target) > stableId(b.target) ? 1 : 0)
      );
    });

    return ranked[0].target;
  }

  // --------------------------------------------------------------- decisions

  function defensiveAction(actor, map, combatants, state) {
    const shield = getShieldStatus(actor);
    if (shield.usable && !state.shieldRaised && state.actionsRemaining > 0) {
      return { type: ACTION_TYPES.RAISE_SHIELD, actionCost: 1, reason: "defence" };
    }
    return null;
  }

  function canTakeCoverNow(actor, map, combatants) {
    try {
      return TakeCover.canTakeCover({
        combatant: actor,
        map: map,
        combatants: combatants,
      }).ok === true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Choose exactly one next action from the current (possibly projected) state.
   * The execution loop calls this repeatedly, which is what makes target
   * switching after a kill automatic.
   */
  function chooseNextAction(state, environment) {
    const actor = state.actor;
    const map = environment.map;
    const combatants = environment.combatants;

    if (state.defeated || state.actionsRemaining <= 0) {
      return null;
    }
    if (!canTakeTurn(actor).ok) {
      return null;
    }

    if (state.prone) {
      const availability = Stand.canStand(actor);
      if (availability.ok) {
        return { type: ACTION_TYPES.STAND, actionCost: 1, reason: "stand-up" };
      }
      // Immobilized prone creatures cannot Stand but may still attack.
    }

    const target = selectTargetForState(actor, state, map, combatants);
    if (!target) {
      return defensiveAction(actor, map, combatants, state);
    }

    const reach = reachFeetOf(actor);
    const distance = distanceAt(state.x, state.y, actor, target);

    // The target is not strikeable when it is out of reach, or when a wall (or
    // total cover) blocks line of effect even though it is geometrically in
    // reach. Reposition around the obstruction instead of issuing a Strike the
    // engine will reject with "no-line-of-sight".
    const lineBlocked =
      distance <= reach &&
      isStrikeBlockedByWall(
        actor,
        { x: state.x, y: state.y },
        target,
        map,
        combatants,
      );

    // Out of melee reach (or blocked): close the distance around the wall.
    if (distance > reach || lineBlocked) {
      const movement = chooseMovement(actor, state, target, map, combatants);
      if (movement !== null) {
        return movement;
      }
      // No legal route: try another hostile before giving up on the turn.
      const fallback = combatants.filter(function (candidate) {
        return isLivingHostile(actor, candidate) && !sameCreature(candidate, target);
      });
      for (const candidate of fallback) {
        const alternative = chooseMovement(actor, state, candidate, map, combatants);
        if (alternative !== null) {
          return alternative;
        }
      }
      return defensiveAction(actor, map, combatants, state);
    }

    // Already in reach and strikeable. Do not spend actions closing in; only a
    // single-Step flank reposition is worth an action.
    if (state.actionsRemaining >= 2) {
      const flank = findFlankStep(actor, state, target, map, combatants);
      if (flank !== null) {
        return flank;
      }
    }

    const shield = getShieldStatus(actor);
    const attacksMade = state.attacksThisTurn;

    // Last action of a rotation that already attacked: prefer the shield.
    if (
      attacksMade > 0 &&
      state.actionsRemaining === 1 &&
      shield.usable &&
      !state.shieldRaised
    ) {
      return { type: ACTION_TYPES.RAISE_SHIELD, actionCost: 1, reason: "rotation" };
    }

    // No usable shield and this is the last action: Take Cover when available,
    // otherwise a third Strike.
    if (
      attacksMade > 0 &&
      state.actionsRemaining === 1 &&
      !shield.usable &&
      canTakeCoverNow(actor, map, combatants)
    ) {
      return { type: ACTION_TYPES.TAKE_COVER, actionCost: 1, reason: "rotation" };
    }

    return {
      type: ACTION_TYPES.STRIKE,
      actionCost: 1,
      target: target,
      targetId: target.id === undefined ? null : target.id,
      targetName: target.name === undefined ? null : target.name,
    };
  }

  function applyPlannedAction(state, action) {
    state.actionsRemaining = Math.max(0, state.actionsRemaining - 1);
    switch (action.type) {
      case ACTION_TYPES.STAND:
        state.prone = false;
        break;
      case ACTION_TYPES.STRIDE:
      case ACTION_TYPES.STEP:
        state.x = action.destination.x;
        state.y = action.destination.y;
        break;
      case ACTION_TYPES.STRIKE:
        state.attacksThisTurn += 1;
        break;
      case ACTION_TYPES.RAISE_SHIELD:
        state.shieldRaised = true;
        break;
      default:
        break;
    }
  }

  function describePlannedAction(action) {
    const description = {
      type: action.type,
      actionCost: action.actionCost === undefined ? 1 : action.actionCost,
    };
    if (action.destination !== undefined) {
      description.destination = {
        x: action.destination.x,
        y: action.destination.y,
      };
    }
    if (action.targetId !== undefined) {
      description.targetId = action.targetId;
    }
    if (action.targetName !== undefined) {
      description.targetName = action.targetName;
    }
    if (action.allyId !== undefined) {
      description.allyId = action.allyId;
    }
    if (action.reason !== undefined) {
      description.reason = action.reason;
    }
    return description;
  }

  // -------------------------------------------------------------- public API

  /**
   * Build the ordered action plan without mutating any combatant. The plan is
   * advisory: executeAITurn() re-plans after every action, because a Strike can
   * kill its target and invalidate the rest of the list.
   *
   * @param {{combatant: object, map: object, combatants: object[], encounter?: object}} options
   * @returns {{ok:true, combatantId:*, plan:object[], actionsRemaining:number,
   *   actionsSpent:number, reason?:string}}
   */
  function planTurn(options) {
    const opts = options || {};
    const combatant = opts.combatant;
    const map = opts.map;
    const combatants = normalizeRoster(opts.combatants);

    assertCombatant(combatant, "combatant");
    assertMap(map);

    const initialActions = Number.isInteger(combatant.actionsRemaining)
      ? combatant.actionsRemaining
      : 0;
    const availability = canTakeTurn(combatant);
    if (!availability.ok) {
      return {
        ok: true,
        combatantId: combatant.id === undefined ? null : combatant.id,
        plan: [],
        actionsRemaining: initialActions,
        actionsSpent: 0,
        reason: availability.reason,
      };
    }

    const state = snapshotState(combatant);
    if (state.actionsRemaining <= 0) {
      return {
        ok: true,
        combatantId: combatant.id === undefined ? null : combatant.id,
        plan: [],
        actionsRemaining: 0,
        actionsSpent: 0,
        reason: TACTICAL_AI_REASONS.NO_ACTIONS,
      };
    }

    const environment = { map: map, combatants: combatants };
    const plan = [];
    let guard = 0;

    while (state.actionsRemaining > 0 && guard < DEFAULT_MAX_ITERATIONS) {
      guard += 1;
      const action = chooseNextAction(state, environment);
      if (action === null) {
        break;
      }
      plan.push(describePlannedAction(action));
      applyPlannedAction(state, action);
    }

    return {
      ok: true,
      combatantId: combatant.id === undefined ? null : combatant.id,
      plan: plan,
      actionsRemaining: state.actionsRemaining,
      actionsSpent: initialActions - state.actionsRemaining,
      reason:
        plan.length === 0
          ? TACTICAL_AI_REASONS.NO_LEGAL_ACTION
          : undefined,
    };
  }

  function executeAction(action, environment) {
    const combatant = environment.combatant;
    const map = environment.map;
    const combatants = environment.combatants;
    const dieOptions = {
      rollD20: environment.rollD20,
      rollDamageDie: environment.rollDamageDie,
    };

    switch (action.type) {
      case ACTION_TYPES.STAND: {
        const result = Stand.performStand(
          Object.assign(
            {
              combatant: combatant,
              map: map,
              combatants: combatants,
              allies: combatants,
            },
            dieOptions,
          ),
        );
        return {
          type: ACTION_TYPES.STAND,
          actionCost: 1,
          ok: result.ok === true,
          reason: result.reason === undefined ? null : result.reason,
          result: result,
        };
      }

      case ACTION_TYPES.STRIDE: {
        const result = Stride.performStride(
          Object.assign(
            {
              combatant: combatant,
              map: map,
              destination: action.destination,
              combatants: combatants,
              allies: combatants,
              occupancy: buildMovementOccupancy(combatant, combatants),
            },
            dieOptions,
          ),
        );
        return {
          type: ACTION_TYPES.STRIDE,
          actionCost: 1,
          ok: result.ok === true,
          reason:
            result.ok === true
              ? action.reason === undefined
                ? null
                : action.reason
              : result.reason === undefined
                ? null
                : result.reason,
          destination: {
            x: action.destination.x,
            y: action.destination.y,
          },
          path: result.path === undefined ? null : result.path,
          costFeet: result.costFeet === undefined ? null : result.costFeet,
          reactions: result.reactions === undefined ? [] : result.reactions,
          result: result,
        };
      }

      case ACTION_TYPES.STEP: {
        const result = Step.performStep(
          Object.assign(
            {
              combatant: combatant,
              map: map,
              destination: action.destination,
              combatants: combatants,
              allies: combatants,
              occupancy: buildMovementOccupancy(combatant, combatants),
            },
            dieOptions,
          ),
        );
        return {
          type: ACTION_TYPES.STEP,
          actionCost: 1,
          ok: result.ok === true,
          reason:
            result.ok === true
              ? action.reason === undefined
                ? null
                : action.reason
              : result.reason === undefined
                ? null
                : result.reason,
          destination: {
            x: action.destination.x,
            y: action.destination.y,
          },
          path: result.path === undefined ? null : result.path,
          result: result,
        };
      }

      case ACTION_TYPES.STRIKE: {
        const target = action.target;
        const result = Strike.performStrike(
          Object.assign(
            {
              attacker: combatant,
              target: target,
              map: map,
              combatants: combatants,
              allies: combatants,
            },
            dieOptions,
          ),
        );
        return {
          type: ACTION_TYPES.STRIKE,
          actionCost: 1,
          ok: result.ok === true,
          reason: result.reason === undefined ? null : result.reason,
          targetId: target.id === undefined ? null : target.id,
          targetName: target.name === undefined ? null : target.name,
          hit: result.hit === true,
          critical: result.critical === true,
          mapPenalty:
            result.mapPenalty === undefined ? null : result.mapPenalty,
          attackRoll:
            result.attackRoll === undefined ? null : result.attackRoll,
          total: result.total === undefined ? null : result.total,
          dc: result.dc === undefined ? null : result.dc,
          damageDealt:
            result.damageDealt === undefined ? 0 : result.damageDealt,
          hpBefore: result.hpBefore === undefined ? null : result.hpBefore,
          hpAfter: result.hpAfter === undefined ? null : result.hpAfter,
          targetDefeated: result.targetDefeated === true,
          result: result,
        };
      }

      case ACTION_TYPES.RAISE_SHIELD: {
        const result = RaiseShield.performRaiseShield({ combatant: combatant });
        return {
          type: ACTION_TYPES.RAISE_SHIELD,
          actionCost: 1,
          ok: result.ok === true,
          reason: result.reason === undefined ? null : result.reason,
          actionsLeft:
            result.actionsLeft === undefined ? combatant.actionsRemaining : result.actionsLeft,
          result: result,
        };
      }

      case ACTION_TYPES.TAKE_COVER: {
        const result = TakeCover.performTakeCover({
          combatant: combatant,
          map: map,
          combatants: combatants,
        });
        return {
          type: ACTION_TYPES.TAKE_COVER,
          actionCost: 1,
          ok: result.ok === true,
          reason: result.reason === undefined ? null : result.reason,
          coverDegree:
            result.coverDegree === undefined ? null : result.coverDegree,
          actionsLeft:
            result.actionsLeft === undefined ? combatant.actionsRemaining : result.actionsLeft,
          result: result,
        };
      }

      default:
        return {
          type: action.type,
          actionCost: 0,
          ok: false,
          reason: TACTICAL_AI_REASONS.NO_LEGAL_ACTION,
          result: null,
        };
    }
  }

  function finalStateOf(combatant) {
    return {
      id: combatant.id === undefined ? null : combatant.id,
      name: combatant.name === undefined ? null : combatant.name,
      position: { x: combatant.x, y: combatant.y },
      currentHP:
        Number.isInteger(combatant.currentHP) ? combatant.currentHP : null,
      maxHP: Number.isInteger(combatant.maxHP) ? combatant.maxHP : null,
      actionsRemaining: combatant.actionsRemaining,
      reactionsRemaining: combatant.reactionsRemaining,
      attacksThisTurn: Number.isInteger(combatant.attacksThisTurn)
        ? combatant.attacksThisTurn
        : 0,
      isDefeated: isDefeated(combatant),
      prone: hasCondition(combatant, PRONE),
      shieldRaised: hasCondition(combatant, SHIELD_RAISED),
      conditions:
        typeof combatant.getConditions === "function"
          ? combatant.getConditions().map(function (condition) {
              return condition.name;
            })
          : [],
    };
  }

  /**
   * Drive one complete turn from the current state. Core actions spend the
   * combatant's live action pool; the encounter clock is untouched.
   *
   * @param {{
   *   combatant: object,
   *   map: object,
   *   combatants: object[],
   *   encounter?: object,
   *   rollD20?: () => number,
   *   rollDamageDie?: (sides:number) => number
   * }} options
   * @returns {{ok:true, combatantId:*, executedActions:object[],
   *   actionsSpent:number, actionsRemaining:number, finalState:object,
   *   reason?:string}}
   */
  function executeAITurn(options) {
    const opts = options || {};
    const combatant = opts.combatant;
    const map = opts.map;
    const combatants = normalizeRoster(opts.combatants);

    assertCombatant(combatant, "combatant");
    assertMap(map);

    const initialActions = Number.isInteger(combatant.actionsRemaining)
      ? combatant.actionsRemaining
      : 0;
    // Optional cap used by the UI's "AI Step" control. Omitting it keeps the
    // canonical full-turn behaviour; one step still re-plans from live state.
    const maxActions =
      Number.isInteger(opts.maxActions) && opts.maxActions > 0
        ? opts.maxActions
        : Infinity;
    const executedActions = [];
    const availability = canTakeTurn(combatant);

    if (!availability.ok) {
      return {
        ok: true,
        combatantId: combatant.id === undefined ? null : combatant.id,
        executedActions: executedActions,
        actionsSpent: 0,
        actionsRemaining: combatant.actionsRemaining,
        finalState: finalStateOf(combatant),
        reason: availability.reason,
      };
    }

    const environment = {
      combatant: combatant,
      map: map,
      combatants: combatants,
      rollD20: opts.rollD20,
      rollDamageDie: opts.rollDamageDie,
    };

    let guard = 0;
    while (
      combatant.actionsRemaining > 0 &&
      guard < DEFAULT_MAX_ITERATIONS &&
      executedActions.length < maxActions
    ) {
      guard += 1;

      // Re-snapshot after every action so movement, MAP, conditions, and a
      // target's death are all reflected immediately.
      const state = snapshotState(combatant);
      const action = chooseNextAction(state, environment);
      if (action === null) {
        break;
      }

      const executed = executeAction(action, environment);
      executedActions.push(executed);

      if (!executed.ok) {
        break;
      }
      if (isDefeated(combatant)) {
        break;
      }
    }

    return {
      ok: true,
      combatantId: combatant.id === undefined ? null : combatant.id,
      executedActions: executedActions,
      actionsSpent: initialActions - combatant.actionsRemaining,
      actionsRemaining: combatant.actionsRemaining,
      finalState: finalStateOf(combatant),
      reason:
        executedActions.length === 0
          ? TACTICAL_AI_REASONS.NO_LEGAL_ACTION
          : undefined,
    };
  }

  /**
   * Public target-acquisition helper. Returns the nearest living hostile by
   * A* approach cost, with the lowest current HP as the tie-breaker.
   *
   * @param {{combatant: object, map: object, combatants: object[]}} options
   * @returns {object|null}
   */
  function selectTarget(options) {
    const opts = options || {};
    assertCombatant(opts.combatant, "combatant");
    assertMap(opts.map);
    return selectTargetForState(
      opts.combatant,
      snapshotState(opts.combatant),
      opts.map,
      normalizeRoster(opts.combatants),
    );
  }

  return Object.freeze({
    ACTION_TYPES: ACTION_TYPES,
    TACTICAL_AI_REASONS: TACTICAL_AI_REASONS,
    DEFAULT_SPEED_FEET: DEFAULT_SPEED_FEET,
    DEFAULT_REACH_FEET: DEFAULT_REACH_FEET,
    DEFAULT_MAX_ITERATIONS: DEFAULT_MAX_ITERATIONS,
    canTakeTurn: canTakeTurn,
    getShieldStatus: getShieldStatus,
    selectTarget: selectTarget,
    planTurn: planTurn,
    executeAITurn: executeAITurn,
  });
});
