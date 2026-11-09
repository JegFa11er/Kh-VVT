/**
 * Phase 14 — Hands, Inventory/Interact, Shield Hardness & Shield Block.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Entities/equipment.js"),
      require("../../src/Core/Entities/shield.js"),
      require("../../src/Core/Actions/interact.js"),
      require("../../src/Core/Actions/shield-block.js"),
      require("../../src/Core/Actions/raise-shield.js"),
      require("../../src/Core/Actions/grapple.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Entities — Hands, Inventory & Shields",
      register: factory(
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Equipment,
        root.PF2e.Core.Shield,
        root.PF2e.Core.Actions.Interact,
        root.PF2e.Core.Actions.ShieldBlock,
        root.PF2e.Core.Actions.RaiseShield,
        root.PF2e.Core.Actions.Grapple,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Combatant,
  Equipment,
  Shield,
  Interact,
  ShieldBlock,
  RaiseShield,
  Grapple,
) {
  "use strict";

  if (
    !Combatant ||
    !Equipment ||
    !Shield ||
    !Interact ||
    !ShieldBlock ||
    !RaiseShield ||
    !Grapple
  ) {
    throw new Error(
      "Equipment/shield tests require Combatant, Equipment, Shield, Interact, ShieldBlock, RaiseShield and Grapple.",
    );
  }

  function makeWeapon(id, name, hands, traits) {
    return {
      id: id,
      name: name,
      type: "weapon",
      hands: hands === undefined ? 1 : hands,
      traits: traits === undefined ? [] : traits,
      damage: "1d8",
      damageType: "slashing",
    };
  }

  function makeShield(overrides) {
    return Object.assign(
      {
        id: "steel-shield",
        name: "Steel Shield",
        hardness: 5,
        hp: 20,
        maxHP: 20,
        brokenThreshold: 10,
        acBonus: 2,
        speedPenalty: 0,
      },
      overrides || {},
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
          x: 3,
          y: 7,
          speedFeet: 25,
          maxActions: 3,
          maxHP: 20,
          ac: 18,
          attackBonus: 9,
          damage: "1d8+4",
          damageType: "slashing",
          agile: false,
          saves: { fortitude: 9, reflex: 6, will: 5 },
          skills: { athletics: 10, acrobatics: 6 },
        },
        overrides || {},
      ),
    );
  }

  return function registerEquipmentShieldTests(t) {
    t.test("2H weapon fills both hands and blocks drawing a shield", function () {
      const greatsword = makeWeapon("greatsword", "Greatsword", 2);
      const shield = makeShield();
      const combatant = makeCombatant({
        inventory: [greatsword, shield],
        hands: { mainHand: "greatsword" },
      });

      t.assertEqual(combatant.getFreeHandsCount(), 0);
      t.assertEqual(combatant.hands.mainHand.id, "greatsword");
      t.assertEqual(combatant.hands.offHand.id, "greatsword");
      t.assertEqual(combatant.getHeldItems().length, 1);

      const result = Interact.performInteract({
        combatant: combatant,
        actionType: "draw",
        item: "steel-shield",
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, "no-free-hand");
      t.assertEqual(combatant.actionsRemaining, 3, "a rejected draw spends nothing");
      t.assertEqual(combatant.getFreeHandsCount(), 0);
    });

    t.test("the two-hand-dN trait is treated as a two-handed weapon", function () {
      const longhammer = makeWeapon("longhammer", "Longhammer", 1, [
        "two-hand-d10",
      ]);
      const combatant = makeCombatant({
        inventory: [longhammer],
        hands: { mainHand: "longhammer" },
      });

      t.assertEqual(Equipment.getItemHands(longhammer), 2);
      t.assertEqual(combatant.getFreeHandsCount(), 0);
      t.assertEqual(combatant.hands.offHand.id, "longhammer");
    });

    t.test("Grapple without a free hand and without the grapple trait fails", function () {
      const firstDagger = makeWeapon("dagger-1", "Dagger", 1);
      const secondDagger = makeWeapon("dagger-2", "Dagger", 1);
      const attacker = makeCombatant({
        id: "merisiel",
        name: "Merisiel",
        x: 0,
        y: 0,
        inventory: [firstDagger, secondDagger],
        hands: { mainHand: "dagger-1", offHand: "dagger-2" },
        traits: [],
      });
      const target = makeCombatant({
        id: "goblin",
        name: "Goblin",
        alliance: "enemy",
        x: 1,
        y: 0,
        maxHP: 6,
        currentHP: 6,
        ac: 16,
      });

      const result = Grapple.performGrapple({
        attacker: attacker,
        target: target,
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, "no-free-hand");
      t.assertEqual(attacker.actionsRemaining, 3);
      t.assertEqual(attacker.attacksThisTurn, 0);
    });

    t.test("a weapon with the grapple trait bypasses the free-hand requirement", function () {
      const grappleWeapon = makeWeapon("garrote", "Garrote", 1, ["grapple"]);
      const offWeapon = makeWeapon("dagger", "Dagger", 1);
      const attacker = makeCombatant({
        id: "merisiel",
        name: "Merisiel",
        x: 0,
        y: 0,
        inventory: [grappleWeapon, offWeapon],
        hands: { mainHand: "garrote", offHand: "dagger" },
      });
      const target = makeCombatant({
        id: "goblin",
        name: "Goblin",
        alliance: "enemy",
        x: 1,
        y: 0,
        maxHP: 6,
        currentHP: 6,
        ac: 16,
      });

      const evaluation = Grapple.evaluateGrapple({
        attacker: attacker,
        target: target,
      });

      t.assertTrue(evaluation.ok, "the grapple trait should satisfy the hand requirement");
      t.assertEqual(evaluation.handRequirement.viaTrait, true);
      t.assertEqual(evaluation.handRequirement.freeHands, 0);
    });

    t.test("Interact draw equips a weapon and spends one action", function () {
      const sword = makeWeapon("longsword", "Longsword", 1);
      const combatant = makeCombatant({ inventory: [sword] });

      const result = Interact.performInteract({
        combatant: combatant,
        actionType: "draw",
        item: "longsword",
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.actionCost, 1);
      t.assertEqual(result.actionsLeft, 2);
      t.assertEqual(result.manipulate, true);
      t.assertEqual(result.traits[0], "manipulate");
      t.assertEqual(combatant.hands.mainHand.id, "longsword");
      t.assertEqual(combatant.hands.offHand, null);
      t.assertEqual(combatant.getFreeHandsCount(), 1);
      t.assertEqual(result.item.equipped, true);
    });

    t.test("Interact swap stows the old weapon and draws the new one", function () {
      const sword = makeWeapon("longsword", "Longsword", 1);
      const axe = makeWeapon("battleaxe", "Battleaxe", 1);
      const combatant = makeCombatant({ inventory: [sword, axe] });

      const draw = Interact.performInteract({
        combatant: combatant,
        actionType: "draw",
        item: "longsword",
      });
      t.assertTrue(draw.ok);

      const swap = Interact.performInteract({
        combatant: combatant,
        actionType: "swap",
        item: "battleaxe",
      });

      t.assertTrue(swap.ok);
      t.assertEqual(swap.actionCost, 1);
      t.assertEqual(swap.actionsLeft, 1);
      t.assertEqual(swap.previousItems.length, 1);
      t.assertEqual(swap.previousItems[0].id, "longsword");
      t.assertEqual(combatant.hands.mainHand.id, "battleaxe");
      t.assertEqual(combatant.hands.offHand, null);
      t.assertEqual(combatant.findInventoryItem("longsword").equipped, false);
      t.assertEqual(combatant.findInventoryItem("battleaxe").equipped, true);
    });

    t.test("Interact drop is a free action and stow costs one action", function () {
      const sword = makeWeapon("longsword", "Longsword", 1);
      const combatant = makeCombatant({ inventory: [sword] });
      Interact.performInteract({
        combatant: combatant,
        actionType: "draw",
        item: "longsword",
      });
      t.assertEqual(combatant.actionsRemaining, 2);

      const drop = Interact.performInteract({
        combatant: combatant,
        actionType: "drop",
        item: "longsword",
      });
      t.assertTrue(drop.ok);
      t.assertEqual(drop.actionCost, 0);
      t.assertEqual(drop.actionsLeft, 2, "drop is a free action");
      t.assertEqual(drop.manipulate, false);
      t.assertEqual(combatant.hands.mainHand, null);
      t.assertEqual(combatant.findInventoryItem("longsword").equipped, false);

      const drawAgain = Interact.performInteract({
        combatant: combatant,
        actionType: "draw",
        item: "longsword",
      });
      t.assertTrue(drawAgain.ok);
      t.assertEqual(combatant.actionsRemaining, 1);

      const stow = Interact.performInteract({
        combatant: combatant,
        actionType: "stow",
        item: "longsword",
      });
      t.assertTrue(stow.ok);
      t.assertEqual(stow.actionCost, 1);
      t.assertEqual(stow.actionsLeft, 0);
      t.assertEqual(combatant.hands.mainHand, null);
    });

    t.test("a 2H item drawn with Interact occupies both hands", function () {
      const greatsword = makeWeapon("greatsword", "Greatsword", 2);
      const combatant = makeCombatant({ inventory: [greatsword] });

      const result = Interact.performInteract({
        combatant: combatant,
        actionType: "draw",
        item: "greatsword",
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.freeHands, 0);
      t.assertEqual(combatant.hands.mainHand.id, "greatsword");
      t.assertEqual(combatant.hands.offHand.id, "greatsword");
    });

    t.test("Shield Block with 12 damage and Hardness 5 deals 7 to actor and shield", function () {
      const shield = makeShield();
      const combatant = makeCombatant({
        shield: shield,
        conditions: ["shield-raised"],
        maxHP: 20,
        currentHP: 20,
      });

      const result = ShieldBlock.performShieldBlock({
        combatant: combatant,
        damage: 12,
        damageType: "slashing",
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.absorbedByHardness, 5);
      t.assertEqual(result.damageToShield, 7);
      t.assertEqual(result.damageToActor, 7);
      t.assertEqual(result.shieldBroken, false);
      t.assertEqual(combatant.shield.hp, 13);
      t.assertEqual(combatant.currentHP, 13);
      t.assertEqual(result.damageTaken, 7);
      t.assertEqual(combatant.reactionsRemaining, 0);
      t.assertEqual(result.reactionSpent, true);
      t.assertTrue(combatant.hasCondition("shield-raised"));
    });

    t.test("Shield Block integrates with takeDamage and reports the split", function () {
      const combatant = makeCombatant({
        shield: makeShield(),
        conditions: ["shield-raised"],
        maxHP: 20,
        currentHP: 20,
      });

      const result = combatant.takeDamage(12, {
        type: "slashing",
      });

      t.assertEqual(result.damageApplied, 12);
      t.assertEqual(result.actorDamageApplied, 7);
      t.assertEqual(result.damageTaken, 7);
      t.assertEqual(result.currentHP, 13);
      t.assertEqual(result.shieldBlock.ok, true);
      t.assertEqual(result.shieldBlock.absorbedByHardness, 5);
      t.assertEqual(result.shieldBlock.damageToShield, 7);
      t.assertEqual(result.shieldBlock.damageToActor, 7);
      t.assertEqual(combatant.shield.hp, 13);
      t.assertEqual(combatant.reactionsRemaining, 0);

      const optOut = makeCombatant({
        shield: makeShield(),
        conditions: ["shield-raised"],
        maxHP: 20,
        currentHP: 20,
      });
      const noBlock = optOut.takeDamage(12, {
        type: "slashing",
        shieldBlock: false,
      });
      t.assertEqual(noBlock.actorDamageApplied, 12);
      t.assertEqual(noBlock.damageTaken, 12);
      t.assertEqual(noBlock.shieldBlock, null);
      t.assertEqual(optOut.shield.hp, 20);
      t.assertEqual(optOut.reactionsRemaining, 1);
    });

    t.test("Shield Block does not trigger against non-physical damage", function () {
      const combatant = makeCombatant({
        shield: makeShield(),
        conditions: ["shield-raised"],
        maxHP: 20,
        currentHP: 20,
      });

      const result = ShieldBlock.performShieldBlock({
        combatant: combatant,
        damage: 12,
        damageType: "fire",
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Shield.SHIELD_REASONS.NON_PHYSICAL_DAMAGE);
      t.assertEqual(combatant.reactionsRemaining, 1);
      t.assertEqual(combatant.shield.hp, 20);
    });

    t.test("reaching the Broken Threshold breaks the shield and removes Shield Raised", function () {
      const combatant = makeCombatant({
        shield: makeShield({ hp: 12 }),
        conditions: ["shield-raised"],
        maxHP: 20,
        currentHP: 20,
      });

      const result = ShieldBlock.performShieldBlock({
        combatant: combatant,
        damage: 10,
        damageType: "piercing",
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.absorbedByHardness, 5);
      t.assertEqual(result.damageToShield, 5);
      t.assertEqual(result.damageToActor, 5);
      t.assertEqual(combatant.shield.hp, 7);
      t.assertEqual(combatant.shield.broken, true);
      t.assertEqual(result.shieldBroken, true);
      t.assertEqual(result.shieldRaisedRemoved, true);
      t.assertTrue(!combatant.hasCondition("shield-raised"));
      t.assertEqual(combatant.currentHP, 15);
      t.assertEqual(Shield.getACBonus(combatant.shield), 0);

      // Even if another reaction somehow remains, a broken shield cannot block.
      combatant.reactionsRemaining = 1;
      const blocked = ShieldBlock.performShieldBlock({
        combatant: combatant,
        damage: 5,
        damageType: "slashing",
      });
      t.assertTrue(!blocked.ok);
      t.assertEqual(blocked.reason, "shield-broken");
      t.assertEqual(combatant.reactionsRemaining, 1, "failed Shield Block spends nothing");

      const raise = RaiseShield.performRaiseShield({ combatant: combatant });
      t.assertTrue(!raise.ok);
      t.assertEqual(raise.reason, "shield-broken");
      t.assertEqual(combatant.actionsRemaining, 3);
    });

    t.test("a shield at 0 HP is destroyed, grants no AC, and cannot be raised", function () {
      const shield = makeShield({ hp: 3 });
      const damage = Shield.applyShieldDamage(shield, 10);

      t.assertEqual(shield.hp, 0);
      t.assertEqual(damage.destroyed, true);
      t.assertEqual(shield.destroyed, true);
      t.assertEqual(Shield.getACBonus(shield), 0);

      const combatant = makeCombatant({ shield: shield });
      const raise = RaiseShield.performRaiseShield({ combatant: combatant });
      t.assertTrue(!raise.ok);
      t.assertEqual(raise.reason, "shield-destroyed");
    });

    t.test("a broken shield contributes no AC even with a stale raised record", function () {
      const combatant = makeCombatant({
        shield: makeShield({ hp: 8 }),
        conditions: ["shield-raised"],
      });

      t.assertEqual(combatant.shield.broken, true);
      t.assertEqual(combatant.getConditionModifiers("ac").length, 0);
    });
  };
});
