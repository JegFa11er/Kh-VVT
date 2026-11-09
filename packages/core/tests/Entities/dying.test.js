/**
 * Phase 10 — Dying, Wounded, Unconscious, Recovery Checks and Healing.
 * Runs under the project harness in both Node and the browser.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../../src/Core/Entities/combatant.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Entities — Dying, Wounded, Unconscious & Healing",
      register: factory(root.PF2e.Core.Combatant),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Combatant) {
  "use strict";

function makeHero(overrides) {
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
        maxHP: 10,
        currentHP: 10,
        ac: 18,
        attackBonus: 5,
        damage: { formula: "1d8", type: "slashing" },
        saves: { fortitude: 4, reflex: 4, will: 4 },
      },
      overrides || {},
    ),
  );
}

function findModifier(modifiers, type, value) {
  return modifiers.some(function (modifier) {
    return modifier.type === type && modifier.value === value;
  });
}

  return function registerDyingTests(t) {
  t.test("dropping to 0 HP grants Dying 1, Unconscious, and Prone", function () {
    const hero = makeHero();

    hero.takeDamage(10, { type: "slashing" });

    t.assertEqual(hero.currentHP, 0);
    t.assertEqual(hero.hasCondition("unconscious"), true);
    t.assertEqual(hero.hasCondition("prone"), true);
    t.assertEqual(hero.hasCondition("dying"), true);
    t.assertEqual(hero.getCondition("dying").value, 1);
  });

  t.test("HP floors at 0 and overkill is not subtracted below 0", function () {
    const hero = makeHero();

    const result = hero.takeDamage(25, { type: "slashing" });

    t.assertEqual(hero.currentHP, 0);
    t.assertEqual(result.damageTaken, 10);
    t.assertEqual(result.damageApplied, 25);
    t.assertEqual(hero.getCondition("dying").value, 1);
  });

  t.test("Wounded adds to the initial Dying value", function () {
    const hero = makeHero();
    hero.addCondition("wounded", 1);

    hero.takeDamage(10, { type: "slashing" });

    // 1 base + 1 Wounded = Dying 2
    t.assertEqual(hero.getCondition("dying").value, 2);
  });

  t.test("a critical hit starts Dying at 2 + Wounded", function () {
    const hero = makeHero();
    hero.addCondition("wounded", 1);

    hero.takeDamage(10, { type: "slashing", isCrit: true });

    t.assertEqual(hero.getCondition("dying").value, 3);
  });

  t.test("damage while already dying advances the dying track", function () {
    const hero = makeHero();
    hero.takeDamage(10, { type: "slashing" }); // Dying 1

    hero.takeDamage(5, { type: "slashing" }); // Dying 2
    t.assertEqual(hero.currentHP, 0);
    t.assertEqual(hero.getCondition("dying").value, 2);

    hero.takeDamage(5, { type: "slashing", isCrit: true }); // Dying 4 -> dead
    t.assertEqual(hero.getCondition("dying").value, 4);
    t.assertTrue(hero.isDefeated);
  });

  t.test("zero damage does not advance the dying track", function () {
    const hero = makeHero();
    hero.takeDamage(10, { type: "slashing" }); // Dying 1

    hero.takeDamage(0, { type: "slashing" });

    t.assertEqual(hero.getCondition("dying").value, 1);
  });

  t.test("Dying 4 from Wounded kills immediately", function () {
    const hero = makeHero();
    hero.addCondition("wounded", 3);

    hero.takeDamage(10, { type: "slashing" });

    t.assertEqual(hero.getCondition("dying").value, 4);
    t.assertEqual(hero.isDefeated, true);
  });

  t.test("a dead creature cannot be healed", function () {
    const hero = makeHero();
    hero.addCondition("wounded", 3);
    hero.takeDamage(10, { type: "slashing" }); // Dying 4

    const result = hero.applyHealing(5);

    t.assertDeepEqual(result, { ok: false, reason: "dead" });
    t.assertEqual(hero.currentHP, 0);
    t.assertEqual(hero.hasCondition("dying"), true);
  });

  t.test("healing removes Dying, wakes the creature, and adds Wounded 1", function () {
    const hero = makeHero();
    hero.takeDamage(10, { type: "slashing" }); // Dying 1

    const result = hero.applyHealing(5);

    t.assertTrue(result.ok);
    t.assertEqual(result.healed, 5);
    t.assertEqual(result.wokeUp, true);
    t.assertEqual(hero.currentHP, 5);
    t.assertEqual(hero.hasCondition("dying"), false);
    t.assertEqual(hero.hasCondition("unconscious"), false);
    t.assertEqual(hero.hasCondition("wounded"), true);
    t.assertEqual(hero.getCondition("wounded").value, 1);
    t.assertEqual(hero.isDefeated, false);
  });

  t.test("Wounded increases again when dying a second time and healed", function () {
    const hero = makeHero();
    hero.takeDamage(10, { type: "slashing" }); // Dying 1
    hero.applyHealing(5); // Wounded 1

    hero.takeDamage(5, { type: "slashing" }); // Dying 2 (1 + Wounded 1)
    t.assertEqual(hero.getCondition("dying").value, 2);

    hero.applyHealing(5); // Wounded 2
    t.assertEqual(hero.getCondition("wounded").value, 2);
    t.assertEqual(hero.currentHP, 5);
  });

  t.test("unconscious cannot act", function () {
    const hero = makeHero();
    hero.takeDamage(10, { type: "slashing" });

    t.assertDeepEqual(hero.canAct(), { ok: false, reason: "unconscious" });
  });

  t.test("a conscious creature can act", function () {
    const hero = makeHero();

    t.assertDeepEqual(hero.canAct(), { ok: true });
  });

  t.test("Unconscious contributes Off-Guard, Prone, and -4 status to AC/Reflex", function () {
    const hero = makeHero();
    hero.takeDamage(10, { type: "slashing" });

    const acModifiers = hero.getDCModifiers("ac");
    t.assertTrue(
      findModifier(acModifiers, "circumstance", -2),
      "expected the -2 circumstance Off-Guard penalty to AC",
    );
    t.assertTrue(
      findModifier(acModifiers, "status", -4),
      "expected the -4 status penalty to AC",
    );

    const attackModifiers = hero.getConditionModifiers("attack");
    t.assertTrue(
      findModifier(attackModifiers, "circumstance", -2),
      "expected the -2 circumstance Prone penalty to attacks",
    );

    const reflexSave = hero.getSaveModifiers("reflex");
    t.assertTrue(
      findModifier(reflexSave, "status", -4),
      "expected the -4 status penalty to Reflex saves",
    );

    const reflexDC = hero.getDCModifiers("reflex");
    t.assertTrue(
      findModifier(reflexDC, "status", -4),
      "expected the -4 status penalty to Reflex DC",
    );

    const fortitudeSave = hero.getSaveModifiers("fortitude");
    t.assertTrue(
      !findModifier(fortitudeSave, "status", -4),
      "Fortitude saves must not receive the Reflex-only penalty",
    );
  });

  // ------------------------------------------------------------- recovery checks

  t.test("recovery failure increases Dying by 1", function () {
    const hero = makeHero();
    hero.takeDamage(10, { type: "slashing" }); // Dying 1, DC 11

    hero.resetTurn({ d20: 5, tickConditions: false });

    t.assertEqual(hero.getCondition("dying").value, 2);
    t.assertEqual(hero.lastRecoveryCheck.degree, "FAILURE");
  });

  t.test("recovery success reduces Dying by 1", function () {
    const hero = makeHero();
    hero.addCondition("wounded", 1);
    hero.takeDamage(10, { type: "slashing" }); // Dying 2, DC 12

    hero.resetTurn({ d20: 12, tickConditions: false });

    t.assertEqual(hero.getCondition("dying").value, 1);
    t.assertEqual(hero.lastRecoveryCheck.degree, "SUCCESS");
  });

  t.test("recovery critical success reduces Dying by 2", function () {
    const hero = makeHero();
    hero.addCondition("wounded", 2);
    hero.takeDamage(10, { type: "slashing" }); // Dying 3, DC 13

    hero.resetTurn({ d20: 20, tickConditions: false });

    // Natural 20 upgrades the success to a critical success: Dying 3 - 2 = 1.
    t.assertEqual(hero.getCondition("dying").value, 1);
    t.assertEqual(hero.lastRecoveryCheck.degree, "CRITICAL_SUCCESS");
  });

  t.test("recovery critical failure increases Dying by 2 and can kill", function () {
    const hero = makeHero();
    hero.addCondition("wounded", 2);
    hero.takeDamage(10, { type: "slashing" }); // Dying 3, DC 13

    hero.resetTurn({ d20: 1, tickConditions: false });

    t.assertEqual(hero.getCondition("dying").value, 4);
    t.assertEqual(hero.isDefeated, true);
    t.assertEqual(hero.lastRecoveryCheck.degree, "CRITICAL_FAILURE");
  });

  t.test("reducing Dying to 0 stabilizes at 0 HP and stays unconscious", function () {
    const hero = makeHero();
    hero.takeDamage(10, { type: "slashing" }); // Dying 1, DC 11

    hero.resetTurn({ d20: 11, tickConditions: false });

    t.assertEqual(hero.currentHP, 0);
    t.assertEqual(hero.hasCondition("dying"), false);
    t.assertEqual(hero.hasCondition("unconscious"), true);
    t.assertTrue(hero.lastRecoveryCheck.removed);
  });

  t.test("resetTurn ignores recovery when the creature is not dying", function () {
    const hero = makeHero();

    hero.resetTurn({ d20: 1, tickConditions: false });

    t.assertEqual(hero.lastRecoveryCheck, null);
    t.assertEqual(hero.hasCondition("dying"), false);
  });
  };
});
