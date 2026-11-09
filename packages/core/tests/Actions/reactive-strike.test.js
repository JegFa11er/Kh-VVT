/**
 * Session 5.5 — Reactions & Reactive Strike.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Actions/stride.js"),
      require("../../src/Core/Actions/step.js"),
      require("../../src/Core/Actions/reactive-strike.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Actions — Reactions & Reactive Strike",
      register: factory(
        root.PF2e.Core.GridMap,
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Actions.Stride,
        root.PF2e.Core.Actions.Step,
        root.PF2e.Core.Actions.ReactiveStrike,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  GridMap,
  Combatant,
  Stride,
  Step,
  ReactiveStrike,
) {
  "use strict";

  if (!GridMap || !Combatant || !Stride || !Step || !ReactiveStrike) {
    throw new Error(
      "Reactive Strike tests require GridMap, Combatant, Stride, Step and ReactiveStrike.",
    );
  }

  function openMap(cols, rows) {
    return new GridMap({ cols: cols || 7, rows: rows || 7 });
  }

  function makeCombatant(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "valeros",
          name: "Valeros",
          alliance: "player",
          initiative: 18,
          x: 1,
          y: 1,
          speedFeet: 25,
          maxActions: 3,
          maxHP: 20,
          ac: 12,
          attackBonus: 9,
          damage: "1d8+4",
          agile: false,
        },
        overrides || {},
      ),
    );
  }

  function makeGoblin(overrides) {
    return makeCombatant(
      Object.assign(
        {
          id: "goblin",
          name: "Goblin",
          alliance: "enemy",
          initiative: 15,
          x: 2,
          y: 1,
          maxHP: 6,
          ac: 16,
          attackBonus: 8,
          damage: "1d6+1",
          agile: true,
        },
        overrides || {},
      ),
    );
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

  return function registerReactiveStrikeTests(t) {
    // ------------------------------------------------------- reaction budget

    t.test("a combatant starts with 1 reaction and resetTurn restores it", function () {
      const combatant = makeCombatant();

      t.assertEqual(combatant.maxReactions, 1);
      t.assertEqual(combatant.reactionsRemaining, 1);
      t.assertTrue(combatant.canSpendReaction());

      t.assertEqual(combatant.spendReaction(), 0);
      t.assertTrue(!combatant.canSpendReaction());

      combatant.resetTurn();

      t.assertEqual(combatant.reactionsRemaining, 1);
      t.assertTrue(combatant.canSpendReaction());
    });

    t.test("spending a reaction with no budget throws", function () {
      const combatant = makeCombatant({ reactionsRemaining: 0 });

      t.assertTrue(!combatant.canSpendReaction());
      t.assertThrows(function () {
        combatant.spendReaction();
      }, "no reaction available");
    });

    // ------------------------------------------------------- Stride trigger

    t.test("Stride from a threatened square provokes one Reactive Strike", function () {
      const valeros = makeCombatant({ x: 1, y: 1 });
      const goblin = makeGoblin({ x: 2, y: 1 });
      const combatants = [valeros, goblin];

      const result = Stride.performStride({
        combatant: valeros,
        map: openMap(),
        destination: { x: 1, y: 3 },
        combatants: combatants,
        rollD20: fixedD20(10),
        rollDamageDie: fixedDamage(3),
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.reactions.length, 1);

      const reaction = result.reaction;
      t.assertTrue(reaction.ok);
      t.assertEqual(reaction.attackerId, "goblin");
      t.assertEqual(reaction.targetId, "valeros");
      t.assertEqual(reaction.attackRoll, 10);
      t.assertEqual(reaction.attackModifier, 8);
      t.assertEqual(reaction.mapPenalty, 0);
      t.assertEqual(reaction.degree, "SUCCESS");
      t.assertEqual(reaction.damage.total, 4);
      t.assertEqual(reaction.hpBefore, 20);
      t.assertEqual(reaction.hpAfter, 16);

      t.assertEqual(goblin.reactionsRemaining, 0, "the reaction is spent");
      t.assertEqual(goblin.actionsRemaining, 3, "reactions do not spend actions");
      t.assertEqual(goblin.attacksThisTurn, 0, "Reactive Strike does not advance MAP");
      t.assertEqual(valeros.actionsRemaining, 2, "Stride still spends its action");
      t.assertEqual(valeros.currentHP, 16);
      t.assertEqual(valeros.x, 1);
      t.assertEqual(valeros.y, 3);
      t.assertEqual(result.movementInterrupted, false);
      t.assertEqual(result.destinationReached, true);
    });

    t.test("Step from a threatened square does not provoke a reaction", function () {
      const valeros = makeCombatant({ x: 1, y: 1 });
      const goblin = makeGoblin({ x: 2, y: 1 });

      const result = Step.performStep({
        combatant: valeros,
        map: openMap(),
        destination: { x: 1, y: 2 },
      });

      t.assertTrue(result.ok);
      t.assertEqual(valeros.currentHP, 20);
      t.assertEqual(valeros.actionsRemaining, 2);
      t.assertEqual(goblin.reactionsRemaining, 1, "Step ignores threatened squares");
      t.assertEqual(goblin.attacksThisTurn, 0);
    });

    t.test("entering a threatened square does not provoke on arrival", function () {
      const valeros = makeCombatant({ x: 3, y: 5 });
      const goblin = makeGoblin({ x: 5, y: 5 });
      const combatants = [valeros, goblin];

      const result = Stride.performStride({
        combatant: valeros,
        map: openMap(),
        destination: { x: 4, y: 5 },
        combatants: combatants,
        rollD20: fixedD20(10),
        rollDamageDie: fixedDamage(3),
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.reactions.length, 0);
      t.assertEqual(goblin.reactionsRemaining, 1);
      t.assertEqual(valeros.currentHP, 20);
    });

    t.test("an enemy with no reaction left does not trigger", function () {
      const valeros = makeCombatant({ x: 1, y: 1 });
      const goblin = makeGoblin({ x: 2, y: 1, reactionsRemaining: 0 });

      const result = Stride.performStride({
        combatant: valeros,
        map: openMap(),
        destination: { x: 1, y: 3 },
        combatants: [valeros, goblin],
        rollD20: fixedD20(10),
        rollDamageDie: fixedDamage(3),
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.reactions.length, 0);
      t.assertEqual(goblin.reactionsRemaining, 0);
      t.assertEqual(valeros.currentHP, 20);
      t.assertEqual(valeros.x, 1);
      t.assertEqual(valeros.y, 3);
    });

    t.test("the same enemy cannot trigger twice during one Stride", function () {
      const valeros = makeCombatant({ x: 1, y: 1 });
      const goblin = makeGoblin({ x: 2, y: 1 });

      const result = Stride.performStride({
        combatant: valeros,
        map: openMap(),
        destination: { x: 3, y: 2 },
        combatants: [valeros, goblin],
        rollD20: fixedD20(10),
        rollDamageDie: fixedDamage(1),
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.reactions.length, 1);
      t.assertEqual(goblin.reactionsRemaining, 0);
      t.assertEqual(valeros.currentHP, 18);
    });

    t.test("a defeat during the reaction stops the movement immediately", function () {
      const valeros = makeCombatant({ x: 1, y: 1, currentHP: 4 });
      const goblin = makeGoblin({ x: 2, y: 1 });
      const combatants = [valeros, goblin];

      const result = Stride.performStride({
        combatant: valeros,
        map: openMap(),
        destination: { x: 1, y: 3 },
        combatants: combatants,
        rollD20: fixedD20(10),
        rollDamageDie: fixedDamage(6),
      });

      t.assertTrue(result.ok);
      t.assertTrue(result.movementInterrupted);
      t.assertEqual(result.destinationReached, false);
      t.assertDeepEqual(result.stoppedAt, { x: 1, y: 1 });
      t.assertEqual(result.movedPath.length, 1, "the mover never enters the next square");
      t.assertEqual(result.movedCostFeet, 0);
      t.assertEqual(valeros.currentHP, 0);
      t.assertEqual(valeros.isDefeated, true);
      t.assertEqual(valeros.x, 1);
      t.assertEqual(valeros.y, 1);
      t.assertEqual(goblin.reactionsRemaining, 0);
      t.assertEqual(result.reactions[0].targetDefeated, true);
    });

    // ---------------------------------------------------- MAP independence

    t.test("Reactive Strike ignores and does not advance MAP", function () {
      const valeros = makeCombatant({ x: 1, y: 1 });
      const goblin = makeGoblin({ x: 2, y: 1, attacksThisTurn: 2 });

      const result = ReactiveStrike.performReactiveStrike({
        attacker: goblin,
        target: valeros,
        map: openMap(),
        rollD20: fixedD20(10),
        rollDamageDie: fixedDamage(2),
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.mapPenalty, 0);
      t.assertEqual(result.multipleAttackPenalty, 0);
      t.assertEqual(result.attackModifier, 8, "full attack bonus, no -8 agile MAP");
      t.assertEqual(result.attackModifiers.length, 0);
      t.assertEqual(goblin.attacksThisTurn, 2, "MAP counter is unchanged");
      t.assertEqual(goblin.reactionsRemaining, 0);
      t.assertEqual(goblin.actionsRemaining, 3, "no action was spent");
      t.assertEqual(valeros.currentHP, 17);
    });

    t.test("Reactive Strike uses the shared attack and AC modifier pipeline", function () {
      const valeros = makeCombatant({ x: 1, y: 1 });
      const goblin = makeGoblin({ x: 2, y: 1 });
      goblin.addCondition("frightened", 1);
      valeros.addCondition("off-guard");

      const result = ReactiveStrike.performReactiveStrike({
        attacker: goblin,
        target: valeros,
        map: openMap(),
        rollD20: fixedD20(10),
        rollDamageDie: fixedDamage(2),
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.attackBonus, 8);
      t.assertEqual(result.attackModifier, 7, "Frightened 1 is -1 status to the attack");
      t.assertEqual(result.attackModifiers.length, 1);
      t.assertEqual(result.attackModifiers[0].source, "frightened");
      t.assertEqual(result.attackModifiers[0].type, "status");
      t.assertEqual(result.attackModifiers[0].value, -1);

      t.assertEqual(result.targetACBase, 12);
      t.assertEqual(result.targetAC, 10, "Off-Guard is -2 circumstance AC");
      t.assertEqual(result.targetACModifiers.length, 1);
      t.assertEqual(result.targetACModifiers[0].source, "off-guard");
      t.assertEqual(result.targetACModifiers[0].value, -2);
    });

    t.test("Reactive Strike fails without a reaction and changes nothing", function () {
      const valeros = makeCombatant({ x: 1, y: 1 });
      const goblin = makeGoblin({ x: 2, y: 1, reactionsRemaining: 0 });

      const result = ReactiveStrike.performReactiveStrike({
        attacker: goblin,
        target: valeros,
        map: openMap(),
      });

      t.assertTrue(!result.ok);
      t.assertEqual(
        result.reason,
        ReactiveStrike.REACTIVE_STRIKE_REASONS.NO_REACTION,
      );
      t.assertEqual(result.reason, "no-reaction");
      t.assertEqual(goblin.reactionsRemaining, 0);
      t.assertEqual(valeros.currentHP, 20);
    });

    t.test("Reactive Strike rejects targets outside reach without spending a reaction", function () {
      const valeros = makeCombatant({ x: 4, y: 1 });
      const goblin = makeGoblin({ x: 2, y: 1 });

      const result = ReactiveStrike.performReactiveStrike({
        attacker: goblin,
        target: valeros,
        map: openMap(),
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, "out-of-reach");
      t.assertEqual(goblin.reactionsRemaining, 1);
    });

    // ------------------------------------------------ concealment & visibility

    t.test("a failed flat check spends the reaction without advancing MAP", function () {
      const valeros = makeCombatant({ x: 1, y: 1 });
      const goblin = makeGoblin({ x: 2, y: 1 });
      valeros.addCondition("hidden");

      const result = ReactiveStrike.performReactiveStrike({
        attacker: goblin,
        target: valeros,
        map: openMap(),
        rollFlatCheck: function () {
          return 4;
        },
        rollD20: function () {
          return 20;
        },
      });

      t.assertTrue(result.ok);
      t.assertTrue(result.automaticMiss);
      t.assertTrue(!result.hit);
      t.assertDeepEqual(result.flatCheck, {
        passed: false,
        dc: 11,
        roll: 4,
        condition: "hidden",
      });
      t.assertEqual(result.attackRoll, null);
      t.assertEqual(goblin.reactionsRemaining, 0, "the reaction is spent");
      t.assertEqual(goblin.attacksThisTurn, 0, "Reactive Strike never advances MAP");
      t.assertEqual(valeros.currentHP, 20);
    });

    t.test("a Hidden attacker makes the target Off-Guard through the shared pipeline", function () {
      const valeros = makeCombatant({ x: 1, y: 1, ac: 12 });
      const goblin = makeGoblin({ x: 2, y: 1 });
      goblin.addCondition("hidden");

      const result = ReactiveStrike.performReactiveStrike({
        attacker: goblin,
        target: valeros,
        map: openMap(),
        rollD20: fixedD20(10),
        rollDamageDie: fixedDamage(2),
      });

      t.assertTrue(result.ok);
      t.assertTrue(result.hiddenAttacker);
      t.assertEqual(result.targetACBase, 12);
      t.assertEqual(result.targetAC, 10);
      t.assertEqual(result.targetACModifiers.length, 1);
      t.assertEqual(result.targetACModifiers[0].name, "Hidden Attacker");
      t.assertEqual(result.targetACModifiers[0].value, -2);
      t.assertEqual(goblin.reactionsRemaining, 0);
      t.assertEqual(goblin.attacksThisTurn, 0);
    });

    t.test("an Undetected target rejects the reaction without spending it", function () {
      const valeros = makeCombatant({ x: 1, y: 1 });
      const goblin = makeGoblin({ x: 2, y: 1 });
      valeros.addCondition("undetected");

      const result = ReactiveStrike.performReactiveStrike({
        attacker: goblin,
        target: valeros,
        map: openMap(),
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, "target-undetected");
      t.assertEqual(goblin.reactionsRemaining, 1);
      t.assertEqual(goblin.attacksThisTurn, 0);
    });

    t.test("findThreatenedEnemies returns only armed living hostiles in reach", function () {
      const valeros = makeCombatant({ x: 1, y: 1 });
      const goblin = makeGoblin({ x: 2, y: 1 });
      const ally = makeCombatant({ id: "merisiel", name: "Merisiel", x: 1, y: 2 });
      const spent = makeGoblin({
        id: "hobgoblin",
        name: "Hobgoblin",
        x: 0,
        y: 0,
        reactionsRemaining: 0,
      });
      const dead = makeGoblin({
        id: "dead-goblin",
        name: "Dead Goblin",
        x: 1,
        y: 0,
        currentHP: 0,
      });

      const threats = ReactiveStrike.findThreatenedEnemies({
        mover: valeros,
        cell: { x: 1, y: 1 },
        combatants: [valeros, ally, goblin, spent, dead],
      });

      t.assertEqual(threats.length, 1);
      t.assertEqual(threats[0].id, "goblin");
    });
  };
});
