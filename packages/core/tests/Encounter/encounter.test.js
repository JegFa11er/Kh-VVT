/**
 * Session 2.1/2.2 — initiative order, turn advancement, and round cycle.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Encounter/encounter.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Encounter — Initiative & Round Cycle",
      register: factory(root.PF2e.Core.Combatant, root.PF2e.Core.Encounter),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Combatant, Encounter) {
  "use strict";

  if (!Combatant || !Encounter) {
    throw new Error("Encounter tests require Combatant and Encounter.");
  }

  function makeCombatant(id, initiative, overrides) {
    return new Combatant(
      Object.assign(
        {
          id: id,
          name: id.charAt(0).toUpperCase() + id.slice(1),
          alliance: "player",
          initiative: initiative,
          x: 0,
          y: 0,
          speedFeet: 25,
          maxActions: 3,
        },
        overrides || {},
      ),
    );
  }

  function ids(combatants) {
    return combatants.map(function (combatant) {
      return combatant.id;
    });
  }

  return function registerEncounterTests(t) {
    t.test("initiative order is descending", function () {
      const low = makeCombatant("low", 5);
      const high = makeCombatant("high", 20);
      const mid = makeCombatant("mid", 12);
      const encounter = new Encounter({ combatants: [low, high, mid] });
      t.assertDeepEqual(ids(encounter.getOrder()), ["high", "mid", "low"]);
    });

    t.test("equal initiative keeps declaration order", function () {
      const first = makeCombatant("first", 10);
      const second = makeCombatant("second", 10);
      const third = makeCombatant("third", 10);
      const encounter = new Encounter({ combatants: [first, second, third] });
      t.assertDeepEqual(ids(encounter.getOrder()), ["first", "second", "third"]);
    });

    t.test("active combatant is null before start", function () {
      const encounter = new Encounter({
        combatants: [makeCombatant("a", 10)],
      });
      t.assertEqual(encounter.activeCombatant, null);
      t.assertEqual(encounter.isStarted, false);
    });

    t.test("startEncounter sets round 1 and resets everyone", function () {
      const a = makeCombatant("a", 20);
      const b = makeCombatant("b", 10);
      a.spendActions(3);
      b.spendActions(1);

      const encounter = new Encounter({ combatants: [a, b] });
      const active = encounter.startEncounter();

      t.assertEqual(active.id, "a");
      t.assertEqual(encounter.round, 1);
      t.assertEqual(encounter.activeCombatantIndex, 0);
      t.assertEqual(encounter.isStarted, true);
      t.assertEqual(a.actionsRemaining, 3);
      t.assertEqual(b.actionsRemaining, 3);
    });

    t.test("nextTurn advances and resets only the incoming combatant", function () {
      const a = makeCombatant("a", 20);
      const b = makeCombatant("b", 10);
      const encounter = new Encounter({ combatants: [a, b] });
      encounter.startEncounter();

      a.spendActions(3);
      b.spendActions(1);

      const turn = encounter.nextTurn();

      t.assertEqual(turn.previous.id, "a");
      t.assertEqual(turn.active.id, "b");
      t.assertEqual(turn.round, 1);
      t.assertEqual(turn.wrapped, false);
      t.assertEqual(turn.active.actionsRemaining, 3, "incoming turn is reset");
      t.assertEqual(turn.previous.actionsRemaining, 0, "outgoing turn is not reset");
      t.assertEqual(encounter.activeCombatantIndex, 1);
    });

    t.test("wrapping past the last combatant increments the round", function () {
      const a = makeCombatant("a", 30);
      const b = makeCombatant("b", 20);
      const c = makeCombatant("c", 10);
      const encounter = new Encounter({ combatants: [a, b, c] });
      encounter.startEncounter();

      t.assertEqual(encounter.nextTurn().active.id, "b");
      t.assertEqual(encounter.nextTurn().active.id, "c");

      const wrap = encounter.nextTurn();
      t.assertEqual(wrap.active.id, "a");
      t.assertEqual(wrap.round, 2);
      t.assertEqual(wrap.wrapped, true);
      t.assertEqual(encounter.round, 2);
      t.assertEqual(encounter.activeCombatantIndex, 0);
      t.assertEqual(a.actionsRemaining, 3, "wrapped combatant is reset");
    });

    t.test("two full rounds reach round 3", function () {
      const a = makeCombatant("a", 30);
      const b = makeCombatant("b", 20);
      const encounter = new Encounter({ combatants: [a, b] });
      encounter.startEncounter();

      encounter.nextTurn(); // b, round 1
      encounter.nextTurn(); // a, round 2
      encounter.nextTurn(); // b, round 2
      const turn = encounter.nextTurn(); // a, round 3

      t.assertEqual(turn.active.id, "a");
      t.assertEqual(turn.round, 3);
      t.assertEqual(turn.wrapped, true);
    });

    t.test("nextTurn starts an unstarted encounter", function () {
      const a = makeCombatant("a", 20);
      const b = makeCombatant("b", 10);
      const encounter = new Encounter({ combatants: [a, b] });

      const turn = encounter.nextTurn();
      t.assertEqual(turn.active.id, "a");
      t.assertEqual(turn.previous, null);
      t.assertEqual(turn.round, 1);
      t.assertEqual(encounter.isStarted, true);
    });

    t.test("isActive and indexOf work by object and id", function () {
      const a = makeCombatant("a", 20);
      const b = makeCombatant("b", 10);
      const encounter = new Encounter({ combatants: [a, b] });
      encounter.startEncounter();

      t.assertTrue(encounter.isActive(a));
      t.assertTrue(encounter.isActive("a"));
      t.assertTrue(!encounter.isActive(b));
      t.assertEqual(encounter.indexOf(a), 0);
      t.assertEqual(encounter.indexOf("b"), 1);
      t.assertEqual(encounter.indexOf("missing"), -1);
    });

    t.test("empty or duplicate combatants are rejected", function () {
      t.assertThrows(function () {
        return new Encounter({ combatants: [] });
      }, "empty encounter");

      t.assertThrows(function () {
        return new Encounter({
          combatants: [makeCombatant("a", 10), makeCombatant("a", 5)],
        });
      }, "duplicate ids");
    });

    // ------------------------------------------------------ defeated combatants

    t.test("defeated combatants are skipped by the turn cycle", function () {
      const a = makeCombatant("a", 30);
      const b = makeCombatant("b", 20);
      const c = makeCombatant("c", 10);
      const encounter = new Encounter({ combatants: [a, b, c] });
      encounter.startEncounter();

      b.takeDamage(b.maxHP);

      const turn = encounter.nextTurn();
      t.assertEqual(turn.active.id, "c");
      t.assertEqual(turn.previous.id, "a");
      t.assertEqual(turn.wrapped, false);
      t.assertEqual(encounter.activeCombatantIndex, 2);

      const wrap = encounter.nextTurn();
      t.assertEqual(wrap.active.id, "a");
      t.assertEqual(wrap.round, 2);
      t.assertEqual(wrap.wrapped, true);
    });

    t.test("startEncounter skips a defeated first combatant", function () {
      const a = makeCombatant("a", 30);
      const b = makeCombatant("b", 20);
      const c = makeCombatant("c", 10, { alliance: "enemy" });
      a.takeDamage(a.maxHP);

      const encounter = new Encounter({ combatants: [a, b, c] });
      const active = encounter.startEncounter();

      t.assertEqual(active.id, "b");
      t.assertEqual(encounter.activeCombatantIndex, 1);
      t.assertEqual(encounter.isOver, false);
    });

    t.test("defeating the active combatant still advances past it", function () {
      const a = makeCombatant("a", 30);
      const b = makeCombatant("b", 20);
      const c = makeCombatant("c", 10);
      const encounter = new Encounter({ combatants: [a, b, c] });
      encounter.startEncounter();

      t.assertEqual(encounter.nextTurn().active.id, "b");
      b.takeDamage(b.maxHP); // b dies during its own turn
      t.assertEqual(encounter.nextTurn().active.id, "c");
    });

    t.test("all defeated combatants end the encounter", function () {
      const a = makeCombatant("a", 20);
      const b = makeCombatant("b", 10);
      a.takeDamage(a.maxHP);
      b.takeDamage(b.maxHP);

      const encounter = new Encounter({ combatants: [a, b] });
      const active = encounter.startEncounter();

      t.assertEqual(active, null);
      t.assertEqual(encounter.activeCombatant, null);
      t.assertEqual(encounter.isOver, true);

      const turn = encounter.nextTurn();
      t.assertEqual(turn.active, null);
      t.assertEqual(encounter.isOver, true);
    });

    t.test("combat ends when only one alliance remains", function () {
      const a = makeCombatant("a", 30, { alliance: "player" });
      const b = makeCombatant("b", 20, { alliance: "enemy" });
      const c = makeCombatant("c", 10, { alliance: "enemy" });
      const encounter = new Encounter({ combatants: [a, b, c] });
      encounter.startEncounter();

      t.assertEqual(encounter.isOver, false, "two alliances are still fighting");

      a.takeDamage(a.maxHP); // the player side is wiped
      t.assertEqual(encounter.isOver, true, "no opposition remains");

      // The surviving enemy side keeps its turn cycle but the encounter is over.
      const living = encounter.livingCombatants;
      t.assertEqual(living.length, 2);
      t.assertTrue(living.every(function (combatant) {
        return combatant.alliance === "enemy";
      }));
    });
    t.test("nextTurn forwards die callbacks and reports persistent damage", function () {
      const a = makeCombatant("a", 20, { maxHP: 20 });
      const b = makeCombatant("b", 10, { maxHP: 20 });
      a.addPersistentDamage({ formula: "1d6", type: "fire" });

      const encounter = new Encounter({ combatants: [a, b] });
      encounter.startEncounter();

      const turn = encounter.nextTurn({
        rollDie: function () {
          return 4;
        },
        rollD20: function () {
          return 16;
        },
      });

      t.assertEqual(turn.previous.id, "a");
      t.assertEqual(turn.persistentTick.combatantId, "a");
      t.assertEqual(turn.persistentTick.events.length, 1);
      t.assertEqual(turn.persistentTick.events[0].damageDealt, 4);
      t.assertEqual(turn.persistentTick.events[0].recovery.passed, true);
      t.assertEqual(a.currentHP, 16);
      t.assertTrue(!a.hasPersistentDamage("fire"));
    });
  };
});
