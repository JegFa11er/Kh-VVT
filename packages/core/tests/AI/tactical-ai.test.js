/**
 * Phase 15 — Tactical AI Engine: Aggro, Pathfinding, Flanking & Action Economy.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/AI/tactical-ai.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/AI — Tactical AI Engine",
      register: factory(
        root.PF2e.Core.GridMap,
        root.PF2e.Core.Combatant,
        root.PF2e.Core.AI.TacticalAI,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  GridMap,
  Combatant,
  TacticalAI,
) {
  "use strict";

  if (!GridMap || !Combatant || !TacticalAI) {
    throw new Error("Tactical AI tests require GridMap, Combatant and TacticalAI.");
  }

  function makeMap() {
    return new GridMap({ cols: 10, rows: 10 });
  }

  function makeHero(overrides) {
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
          maxHP: 50,
          currentHP: 50,
          ac: 18,
          attackBonus: 9,
          damage: { formula: "1d8+4", type: "slashing" },
          agile: false,
          saves: { fortitude: 9, reflex: 6, will: 5 },
          skills: { athletics: 10, acrobatics: 6, stealth: 2, perception: 7 },
        },
        overrides || {},
      ),
    );
  }

  function makeGoblin(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "goblin",
          name: "Goblin",
          alliance: "enemy",
          initiative: 15,
          x: 3,
          y: 2,
          speedFeet: 25,
          maxActions: 3,
          maxHP: 6,
          currentHP: 6,
          ac: 16,
          attackBonus: 8,
          damage: { formula: "1d6+1", type: "slashing" },
          agile: true,
          saves: { fortitude: 4, reflex: 8, will: 3 },
          skills: { athletics: 3, acrobatics: 7, stealth: 8, perception: 5 },
        },
        overrides || {},
      ),
    );
  }

  function makeSteelShield() {
    return {
      id: "steel-shield",
      name: "Steel Shield",
      hardness: 5,
      hp: 20,
      maxHP: 20,
      brokenThreshold: 10,
      acBonus: 2,
      speedPenalty: 0,
    };
  }

  function fixedD20(value) {
    return function () {
      return value;
    };
  }

  function fixedDamage(value) {
    return function () {
      return value;
    };
  }

  function strikeActions(executed) {
    return executed.filter(function (action) {
      return action.type === TacticalAI.ACTION_TYPES.STRIKE;
    });
  }

  function strikesAgainst(executed, targetId) {
    return strikeActions(executed).filter(function (action) {
      return action.targetId === targetId;
    });
  }

  return function registerTacticalAITests(t) {
    t.test("Stand priority: a prone combatant stands before anything else", function () {
      const map = makeMap();
      const hero = makeHero({
        x: 2,
        y: 2,
        conditions: { prone: 1 },
      });
      const goblin = makeGoblin({ x: 3, y: 2, maxHP: 100, currentHP: 100 });
      const combatants = [hero, goblin];

      const plan = TacticalAI.planTurn({
        combatant: hero,
        map: map,
        combatants: combatants,
      });
      t.assertEqual(plan.plan[0].type, "stand", "planner prioritises Stand");

      const result = TacticalAI.executeAITurn({
        combatant: hero,
        map: map,
        combatants: combatants,
        rollD20: fixedD20(10),
        rollDamageDie: fixedDamage(4),
      });

      t.assertTrue(result.ok);
      t.assertEqual(
        result.executedActions[0].type,
        TacticalAI.ACTION_TYPES.STAND,
        "first executed action is Stand",
      );
      t.assertEqual(hero.hasCondition("prone"), false, "Stand removed Prone");
      t.assertEqual(result.executedActions[0].ok, true);
      t.assertTrue(result.actionsSpent >= 1);
    });

    t.test("Aggro & Movement: out-of-reach AI Strides to the nearest enemy and Strikes", function () {
      const map = makeMap();
      const hero = makeHero({ x: 1, y: 1 });
      const goblin = makeGoblin({ x: 5, y: 1, maxHP: 100, currentHP: 100 });
      const combatants = [hero, goblin];

      const result = TacticalAI.executeAITurn({
        combatant: hero,
        map: map,
        combatants: combatants,
        rollD20: fixedD20(10),
        rollDamageDie: fixedDamage(4),
      });

      t.assertTrue(result.ok);
      t.assertEqual(
        result.executedActions[0].type,
        TacticalAI.ACTION_TYPES.STRIDE,
        "first action closes the distance",
      );
      t.assertTrue(hero.x !== 1 || hero.y !== 1, "the hero moved");

      const strikes = strikesAgainst(result.executedActions, "goblin");
      t.assertTrue(strikes.length >= 1, "the hero attacked after moving");
      t.assertTrue(strikes[0].ok, "the Strike resolved");
      t.assertTrue(
        strikes[0].hit === true,
        "the deterministic d20 of 10 beats the goblin's AC 16",
      );
      t.assertTrue(goblin.currentHP < 100, "the goblin lost HP");
      t.assertTrue(
        result.executedActions.every(function (action) {
          return action.actionCost === 1;
        }),
        "every executed action costs one action",
      );
    });

    t.test("Rotation: Strike -> Strike -> Raise a Shield applies shield-raised", function () {
      const map = makeMap();
      const hero = makeHero({
        x: 2,
        y: 2,
        shield: makeSteelShield(),
      });
      const goblin = makeGoblin({ x: 3, y: 2, maxHP: 100, currentHP: 100 });
      const combatants = [hero, goblin];

      const result = TacticalAI.executeAITurn({
        combatant: hero,
        map: map,
        combatants: combatants,
        rollD20: fixedD20(10),
        rollDamageDie: fixedDamage(4),
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.executedActions.length, 3, "three actions are spent");
      t.assertEqual(
        result.executedActions[0].type,
        TacticalAI.ACTION_TYPES.STRIKE,
        "first action is the MAP -0 Strike",
      );
      t.assertEqual(result.executedActions[0].mapPenalty, 0);
      t.assertEqual(
        result.executedActions[1].type,
        TacticalAI.ACTION_TYPES.STRIKE,
        "second action is the MAP -5 Strike",
      );
      t.assertEqual(result.executedActions[1].mapPenalty, -5);
      t.assertEqual(
        result.executedActions[2].type,
        TacticalAI.ACTION_TYPES.RAISE_SHIELD,
        "third action raises the shield",
      );
      t.assertEqual(hero.hasCondition("shield-raised"), true);
      t.assertEqual(result.finalState.shieldRaised, true);
      t.assertEqual(result.actionsRemaining, 0);
    });

    t.test("Target switching: a kill drops the corpse and the AI attacks the next hostile", function () {
      const map = makeMap();
      const hero = makeHero({ x: 2, y: 2 });
      const first = makeGoblin({
        id: "goblin-a",
        name: "Goblin A",
        x: 3,
        y: 2,
        maxHP: 5,
        currentHP: 5,
      });
      const second = makeGoblin({
        id: "goblin-b",
        name: "Goblin B",
        x: 2,
        y: 3,
        maxHP: 100,
        currentHP: 100,
      });
      const combatants = [hero, first, second];

      const result = TacticalAI.executeAITurn({
        combatant: hero,
        map: map,
        combatants: combatants,
        rollD20: fixedD20(20),
        rollDamageDie: fixedDamage(8),
      });

      t.assertTrue(result.ok);
      t.assertEqual(first.isDefeated, true, "the first target died");
      t.assertEqual(
        strikesAgainst(result.executedActions, "goblin-a").length,
        1,
        "the corpse is never struck again",
      );
      t.assertTrue(
        strikesAgainst(result.executedActions, "goblin-b").length >= 1,
        "the AI switched to the second hostile",
      );
      t.assertTrue(second.currentHP < 100, "the second hostile took damage");
    });

    t.test("Action pool: the AI stops exactly when actionsRemaining reaches 0", function () {
      const map = makeMap();
      const hero = makeHero({
        x: 2,
        y: 2,
        actionsRemaining: 1,
      });
      const goblin = makeGoblin({ x: 3, y: 2, maxHP: 100, currentHP: 100 });
      const combatants = [hero, goblin];

      const result = TacticalAI.executeAITurn({
        combatant: hero,
        map: map,
        combatants: combatants,
        rollD20: fixedD20(10),
        rollDamageDie: fixedDamage(4),
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.executedActions.length, 1);
      t.assertEqual(result.executedActions[0].type, "strike");
      t.assertEqual(result.actionsSpent, 1);
      t.assertEqual(result.actionsRemaining, 0);
      t.assertEqual(hero.actionsRemaining, 0);
    });

    t.test("Flanking: a free opposite square is taken with a single Step", function () {
      const map = makeMap();
      const hero = makeHero({ x: 2, y: 3 });
      const ally = makeHero({
        id: "merisiel",
        name: "Merisiel",
        x: 3,
        y: 4,
        initiative: 17,
      });
      const goblin = makeGoblin({ x: 3, y: 3, maxHP: 100, currentHP: 100 });
      const combatants = [hero, ally, goblin];

      const result = TacticalAI.executeAITurn({
        combatant: hero,
        map: map,
        combatants: combatants,
        rollD20: fixedD20(10),
        rollDamageDie: fixedDamage(4),
      });

      t.assertTrue(result.ok);
      t.assertEqual(
        result.executedActions[0].type,
        TacticalAI.ACTION_TYPES.STEP,
        "the AI steps into the flanking square",
      );
      t.assertEqual(result.executedActions[0].reason, "flank");
      t.assertEqual(hero.x, 3);
      t.assertEqual(hero.y, 2);

      const strikes = strikesAgainst(result.executedActions, "goblin");
      t.assertTrue(strikes.length >= 1);
      t.assertEqual(strikes[0].result.flanked, true, "the target is flanked");
      t.assertEqual(strikes[0].result.offGuard, true, "flanking grants Off-Guard");
    });

    t.test("AI navigates around wall when adjacent but blocked", function () {
      const map = makeMap();
      // A corner of wall blocks the diagonal between the hero and the goblin:
      // hero (2,2) and goblin (3,3) are diagonally adjacent (5 ft apart), but
      // the centre-to-centre ray passes through both wall cells, so a Strike is
      // refused with "no-line-of-sight".
      map.setBlocked(3, 2, true);
      map.setBlocked(2, 3, true);
      const hero = makeHero({ x: 2, y: 2 });
      const goblin = makeGoblin({
        x: 3,
        y: 3,
        maxHP: 100,
        currentHP: 100,
        maxReactions: 0,
      });
      const combatants = [hero, goblin];

      const result = TacticalAI.executeAITurn({
        combatant: hero,
        map: map,
        combatants: combatants,
        rollD20: fixedD20(20),
        rollDamageDie: fixedDamage(4),
      });

      t.assertTrue(result.ok);
      t.assertTrue(
        result.executedActions[0].type !== TacticalAI.ACTION_TYPES.STRIKE,
        "the AI does not Strike through the wall",
      );
      t.assertTrue(
        result.executedActions[0].type === TacticalAI.ACTION_TYPES.STRIDE ||
          result.executedActions[0].type === TacticalAI.ACTION_TYPES.STEP,
        "the AI repositions (Stride/Step) around the wall",
      );
      t.assertTrue(hero.x !== 2 || hero.y !== 2, "the hero moved off the blocked square");

      const strikes = strikesAgainst(result.executedActions, "goblin");
      t.assertTrue(strikes.length >= 1, "the AI strikes after gaining clear LoS");
      t.assertEqual(strikes[0].ok, true, "the Strike is not rejected by no-line-of-sight");
      t.assertEqual(strikes[0].hit, true, "the deterministic d20 of 20 connects");
      t.assertTrue(goblin.currentHP < 100, "the goblin lost HP");
    });

    t.test("Dying or unconscious combatants take no actions", function () {
      const map = makeMap();
      const hero = makeHero({ conditions: ["unconscious"] });
      const goblin = makeGoblin();
      const combatants = [hero, goblin];

      const result = TacticalAI.executeAITurn({
        combatant: hero,
        map: map,
        combatants: combatants,
        rollD20: fixedD20(10),
        rollDamageDie: fixedDamage(4),
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.executedActions.length, 0);
      t.assertEqual(result.actionsSpent, 0);
      t.assertEqual(result.reason, "unconscious");
    });

    t.test("Target acquisition prefers the lowest HP when approach costs tie", function () {
      const map = makeMap();
      const hero = makeHero({ x: 2, y: 2 });
      const tough = makeGoblin({
        id: "tough",
        x: 3,
        y: 2,
        maxHP: 100,
        currentHP: 100,
      });
      const wounded = makeGoblin({
        id: "wounded",
        x: 2,
        y: 3,
        maxHP: 100,
        currentHP: 20,
      });

      const target = TacticalAI.selectTarget({
        combatant: hero,
        map: map,
        combatants: [hero, tough, wounded],
      });

      t.assertTrue(target !== null);
      t.assertEqual(target.id, "wounded");
    });

    t.test("maxActions lets the host execute a single AI step", function () {
      const map = makeMap();
      const hero = makeHero({ x: 2, y: 2 });
      const goblin = makeGoblin({ x: 3, y: 2 });
      const combatants = [hero, goblin];

      const result = TacticalAI.executeAITurn({
        combatant: hero,
        map: map,
        combatants: combatants,
        maxActions: 1,
        rollD20: fixedD20(15),
        rollDamageDie: fixedDamage(4),
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.executedActions.length, 1);
      t.assertEqual(result.executedActions[0].type, TacticalAI.ACTION_TYPES.STRIKE);
      t.assertEqual(result.actionsSpent, 1);
      t.assertEqual(result.actionsRemaining, 2);
    });
  };
});
