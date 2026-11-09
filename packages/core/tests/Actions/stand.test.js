/**
 * Phase 8.2 — Stand: removes Prone, costs 1 action, and provokes Reactive Strike.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Actions/stand.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Actions — Stand & Reactions",
      register: factory(
        root.PF2e.Core.GridMap,
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Actions.Stand,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  GridMap,
  Combatant,
  Stand,
) {
  "use strict";

  if (!GridMap || !Combatant || !Stand) {
    throw new Error("Stand tests require GridMap, Combatant and Stand.");
  }

  function makeMap() {
    return new GridMap({ cols: 10, rows: 10 });
  }

  function makeValeros(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "valeros",
          name: "Valeros",
          alliance: "player",
          initiative: 18,
          x: 2,
          y: 2,
          speedFeet: 25,
          maxActions: 3,
          maxHP: 20,
          ac: 18,
          attackBonus: 9,
          damage: { formula: "1d8+4", type: "slashing" },
          agile: false,
          saves: { fortitude: 9, reflex: 6, will: 5 },
          skills: { athletics: 10, acrobatics: 6, stealth: 2, perception: 7 },
          conditions: { prone: 1 },
        },
        overrides || {},
      ),
    );
  }

  function makeGoblin(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "goblin",
          name: "Goblin",
          alliance: "enemy",
          initiative: 15,
          x: 3,
          y: 2,
          speedFeet: 25,
          maxActions: 3,
          maxHP: 6,
          ac: 16,
          attackBonus: 8,
          damage: { formula: "1d6+1", type: "slashing" },
          agile: true,
          saves: { fortitude: 4, reflex: 8, will: 3 },
          skills: { athletics: 3, acrobatics: 7, stealth: 8, perception: 5 },
        },
        overrides || {},
      ),
    );
  }

  function stand(options) {
    return Stand.performStand(
      Object.assign(
        {
          map: makeMap(),
          rollD20: function () {
            return 10;
          },
          rollDamageDie: function () {
            return 1;
          },
        },
        options,
      ),
    );
  }

  return function registerStandTests(t) {
    t.test("Stand spends 1 action and removes Prone", function () {
      const valeros = makeValeros();

      const result = stand({ combatant: valeros, combatants: [valeros] });

      t.assertTrue(result.ok);
      t.assertEqual(result.actionsLeft, 2);
      t.assertEqual(valeros.actionsRemaining, 2);
      t.assertTrue(result.wasProne);
      t.assertTrue(result.proneRemoved);
      t.assertTrue(!valeros.hasCondition("prone"));
      t.assertEqual(result.reactions.length, 0);
      t.assertEqual(result.reaction, null);
    });

    t.test("Stand keeps other conditions", function () {
      const valeros = makeValeros();
      valeros.addCondition("frightened", 1);

      const result = stand({ combatant: valeros, combatants: [valeros] });

      t.assertTrue(result.ok);
      t.assertTrue(!valeros.hasCondition("prone"));
      t.assertTrue(valeros.hasCondition("frightened"));
    });

    t.test("Stand is refused when the combatant is not Prone", function () {
      const valeros = makeValeros({ conditions: {} });

      const result = stand({ combatant: valeros, combatants: [valeros] });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Stand.STAND_REASONS.NOT_PRONE);
      t.assertEqual(result.reason, "not-prone");
      t.assertEqual(valeros.actionsRemaining, 3);
    });

    t.test("Stand without actions is refused and stays Prone", function () {
      const valeros = makeValeros({ actionsRemaining: 0 });

      const result = stand({ combatant: valeros, combatants: [valeros] });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Stand.STAND_REASONS.NO_ACTIONS);
      t.assertTrue(valeros.hasCondition("prone"));
    });

    t.test("Stand provokes Reactive Strike from an adjacent enemy", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin();

      const result = stand({
        combatant: valeros,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 20;
        },
        rollDamageDie: function () {
          return 1;
        },
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.reactions.length, 1);
      t.assertTrue(result.reaction !== null);
      t.assertTrue(result.reaction.ok);
      t.assertEqual(result.reaction.attackerId, "goblin");
      t.assertEqual(result.reaction.targetId, "valeros");
      t.assertEqual(result.reaction.reactionTrigger, "leave-threatened-square");
      t.assertEqual(goblin.reactionsRemaining, 0);
      t.assertEqual(result.reaction.reactionsLeft, 0);

      // The reaction resolves before Stand finishes, so the target is still
      // Prone: AC 18 - 2 Off-Guard = 16.
      t.assertEqual(result.reaction.targetAC, 16);
      t.assertTrue(
        result.reaction.targetACModifiers.some(function (modifier) {
          return modifier.source === "off-guard" && modifier.value === -2;
        }),
      );
      t.assertTrue(result.reaction.hit);

      // Valeros survives the reaction and finishes standing.
      t.assertTrue(!valeros.hasCondition("prone"));
      t.assertTrue(result.proneRemoved);
      t.assertEqual(valeros.actionsRemaining, 2);
    });

    t.test("Stand does not provoke when no enemy threatens the square", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin({ x: 7, y: 2 });

      const result = stand({
        combatant: valeros,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 20;
        },
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.reactions.length, 0);
      t.assertEqual(goblin.reactionsRemaining, 1);
      t.assertTrue(!valeros.hasCondition("prone"));
    });

    t.test("Stand does not provoke an enemy with no reaction left", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin({ reactionsRemaining: 0 });

      const result = stand({
        combatant: valeros,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 20;
        },
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.reactions.length, 0);
      t.assertEqual(goblin.reactionsRemaining, 0);
      t.assertTrue(!valeros.hasCondition("prone"));
    });

    t.test("Only the first eligible enemy reacts", function () {
      const valeros = makeValeros();
      const goblinA = makeGoblin({ id: "goblin-a", name: "Goblin A" });
      const goblinB = makeGoblin({
        id: "goblin-b",
        name: "Goblin B",
        x: 2,
        y: 3,
      });

      const result = stand({
        combatant: valeros,
        combatants: [valeros, goblinA, goblinB],
        rollD20: function () {
          return 20;
        },
        rollDamageDie: function () {
          return 1;
        },
      });

      t.assertEqual(result.reactions.length, 1);
      t.assertEqual(result.reaction.attackerId, "goblin-a");
      t.assertEqual(goblinA.reactionsRemaining, 0);
      t.assertEqual(goblinB.reactionsRemaining, 1);
    });

    t.test("A defeating reaction interrupts Stand and leaves Prone", function () {
      const valeros = makeValeros({ currentHP: 1 });
      const goblin = makeGoblin();

      const result = stand({
        combatant: valeros,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 20;
        },
        rollDamageDie: function () {
          return 6;
        },
      });

      t.assertTrue(result.ok);
      t.assertTrue(result.defeated);
      t.assertTrue(result.reaction !== null);
      t.assertTrue(result.reaction.targetDefeated === true);
      t.assertTrue(!result.proneRemoved);
      t.assertTrue(valeros.hasCondition("prone"));
      t.assertEqual(valeros.currentHP, 0);
    });

    t.test("Stand requires a Combatant with an action pool", function () {
      t.assertThrows(function () {
        Stand.performStand({ combatant: {}, map: makeMap(), combatants: [] });
      }, "missing action pool");
    });
  };
});
