/**
 * Reach-10 "two diagonals" exception + Grabbed/Restrained action restrictions.
 *
 * Covers the Remastered rules that were deliberately deferred by the earlier
 * compliance audit:
 *   - a 10-ft reach can attack the second diagonal square (CRB p.455) even
 *     though the 5-10-5 distance is 15 ft;
 *   - Restrained blocks attack/manipulate actions except Escape;
 *   - Grabbed forces a DC 5 flat check for manipulate actions; a failure loses
 *     the action.
 *
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Grid/distance.js"),
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Grid/flanking.js"),
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Actions/strike.js"),
      require("../../src/Core/Actions/reactive-strike.js"),
      require("../../src/Core/Actions/trip.js"),
      require("../../src/Core/Actions/escape.js"),
      require("../../src/Core/Actions/cast-spell.js"),
      require("../../src/Core/Actions/interact.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Rules — Reach-10 Exception & Grabbed/Restrained",
      register: factory(
        root.PF2e.Core.Distance3D,
        root.PF2e.Core.GridMap,
        root.PF2e.Core.Flanking,
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Actions.Strike,
        root.PF2e.Core.Actions.ReactiveStrike,
        root.PF2e.Core.Actions.Trip,
        root.PF2e.Core.Actions.Escape,
        root.PF2e.Core.Actions.CastSpell,
        root.PF2e.Core.Actions.Interact,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Distance3D,
  GridMap,
  Flanking,
  Combatant,
  Strike,
  ReactiveStrike,
  Trip,
  Escape,
  CastSpell,
  Interact,
) {
  "use strict";

  if (
    !Distance3D ||
    !GridMap ||
    !Flanking ||
    !Combatant ||
    !Strike ||
    !ReactiveStrike ||
    !Trip ||
    !Escape ||
    !CastSpell ||
    !Interact
  ) {
    throw new Error("Reach/restriction tests require the full core module set.");
  }

  function makeMap(cols, rows) {
    return new GridMap({ cols: cols || 12, rows: rows || 12 });
  }

  function makeCombatant(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "combatant",
          name: "Combatant",
          alliance: "player",
          initiative: 10,
          x: 0,
          y: 0,
          speedFeet: 25,
          maxActions: 3,
          maxHP: 30,
          ac: 16,
          attackBonus: 7,
          damage: { formula: "1d6", type: "slashing" },
          agile: false,
          saves: { fortitude: 5, reflex: 5, will: 5 },
          skills: { athletics: 8, acrobatics: 6 },
        },
        overrides || {},
      ),
    );
  }

  function makeWeapon(id, name) {
    return {
      id: id,
      name: name,
      type: "weapon",
      hands: 1,
      traits: [],
      damage: "1d8",
      damageType: "slashing",
    };
  }

  return function registerReachAndRestrictionTests(t) {
    // ------------------------------------------------ reach-10 second diagonal
    t.test("raw distance to the second diagonal stays 15 ft", function () {
      const a = { x: 0, y: 0 };
      const b = { x: 2, y: 2 };

      t.assertEqual(Distance3D.getDistance3D(a, b), 15);
      t.assertEqual(Distance3D.distance3DSquares(2, 2, 0), 3);
    });

    t.test("a 10-ft reach measures the second diagonal as reachable (10 ft)", function () {
      const a = { x: 0, y: 0 };
      const b = { x: 2, y: 2 };

      t.assertEqual(Distance3D.reachDistance3DSquares(2, 2, 0, 10), 2);
      t.assertEqual(Distance3D.reachDistance3DSquares(2, 2, 0, 5), 3);
      t.assertEqual(Distance3D.getCombatantReachDistance3D(a, b, 10), 10);
      t.assertEqual(Distance3D.getCombatantReachDistance3D(a, b, 5), 15);
      t.assertEqual(Distance3D.getCombatantReachDistance(a, b, 10), 10);
      t.assertTrue(Distance3D.canReach3D(a, b, 10));
      t.assertTrue(!Distance3D.canReach3D(a, b, 5));
      t.assertTrue(Distance3D.canReach(a, b, 10));
      t.assertTrue(!Distance3D.canReach(a, b, 5));
    });

    t.test("a reach-10 Strike can target the second diagonal square", function () {
      const attacker = makeCombatant({
        id: "fighter",
        traits: ["reach"],
        attackBonus: 5,
      });
      const target = makeCombatant({
        id: "goblin",
        alliance: "enemy",
        x: 2,
        y: 2,
        ac: 16,
        maxHP: 20,
      });

      const evaluation = Strike.evaluateStrike({
        attacker: attacker,
        target: target,
        map: makeMap(),
      });

      t.assertTrue(evaluation.ok);
      t.assertEqual(evaluation.distanceFeet, 15, "the raw cost is still 15 ft");
      t.assertEqual(evaluation.reachDistanceFeet, 10);
      t.assertEqual(evaluation.reachFeet, 10);
    });

    t.test("a reach-5 Strike cannot target the second diagonal square", function () {
      const attacker = makeCombatant({ id: "fighter", attackBonus: 5 });
      const target = makeCombatant({
        id: "goblin",
        alliance: "enemy",
        x: 2,
        y: 2,
      });

      const evaluation = Strike.evaluateStrike({
        attacker: attacker,
        target: target,
        map: makeMap(),
      });

      t.assertTrue(!evaluation.ok);
      t.assertEqual(evaluation.reason, Strike.STRIKE_REASONS.OUT_OF_REACH);
      t.assertEqual(evaluation.distanceFeet, 15);
    });

    t.test("a reach-10 Strike actually resolves on the second diagonal", function () {
      const attacker = makeCombatant({
        id: "fighter",
        traits: ["reach"],
        attackBonus: 5,
      });
      const target = makeCombatant({
        id: "goblin",
        alliance: "enemy",
        x: 2,
        y: 2,
        ac: 10,
        maxHP: 20,
      });

      const result = Strike.performStrike({
        attacker: attacker,
        target: target,
        map: makeMap(),
        rollD20: function () {
          return 10;
        },
        rollDamageDie: function () {
          return 3;
        },
      });

      t.assertTrue(result.ok);
      t.assertTrue(result.hit);
      t.assertEqual(result.distanceFeet, 15);
      t.assertEqual(result.reachDistanceFeet, 10);
      t.assertEqual(target.currentHP, 17);
    });

    t.test("a reach-10 Reactive Strike threatens the second diagonal square", function () {
      const mover = makeCombatant({ id: "mover", x: 2, y: 2 });
      const reach = makeCombatant({
        id: "goblin",
        name: "Goblin",
        alliance: "enemy",
        x: 0,
        y: 0,
        traits: ["reach"],
      });
      const plain = makeCombatant({
        id: "goblin-plain",
        name: "Goblin",
        alliance: "enemy",
        x: 0,
        y: 0,
        traits: [],
      });

      const reachThreats = ReactiveStrike.findThreatenedEnemies({
        mover: mover,
        cell: { x: 2, y: 2 },
        combatants: [mover, reach],
      });
      const plainThreats = ReactiveStrike.findThreatenedEnemies({
        mover: mover,
        cell: { x: 2, y: 2 },
        combatants: [mover, plain],
      });

      t.assertEqual(reachThreats.length, 1);
      t.assertEqual(reachThreats[0].id, "goblin");
      t.assertEqual(plainThreats.length, 0);
    });

    t.test("reach-10 flanking works across the second diagonal", function () {
      const map = makeMap();
      const target = {
        id: "target",
        alliance: "enemy",
        x: 4,
        y: 4,
        isDefeated: false,
      };
      const west = {
        id: "west",
        alliance: "player",
        x: 2,
        y: 2,
        traits: ["reach"],
      };
      const east = {
        id: "east",
        alliance: "player",
        x: 6,
        y: 6,
        traits: ["reach"],
      };
      const plainWest = {
        id: "west-plain",
        alliance: "player",
        x: 2,
        y: 2,
        traits: [],
      };
      const plainEast = {
        id: "east-plain",
        alliance: "player",
        x: 6,
        y: 6,
        traits: [],
      };

      t.assertEqual(Distance3D.getDistance3D(target, west), 15);
      t.assertEqual(Distance3D.getCombatantReachDistance(target, west, 10), 10);
      t.assertTrue(Flanking.isFlanked(target, west, [west, east], map));
      t.assertTrue(!Flanking.isFlanked(target, plainWest, [plainWest, plainEast], map));
    });

    // ------------------------------------------------------------- Restrained
    t.test("Restrained blocks Strike before spending an action", function () {
      const attacker = makeCombatant({
        id: "hero",
        conditions: { restrained: 1 },
      });
      const target = makeCombatant({ id: "goblin", alliance: "enemy", x: 1, y: 0 });

      const result = Strike.performStrike({
        attacker: attacker,
        target: target,
        map: makeMap(),
        rollD20: function () {
          return 10;
        },
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, "restrained-action-blocked");
      t.assertEqual(attacker.actionsRemaining, 3);
      t.assertEqual(attacker.attacksThisTurn, 0);
      t.assertEqual(target.currentHP, target.maxHP);
    });

    t.test("Restrained blocks evaluateStrike", function () {
      const attacker = makeCombatant({ conditions: { restrained: 1 } });
      const target = makeCombatant({ id: "goblin", alliance: "enemy", x: 1, y: 0 });

      const evaluation = Strike.evaluateStrike({
        attacker: attacker,
        target: target,
        map: makeMap(),
      });

      t.assertTrue(!evaluation.ok);
      t.assertEqual(evaluation.reason, "restrained-action-blocked");
    });

    t.test("Restrained blocks an Athletics maneuver (Trip)", function () {
      const attacker = makeCombatant({
        conditions: { restrained: 1 },
        skills: { athletics: 8 },
      });
      const target = makeCombatant({ id: "goblin", alliance: "enemy", x: 1, y: 0 });

      const evaluation = Trip.evaluateTrip({
        attacker: attacker,
        target: target,
        map: makeMap(),
      });

      t.assertTrue(!evaluation.ok);
      t.assertEqual(evaluation.reason, "restrained-action-blocked");
    });

    t.test("canAct blocks attack/manipulate traits but exempts Escape", function () {
      const combatant = makeCombatant({ conditions: { restrained: 1 } });

      t.assertTrue(combatant.canAct().ok, "the no-arg gate stays backward compatible");

      const attackGate = combatant.canAct({ traits: ["attack"] });
      t.assertTrue(!attackGate.ok);
      t.assertEqual(attackGate.reason, "restrained-action-blocked");

      const manipulateGate = combatant.canAct({ traits: ["manipulate"] });
      t.assertTrue(!manipulateGate.ok);
      t.assertEqual(manipulateGate.reason, "restrained-action-blocked");

      t.assertTrue(
        combatant.canAct({ traits: ["attack"], action: "escape" }).ok,
        "Escape is the only exception",
      );
      t.assertTrue(combatant.canAct({ traits: ["attack"], isEscape: true }).ok);
      t.assertTrue(combatant.canAct({ traits: ["move"] }).ok);
    });

    t.test("a Restrained creature can still Escape its bonds", function () {
      const grappler = makeCombatant({
        id: "grappler",
        x: 0,
        y: 0,
        skills: { athletics: 8 },
      });
      const victim = makeCombatant({
        id: "victim",
        alliance: "enemy",
        x: 1,
        y: 0,
      });
      victim.addCondition("restrained", undefined, { sourceId: "grappler" });

      const evaluation = Escape.evaluateEscape({
        actor: victim,
        source: grappler,
      });
      t.assertTrue(evaluation.ok);

      const result = Escape.performEscape({
        actor: victim,
        source: grappler,
        rollD20: function () {
          return 20;
        },
      });
      t.assertTrue(result.ok);
      t.assertTrue(result.escaped);
      t.assertTrue(!victim.hasCondition("restrained"));
    });

    t.test("Restrained blocks an attack/manipulate Cast a Spell", function () {
      const caster = makeCombatant({
        id: "wiz",
        spellAttackBonus: 8,
        conditions: { restrained: 1 },
      });
      const target = makeCombatant({
        id: "goblin",
        alliance: "enemy",
        x: 2,
        y: 0,
        ac: 10,
        maxHP: 10,
      });
      const spell = {
        id: "spark",
        cost: 1,
        type: "attack",
        traits: ["attack", "manipulate"],
        damage: { formula: "1d6", type: "fire" },
      };

      const result = CastSpell.performCastSpell({
        caster: caster,
        spell: spell,
        target: target,
        combatants: [caster, target],
        rollD20: function () {
          return 10;
        },
        rollDamageDie: function () {
          return 3;
        },
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, "restrained-action-blocked");
      t.assertEqual(caster.actionsRemaining, 3);
      t.assertEqual(target.currentHP, 10);
    });

    t.test("Restrained blocks a manipulate Interact", function () {
      const sword = makeWeapon("sword", "Sword");
      const combatant = makeCombatant({
        conditions: { restrained: 1 },
        inventory: [sword],
      });

      const result = Interact.performInteract({
        combatant: combatant,
        actionType: "draw",
        item: "sword",
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, "restrained-action-blocked");
      t.assertEqual(combatant.actionsRemaining, 3);
      t.assertTrue(!combatant.isItemHeld(combatant.findInventoryItem("sword")));
    });

    // ---------------------------------------------------------------- Grabbed
    t.test("a failed DC 5 flat check loses a manipulate Cast a Spell", function () {
      const caster = makeCombatant({
        id: "wiz",
        spellDC: 15,
        conditions: { grabbed: 1 },
      });
      const target = makeCombatant({
        id: "goblin",
        alliance: "enemy",
        x: 2,
        y: 0,
        maxHP: 20,
        saves: { reflex: 0 },
      });
      const spell = {
        id: "burning-hands",
        cost: 2,
        type: "save",
        saveType: "reflex",
        basic: true,
        traits: ["manipulate", "fire"],
        damage: { formula: "1d6", type: "fire" },
      };

      const result = CastSpell.performCastSpell({
        caster: caster,
        spell: spell,
        target: target,
        rollFlatCheck: function () {
          return 4;
        },
        rollD20: function () {
          return 10;
        },
        rollDamageDie: function () {
          return 3;
        },
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, "grabbed-manipulate-failed");
      t.assertDeepEqual(result.flatCheck, {
        passed: false,
        dc: 5,
        roll: 4,
        condition: "grabbed",
      });
      t.assertEqual(caster.actionsRemaining, 1, "the 2-action cast is spent");
      t.assertEqual(target.currentHP, 20, "no spell resolved");
    });

    t.test("a passed DC 5 flat check lets the manipulate spell resolve", function () {
      const caster = makeCombatant({
        id: "wiz",
        spellDC: 15,
        conditions: { grabbed: 1 },
      });
      const target = makeCombatant({
        id: "goblin",
        alliance: "enemy",
        x: 2,
        y: 0,
        maxHP: 20,
        saves: { reflex: 0 },
      });
      const spell = {
        id: "burning-hands",
        cost: 2,
        type: "save",
        saveType: "reflex",
        basic: true,
        traits: ["manipulate", "fire"],
        damage: { formula: "1d6", type: "fire" },
      };

      const result = CastSpell.performCastSpell({
        caster: caster,
        spell: spell,
        target: target,
        rollFlatCheck: function () {
          return 5;
        },
        rollD20: function () {
          return 10;
        },
        rollDamageDie: function () {
          return 3;
        },
      });

      t.assertTrue(result.ok);
      t.assertEqual(caster.actionsRemaining, 1);
      t.assertEqual(target.currentHP, 17, "3 fire damage on a failed save");
    });

    t.test("a Grabbed caster is not gated for a non-manipulate spell", function () {
      const caster = makeCombatant({
        id: "wiz",
        spellDC: 15,
        conditions: { grabbed: 1 },
      });
      const target = makeCombatant({
        id: "goblin",
        alliance: "enemy",
        x: 2,
        y: 0,
        maxHP: 20,
        saves: { will: 0 },
      });
      const spell = {
        id: "daze",
        cost: 1,
        type: "save",
        saveType: "will",
        basic: true,
        traits: ["mental"],
        damage: { formula: "1d6", type: "mental" },
      };

      const result = CastSpell.performCastSpell({
        caster: caster,
        spell: spell,
        target: target,
        rollFlatCheck: function () {
          return 1;
        },
        rollD20: function () {
          return 10;
        },
        rollDamageDie: function () {
          return 3;
        },
      });

      t.assertTrue(result.ok, "no manipulate trait, so no flat check");
      t.assertEqual(target.currentHP, 17);
    });

    t.test("a failed DC 5 flat check loses a manipulate Interact", function () {
      const sword = makeWeapon("sword", "Sword");
      const combatant = makeCombatant({
        conditions: { grabbed: 1 },
        inventory: [sword],
      });

      const result = Interact.performInteract({
        combatant: combatant,
        actionType: "draw",
        item: "sword",
        rollFlatCheck: function () {
          return 4;
        },
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, "grabbed-manipulate-failed");
      t.assertEqual(result.flatCheck.dc, 5);
      t.assertEqual(combatant.actionsRemaining, 2);
      t.assertTrue(!combatant.isItemHeld(combatant.findInventoryItem("sword")));
    });

    t.test("a passed DC 5 flat check lets a manipulate Interact resolve", function () {
      const sword = makeWeapon("sword", "Sword");
      const combatant = makeCombatant({
        conditions: { grabbed: 1 },
        inventory: [sword],
      });

      const result = Interact.performInteract({
        combatant: combatant,
        actionType: "draw",
        item: "sword",
        rollFlatCheck: function () {
          return 5;
        },
      });

      t.assertTrue(result.ok);
      t.assertEqual(combatant.actionsRemaining, 2);
      t.assertTrue(combatant.isItemHeld(combatant.findInventoryItem("sword")));
    });
  };
});
