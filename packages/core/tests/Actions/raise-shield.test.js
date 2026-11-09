/**
 * Session 5.4 — Raise a Shield: action cost, condition application, and AC.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Actions/raise-shield.js"),
      require("../../src/Core/Rules/modifiers.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Actions — Raise a Shield",
      register: factory(
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Actions.RaiseShield,
        root.PF2e.Core.Rules.Modifiers,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Combatant,
  RaiseShield,
  Modifiers,
) {
  "use strict";

  if (!Combatant || !RaiseShield || !Modifiers) {
    throw new Error("Raise a Shield tests require Combatant, RaiseShield and Modifiers.");
  }

  function makeCombatant(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "valeros",
          name: "Valeros",
          alliance: "player",
          initiative: 18,
          x: 3,
          y: 7,
          speedFeet: 25,
          maxActions: 3,
          maxHP: 20,
          ac: 18,
          attackBonus: 9,
          damage: "1d8+4",
          agile: false,
        },
        overrides || {},
      ),
    );
  }

  return function registerRaiseShieldTests(t) {
    t.test("Raise a Shield spends 1 action and grants +2 circumstance AC", function () {
      const combatant = makeCombatant();

      const result = RaiseShield.performRaiseShield({ combatant: combatant });

      t.assertTrue(result.ok);
      t.assertEqual(result.actionsLeft, 2);
      t.assertEqual(combatant.actionsRemaining, 2);
      t.assertTrue(combatant.hasCondition("shield-raised"));
      t.assertEqual(combatant.getCondition("shield-raised").label, "Shield Raised");

      const modifiers = combatant.getConditionModifiers("ac");
      t.assertEqual(modifiers.length, 1);
      t.assertEqual(modifiers[0].name, "Shield Raised");
      t.assertEqual(modifiers[0].type, "circumstance");
      t.assertEqual(modifiers[0].value, 2);
      t.assertEqual(modifiers[0].source, "shield-raised");

      const resolved = Modifiers.resolveModifiers(combatant.ac, modifiers);
      t.assertEqual(resolved.total, 20);
      t.assertEqual(resolved.bonusTotal, 2);
    });

    t.test("raising the shield again spends another action without stacking", function () {
      const combatant = makeCombatant();

      RaiseShield.performRaiseShield({ combatant: combatant });
      const second = RaiseShield.performRaiseShield({ combatant: combatant });

      t.assertTrue(second.ok);
      t.assertEqual(second.actionsLeft, 1);
      t.assertEqual(combatant.actionsRemaining, 1);
      t.assertEqual(combatant.getConditions().length, 1);

      const modifiers = combatant.getConditionModifiers("ac");
      t.assertEqual(modifiers.length, 1);
      t.assertEqual(
        Modifiers.resolveModifiers(combatant.ac, modifiers).total,
        20,
        "the circumstance bonus does not stack with itself",
      );
    });

    t.test("a shield-raised bonus is AC-only", function () {
      const combatant = makeCombatant();
      RaiseShield.performRaiseShield({ combatant: combatant });

      t.assertEqual(combatant.getConditionModifiers("ac").length, 1);
      t.assertEqual(combatant.getConditionModifiers("attack").length, 0);
      t.assertEqual(combatant.getConditionModifiers("check").length, 0);
    });

    t.test("Raise a Shield fails without actions and changes no state", function () {
      const combatant = makeCombatant({ actionsRemaining: 0 });

      const result = RaiseShield.performRaiseShield({ combatant: combatant });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, RaiseShield.RAISE_SHIELD_REASONS.NO_ACTIONS);
      t.assertEqual(result.reason, "no-actions");
      t.assertEqual(combatant.actionsRemaining, 0);
      t.assertTrue(!combatant.hasCondition("shield-raised"));
    });

    t.test("Raise a Shield rejects a combatant without an action pool", function () {
      t.assertThrows(function () {
        RaiseShield.performRaiseShield({ combatant: {} });
      }, "missing action pool");
    });
  };
});
