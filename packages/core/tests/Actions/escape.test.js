/**
 * Phase 8.3 — Escape: best-of skill selection, Athletics DC, MAP, and removal
 * of Grabbed/Restrained.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Actions/grapple.js"),
      require("../../src/Core/Actions/escape.js"),
      require("../../src/Core/Rules/checks.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Actions — Escape & Best Skill",
      register: factory(
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Actions.Grapple,
        root.PF2e.Core.Actions.Escape,
        root.PF2e.Core.Rules.Checks,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Combatant,
  Grapple,
  Escape,
  Checks,
) {
  "use strict";

  if (!Combatant || !Grapple || !Escape || !Checks) {
    throw new Error("Escape tests require Combatant, Grapple, Escape and Checks.");
  }

  const D = Checks.DEGREES;

  function makeValeros(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "valeros",
          name: "Valeros",
          alliance: "player",
          initiative: 18,
          x: 2,
          y: 2,
          speedFeet: 25,
          maxActions: 3,
          maxHP: 20,
          ac: 18,
          attackBonus: 9,
          damage: { formula: "1d8+4", type: "slashing" },
          saves: { fortitude: 9, reflex: 6, will: 5 },
          // Athletics +3 => Athletics DC 13, keeping the test arithmetic small.
          skills: { athletics: 3, acrobatics: 6, stealth: 2, perception: 7 },
        },
        overrides || {},
      ),
    );
  }

  function makeMerisiel(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "merisiel",
          name: "Merisiel",
          alliance: "player",
          initiative: 12,
          x: 4,
          y: 2,
          speedFeet: 25,
          maxActions: 3,
          maxHP: 16,
          ac: 17,
          attackBonus: 8,
          damage: { formula: "1d6+2", type: "piercing" },
          saves: { fortitude: 5, reflex: 9, will: 6 },
          skills: { athletics: 4, acrobatics: 9, stealth: 10, perception: 8 },
        },
        overrides || {},
      ),
    );
  }

  function grapple(merisiel, valeros) {
    return Grapple.applyGrappleCondition(merisiel, "grabbed", valeros);
  }

  function escape(options) {
    return Escape.performEscape(
      Object.assign(
        {
          rollD20: function () {
            return 10;
          },
        },
        options,
      ),
    );
  }

  return function registerEscapeTests(t) {
    t.test("Escape chooses the highest of Unarmed, Athletics, and Acrobatics", function () {
      const valeros = makeValeros();
      const merisiel = makeMerisiel();
      grapple(merisiel, valeros);

      const evaluation = Escape.evaluateEscape({
        actor: merisiel,
        combatants: [merisiel, valeros],
      });

      t.assertTrue(evaluation.ok);
      t.assertEqual(evaluation.skill, "acrobatics");
      t.assertEqual(evaluation.skillLabel, "Acrobatics");
      t.assertEqual(evaluation.skillBase, 9);
      t.assertEqual(evaluation.attackModifier, 9);
      t.assertEqual(evaluation.athleticsDC, 13);
      t.assertEqual(evaluation.options.length, 3);
      t.assertEqual(evaluation.options[0].key, "acrobatics");
      t.assertEqual(evaluation.options[1].key, "unarmed");
      t.assertEqual(evaluation.options[2].key, "athletics");
    });

    t.test("Escape can select Athletics when it is the highest option", function () {
      const valeros = makeValeros();
      const merisiel = makeMerisiel({
        attackBonus: 2,
        skills: { athletics: 12, acrobatics: 1, stealth: 10, perception: 8 },
      });
      grapple(merisiel, valeros);

      const evaluation = Escape.evaluateEscape({
        actor: merisiel,
        combatants: [merisiel, valeros],
      });

      t.assertEqual(evaluation.skill, "athletics");
      t.assertEqual(evaluation.skillBase, 12);
      t.assertEqual(evaluation.attackModifier, 12);
      t.assertEqual(evaluation.options[0].key, "athletics");
    });

    t.test("Escape success removes Grabbed and Immobilized", function () {
      const valeros = makeValeros();
      const merisiel = makeMerisiel();
      grapple(merisiel, valeros);
      t.assertTrue(merisiel.hasCondition("grabbed"));

      const result = escape({
        actor: merisiel,
        combatants: [merisiel, valeros],
        rollD20: function () {
          return 5;
        },
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.skill, "acrobatics");
      t.assertEqual(result.attackRoll, 5);
      t.assertEqual(result.attackModifier, 9);
      t.assertEqual(result.total, 14);
      t.assertEqual(result.athleticsDC, 13);
      t.assertEqual(result.degree, D.SUCCESS);
      t.assertTrue(result.escaped);
      t.assertTrue(!merisiel.hasCondition("grabbed"));
      t.assertTrue(!merisiel.hasCondition("restrained"));
      t.assertTrue(!merisiel.hasCondition("immobilized"));
      t.assertEqual(result.removed.length, 2);
      t.assertEqual(merisiel.actionsRemaining, 2);
      t.assertEqual(merisiel.attacksThisTurn, 1);
      t.assertEqual(result.actionsLeft, 2);
      t.assertEqual(result.mapAfter, -5);
    });

    t.test("Escape applies and advances MAP", function () {
      const valeros = makeValeros();
      const merisiel = makeMerisiel({ attacksThisTurn: 1 });
      grapple(merisiel, valeros);

      const result = escape({
        actor: merisiel,
        combatants: [merisiel, valeros],
        rollD20: function () {
          return 10;
        },
      });

      t.assertEqual(result.mapPenalty, -5);
      t.assertEqual(result.multipleAttackPenalty, -5);
      t.assertEqual(result.attackModifier, 4);
      t.assertEqual(result.total, 14);
      t.assertEqual(result.degree, D.SUCCESS);
      t.assertTrue(result.escaped);
      t.assertEqual(merisiel.attacksThisTurn, 2);
      t.assertEqual(merisiel.actionsRemaining, 2);
    });

    t.test("Escape failure keeps the condition but still spends action and MAP", function () {
      const valeros = makeValeros();
      const merisiel = makeMerisiel();
      grapple(merisiel, valeros);

      const result = escape({
        actor: merisiel,
        combatants: [merisiel, valeros],
        rollD20: function () {
          return 3;
        },
      });

      t.assertEqual(result.total, 12);
      t.assertEqual(result.degree, D.FAILURE);
      t.assertTrue(!result.escaped);
      t.assertTrue(merisiel.hasCondition("grabbed"));
      t.assertTrue(merisiel.hasCondition("immobilized"));
      t.assertEqual(result.removed.length, 0);
      t.assertEqual(merisiel.actionsRemaining, 2);
      t.assertEqual(merisiel.attacksThisTurn, 1);
    });

    t.test("Critical Success also breaks free", function () {
      const valeros = makeValeros();
      const merisiel = makeMerisiel();
      grapple(merisiel, valeros);

      const result = escape({
        actor: merisiel,
        combatants: [merisiel, valeros],
        rollD20: function () {
          return 20;
        },
      });

      t.assertEqual(result.degree, D.CRITICAL_SUCCESS);
      t.assertTrue(result.critical);
      t.assertTrue(result.escaped);
      t.assertTrue(!merisiel.hasCondition("grabbed"));
    });

    t.test("Prone penalizes the Unarmed option but not Acrobatics", function () {
      const valeros = makeValeros();
      const merisiel = makeMerisiel();
      merisiel.addCondition("prone");
      grapple(merisiel, valeros);

      const evaluation = Escape.evaluateEscape({
        actor: merisiel,
        combatants: [merisiel, valeros],
      });

      const unarmed = evaluation.options.find(function (option) {
        return option.key === "unarmed";
      });
      const acrobatics = evaluation.options.find(function (option) {
        return option.key === "acrobatics";
      });
      t.assertEqual(unarmed.total, 6);
      t.assertEqual(acrobatics.total, 9);
      t.assertEqual(evaluation.skill, "acrobatics");
    });

    t.test("Restrained is also escapable and uses the same Athletics DC", function () {
      const valeros = makeValeros();
      const merisiel = makeMerisiel();
      Grapple.applyGrappleCondition(merisiel, "restrained", valeros);

      const result = escape({
        actor: merisiel,
        combatants: [merisiel, valeros],
        rollD20: function () {
          return 5;
        },
      });

      t.assertTrue(result.escaped);
      t.assertTrue(!merisiel.hasCondition("restrained"));
      t.assertTrue(!merisiel.hasCondition("immobilized"));
    });

    t.test("Frightened lowers the grappler's Athletics DC", function () {
      const valeros = makeValeros();
      const merisiel = makeMerisiel();
      valeros.addCondition("frightened", 1);
      grapple(merisiel, valeros);

      const evaluation = Escape.evaluateEscape({
        actor: merisiel,
        combatants: [merisiel, valeros],
      });

      t.assertEqual(evaluation.athleticsDC, 12);
      t.assertEqual(evaluation.targetDCBaseValue, 3);
    });

    t.test("Escape without Grabbed/Restrained is rejected without spending", function () {
      const valeros = makeValeros();
      const merisiel = makeMerisiel();

      const result = escape({
        actor: merisiel,
        combatants: [merisiel, valeros],
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, "not-grabbed");
      t.assertEqual(merisiel.actionsRemaining, 3);
      t.assertEqual(merisiel.attacksThisTurn, 0);
    });

    t.test("A defeated grappler drops the hold without spending an action", function () {
      const valeros = makeValeros();
      const merisiel = makeMerisiel();
      grapple(merisiel, valeros);
      valeros.takeDamage(valeros.maxHP);

      const result = escape({
        actor: merisiel,
        combatants: [merisiel, valeros],
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, "source-defeated");
      t.assertTrue(result.released);
      t.assertEqual(result.removed.length, 2);
      t.assertTrue(!merisiel.hasCondition("grabbed"));
      t.assertTrue(!merisiel.hasCondition("immobilized"));
      t.assertEqual(merisiel.actionsRemaining, 3);
      t.assertEqual(merisiel.attacksThisTurn, 0);
    });

    t.test("A failed Concealed flat check spends the action and advances MAP", function () {
      const valeros = makeValeros();
      const merisiel = makeMerisiel();
      valeros.addCondition("concealed");
      grapple(merisiel, valeros);

      const result = escape({
        actor: merisiel,
        combatants: [merisiel, valeros],
        rollFlatCheck: function () {
          return 4;
        },
        rollD20: function () {
          return 20;
        },
      });

      t.assertTrue(result.automaticMiss);
      t.assertTrue(!result.escaped);
      t.assertEqual(result.flatCheck.dc, 5);
      t.assertTrue(merisiel.hasCondition("grabbed"));
      t.assertEqual(merisiel.actionsRemaining, 2);
      t.assertEqual(merisiel.attacksThisTurn, 1);
    });
  };
});
