/**
 * Phase 9 — PF2e Remastered large creatures: 2x2 occupancy, edge-to-edge
 * reach, and footprint-aware movement.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Grid/grid-math.js"),
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Grid/pathfinding.js"),
      require("../../src/Core/Grid/occupancy.js"),
      require("../../src/Core/Actions/strike.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Entities — Large Creatures, Occupancy & Reach",
      register: factory(
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Grid,
        root.PF2e.Core.GridMap,
        root.PF2e.Core.Pathfinding,
        root.PF2e.Core.Occupancy,
        root.PF2e.Core.Actions.Strike,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Combatant,
  Grid,
  GridMap,
  Pathfinding,
  Occupancy,
  Strike,
) {
  "use strict";

  if (!Combatant || !Grid || !GridMap || !Pathfinding || !Occupancy || !Strike) {
    throw new Error(
      "Large-creature tests require Combatant, Grid, GridMap, Pathfinding, Occupancy and Strike.",
    );
  }

  function makeCombatant(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "creature",
          name: "Creature",
          alliance: "player",
          x: 0,
          y: 0,
          speedFeet: 25,
        },
        overrides || {},
      ),
    );
  }

  return function registerCombatantSizeTests(t) {
    t.test("Phase 9: a Large combatant occupies 4 cells", function () {
      const ogre = makeCombatant({ id: "ogre", x: 2, y: 2, size: "large" });
      const cells = ogre.getOccupiedCells();

      t.assertEqual(cells.length, 4);
      t.assertDeepEqual(cells, [
        { x: 2, y: 2 },
        { x: 2, y: 3 },
        { x: 3, y: 2 },
        { x: 3, y: 3 },
      ]);
    });

    t.test("Phase 9: distance is measured from the nearest edges", function () {
      const ogre = makeCombatant({ id: "ogre", x: 2, y: 2, size: "large" });
      const human = makeCombatant({ id: "human", x: 4, y: 2, size: "medium" });

      const distance = Grid.getCombatantDistance(ogre, human);

      // x=3 (the ogre's right edge) to x=4 (the human) -> dx=1, dy=0 -> 5 ft.
      t.assertEqual(
        distance,
        5,
        "a human directly beside a Large ogre is exactly 5 ft away",
      );
    });

    t.test("Phase 9: a Large creature cannot occupy another creature's cell", function () {
      const map = new GridMap({ cols: 6, rows: 6 });
      const ogre = makeCombatant({ id: "ogre", x: 1, y: 1, size: "large" });
      const human = makeCombatant({ id: "human", x: 2, y: 2, size: "medium" });

      t.assertTrue(
        !Occupancy.canOccupySpace(1, 1, ogre, map, [ogre, human]),
        "the ogre's 2x2 footprint overlaps the human at 2,2",
      );
      t.assertTrue(
        Occupancy.canOccupySpace(3, 1, ogre, map, [ogre, human]),
        "a 2x2 footprint fully clear of the human is valid",
      );
    });

    t.test("Phase 9: pathfinding validates the whole 2x2 footprint", function () {
      const map = new GridMap({ cols: 5, rows: 5 });
      map.setBlocked(2, 1, true);

      const blockedGoal = Pathfinding.findPath(
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { map: map, footprint: 2 },
      );
      t.assertTrue(!blockedGoal.found);
      t.assertEqual(blockedGoal.reason, "blocked-goal");

      const clearGoal = Pathfinding.findPath(
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { map: map, footprint: 2 },
      );
      t.assertTrue(clearGoal.found, "a clear 2x2 footprint remains reachable");
    });

    t.test("Phase 9: Strike uses edge-to-edge reach for a Large attacker", function () {
      const map = new GridMap({ cols: 7, rows: 7 });
      const ogre = makeCombatant({
        id: "ogre",
        name: "Ogre",
        alliance: "player",
        x: 2,
        y: 2,
        size: "large",
        ac: 16,
      });
      const human = makeCombatant({
        id: "human",
        name: "Human",
        alliance: "enemy",
        x: 4,
        y: 2,
        size: "medium",
        ac: 15,
      });

      const evaluation = Strike.evaluateStrike({
        attacker: ogre,
        target: human,
        map: map,
      });

      t.assertTrue(evaluation.ok, "the human is 5 ft from the ogre's edge");
      t.assertEqual(evaluation.distanceFeet, 5);
    });
  };
});
