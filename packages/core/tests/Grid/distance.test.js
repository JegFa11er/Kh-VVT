/**
 * Session 1.1 — PF2e Remastered 5-10-5 grid distance tests.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../../src/Core/Grid/grid-math.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Grid — PF2e 5-10-5 distance",
      register: factory(root.PF2e.Core.Grid),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Grid) {
  "use strict";

  if (!Grid) {
    throw new Error("Grid core must be loaded before distance tests.");
  }

  return function registerDistanceTests(t) {
    t.test("same cell costs 0 ft", function () {
      t.assertEqual(Grid.distanceFeet({ x: 4, y: 9 }, { x: 4, y: 9 }), 0);
    });

    t.test("3 squares in a straight line = 15 ft", function () {
      t.assertEqual(Grid.distanceFeet({ x: 2, y: 4 }, { x: 5, y: 4 }), 15);
    });

    t.test("4 squares vertically = 20 ft", function () {
      t.assertEqual(Grid.distanceFeet({ x: 2, y: 4 }, { x: 2, y: 8 }), 20);
    });

    t.test("1 diagonal square = 5 ft", function () {
      t.assertEqual(Grid.distanceFeet({ x: 0, y: 0 }, { x: 1, y: 1 }), 5);
    });

    t.test("2 diagonal squares = 15 ft", function () {
      t.assertEqual(Grid.distanceFeet({ x: 0, y: 0 }, { x: 2, y: 2 }), 15);
    });

    t.test("3 diagonal squares = 20 ft", function () {
      t.assertEqual(Grid.distanceFeet({ x: 0, y: 0 }, { x: 3, y: 3 }), 20);
    });

    t.test("4 diagonal squares = 30 ft", function () {
      t.assertEqual(Grid.distanceFeet({ x: 0, y: 0 }, { x: 4, y: 4 }), 30);
    });

    t.test("diagonal + straight (2,1) = 10 ft", function () {
      t.assertEqual(Grid.distanceFeet({ x: 0, y: 0 }, { x: 2, y: 1 }), 10);
    });

    t.test("mixed offset (3,2) = 20 ft", function () {
      t.assertEqual(Grid.distanceFeet({ x: 0, y: 0 }, { x: 3, y: 2 }), 20);
    });

    t.test("cumulative diagonal costs follow 5-10-5", function () {
      const expected = [0, 5, 15, 20, 30, 35];
      const actual = expected.map(function (unused, index) {
        return Grid.diagonalDistanceFeet(index);
      });
      t.assertDeepEqual(actual, expected);
    });

    t.test("incremental diagonal steps alternate 5 and 10", function () {
      const steps = [0, 1, 2, 3, 4, 5].map(function (index) {
        return Grid.diagonalStepCostFeet(index);
      });
      t.assertDeepEqual(steps, [5, 10, 5, 10, 5, 10]);
    });

    t.test("distance is symmetric", function () {
      const a = { x: 2, y: 9 };
      const b = { x: 7, y: 4 };
      t.assertEqual(Grid.distanceFeet(a, b), Grid.distanceFeet(b, a));
    });

    t.test("isWithinDistanceFeet respects the budget", function () {
      const origin = { x: 7, y: 7 };
      t.assertTrue(Grid.isWithinDistanceFeet(origin, { x: 10, y: 10 }, 25));
      t.assertTrue(!Grid.isWithinDistanceFeet(origin, { x: 11, y: 11 }, 25));
      t.assertTrue(Grid.isWithinDistanceFeet(origin, { x: 11, y: 10 }, 25));
      t.assertTrue(!Grid.isWithinDistanceFeet(origin, { x: 12, y: 11 }, 25));
    });

    t.test("reachable cells obey PF2e diagonal costs", function () {
      const origin = { x: 7, y: 7 };
      const cells = Grid.reachableCells(origin, 25, { cols: 15, rows: 15 });
      const keys = new Set(
        cells.map(function (cell) {
          return cell.x + "," + cell.y;
        }),
      );

      t.assertTrue(keys.has("7,12"), "5 squares straight north (25 ft) must be reachable");
      t.assertTrue(!keys.has("7,13"), "6 squares straight north (30 ft) must not be reachable");
      t.assertTrue(keys.has("9,9"), "2 diagonal squares (15 ft) must be reachable");
      t.assertTrue(keys.has("10,10"), "3 diagonal squares (20 ft) must be reachable");
      t.assertTrue(!keys.has("11,11"), "4 diagonal squares (30 ft) must not be reachable");
      t.assertTrue(keys.has("11,10"), "(dx 4, dy 3) = 25 ft must be reachable");
      t.assertTrue(!keys.has("12,11"), "(dx 5, dy 4) = 35 ft must not be reachable");
      t.assertTrue(!keys.has("7,7"), "the origin cell must be excluded");
    });

    t.test("reachable cells stay in bounds and are unique", function () {
      const origin = { x: 1, y: 1 };
      const cells = Grid.reachableCells(origin, 25, { cols: 8, rows: 6 });
      const keys = new Set();

      for (const cell of cells) {
        t.assertTrue(cell.x >= 0 && cell.x < 8, "x must stay inside the grid");
        t.assertTrue(cell.y >= 0 && cell.y < 6, "y must stay inside the grid");
        t.assertTrue(cell.distanceFeet <= 25, "cost must stay inside the budget");
        t.assertEqual(
          cell.distanceFeet,
          Grid.distanceFeet(origin, cell),
          "reported cost must match the core formula",
        );
        keys.add(cell.x + "," + cell.y);
      }

      t.assertEqual(keys.size, cells.length, "reachable cells must not contain duplicates");
    });

    t.test("grid labels are spreadsheet-style", function () {
      t.assertEqual(Grid.gridToLabel({ x: 3, y: 7 }), "D8");
      t.assertEqual(Grid.gridToLabel({ x: 25, y: 0 }), "Z1");
      t.assertEqual(Grid.gridToLabel({ x: 26, y: 0 }), "AA1");
    });

    t.test("invalid input is rejected", function () {
      t.assertThrows(function () {
        Grid.distanceFeet({ x: 1.5, y: 0 }, { x: 0, y: 0 });
      }, "fractional coordinates");
      t.assertThrows(function () {
        Grid.diagonalStepCostFeet(-1);
      }, "negative diagonal index");
      t.assertThrows(function () {
        Grid.reachableCells({ x: 0, y: 0 }, -5);
      }, "negative movement budget");
      t.assertThrows(function () {
        Grid.reachableCells({ x: 0, y: 0 }, 25, { cols: 0, rows: 15 });
      }, "empty grid");
    });
  };
});
