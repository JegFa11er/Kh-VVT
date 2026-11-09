/**
 * PF2E REMASTERED — HEADLESS AI STRESS-TEST (AI vs AI)
 *
 * Runs a deterministic, seeded sequence of random encounters where two teams of
 * computer-controlled combatants fight to the death on procedurally generated
 * battlefields. Every turn of every round re-validates the core combat
 * invariants so a rules regression surfaces as a loud test failure instead of a
 * silent state corruption.
 *
 * Feature Readiness:
 * - goal: prove the headless Core (Encounter + TacticalAI + GridMap + Combatant)
 *   survives thousands of randomized AI-vs-AI turns without crashing, without
 *   violating HP/action/occupancy/condition invariants, and without deadlocking.
 * - pf2e_remaster_rule: exercises the existing engine rather than adding rules.
 *   The invariants encode the Remastered contracts the Core already implements:
 *   * HP is clamped to [0, maxHP]; 0 HP is the defeated state.
 *   * A combatant has 3 actions (maxActions) per turn, reset at turn start.
 *   * A living creature's footprint never overlaps a wall or another living
 *     creature (occupancy is validated by Occupancy.canOccupySpace on every move).
 *   * Restrained blocks actions with the attack or manipulate trait (Escape is
 *     the only exception); the AI's only attack-trait action is Strike.
 *   * Grabbed resolves a DC 5 flat check for manipulate actions.
 * - behavior_and_boundaries: generates 15x15 or 20x20 arenas with 5–15 walls
 *   (connectivity is verified), difficult/greater-difficult/hazardous (fire
 *   1d6) terrain, and 1–2 traps (modelled as concentrated hazardous cells so
 *   the AI's Stride actually triggers them). Two teams of 2–4 fighters span
 *   Tiny→Huge sizes and six equipment profiles (plain melee, reach, trip/
 *   grapple weapons, shield, caster with spell slots + focus, ranged). The
 *   combat loop is: Encounter.rollInitiative() → TacticalAI.executeAITurn() →
 *   Encounter.nextTurn(), capped at 15 rounds per battle (timeout is a valid
 *   outcome, not an error). The AI only fights in melee (ranged kiting and
 *   spell selection are documented deferred limitations); ranged/caster
 *   profiles still exercise the weapon-profile and resource normalizers.
 * - data_contracts: consumes GridMap, Combatant, Encounter, TacticalAI, Strike,
 *   Stride. Produces a per-battle audit (winner, round, turns, anomalies) and a
 *   summary line logged to stdout.
 * - acceptance_tests: this file. `t.test` cases cover (a) arena/roster
 *   generation sanity, (b) the Restrained action gate, (c) the Grabbed DC-5
 *   manipulate flat check, and (d) the >= 25-battle simulation with per-turn
 *   invariant validation. Run via `tests/run-node.js` (`npm test`).
 * - delegated_assumptions: stress-test stat blocks are synthetic fixtures, not
 *   canonical bestiary data. "Traps" are represented as concentrated hazardous
 *   terrain (the AI never interacts with the Hazard entity). A timeout at the
 *   15-round cap is reported as `timeout`, never as a failure. Every combatant
 *   effectively threatens Reactive Strike (the engine has no per-creature
 *   reactive-strike feature flag), which is intentionally exercised.
 * - confidence: 95%.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Encounter/encounter.js"),
      require("../../src/Core/AI/tactical-ai.js"),
      require("../../src/Core/Actions/strike.js"),
      require("../../src/Core/Actions/stride.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/AI — Headless AI Stress Simulation",
      register: factory(
        root.PF2e.Core.GridMap,
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Encounter,
        root.PF2e.Core.AI.TacticalAI,
        root.PF2e.Core.Actions.Strike,
        root.PF2e.Core.Actions.Stride,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  GridMap,
  Combatant,
  Encounter,
  TacticalAI,
  Strike,
  Stride,
) {
  "use strict";

  if (!GridMap || !Combatant || !Encounter || !TacticalAI || !Strike || !Stride) {
    throw new Error(
      "Stress simulation requires GridMap, Combatant, Encounter, TacticalAI, Strike and Stride.",
    );
  }

  // ------------------------------------------------------------------ config

  const DEFAULT_BATTLES = 25;
  const MAX_ROUNDS = 15;
  const MAX_TURNS = 1000; // absolute deadlock guard, far above 15 rounds x 8 actors
  const STALL_TURNS = 8; // consecutive no-progress turns that flag a strategic stall
  const DEFAULT_SEED = 0xc0ffee;

  function readEnvInt(name, fallback) {
    if (typeof process !== "undefined" && process.env) {
      const raw = process.env[name];
      if (raw !== undefined && raw !== "") {
        const value = Number.parseInt(raw, 10);
        if (Number.isInteger(value) && value >= 0) {
          return value;
        }
      }
    }
    return fallback;
  }

  const BATTLE_COUNT = readEnvInt("PF2E_STRESS_BATTLES", DEFAULT_BATTLES);
  const BASE_SEED = readEnvInt("PF2E_STRESS_SEED", DEFAULT_SEED);

  // -------------------------------------------------------------- seeded rng

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createRng(seed) {
    const next = mulberry32(seed);
    return {
      next: next,
      int: function (min, max) {
        return min + Math.floor(next() * (max - min + 1));
      },
      pick: function (list) {
        return list[Math.floor(next() * list.length)];
      },
      chance: function (probability) {
        return next() < probability;
      },
      die: function (sides) {
        return 1 + Math.floor(next() * sides);
      },
    };
  }

  // -------------------------------------------------------------- geometry

  const ORTHO = Object.freeze([
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
  ]);

  function key(x, y) {
    return x + "," + y;
  }

  function freeCellCount(map) {
    let count = 0;
    for (let y = 0; y < map.rows; y += 1) {
      for (let x = 0; x < map.cols; x += 1) {
        if (!map.hasObstacle(x, y)) {
          count += 1;
        }
      }
    }
    return count;
  }

  /**
   * True when every non-wall cell is reachable from the first non-wall cell.
   * Guarantees walls never split the map into isolated islands (which would
   * strand combatants away from any fight).
   */
  function isFullyConnected(map) {
    let start = null;
    for (let y = 0; y < map.rows && start === null; y += 1) {
      for (let x = 0; x < map.cols; x += 1) {
        if (!map.hasObstacle(x, y)) {
          start = { x: x, y: y };
          break;
        }
      }
    }
    if (start === null) {
      return true; // degenerate all-wall map
    }
    const total = freeCellCount(map);
    const visited = new Set([key(start.x, start.y)]);
    const stack = [start];
    while (stack.length > 0) {
      const cell = stack.pop();
      for (const dir of ORTHO) {
        const nx = cell.x + dir.dx;
        const ny = cell.y + dir.dy;
        if (!map.isInBounds(nx, ny) || map.hasObstacle(nx, ny)) {
          continue;
        }
        const nk = key(nx, ny);
        if (visited.has(nk)) {
          continue;
        }
        visited.add(nk);
        stack.push({ x: nx, y: ny });
      }
    }
    return visited.size === total;
  }

  function randomFreeCell(rng, map) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const x = rng.int(0, map.cols - 1);
      const y = rng.int(0, map.rows - 1);
      if (!map.hasObstacle(x, y)) {
        return { x: x, y: y };
      }
    }
    return null;
  }

  /** Grow a small random-walk blob of non-wall cells from a seed cell. */
  function growBlob(rng, map, start, count) {
    const blob = [start];
    const seen = new Set([key(start.x, start.y)]);
    let frontier = [start];
    while (blob.length < count && frontier.length > 0) {
      const cell = rng.pick(frontier);
      const neighbors = [];
      for (const dir of ORTHO) {
        const nx = cell.x + dir.dx;
        const ny = cell.y + dir.dy;
        if (!map.isInBounds(nx, ny) || map.hasObstacle(nx, ny)) {
          continue;
        }
        const nk = key(nx, ny);
        if (!seen.has(nk)) {
          neighbors.push({ x: nx, y: ny });
        }
      }
      if (neighbors.length === 0) {
        frontier = frontier.filter(function (f) {
          return f.x !== cell.x || f.y !== cell.y;
        });
        continue;
      }
      const nextCell = rng.pick(neighbors);
      seen.add(key(nextCell.x, nextCell.y));
      blob.push(nextCell);
      frontier.push(nextCell);
    }
    return blob;
  }

  function placeWalls(rng, map, target) {
    const placed = [];
    for (let attempt = 0; attempt < 80; attempt += 1) {
      for (const cell of placed) {
        map.setBlocked(cell.x, cell.y, false);
      }
      placed.length = 0;
      for (let i = 0; i < target; i += 1) {
        for (let guard = 0; guard < 50; guard += 1) {
          const x = rng.int(0, map.cols - 1);
          const y = rng.int(0, map.rows - 1);
          if (map.hasObstacle(x, y)) {
            continue;
          }
          map.setBlocked(x, y, true);
          placed.push({ x: x, y: y });
          break;
        }
      }
      if (isFullyConnected(map)) {
        return placed;
      }
    }
    // Extremely unlikely fallback: drop the walls entirely.
    for (const cell of placed) {
      map.setBlocked(cell.x, cell.y, false);
    }
    placed.length = 0;
    return placed;
  }

  function placeTerrainClusters(rng, map, type, clusters, minCells, maxCells) {
    for (let i = 0; i < clusters; i += 1) {
      const seed = randomFreeCell(rng, map);
      if (seed === null) {
        continue;
      }
      const count = rng.int(minCells, maxCells);
      const blob = growBlob(rng, map, seed, count);
      for (const cell of blob) {
        map.setTerrain(cell.x, cell.y, type);
      }
    }
  }

  function placeHazardous(rng, map, count, formula, type) {
    for (let i = 0; i < count; i += 1) {
      const seed = randomFreeCell(rng, map);
      if (seed === null) {
        continue;
      }
      map.setHazardous(seed.x, seed.y, { damage: formula, type: type });
    }
  }

  /** 1–2 traps: dense concentrated hazardous (fire 1d6) patches. */
  function placeTraps(rng, map, count) {
    for (let i = 0; i < count; i += 1) {
      const seed = randomFreeCell(rng, map);
      if (seed === null) {
        continue;
      }
      const cells = growBlob(rng, map, seed, rng.int(2, 3));
      for (const cell of cells) {
        map.setHazardous(cell.x, cell.y, { damage: "1d6", type: "fire" });
      }
    }
  }

  function generateArena(rng) {
    const dimension = rng.chance(0.5) ? 20 : 15;
    const map = new GridMap({ cols: dimension, rows: dimension });

    placeWalls(rng, map, rng.int(5, 15));
    placeTerrainClusters(rng, map, "difficult", rng.int(1, 3), 3, 8);
    placeTerrainClusters(rng, map, "greater-difficult", rng.int(0, 2), 2, 5);
    placeHazardous(rng, map, rng.int(2, 5), "1d6", "fire");
    placeTraps(rng, map, rng.int(1, 2));

    return map;
  }

  // ---------------------------------------------------------- combatant gen

  const SIZES = Object.freeze(["tiny", "small", "medium", "large", "huge"]);
  const PROFILES = Object.freeze([
    "melee",
    "reach",
    "maneuver",
    "shield",
    "caster",
    "ranged",
  ]);

  // Synthetic stress-test stat blocks (not canonical bestiary data).
  function sizeBase(size) {
    switch (size) {
      case "tiny":
        return { maxHP: 10, ac: 17, attackBonus: 7, damage: "1d6+1" };
      case "small":
        return { maxHP: 16, ac: 17, attackBonus: 8, damage: "1d6+2" };
      case "medium":
        return { maxHP: 24, ac: 17, attackBonus: 9, damage: "1d8+3" };
      case "large":
        return { maxHP: 40, ac: 16, attackBonus: 10, damage: "1d10+4" };
      case "huge":
        return { maxHP: 60, ac: 15, attackBonus: 11, damage: "2d8+4" };
      default:
        return { maxHP: 24, ac: 17, attackBonus: 9, damage: "1d8+3" };
    }
  }

  function generateCombatant(rng, alliance, index) {
    const size = rng.pick(SIZES);
    const profile = rng.pick(PROFILES);
    const base = sizeBase(size);

    const opts = {
      id: (alliance === "player" ? "p" : "e") + (index + 1),
      name:
        (alliance === "player" ? "Hero" : "Foe") +
        " " +
        (index + 1) +
        " (" +
        size +
        ")",
      alliance: alliance,
      initiative: rng.int(0, 20),
      x: 0,
      y: 0,
      speedFeet: rng.pick([20, 25, 30, 35]),
      maxActions: 3,
      maxHP: base.maxHP,
      currentHP: base.maxHP,
      ac: base.ac,
      attackBonus: base.attackBonus,
      damage: { formula: base.damage, type: rng.pick(["slashing", "piercing", "bludgeoning"]) },
      agile: rng.chance(0.4),
      size: size,
      saves: {
        fortitude: rng.int(2, 10),
        reflex: rng.int(2, 10),
        will: rng.int(2, 10),
      },
      skills: {
        athletics: rng.int(2, 10),
        acrobatics: rng.int(2, 10),
        stealth: rng.int(0, 8),
        perception: rng.int(2, 10),
      },
    };

    switch (profile) {
      case "reach":
        opts.traits = ["reach"];
        break;
      case "maneuver":
        opts.traits = rng.pick([["trip"], ["grapple"], ["trip", "grapple"]]);
        break;
      case "shield":
        opts.shield = {
          id: "steel-shield",
          name: "Steel Shield",
          hardness: 5,
          hp: 20,
          maxHP: 20,
          brokenThreshold: 10,
          acBonus: 2,
          speedPenalty: 0,
        };
        break;
      case "caster":
        opts.spellSlots = { 1: 2, 2: 1 };
        opts.focusPoints = { max: 1, current: 1 };
        break;
      case "ranged":
        opts.rangeIncrement = rng.pick([30, 60]);
        opts.reload = rng.chance(0.5) ? 0 : 1;
        opts.isLoaded = true;
        break;
      default:
        break;
    }

    return new Combatant(opts);
  }

  function footprintFits(map, x, y, footprint, occupied) {
    for (let dx = 0; dx < footprint; dx += 1) {
      for (let dy = 0; dy < footprint; dy += 1) {
        const cx = x + dx;
        const cy = y + dy;
        if (!map.isInBounds(cx, cy) || map.hasObstacle(cx, cy)) {
          return false;
        }
        if (map.hasHazardous(cx, cy)) {
          return false;
        }
        if (occupied.has(key(cx, cy))) {
          return false;
        }
      }
    }
    return true;
  }

  function placeCombatant(rng, map, combatant, occupied, half) {
    const footprint = combatant.getFootprint();
    const halfX = Math.floor(map.cols / 2);
    const xMin = half === "player" ? 0 : halfX;
    const xMax = half === "player" ? halfX - footprint : map.cols - footprint;
    if (xMax < xMin) {
      return false;
    }
    const maxY = map.rows - footprint;

    for (let attempt = 0; attempt < 300; attempt += 1) {
      const x = rng.int(xMin, xMax);
      const y = rng.int(0, maxY);
      if (!footprintFits(map, x, y, footprint, occupied)) {
        continue;
      }
      combatant.setPosition(x, y);
      for (let dx = 0; dx < footprint; dx += 1) {
        for (let dy = 0; dy < footprint; dy += 1) {
          occupied.add(key(x + dx, y + dy));
        }
      }
      return true;
    }
    return false;
  }

  /** @returns {Combatant[]|null} null when any spawn placement failed. */
  function generateCombatants(rng, map) {
    const playerCount = rng.int(2, 4);
    const enemyCount = rng.int(2, 4);
    const combatants = [];
    const occupied = new Set();

    for (let i = 0; i < playerCount; i += 1) {
      const combatant = generateCombatant(rng, "player", i);
      if (!placeCombatant(rng, map, combatant, occupied, "player")) {
        return null;
      }
      combatants.push(combatant);
    }
    for (let i = 0; i < enemyCount; i += 1) {
      const combatant = generateCombatant(rng, "enemy", i);
      if (!placeCombatant(rng, map, combatant, occupied, "enemy")) {
        return null;
      }
      combatants.push(combatant);
    }
    return combatants;
  }

  function generateBattle(rng) {
    const map = generateArena(rng);
    const combatants = generateCombatants(rng, map);
    if (combatants === null) {
      return null;
    }
    return { map: map, combatants: combatants };
  }

  // --------------------------------------------------------- invariants

  /**
   * Validate every core invariant for the current snapshot. Returns an audit
   * of individual checks performed and any violations found.
   */
  function validateInvariants(combatants, map, active, turnResult) {
    const errors = [];
    let checks = 0;

    // HP + Action invariants: every combatant.
    for (const combatant of combatants) {
      checks += 1;
      if (
        !Number.isInteger(combatant.currentHP) ||
        combatant.currentHP < 0 ||
        combatant.currentHP > combatant.maxHP
      ) {
        errors.push(
          "HP invariant: " +
            combatant.id +
            " currentHP=" +
            combatant.currentHP +
            " maxHP=" +
            combatant.maxHP,
        );
      }
      checks += 1;
      if (
        !Number.isInteger(combatant.actionsRemaining) ||
        combatant.actionsRemaining < 0 ||
        combatant.actionsRemaining > combatant.maxActions
      ) {
        errors.push(
          "Action invariant: " +
            combatant.id +
            " actionsRemaining=" +
            combatant.actionsRemaining +
            " maxActions=" +
            combatant.maxActions,
        );
      }
    }

    // Occupancy invariant: a living creature never overlaps a wall or another
    // living creature. Defeated corpses do not block and are excluded.
    const owners = new Map();
    for (const combatant of combatants) {
      if (combatant.isDefeated) {
        continue;
      }
      const cells = combatant.getOccupiedCells();
      for (const cell of cells) {
        const cellKey = key(cell.x, cell.y);
        checks += 1;
        if (!map.isInBounds(cell.x, cell.y) || map.hasObstacle(cell.x, cell.y)) {
          errors.push(
            "Occupancy invariant: " + combatant.id + " occupies wall/out-of-bounds " + cellKey,
          );
        }
        if (owners.has(cellKey)) {
          errors.push(
            "Occupancy invariant: " +
              cellKey +
              " shared by " +
              owners.get(cellKey) +
              " and " +
              combatant.id,
          );
        }
        owners.set(cellKey, combatant.id);
      }
    }

    // Condition invariant: only for the combatant that just acted.
    if (active !== null && active !== undefined && turnResult !== null && turnResult !== undefined) {
      const restrained =
        typeof active.hasCondition === "function" && active.hasCondition("restrained");
      const actions = Array.isArray(turnResult.executedActions)
        ? turnResult.executedActions
        : [];
      for (const action of actions) {
        if (action.ok !== true) {
          continue;
        }
        checks += 1;
        if (restrained && action.type === "strike") {
          errors.push(
            "Restrained invariant: " +
              active.id +
              " performed a successful strike while restrained",
          );
        }
        if (
          restrained &&
          (action.type === "stride" || action.type === "step" || action.type === "stand")
        ) {
          errors.push(
            "Restrained invariant: " + active.id + " moved while restrained (" + action.type + ")",
          );
        }
      }
    }

    return { errors: errors, checks: checks };
  }

  function livingCount(combatants, alliance) {
    return combatants.filter(function (combatant) {
      return combatant.alliance === alliance && !combatant.isDefeated;
    }).length;
  }

  function resolveOutcome(combatants) {
    const players = livingCount(combatants, "player");
    const enemies = livingCount(combatants, "enemy");
    if (players === 0 && enemies === 0) {
      return "draw";
    }
    if (players === 0) {
      return "enemy";
    }
    if (enemies === 0) {
      return "player";
    }
    return "ongoing";
  }

  /**
   * Fingerprint of the living battlefield: HP and position of every living
   * combatant. Two consecutive identical fingerprints mean a full turn produced
   * no damage and no movement — the signature of a strategic stall (for example
   * every attack blocked by line of sight). This is reported, not failed.
   */
  function progressKey(combatants) {
    const parts = [];
    for (const combatant of combatants) {
      if (combatant.isDefeated) {
        continue;
      }
      parts.push(
        combatant.id +
          ":" +
          combatant.currentHP +
          ":" +
          combatant.x +
          ":" +
          combatant.y,
      );
    }
    return parts.sort().join("|");
  }

  // ---------------------------------------------------------- simulation

  function simulateBattle(rng) {
    const generated = generateBattle(rng);
    if (generated === null) {
      return { skipped: true };
    }
    const map = generated.map;
    const combatants = generated.combatants;

    const encounter = new Encounter({ combatants: combatants });
    const anomalies = [];
    let invariantChecks = 0;

    const rollD20 = function () {
      return rng.die(20);
    };
    const rollDie = function (sides) {
      return rng.die(sides);
    };
    const rollDamageDie = function (sides) {
      return rng.die(sides);
    };
    const rollFlatCheck = function () {
      return rng.die(20);
    };

    try {
      encounter.rollInitiative({ rollD20: rollD20 });
    } catch (error) {
      anomalies.push("crash during rollInitiative: " + error.message);
      return { skipped: false, anomalies: anomalies, invariantChecks: 0, outcome: "crash" };
    }

    let active = encounter.activeCombatant;
    let turns = 0;
    let timedOut = false;
    let stalled = false;
    let noProgress = 0;
    let lastProgress = progressKey(combatants);

    while (
      active !== null &&
      !encounter.isOver &&
      encounter.round <= MAX_ROUNDS &&
      turns < MAX_TURNS
    ) {
      turns += 1;
      const actor = active;

      let turnResult;
      try {
        turnResult = TacticalAI.executeAITurn({
          combatant: actor,
          map: map,
          combatants: combatants,
          rollD20: rollD20,
          rollDamageDie: rollDamageDie,
        });
      } catch (error) {
        anomalies.push("crash during executeAITurn for " + actor.id + ": " + error.message);
        break;
      }

      // Deadlock guard: a single turn must resolve in a bounded number of
      // actions (the AI's own iteration cap), and never leave the pool stuck.
      if (
        turnResult.executedActions.length > TacticalAI.DEFAULT_MAX_ITERATIONS
      ) {
        anomalies.push(
          "deadlock: " +
            actor.id +
            " executed " +
            turnResult.executedActions.length +
            " actions in one turn",
        );
      }

      const afterTurn = validateInvariants(combatants, map, actor, turnResult);
      anomalies.push.apply(anomalies, afterTurn.errors);
      invariantChecks += afterTurn.checks;

      let turn;
      try {
        turn = encounter.nextTurn({
          rollDie: rollDie,
          rollD20: rollD20,
          rollDamageDie: rollDamageDie,
          rollFlatCheck: rollFlatCheck,
        });
      } catch (error) {
        anomalies.push("crash during nextTurn: " + error.message);
        break;
      }

      const afterAdvance = validateInvariants(combatants, map, null, null);
      anomalies.push.apply(anomalies, afterAdvance.errors);
      invariantChecks += afterAdvance.checks;

      // Strategic stall detection: a full turn with no HP or position change.
      const currentProgress = progressKey(combatants);
      if (currentProgress === lastProgress) {
        noProgress += 1;
        if (noProgress >= STALL_TURNS) {
          stalled = true;
        }
      } else {
        noProgress = 0;
      }
      lastProgress = currentProgress;

      active = turn.active;
      if (encounter.round > MAX_ROUNDS) {
        timedOut = true;
      }
    }

    if (encounter.round > MAX_ROUNDS || turns >= MAX_TURNS) {
      timedOut = true;
    }

    const outcome = timedOut ? "timeout" : resolveOutcome(combatants);

    return {
      skipped: false,
      outcome: outcome,
      round: encounter.round,
      turns: turns,
      stalled: stalled,
      anomalies: anomalies,
      invariantChecks: invariantChecks,
      mapCols: map.cols,
      combatantCount: combatants.length,
    };
  }

  // ------------------------------------------------------------ register

  function makeCombatant(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "unit",
          name: "Unit",
          alliance: "player",
          initiative: 10,
          x: 0,
          y: 0,
          speedFeet: 25,
          maxActions: 3,
          maxHP: 20,
          currentHP: 20,
          ac: 16,
          attackBonus: 7,
          damage: { formula: "1d8+2", type: "slashing" },
          saves: { fortitude: 5, reflex: 5, will: 5 },
          skills: { athletics: 5, acrobatics: 5, stealth: 2, perception: 5 },
        },
        overrides || {},
      ),
    );
  }

  return function registerStressSimulation(t) {
    t.test("generator: arenas stay connected and rosters spawn cleanly", function () {
      const rng = createRng(0xfeedface);
      for (let i = 0; i < 20; i += 1) {
        const map = generateArena(rng);
        t.assertTrue(map.cols === 15 || map.cols === 20, "map dimension is 15 or 20");

        const walls = map.getBlockedCells().length;
        t.assertTrue(walls >= 5 && walls <= 15, "walls within 5..15 (got " + walls + ")");
        t.assertTrue(isFullyConnected(map), "free space stays connected");

        const hazardous = map.getHazardousCells().length;
        t.assertTrue(hazardous >= 1, "at least one hazardous/trap cell exists");

        const roster = generateCombatants(rng, map);
        t.assertTrue(roster !== null && roster.length >= 4 && roster.length <= 8, "roster of 4..8");
      }
    });

    t.test("condition invariant: Restrained blocks attack/manipulate (Escape exempt)", function () {
      const map = new GridMap({ cols: 10, rows: 10 });
      const restrained = makeCombatant({
        id: "r1",
        x: 2,
        y: 2,
        conditions: { restrained: 1 },
      });
      const target = makeCombatant({
        id: "t1",
        x: 3,
        y: 2,
        alliance: "enemy",
      });

      t.assertEqual(restrained.canAct({ traits: ["attack"] }).ok, false, "attack blocked");
      t.assertEqual(
        restrained.canAct({ traits: ["attack"] }).reason,
        "restrained-action-blocked",
        "attack block reason",
      );
      t.assertEqual(restrained.canAct({ traits: ["manipulate"] }).ok, false, "manipulate blocked");
      t.assertEqual(
        restrained.canAct({ isEscape: true, traits: ["attack"] }).ok,
        true,
        "Escape is exempt",
      );

      const strike = Strike.performStrike({
        attacker: restrained,
        target: target,
        map: map,
        combatants: [restrained, target],
      });
      t.assertEqual(strike.ok, false, "Strike refused while restrained");
      t.assertEqual(strike.reason, "restrained-action-blocked", "Strike refusal reason");
      t.assertEqual(restrained.actionsRemaining, 3, "no action spent on refused Strike");

      const stride = Stride.performStride({
        combatant: restrained,
        map: map,
        destination: { x: 3, y: 3 },
        combatants: [restrained, target],
      });
      t.assertEqual(stride.ok, false, "Stride refused while restrained (immobilized)");
      t.assertEqual(stride.reason, "immobilized", "Stride refusal reason");
    });

    t.test("condition invariant: Grabbed manipulates resolve a DC 5 flat check", function () {
      const grabbed = makeCombatant({
        id: "g1",
        x: 2,
        y: 2,
        conditions: { grabbed: 1 },
      });

      const failed = grabbed.resolveGrabbedManipulate({ traits: ["manipulate"], d20: 4 });
      t.assertEqual(failed.required, true, "manipulate check is required while grabbed");
      t.assertEqual(failed.dc, 5, "grabbed manipulate DC is 5");
      t.assertEqual(failed.passed, false, "d20 4 fails DC 5");

      const passed = grabbed.resolveGrabbedManipulate({ traits: ["manipulate"], d20: 6 });
      t.assertEqual(passed.required, true, "manipulate check is required while grabbed");
      t.assertEqual(passed.dc, 5, "grabbed manipulate DC is 5");
      t.assertEqual(passed.passed, true, "d20 6 passes DC 5");

      const notManipulate = grabbed.resolveGrabbedManipulate({ traits: ["attack"], d20: 1 });
      t.assertEqual(notManipulate.required, false, "non-manipulate action needs no flat check");
    });

    t.test(
      "stress: " +
        BATTLE_COUNT +
        " seeded AI-vs-AI battles with per-turn invariant validation",
      function () {
        const summary = {
          battles: BATTLE_COUNT,
          ran: 0,
          skipped: 0,
          playerWins: 0,
          enemyWins: 0,
          draws: 0,
          timeouts: 0,
          stalled: 0,
          crashes: 0,
          totalTurns: 0,
          totalAnomalies: 0,
          totalChecks: 0,
          sampleAnomalies: [],
        };

        for (let index = 0; index < BATTLE_COUNT; index += 1) {
          const rng = createRng(BASE_SEED + index * 1009);
          const result = simulateBattle(rng);

          if (result.skipped) {
            summary.skipped += 1;
            continue;
          }

          summary.ran += 1;
          summary.totalTurns += result.turns;
          summary.totalChecks += result.invariantChecks;

          if (result.outcome === "player") {
            summary.playerWins += 1;
          } else if (result.outcome === "enemy") {
            summary.enemyWins += 1;
          } else if (result.outcome === "draw") {
            summary.draws += 1;
          } else if (result.outcome === "timeout") {
            summary.timeouts += 1;
          } else {
            summary.crashes += 1;
          }
          if (result.stalled) {
            summary.stalled += 1;
          }

          if (result.anomalies.length > 0) {
            summary.totalAnomalies += result.anomalies.length;
            for (const anomaly of result.anomalies) {
              if (summary.sampleAnomalies.length < 10) {
                summary.sampleAnomalies.push("battle#" + index + " " + anomaly);
              }
            }
          }
        }

        const completed = summary.ran - summary.timeouts;
        console.log(
          "  [stress] battles=" +
            summary.battles +
            " ran=" +
            summary.ran +
            " skipped=" +
            summary.skipped +
            " resolved=" +
            completed +
            " (player=" +
            summary.playerWins +
            ", enemy=" +
            summary.enemyWins +
            ", draw=" +
            summary.draws +
            ") timeouts=" +
            summary.timeouts +
            " stalled=" +
            summary.stalled +
            " avgTurns=" +
            (summary.ran > 0 ? (summary.totalTurns / summary.ran).toFixed(1) : "0") +
            " invariantChecks=" +
            summary.totalChecks +
            " anomalies=" +
            summary.totalAnomalies,
        );

        t.assertTrue(summary.ran >= 25, "at least 25 battles ran (ran " + summary.ran + ")");
        t.assertTrue(summary.totalAnomalies === 0, "no invariant violations or crashes");
        t.assertTrue(
          summary.skipped === 0,
          "no battle skipped due to unplaceable spawns (skipped " + summary.skipped + ")",
        );
        if (summary.sampleAnomalies.length > 0) {
          throw new Error(
            "Anomalies detected:\n" + summary.sampleAnomalies.join("\n"),
          );
        }
      },
    );
  };
});
