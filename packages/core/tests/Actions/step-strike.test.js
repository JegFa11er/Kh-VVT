/**
 * Session 2 — Step and Strike action validation.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Actions/step.js"),
      require("../../src/Core/Actions/strike.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Actions — Step & Strike",
      register: factory(
        root.PF2e.Core.GridMap,
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Actions.Step,
        root.PF2e.Core.Actions.Strike,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  GridMap,
  Combatant,
  Step,
  Strike,
) {
  "use strict";

  if (!GridMap || !Combatant || !Step || !Strike) {
    throw new Error("Step/Strike tests require GridMap, Combatant, Step and Strike.");
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

  function makeEnemy(overrides) {
    return makeCombatant(
      Object.assign(
        {
          id: "goblin",
          name: "Goblin",
          alliance: "enemy",
          initiative: 5,
          x: 1,
          y: 0,
        },
        overrides || {},
      ),
    );
  }

  return function registerStepStrikeTests(t) {
    // ---------------------------------------------------------------- Step

    t.test("Step moves one square for 1 action and costs 5 ft", function () {
      const combatant = makeCombatant({ x: 1, y: 1 });
      const result = Step.performStep({
        combatant: combatant,
        map: new GridMap({ cols: 4, rows: 4 }),
        destination: { x: 2, y: 1 },
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.costFeet, 5);
      t.assertEqual(result.actionsLeft, 2);
      t.assertEqual(combatant.x, 2);
      t.assertEqual(combatant.y, 1);
      t.assertDeepEqual(result.path, [{ x: 1, y: 1 }, { x: 2, y: 1 }]);
    });

    t.test("Step diagonally is 5 ft and does not change 5-10-5 parity", function () {
      const combatant = makeCombatant({ x: 0, y: 0 });
      combatant.registerDiagonalSteps(1);

      const result = Step.performStep({
        combatant: combatant,
        map: new GridMap({ cols: 4, rows: 4 }),
        destination: { x: 1, y: 1 },
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.costFeet, 5);
      t.assertEqual(combatant.diagonalStepsThisTurn, 1);
      t.assertEqual(combatant.diagonalParity, 1);
    });

    t.test("Step rejects a non-adjacent destination without spending an action", function () {
      const combatant = makeCombatant({ x: 0, y: 0 });
      const result = Step.performStep({
        combatant: combatant,
        map: new GridMap({ cols: 4, rows: 4 }),
        destination: { x: 2, y: 1 },
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Step.STEP_REASONS.NOT_ADJACENT);
      t.assertEqual(combatant.actionsRemaining, 3);
      t.assertEqual(combatant.x, 0);
    });

    t.test("Step cannot enter difficult terrain", function () {
      const map = new GridMap({ cols: 4, rows: 4 });
      map.setDifficultTerrain(1, 0, true);
      const combatant = makeCombatant({ x: 0, y: 0 });

      const result = Step.performStep({
        combatant: combatant,
        map: map,
        destination: { x: 1, y: 0 },
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Step.STEP_REASONS.DIFFICULT_TERRAIN);
      t.assertEqual(combatant.actionsRemaining, 3);
      t.assertEqual(combatant.x, 0);
    });

    t.test("Step cannot enter an ally's square", function () {
      const combatant = makeCombatant({ x: 0, y: 0 });
      const result = Step.performStep({
        combatant: combatant,
        map: new GridMap({ cols: 4, rows: 4 }),
        destination: { x: 1, y: 0 },
        occupancy: {
          blockedCells: [],
          passThroughCells: [{ x: 1, y: 0 }],
        },
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Step.STEP_REASONS.DESTINATION_OCCUPIED);
      t.assertEqual(combatant.actionsRemaining, 3);
    });

    t.test("Step cannot enter an enemy's square", function () {
      const combatant = makeCombatant({ x: 0, y: 0 });
      const result = Step.performStep({
        combatant: combatant,
        map: new GridMap({ cols: 4, rows: 4 }),
        destination: { x: 1, y: 0 },
        occupancy: {
          blockedCells: [{ x: 1, y: 0 }],
          passThroughCells: [],
        },
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Step.STEP_REASONS.BLOCKED_DESTINATION);
      t.assertEqual(combatant.actionsRemaining, 3);
    });

    t.test("Step cannot enter a wall", function () {
      const map = new GridMap({ cols: 4, rows: 4 });
      map.setBlocked(1, 0, true);
      const combatant = makeCombatant({ x: 0, y: 0 });

      const result = Step.performStep({
        combatant: combatant,
        map: map,
        destination: { x: 1, y: 0 },
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Step.STEP_REASONS.BLOCKED_DESTINATION);
      t.assertEqual(combatant.actionsRemaining, 3);
    });

    t.test("Step obeys the block-any diagonal corner rule", function () {
      const map = new GridMap({ cols: 3, rows: 3 });
      map.setBlocked(1, 0, true);
      const combatant = makeCombatant({ x: 0, y: 0 });

      const result = Step.performStep({
        combatant: combatant,
        map: map,
        destination: { x: 1, y: 1 },
        diagonalCornerPolicy: "block-any",
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Step.STEP_REASONS.CORNER_BLOCKED);
      t.assertEqual(combatant.actionsRemaining, 3);
    });

    t.test("Step without actions is rejected", function () {
      const combatant = makeCombatant({ x: 0, y: 0 });
      combatant.spendActions(3);

      const result = Step.performStep({
        combatant: combatant,
        map: new GridMap({ cols: 4, rows: 4 }),
        destination: { x: 1, y: 0 },
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Step.STEP_REASONS.NO_ACTIONS);
      t.assertEqual(combatant.actionsRemaining, 0);
      t.assertEqual(combatant.x, 0);
    });

    t.test("getStepDestinations filters terrain, occupancy, and corners", function () {
      const map = new GridMap({ cols: 3, rows: 3 });
      map.setDifficultTerrain(1, 0, true);
      map.setBlocked(2, 1, true);
      const combatant = makeCombatant({ x: 1, y: 1 });

      const cells = Step.getStepDestinations({
        combatant: combatant,
        map: map,
        occupancy: {
          blockedCells: [],
          passThroughCells: [{ x: 0, y: 1 }],
        },
        diagonalCornerPolicy: "block-any",
      });
      const keys = new Set(
        cells.map(function (cell) {
          return cell.x + "," + cell.y;
        }),
      );

      t.assertTrue(!keys.has("1,0"), "difficult terrain is excluded");
      t.assertTrue(!keys.has("2,1"), "wall is excluded");
      t.assertTrue(!keys.has("0,1"), "ally square is excluded");
      t.assertTrue(keys.has("0,0"), "clear orthogonal square is included");
      t.assertTrue(keys.has("1,2"), "clear orthogonal square is included");
      t.assertTrue(!keys.has("2,2"), "corner next to a wall is excluded by block-any");
      for (const cell of cells) {
        t.assertEqual(cell.costFeet, 5);
      }
    });

    // -------------------------------------------------------------- Strike

    t.test("Strike spends 1 action and reports the d20", function () {
      const attacker = makeCombatant({ x: 0, y: 0 });
      const target = makeEnemy({ x: 1, y: 0 });
      let rolled = 0;

      const result = Strike.performStrike({
        attacker: attacker,
        target: target,
        map: new GridMap({ cols: 5, rows: 5 }),
        rollD20: function () {
          rolled += 1;
          return 13;
        },
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.attackRoll, 13);
      t.assertEqual(result.distanceFeet, 5);
      t.assertEqual(result.actionsLeft, 2);
      t.assertEqual(attacker.actionsRemaining, 2);
      t.assertEqual(rolled, 1);
    });

    t.test("Strike works against an adjacent diagonal enemy", function () {
      const attacker = makeCombatant({ x: 0, y: 0 });
      const target = makeEnemy({ x: 1, y: 1 });

      const result = Strike.performStrike({
        attacker: attacker,
        target: target,
        map: new GridMap({ cols: 5, rows: 5 }),
        rollD20: function () {
          return 7;
        },
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.distanceFeet, 5);
      t.assertEqual(attacker.actionsRemaining, 2);
    });

    t.test("Strike rejects a target beyond 5 ft without spending an action", function () {
      const attacker = makeCombatant({ x: 0, y: 0 });
      const target = makeEnemy({ x: 2, y: 0 });
      let rolled = 0;

      const result = Strike.performStrike({
        attacker: attacker,
        target: target,
        map: new GridMap({ cols: 5, rows: 5 }),
        rollD20: function () {
          rolled += 1;
          return 10;
        },
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Strike.STRIKE_REASONS.OUT_OF_REACH);
      t.assertEqual(result.distanceFeet, 10);
      t.assertEqual(rolled, 0, "invalid attempts consume no randomness");
      t.assertEqual(attacker.actionsRemaining, 3);
    });

    t.test("Strike requires line of sight", function () {
      const map = new GridMap({ cols: 3, rows: 3 });
      map.setBlocked(1, 0, true);
      map.setBlocked(0, 1, true);
      const attacker = makeCombatant({ x: 0, y: 0 });
      const target = makeEnemy({ x: 1, y: 1 });

      const evaluation = Strike.evaluateStrike({
        attacker: attacker,
        target: target,
        map: map,
      });
      t.assertTrue(!evaluation.ok);
      t.assertEqual(evaluation.reason, Strike.STRIKE_REASONS.NO_LINE_OF_SIGHT);

      const result = Strike.performStrike({
        attacker: attacker,
        target: target,
        map: map,
      });
      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Strike.STRIKE_REASONS.NO_LINE_OF_SIGHT);
      t.assertEqual(attacker.actionsRemaining, 3);
    });

    t.test("multi-cell creatures use edge-to-edge line of sight", function () {
      const map = new GridMap({ cols: 6, rows: 6 });
      map.setBlocked(1, 1, true);

      // A Medium attacker on the anchor cell has no line of sight through the
      // wall, but a Large attacker's near edge reaches around it.
      const medium = makeCombatant({ x: 0, y: 0 });
      const mediumTarget = makeEnemy({ x: 2, y: 1 });
      const blocked = Strike.evaluateStrike({
        attacker: medium,
        target: mediumTarget,
        map: map,
        reachFeet: 10,
      });
      t.assertTrue(!blocked.ok);
      t.assertEqual(blocked.reason, Strike.STRIKE_REASONS.NO_LINE_OF_SIGHT);

      const attacker = makeCombatant({ x: 0, y: 0, size: "large" });
      const target = makeEnemy({ x: 2, y: 1, size: "large" });
      const evaluation = Strike.evaluateStrike({
        attacker: attacker,
        target: target,
        map: map,
        reachFeet: 10,
      });
      t.assertTrue(evaluation.ok, "edge-to-edge line of sight is used");
      t.assertTrue(evaluation.lineOfSight);
    });

    t.test("Strike cannot target an ally", function () {
      const attacker = makeCombatant({ x: 0, y: 0 });
      const ally = makeCombatant({ id: "merisiel", x: 1, y: 0 });

      const result = Strike.performStrike({
        attacker: attacker,
        target: ally,
        map: new GridMap({ cols: 5, rows: 5 }),
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Strike.STRIKE_REASONS.ALLY);
      t.assertEqual(attacker.actionsRemaining, 3);
    });

    t.test("Strike without actions is rejected", function () {
      const attacker = makeCombatant({ x: 0, y: 0 });
      attacker.spendActions(3);
      const target = makeEnemy({ x: 1, y: 0 });

      const result = Strike.performStrike({
        attacker: attacker,
        target: target,
        map: new GridMap({ cols: 5, rows: 5 }),
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Strike.STRIKE_REASONS.NO_ACTIONS);
      t.assertEqual(attacker.actionsRemaining, 0);
    });

    t.test("evaluateStrike does not mutate actions", function () {
      const attacker = makeCombatant({ x: 0, y: 0 });
      const target = makeEnemy({ x: 1, y: 0 });

      const evaluation = Strike.evaluateStrike({
        attacker: attacker,
        target: target,
        map: new GridMap({ cols: 5, rows: 5 }),
      });

      t.assertTrue(evaluation.ok);
      t.assertEqual(attacker.actionsRemaining, 3);
    });

    t.test("an invalid d20 result throws without spending an action", function () {
      const attacker = makeCombatant({ x: 0, y: 0 });
      const target = makeEnemy({ x: 1, y: 0 });

      t.assertThrows(function () {
        Strike.performStrike({
          attacker: attacker,
          target: target,
          map: new GridMap({ cols: 5, rows: 5 }),
          rollD20: function () {
            return 21;
          },
        });
      }, "out-of-range d20");

      t.assertEqual(attacker.actionsRemaining, 3);
    });

    t.test("reachFeet can be overridden for reach weapons", function () {
      const attacker = makeCombatant({ x: 0, y: 0 });
      const target = makeEnemy({ x: 2, y: 0 });

      const result = Strike.performStrike({
        attacker: attacker,
        target: target,
        map: new GridMap({ cols: 5, rows: 5 }),
        reachFeet: 10,
        rollD20: function () {
          return 12;
        },
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.reachFeet, 10);
      t.assertEqual(result.distanceFeet, 10);
    });
  };
});
