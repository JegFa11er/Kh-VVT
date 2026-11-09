/**
 * Session 6.1 — Take Cover: requirement, condition, and expiry.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Actions/take-cover.js"),
      require("../../src/Core/Actions/step.js"),
      require("../../src/Core/Actions/stride.js"),
      require("../../src/Core/Rules/modifiers.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Actions — Take Cover",
      register: factory(
        root.PF2e.Core.GridMap,
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Actions.TakeCover,
        root.PF2e.Core.Actions.Step,
        root.PF2e.Core.Actions.Stride,
        root.PF2e.Core.Rules.Modifiers,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  GridMap,
  Combatant,
  TakeCover,
  Step,
  Stride,
  Modifiers,
) {
  "use strict";

  if (!GridMap || !Combatant || !TakeCover || !Step || !Stride || !Modifiers) {
    throw new Error(
      "Take Cover tests require GridMap, Combatant, TakeCover, Step, Stride and Modifiers.",
    );
  }

  function makeCombatant(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "valeros",
          name: "Valeros",
          alliance: "player",
          initiative: 18,
          x: 2,
          y: 3,
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

  function makeAttacker() {
    return makeCombatant({
      id: "goblin",
      name: "Goblin",
      alliance: "enemy",
      initiative: 15,
      x: 0,
      y: 0,
      maxHP: 6,
      ac: 16,
      attackBonus: 8,
      damage: "1d6+1",
      agile: true,
    });
  }

  function coverMap() {
    // Wall (1,3) gives Valeros at (2,3) standard cover from the Goblin at (0,0)
    // while keeping the centre-to-centre line clear.
    return new GridMap({ cols: 8, rows: 8, blocked: [{ x: 1, y: 3 }] });
  }

  return function registerTakeCoverTests(t) {
    t.test("Take Cover succeeds behind standard cover and grants +4 circumstance AC", function () {
      const valeros = makeCombatant();
      const goblin = makeAttacker();

      const result = TakeCover.performTakeCover({
        combatant: valeros,
        map: coverMap(),
        combatants: [valeros, goblin],
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.actionsLeft, 2);
      t.assertEqual(valeros.actionsRemaining, 2);
      t.assertTrue(valeros.hasCondition("greater-cover"));
      t.assertEqual(valeros.getCondition("greater-cover").label, "Greater Cover");
      t.assertEqual(result.coverDegree, "greater");
      t.assertEqual(result.acBonus, 4);
      t.assertEqual(result.requiredCover, "standard");

      const modifiers = valeros.getConditionModifiers("ac");
      t.assertEqual(modifiers.length, 1);
      t.assertEqual(modifiers[0].name, "Greater Cover");
      t.assertEqual(modifiers[0].type, "circumstance");
      t.assertEqual(modifiers[0].value, 4);
      t.assertEqual(modifiers[0].source, "greater-cover");
      t.assertEqual(Modifiers.resolveModifiers(valeros.ac, modifiers).total, 22);
    });

    t.test("Take Cover is refused on open ground and spends nothing", function () {
      const valeros = makeCombatant({ x: 2, y: 0 });
      const goblin = makeAttacker();
      const result = TakeCover.performTakeCover({
        combatant: valeros,
        map: new GridMap({ cols: 8, rows: 8 }),
        combatants: [valeros, goblin],
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, TakeCover.TAKE_COVER_REASONS.INSUFFICIENT_COVER);
      t.assertEqual(result.reason, "insufficient-cover");
      t.assertEqual(valeros.actionsRemaining, 3);
      t.assertTrue(!valeros.hasCondition("greater-cover"));
    });

    t.test("Take Cover needs at least standard cover, not lesser creature cover", function () {
      const valeros = makeCombatant({ x: 2, y: 0 });
      const goblin = makeAttacker();
      const ally = makeCombatant({ id: "merisiel", name: "Merisiel", x: 1, y: 0 });

      const result = TakeCover.performTakeCover({
        combatant: valeros,
        map: new GridMap({ cols: 8, rows: 8 }),
        combatants: [valeros, goblin, ally],
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, "insufficient-cover");
      t.assertEqual(result.cover.degree, "lesser");
      t.assertEqual(valeros.actionsRemaining, 3);
    });

    t.test("Take Cover without actions spends nothing", function () {
      const valeros = makeCombatant({ actionsRemaining: 0 });
      const goblin = makeAttacker();

      const result = TakeCover.performTakeCover({
        combatant: valeros,
        map: coverMap(),
        combatants: [valeros, goblin],
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, TakeCover.TAKE_COVER_REASONS.NO_ACTIONS);
      t.assertEqual(result.reason, "no-actions");
      t.assertTrue(!valeros.hasCondition("greater-cover"));
    });

    t.test("resetTurn removes greater cover at the start of the next turn", function () {
      const valeros = makeCombatant();
      const goblin = makeAttacker();
      TakeCover.performTakeCover({
        combatant: valeros,
        map: coverMap(),
        combatants: [valeros, goblin],
      });
      t.assertTrue(valeros.hasCondition("greater-cover"));

      valeros.resetTurn({ tickConditions: false });

      t.assertTrue(!valeros.hasCondition("greater-cover"));
      t.assertEqual(valeros.getConditionModifiers("ac").length, 0);
      t.assertEqual(valeros.actionsRemaining, 3);
    });

    t.test("Step removes greater cover because the creature moved", function () {
      const valeros = makeCombatant();
      const goblin = makeAttacker();
      TakeCover.performTakeCover({
        combatant: valeros,
        map: coverMap(),
        combatants: [valeros, goblin],
      });
      t.assertTrue(valeros.hasCondition("greater-cover"));

      const step = Step.performStep({
        combatant: valeros,
        map: coverMap(),
        destination: { x: 2, y: 4 },
      });

      t.assertTrue(step.ok);
      t.assertTrue(!valeros.hasCondition("greater-cover"));
      t.assertEqual(valeros.getConditionModifiers("ac").length, 0);
    });

    t.test("Stride removes greater cover because the creature moved", function () {
      const valeros = makeCombatant();
      const goblin = makeAttacker();
      TakeCover.performTakeCover({
        combatant: valeros,
        map: coverMap(),
        combatants: [valeros, goblin],
      });
      t.assertTrue(valeros.hasCondition("greater-cover"));

      const stride = Stride.performStride({
        combatant: valeros,
        map: coverMap(),
        destination: { x: 3, y: 3 },
      });

      t.assertTrue(stride.ok);
      t.assertTrue(!valeros.hasCondition("greater-cover"));
      t.assertEqual(valeros.getConditionModifiers("ac").length, 0);
    });

    t.test("Take Cover rejects a combatant without an action pool", function () {
      t.assertThrows(function () {
        TakeCover.performTakeCover({
          combatant: {},
          map: coverMap(),
          combatants: [],
        });
      }, "missing action pool");
    });
  };
});
