/**
 * Phase 8.1 — Saving throws, skills, and defended DCs.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Rules/checks.js"),
      require("../../src/Core/Rules/modifiers.js"),
      require("../../src/Core/Grid/cover.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Rules — Saving Throws, Skills & DCs",
      register: factory(
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Rules.Checks,
        root.PF2e.Core.Rules.Modifiers,
        root.PF2e.Core.Cover,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Combatant,
  Checks,
  Modifiers,
  Cover,
) {
  "use strict";

  if (!Combatant || !Checks || !Modifiers || !Cover) {
    throw new Error(
      "Saves/skills tests require Combatant, Checks, Modifiers and Cover.",
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
          saves: { fortitude: 9, reflex: 8, will: 5 },
          skills: { athletics: 10, acrobatics: 6, stealth: 2, perception: 7 },
        },
        overrides || {},
      ),
    );
  }

  function modifierOf(modifiers, source) {
    return modifiers.find(function (modifier) {
      return modifier.source === source;
    });
  }

  return function registerSavesSkillsTests(t) {
    t.test("saves and skills default to zero", function () {
      const combatant = new Combatant({
        id: "rookie",
        name: "Rookie",
        x: 0,
        y: 0,
        speedFeet: 25,
      });

      t.assertDeepEqual(combatant.getSaves(), {
        fortitude: 0,
        reflex: 0,
        will: 0,
      });
      t.assertDeepEqual(combatant.getSkills(), {
        acrobatics: 0,
        athletics: 0,
        perception: 0,
        stealth: 0,
      });
      t.assertEqual(combatant.getSkillModifier("athletics"), 0);
      t.assertEqual(combatant.getSaveModifier("reflex"), 0);
    });

    t.test("authored saves and skills are exposed defensively", function () {
      const combatant = makeCombatant();

      t.assertEqual(combatant.getSaveModifier("fortitude"), 9);
      t.assertEqual(combatant.getSaveModifier("reflex"), 8);
      t.assertEqual(combatant.getSaveModifier("will"), 5);
      t.assertEqual(combatant.getSkillModifier("athletics"), 10);
      t.assertEqual(combatant.getSkillModifier("stealth"), 2);

      const skills = combatant.getSkills();
      skills.athletics = 999;
      t.assertEqual(combatant.getSkillModifier("athletics"), 10);
    });

    t.test("Frightened 1 gives -1 status to Athletics and Reflex", function () {
      const combatant = makeCombatant();
      combatant.addCondition("frightened", 1);

      const athleticsModifiers = combatant.getSkillModifiers("athletics");
      const athleticsFrightened = modifierOf(athleticsModifiers, "frightened");
      t.assertTrue(athleticsFrightened !== undefined);
      t.assertEqual(athleticsFrightened.value, -1);
      t.assertEqual(athleticsFrightened.type, "status");
      t.assertEqual(athleticsFrightened.name, "Frightened 1");

      const athletics = Modifiers.resolveModifiers(
        combatant.getSkillModifier("athletics"),
        athleticsModifiers,
      );
      t.assertEqual(athletics.total, 9);

      const reflexModifiers = combatant.getSaveModifiers("reflex");
      const reflexFrightened = modifierOf(reflexModifiers, "frightened");
      t.assertTrue(reflexFrightened !== undefined);
      t.assertEqual(reflexFrightened.value, -1);
      t.assertEqual(
        Modifiers.resolveModifiers(
          combatant.getSaveModifier("reflex"),
          reflexModifiers,
        ).total,
        7,
      );
    });

    t.test("Frightened 1 reduces Reflex DC by 1", function () {
      const combatant = makeCombatant();
      combatant.addCondition("frightened", 1);

      const dcModifiers = combatant.getDCModifiers("reflex");
      const frightened = modifierOf(dcModifiers, "frightened");
      t.assertTrue(frightened !== undefined);
      t.assertEqual(frightened.value, -1);
      t.assertEqual(Checks.calculateDC(combatant.getSaveModifier("reflex"), dcModifiers), 17);
    });

    t.test("Standard Cover grants +2 circumstance to Reflex and Reflex DC", function () {
      const combatant = makeCombatant();
      const cover = { degree: "standard" };

      const reflexModifiers = combatant.getSaveModifiers("reflex", {
        cover: cover,
      });
      const reflexCover = modifierOf(reflexModifiers, "cover");
      t.assertTrue(reflexCover !== undefined);
      t.assertEqual(reflexCover.value, 2);
      t.assertEqual(reflexCover.type, "circumstance");
      t.assertEqual(
        Modifiers.resolveModifiers(
          combatant.getSaveModifier("reflex"),
          reflexModifiers,
        ).total,
        10,
      );

      const dcModifiers = combatant.getDCModifiers("reflex", { cover: cover });
      t.assertEqual(Checks.calculateDC(8, dcModifiers), 20);
    });

    t.test("Greater Cover is +4 and Lesser Cover gives no Reflex bonus", function () {
      const combatant = makeCombatant();

      t.assertEqual(
        Checks.calculateDC(
          8,
          combatant.getDCModifiers("reflex", {
            cover: { degree: "greater" },
          }),
        ),
        22,
      );
      t.assertEqual(Cover.coverReflexModifier({ degree: "greater" }).value, 4);
      t.assertEqual(Cover.coverReflexModifier({ degree: "standard" }).value, 2);
      t.assertEqual(Cover.coverReflexModifier({ degree: "lesser" }), null);
      t.assertEqual(
        Checks.calculateDC(
          8,
          combatant.getDCModifiers("reflex", {
            cover: { degree: "lesser" },
          }),
        ),
        18,
      );
    });

    t.test("calculateDC is 10 + base + resolved modifiers", function () {
      t.assertEqual(Checks.calculateDC(8, []), 18);
      t.assertEqual(
        Checks.calculateDC(8, [
          { name: "Frightened 1", type: "status", value: -1 },
        ]),
        17,
      );
      t.assertEqual(
        Checks.calculateDC(8, [
          { name: "Frightened 1", type: "status", value: -1 },
          { name: "Standard Cover", type: "circumstance", value: 2 },
        ]),
        19,
      );

      // Two same-type circumstance bonuses do not stack.
      t.assertEqual(
        Checks.calculateDC(8, [
          { name: "Standard Cover", type: "circumstance", value: 2 },
          { name: "Shield", type: "circumstance", value: 1 },
        ]),
        20,
      );
    });

    t.test("Frightened applies to Fortitude and Will as well", function () {
      const combatant = makeCombatant();
      combatant.addCondition("frightened", 2);

      t.assertEqual(
        Checks.calculateDC(9, combatant.getDCModifiers("fortitude")),
        17,
      );
      t.assertEqual(
        Checks.calculateDC(5, combatant.getDCModifiers("will")),
        13,
      );
    });

    t.test("Prone contributes Off-Guard AC and a -2 attack penalty", function () {
      const combatant = makeCombatant();
      combatant.addCondition("prone");

      const acModifiers = combatant.getConditionModifiers("ac");
      const offGuard = modifierOf(acModifiers, "off-guard");
      t.assertTrue(offGuard !== undefined);
      t.assertEqual(offGuard.value, -2);
      t.assertEqual(offGuard.type, "circumstance");
      t.assertEqual(acModifiers.length, 1);

      const attackModifiers = combatant.getConditionModifiers("attack");
      const prone = modifierOf(attackModifiers, "prone");
      t.assertTrue(prone !== undefined);
      t.assertEqual(prone.value, -2);
      t.assertEqual(prone.type, "circumstance");
    });

    t.test("Prone does not penalize Athletics because Trip is a skill check", function () {
      const combatant = makeCombatant();
      combatant.addCondition("prone");
      combatant.addCondition("frightened", 1);

      const modifiers = combatant.getSkillModifiers("athletics");
      const frightened = modifiers.filter(function (modifier) {
        return modifier.source === "frightened";
      });

      t.assertEqual(frightened.length, 1);
      t.assertEqual(modifierOf(modifiers, "prone"), undefined);
      t.assertEqual(
        Modifiers.resolveModifiers(10, modifiers).total,
        9,
      );
    });

    t.test("Prone does not change Reflex DC", function () {
      const combatant = makeCombatant();
      combatant.addCondition("prone");

      t.assertEqual(
        Checks.calculateDC(8, combatant.getDCModifiers("reflex")),
        18,
      );
    });

    t.test("calculateDC rejects invalid input", function () {
      t.assertThrows(function () {
        Checks.calculateDC(8.5, []);
      }, "non-integer base");
      t.assertThrows(function () {
        Checks.calculateDC(8, "cover");
      }, "non-array modifiers");
      t.assertThrows(function () {
        Checks.calculateDC(8, [
          { name: "Bad", type: "circumstance", value: 1.5 },
        ]);
      }, "non-integer modifier");
    });
  };
});
