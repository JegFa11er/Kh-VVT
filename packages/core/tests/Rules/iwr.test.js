/**
 * Session 7.1 — Damage Types & IWR (Immunity, Weakness, Resistance).
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../../src/Core/Rules/iwr.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Rules — Damage Types & IWR",
      register: factory(root.PF2e.Core.Rules.IWR),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IWR) {
  "use strict";

  if (!IWR) {
    throw new Error("IWR tests require the IWR rules module.");
  }

  function apply(options) {
    return IWR.applyIWR(options);
  }

  return function registerIWRTests(t) {
    // ------------------------------------------------------------- immunity
    t.test("immunity zeroes the instance and skips weakness and resistance", function () {
      const result = apply({
        damageInstances: [{ amount: 8, type: "fire" }],
        immunities: ["fire"],
        weaknesses: [{ type: "fire", value: 5 }],
        resistances: [{ type: "fire", value: 3 }],
      });

      t.assertEqual(result.totalDamage, 0);
      t.assertEqual(result.baseTotal, 8);
      t.assertEqual(result.breakdown.length, 1);

      const entry = result.breakdown[0];
      t.assertEqual(entry.type, "fire");
      t.assertEqual(entry.immune, true);
      t.assertEqual(entry.weakness, 0, "weakness does not run after immunity");
      t.assertEqual(entry.resistance, 0, "resistance does not run after immunity");
      t.assertEqual(entry.finalAmount, 0);
      t.assertEqual(entry.steps.length, 1);
      t.assertEqual(entry.steps[0].kind, "immunity");
      t.assertEqual(result.appliedIWR.length, 1);
      t.assertEqual(result.appliedIWR[0].kind, "immunity");
    });

    t.test('an "all" immunity matches every damage type', function () {
      const result = apply({
        damageInstances: [
          { amount: 6, type: "slashing" },
          { amount: 4, type: "fire" },
        ],
        immunities: ["all"],
      });

      t.assertEqual(result.totalDamage, 0);
      t.assertEqual(result.breakdown[0].immune, true);
      t.assertEqual(result.breakdown[1].immune, true);
    });

    t.test("an unrelated immunity does not affect the instance", function () {
      const result = apply({
        damageInstances: [{ amount: 7, type: "slashing" }],
        immunities: ["fire"],
      });

      t.assertEqual(result.totalDamage, 7);
      t.assertEqual(result.breakdown[0].immune, false);
      t.assertEqual(result.appliedIWR.length, 0);
    });

    // ------------------------------------------------------------- weakness
    t.test("weakness adds its value to the damage of the matching type", function () {
      const result = apply({
        damageInstances: [{ amount: 8, type: "slashing" }],
        weaknesses: [{ type: "slashing", value: 5 }],
      });

      t.assertEqual(result.totalDamage, 13);
      const entry = result.breakdown[0];
      t.assertEqual(entry.amount, 8);
      t.assertEqual(entry.weakness, 5);
      t.assertEqual(entry.resistance, 0);
      t.assertEqual(entry.finalAmount, 13);
      t.assertDeepEqual(
        result.appliedIWR.map(function (step) {
          return { kind: step.kind, type: step.type, value: step.value };
        }),
        [{ kind: "weakness", type: "slashing", value: 5 }],
      );
    });

    t.test("weakness applies once per attack for the same type", function () {
      const result = apply({
        damageInstances: [
          { amount: 5, type: "slashing" },
          { amount: 5, type: "slashing" },
        ],
        weaknesses: [{ type: "slashing", value: 5 }],
      });

      t.assertEqual(result.totalDamage, 15, "5 + (5 + 5), not 20");
      t.assertEqual(result.breakdown[0].weakness, 5);
      t.assertEqual(result.breakdown[1].weakness, 0);
      t.assertEqual(
        result.appliedIWR.filter(function (step) {
          return step.kind === "weakness";
        }).length,
        1,
      );
    });

    t.test("weakness is per damage type across a multi-type attack", function () {
      const result = apply({
        damageInstances: [
          { amount: 8, type: "slashing" },
          { amount: 4, type: "fire" },
        ],
        weaknesses: [
          { type: "slashing", value: 5 },
          { type: "fire", value: 2 },
        ],
      });

      t.assertEqual(result.totalDamage, 19, "13 slashing + 6 fire");
      t.assertEqual(result.breakdown[0].finalAmount, 13);
      t.assertEqual(result.breakdown[1].finalAmount, 6);
    });

    // ----------------------------------------------------------- resistance
    t.test("resistance subtracts from damage of the matching type", function () {
      const result = apply({
        damageInstances: [{ amount: 10, type: "piercing" }],
        resistances: [{ type: "piercing", value: 3 }],
      });

      t.assertEqual(result.totalDamage, 7);
      const entry = result.breakdown[0];
      t.assertEqual(entry.resistance, 3);
      t.assertEqual(entry.resistanceApplied, 3);
      t.assertEqual(entry.finalAmount, 7);
    });

    t.test("resistance never lowers damage below 0", function () {
      const result = apply({
        damageInstances: [{ amount: 4, type: "piercing" }],
        resistances: [{ type: "piercing", value: 10 }],
      });

      t.assertEqual(result.totalDamage, 0);
      t.assertEqual(result.breakdown[0].finalAmount, 0);
      t.assertEqual(result.breakdown[0].resistanceApplied, 4);
      t.assertEqual(result.appliedIWR[0].amount, 4, "only 4 damage was resisted");
    });

    // ------------------------------------------------------------ combined
    t.test("weakness runs before resistance on the same type", function () {
      const result = apply({
        damageInstances: [{ amount: 8, type: "slashing" }],
        weaknesses: [{ type: "slashing", value: 5 }],
        resistances: [{ type: "slashing", value: 3 }],
      });

      t.assertEqual(result.totalDamage, 10, "8 + 5 - 3");
      const entry = result.breakdown[0];
      t.assertEqual(entry.afterImmunity, 8);
      t.assertEqual(entry.afterWeakness, 13);
      t.assertEqual(entry.finalAmount, 10);
      t.assertDeepEqual(
        entry.steps.map(function (step) {
          return step.kind;
        }),
        ["weakness", "resistance"],
      );
    });

    t.test("immunity beats weakness and resistance in a multi-type attack", function () {
      const result = apply({
        damageInstances: [
          { amount: 10, type: "slashing" },
          { amount: 10, type: "fire" },
        ],
        immunities: ["fire"],
        weaknesses: [{ type: "slashing", value: 5 }],
        resistances: [
          { type: "slashing", value: 3 },
          { type: "fire", value: 100 },
        ],
      });

      t.assertEqual(result.totalDamage, 12, "10 + 5 - 3 slashing, 0 fire");
      t.assertEqual(result.breakdown[0].finalAmount, 12);
      t.assertEqual(result.breakdown[1].finalAmount, 0);

      const kinds = result.appliedIWR.map(function (step) {
        return step.kind + ":" + step.type;
      });
      t.assertDeepEqual(kinds, ["weakness:slashing", "resistance:slashing", "immunity:fire"]);
    });

    t.test("highest duplicate weakness or resistance value wins", function () {
      const result = apply({
        damageInstances: [{ amount: 10, type: "cold" }],
        weaknesses: [
          { type: "cold", value: 2 },
          { type: "cold", value: 6 },
        ],
        resistances: [
          { type: "cold", value: 1 },
          { type: "cold", value: 4 },
        ],
      });

      t.assertEqual(result.totalDamage, 12, "10 + 6 - 4");
    });

    t.test("object-form weaknesses and resistances are accepted", function () {
      const result = apply({
        damageInstances: [{ amount: 10, type: "fire" }],
        weaknesses: { fire: 4 },
        resistances: { fire: 1 },
      });

      t.assertEqual(result.totalDamage, 13);
    });

    t.test("empty damage instances produce zero damage", function () {
      const result = apply({ damageInstances: [] });
      t.assertEqual(result.totalDamage, 0);
      t.assertEqual(result.baseTotal, 0);
      t.assertEqual(result.breakdown.length, 0);
    });

    // ----------------------------------------------------------- validation
    t.test("invalid damage instances and IWR values throw", function () {
      t.assertThrows(function () {
        apply({ damageInstances: [{ amount: -1, type: "fire" }] });
      }, "negative amount");
      t.assertThrows(function () {
        apply({ damageInstances: [{ amount: 1, type: "" }] });
      }, "empty type");
      t.assertThrows(function () {
        apply({
          damageInstances: [{ amount: 1, type: "fire" }],
          weaknesses: [{ type: "fire", value: -2 }],
        });
      }, "negative weakness");
      t.assertThrows(function () {
        apply({ damageInstances: "1d6" });
      }, "instances must be an array");
    });

    t.test("damage type normalization is case-insensitive", function () {
      const result = apply({
        damageInstances: [{ amount: 5, type: "SLASHING" }],
        weaknesses: [{ type: "Slashing", value: 1 }],
      });

      t.assertEqual(result.totalDamage, 6);
      t.assertEqual(result.breakdown[0].type, "slashing");
    });
  };
});
