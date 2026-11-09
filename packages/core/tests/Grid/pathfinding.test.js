/**
 * Sessions 1.2–1.4 — pathfinding, obstacles, and Stride action economy.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Grid/pathfinding.js"),
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Actions/stride.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Grid & Actions — Pathfinding + Stride",
      register: factory(
        root.PF2e.Core.Pathfinding,
        root.PF2e.Core.GridMap,
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Actions.Stride,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Pathfinding,
  GridMap,
  Combatant,
  Stride,
) {
  "use strict";

  if (!Pathfinding || !GridMap || !Combatant || !Stride) {
    throw new Error("Pathfinding tests require GridMap, Pathfinding, Combatant and Stride.");
  }

  const POLICY = Pathfinding.DIAGONAL_CORNER_POLICIES;

  function openMap(cols, rows) {
    return new GridMap({ cols: cols || 10, rows: rows || 10 });
  }

  function makeCombatant(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "hero",
          name: "Valeros",
          x: 0,
          y: 0,
          speedFeet: 25,
          maxActions: 3,
        },
        overrides || {},
      ),
    );
  }

  function pathKeys(path) {
    return path.map(function (cell) {
      return cell.x + "," + cell.y;
    });
  }

  /**
   * Walk the returned path and verify adjacency, terrain, and the exact
   * 5-10-5 alternation. This independently recomputes the path cost.
   */
  function assertPathFollowsRules(t, map, path, result) {
    let total = 0;
    let diagonalCount = 0;

    for (let i = 1; i < path.length; i += 1) {
      const previous = path[i - 1];
      const current = path[i];
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;

      t.assertTrue(
        Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx !== 0 || dy !== 0),
        "path steps must be adjacent",
      );
      t.assertTrue(!map.isBlocked(current.x, current.y), "path must avoid blocked cells");

      const diagonal = dx !== 0 && dy !== 0;
      const stepCost = diagonal ? (diagonalCount % 2 === 0 ? 5 : 10) : 5;
      if (diagonal) {
        diagonalCount += 1;
      }
      total += stepCost;
    }

    t.assertEqual(total, result.costFeet, "path total must follow 5-10-5");
    t.assertEqual(diagonalCount, result.diagonalSteps, "diagonal count must match");
  }

  return function registerPathfindingTests(t) {
    // ---------------------------------------------------------- A* basics

    t.test("A*: 3 diagonal squares cost 20 ft (5-10-5)", function () {
      const result = Pathfinding.findPath({ x: 0, y: 0 }, { x: 3, y: 3 }, { map: openMap() });
      t.assertTrue(result.found, "path should exist");
      t.assertEqual(result.costFeet, 20);
      t.assertEqual(result.diagonalSteps, 3);
      t.assertDeepEqual(pathKeys(result.path), ["0,0", "1,1", "2,2", "3,3"]);
    });

    t.test("A*: 2 diagonal squares cost 15 ft", function () {
      const result = Pathfinding.findPath({ x: 0, y: 0 }, { x: 2, y: 2 }, { map: openMap() });
      t.assertTrue(result.found);
      t.assertEqual(result.costFeet, 15);
    });

    t.test("A*: mixed offset (3,2) costs 20 ft", function () {
      const result = Pathfinding.findPath({ x: 0, y: 0 }, { x: 3, y: 2 }, { map: openMap() });
      t.assertTrue(result.found);
      t.assertEqual(result.costFeet, 20);
    });

    t.test("A*: starting diagonal parity makes the next diagonal cost 10 ft", function () {
      const result = Pathfinding.findPath(
        { x: 0, y: 0 },
        { x: 3, y: 3 },
        { map: openMap(), startDiagonalParity: 1 },
      );
      t.assertTrue(result.found);
      t.assertEqual(result.costFeet, 25);
    });

    t.test("A*: final state is a contiguously walkable 5-10-5 path", function () {
      const map = GridMap.fromAscii([
        "......",
        "......",
        "..#...",
        "..#...",
        "..#...",
        "......",
      ]);
      const result = Pathfinding.findPath({ x: 1, y: 2 }, { x: 3, y: 2 }, { map: map });
      t.assertTrue(result.found);
      assertPathFollowsRules(t, map, result.path, result);
    });

    // ------------------------------------------------------------ obstacles

    t.test("A*: routes around a wall through a gap", function () {
      const map = GridMap.fromAscii([
        "..#..",
        "..#..",
        "..#..",
        "..#..",
        "..#..",
        ".....",
      ]);
      const result = Pathfinding.findPath({ x: 1, y: 2 }, { x: 3, y: 2 }, { map: map });
      t.assertTrue(result.found, "wall has a bottom gap and must be bypassed");
      t.assertEqual(result.costFeet, 40);
      t.assertEqual(result.diagonalSteps, 0);
      t.assertTrue(
        result.path.some(function (cell) {
          return cell.y === 5;
        }),
        "route must use the gap at the bottom",
      );
      assertPathFollowsRules(t, map, result.path, result);
    });

    t.test("A*: enclosed target reports no-path", function () {
      const map = GridMap.fromAscii([
        ".....",
        ".###.",
        ".#.#.",
        ".###.",
        ".....",
      ]);
      const result = Pathfinding.findPath({ x: 2, y: 2 }, { x: 0, y: 0 }, { map: map });
      t.assertTrue(!result.found);
      t.assertEqual(result.reason, "no-path");
    });

    t.test("A*: blocked destination is reported explicitly", function () {
      const map = openMap(5, 5);
      map.setBlocked(2, 2, true);
      const result = Pathfinding.findPath({ x: 0, y: 0 }, { x: 2, y: 2 }, { map: map });
      t.assertTrue(!result.found);
      t.assertEqual(result.reason, "blocked-goal");
    });

    t.test("A*: out-of-bounds destination is reported", function () {
      const result = Pathfinding.findPath({ x: 0, y: 0 }, { x: 99, y: 0 }, { map: openMap() });
      t.assertTrue(!result.found);
      t.assertEqual(result.reason, "out-of-bounds");
    });

    // ------------------------------------------------------- corner policies

    t.test("default block-any forbids a diagonal squeeze between two walls", function () {
      const map = GridMap.fromAscii(["...", "...", "..."]);
      map.setBlocked(1, 0, true).setBlocked(0, 1, true);

      const result = Pathfinding.findPath({ x: 0, y: 0 }, { x: 1, y: 1 }, { map: map });
      t.assertTrue(!result.found);
      t.assertEqual(result.reason, "no-path");
    });

    t.test("allow policy permits a diagonal squeeze", function () {
      const map = GridMap.fromAscii(["...", "...", "..."]);
      map.setBlocked(1, 0, true).setBlocked(0, 1, true);

      const result = Pathfinding.findPath(
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { map: map, diagonalCornerPolicy: POLICY.ALLOW },
      );
      t.assertTrue(result.found);
      t.assertEqual(result.costFeet, 5);
      t.assertDeepEqual(pathKeys(result.path), ["0,0", "1,1"]);
    });

    t.test("default block-any forbids a diagonal when one corner is blocked", function () {
      const map = GridMap.fromAscii(["...", "...", "..."]);
      map.setBlocked(1, 0, true);

      const result = Pathfinding.findPath({ x: 0, y: 0 }, { x: 1, y: 1 }, { map: map });
      t.assertTrue(result.found);
      t.assertEqual(result.costFeet, 10);
      t.assertDeepEqual(pathKeys(result.path), ["0,0", "0,1", "1,1"]);
    });

    t.test("block-both permits a diagonal when only one corner is blocked", function () {
      const map = GridMap.fromAscii(["...", "...", "..."]);
      map.setBlocked(1, 0, true);

      const result = Pathfinding.findPath(
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { map: map, diagonalCornerPolicy: POLICY.BLOCK_BOTH },
      );
      t.assertTrue(result.found);
      t.assertEqual(result.costFeet, 5);
    });

    t.test("unknown corner policy is rejected", function () {
      t.assertThrows(function () {
        Pathfinding.findPath(
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { map: openMap(3, 3), diagonalCornerPolicy: "cut-everything" },
        );
      }, "unknown policy");
    });

    // ----------------------------------------------------------- reachable

    t.test("reachable cells respect obstacles and the movement budget", function () {
      const map = openMap(5, 5);
      map.setBlocked(2, 2, true);

      const cells = Pathfinding.reachableCells(map, { x: 1, y: 1 }, 10, {});
      const keys = new Set(
        cells.map(function (cell) {
          return cell.x + "," + cell.y;
        }),
      );

      t.assertTrue(!keys.has("2,2"), "blocked cell must not be reachable");
      t.assertTrue(keys.has("2,1"), "adjacent straight cell costs 5 ft");
      t.assertTrue(keys.has("3,1"), "second straight cell costs 10 ft");
      t.assertTrue(
        !keys.has("3,2"),
        "block-any forbids the diagonal past the wall corner within 10 ft",
      );
      t.assertTrue(!keys.has("4,4"), "far corner costs more than 10 ft");
      t.assertTrue(!keys.has("1,1"), "origin is excluded");

      for (const cell of cells) {
        t.assertTrue(cell.costFeet <= 10, "cell must respect the budget");
        t.assertTrue(!map.isBlocked(cell.x, cell.y), "cell must be walkable");
      }
    });

    t.test("reachable cells use the combatant's diagonal parity", function () {
      const fromEven = Pathfinding.reachableCells(openMap(3, 3), { x: 0, y: 0 }, 5, {
        startDiagonalParity: 0,
      });
      const fromOdd = Pathfinding.reachableCells(openMap(3, 3), { x: 0, y: 0 }, 5, {
        startDiagonalParity: 1,
      });

      const evenKeys = new Set(
        fromEven.map(function (cell) {
          return cell.x + "," + cell.y;
        }),
      );
      const oddKeys = new Set(
        fromOdd.map(function (cell) {
          return cell.x + "," + cell.y;
        }),
      );

      t.assertTrue(evenKeys.has("1,1"), "first diagonal costs 5 ft when parity is 0");
      t.assertTrue(!oddKeys.has("1,1"), "first diagonal costs 10 ft when parity is 1");
    });

    // -------------------------------------------------------------- Stride

    t.test("Stride spends 1 action, moves the token and records diagonals", function () {
      const combatant = makeCombatant({ x: 0, y: 0 });
      const result = Stride.performStride({
        combatant: combatant,
        map: openMap(),
        destination: { x: 3, y: 3 },
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.costFeet, 20);
      t.assertEqual(result.actionsLeft, 2);
      t.assertEqual(combatant.actionsRemaining, 2);
      t.assertEqual(combatant.x, 3);
      t.assertEqual(combatant.y, 3);
      t.assertEqual(combatant.diagonalStepsThisTurn, 3);
      t.assertEqual(combatant.diagonalParity, 1);
    });

    t.test("Stride allows a path costing exactly Speed", function () {
      const combatant = makeCombatant({ speedFeet: 25 });
      const result = Stride.performStride({
        combatant: combatant,
        map: openMap(),
        destination: { x: 3, y: 4 },
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.costFeet, 25);
      t.assertEqual(combatant.actionsRemaining, 2);
    });

    t.test("Stride rejects a path longer than Speed without spending an action", function () {
      const combatant = makeCombatant({ speedFeet: 10 });
      const result = Stride.performStride({
        combatant: combatant,
        map: openMap(),
        destination: { x: 3, y: 0 },
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Stride.STRIDE_REASONS.EXCEEDS_SPEED);
      t.assertEqual(result.costFeet, 15);
      t.assertEqual(combatant.actionsRemaining, 3);
      t.assertEqual(combatant.x, 0);
      t.assertEqual(combatant.y, 0);
      t.assertEqual(combatant.diagonalStepsThisTurn, 0);
    });

    t.test("Stride rejects a blocked destination without spending an action", function () {
      const map = openMap(5, 5);
      map.setBlocked(1, 1, true);
      const combatant = makeCombatant();

      const result = Stride.performStride({
        combatant: combatant,
        map: map,
        destination: { x: 1, y: 1 },
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Stride.STRIDE_REASONS.BLOCKED_DESTINATION);
      t.assertEqual(combatant.actionsRemaining, 3);
      t.assertEqual(combatant.x, 0);
      t.assertEqual(combatant.y, 0);
    });

    t.test("Stride rejects an unreachable destination without spending an action", function () {
      const map = GridMap.fromAscii([
        ".....",
        ".###.",
        ".#.#.",
        ".###.",
        ".....",
      ]);
      const combatant = makeCombatant({ x: 2, y: 2 });

      const result = Stride.performStride({
        combatant: combatant,
        map: map,
        destination: { x: 0, y: 0 },
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Stride.STRIDE_REASONS.UNREACHABLE);
      t.assertEqual(combatant.actionsRemaining, 3);
    });

    t.test("Stride rejects a move when no actions remain", function () {
      const combatant = makeCombatant();
      combatant.spendActions(3);

      const result = Stride.performStride({
        combatant: combatant,
        map: openMap(),
        destination: { x: 2, y: 0 },
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Stride.STRIDE_REASONS.NO_ACTIONS);
      t.assertEqual(combatant.actionsRemaining, 0);
      t.assertEqual(combatant.x, 0);
      t.assertEqual(combatant.y, 0);
    });

    t.test("Stride rejects the current square", function () {
      const combatant = makeCombatant();
      const result = Stride.performStride({
        combatant: combatant,
        map: openMap(),
        destination: { x: 0, y: 0 },
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Stride.STRIDE_REASONS.ALREADY_THERE);
      t.assertEqual(combatant.actionsRemaining, 3);
    });

    t.test("diagonal parity persists between Strides within a turn", function () {
      const combatant = makeCombatant();

      const first = Stride.performStride({
        combatant: combatant,
        map: openMap(),
        destination: { x: 1, y: 1 },
      });
      t.assertTrue(first.ok);
      t.assertEqual(first.costFeet, 5);
      t.assertEqual(combatant.diagonalParity, 1);

      const second = Stride.performStride({
        combatant: combatant,
        map: openMap(),
        destination: { x: 2, y: 2 },
      });
      t.assertTrue(second.ok);
      t.assertEqual(second.costFeet, 10, "second diagonal in the turn costs 10 ft");
      t.assertEqual(combatant.actionsRemaining, 1);
      t.assertEqual(combatant.diagonalStepsThisTurn, 2);
      t.assertEqual(combatant.diagonalParity, 0);
    });

    t.test("turn reset restores actions and diagonal parity", function () {
      const combatant = makeCombatant();
      Stride.performStride({
        combatant: combatant,
        map: openMap(),
        destination: { x: 1, y: 0 },
      });
      combatant.registerDiagonalSteps(1);

      combatant.resetTurn();

      t.assertEqual(combatant.actionsRemaining, 3);
      t.assertEqual(combatant.diagonalStepsThisTurn, 0);
      t.assertEqual(combatant.diagonalParity, 0);
    });
  };
});
