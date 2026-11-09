/**
 * Browser test runner: renders PF2e.TestSuites registered by test files.
 */
(function () {
  "use strict";

  const resultsEl = document.getElementById("test-results");
  const summaryEl = document.getElementById("test-summary");
  const suites = window.PF2e && window.PF2e.TestSuites ? window.PF2e.TestSuites : [];
  const harnessFactory = window.PF2e && window.PF2e.TestHarness;

  if (!resultsEl || !summaryEl || !harnessFactory) {
    if (summaryEl) {
      summaryEl.textContent = "Test harness failed to load.";
      summaryEl.classList.add("fail");
    }
    return;
  }

  let passed = 0;
  let failed = 0;

  for (const suite of suites) {
    const heading = document.createElement("h2");
    heading.className = "test-suite-name";
    heading.textContent = suite.name;
    resultsEl.append(heading);

    const harness = harnessFactory.createHarness();
    suite.register(harness);

    for (const result of harness.results) {
      const row = document.createElement("div");
      row.className = "test-row " + (result.passed ? "pass" : "fail");

      const status = document.createElement("span");
      status.className = "test-status";
      status.textContent = result.passed ? "PASS" : "FAIL";

      const name = document.createElement("span");
      name.className = "test-name";
      name.textContent = result.name;

      row.append(status, name);

      if (!result.passed) {
        const error = document.createElement("div");
        error.className = "test-error";
        error.textContent = result.error;
        row.append(error);
      }

      resultsEl.append(row);

      if (result.passed) {
        passed += 1;
      } else {
        failed += 1;
      }
    }
  }

  summaryEl.textContent = passed + " passed · " + failed + " failed · " + suites.length + " suite(s)";
  summaryEl.classList.add(failed === 0 ? "pass" : "fail");
  document.title = failed === 0 ? "✓ " + passed + " tests passed" : "✗ " + failed + " tests failed";
})();
