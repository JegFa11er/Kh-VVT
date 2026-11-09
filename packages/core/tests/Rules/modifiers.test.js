/**
 * Phase 4 — PF2e Remastered modifier stacking.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../../src/Core/Rules/modifiers.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Rules — Modifier Stacking",
      register: factory(root.PF2e.Core.Rules.Modifiers),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Modifiers) {
  "use strict";

  if (!Modifiers) {
    throw new Error("Modifier tests require the Modifiers module.");
  }

  return function registerModifierTests(t) {
    t.test("same-type status bonuses do not stack: keep the highest", function () {
      const result = Modifiers.resolveModifiers(10, [
        { name: "Bless", type: "status", value: 1, source: "bless" },
        { name: "Heroism", type: "status", value: 2, source: "heroism" },
      ]);

      t.assertEqual(result.total, 12);
      t.assertEqual(result.bonusTotal, 2);
      t.assertEqual(result.penaltyTotal, 0);
      t.assertEqual(result.effectiveModifiers.length, 1);
      t.assertEqual(result.effectiveModifiers[0].value, 2);
    });

    t.test("same-type status penalties do not stack: keep the worst", function () {
      const result = Modifiers.resolveModifiers(10, [
        { name: "Frightened 1", type: "status", value: -1, source: "frightened" },
        { name: "Sickened 2", type: "status", value: -2, source: "sickened" },
      ]);

      t.assertEqual(result.total, 8);
      t.assertEqual(result.penaltyTotal, -2);
      t.assertEqual(result.effectiveModifiers.length, 1);
      t.assertEqual(result.effectiveModifiers[0].value, -2);
    });

    t.test("untyped penalties from different sources stack", function () {
      const result = Modifiers.resolveModifiers(10, [
        { name: "MAP", type: "untyped", value: -5, source: "multiple-attack-penalty" },
        { name: "Clumsy", type: "untyped", value: -2, source: "clumsy" },
      ]);

      t.assertEqual(result.total, 3);
      t.assertEqual(result.penaltyTotal, -7);
      t.assertEqual(result.effectiveModifiers.length, 2);
    });

    t.test("untyped penalties from the same source do not stack", function () {
      const result = Modifiers.resolveModifiers(10, [
        { name: "MAP", type: "untyped", value: -5, source: "multiple-attack-penalty" },
        { name: "MAP echo", type: "untyped", value: -2, source: "multiple-attack-penalty" },
      ]);

      t.assertEqual(result.total, 5);
      t.assertEqual(result.penaltyTotal, -5);
      t.assertEqual(result.effectiveModifiers.length, 1);
    });

    t.test("item bonuses use the same non-stacking rule", function () {
      const result = Modifiers.resolveModifiers(10, [
        { name: "Potion", type: "item", value: 1, source: "potion" },
        { name: "Rune", type: "item", value: 3, source: "rune" },
      ]);

      t.assertEqual(result.total, 13);
      t.assertEqual(result.effectiveModifiers.length, 1);
      t.assertEqual(result.effectiveModifiers[0].name, "Rune");
    });

    t.test("different types stack with each other", function () {
      const result = Modifiers.resolveModifiers(10, [
        { name: "Off-Guard", type: "circumstance", value: -2, source: "off-guard" },
        { name: "Frightened 1", type: "status", value: -1, source: "frightened" },
        { name: "MAP", type: "untyped", value: -5, source: "multiple-attack-penalty" },
      ]);

      t.assertEqual(result.total, 2);
      t.assertEqual(result.penaltyTotal, -8);
    });

    t.test("a same-type bonus and penalty are evaluated separately", function () {
      const result = Modifiers.resolveModifiers(10, [
        { name: "Status bonus", type: "status", value: 2, source: "a" },
        { name: "Status penalty", type: "status", value: -1, source: "b" },
      ]);

      t.assertEqual(result.total, 11);
      t.assertEqual(result.effectiveModifiers.length, 2);
    });

    t.test("the breakdown reports applied and suppressed modifiers", function () {
      const result = Modifiers.resolveModifiers(10, [
        { name: "A", type: "status", value: 1, source: "a" },
        { name: "B", type: "status", value: 2, source: "b" },
      ]);
      const statusBreakdown = result.breakdown.find(function (entry) {
        return entry.type === "status";
      });

      t.assertEqual(statusBreakdown.bonus, 2);
      t.assertEqual(statusBreakdown.penalty, 0);
      t.assertEqual(statusBreakdown.applied.length, 1);
      t.assertEqual(statusBreakdown.suppressed.length, 1);
      t.assertEqual(statusBreakdown.suppressed[0].name, "A");
    });

    t.test("an empty modifier list returns the base value", function () {
      const result = Modifiers.resolveModifiers(17, []);
      t.assertEqual(result.total, 17);
      t.assertEqual(result.modifierTotal, 0);
      t.assertEqual(result.effectiveModifiers.length, 0);
    });

    t.test("unknown modifier types and non-integer values are rejected", function () {
      t.assertThrows(function () {
        Modifiers.resolveModifiers(10, [
          { name: "Bad", type: "morale", value: 1, source: "bad" },
        ]);
      }, "unknown type");

      t.assertThrows(function () {
        Modifiers.resolveModifiers(10, [
          { name: "Bad", type: "status", value: 1.5, source: "bad" },
        ]);
      }, "fractional value");

      t.assertThrows(function () {
        Modifiers.resolveModifiers(10.5, []);
      }, "fractional base");
    });
  };
});
