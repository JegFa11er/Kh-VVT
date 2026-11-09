/**
 * Phase 11 — Ranged Combat, Range Increments, Volley, Reload & disruption.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Actions/strike.js"),
      require("../../src/Core/Actions/reload.js"),
      require("../../src/Core/Rules/weapon-traits.js"),
      require("../../src/Core/Rules/checks.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Actions — Ranged Combat & Reload",
      register: factory(
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Actions.Strike,
        root.PF2e.Core.Actions.Reload,
        root.PF2e.Core.Rules.WeaponTraits,
        root.PF2e.Core.Rules.Checks,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Combatant,
  Strike,
  Reload,
  WeaponTraits,
  Checks,
) {
  "use strict";

  if (!Combatant || !Strike || !Reload || !WeaponTraits || !Checks) {
    throw new Error(
      "Ranged tests require Combatant, Strike, Reload, WeaponTraits and Checks.",
    );
  }

  function makeCombatant(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "hero",
          name: "Hero",
          alliance: "player",
          initiative: 10,
          x: 0,
          y: 0,
          speedFeet: 25,
          maxActions: 3,
          maxHP: 50,
          ac: 10,
          attackBonus: 0,
          damage: "1d6",
          agile: false,
        },
        overrides || {},
      ),
    );
  }

  function makeEnemy(overrides) {
    return makeCombatant(
      Object.assign(
        {
          id: "enemy",
          name: "Enemy",
          alliance: "enemy",
          x: 1,
          y: 0,
          maxHP: 100,
          ac: 15,
        },
        overrides || {},
      ),
    );
  }

  function weapon(formula, type, extras) {
    return Object.assign(
      { formula: formula, type: type || "piercing" },
      extras || {},
    );
  }

  function d20(value) {
    return function () {
      return value;
    };
  }

  return function registerRangedStrikeTests(t) {
    // --------------------------------------------------------- weapon profile

    t.test("weapon profile parses rangeIncrement, reload and volley", function () {
      const archer = makeCombatant({
        weapon: weapon("1d6", "piercing", { rangeIncrement: 30 }),
      });
      t.assertEqual(archer.getRangeIncrement(), 30);
      t.assertEqual(archer.getReload(), 0);
      t.assertEqual(archer.getVolley(), null);
      t.assertTrue(archer.isRangedWeapon());
      t.assertTrue(archer.isLoaded);

      const crossbow = makeCombatant({
        weapon: weapon("1d8", "piercing", {
          rangeIncrement: 60,
          reload: 1,
          volley: 30,
        }),
      });
      t.assertEqual(crossbow.getRangeIncrement(), 60);
      t.assertEqual(crossbow.getReload(), 1);
      t.assertEqual(crossbow.getVolley(), 30);
      t.assertTrue(crossbow.requiresReload());

      const melee = makeCombatant({
        weapon: weapon("1d8", "slashing", { traits: ["reach"] }),
      });
      t.assertEqual(melee.getRangeIncrement(), null);
      t.assertEqual(melee.getReload(), 0);
      t.assertEqual(melee.getVolley(), null);
      t.assertTrue(!melee.isRangedWeapon());
    });

    t.test("ranged-30, thrown-20, volley-30 and reload-1 traits are parsed", function () {
      const ranged = WeaponTraits.getWeaponProfile({
        formula: "1d6",
        type: "piercing",
        traits: ["ranged-30", "reload-1", "volley-15"],
      });
      t.assertEqual(ranged.rangeIncrement, 30);
      t.assertEqual(ranged.reload, 1);
      t.assertEqual(ranged.volley, 15);
      t.assertTrue(ranged.isRanged);

      const thrown = WeaponTraits.getWeaponProfile({
        formula: "1d6",
        type: "piercing",
        traits: ["thrown-20"],
      });
      t.assertEqual(thrown.rangeIncrement, 20);
      t.assertEqual(thrown.reload, 0);
      t.assertTrue(thrown.isRanged);

      const rangeProperty = WeaponTraits.getWeaponProfile({
        formula: "1d8",
        type: "piercing",
        range: "30 ft",
      });
      t.assertEqual(rangeProperty.rangeIncrement, 30);
      t.assertTrue(rangeProperty.isRanged);
    });

    // -------------------------------------------------------- range penalties

    t.test("range increment penalties: 0 then -2 per additional increment", function () {
      const archer = makeCombatant({
        attackBonus: 10,
        weapon: weapon("1d6", "piercing", { rangeIncrement: 30 }),
      });
      const targetClose = makeEnemy({ id: "t1", x: 4, y: 0, ac: 15 }); // 20 ft
      const targetFar = makeEnemy({ id: "t2", x: 10, y: 0, ac: 15 }); // 50 ft

      const evalClose = Strike.evaluateStrike({
        attacker: archer,
        target: targetClose,
      });
      const evalFar = Strike.evaluateStrike({
        attacker: archer,
        target: targetFar,
      });

      t.assertTrue(evalClose.ok);
      t.assertTrue(evalFar.ok);
      t.assertEqual(evalClose.rangePenalty || 0, 0);
      t.assertEqual(evalFar.rangePenalty, -2);

      // Boundary sweep: 30 / 35 / 60 / 65 ft.
      const atThirty = Strike.evaluateStrike({
        attacker: archer,
        target: makeEnemy({ id: "t30", x: 6, y: 0 }),
      });
      const atThirtyFive = Strike.evaluateStrike({
        attacker: archer,
        target: makeEnemy({ id: "t35", x: 7, y: 0 }),
      });
      const atSixty = Strike.evaluateStrike({
        attacker: archer,
        target: makeEnemy({ id: "t60", x: 12, y: 0 }),
      });
      const atSixtyFive = Strike.evaluateStrike({
        attacker: archer,
        target: makeEnemy({ id: "t65", x: 13, y: 0 }),
      });

      t.assertEqual(atThirty.rangePenalty, 0);
      t.assertEqual(atThirtyFive.rangePenalty, -2);
      t.assertEqual(atSixty.rangePenalty, -2);
      t.assertEqual(atSixtyFive.rangePenalty, -4);
    });

    t.test("range is capped at six increments", function () {
      const archer = makeCombatant({
        attackBonus: 10,
        weapon: weapon("1d6", "piercing", { rangeIncrement: 30 }),
      });

      const sixth = Strike.evaluateStrike({
        attacker: archer,
        target: makeEnemy({ id: "sixth", x: 36, y: 0 }), // 180 ft
      });
      const beyond = Strike.evaluateStrike({
        attacker: archer,
        target: makeEnemy({ id: "beyond", x: 37, y: 0 }), // 185 ft
      });

      t.assertTrue(sixth.ok);
      t.assertEqual(sixth.rangePenalty, -10);
      t.assertEqual(beyond.ok, false);
      t.assertEqual(beyond.reason, Strike.STRIKE_REASONS.OUT_OF_RANGE);
    });

    t.test("Volley imposes -2 inside its listed range and nothing outside", function () {
      const sniper = makeCombatant({
        attackBonus: 10,
        weapon: weapon("1d8", "piercing", {
          rangeIncrement: 60,
          volley: 30,
        }),
      });
      const targetTooClose = makeEnemy({ id: "close", x: 4, y: 0 }); // 20 ft
      const targetOutside = makeEnemy({ id: "outside", x: 10, y: 0 }); // 50 ft
      const targetEdge = makeEnemy({ id: "edge", x: 6, y: 0 }); // 30 ft

      const evalTooClose = Strike.evaluateStrike({
        attacker: sniper,
        target: targetTooClose,
      });
      const evalOutside = Strike.evaluateStrike({
        attacker: sniper,
        target: targetOutside,
      });
      const evalEdge = Strike.evaluateStrike({
        attacker: sniper,
        target: targetEdge,
      });

      t.assertEqual(evalTooClose.volleyPenalty, -2);
      t.assertEqual(evalOutside.volleyPenalty, 0);
      t.assertEqual(evalEdge.volleyPenalty, -2);
    });

    t.test("range and volley penalties both reach the attack resolver", function () {
      const sniper = makeCombatant({
        attackBonus: 10,
        weapon: weapon("1d8", "piercing", {
          rangeIncrement: 30,
          volley: 30,
        }),
      });
      const target = makeEnemy({ id: "far", x: 10, y: 0, ac: 15 }); // 50 ft

      const result = Strike.performStrike({
        attacker: sniper,
        target: target,
        rollD20: d20(10),
        rollDamageDie: function () {
          return 1;
        },
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.rangePenalty, -2);
      t.assertEqual(result.volleyPenalty, 0);
      t.assertTrue(
        result.attackModifiers.some(function (modifier) {
          return modifier.source === "range-increment" && modifier.value === -2;
        }),
      );
    });

    // ---------------------------------------------------------------- reload

    t.test("a crossbow must be reloaded after firing", function () {
      const xbowman = makeCombatant({
        id: "xbow",
        x: 0,
        y: 0,
        actionsRemaining: 3,
        weapon: weapon("1d8", "piercing", {
          rangeIncrement: 60,
          reload: 1,
        }),
      });
      const target = makeEnemy({ id: "t1", x: 4, y: 0, ac: 10, maxHP: 100 });

      const shot1 = Strike.performStrike({
        attacker: xbowman,
        target: target,
        rollD20: d20(15),
        rollDamageDie: function () {
          return 1;
        },
      });
      t.assertTrue(shot1.ok);
      t.assertTrue(!xbowman.isLoaded);
      t.assertEqual(xbowman.actionsRemaining, 2);

      const shot2 = Strike.performStrike({
        attacker: xbowman,
        target: target,
        rollD20: d20(15),
      });
      t.assertEqual(shot2.ok, false);
      t.assertEqual(shot2.reason, Strike.STRIKE_REASONS.NOT_LOADED);
      t.assertEqual(xbowman.actionsRemaining, 2, "an empty weapon spends nothing");

      const reload = Reload.performReload({ combatant: xbowman });
      t.assertTrue(reload.ok);
      t.assertEqual(reload.actionsSpent, 1);
      t.assertEqual(xbowman.isLoaded, true);
      t.assertEqual(xbowman.actionsRemaining, 1);
    });

    t.test("a reload-2 weapon spends two actions and stays empty without enough", function () {
      const heavy = makeCombatant({
        id: "heavy",
        actionsRemaining: 2,
        weapon: weapon("1d10", "piercing", {
          rangeIncrement: 60,
          reload: 2,
        }),
        isLoaded: false,
      });

      const reload = Reload.performReload({ combatant: heavy });
      t.assertTrue(reload.ok);
      t.assertEqual(reload.actionsSpent, 2);
      t.assertEqual(heavy.actionsRemaining, 0);
      t.assertTrue(heavy.isLoaded);

      const tired = makeCombatant({
        id: "tired",
        actionsRemaining: 1,
        weapon: weapon("1d10", "piercing", {
          rangeIncrement: 60,
          reload: 2,
        }),
        isLoaded: false,
      });
      const failed = Reload.performReload({ combatant: tired });
      t.assertEqual(failed.ok, false);
      t.assertEqual(failed.reason, Reload.RELOAD_REASONS.NO_ACTIONS);
      t.assertTrue(!tired.isLoaded);
      t.assertEqual(tired.actionsRemaining, 1);
    });

    t.test("reload-0 weapons (bows and thrown) never discharge", function () {
      const archer = makeCombatant({
        id: "bowman",
        attackBonus: 10,
        weapon: weapon("1d8", "piercing", {
          rangeIncrement: 60,
          reload: 0,
        }),
      });
      const target = makeEnemy({ id: "t1", x: 4, y: 0, ac: 10 });

      const shot = Strike.performStrike({
        attacker: archer,
        target: target,
        rollD20: d20(10),
        rollDamageDie: function () {
          return 1;
        },
      });

      t.assertTrue(shot.ok);
      t.assertTrue(archer.isLoaded);
      t.assertTrue(!archer.requiresReload());
    });

    t.test("an empty weapon reports not-loaded even if the target fell", function () {
      const xbowman = makeCombatant({
        id: "xbow",
        weapon: weapon("1d8", "piercing", {
          rangeIncrement: 60,
          reload: 1,
        }),
      });
      const fragile = makeEnemy({ id: "fragile", x: 4, y: 0, ac: 10, maxHP: 1 });

      const first = Strike.performStrike({
        attacker: xbowman,
        target: fragile,
        rollD20: d20(15),
        rollDamageDie: function () {
          return 5;
        },
      });
      t.assertTrue(first.ok);
      t.assertTrue(fragile.isDefeated);

      const second = Strike.performStrike({
        attacker: xbowman,
        target: fragile,
        rollD20: d20(15),
      });
      t.assertEqual(second.ok, false);
      t.assertEqual(second.reason, Strike.STRIKE_REASONS.NOT_LOADED);
    });

    // ------------------------------------------------- reactive strike disruption

    t.test("a critical Reactive Strike disrupts a ranged shot", function () {
      const shooter = makeCombatant({
        id: "shooter",
        x: 0,
        y: 0,
        maxHP: 50,
        attackBonus: 10,
        weapon: weapon("1d8", "piercing", {
          rangeIncrement: 60,
          reload: 1,
        }),
      });
      const target = makeEnemy({ id: "target", x: 10, y: 0, maxHP: 100, ac: 15 });
      const guard = makeEnemy({
        id: "guard",
        x: 1,
        y: 0,
        maxHP: 10,
        attackBonus: 20,
        damage: "1d6+2",
      });

      const result = Strike.performStrike({
        attacker: shooter,
        target: target,
        combatants: [shooter, target, guard],
        rollD20: d20(10),
        rollReactionD20: d20(20),
        rollDamageDie: function () {
          return 5;
        },
        rollReactionDamageDie: function () {
          return 1;
        },
      });

      t.assertEqual(result.ok, false);
      t.assertTrue(result.disrupted);
      t.assertEqual(result.reason, Strike.STRIKE_REASONS.DISRUPTED);
      t.assertEqual(result.reactionStrikes.length, 1);
      t.assertTrue(result.reactionStrike.critical);
      t.assertEqual(target.currentHP, 100, "the shot never reaches the target");
      t.assertTrue(shooter.isLoaded, "disruption does not consume ammunition");
      t.assertEqual(shooter.actionsRemaining, 2);
      t.assertEqual(guard.reactionsRemaining, 0);
    });

    t.test("a non-critical Reactive Strike does not disrupt the shot", function () {
      const shooter = makeCombatant({
        id: "shooter",
        x: 0,
        y: 0,
        maxHP: 50,
        attackBonus: 10,
        weapon: weapon("1d8", "piercing", {
          rangeIncrement: 60,
          reload: 1,
        }),
      });
      const target = makeEnemy({ id: "target", x: 10, y: 0, maxHP: 100, ac: 15 });
      const guard = makeEnemy({
        id: "guard",
        x: 1,
        y: 0,
        maxHP: 10,
        attackBonus: 0,
        damage: "1d6+2",
      });

      const result = Strike.performStrike({
        attacker: shooter,
        target: target,
        combatants: [shooter, target, guard],
        rollD20: d20(10),
        rollReactionD20: d20(10),
        rollDamageDie: function () {
          return 5;
        },
        rollReactionDamageDie: function () {
          return 1;
        },
      });

      t.assertTrue(result.ok);
      t.assertTrue(!result.disrupted);
      t.assertEqual(result.reactionStrikes.length, 1);
      t.assertTrue(result.hit);
      t.assertEqual(target.currentHP, 95, "the shot still resolves");
      t.assertTrue(!shooter.isLoaded);
      t.assertEqual(guard.reactionsRemaining, 0);
    });

    t.test("a threatening enemy without a reaction does not disrupt", function () {
      const shooter = makeCombatant({
        id: "shooter",
        x: 0,
        y: 0,
        attackBonus: 10,
        weapon: weapon("1d8", "piercing", { rangeIncrement: 60 }),
      });
      const target = makeEnemy({ id: "target", x: 10, y: 0, maxHP: 100, ac: 15 });
      const spent = makeEnemy({
        id: "spent",
        x: 1,
        y: 0,
        attackBonus: 20,
        damage: "1d6+2",
        reactionsRemaining: 0,
      });

      const result = Strike.performStrike({
        attacker: shooter,
        target: target,
        combatants: [shooter, target, spent],
        rollD20: d20(10),
        rollDamageDie: function () {
          return 5;
        },
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.reactionStrikes.length, 0);
      t.assertTrue(result.hit);
    });
  };
});
