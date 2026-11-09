/**
 * Phase 4 — PF2e Remastered flanking geometry.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Grid/flanking.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Grid — Flanking Geometry",
      register: factory(root.PF2e.Core.GridMap, root.PF2e.Core.Flanking),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (GridMap, Flanking) {
  "use strict";

  if (!GridMap || !Flanking) {
    throw new Error("Flanking tests require GridMap and Flanking.");
  }

  function unit(id, x, y, overrides) {
    return Object.assign(
      {
        id: id,
        name: id.charAt(0).toUpperCase() + id.slice(1),
        alliance: id === "target" ? "enemy" : "player",
        x: x,
        y: y,
        isDefeated: false,
      },
      overrides || {},
    );
  }

  function map() {
    return new GridMap({ cols: 10, rows: 10 });
  }

  return function registerFlankingTests(t) {
    t.test("east/west flank is true", function () {
      const target = unit("target", 5, 5);
      const attacker = unit("attacker", 6, 5);
      const ally = unit("ally", 4, 5);

      t.assertTrue(Flanking.isFlanked(target, attacker, [attacker, ally], map()));
    });

    t.test("north/south flank is true", function () {
      const target = unit("target", 5, 5);
      const attacker = unit("attacker", 5, 4);
      const ally = unit("ally", 5, 6);

      t.assertTrue(Flanking.isFlanked(target, attacker, [attacker, ally], map()));
    });

    t.test("diagonal northwest/southeast flank is true", function () {
      const target = unit("target", 5, 5);
      const attacker = unit("attacker", 4, 4);
      const ally = unit("ally", 6, 6);

      t.assertTrue(Flanking.isFlanked(target, attacker, [attacker, ally], map()));
    });

    t.test("diagonal northeast/southwest flank is true", function () {
      const target = unit("target", 5, 5);
      const attacker = unit("attacker", 6, 4);
      const ally = unit("ally", 4, 6);

      t.assertTrue(Flanking.isFlanked(target, attacker, [attacker, ally], map()));
    });

    t.test("an L-shaped arrangement (north + east) is not a flank", function () {
      const target = unit("target", 5, 5);
      const attacker = unit("attacker", 5, 4);
      const ally = unit("ally", 6, 5);

      t.assertTrue(!Flanking.isFlanked(target, attacker, [attacker, ally], map()));
    });

    t.test("a defeated ally cannot complete a flank", function () {
      const target = unit("target", 5, 5);
      const attacker = unit("attacker", 6, 5);
      const ally = unit("ally", 4, 5, { isDefeated: true });

      t.assertTrue(!Flanking.isFlanked(target, attacker, [attacker, ally], map()));
    });

    t.test("an ally out of 5-ft reach cannot complete a flank", function () {
      const target = unit("target", 5, 5);
      const attacker = unit("attacker", 6, 5);
      const ally = unit("ally", 3, 5);

      t.assertTrue(!Flanking.isFlanked(target, attacker, [attacker, ally], map()));
    });

    t.test("the attacker must also be within 5-ft reach", function () {
      const target = unit("target", 5, 5);
      const attacker = unit("attacker", 7, 5);
      const ally = unit("ally", 4, 5);

      t.assertTrue(!Flanking.isFlanked(target, attacker, [attacker, ally], map()));
    });

    t.test("a defeated attacker cannot flank", function () {
      const target = unit("target", 5, 5);
      const attacker = unit("attacker", 6, 5, { isDefeated: true });
      const ally = unit("ally", 4, 5);

      t.assertTrue(!Flanking.isFlanked(target, attacker, [attacker, ally], map()));
    });

    t.test("an ally of the target cannot complete a flank", function () {
      const target = unit("target", 5, 5);
      const attacker = unit("attacker", 6, 5);
      const ally = unit("ally", 4, 5, { alliance: "enemy" });

      t.assertTrue(!Flanking.isFlanked(target, attacker, [attacker, ally], map()));
    });

    t.test("getFlankingAllies reports the opposing creature", function () {
      const target = unit("target", 5, 5);
      const attacker = unit("attacker", 6, 5);
      const ally = unit("ally", 4, 5);

      const flankers = Flanking.getFlankingAllies(
        target,
        attacker,
        [attacker, ally],
        map(),
      );

      t.assertEqual(flankers.length, 1);
      t.assertEqual(flankers[0].id, "ally");
    });

    t.test("direction helpers describe opposite grid sides", function () {
      const target = { x: 5, y: 5 };
      const east = Flanking.directionFrom(target, { x: 6, y: 5 });
      const west = Flanking.directionFrom(target, { x: 4, y: 5 });
      const northEast = Flanking.directionFrom(target, { x: 6, y: 4 });
      const southWest = Flanking.directionFrom(target, { x: 4, y: 6 });

      t.assertDeepEqual(east, { x: 1, y: 0 });
      t.assertTrue(Flanking.isOppositeDirection(east, west));
      t.assertTrue(Flanking.isOppositeDirection(northEast, southWest));
      t.assertTrue(!Flanking.isOppositeDirection(east, northEast));
    });

    t.test("cells outside the grid cannot flank", function () {
      const target = unit("target", 0, 0);
      const attacker = unit("attacker", 1, 0);
      const ally = unit("ally", 99, 0);

      t.assertTrue(!Flanking.isFlanked(target, attacker, [attacker, ally], map()));
    });
  };
});
