/**
 * Phase 13 — Advanced Conditions & Durations.
 *
 * Covers:
 *   - Paralyzed (Off-Guard + action lock);
 *   - Slowed and Stunned action-pool reductions at the start of a turn;
 *   - round-based condition durations;
 *   - the affliction stage engine and its end-of-turn saving throw.
 *
 * Runs under the project harness in both Node and the browser.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Entities/conditions.js"),
      require("../../src/Core/Encounter/encounter.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Entities — Advanced Conditions, Durations & Afflictions",
      register: factory(
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Conditions,
        root.PF2e.Core.Encounter,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Combatant,
  Conditions,
  Encounter,
) {
  "use strict";

function makeCombatant(overrides) {
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
        maxHP: 20,
        currentHP: 20,
        ac: 18,
        attackBonus: 7,
        damage: { formula: "1d8+2", type: "slashing" },
        saves: { fortitude: 4, reflex: 4, will: 4 },
      },
      overrides || {},
    ),
  );
}

function makeAffliction(overrides) {
  return Object.assign(
    {
      id: "test-poison",
      name: "Test Poison",
      saveType: "fortitude",
      saveDC: 15,
      maxStage: 3,
    },
    overrides || {},
  );
}

  return function registerAfflictionDurationTests(t) {
  // ------------------------------------------------------------- paralyzed

  t.test("Paralyzed grants Off-Guard and blocks canAct()", function () {
    const hero = makeCombatant();

    hero.addCondition("paralyzed");

    const action = hero.canAct();
    t.assertEqual(action.ok, false);
    t.assertEqual(action.reason, "paralyzed");

    const acModifiers = hero.getConditionModifiers("ac");
    const offGuard = acModifiers.find(function (modifier) {
      return modifier.source === "off-guard" && modifier.value === -2;
    });
    t.assertTrue(offGuard, "Paralyzed must contribute -2 Off-Guard AC");

    const attackModifiers = hero.getConditionModifiers("attack");
    t.assertEqual(
      attackModifiers.some(function (modifier) {
        return modifier.value === -2;
      }),
      false,
      "Paralyzed must not penalize the creature's own attack rolls",
    );
  });

  // -------------------------------------------------------- slowed / stunned

  t.test("Slowed 1 leaves 2 actions at the start of the turn", function () {
    const hero = makeCombatant();
    hero.addCondition("slowed", 1);

    hero.resetTurn();

    t.assertEqual(hero.actionsRemaining, 2);
    t.assertEqual(hero.hasCondition("slowed"), true);
    t.assertEqual(hero.canAct().ok, true);
    t.assertEqual(hero.lastActionLoss.lost, 1);
  });

  t.test("Stunned 1 removes 1 action, ends, and canAct() returns true", function () {
    const hero = makeCombatant();
    hero.addCondition("stunned", 1);

    t.assertEqual(hero.canAct().ok, false);
    t.assertEqual(hero.canAct().reason, "stunned");

    hero.resetTurn();

    t.assertEqual(hero.actionsRemaining, 2);
    t.assertEqual(hero.hasCondition("stunned"), false);
    t.assertEqual(hero.canAct().ok, true);
    t.assertEqual(hero.lastActionLoss.lost, 1);
  });

  t.test("Stunned overrides Slowed when both reduce the pool", function () {
    const hero = makeCombatant();
    hero.addCondition("stunned", 1);
    hero.addCondition("slowed", 2);

    hero.resetTurn();

    // Only the larger value (Slowed 2) is spent, not 1 + 2.
    t.assertEqual(hero.actionsRemaining, 1);
    t.assertEqual(hero.hasCondition("stunned"), false);
    t.assertEqual(hero.hasCondition("slowed"), true);
  });

  t.test("Stunned debt carries into the next turn", function () {
    const hero = makeCombatant();
    hero.addCondition("stunned", 5);

    hero.resetTurn();
    t.assertEqual(hero.actionsRemaining, 0);
    t.assertEqual(hero.getConditionValue("stunned"), 2);
    t.assertEqual(hero.canAct().ok, false);

    hero.resetTurn();
    t.assertEqual(hero.actionsRemaining, 1);
    t.assertEqual(hero.hasCondition("stunned"), false);
    t.assertEqual(hero.canAct().ok, true);
  });

  // -------------------------------------------------------------- durations

  t.test("start-origin duration expires after N full rounds", function () {
    const hero = makeCombatant({ encounterRound: 1 });
    hero.addCondition("frightened", 2, { duration: 2, durationOrigin: "start" });

    const start = hero.getCondition("frightened");
    t.assertEqual(start.duration, 2);
    t.assertEqual(start.durationOrigin, "start");
    t.assertEqual(start.appliedRound, 1);

    t.assertEqual(hero.tickDurations({ phase: "start", round: 1 }).length, 0);
    t.assertEqual(hero.tickDurations({ phase: "start", round: 2 }).length, 0);
    t.assertEqual(hero.hasCondition("frightened"), true);

    const expired = hero.tickDurations({ phase: "start", round: 3 });
    t.assertEqual(expired.length, 1);
    t.assertEqual(expired[0].name, "frightened");
    t.assertEqual(hero.hasCondition("frightened"), false);
  });

  t.test("end-origin duration expires at the end of its final round", function () {
    const hero = makeCombatant({ encounterRound: 1 });
    hero.addCondition("slowed", 1, { duration: 1, durationOrigin: "end" });

    t.assertEqual(hero.tickDurations({ phase: "start", round: 1 }).length, 0);
    const expired = hero.tickDurations({ phase: "end", round: 1 });

    t.assertEqual(expired.length, 1);
    t.assertEqual(expired[0].name, "slowed");
    t.assertEqual(hero.hasCondition("slowed"), false);
  });

  t.test("duration metadata round-trips through getCondition()", function () {
    const hero = makeCombatant({ encounterRound: 2 });
    hero.addCondition("slowed", 2, { duration: 3, durationOrigin: "end" });

    const record = hero.getCondition("slowed");
    t.assertEqual(record.value, 2);
    t.assertEqual(record.duration, 3);
    t.assertEqual(record.durationOrigin, "end");
    t.assertEqual(record.appliedRound, 2);
  });

  t.test("Encounter round clock expires a start-origin condition", function () {
    const hero = makeCombatant({ id: "hero", initiative: 10 });
    const ally = makeCombatant({
      id: "ally",
      name: "Ally",
      initiative: 5,
      x: 1,
      y: 0,
    });
    const encounter = new Encounter({ combatants: [ally, hero] });

    encounter.startEncounter();
    t.assertEqual(encounter.activeCombatant.id, "hero");
    hero.addCondition("slowed", 1, { duration: 1, durationOrigin: "start" });
    t.assertEqual(hero.getCondition("slowed").appliedRound, 1);

    encounter.nextTurn();
    t.assertEqual(encounter.round, 1);
    t.assertEqual(hero.hasCondition("slowed"), true);

    const result = encounter.nextTurn();
    t.assertEqual(result.round, 2);
    t.assertEqual(hero.hasCondition("slowed"), false);
  });

  // ------------------------------------------------------------ afflictions

  t.test("affliction Failure increases stage by 1 and Success decreases it", function () {
    const hero = makeCombatant();
    hero.addAffliction(makeAffliction());

    const initial = hero.getAffliction("test-poison");
    t.assertEqual(initial.type, "affliction");
    t.assertEqual(initial.stage, 1);
    t.assertEqual(initial.maxStage, 3);

    // Fortitude +4, DC 15: d20(5) -> 9 vs 15 = FAILURE.
    hero.endTurn({ afflictionD20: 5 });
    t.assertEqual(hero.getAffliction("test-poison").stage, 2);

    // d20(18) -> 22 vs 15 = SUCCESS.
    hero.endTurn({ afflictionD20: 18 });
    t.assertEqual(hero.getAffliction("test-poison").stage, 1);
  });

  t.test("critical success can cure an affliction and remove it", function () {
    const hero = makeCombatant();
    hero.addAffliction(makeAffliction({ stage: 2 }));

    // d20(20) -> 24 vs 15: success shifted up to CRITICAL_SUCCESS -> -2.
    const result = hero.endTurn({ afflictionD20: 20 });

    t.assertEqual(result.afflictionTick.changed, true);
    t.assertEqual(result.curedAfflictions.length, 1);
    t.assertEqual(result.curedAfflictions[0].id, "test-poison");
    t.assertEqual(hero.hasAffliction("test-poison"), false);
    t.assertEqual(hero.afflictions.length, 0);
  });

  t.test("critical failure raises the stage by 2 but respects maxStage", function () {
    const hero = makeCombatant();
    hero.addAffliction(makeAffliction({ stage: 1, maxStage: 3 }));

    // d20(1) -> 5 vs 15: failure shifted down to CRITICAL_FAILURE -> +2.
    hero.endTurn({ afflictionD20: 1 });
    t.assertEqual(hero.getAffliction("test-poison").stage, 3);

    // A later critical failure cannot exceed the authored maximum.
    hero.endTurn({ afflictionD20: 1 });
    t.assertEqual(hero.getAffliction("test-poison").stage, 3);
  });

  t.test("affliction saves use the combatant's save modifiers", function () {
    const hero = makeCombatant({ saves: { fortitude: 5, reflex: 0, will: 0 } });
    hero.addAffliction(makeAffliction({ saveDC: 15 }));

    // Fortitude +5: d20(10) -> 15 vs 15 = SUCCESS, stage 1 -> 0 (cured).
    const result = hero.endTurn({ afflictionD20: 10 });

    t.assertEqual(result.afflictionTick.results[0].modifier, 5);
    t.assertEqual(result.afflictionTick.results[0].degree, "SUCCESS");
    t.assertEqual(hero.hasAffliction("test-poison"), false);
  });

  // ------------------------------------------------------------- validation

  t.test("invalid affliction save types are rejected", function () {
    const hero = makeCombatant();

    t.assertThrows(function () {
      hero.addAffliction(makeAffliction({ saveType: "athletics" }));
    }, "saveType must be fortitude/reflex/will");

    t.assertEqual(hero.afflictions.length, 0);
  });

  t.test("unknown condition slugs still contribute no modifiers", function () {
    const hero = makeCombatant();
    hero.addCondition("homebrew-future-condition");

    t.assertEqual(hero.getConditionModifiers("all").length, 0);
    t.assertEqual(Conditions.isKnownCondition("homebrew-future-condition"), false);
  });
  };
});
