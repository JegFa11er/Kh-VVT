/**
 * Session 2 — centre-to-centre line-of-sight raycasting.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Grid/los-math.js"),
      require("../../src/Core/Grid/grid-map.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Grid — Line of Sight",
      register: factory(root.PF2e.Core.LosMath, root.PF2e.Core.GridMap),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (LosMath, GridMap) {
  "use strict";

  if (!LosMath || !GridMap) {
    throw new Error("LoS tests require LosMath and GridMap.");
  }

  function openMap(cols, rows) {
    return new GridMap({ cols: cols || 5, rows: rows || 5 });
  }

  function cellSet(cells) {
    return new Set(
      cells.map(function (cell) {
        return cell.x + "," + cell.y;
      }),
    );
  }

  return function registerLosTests(t) {
    t.test("same cell has line of sight", function () {
      t.assertTrue(LosMath.hasLineOfSight({ x: 2, y: 2 }, { x: 2, y: 2 }, openMap()));
    });

    t.test("adjacent orthogonal and diagonal cells are visible", function () {
      const map = openMap();
      t.assertTrue(LosMath.hasLineOfSight({ x: 1, y: 1 }, { x: 2, y: 1 }, map));
      t.assertTrue(LosMath.hasLineOfSight({ x: 1, y: 1 }, { x: 2, y: 2 }, map));
    });

    t.test("a wall between two cells blocks the ray", function () {
      const map = new GridMap({ cols: 5, rows: 1 });
      map.setBlocked(2, 0, true);

      const trace = LosMath.traceLineOfSight({ x: 0, y: 0 }, { x: 4, y: 0 }, map);
      t.assertTrue(!trace.visible);
      t.assertDeepEqual(trace.blockedBy, { x: 2, y: 0 });
      t.assertDeepEqual(trace.blockedCells, [{ x: 2, y: 0 }]);
    });

    t.test("a wall beside the ray does not block it", function () {
      const map = new GridMap({ cols: 5, rows: 3 });
      map.setBlocked(2, 1, true);

      t.assertTrue(LosMath.hasLineOfSight({ x: 0, y: 0 }, { x: 4, y: 0 }, map));
    });

    t.test("a wall behind the target does not block it", function () {
      const map = new GridMap({ cols: 5, rows: 1 });
      map.setBlocked(2, 0, true);

      t.assertTrue(LosMath.hasLineOfSight({ x: 0, y: 0 }, { x: 1, y: 0 }, map));
    });

    t.test("a target standing in a wall is not visible", function () {
      const map = new GridMap({ cols: 5, rows: 1 });
      map.setBlocked(1, 0, true);

      const trace = LosMath.traceLineOfSight({ x: 0, y: 0 }, { x: 1, y: 0 }, map);
      t.assertTrue(!trace.visible, "a target standing in a wall is not visible");
      t.assertDeepEqual(trace.blockedBy, { x: 1, y: 0 });
    });

    t.test("a clear 45-degree diagonal is visible", function () {
      const map = openMap(4, 4);
      t.assertTrue(LosMath.hasLineOfSight({ x: 0, y: 0 }, { x: 2, y: 2 }, map));
    });

    t.test("corner-touching walls block a diagonal ray", function () {
      const map = openMap(3, 3);
      map.setBlocked(1, 0, true);

      const trace = LosMath.traceLineOfSight({ x: 0, y: 0 }, { x: 1, y: 1 }, map);
      t.assertTrue(!trace.visible, "block-any corner policy applies to LoS");
      t.assertDeepEqual(trace.blockedBy, { x: 1, y: 0 });
    });

    t.test("a corner wall also blocks a longer 45-degree ray", function () {
      const map = openMap(4, 4);
      map.setBlocked(1, 0, true);

      t.assertTrue(!LosMath.hasLineOfSight({ x: 0, y: 0 }, { x: 2, y: 2 }, map));
    });

    t.test("lineCells includes cells touched only at a corner", function () {
      const cells = LosMath.lineCells({ x: 0, y: 0 }, { x: 1, y: 1 });
      const keys = cellSet(cells);

      t.assertTrue(keys.has("0,0"));
      t.assertTrue(keys.has("1,1"));
      t.assertTrue(keys.has("1,0"), "orthogonal cell touches the vertex");
      t.assertTrue(keys.has("0,1"), "orthogonal cell touches the vertex");
    });

    t.test("lineCells is symmetric as a set", function () {
      const forward = LosMath.lineCells({ x: 0, y: 0 }, { x: 3, y: 1 });
      const backward = LosMath.lineCells({ x: 3, y: 1 }, { x: 0, y: 0 });
      const forwardKeys = Array.from(cellSet(forward)).sort();
      const backwardKeys = Array.from(cellSet(backward)).sort();
      t.assertDeepEqual(forwardKeys, backwardKeys);
    });

    t.test("a ray along a row misses cells in the next row", function () {
      const map = openMap(5, 3);
      map.setBlocked(1, 0, true);
      map.setBlocked(2, 0, true);

      t.assertTrue(LosMath.hasLineOfSight({ x: 0, y: 1 }, { x: 4, y: 1 }, map));
    });

    t.test("invalid input is rejected", function () {
      t.assertThrows(function () {
        LosMath.hasLineOfSight({ x: 0.5, y: 0 }, { x: 1, y: 0 }, openMap());
      }, "fractional cell");
      t.assertThrows(function () {
        LosMath.hasLineOfSight({ x: 0, y: 0 }, { x: 1, y: 0 }, null);
      }, "missing map");
    });
  };
});
