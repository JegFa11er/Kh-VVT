/**
 * Canonical Compliance Audit — Pathfinder 2E Remastered.
 *
 * Targeted assertions against the `../pf2e-reference` source of truth for four
 * slices that are easy to get subtly wrong:
 *
 *   1. Modifier stacking (typed bonus/penalty independence, untyped dedup).
 *   2. Athletics maneuvers (Trip/Shove/Grapple use MAP but not Prone's -2;
 *      Stand reaction timing; grappler movement releases the hold).
 *   3. IWR pipeline timing (critical doubling upstream -> Immunity -> Weakness
 *      once per type per attack -> Resistance floored at 0).
 *   4. 3D distance strictly matching `measureDistanceOnGrid` from
 *      `pf2e-reference/src/module/canvas/helpers.ts`.
 *
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Rules/modifiers.js"),
      require("../../src/Core/Rules/iwr.js"),
      require("../../src/Core/Rules/checks.js"),
      require("../../src/Core/Rules/weapon-traits.js"),
      require("../../src/Core/Rules/size.js"),
      require("../../src/Core/Grid/distance.js"),
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Grid/flanking.js"),
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Actions/trip.js"),
      require("../../src/Core/Actions/shove.js"),
      require("../../src/Core/Actions/grapple.js"),
      require("../../src/Core/Actions/escape.js"),
      require("../../src/Core/Actions/strike.js"),
      require("../../src/Core/Actions/cast-spell.js"),
      require("../../src/Core/Actions/stand.js"),
      require("../../src/Core/Actions/stride.js"),
      require("../../src/Core/Actions/step.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Rules — Canonical Compliance Audit",
      register: factory(
        root.PF2e.Core.Rules.Modifiers,
        root.PF2e.Core.Rules.IWR,
        root.PF2e.Core.Rules.Checks,
        root.PF2e.Core.Rules.WeaponTraits,
        root.PF2e.Core.Rules.Size,
        root.PF2e.Core.Distance3D,
        root.PF2e.Core.GridMap,
        root.PF2e.Core.Flanking,
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Actions.Trip,
        root.PF2e.Core.Actions.Shove,
        root.PF2e.Core.Actions.Grapple,
        root.PF2e.Core.Actions.Escape,
        root.PF2e.Core.Actions.Strike,
        root.PF2e.Core.Actions.CastSpell,
        root.PF2e.Core.Actions.Stand,
        root.PF2e.Core.Actions.Stride,
        root.PF2e.Core.Actions.Step,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Modifiers,
  IWR,
  Checks,
  WeaponTraits,
  Size,
  Distance3D,
  GridMap,
  Flanking,
  Combatant,
  Trip,
  Shove,
  Grapple,
  Escape,
  Strike,
  CastSpell,
  Stand,
  Stride,
  Step,
) {
  "use strict";

  if (
    !Modifiers ||
    !IWR ||
    !Checks ||
    !WeaponTraits ||
    !Size ||
    !Distance3D ||
    !GridMap ||
    !Flanking ||
    !Combatant ||
    !Trip ||
    !Shove ||
    !Grapple ||
    !Escape ||
    !Strike ||
    !CastSpell ||
    !Stand ||
    !Stride ||
    !Step
  ) {
    throw new Error("Canonical compliance tests require the full core module set.");
  }

  const D = Checks.DEGREES;

  function makeMap() {
    return new GridMap({ cols: 12, rows: 12 });
  }

  /**
   * A positioned, unarmed combatant. Defaults place it at (2,2) with Athletics
   * 10 and neutral saves, so maneuver tests can override what matters.
   */
  function makeCombatant(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "combatant",
          name: "Combatant",
          alliance: "player",
          initiative: 10,
          x: 2,
          y: 2,
          speedFeet: 25,
          maxActions: 3,
          maxHP: 30,
          ac: 18,
          attackBonus: 9,
          damage: { formula: "1d8+4", type: "slashing" },
          agile: false,
          saves: { fortitude: 5, reflex: 5, will: 5 },
          skills: { athletics: 10 },
        },
        overrides || {},
      ),
    );
  }

  /**
   * An enemy target adjacent to the default attacker (3,2), within 5-ft reach.
   */
  function makeTarget(overrides) {
    return makeCombatant(
      Object.assign(
        { id: "target", name: "Target", alliance: "enemy", x: 3, y: 2 },
        overrides || {},
      ),
    );
  }

  return function registerCanonicalComplianceTests(t) {
    // ---------------------------------------------------- modifier stacking
    t.test("circumstance bonus (+2 Shield) and penalty (-2 Off-Guard) apply independently", function () {
      const result = Modifiers.resolveModifiers(18, [
        { name: "Shield Raised", type: "circumstance", value: 2, source: "shield-raised" },
        { name: "Off-Guard", type: "circumstance", value: -2, source: "off-guard" },
      ]);

      t.assertEqual(result.total, 18, "18 + 2 - 2");
      t.assertEqual(result.bonusTotal, 2);
      t.assertEqual(result.penaltyTotal, -2);
      t.assertEqual(result.effectiveModifiers.length, 2, "bonus and penalty are both effective");

      const circumstance = result.breakdown.find(function (entry) {
        return entry.type === "circumstance";
      });
      t.assertEqual(circumstance.bonus, 2);
      t.assertEqual(circumstance.penalty, -2);
      t.assertEqual(circumstance.subtotal, 0);
      t.assertEqual(circumstance.applied.length, 2);
      t.assertEqual(circumstance.suppressed.length, 0);
    });

    t.test("same-type circumstance bonuses do not stack: keep the highest", function () {
      const result = Modifiers.resolveModifiers(18, [
        { name: "Shield Raised", type: "circumstance", value: 2, source: "shield-raised" },
        { name: "Greater Cover", type: "circumstance", value: 4, source: "greater-cover" },
      ]);

      t.assertEqual(result.total, 22, "18 + max(2,4)");
      t.assertEqual(result.bonusTotal, 4);
      t.assertEqual(result.effectiveModifiers.length, 1);
      t.assertEqual(result.effectiveModifiers[0].name, "Greater Cover");
    });

    t.test("same-type circumstance penalties do not stack: keep the worst", function () {
      const result = Modifiers.resolveModifiers(18, [
        { name: "Off-Guard", type: "circumstance", value: -2, source: "off-guard" },
        { name: "Prone (attack)", type: "circumstance", value: -2, source: "prone" },
      ]);

      t.assertEqual(result.total, 16, "18 - 2");
      t.assertEqual(result.penaltyTotal, -2);
      t.assertEqual(result.effectiveModifiers.length, 1);
    });

    t.test("untyped penalties from different sources stack", function () {
      const result = Modifiers.resolveModifiers(10, [
        { name: "MAP", type: "untyped", value: -5, source: "multiple-attack-penalty" },
        { name: "Clumsy", type: "untyped", value: -2, source: "clumsy" },
      ]);

      t.assertEqual(result.total, 3);
      t.assertEqual(result.penaltyTotal, -7);
      t.assertEqual(result.effectiveModifiers.length, 2);
    });

    t.test("untyped penalties from the same source keep the worst only", function () {
      const result = Modifiers.resolveModifiers(10, [
        { name: "MAP", type: "untyped", value: -5, source: "multiple-attack-penalty" },
        { name: "MAP echo", type: "untyped", value: -2, source: "multiple-attack-penalty" },
      ]);

      t.assertEqual(result.total, 5);
      t.assertEqual(result.penaltyTotal, -5);
      t.assertEqual(result.effectiveModifiers.length, 1);
    });

    t.test("untyped bonuses stack across sources, dedup within a source", function () {
      const across = Modifiers.resolveModifiers(10, [
        { name: "A", type: "untyped", value: 2, source: "src-a" },
        { name: "B", type: "untyped", value: 3, source: "src-b" },
      ]);
      t.assertEqual(across.total, 15);
      t.assertEqual(across.bonusTotal, 5);

      const within = Modifiers.resolveModifiers(10, [
        { name: "A", type: "untyped", value: 2, source: "src-a" },
        { name: "A2", type: "untyped", value: 3, source: "src-a" },
      ]);
      t.assertEqual(within.total, 13);
      t.assertEqual(within.bonusTotal, 3);
      t.assertEqual(within.effectiveModifiers.length, 1);
    });

    // ------------------------------------------------------- maneuvers & MAP
    t.test("Trip uses MAP but ignores Prone's -2 attack penalty", function () {
      const attacker = makeCombatant({ attacksThisTurn: 1, conditions: { prone: 1 } });
      const target = makeTarget({ saves: { reflex: 8 } });

      const evaluation = Trip.evaluateTrip({
        attacker: attacker,
        target: target,
        map: makeMap(),
      });

      t.assertTrue(evaluation.ok);
      t.assertEqual(evaluation.skillBase, 10);
      t.assertEqual(evaluation.mapPenalty, -5);
      t.assertEqual(evaluation.attackModifier, 5, "10 - 5 MAP, no Prone -2");
      t.assertTrue(
        !evaluation.attackModifiers.some(function (modifier) {
          return modifier.source === "prone";
        }),
        "Prone must not penalize an Athletics check",
      );
      t.assertTrue(
        evaluation.attackModifiers.some(function (modifier) {
          return modifier.source === "multiple-attack-penalty" && modifier.value === -5;
        }),
        "MAP must still apply",
      );
    });

    t.test("Shove is an Athletics check: MAP applies, Prone does not", function () {
      const attacker = makeCombatant({ attacksThisTurn: 1, conditions: { prone: 1 } });
      const target = makeTarget({ saves: { fortitude: 4 } });

      const evaluation = Shove.evaluateShove({
        attacker: attacker,
        target: target,
        map: makeMap(),
      });

      t.assertTrue(evaluation.ok);
      t.assertEqual(evaluation.attackModifier, 5);
      t.assertTrue(
        !evaluation.attackModifiers.some(function (modifier) {
          return modifier.source === "prone";
        }),
        "Prone must not penalize a Shove Athletics check",
      );
      t.assertTrue(
        evaluation.attackModifiers.some(function (modifier) {
          return modifier.source === "multiple-attack-penalty";
        }),
        "Shove still carries MAP",
      );
    });

    t.test("Grapple is an Athletics check: MAP applies, Prone does not", function () {
      const attacker = makeCombatant({ attacksThisTurn: 1, conditions: { prone: 1 } });
      const target = makeTarget({ saves: { fortitude: 4 } });

      const evaluation = Grapple.evaluateGrapple({
        attacker: attacker,
        target: target,
        map: makeMap(),
      });

      t.assertTrue(evaluation.ok);
      t.assertEqual(evaluation.attackModifier, 5);
      t.assertTrue(
        !evaluation.attackModifiers.some(function (modifier) {
          return modifier.source === "prone";
        }),
        "Prone must not penalize a Grapple Athletics check",
      );
    });

    t.test("a Prone attacker is not penalized, but Frightened still is", function () {
      const attacker = makeCombatant({ conditions: { prone: 1, frightened: 1 } });
      const target = makeTarget({ saves: { reflex: 8 } });

      const evaluation = Trip.evaluateTrip({
        attacker: attacker,
        target: target,
        map: makeMap(),
      });

      t.assertEqual(evaluation.attackModifier, 9, "10 - 1 Frightened, no Prone -2");
    });

    // ------------------------------------------------------ Stand timing
    t.test("Stand resolves Reactive Strike while the target is still Prone, then removes Prone", function () {
      const valeros = makeCombatant({
        id: "valeros",
        name: "Valeros",
        x: 2,
        y: 2,
        ac: 18,
        maxHP: 20,
        currentHP: 20,
        conditions: { prone: 1 },
      });
      const goblin = makeCombatant({
        id: "goblin",
        name: "Goblin",
        alliance: "enemy",
        x: 3,
        y: 2,
        attackBonus: 8,
        ac: 16,
      });

      const result = Stand.performStand({
        combatant: valeros,
        map: makeMap(),
        combatants: [valeros, goblin],
        rollD20: function () {
          return 10;
        },
        rollDamageDie: function () {
          return 1;
        },
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.reactions.length, 1);
      t.assertTrue(result.reaction !== null);
      t.assertTrue(result.reaction.ok);

      // The reaction resolved before Stand finished: Off-Guard -2 was in force.
      t.assertEqual(result.reaction.targetAC, 16);
      t.assertTrue(
        result.reaction.targetACModifiers.some(function (modifier) {
          return modifier.source === "off-guard" && modifier.value === -2;
        }),
        "the interrupting attack must see the target as Off-Guard",
      );

      // Valeros survives and finishes standing.
      t.assertTrue(!valeros.hasCondition("prone"));
      t.assertTrue(result.proneRemoved);
    });

    // ------------------------------------------- grappler movement releases
    t.test("Striding away releases the target's Grabbed condition", function () {
      const grappler = makeCombatant({ id: "grappler", name: "Grappler", skills: { athletics: 10 } });
      const target = makeCombatant({
        id: "victim",
        name: "Victim",
        alliance: "enemy",
        x: 3,
        y: 2,
        saves: { fortitude: 4 },
        reactionsRemaining: 0,
      });

      const grapple = Grapple.performGrapple({
        attacker: grappler,
        target: target,
        map: makeMap(),
        combatants: [grappler, target],
        rollD20: function () {
          return 4;
        },
      });
      t.assertTrue(grapple.success, "grapple must succeed");
      t.assertTrue(target.hasCondition("grabbed"));

      const stride = Stride.performStride({
        combatant: grappler,
        map: makeMap(),
        destination: { x: 2, y: 3 },
        combatants: [grappler, target],
      });

      t.assertTrue(stride.ok);
      t.assertTrue(!target.hasCondition("grabbed"), "movement must break the hold");
      t.assertTrue(!target.hasCondition("restrained"));
      t.assertEqual(stride.releasedGrapples.length, 1);
      t.assertEqual(stride.releasedGrapples[0].combatantId, "victim");
    });

    t.test("Stepping away also releases the target's Grabbed condition", function () {
      const grappler = makeCombatant({ id: "grappler", name: "Grappler", skills: { athletics: 10 } });
      const target = makeCombatant({
        id: "victim",
        name: "Victim",
        alliance: "enemy",
        x: 3,
        y: 2,
        saves: { fortitude: 4 },
        reactionsRemaining: 0,
      });

      Grapple.performGrapple({
        attacker: grappler,
        target: target,
        map: makeMap(),
        combatants: [grappler, target],
        rollD20: function () {
          return 4;
        },
      });
      t.assertTrue(target.hasCondition("grabbed"));

      const step = Step.performStep({
        combatant: grappler,
        map: makeMap(),
        destination: { x: 2, y: 3 },
        combatants: [grappler, target],
      });

      t.assertTrue(step.ok);
      t.assertTrue(!target.hasCondition("grabbed"), "Step must break the hold");
      t.assertEqual(step.releasedGrapples.length, 1);
    });

    // ------------------------------------------------------- IWR ordering
    t.test("critical doubling happens before the IWR pipeline", function () {
      const damage = WeaponTraits.calculateWeaponDamage({
        weapon: { formula: "1d6", type: "fire", traits: [] },
        degree: D.CRITICAL_SUCCESS,
        rollDie: function () {
          return 4;
        },
      });
      t.assertEqual(damage.total, 8, "4 base doubled on a critical");

      const target = makeCombatant({
        maxHP: 30,
        currentHP: 30,
        weaknesses: [{ type: "fire", value: 5 }],
        resistances: [{ type: "fire", value: 3 }],
      });

      const applied = target.takeDamage(damage.total, { type: "fire" });
      t.assertEqual(applied.damageApplied, 10, "8 + 5 weakness - 3 resistance");
      t.assertEqual(applied.iwr.breakdown[0].weakness, 5);
      t.assertEqual(applied.iwr.breakdown[0].resistanceApplied, 3);
      t.assertEqual(applied.iwr.breakdown[0].finalAmount, 10);
      t.assertEqual(target.currentHP, 20);
    });

    t.test("immunity zeroes the instance and skips weakness and resistance", function () {
      const result = IWR.applyIWR({
        damageInstances: [{ amount: 10, type: "fire" }],
        immunities: ["fire"],
        weaknesses: [{ type: "fire", value: 5 }],
        resistances: [{ type: "fire", value: 3 }],
      });

      t.assertEqual(result.totalDamage, 0);
      const entry = result.breakdown[0];
      t.assertEqual(entry.immune, true);
      t.assertEqual(entry.weakness, 0, "weakness does not run after immunity");
      t.assertEqual(entry.resistance, 0, "resistance does not run after immunity");
      t.assertEqual(entry.steps.length, 1);
      t.assertEqual(entry.steps[0].kind, "immunity");
    });

    t.test("weakness applies exactly once per attack per damage type", function () {
      const result = IWR.applyIWR({
        damageInstances: [
          { amount: 5, type: "slashing" },
          { amount: 5, type: "slashing" },
        ],
        weaknesses: [{ type: "slashing", value: 5 }],
      });

      t.assertEqual(result.totalDamage, 15, "5 + (5 + 5), not 20");
      t.assertEqual(result.breakdown[0].weakness, 5);
      t.assertEqual(result.breakdown[1].weakness, 0);
    });

    t.test('an "all" weakness also applies once per attack', function () {
      const result = IWR.applyIWR({
        damageInstances: [
          { amount: 5, type: "slashing" },
          { amount: 5, type: "fire" },
        ],
        weaknesses: [{ type: "all", value: 3 }],
      });

      t.assertEqual(result.totalDamage, 13, "5 + 5 + 3 once");
      t.assertEqual(result.breakdown[0].weakness, 3);
      t.assertEqual(result.breakdown[1].weakness, 0);
    });

    t.test("resistance subtracts from post-weakness damage and floors at 0", function () {
      const withWeakness = IWR.applyIWR({
        damageInstances: [{ amount: 8, type: "slashing" }],
        weaknesses: [{ type: "slashing", value: 5 }],
        resistances: [{ type: "slashing", value: 3 }],
      });
      t.assertEqual(withWeakness.totalDamage, 10, "8 + 5 - 3");
      t.assertEqual(withWeakness.breakdown[0].afterWeakness, 13);

      const floored = IWR.applyIWR({
        damageInstances: [{ amount: 2, type: "piercing" }],
        resistances: [{ type: "piercing", value: 10 }],
      });
      t.assertEqual(floored.totalDamage, 0, "resistance cannot push below 0");
      t.assertEqual(floored.breakdown[0].resistanceApplied, 2);
    });

    // ------------------------------------------------------- 3D distance
    t.test("distance3DSquares strictly matches measureDistanceOnGrid", function () {
      function referenceSquares(dxSquares, dySquares, dzFeet) {
        const feetPerSquare = Distance3D.FEET_PER_SQUARE;
        const nx = Math.ceil(Math.abs(dxSquares));
        const ny = Math.ceil(Math.abs(dySquares));
        const nz = Math.ceil(Math.abs(dzFeet) / feetPerSquare);

        const sortedDistance = [nx, ny, nz].sort(function (a, b) {
          return a - b;
        });
        const doubleDiagonal = sortedDistance[0];
        const diagonal = sortedDistance[1] - sortedDistance[0];
        const straight = sortedDistance[2] - sortedDistance[1];

        return Math.floor(
          doubleDiagonal * 1.75 + diagonal * 1.5 + straight,
        );
      }

      const cases = [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 5],
        [0, 0, 20],
        [2, 2, 0],
        [3, 3, 0],
        [2, 1, 0],
        [3, 2, 0],
        [2, 2, 10],
        [3, 1, 5],
        [3, 3, 10],
        [1, 1, 10],
        [2, 1, 5],
        [4, 2, 15],
        [5, 5, 25],
      ];

      cases.forEach(function (entry) {
        const dx = entry[0];
        const dy = entry[1];
        const dz = entry[2];
        const expected = referenceSquares(dx, dy, dz);
        const actual = Distance3D.distance3DSquares(dx, dy, dz);
        t.assertEqual(
          actual,
          expected,
          "distance3DSquares(" + dx + "," + dy + "," + dz + ")",
        );
      });
    });

    t.test("3D distance with zero elevation reduces to the 2D 5-10-5 rule", function () {
      // max(dx, dy) + floor(min(dx, dy) / 2) squares.
      function twoD(dx, dy) {
        const max = Math.max(dx, dy);
        const min = Math.min(dx, dy);
        return max + Math.floor(min / 2);
      }

      [[2, 2], [3, 2], [4, 1], [5, 4], [6, 3]].forEach(function (pair) {
        const dx = pair[0];
        const dy = pair[1];
        t.assertEqual(
          Distance3D.distance3DSquares(dx, dy, 0),
          twoD(dx, dy),
          "distance3DSquares(" + dx + "," + dy + ",0)",
        );
      });
    });

    t.test("getDistance3D reports feet and folds elevation into the rule", function () {
      t.assertEqual(
        Distance3D.getDistance3D(
          { x: 0, y: 0, elevation: 0 },
          { x: 0, y: 0, elevation: 20 },
        ),
        20,
      );
      t.assertEqual(
        Distance3D.getDistance3D(
          { x: 0, y: 0, elevation: 0 },
          { x: 2, y: 2, elevation: 10 },
        ),
        15,
      );
      t.assertEqual(
        Distance3D.getDistance3D(
          { x: 0, y: 0, elevation: 0 },
          { x: 3, y: 3, elevation: 10 },
        ),
        25,
      );
      t.assertEqual(
        Distance3D.getDistance3D({ x: 0, y: 0 }, { x: 0, y: 0 }),
        0,
      );
    });

    // ------------------------------------ hostile actions break stealth
    t.test("a resolved Strike removes Hidden and becomes observed", function () {
      const attacker = makeCombatant({ attackBonus: 20 });
      const target = makeTarget({ ac: 10, maxHP: 30 });
      attacker.addCondition("hidden");

      const result = Strike.performStrike({
        attacker: attacker,
        target: target,
        map: makeMap(),
        rollD20: function () {
          return 10;
        },
        rollDamageDie: function () {
          return 1;
        },
      });

      t.assertTrue(result.ok);
      t.assertTrue(result.hiddenAttacker, "the attack still benefits from Hidden");
      t.assertTrue(result.revealed);
      t.assertTrue(!attacker.hasCondition("hidden"));
      t.assertEqual(result.visibilityAfter.condition, null, "the attacker is observed");
      t.assertTrue(result.revealedConditions.indexOf("hidden") !== -1);
      t.assertTrue(result.targetAC < target.ac, "Hidden attacker still made the target Off-Guard");
    });

    t.test("a resolved Strike removes Undetected", function () {
      const attacker = makeCombatant({ attackBonus: 20 });
      const target = makeTarget({ ac: 10, maxHP: 30 });
      attacker.addCondition("undetected");

      const result = Strike.performStrike({
        attacker: attacker,
        target: target,
        map: makeMap(),
        rollD20: function () {
          return 10;
        },
        rollDamageDie: function () {
          return 1;
        },
      });

      t.assertTrue(result.ok);
      t.assertTrue(result.revealed);
      t.assertTrue(!attacker.hasCondition("undetected"));
      t.assertEqual(result.visibilityAfter.condition, null);
    });

    t.test("a rejected Strike does not break stealth", function () {
      const attacker = makeCombatant({ x: 2, y: 2 });
      const target = makeTarget({ x: 10, y: 2 });
      attacker.addCondition("hidden");

      const result = Strike.performStrike({
        attacker: attacker,
        target: target,
        map: makeMap(),
        rollD20: function () {
          return 10;
        },
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, Strike.STRIKE_REASONS.OUT_OF_REACH);
      t.assertTrue(attacker.hasCondition("hidden"), "no action resolved, so no reveal");
    });

    t.test("a damage/save spell removes the caster's Hidden state", function () {
      const caster = makeCombatant({
        id: "caster",
        name: "Caster",
        spellDC: 30,
      });
      const target = makeTarget({
        x: 3,
        y: 2,
        saves: { reflex: 0 },
        maxHP: 30,
      });
      caster.addCondition("hidden");
      const spell = {
        id: "burning-hands",
        cost: 1,
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
        combatants: [caster, target],
        rollD20: function () {
          return 10;
        },
        rollDamageDie: function () {
          return 3;
        },
      });

      t.assertTrue(result.ok);
      t.assertTrue(result.revealed);
      t.assertTrue(!caster.hasCondition("hidden"));
      t.assertEqual(result.visibilityAfter.condition, null);
    });

    t.test("a damaging attack spell also removes Undetected", function () {
      const caster = makeCombatant({
        id: "caster",
        name: "Caster",
        spellAttackBonus: 20,
      });
      const target = makeTarget({ x: 3, y: 2, ac: 10, maxHP: 30 });
      caster.addCondition("undetected");
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

      t.assertTrue(result.ok);
      t.assertTrue(result.revealed);
      t.assertTrue(!caster.hasCondition("undetected"));
      t.assertEqual(result.visibilityAfter.condition, null);
    });

    t.test("a non-damaging attack spell leaves stealth intact", function () {
      const caster = makeCombatant({
        id: "caster",
        name: "Caster",
        spellAttackBonus: 20,
      });
      const target = makeTarget({ x: 3, y: 2, ac: 10, maxHP: 30 });
      caster.addCondition("hidden");
      const spell = {
        id: "daze-like",
        cost: 1,
        type: "attack",
        traits: ["attack"],
      };

      const result = CastSpell.performCastSpell({
        caster: caster,
        spell: spell,
        target: target,
        combatants: [caster, target],
        rollD20: function () {
          return 10;
        },
      });

      t.assertTrue(result.ok);
      t.assertTrue(!result.revealed);
      t.assertTrue(caster.hasCondition("hidden"));
    });

    // ------------------------------------------ maneuver size & free hands
    t.test("size categories use the canonical 0-4 rank ladder", function () {
      t.assertEqual(Size.sizeRankOfName("tiny"), 0);
      t.assertEqual(Size.sizeRankOfName("small"), 1);
      t.assertEqual(Size.sizeRankOfName("medium"), 1);
      t.assertEqual(Size.sizeRankOfName("large"), 2);
      t.assertEqual(Size.sizeRankOfName("huge"), 3);
      t.assertEqual(Size.sizeRankOfName("gargantuan"), 4);

      const gargantuan = makeCombatant({ size: "gargantuan" });
      t.assertEqual(gargantuan.getSizeRank(), 4);
      t.assertEqual(gargantuan.getFootprint(), 4);
    });

    t.test("a maneuver rejects a target more than one size larger", function () {
      const attacker = makeCombatant({ skills: { athletics: 10 } });
      const huge = makeTarget({
        x: 3,
        y: 2,
        size: "huge",
        saves: { fortitude: 0, reflex: 0 },
      });

      const trip = Trip.evaluateTrip({
        attacker: attacker,
        target: huge,
        map: makeMap(),
      });
      t.assertTrue(!trip.ok);
      t.assertEqual(trip.reason, "target-too-large");

      const shove = Shove.evaluateShove({
        attacker: attacker,
        target: huge,
        map: makeMap(),
      });
      t.assertTrue(!shove.ok);
      t.assertEqual(shove.reason, "target-too-large");

      const grapple = Grapple.evaluateGrapple({
        attacker: attacker,
        target: huge,
        map: makeMap(),
      });
      t.assertTrue(!grapple.ok);
      t.assertEqual(grapple.reason, "target-too-large");
      t.assertEqual(attacker.actionsRemaining, 3);
    });

    t.test("a Large target is legal for a Medium maneuver", function () {
      const attacker = makeCombatant({ skills: { athletics: 10 } });
      const large = makeTarget({
        x: 3,
        y: 2,
        size: "large",
        saves: { reflex: 0 },
      });

      const evaluation = Trip.evaluateTrip({
        attacker: attacker,
        target: large,
        map: makeMap(),
      });

      t.assertTrue(evaluation.ok);
      t.assertEqual(evaluation.attackerSizeRank, 1);
      t.assertEqual(evaluation.targetSizeRank, 2);
    });

    t.test("a Huge attacker can maneuver a Gargantuan target", function () {
      const attacker = makeCombatant({
        x: 2,
        y: 2,
        size: "huge",
        skills: { athletics: 10 },
      });
      const gargantuan = makeTarget({
        x: 5,
        y: 2,
        size: "gargantuan",
        saves: { reflex: 0 },
      });

      const evaluation = Trip.evaluateTrip({
        attacker: attacker,
        target: gargantuan,
        map: makeMap(),
      });

      t.assertTrue(evaluation.ok);
      t.assertEqual(evaluation.attackerSizeRank, 3);
      t.assertEqual(evaluation.targetSizeRank, 4);
    });

    t.test("Trip needs a free hand unless the weapon has the trip trait", function () {
      const shield = {
        id: "shield",
        name: "Shield",
        type: "shield",
        hands: 1,
        hardness: 5,
        hp: 20,
        maxHP: 20,
        acBonus: 2,
      };
      const sword = {
        id: "sword",
        name: "Sword",
        type: "weapon",
        hands: 1,
        traits: [],
        damage: "1d8",
      };
      const tripSword = {
        id: "trip-sword",
        name: "Trip Sword",
        type: "weapon",
        hands: 1,
        traits: ["trip"],
        damage: "1d8",
      };
      const target = makeTarget({ x: 3, y: 2, saves: { reflex: 0 } });

      const blocked = makeCombatant({
        skills: { athletics: 10 },
        inventory: [sword, shield],
        hands: { mainHand: "sword", offHand: "shield" },
      });
      const blockedEvaluation = Trip.evaluateTrip({
        attacker: blocked,
        target: target,
        map: makeMap(),
      });
      t.assertTrue(!blockedEvaluation.ok);
      t.assertEqual(blockedEvaluation.reason, "no-free-hand");

      const allowed = makeCombatant({
        skills: { athletics: 10 },
        inventory: [tripSword, shield],
        hands: { mainHand: "trip-sword", offHand: "shield" },
      });
      const allowedEvaluation = Trip.evaluateTrip({
        attacker: allowed,
        target: target,
        map: makeMap(),
      });
      t.assertTrue(allowedEvaluation.ok);
      t.assertTrue(allowedEvaluation.handRequirement.viaTrait);
    });

    // --------------------------------------- multi-cell target flanking
    t.test("a Large target is flanked across opposite footprint sides", function () {
      const target = makeCombatant({
        id: "target",
        name: "Ogre",
        alliance: "enemy",
        x: 4,
        y: 4,
        size: "large",
      });
      const north = makeCombatant({ id: "north", x: 4, y: 3 });
      const south = makeCombatant({ id: "south", x: 5, y: 6 });
      const west = makeCombatant({ id: "west", x: 3, y: 4 });
      const east = makeCombatant({ id: "east", x: 6, y: 5 });
      const sameSide = makeCombatant({ id: "same-side", x: 4, y: 3 });

      t.assertTrue(
        Flanking.isFlanked(target, north, [north, south], makeMap()),
        "north/south sides of the 2x2 footprint flank",
      );
      t.assertTrue(
        Flanking.isFlanked(target, west, [west, east], makeMap()),
        "west/east sides flank even with an offset corner",
      );
      t.assertTrue(
        !Flanking.isFlanked(target, west, [west, sameSide], makeMap()),
        "west + north are not opposite sides",
      );
    });

    t.test("a Huge target is flanked across its 3x3 footprint", function () {
      const target = makeCombatant({
        id: "target",
        name: "Giant",
        alliance: "enemy",
        x: 3,
        y: 3,
        size: "huge",
      });
      const north = makeCombatant({ id: "north", x: 4, y: 2 });
      const south = makeCombatant({ id: "south", x: 5, y: 6 });

      t.assertTrue(
        Flanking.isFlanked(target, north, [north, south], makeMap()),
      );
    });

    // ------------------------------------------ multiple simultaneous grapples
    t.test("two different grapplers keep separate Grabbed instances", function () {
      const map = makeMap();
      const first = makeCombatant({
        id: "first",
        name: "First",
        x: 2,
        y: 2,
        skills: { athletics: 10 },
      });
      const second = makeCombatant({
        id: "second",
        name: "Second",
        x: 2,
        y: 3,
        skills: { athletics: 10 },
      });
      const victim = makeTarget({
        id: "victim",
        x: 3,
        y: 2,
        saves: { fortitude: 0 },
        maxHP: 30,
      });

      const firstResult = Grapple.performGrapple({
        attacker: first,
        target: victim,
        map: map,
        combatants: [first, second, victim],
        rollD20: function () {
          return 5;
        },
      });
      const secondResult = Grapple.performGrapple({
        attacker: second,
        target: victim,
        map: map,
        combatants: [first, second, victim],
        rollD20: function () {
          return 5;
        },
      });

      t.assertTrue(firstResult.success);
      t.assertTrue(secondResult.success);
      t.assertEqual(victim.getGrappleInstances().length, 2);
      t.assertEqual(
        victim.getConditions().filter(function (condition) {
          return condition.name === "grabbed";
        }).length,
        2,
        "getConditions exposes both simultaneous Grabbed records",
      );
      t.assertDeepEqual(victim.getGrappleSources(), ["first", "second"]);
      t.assertEqual(
        victim.getCondition("grabbed").sourceId,
        "first",
        "the second grappler does not overwrite the first sourceId",
      );
      t.assertEqual(victim.getCondition("immobilized").sourceId, "first");
    });

    t.test("Escape frees only the selected grappler's instance", function () {
      const map = makeMap();
      const first = makeCombatant({
        id: "first",
        name: "First",
        x: 2,
        y: 2,
        skills: { athletics: 10 },
      });
      const second = makeCombatant({
        id: "second",
        name: "Second",
        x: 2,
        y: 3,
        skills: { athletics: 10 },
      });
      const victim = makeTarget({
        id: "victim",
        x: 3,
        y: 2,
        saves: { fortitude: 0 },
        maxHP: 30,
      });

      Grapple.performGrapple({
        attacker: first,
        target: victim,
        map: map,
        combatants: [first, second, victim],
        rollD20: function () {
          return 5;
        },
      });
      Grapple.performGrapple({
        attacker: second,
        target: victim,
        map: map,
        combatants: [first, second, victim],
        rollD20: function () {
          return 5;
        },
      });

      const escapeSecond = Escape.performEscape({
        actor: victim,
        source: second,
        combatants: [first, second, victim],
        rollD20: function () {
          return 20;
        },
      });

      t.assertTrue(escapeSecond.escaped);
      t.assertTrue(victim.hasCondition("grabbed"), "the first hold remains");
      t.assertEqual(
        victim.getConditions().filter(function (condition) {
          return condition.name === "grabbed";
        }).length,
        1,
      );
      t.assertEqual(victim.getCondition("immobilized").sourceId, "first");
      t.assertDeepEqual(
        victim.getGrappleInstances().map(function (condition) {
          return condition.sourceId;
        }),
        ["first"],
      );

      const escapeFirst = Escape.performEscape({
        actor: victim,
        source: first,
        combatants: [first, second, victim],
        rollD20: function () {
          return 20;
        },
      });

      t.assertTrue(escapeFirst.escaped);
      t.assertTrue(!victim.hasCondition("grabbed"), "all instances are gone");
      t.assertTrue(!victim.hasCondition("immobilized"));
      t.assertEqual(victim.getGrappleInstances().length, 0);
    });

    t.test("a Restrained hold from another source does not replace a Grab", function () {
      const map = makeMap();
      const first = makeCombatant({
        id: "first",
        name: "First",
        x: 2,
        y: 2,
        skills: { athletics: 10 },
      });
      const second = makeCombatant({
        id: "second",
        name: "Second",
        x: 2,
        y: 3,
        skills: { athletics: 10 },
      });
      const victim = makeTarget({
        id: "victim",
        x: 3,
        y: 2,
        saves: { fortitude: 0 },
        maxHP: 30,
      });

      Grapple.performGrapple({
        attacker: first,
        target: victim,
        map: map,
        combatants: [first, second, victim],
        rollD20: function () {
          return 5;
        },
      });
      Grapple.performGrapple({
        attacker: second,
        target: victim,
        map: map,
        combatants: [first, second, victim],
        rollD20: function () {
          return 20;
        },
      });

      t.assertTrue(victim.hasCondition("grabbed"));
      t.assertTrue(victim.hasCondition("restrained"));
      t.assertEqual(victim.getCondition("grabbed").sourceId, "first");
      t.assertEqual(victim.getCondition("restrained").sourceId, "second");
      t.assertEqual(victim.getGrappleInstances().length, 2);
    });

    t.test("re-grappling from the same source refreshes one instance", function () {
      const map = makeMap();
      const grappler = makeCombatant({
        id: "grappler",
        name: "Grappler",
        x: 2,
        y: 2,
        skills: { athletics: 10 },
      });
      const victim = makeTarget({
        id: "victim",
        x: 3,
        y: 2,
        saves: { fortitude: 0 },
        maxHP: 30,
      });

      Grapple.performGrapple({
        attacker: grappler,
        target: victim,
        map: map,
        combatants: [grappler, victim],
        rollD20: function () {
          return 5;
        },
      });
      Grapple.performGrapple({
        attacker: grappler,
        target: victim,
        map: map,
        combatants: [grappler, victim],
        rollD20: function () {
          return 5;
        },
      });

      t.assertEqual(victim.getGrappleInstances().length, 1);
      t.assertEqual(victim.getGrappleInstances()[0].sourceId, "grappler");
    });
  };
});
