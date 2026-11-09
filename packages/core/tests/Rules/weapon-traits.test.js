/**
 * Phase 7.3 — PF2e Remastered weapon traits: deadly, fatal, backstabber, reach.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Actions/strike.js"),
      require("../../src/Core/Actions/reactive-strike.js"),
      require("../../src/Core/Grid/flanking.js"),
      require("../../src/Core/Rules/checks.js"),
      require("../../src/Core/Rules/weapon-traits.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Rules — Weapon Traits & Reach",
      register: factory(
        root.PF2e.Core.GridMap,
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Actions.Strike,
        root.PF2e.Core.Actions.ReactiveStrike,
        root.PF2e.Core.Flanking,
        root.PF2e.Core.Rules.Checks,
        root.PF2e.Core.Rules.WeaponTraits,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  GridMap,
  Combatant,
  Strike,
  ReactiveStrike,
  Flanking,
  Checks,
  WeaponTraits,
) {
  "use strict";

  if (
    !GridMap ||
    !Combatant ||
    !Strike ||
    !ReactiveStrike ||
    !Flanking ||
    !Checks ||
    !WeaponTraits
  ) {
    throw new Error(
      "Weapon trait tests require GridMap, Combatant, Strike, ReactiveStrike, Flanking, Checks and WeaponTraits.",
    );
  }

  function makeCombatant(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "valeros",
          name: "Valeros",
          alliance: "player",
          initiative: 10,
          x: 0,
          y: 0,
          speedFeet: 25,
          maxActions: 3,
          maxHP: 100,
          ac: 10,
          attackBonus: 0,
          damage: { formula: "1d8+4", type: "slashing" },
          agile: false,
        },
        overrides || {},
      ),
    );
  }

  function map(cols, rows) {
    return new GridMap({ cols: cols || 7, rows: rows || 7 });
  }

  function weapon(formula, type, traits) {
    return { formula: formula, type: type, traits: traits || [] };
  }

  function d20(value) {
    return function () {
      return value;
    };
  }

  return function registerWeaponTraitTests(t) {
    // ----------------------------------------------------------- trait parsing

    t.test("trait authoring accepts slugs, spaced labels, and objects", function () {
      const traits = WeaponTraits.normalizeTraits([
        "reach",
        "backstabber",
        "deadly d8",
        { name: "fatal", die: "d10" },
      ]);

      t.assertEqual(traits.length, 4);
      t.assertEqual(traits[0].slug, "reach");
      t.assertEqual(traits[1].slug, "backstabber");
      t.assertEqual(traits[2].slug, "deadly-d8");
      t.assertEqual(traits[2].label, "deadly d8");
      t.assertEqual(traits[3].slug, "fatal-d10");
      t.assertEqual(traits[3].dieSize, 10);
      t.assertTrue(WeaponTraits.hasTrait(traits, "deadly"));
      t.assertTrue(WeaponTraits.hasTrait(traits, "fatal-d10"));
      t.assertTrue(!WeaponTraits.hasTrait(traits, "deadly-d12"));

      const mapForm = WeaponTraits.normalizeTraits({
        reach: true,
        backstabber: true,
        deadly: "d8",
        fatal: 10,
      });
      t.assertDeepEqual(
        mapForm.map(function (trait) {
          return trait.slug;
        }),
        ["reach", "backstabber", "deadly-d8", "fatal-d10"],
      );
    });

    t.test("Combatant exposes its weapon traits and 5/10 ft reach", function () {
      const plain = makeCombatant();
      const reach = makeCombatant({
        traits: ["reach", "deadly-d8"],
        damage: { formula: "1d8+4", type: "slashing" },
      });

      t.assertEqual(plain.getReachFeet(), 5);
      t.assertTrue(!plain.hasTrait("reach"));
      t.assertEqual(reach.getReachFeet(), 10);
      t.assertTrue(reach.hasTrait("reach"));
      t.assertTrue(reach.hasTrait("deadly"));
      t.assertEqual(reach.getTrait("deadly").dieSize, 8);
      t.assertDeepEqual(reach.getTraitLabels(), ["reach", "deadly d8"]);
    });

    // ---------------------------------------------------------------- deadly

    t.test("deadly adds one non-doubled die on a critical success", function () {
      const damage = WeaponTraits.calculateWeaponDamage({
        weapon: weapon("1d8+4", "slashing", ["deadly-d8"]),
        degree: Checks.DEGREES.CRITICAL_SUCCESS,
        rollDie: function (sides) {
          return sides === 8 ? 5 : 1;
        },
      });

      t.assertEqual(damage.baseTotal, 9, "1d8(5) + 4");
      t.assertEqual(damage.doubledBase, 18, "base is doubled");
      t.assertEqual(damage.deadly.dieSize, 8);
      t.assertEqual(damage.deadly.roll, 5);
      t.assertEqual(damage.extras.length, 1);
      t.assertEqual(damage.extras[0].kind, "deadly");
      t.assertEqual(damage.extras[0].doubled, false);
      t.assertEqual(damage.extrasTotal, 5);
      t.assertEqual(damage.total, 23, "18 doubled base + 5 deadly");
    });

    t.test("deadly does not add a die on a normal success", function () {
      const damage = WeaponTraits.calculateWeaponDamage({
        weapon: weapon("1d8+4", "slashing", ["deadly-d8"]),
        degree: Checks.DEGREES.SUCCESS,
        rollDie: function () {
          return 5;
        },
      });

      t.assertEqual(damage.deadly, null);
      t.assertEqual(damage.extrasTotal, 0);
      t.assertEqual(damage.total, 9);
    });

    t.test("fatal replaces the base die, doubles it, and adds a non-doubled fatal die", function () {
      const rolledSides = [];
      const damage = WeaponTraits.calculateWeaponDamage({
        weapon: weapon("1d8+4", "slashing", ["fatal-d10"]),
        degree: Checks.DEGREES.CRITICAL_SUCCESS,
        rollDie: function (sides) {
          rolledSides.push(sides);
          return sides === 10 ? 7 : 1;
        },
      });

      t.assertDeepEqual(rolledSides, [10, 10], "only d10 is rolled, never d8");
      t.assertEqual(damage.formula, "1d8+4");
      t.assertEqual(damage.effectiveFormula, "1d10+4");
      t.assertEqual(damage.dieSize, 10);
      t.assertDeepEqual(damage.rolls, [7]);
      t.assertEqual(damage.baseTotal, 11, "1d10(7) + 4");
      t.assertEqual(damage.doubledBase, 22);
      t.assertTrue(damage.fatal.replaced);
      t.assertEqual(damage.fatal.extraRoll, 7);
      t.assertEqual(damage.fatal.extraTotal, 7);
      t.assertEqual(damage.extras.length, 1);
      t.assertEqual(damage.extras[0].kind, "fatal");
      t.assertEqual(damage.extras[0].doubled, false);
      t.assertEqual(damage.total, 29, "22 doubled base + 7 fatal extra");
    });

    t.test("fatal does not replace the die on a normal success", function () {
      const damage = WeaponTraits.calculateWeaponDamage({
        weapon: weapon("1d8+4", "slashing", ["fatal-d10"]),
        degree: Checks.DEGREES.SUCCESS,
        rollDie: function (sides) {
          return sides === 8 ? 5 : 7;
        },
      });

      t.assertEqual(damage.dieSize, 8);
      t.assertEqual(damage.total, 9);
      t.assertEqual(damage.fatal, null);
    });

    // ------------------------------------------------------------ backstabber

    t.test("backstabber adds +1 on a normal hit against an Off-Guard target", function () {
      const damage = WeaponTraits.calculateWeaponDamage({
        weapon: weapon("1d6+2", "piercing", ["backstabber"]),
        degree: Checks.DEGREES.SUCCESS,
        isOffGuard: true,
        rollDie: function () {
          return 3;
        },
      });

      t.assertEqual(damage.baseTotal, 5);
      t.assertEqual(damage.backstabber, 1);
      t.assertEqual(damage.total, 6);
    });

    t.test("backstabber is +2 on a critical hit because it is doubled", function () {
      const offGuard = WeaponTraits.calculateWeaponDamage({
        weapon: weapon("1d6+2", "piercing", ["backstabber"]),
        degree: Checks.DEGREES.CRITICAL_SUCCESS,
        isOffGuard: true,
        rollDie: function () {
          return 3;
        },
      });
      const normal = WeaponTraits.calculateWeaponDamage({
        weapon: weapon("1d6+2", "piercing", ["backstabber"]),
        degree: Checks.DEGREES.CRITICAL_SUCCESS,
        isOffGuard: false,
        rollDie: function () {
          return 3;
        },
      });

      t.assertEqual(offGuard.backstabber, 1);
      t.assertEqual(offGuard.doubledBase, 12, "(5 + 1) x 2");
      t.assertEqual(offGuard.total, 12);
      t.assertEqual(normal.backstabber, 0);
      t.assertEqual(normal.total, 10, "5 x 2 without Off-Guard");
    });

    t.test("backstabber and deadly stack on a critical hit", function () {
      const damage = WeaponTraits.calculateWeaponDamage({
        weapon: weapon("1d6+2", "piercing", ["backstabber", "deadly-d10"]),
        degree: Checks.DEGREES.CRITICAL_SUCCESS,
        isOffGuard: true,
        rollDie: function (sides) {
          return sides === 10 ? 4 : 3;
        },
      });

      t.assertEqual(damage.doubledBase, 12, "(5 + 1) x 2");
      t.assertEqual(damage.extrasTotal, 4);
      t.assertEqual(damage.total, 16);
    });

    // ----------------------------------------------------------------- reach

    t.test("reach extends Strike range to 10 ft (2 cells)", function () {
      const plain = makeCombatant({ x: 0, y: 0, attackBonus: 0 });
      const reach = makeCombatant({ x: 0, y: 0, attackBonus: 0, traits: ["reach"] });
      const target = makeCombatant({
        id: "goblin",
        name: "Goblin",
        alliance: "enemy",
        x: 2,
        y: 0,
        maxHP: 50,
        ac: 10,
      });

      const withoutReach = Strike.evaluateStrike({
        attacker: plain,
        target: target,
        map: map(),
      });
      const withReach = Strike.evaluateStrike({
        attacker: reach,
        target: target,
        map: map(),
      });

      t.assertTrue(!withoutReach.ok);
      t.assertEqual(withoutReach.reason, Strike.STRIKE_REASONS.OUT_OF_REACH);
      t.assertTrue(withReach.ok);
      t.assertEqual(withReach.distanceFeet, 10);
      t.assertEqual(withReach.reachFeet, 10);

      const result = Strike.performStrike({
        attacker: reach,
        target: target,
        map: map(),
        rollD20: d20(10),
        rollDamageDie: function () {
          return 5;
        },
      });
      t.assertTrue(result.ok);
      t.assertTrue(result.hit);
      t.assertEqual(result.reachFeet, 10);
      t.assertEqual(target.currentHP, 41);
    });

    t.test("reach threatens a cell 10 ft away for Reactive Strike", function () {
      const mover = makeCombatant({ id: "valeros", x: 2, y: 2 });
      const plain = makeCombatant({
        id: "goblin",
        name: "Goblin",
        alliance: "enemy",
        x: 0,
        y: 2,
        traits: [],
      });
      const reach = makeCombatant({
        id: "goblin",
        name: "Goblin",
        alliance: "enemy",
        x: 0,
        y: 2,
        attackBonus: 20,
        traits: ["reach"],
      });

      const plainThreats = ReactiveStrike.findThreatenedEnemies({
        mover: mover,
        cell: { x: 2, y: 2 },
        combatants: [mover, plain],
      });
      const reachThreats = ReactiveStrike.findThreatenedEnemies({
        mover: mover,
        cell: { x: 2, y: 2 },
        combatants: [mover, reach],
      });

      t.assertEqual(plainThreats.length, 0);
      t.assertEqual(reachThreats.length, 1);
      t.assertEqual(reachThreats[0].id, "goblin");

      const reaction = ReactiveStrike.performReactiveStrike({
        attacker: reach,
        target: mover,
        map: map(),
        combatants: [mover, reach],
        rollD20: d20(10),
        rollDamageDie: function () {
          return 1;
        },
      });

      t.assertTrue(reaction.ok);
      t.assertTrue(reaction.hit);
      t.assertEqual(reaction.reachFeet, 10);
      t.assertEqual(reach.reactionsRemaining, 0);
    });

    t.test("reach weapons can flank from 10 ft when the opposite-side geometry holds", function () {
      const target = {
        id: "target",
        alliance: "enemy",
        x: 5,
        y: 5,
        isDefeated: false,
      };
      const reachWest = {
        id: "west",
        alliance: "player",
        x: 3,
        y: 5,
        traits: ["reach"],
      };
      const reachEast = {
        id: "east",
        alliance: "player",
        x: 7,
        y: 5,
        traits: ["reach"],
      };
      const plainAdjacentEast = {
        id: "east-plain",
        alliance: "player",
        x: 6,
        y: 5,
        traits: [],
      };
      const plainFarEast = {
        id: "east-far",
        alliance: "player",
        x: 7,
        y: 5,
        traits: [],
      };

      t.assertTrue(Flanking.isFlanked(target, reachWest, [reachWest, reachEast], map(10, 10)));
      t.assertTrue(
        Flanking.isFlanked(
          target,
          reachWest,
          [reachWest, plainAdjacentEast],
          map(10, 10),
        ),
      );
      t.assertTrue(
        !Flanking.isFlanked(
          target,
          reachWest,
          [reachWest, plainFarEast],
          map(10, 10),
        ),
      );
      t.assertTrue(
        !Flanking.isFlanked(
          target,
          { id: "west-far", alliance: "player", x: 3, y: 5, traits: [] },
          [
            { id: "west-far", alliance: "player", x: 3, y: 5, traits: [] },
            reachEast,
          ],
          map(10, 10),
        ),
      );
    });

    t.test("Strike applies authored weapon traits and backstabber to Off-Guard targets", function () {
      const attacker = makeCombatant({
        x: 0,
        y: 0,
        attackBonus: 20,
        traits: ["backstabber", "deadly-d8"],
      });
      const target = makeCombatant({
        id: "goblin",
        name: "Goblin",
        alliance: "enemy",
        x: 1,
        y: 0,
        maxHP: 100,
        ac: 10,
      });
      target.addCondition("off-guard");

      const result = Strike.performStrike({
        attacker: attacker,
        target: target,
        map: map(),
        rollD20: d20(10),
        rollDamageDie: function (sides) {
          return sides === 8 ? 5 : 1;
        },
      });

      t.assertEqual(result.degree, Checks.DEGREES.CRITICAL_SUCCESS);
      t.assertTrue(result.offGuard);
      t.assertEqual(result.damage.baseTotal, 9);
      t.assertEqual(result.damage.backstabber, 1);
      t.assertEqual(result.damage.doubledBase, 20, "(9 + 1) x 2");
      t.assertEqual(result.damage.deadly.total, 5);
      t.assertEqual(result.damage.total, 25);
      t.assertEqual(result.damageDealt, 25);
      t.assertEqual(target.currentHP, 75);
    });

    t.test("Prone counts as Off-Guard for backstabber", function () {
      const attacker = makeCombatant({
        x: 0,
        y: 0,
        attackBonus: 20,
        traits: ["backstabber"],
      });
      const target = makeCombatant({
        id: "goblin",
        name: "Goblin",
        alliance: "enemy",
        x: 1,
        y: 0,
        maxHP: 100,
        ac: 10,
      });
      target.addCondition("prone");

      const result = Strike.performStrike({
        attacker: attacker,
        target: target,
        map: map(),
        rollD20: d20(10),
        rollDamageDie: function () {
          return 5;
        },
      });

      t.assertTrue(result.offGuard);
      t.assertEqual(result.targetAC, 8, "10 AC - 2 Off-Guard (Prone)");
      t.assertEqual(result.damage.backstabber, 1);
      t.assertEqual(result.damage.doubledBase, 20, "(9 + 1) x 2");
      t.assertEqual(result.damage.total, 20);
    });

    t.test("failure degrees return no weapon damage", function () {
      t.assertEqual(
        WeaponTraits.calculateWeaponDamage({
          weapon: weapon("1d8+4", "slashing", ["deadly-d8"]),
          degree: Checks.DEGREES.FAILURE,
          rollDie: function () {
            return 1;
          },
        }),
        null,
      );
    });
  };
});
