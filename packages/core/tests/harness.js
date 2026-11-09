/**
 * Minimal dependency-free test harness shared by the browser and Node runners.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestHarness = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function format(value) {
    if (typeof value === "string") {
      return JSON.stringify(value);
    }
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }

  function createHarness() {
    /** @type {{ name: string, passed: boolean, error: string | null }[]} */
    const results = [];

    function test(name, fn) {
      try {
        fn();
        results.push({ name: name, passed: true, error: null });
      } catch (error) {
        results.push({
          name: name,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    function assertEqual(actual, expected, message) {
      if (!Object.is(actual, expected)) {
        throw new Error(
          (message ? message + ": " : "") + "expected " + format(expected) + ", got " + format(actual),
        );
      }
    }

    function assertDeepEqual(actual, expected, message) {
      const a = JSON.stringify(actual);
      const e = JSON.stringify(expected);
      if (a !== e) {
        throw new Error((message ? message + ": " : "") + "expected " + e + ", got " + a);
      }
    }

    function assertTrue(value, message) {
      if (!value) {
        throw new Error(message || "expected value to be truthy");
      }
    }

    function assertThrows(fn, message) {
      let threw = false;
      try {
        fn();
      } catch (error) {
        threw = true;
      }
      if (!threw) {
        throw new Error((message ? message + ": " : "") + "expected function to throw");
      }
    }

    function summary() {
      const passed = results.filter(function (result) {
        return result.passed;
      }).length;
      return { passed: passed, failed: results.length - passed, total: results.length };
    }

    return {
      test: test,
      assertEqual: assertEqual,
      assertDeepEqual: assertDeepEqual,
      assertTrue: assertTrue,
      assertThrows: assertThrows,
      results: results,
      summary: summary,
    };
  }

  return { createHarness: createHarness };
});
