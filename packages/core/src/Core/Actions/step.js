/**
 * PF2E REMASTERED — STEP ACTION (HEADLESS CORE)
 *
 * PF2e Step: 1 action, move exactly 5 feet into an adjacent square.
 *
 * Implemented constraints:
 *   - one orthogonal or diagonal square only;
 *   - cannot enter difficult terrain;
 *   - cannot enter a solid obstacle, an enemy, or an ally's square;
 *   - diagonal steps obey the project's block-any corner policy.
 *
 * Step is a fixed 5-foot move, not Speed-based movement. It therefore does not
 * advance the 5-10-5 diagonal alternation used by Stride.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Grid/pathfinding.js"),
      require("../Entities/conditions.js"),
      require("../Rules/damage.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.Step = factory(
      root.PF2e.Core.Pathfinding,
      root.PF2e.Core.Conditions,
      root.PF2e.Core.Rules.Damage,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Pathfinding,
  Conditions,
  Damage,
) {
  "use strict";

  const STEP_REASONS = Object.freeze({
    NO_ACTIONS: "no-actions",
    IMMOBILIZED: "immobilized",
    ALREADY_THERE: "already-there",
    NOT_ADJACENT: "not-adjacent",
    OUT_OF_BOUNDS: "out-of-bounds",
    BLOCKED_START: "blocked-start",
    BLOCKED_DESTINATION: "blocked-destination",
    DESTINATION_OCCUPIED: "destination-occupied",
    DIFFICULT_TERRAIN: "difficult-terrain",
    CORNER_BLOCKED: "corner-blocked",
    NO_ROUTE: "no-route",
  });

  const DIRECTIONS = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: -1 },
    { dx: 1, dy: 1 },
    { dx: -1, dy: 1 },
    { dx: -1, dy: -1 },
  ];

  function assertCombatant(combatant) {
    if (
      !combatant ||
      typeof combatant !== "object" ||
      !Number.isInteger(combatant.x) ||
      !Number.isInteger(combatant.y)
    ) {
      throw new TypeError("Step requires a positioned Combatant.");
    }
  }

  function assertMap(map) {
    if (!map || typeof map.isBlocked !== "function") {
      throw new TypeError("Step requires a GridMap.");
    }
  }

  function assertDestination(destination) {
    if (
      destination === null ||
      typeof destination !== "object" ||
      !Number.isInteger(destination.x) ||
      !Number.isInteger(destination.y)
    ) {
      throw new TypeError("Step requires an integer destination cell.");
    }
  }

  function mapPathFailure(reason) {
    switch (reason) {
      case "blocked-goal":
        return STEP_REASONS.BLOCKED_DESTINATION;
      case "goal-occupied":
        return STEP_REASONS.DESTINATION_OCCUPIED;
      case "blocked-start":
        return STEP_REASONS.BLOCKED_START;
      case "out-of-bounds":
        return STEP_REASONS.OUT_OF_BOUNDS;
      case "no-path":
        return STEP_REASONS.CORNER_BLOCKED;
      default:
        return STEP_REASONS.NO_ROUTE;
    }
  }

  /**
   * Geometry, terrain, occupancy, and corner validation. Does not check the
   * action pool and does not mutate state.
   *
   * @param {{
   *   combatant: object,
   *   map: object,
   *   destination: {x:number,y:number},
   *   occupancy?: object,
   *   diagonalCornerPolicy?: string
   * }} options
   * @returns {{ok:true, costFeet:5, distanceFeet:5} | {ok:false, reason:string}}
   */
  function evaluateStep(options) {
    const opts = options || {};
    assertCombatant(opts.combatant);
    assertMap(opts.map);
    assertDestination(opts.destination);

    const combatant = opts.combatant;
    const map = opts.map;
    const destination = opts.destination;

    // Immobilized forbids move actions outright; no geometry is evaluated.
    if (
      (typeof combatant.isImmobilized === "function" && combatant.isImmobilized()) ||
      Conditions.isImmobilized(combatant)
    ) {
      return { ok: false, reason: STEP_REASONS.IMMOBILIZED };
    }

    const dx = destination.x - combatant.x;
    const dy = destination.y - combatant.y;

    if (!map.isInBounds(destination.x, destination.y)) {
      return { ok: false, reason: STEP_REASONS.OUT_OF_BOUNDS };
    }
    if (dx === 0 && dy === 0) {
      return { ok: false, reason: STEP_REASONS.ALREADY_THERE };
    }
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) {
      return { ok: false, reason: STEP_REASONS.NOT_ADJACENT };
    }
    if (map.isBlocked(destination.x, destination.y)) {
      return { ok: false, reason: STEP_REASONS.BLOCKED_DESTINATION };
    }
    if (
      (typeof map.hasDifficultTerrain === "function" &&
        map.hasDifficultTerrain(destination.x, destination.y)) ||
      (typeof map.isDifficultTerrain === "function" &&
        map.isDifficultTerrain(destination.x, destination.y))
    ) {
      return { ok: false, reason: STEP_REASONS.DIFFICULT_TERRAIN };
    }

    const route = Pathfinding.findPath(
      { x: combatant.x, y: combatant.y },
      { x: destination.x, y: destination.y },
      {
        map: map,
        startDiagonalParity: combatant.diagonalParity || 0,
        diagonalCornerPolicy: opts.diagonalCornerPolicy,
        occupancy: opts.occupancy,
        footprint:
          typeof combatant.getFootprint === "function"
            ? combatant.getFootprint()
            : 1,
      },
    );

    if (!route.found) {
      return { ok: false, reason: mapPathFailure(route.reason) };
    }

    // A Step is one square. If the direct diagonal is forbidden by the corner
    // policy, A* can still find a two-step detour; that is not a Step.
    if (route.path.length !== 2) {
      return { ok: false, reason: STEP_REASONS.CORNER_BLOCKED };
    }

    return { ok: true, costFeet: 5, distanceFeet: 5 };
  }

  /**
   * @param {{
   *   combatant: object,
   *   map: object,
   *   destination: {x:number,y:number},
   *   occupancy?: object,
   *   diagonalCornerPolicy?: string
   * }} options
   * @returns {{
   *   ok:true,
   *   path:{x:number,y:number}[],
   *   costFeet:5,
   *   actionsLeft:number,
   *   diagonalSteps:number,
   *   diagonalParity:number
   * } | {ok:false, reason:string}}
   */
  function performStep(options) {
    const opts = options || {};
    assertCombatant(opts.combatant);

    const combatant = opts.combatant;
    if (typeof combatant.canSpendActions !== "function") {
      throw new TypeError("Step requires a Combatant with an action pool.");
    }
    if (!combatant.canSpendActions(1)) {
      return { ok: false, reason: STEP_REASONS.NO_ACTIONS };
    }

    const evaluation = evaluateStep(opts);
    if (!evaluation.ok) {
      return evaluation;
    }

    const origin = { x: combatant.x, y: combatant.y };
    combatant.spendActions(1);
    combatant.setPosition(opts.destination.x, opts.destination.y);

    // Hazardous terrain: entering the cell deals damage immediately.
    let hazardousDamageTaken = [];
    if (typeof opts.map.getHazardous === "function") {
      const hazardRecord = opts.map.getHazardous(opts.destination.x, opts.destination.y);
      if (hazardRecord) {
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
        hazardousDamageTaken.push({
          cell: { x: opts.destination.x, y: opts.destination.y },
          formula: hazardRecord.damage,
          type: damage.type,
          damage: damage,
          damageDealt:
            applied.damageApplied === undefined ? damage.total : applied.damageApplied,
          hpBefore: hpBefore,
          hpAfter: applied.currentHP,
          defeated: applied.isDefeated,
        });
      }
    }

    // Take Cover's greater cover ends as soon as the creature moves.
    if (typeof combatant.removeCondition === "function") {
      combatant.removeCondition("greater-cover");
    }

    // Stepping away breaks any grapple this creature maintains.
    const roster = Array.isArray(opts.combatants)
      ? opts.combatants
      : Array.isArray(opts.allies)
        ? opts.allies
        : [];
    const releasedGrapples = Conditions.releaseGrapplesBySource(
      roster,
      combatant.id,
    );

    const stepResult = {
      ok: true,
      path: [origin, { x: opts.destination.x, y: opts.destination.y }],
      costFeet: 5,
      actionsLeft: combatant.actionsRemaining,
      diagonalSteps: combatant.diagonalStepsThisTurn,
      diagonalParity: combatant.diagonalParity,
      releasedGrapples: releasedGrapples,
      hazardousDamageTaken: hazardousDamageTaken,
    };

    if (typeof combatant.emitEvent === "function") {
      combatant.emitEvent("combatant:moved", {
        movementType: "step",
        path: stepResult.path,
        costFeet: 5,
        actionsSpent: 1,
        actionsLeft: combatant.actionsRemaining,
        from: origin,
        to: { x: opts.destination.x, y: opts.destination.y },
        interrupted: false,
        destinationReached: true,
      });
    }

    return stepResult;
  }

  /**
   * Adjacent squares that a Step could legally enter right now (ignoring the
   * action pool). Used by the View for Step-mode highlights.
   *
   * @param {{
   *   combatant: object,
   *   map: object,
   *   occupancy?: object,
   *   diagonalCornerPolicy?: string
   * }} options
   * @returns {{x:number,y:number,costFeet:number}[]}
   */
  function getStepDestinations(options) {
    const opts = options || {};
    assertCombatant(opts.combatant);
    assertMap(opts.map);

    const cells = [];
    for (const dir of DIRECTIONS) {
      const destination = {
        x: opts.combatant.x + dir.dx,
        y: opts.combatant.y + dir.dy,
      };
      const evaluation = evaluateStep({
        combatant: opts.combatant,
        map: opts.map,
        destination: destination,
        occupancy: opts.occupancy,
        diagonalCornerPolicy: opts.diagonalCornerPolicy,
      });
      if (evaluation.ok) {
        cells.push({ x: destination.x, y: destination.y, costFeet: 5 });
      }
    }
    return cells;
  }

  return Object.freeze({
    STEP_REASONS: STEP_REASONS,
    evaluateStep: evaluateStep,
    performStep: performStep,
    getStepDestinations: getStepDestinations,
  });
});
