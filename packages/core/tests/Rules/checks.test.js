/**
 * Phase 3.1 — d20 checks and the four degrees of success.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../../src/Core/Rules/checks.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Rules — d20 Checks & Degrees of Success",
      register: factory(root.PF2e.Core.Rules.Checks),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Checks) {
  "use strict";

  if (!Checks) {
    throw new Error("Checks tests require Core.Rules.Checks.");
  }

  const D = Checks.DEGREES;

  function check(d20, modifier, dc) {
    return Checks.evaluateCheck({ d20: d20, modifier: modifier, dc: dc });
  }

  return function registerChecksTests(t) {
    // --------------------------------------------------------- base degrees

    t.test("total >= DC + 10 is a critical success", function () {
      const result = check(10, 10, 10); // 20 vs 10
      t.assertEqual(result.total, 20);
      t.assertEqual(result.degree, D.CRITICAL_SUCCESS);
    });

    t.test("total exactly DC + 10 is a critical success", function () {
      t.assertEqual(check(20, 0, 10).degree, D.CRITICAL_SUCCESS);
    });

    t.test("total >= DC is a success", function () {
      t.assertEqual(check(10, 0, 10).degree, D.SUCCESS);
      t.assertEqual(check(19, 0, 10).degree, D.SUCCESS);
    });

    t.test("total below DC is a failure", function () {
      t.assertEqual(check(9, 0, 10).degree, D.FAILURE);
      t.assertEqual(check(6, 0, 10).degree, D.FAILURE);
    });

    t.test("total <= DC - 10 is a critical failure", function () {
      t.assertEqual(check(5, 0, 15).degree, D.CRITICAL_FAILURE);
      t.assertEqual(check(4, 0, 15).degree, D.CRITICAL_FAILURE);
    });

    t.test("degree thresholds use total, not the raw d20", function () {
      // d20 10 + 5 = 15 vs DC 20 -> failure, not critical failure.
      t.assertEqual(check(10, 5, 20).degree, D.FAILURE);
      // d20 10 + 10 = 20 vs DC 20 -> success.
      t.assertEqual(check(10, 10, 20).degree, D.SUCCESS);
    });

    // ------------------------------------------------------------- natural 20

    t.test("natural 20 turns a failure into a success", function () {
      const result = check(20, -10, 15); // 10 vs 15
      t.assertEqual(result.total, 10);
      t.assertEqual(result.degree, D.SUCCESS);
      t.assertTrue(result.isNatural20);
      t.assertTrue(!result.isNatural1);
    });

    t.test("natural 20 turns a success into a critical success", function () {
      const result = check(20, 0, 20); // 20 vs 20
      t.assertEqual(result.degree, D.CRITICAL_SUCCESS);
      t.assertTrue(result.isNatural20);
    });

    t.test("natural 20 does not exceed critical success", function () {
      const result = check(20, 10, 10); // 30 vs 10
      t.assertEqual(result.degree, D.CRITICAL_SUCCESS);
      t.assertTrue(result.isNatural20);
    });

    // -------------------------------------------------------------- natural 1

    t.test("natural 1 turns a success into a failure", function () {
      const result = check(1, 10, 10); // 11 vs 10
      t.assertEqual(result.total, 11);
      t.assertEqual(result.degree, D.FAILURE);
      t.assertTrue(result.isNatural1);
      t.assertTrue(!result.isNatural20);
    });

    t.test("natural 1 turns a failure into a critical failure", function () {
      const result = check(1, 0, 10); // 1 vs 10
      t.assertEqual(result.degree, D.CRITICAL_FAILURE);
      t.assertTrue(result.isNatural1);
    });

    t.test("natural 1 does not go below critical failure", function () {
      const result = check(1, -10, 15); // -9 vs 15
      t.assertEqual(result.degree, D.CRITICAL_FAILURE);
      t.assertTrue(result.isNatural1);
    });

    // ----------------------------------------------------------- return shape

    t.test("evaluateCheck returns the full deterministic report", function () {
      t.assertDeepEqual(check(12, 3, 15), {
        d20: 12,
        modifier: 3,
        total: 15,
        dc: 15,
        degree: D.SUCCESS,
        isNatural20: false,
        isNatural1: false,
      });
    });

    // ----------------------------------------------------------- flat checks

    t.test("evaluateFlatCheck passes at or above the DC", function () {
      const pass = Checks.evaluateFlatCheck({ d20: 11, dc: 11 });
      t.assertDeepEqual(pass, { passed: true, d20: 11, dc: 11 });

      const fail = Checks.evaluateFlatCheck({ d20: 10, dc: 11 });
      t.assertDeepEqual(fail, { passed: false, d20: 10, dc: 11 });
    });

    t.test("Concealed flat check uses the DC 5 boundary", function () {
      t.assertTrue(Checks.evaluateFlatCheck({ d20: 4, dc: 5 }).passed === false);
      t.assertTrue(Checks.evaluateFlatCheck({ d20: 5, dc: 5 }).passed === true);
    });

    t.test("Hidden flat check uses the DC 11 boundary", function () {
      t.assertTrue(Checks.evaluateFlatCheck({ d20: 10, dc: 11 }).passed === false);
      t.assertTrue(Checks.evaluateFlatCheck({ d20: 11, dc: 11 }).passed === true);
    });

    t.test("evaluateFlatCheck accepts a deterministic rollD20 callback", function () {
      let calls = 0;
      const result = Checks.evaluateFlatCheck({
        dc: 11,
        rollD20: function () {
          calls += 1;
          return 15;
        },
      });

      t.assertEqual(calls, 1);
      t.assertDeepEqual(result, { passed: true, d20: 15, dc: 11 });
    });

    t.test("flat checks use no modifiers and reject invalid dice/DC", function () {
      t.assertThrows(function () {
        Checks.evaluateFlatCheck({ d20: 0, dc: 11 });
      }, "d20 below 1");
      t.assertThrows(function () {
        Checks.evaluateFlatCheck({ d20: 21, dc: 11 });
      }, "d20 above 20");
      t.assertThrows(function () {
        Checks.evaluateFlatCheck({ d20: 10.5, dc: 11 });
      }, "non-integer d20");
      t.assertThrows(function () {
        Checks.evaluateFlatCheck({ d20: 11, dc: 10.5 });
      }, "non-integer DC");
    });

    t.test("out-of-range or non-integer inputs are rejected", function () {
      t.assertThrows(function () {
        check(0, 0, 10);
      }, "d20 below 1");
      t.assertThrows(function () {
        check(21, 0, 10);
      }, "d20 above 20");
      t.assertThrows(function () {
        check(10.5, 0, 10);
      }, "non-integer d20");
      t.assertThrows(function () {
        check(10, 0.5, 10);
      }, "non-integer modifier");
      t.assertThrows(function () {
        check(10, 0, 10.5);
      }, "non-integer DC");
    });
  };
});
