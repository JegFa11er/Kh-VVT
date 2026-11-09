/**
 * Session 2 — difficult terrain costs, faction occupancy, and Stride integration.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Grid/pathfinding.js"),
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Grid/occupancy.js"),
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Actions/stride.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Grid — Difficult Terrain & Occupancy",
      register: factory(
        root.PF2e.Core.Pathfinding,
        root.PF2e.Core.GridMap,
        root.PF2e.Core.Occupancy,
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Actions.Stride,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Pathfinding,
  GridMap,
  Occupancy,
  Combatant,
  Stride,
) {
  "use strict";

  if (!Pathfinding || !GridMap || !Occupancy || !Combatant || !Stride) {
    throw new Error("Terrain tests require Pathfinding, GridMap, Occupancy, Combatant and Stride.");
  }

  function makeCombatant(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "hero",
          name: "Valeros",
          alliance: "player",
          initiative: 10,
          x: 0,
          y: 0,
          speedFeet: 25,
          maxActions: 3,
        },
        overrides || {},
      ),
    );
  }

  function key(cell) {
    return cell.x + "," + cell.y;
  }

  function keysOf(cells) {
    return new Set(cells.map(key));
  }

  return function registerTerrainTests(t) {
    t.test("ASCII import records difficult terrain separately from walls", function () {
      const map = GridMap.fromAscii(["..~", ".#."], "#", { difficultChars: "~" });
      t.assertDeepEqual(map.getBlockedCells(), [{ x: 1, y: 1 }]);
      t.assertDeepEqual(map.getDifficultTerrainCells(), [{ x: 2, y: 0 }]);
      t.assertTrue(map.hasDifficultTerrain(2, 0));
      t.assertTrue(!map.hasDifficultTerrain(0, 0));
      t.assertTrue(!map.isBlocked(2, 0), "difficult terrain is still walkable");
    });

    t.test("entering difficult terrain adds 5 ft", function () {
      const map = new GridMap({ cols: 5, rows: 5 });
      map.setDifficultTerrain(1, 0, true);

      const result = Pathfinding.findPath({ x: 0, y: 0 }, { x: 1, y: 0 }, { map: map });
      t.assertTrue(result.found);
      t.assertEqual(result.costFeet, 10, "5 ft base + 5 ft difficult");
      t.assertDeepEqual(result.path, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    });

    t.test("diagonal entry into difficult terrain costs base diagonal + 5", function () {
      const map = new GridMap({ cols: 5, rows: 5 });
      map.setDifficultTerrain(1, 1, true);

      const result = Pathfinding.findPath({ x: 0, y: 0 }, { x: 1, y: 1 }, { map: map });
      t.assertTrue(result.found);
      t.assertEqual(result.costFeet, 10, "first diagonal 5 ft + difficult 5 ft");
      t.assertEqual(result.diagonalSteps, 1);
    });

    t.test("second diagonal into difficult terrain stacks correctly", function () {
      const map = new GridMap({ cols: 5, rows: 5 });
      map.setDifficultTerrain(1, 1, true);

      const result = Pathfinding.findPath(
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { map: map, startDiagonalParity: 1 },
      );
      t.assertTrue(result.found);
      t.assertEqual(result.costFeet, 15, "second diagonal 10 ft + difficult 5 ft");
    });

    t.test("path total accumulates terrain on every entered square", function () {
      const map = new GridMap({ cols: 4, rows: 1 });
      map.setDifficultTerrain(1, 0, true);
      map.setDifficultTerrain(2, 0, true);

      const result = Pathfinding.findPath({ x: 0, y: 0 }, { x: 3, y: 0 }, { map: map });
      t.assertTrue(result.found);
      t.assertEqual(result.costFeet, 25, "5 + 10 + 10");
      t.assertDeepEqual(result.path, [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ]);
    });

    t.test("reachable cells respect terrain costs", function () {
      const map = new GridMap({ cols: 5, rows: 1 });
      map.setDifficultTerrain(1, 0, true);

      const cells = Pathfinding.reachableCells(map, { x: 0, y: 0 }, 10, {});
      const keys = keysOf(cells);

      t.assertTrue(keys.has("1,0"), "difficult square costs exactly 10 ft");
      t.assertTrue(!keys.has("2,0"), "next square would cost 15 ft");
      t.assertEqual(cells.find(function (cell) {
        return cell.x === 1 && cell.y === 0;
      }).costFeet, 10);
    });

    t.test("buildOccupancy splits allies and enemies for the mover", function () {
      const valeros = makeCombatant({ id: "valeros", x: 0, y: 0 });
      const merisiel = makeCombatant({ id: "merisiel", x: 1, y: 0 });
      const goblin = makeCombatant({
        id: "goblin",
        name: "Goblin",
        alliance: "enemy",
        x: 2,
        y: 0,
      });

      const occupancy = Occupancy.buildOccupancy([valeros, merisiel, goblin], valeros);
      t.assertDeepEqual(occupancy.passThroughCells, [{ x: 1, y: 0 }]);
      t.assertDeepEqual(occupancy.blockedCells, [{ x: 2, y: 0 }]);
    });

    t.test("allies are traversable but not valid destinations", function () {
      const map = new GridMap({ cols: 5, rows: 1 });
      const ally = makeCombatant({ id: "merisiel", x: 1, y: 0 });
      const occupancy = {
        blockedCells: [],
        passThroughCells: [{ x: ally.x, y: ally.y }],
      };

      const through = Pathfinding.findPath(
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { map: map, occupancy: occupancy },
      );
      t.assertTrue(through.found, "route may cross the ally");
      t.assertEqual(through.costFeet, 10);
      t.assertDeepEqual(through.path, [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]);

      const stop = Pathfinding.findPath(
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { map: map, occupancy: occupancy },
      );
      t.assertTrue(!stop.found);
      t.assertEqual(stop.reason, "goal-occupied");
    });

    t.test("enemies are impassable", function () {
      const map = new GridMap({ cols: 5, rows: 1 });
      const occupancy = {
        blockedCells: [{ x: 1, y: 0 }],
        passThroughCells: [],
      };

      const behind = Pathfinding.findPath(
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { map: map, occupancy: occupancy },
      );
      t.assertTrue(!behind.found);
      t.assertEqual(behind.reason, "no-path");

      const onto = Pathfinding.findPath(
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { map: map, occupancy: occupancy },
      );
      t.assertTrue(!onto.found);
      t.assertEqual(onto.reason, "blocked-goal");
    });

    t.test("reachable cells exclude ally squares but keep cells beyond", function () {
      const map = new GridMap({ cols: 5, rows: 1 });
      const occupancy = {
        blockedCells: [],
        passThroughCells: [{ x: 1, y: 0 }],
      };

      const cells = Pathfinding.reachableCells(map, { x: 0, y: 0 }, 20, {
        occupancy: occupancy,
      });
      const keys = keysOf(cells);

      t.assertTrue(!keys.has("1,0"), "cannot stop on an ally");
      t.assertTrue(keys.has("2,0"), "can pass through to the far side");
      t.assertEqual(
        cells.find(function (cell) {
          return cell.x === 2 && cell.y === 0;
        }).costFeet,
        10,
      );
    });

    t.test("reachable cells stop at enemy squares", function () {
      const map = new GridMap({ cols: 5, rows: 1 });
      const occupancy = {
        blockedCells: [{ x: 2, y: 0 }],
        passThroughCells: [],
      };

      const cells = Pathfinding.reachableCells(map, { x: 0, y: 0 }, 20, {
        occupancy: occupancy,
      });
      const keys = keysOf(cells);

      t.assertTrue(keys.has("1,0"));
      t.assertTrue(!keys.has("2,0"), "enemy square is not reachable");
      t.assertTrue(!keys.has("3,0"), "cells behind the enemy are unreachable");
    });

    t.test("diagonal corners ignore pass-through allies", function () {
      const map = new GridMap({ cols: 3, rows: 3 });
      const occupancy = {
        blockedCells: [],
        passThroughCells: [{ x: 1, y: 0 }],
      };

      const result = Pathfinding.findPath(
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { map: map, occupancy: occupancy },
      );
      t.assertTrue(result.found, "a body in a corner cell is not a solid wall");
      t.assertEqual(result.costFeet, 5);
    });

    t.test("Stride can pass through an ally and end beyond", function () {
      const map = new GridMap({ cols: 5, rows: 1 });
      const hero = makeCombatant({ x: 0, y: 0 });
      const ally = makeCombatant({ id: "merisiel", x: 1, y: 0 });
      const occupancy = Occupancy.buildOccupancy([hero, ally], hero);

      const result = Stride.performStride({
        combatant: hero,
        map: map,
        destination: { x: 2, y: 0 },
        occupancy: occupancy,
      });
      t.assertTrue(result.ok);
      t.assertEqual(result.costFeet, 10);
      t.assertEqual(hero.x, 2);
      t.assertEqual(hero.actionsRemaining, 2);
    });

    t.test("Stride onto an ally is canceled without spending an action", function () {
      const map = new GridMap({ cols: 5, rows: 1 });
      const hero = makeCombatant({ x: 0, y: 0 });
      const ally = makeCombatant({ id: "merisiel", x: 1, y: 0 });
      const occupancy = Occupancy.buildOccupancy([hero, ally], hero);

      const result = Stride.performStride({
        combatant: hero,
        map: map,
        destination: { x: 1, y: 0 },
        occupancy: occupancy,
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Stride.STRIDE_REASONS.DESTINATION_OCCUPIED);
      t.assertEqual(hero.actionsRemaining, 3);
      t.assertEqual(hero.x, 0);
    });

    t.test("Stride onto an enemy is blocked without spending an action", function () {
      const map = new GridMap({ cols: 5, rows: 1 });
      const hero = makeCombatant({ x: 0, y: 0 });
      const goblin = makeCombatant({
        id: "goblin",
        name: "Goblin",
        alliance: "enemy",
        x: 1,
        y: 0,
      });
      const occupancy = Occupancy.buildOccupancy([hero, goblin], hero);

      const result = Stride.performStride({
        combatant: hero,
        map: map,
        destination: { x: 1, y: 0 },
        occupancy: occupancy,
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Stride.STRIDE_REASONS.BLOCKED_DESTINATION);
      t.assertEqual(hero.actionsRemaining, 3);
      t.assertEqual(hero.x, 0);
    });
  };
});
