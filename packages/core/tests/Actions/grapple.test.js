/**
 * Phase 8.3 — Grapple: grabbed/restrained, sourceId, source-turn expiry, and
 * break-on-move/death.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Encounter/encounter.js"),
      require("../../src/Core/Actions/grapple.js"),
      require("../../src/Core/Actions/step.js"),
      require("../../src/Core/Rules/checks.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Actions — Grapple, Grabbed & Source Duration",
      register: factory(
        root.PF2e.Core.GridMap,
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Encounter,
        root.PF2e.Core.Actions.Grapple,
        root.PF2e.Core.Actions.Step,
        root.PF2e.Core.Rules.Checks,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  GridMap,
  Combatant,
  Encounter,
  Grapple,
  Step,
  Checks,
) {
  "use strict";

  if (!GridMap || !Combatant || !Encounter || !Grapple || !Step || !Checks) {
    throw new Error(
      "Grapple tests require GridMap, Combatant, Encounter, Grapple, Step and Checks.",
    );
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
          saves: { fortitude: 4, reflex: 8, will: 3 },
          skills: { athletics: 3, acrobatics: 7, stealth: 8, perception: 5 },
        },
        overrides || {},
      ),
    );
  }

  function grapple(options) {
    return Grapple.performGrapple(
      Object.assign(
        {
          map: makeMap(),
          rollD20: function () {
            return 10;
          },
        },
        options,
      ),
    );
  }

  return function registerGrappleTests(t) {
    t.test("Grapple success applies Grabbed and Immobilized with the sourceId", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin();

      const result = grapple({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 5;
        },
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.degree, D.SUCCESS);
      t.assertTrue(result.success);
      t.assertTrue(!result.critical);
      t.assertTrue(goblin.hasCondition("grabbed"));
      t.assertTrue(!goblin.hasCondition("restrained"));
      t.assertTrue(goblin.hasCondition("immobilized"));
      t.assertTrue(goblin.isImmobilized());
      t.assertEqual(goblin.getCondition("grabbed").sourceId, "valeros");
      t.assertEqual(goblin.getCondition("immobilized").sourceId, "valeros");
      t.assertTrue(result.targetGrabbed);
      t.assertTrue(result.targetImmobilized);
      t.assertEqual(result.sourceId, "valeros");
      t.assertEqual(valeros.actionsRemaining, 2);
      t.assertEqual(valeros.attacksThisTurn, 1);
    });

    t.test("Grabbed contributes Off-Guard (-2 circumstance AC)", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin();

      grapple({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 5;
        },
      });

      const acModifiers = goblin.getConditionModifiers("ac");
      const offGuard = acModifiers.find(function (modifier) {
        return modifier.source === "off-guard";
      });
      t.assertTrue(offGuard !== undefined);
      t.assertEqual(offGuard.value, -2);
      t.assertEqual(offGuard.type, "circumstance");
      t.assertEqual(offGuard.name, "Off-Guard (Grabbed)");
    });

    t.test("Critical Success applies Restrained and replaces Grabbed from the same source", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin();

      const first = grapple({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 5;
        },
      });
      t.assertTrue(first.targetGrabbed);

      const second = grapple({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 20;
        },
      });

      t.assertEqual(second.degree, D.CRITICAL_SUCCESS);
      t.assertTrue(second.critical);
      t.assertTrue(goblin.hasCondition("restrained"));
      t.assertTrue(!goblin.hasCondition("grabbed"));
      t.assertTrue(goblin.hasCondition("immobilized"));
      t.assertEqual(goblin.getCondition("restrained").sourceId, "valeros");
      t.assertEqual(goblin.getConditionModifiers("ac")[0].name, "Off-Guard (Restrained)");
    });

    t.test("Critical Failure makes the attacker Prone and releases an existing hold", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin();

      grapple({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 5;
        },
      });
      t.assertTrue(goblin.hasCondition("grabbed"));

      const result = grapple({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 1;
        },
      });

      t.assertEqual(result.degree, D.CRITICAL_FAILURE);
      t.assertTrue(result.attackerProne);
      t.assertTrue(valeros.hasCondition("prone"));
      t.assertTrue(!goblin.hasCondition("grabbed"));
      t.assertTrue(!goblin.hasCondition("immobilized"));
      t.assertEqual(result.released.length, 2);
    });

    t.test("Grapple expires at the end of the grappler's next turn, not the victim's", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin();
      const encounter = new Encounter({ combatants: [valeros, goblin] });
      encounter.startEncounter();

      const result = grapple({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 5;
        },
      });

      t.assertEqual(valeros.turnNumber, 1);
      t.assertEqual(result.expiresOnSourceTurn, 2);
      t.assertEqual(goblin.getCondition("grabbed").expiresOnSourceTurn, 2);

      // End Valeros' turn and run the Goblin's turn: the hold remains.
      encounter.nextTurn();
      t.assertEqual(encounter.activeCombatant.id, "goblin");
      t.assertTrue(goblin.hasCondition("grabbed"));
      encounter.nextTurn();
      t.assertEqual(encounter.activeCombatant.id, "valeros");
      t.assertEqual(valeros.turnNumber, 2);
      t.assertTrue(goblin.hasCondition("grabbed"));

      // End Valeros' next turn: now the hold expires.
      const third = encounter.nextTurn();
      t.assertEqual(encounter.activeCombatant.id, "goblin");
      t.assertTrue(!goblin.hasCondition("grabbed"));
      t.assertTrue(!goblin.hasCondition("immobilized"));
      t.assertEqual(third.releasedGrapples.length, 1);
      t.assertEqual(third.releasedGrapples[0].combatantId, "goblin");
    });

    t.test("A grappler that Steps loses the hold", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin();

      grapple({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 5;
        },
      });
      t.assertTrue(goblin.hasCondition("grabbed"));

      const move = Step.performStep({
        combatant: valeros,
        map: makeMap(),
        destination: { x: 1, y: 2 },
        combatants: [valeros, goblin],
      });

      t.assertTrue(move.ok);
      t.assertEqual(move.releasedGrapples.length, 1);
      t.assertTrue(!goblin.hasCondition("grabbed"));
      t.assertTrue(!goblin.hasCondition("immobilized"));
    });

    t.test("A defeated grappler releases the hold on the next turn advance", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin();
      const encounter = new Encounter({ combatants: [valeros, goblin] });
      encounter.startEncounter();

      grapple({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        rollD20: function () {
          return 5;
        },
      });
      t.assertTrue(goblin.hasCondition("grabbed"));

      valeros.takeDamage(valeros.maxHP);
      t.assertTrue(valeros.isDefeated);
      const turn = encounter.nextTurn();

      t.assertTrue(!goblin.hasCondition("grabbed"));
      t.assertTrue(!goblin.hasCondition("immobilized"));
      t.assertTrue(
        turn.releasedGrapples.some(function (entry) {
          return entry.combatantId === "goblin";
        }),
      );
    });

    t.test("A failed Concealed flat check spends the action and advances MAP", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin();
      goblin.addCondition("concealed");

      const result = grapple({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
        rollFlatCheck: function () {
          return 4;
        },
        rollD20: function () {
          return 5;
        },
      });

      t.assertTrue(result.automaticMiss);
      t.assertTrue(!goblin.hasCondition("grabbed"));
      t.assertEqual(valeros.actionsRemaining, 2);
      t.assertEqual(valeros.attacksThisTurn, 1);
    });

    t.test("Grapple out of reach spends no action and applies nothing", function () {
      const valeros = makeValeros();
      const goblin = makeGoblin({ x: 6, y: 2 });

      const result = grapple({
        attacker: valeros,
        target: goblin,
        combatants: [valeros, goblin],
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, "out-of-reach");
      t.assertEqual(valeros.actionsRemaining, 3);
      t.assertEqual(valeros.attacksThisTurn, 0);
      t.assertTrue(!goblin.hasCondition("grabbed"));
    });
  };
});
