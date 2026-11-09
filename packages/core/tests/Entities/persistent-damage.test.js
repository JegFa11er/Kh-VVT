/**
 * Phase 7.2 — PF2e Remastered persistent damage.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Entities/persistent-damage.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Entities — Persistent Damage",
      register: factory(
        root.PF2e.Core.Combatant,
        root.PF2e.Core.PersistentDamage,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Combatant,
  PersistentDamage,
) {
  "use strict";

  if (!Combatant || !PersistentDamage) {
    throw new Error("Persistent damage tests require Combatant and PersistentDamage.");
  }

  function makeCombatant(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "goblin",
          name: "Goblin",
          alliance: "enemy",
          initiative: 10,
          x: 0,
          y: 0,
          speedFeet: 25,
          maxActions: 3,
          maxHP: 20,
          ac: 16,
          attackBonus: 8,
          damage: "1d6+1",
          agile: true,
        },
        overrides || {},
      ),
    );
  }

  return function registerPersistentDamageTests(t) {
    t.test("adds a persistent damage instance with a stable id", function () {
      const goblin = makeCombatant();

      const added = goblin.addPersistentDamage({ formula: "1d6", type: "fire" });

      t.assertTrue(added.added);
      t.assertTrue(!added.replaced);
      t.assertEqual(added.instance.id, "persistent-fire");
      t.assertEqual(added.instance.formula, "1d6");
      t.assertEqual(added.instance.type, "fire");
      t.assertEqual(goblin.persistentDamage.length, 1);
      t.assertTrue(goblin.hasPersistentDamage("fire"));
      t.assertTrue(!goblin.hasPersistentDamage("bleed"));
    });

    t.test("same-type persistent damage does not stack and keeps the stronger formula", function () {
      const goblin = makeCombatant();

      goblin.addPersistentDamage({ formula: "1d4", type: "fire" });
      const upgrade = goblin.addPersistentDamage({ formula: "1d6", type: "fire" });

      t.assertEqual(goblin.persistentDamage.length, 1);
      t.assertTrue(upgrade.replaced);
      t.assertEqual(goblin.persistentDamage[0].formula, "1d6");
      t.assertEqual(goblin.persistentDamage[0].id, "persistent-fire");

      const weaker = goblin.addPersistentDamage({ formula: "1d4", type: "fire" });
      t.assertTrue(weaker.keptExisting);
      t.assertEqual(goblin.persistentDamage.length, 1);
      t.assertEqual(goblin.persistentDamage[0].formula, "1d6");
    });

    t.test("different damage types coexist and are removed independently", function () {
      const goblin = makeCombatant();

      goblin.addPersistentDamage({ formula: "1d6", type: "fire" });
      goblin.addPersistentDamage({ formula: "1d4", type: "bleed" });

      t.assertEqual(goblin.persistentDamage.length, 2);
      t.assertTrue(goblin.hasPersistentDamage("fire"));
      t.assertTrue(goblin.hasPersistentDamage("bleed"));
      t.assertTrue(goblin.hasPersistentDamage());

      t.assertTrue(goblin.removePersistentDamage("fire"));
      t.assertTrue(!goblin.hasPersistentDamage("fire"));
      t.assertTrue(goblin.hasPersistentDamage("bleed"));
      t.assertEqual(goblin.persistentDamage.length, 1);

      t.assertTrue(goblin.removePersistentDamage("persistent-bleed"));
      t.assertEqual(goblin.persistentDamage.length, 0);
      t.assertTrue(!goblin.removePersistentDamage("bleed"));
    });

    t.test("getPersistentDamage returns defensive copies", function () {
      const goblin = makeCombatant();
      goblin.addPersistentDamage({ formula: "1d6", type: "fire" });

      const copy = goblin.getPersistentDamage();
      copy[0].formula = "9d12";

      t.assertEqual(goblin.persistentDamage[0].formula, "1d6");
    });

    t.test("formulaWeight compares average damage for same-type upgrades", function () {
      t.assertEqual(PersistentDamage.formulaWeight("1d4"), 2.5);
      t.assertEqual(PersistentDamage.formulaWeight("1d6"), 3.5);
      t.assertEqual(PersistentDamage.formulaWeight("2d6+2"), 9);
    });

    t.test("endTurn rolls persistent damage and applies the target's IWR", function () {
      const goblin = makeCombatant({
        maxHP: 20,
        weaknesses: [{ type: "fire", value: 2 }],
      });
      goblin.addPersistentDamage({ formula: "1d6", type: "fire" });

      const result = goblin.endTurn({
        rollDie: function () {
          return 4;
        },
        rollD20: function () {
          return 10;
        },
      });

      const tick = result.persistentTick;
      t.assertTrue(tick.changed);
      t.assertEqual(tick.events.length, 1);

      const event = tick.events[0];
      t.assertEqual(event.formula, "1d6");
      t.assertEqual(event.type, "fire");
      t.assertEqual(event.amount, 4);
      t.assertEqual(event.iwr.totalDamage, 6, "4 fire + 2 weakness");
      t.assertEqual(event.damageDealt, 6);
      t.assertEqual(event.hpBefore, 20);
      t.assertEqual(event.hpAfter, 14);
      t.assertEqual(goblin.currentHP, 14);

      t.assertDeepEqual(event.recovery, { passed: false, d20: 10, dc: 15 });
      t.assertTrue(!event.removed);
      t.assertTrue(goblin.hasPersistentDamage("fire"));
    });

    t.test("a recovery flat check at DC 15 removes the instance on a pass", function () {
      const goblin = makeCombatant({ maxHP: 20 });
      goblin.addPersistentDamage({ formula: "1d6", type: "fire" });

      const result = goblin.endTurn({
        rollDie: function () {
          return 3;
        },
        rollD20: function () {
          return 15;
        },
      });

      const event = result.persistentTick.events[0];
      t.assertTrue(event.recovery.passed);
      t.assertEqual(event.recovery.d20, 15);
      t.assertEqual(event.recovery.dc, 15);
      t.assertTrue(event.removed);
      t.assertTrue(!goblin.hasPersistentDamage("fire"));
      t.assertEqual(goblin.currentHP, 17, "damage is dealt before the recovery check");
    });

    t.test("a recovery roll of 14 fails and keeps the persistent damage", function () {
      const goblin = makeCombatant();
      goblin.addPersistentDamage({ formula: "1d4", type: "bleed" });

      const result = goblin.endTurn({
        rollDie: function () {
          return 2;
        },
        rollD20: function () {
          return 14;
        },
      });

      t.assertTrue(!result.persistentTick.events[0].recovery.passed);
      t.assertTrue(goblin.hasPersistentDamage("bleed"));
    });

    t.test("different types roll separately and each gets its own DC 15 check", function () {
      const goblin = makeCombatant({ maxHP: 30 });
      goblin.addPersistentDamage({ formula: "1d6", type: "fire" });
      goblin.addPersistentDamage({ formula: "1d4", type: "bleed" });

      const recoveryRolls = [14, 15];
      let damageRolls = 0;
      let recoveryIndex = 0;

      const result = goblin.endTurn({
        rollDie: function (sides) {
          damageRolls += 1;
          return sides === 6 ? 3 : 2;
        },
        rollD20: function () {
          const value = recoveryRolls[recoveryIndex];
          recoveryIndex += 1;
          return value;
        },
      });

      t.assertEqual(damageRolls, 2, "one damage die per type");
      t.assertEqual(recoveryIndex, 2, "one recovery check per type");
      t.assertEqual(result.persistentTick.events.length, 2);

      const fire = result.persistentTick.events[0];
      const bleed = result.persistentTick.events[1];
      t.assertEqual(fire.damageDealt, 3);
      t.assertTrue(!fire.removed);
      t.assertEqual(bleed.damageDealt, 2);
      t.assertTrue(bleed.removed);

      t.assertTrue(goblin.hasPersistentDamage("fire"));
      t.assertTrue(!goblin.hasPersistentDamage("bleed"));
      t.assertEqual(goblin.currentHP, 25);
    });

    t.test("immunity zeroes persistent damage but the recovery check still happens", function () {
      const goblin = makeCombatant({
        maxHP: 20,
        immunities: ["fire"],
      });
      goblin.addPersistentDamage({ formula: "1d6", type: "fire" });

      const result = goblin.endTurn({
        rollDie: function () {
          return 5;
        },
        rollD20: function () {
          return 16;
        },
      });

      const event = result.persistentTick.events[0];
      t.assertEqual(event.amount, 5);
      t.assertEqual(event.iwr.breakdown[0].immune, true);
      t.assertEqual(event.damageDealt, 0);
      t.assertEqual(goblin.currentHP, 20);
      t.assertTrue(event.removed);
    });

    t.test("a defeated creature takes no end-of-turn persistent damage", function () {
      const goblin = makeCombatant({ maxHP: 5 });
      goblin.addPersistentDamage({ formula: "1d6", type: "fire" });
      goblin.takeDamage(5);

      t.assertTrue(goblin.isDefeated);

      const result = goblin.endTurn({
        rollDie: function () {
          return 6;
        },
        rollD20: function () {
          return 1;
        },
      });

      t.assertEqual(result.persistentTick.events.length, 0);
      t.assertTrue(result.persistentTick.defeated);
    });

    t.test("persistentDamage can be authored in the constructor", function () {
      const goblin = makeCombatant({
        persistentDamage: [
          { formula: "1d4", type: "fire" },
          { formula: "1d6", type: "bleed" },
        ],
      });

      t.assertEqual(goblin.persistentDamage.length, 2);
      t.assertTrue(goblin.hasPersistentDamage("fire"));
      t.assertTrue(goblin.hasPersistentDamage("bleed"));
    });
  };
});
