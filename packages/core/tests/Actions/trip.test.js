/**
 * Phase 8.3 — Trip: Athletics vs Reflex DC, MAP, Prone, and critical damage.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Actions/trip.js"),
      require("../../src/Core/Rules/checks.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Actions — Trip & Reflex DC",
      register: factory(
        root.PF2e.Core.GridMap,
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Actions.Trip,
        root.PF2e.Core.Rules.Checks,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  GridMap,
  Combatant,
  Trip,
  Checks,
) {
  "use strict";

  if (!GridMap || !Combatant || !Trip || !Checks) {
    throw new Error("Trip tests require GridMap, Combatant, Trip and Checks.");
  }

  const D = Checks.DEGREES;

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
          maxHP: 20,
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

  function trip(options) {
    return Trip.performTrip(
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

  return function registerTripTests(t) {
    t.test("Trip rolls Athletics against Reflex DC and applies Prone on success", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin();

      const result = trip({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 8;
        },
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.skill, "athletics");
      t.assertEqual(result.skillLabel, "Athletics");
      t.assertEqual(result.skillBase, 10);
      t.assertEqual(result.total, 18);
      t.assertEqual(result.targetDCBaseValue, 8);
      t.assertEqual(result.targetDCBase, 18);
      t.assertEqual(result.reflexDC, 18);
      t.assertEqual(result.degree, D.SUCCESS);
      t.assertTrue(result.success);
      t.assertTrue(!result.critical);
      t.assertTrue(goblin.hasCondition("prone"));
      t.assertEqual(goblin.getCondition("prone").label, "Prone");
      t.assertTrue(!valeros.hasCondition("prone"));
      t.assertEqual(valeros.actionsRemaining, 2);
      t.assertEqual(valeros.attacksThisTurn, 1);
      t.assertEqual(result.actionsLeft, 2);
    });

    t.test("Trip applies the current MAP and advances it after the check", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin();

      const first = trip({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 5;
        },
      });

      t.assertEqual(first.attackModifier, 10);
      t.assertEqual(first.mapPenalty, 0);
      t.assertEqual(first.degree, D.FAILURE);
      t.assertTrue(!goblin.hasCondition("prone"));
      t.assertEqual(valeros.attacksThisTurn, 1);

      const second = trip({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 15;
        },
      });

      t.assertEqual(second.mapPenalty, -5);
      t.assertEqual(second.attackModifier, 5);
      t.assertEqual(second.total, 20);
      t.assertEqual(second.reflexDC, 18);
      t.assertEqual(second.degree, D.SUCCESS);
      t.assertTrue(goblin.hasCondition("prone"));
      t.assertEqual(valeros.attacksThisTurn, 2);
      t.assertEqual(valeros.actionsRemaining, 1);
    });

    t.test("Critical Success deals 1d6 bludgeoning through IWR", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin({
        resistances: [{ type: "bludgeoning", value: 2 }],
      });

      const result = trip({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 18;
        },
        rollDamageDie: function () {
          return 4;
        },
      });

      t.assertEqual(result.total, 28);
      t.assertEqual(result.reflexDC, 18);
      t.assertEqual(result.degree, D.CRITICAL_SUCCESS);
      t.assertTrue(result.critical);
      t.assertTrue(result.success);
      t.assertTrue(goblin.hasCondition("prone"));
      t.assertEqual(result.damage.type, "bludgeoning");
      t.assertEqual(result.damage.total, 4);
      t.assertEqual(result.damageDealt, 2);
      t.assertEqual(result.hpBefore, 20);
      t.assertEqual(result.hpAfter, 18);
      t.assertEqual(goblin.currentHP, 18);
      t.assertTrue(result.iwr !== null);
    });

    t.test("Critical Failure makes the attacker Prone", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin();

      const result = trip({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 1;
        },
      });

      // 1 + 10 = 11 vs DC 18 is a failure; natural 1 shifts it to critical
      // failure.
      t.assertEqual(result.total, 11);
      t.assertEqual(result.degree, D.CRITICAL_FAILURE);
      t.assertTrue(result.attackerProne);
      t.assertTrue(!result.targetProne);
      t.assertTrue(valeros.hasCondition("prone"));
      t.assertTrue(!goblin.hasCondition("prone"));
      t.assertEqual(valeros.actionsRemaining, 2);
      t.assertEqual(valeros.attacksThisTurn, 1);
    });

    t.test("Standard Cover adds +2 circumstance to Reflex DC", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin();

      const result = trip({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        cover: { degree: "standard" },
        rollD20: function () {
          return 9;
        },
      });

      t.assertEqual(result.reflexDC, 20);
      t.assertEqual(result.targetDCModifiers.length, 1);
      t.assertEqual(result.targetDCModifiers[0].source, "cover");
      t.assertEqual(result.targetDCModifiers[0].value, 2);
      t.assertEqual(result.total, 19);
      t.assertEqual(result.degree, D.FAILURE);
      t.assertTrue(!goblin.hasCondition("prone"));
    });

    t.test("Frightened lowers the target's Reflex DC and the attacker's Athletics", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin();
      valeros.addCondition("frightened", 1);
      goblin.addCondition("frightened", 1);

      const result = trip({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 8;
        },
      });

      t.assertEqual(result.reflexDC, 17);
      t.assertEqual(result.attackModifier, 9);
      t.assertEqual(result.total, 17);
      t.assertEqual(result.degree, D.SUCCESS);
      t.assertTrue(goblin.hasCondition("prone"));
    });

    t.test("A Prone attacker is not penalized on the Athletics check", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin();
      valeros.addCondition("prone");

      const result = trip({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 9;
        },
      });

      // Trip is a skill check, not an attack roll, so Prone does not impose its
      // -2 attack penalty. MAP still applies as usual.
      t.assertEqual(result.attackModifier, 10);
      t.assertEqual(result.total, 19);
      t.assertEqual(result.reflexDC, 18);
      t.assertEqual(result.degree, D.SUCCESS);
      t.assertTrue(goblin.hasCondition("prone"));
    });

    t.test("A failed Concealed flat check spends the action and advances MAP", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin();
      goblin.addCondition("concealed");

      const result = trip({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        rollFlatCheck: function () {
          return 4;
        },
        rollD20: function () {
          return 18;
        },
      });

      t.assertTrue(result.ok);
      t.assertTrue(result.automaticMiss);
      t.assertEqual(result.flatCheck.dc, 5);
      t.assertTrue(!result.flatCheck.passed);
      t.assertEqual(result.attackRoll, null);
      t.assertEqual(result.total, null);
      t.assertEqual(valeros.actionsRemaining, 2);
      t.assertEqual(valeros.attacksThisTurn, 1);
      t.assertTrue(!goblin.hasCondition("prone"));
      t.assertEqual(result.damageDealt, 0);
    });

    t.test("A passed Concealed flat check proceeds with the Trip", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin();
      goblin.addCondition("concealed");

      const result = trip({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        rollFlatCheck: function () {
          return 5;
        },
        rollD20: function () {
          return 18;
        },
        rollDamageDie: function () {
          return 3;
        },
      });

      t.assertTrue(result.flatCheck.passed);
      t.assertEqual(result.degree, D.CRITICAL_SUCCESS);
      t.assertTrue(goblin.hasCondition("prone"));
      t.assertEqual(result.damageDealt, 3);
      t.assertEqual(valeros.attacksThisTurn, 1);
    });

    t.test("Trip out of reach spends no action and does not advance MAP", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin({ x: 6, y: 2 });

      const result = trip({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, "out-of-reach");
      t.assertEqual(valeros.actionsRemaining, 3);
      t.assertEqual(valeros.attacksThisTurn, 0);
      t.assertTrue(!goblin.hasCondition("prone"));
    });

    t.test("Trip without actions spends nothing", function () {
      const valeros = makeValeros({ actionsRemaining: 0 });
      const goblin = makeGoblin();

      const result = trip({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, "no-actions");
      t.assertEqual(valeros.attacksThisTurn, 0);
      t.assertTrue(!goblin.hasCondition("prone"));
    });

    t.test("Trip rejects an ally and an undetected target without spending", function () {
      const valeros = makeValeros();
      const merisiel = makeValeros({
        id: "merisiel",
        name: "Merisiel",
        x: 3,
        y: 2,
      });
      const allyResult = trip({
        attacker: valeros,
        target: merisiel,
        combatants: [valeros, merisiel],
      });
      t.assertTrue(!allyResult.ok);
      t.assertEqual(allyResult.reason, "ally");
      t.assertEqual(valeros.actionsRemaining, 3);

      const goblin = makeGoblin();
      goblin.addCondition("undetected");
      const hiddenResult = trip({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
      });
      t.assertTrue(!hiddenResult.ok);
      t.assertEqual(hiddenResult.reason, "target-undetected");
      t.assertEqual(valeros.actionsRemaining, 3);
      t.assertEqual(valeros.attacksThisTurn, 0);
    });
  };
});
