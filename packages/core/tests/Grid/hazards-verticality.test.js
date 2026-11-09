/**
 * Phase 18 — Advanced Terrain, Verticality & Battlefield Hazards.
 * Runs in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Grid/pathfinding.js"),
      require("../../src/Core/Grid/distance.js"),
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Entities/hazard.js"),
      require("../../src/Core/Actions/stride.js"),
      require("../../src/Core/Actions/step.js"),
      require("../../src/Core/Actions/strike.js"),
      require("../../src/Core/Actions/disable-hazard.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Grid — Hazards & Verticality",
      register: factory(
        root.PF2e.Core.GridMap,
        root.PF2e.Core.Pathfinding,
        root.PF2e.Core.Distance3D,
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Hazard,
        root.PF2e.Core.Actions.Stride,
        root.PF2e.Core.Actions.Step,
        root.PF2e.Core.Actions.Strike,
        root.PF2e.Core.Actions.DisableHazard,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  GridMap,
  Pathfinding,
  Distance3D,
  Combatant,
  Hazard,
  Stride,
  Step,
  Strike,
  DisableHazard,
) {
  "use strict";

  if (!GridMap || !Pathfinding || !Distance3D || !Combatant || !Hazard || !Stride || !Step || !Strike || !DisableHazard) {
    throw new Error("Hazards tests require all Phase 18 core modules.");
  }

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
          speedFeet: 30,
          maxActions: 3,
          maxHP: 20,
        },
        overrides || {},
      ),
    );
  }

  return function registerHazardsTests(t) {
    // ---------------------------------------------------------------- terrain
    t.test("greater-difficult terrain adds +10 ft (first step costs 15 ft)", function () {
      const map = new GridMap({ cols: 5, rows: 1 });
      map.setTerrain(1, 0, "greater-difficult");

      t.assertEqual(map.getTerrain(1, 0), "greater-difficult");
      t.assertEqual(map.getTerrain(0, 0), "normal");

      const result = Pathfinding.findPath(
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { map: map },
      );
      t.assertTrue(result.found);
      t.assertEqual(result.costFeet, 15, "5 base + 10 greater-difficult");
    });

    t.test("greater-difficult terrain stacks on a diagonal entry", function () {
      const map = new GridMap({ cols: 5, rows: 5 });
      map.setTerrain(1, 1, "greater-difficult");

      const result = Pathfinding.findPath(
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { map: map },
      );
      t.assertTrue(result.found);
      t.assertEqual(result.costFeet, 15, "first diagonal 5 + greater-difficult 10");
    });

    t.test("difficult vs greater-difficult remain distinct terrain classes", function () {
      const map = new GridMap({ cols: 3, rows: 1 });
      map.setTerrain(0, 0, "difficult");
      map.setTerrain(1, 0, "greater-difficult");
      map.setTerrain(2, 0, "normal");

      t.assertEqual(map.getTerrain(0, 0), "difficult");
      t.assertEqual(map.getTerrain(1, 0), "greater-difficult");
      t.assertEqual(map.getTerrain(2, 0), "normal");
      t.assertEqual(map.getTerrainExtraFeet(0, 0), 5);
      t.assertEqual(map.getTerrainExtraFeet(1, 0), 10);
      t.assertEqual(map.getTerrainExtraFeet(2, 0), 0);
    });

    // ------------------------------------------------------- hazardous terrain
    t.test("entering burning lava deals fire damage to the mover", function () {
      const map = new GridMap({ cols: 5, rows: 1 });
      map.setHazardous(1, 0, { damage: "1d6", type: "fire" });

      const hero = makeCombatant({ maxHP: 20 });
      const result = Stride.performStride({
        combatant: hero,
        map: map,
        destination: { x: 1, y: 0 },
        rollDie: function () {
          return 6;
        },
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.hazardousDamageTaken.length, 1);
      t.assertEqual(result.hazardousDamageTaken[0].type, "fire");
      t.assertEqual(result.hazardousDamageTaken[0].damageDealt, 6);
      t.assertEqual(hero.currentHP, 14, "20 - 6 fire damage");
      t.assertEqual(hero.x, 1);
    });

    t.test("Step into hazardous terrain also reports damage", function () {
      const map = new GridMap({ cols: 5, rows: 1 });
      map.setHazardous(1, 0, { damage: "1d4", type: "acid" });

      const hero = makeCombatant({ maxHP: 20 });
      const result = Step.performStep({
        combatant: hero,
        map: map,
        destination: { x: 1, y: 0 },
        rollDie: function () {
          return 4;
        },
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.hazardousDamageTaken.length, 1);
      t.assertEqual(result.hazardousDamageTaken[0].damageDealt, 4);
      t.assertEqual(hero.currentHP, 16);
    });

    // ------------------------------------------------------------- elevation
    t.test("Combatant elevation defaults to 0 ft and is settable", function () {
      const hero = makeCombatant({});
      t.assertEqual(hero.getElevation(), 0);
      hero.setElevation(20);
      t.assertEqual(hero.getElevation(), 20);
    });

    t.test("3D distance folds the vertical delta into the 5-10-5 rule", function () {
      t.assertEqual(
        Distance3D.getDistance3D(
          { x: 0, y: 0, elevation: 0 },
          { x: 0, y: 0, elevation: 20 },
        ),
        20,
        "pure vertical displacement is counted straight",
      );
      t.assertEqual(
        Distance3D.getDistance3D(
          { x: 0, y: 0, elevation: 0 },
          { x: 1, y: 0, elevation: 15 },
        ),
        15,
        "one horizontal square + 15 ft up",
      );
      t.assertEqual(
        Distance3D.getDistance3D(
          { x: 0, y: 0, elevation: 0 },
          { x: 2, y: 2, elevation: 10 },
        ),
        15,
        "two horizontal diagonals + 10 ft up",
      );
      t.assertEqual(
        Distance3D.getDistance3D(
          { x: 0, y: 0, elevation: 0 },
          { x: 0, y: 0, elevation: 0 },
        ),
        0,
      );
    });

    t.test("a flying target 15 ft up is out of melee reach but in bow range", function () {
      const fighter = makeCombatant({
        id: "fighter",
        x: 0,
        y: 0,
        attackBonus: 7,
        damage: { formula: "1d8+4", type: "slashing" },
      });
      const archer = makeCombatant({
        id: "archer",
        x: 0,
        y: 0,
        attackBonus: 6,
        rangeIncrement: 60,
        damage: { formula: "1d8", type: "piercing" },
      });
      const flyer = makeCombatant({
        id: "harpy",
        name: "Harpy",
        alliance: "enemy",
        x: 1,
        y: 0,
        ac: 15,
        elevation: 15,
      });

      const melee = Strike.evaluateStrike({ attacker: fighter, target: flyer });
      t.assertTrue(!melee.ok, "the flying target must be out of 5-ft reach");
      t.assertEqual(melee.reason, Strike.STRIKE_REASONS.OUT_OF_REACH);
      t.assertEqual(melee.distanceFeet, 15);

      const ranged = Strike.evaluateStrike({ attacker: archer, target: flyer });
      t.assertTrue(ranged.ok, "the archer can still target the flyer");
      t.assertTrue(ranged.ranged === true);
      t.assertEqual(ranged.distanceFeet, 15);
      t.assertEqual(ranged.rangePenalty, 0);
    });

    // ---------------------------------------------------------------- hazards
    t.test("stepping onto an armed pressure plate fires the trap", function () {
      const map = new GridMap({ cols: 5, rows: 1 });
      const trap = new Hazard({
        id: "pressure-plate",
        name: "Pressure Plate",
        disableDC: 18,
        triggerArea: [{ x: 1, y: 0 }],
        reaction: { trigger: "enter", formula: "2d6", type: "piercing" },
      });

      const hero = makeCombatant({ maxHP: 30 });
      const result = Stride.performStride({
        combatant: hero,
        map: map,
        destination: { x: 2, y: 0 },
        hazards: [trap],
        rollDie: function () {
          return 3;
        },
      });

      t.assertTrue(result.ok, "the move action was validly spent");
      t.assertTrue(result.movementInterrupted, "movement stops on the trigger cell");
      t.assertEqual(result.triggeredHazards.length, 1);
      t.assertEqual(result.triggeredHazards[0].hazardId, "pressure-plate");
      t.assertEqual(hero.x, 1, "the mover stops on the plate");
      t.assertTrue(!trap.isArmed, "the trap is discharged");
      t.assertEqual(hero.currentHP, 24, "2d6 (3+3) = 6 piercing damage");
    });

    t.test("a disarmed trap no longer triggers", function () {
      const map = new GridMap({ cols: 5, rows: 1 });
      const trap = new Hazard({
        id: "pressure-plate",
        name: "Pressure Plate",
        disableDC: 18,
        triggerArea: [{ x: 1, y: 0 }],
        reaction: { trigger: "enter", formula: "2d6", type: "piercing" },
      });
      trap.isArmed = false;

      const hero = makeCombatant({ maxHP: 20 });
      const result = Stride.performStride({
        combatant: hero,
        map: map,
        destination: { x: 1, y: 0 },
        hazards: [trap],
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.triggeredHazards.length, 0);
      t.assertEqual(hero.currentHP, 20);
      t.assertEqual(hero.x, 1);
    });

    // ------------------------------------------------------- disable a device
    t.test("a rogue disarms a hazard with a Thievery check", function () {
      const trap = new Hazard({
        id: "spear-trap",
        name: "Spear Trap",
        disableDC: 15,
        disableSkill: "thievery",
        triggerArea: [{ x: 1, y: 0 }],
        reaction: { trigger: "enter", formula: "1d6", type: "piercing" },
      });

      const rogue = makeCombatant({
        id: "rogue",
        skills: { thievery: 8 },
        maxHP: 20,
      });

      const result = DisableHazard.performDisableHazard({
        combatant: rogue,
        hazard: trap,
        rollD20: function () {
          return 12;
        },
      });

      t.assertTrue(result.ok);
      t.assertTrue(result.disarmed, "success disarms the trap");
      t.assertTrue(!trap.isArmed);
      t.assertEqual(result.skill, "thievery");
      t.assertEqual(rogue.actionsRemaining, 1, "Disable costs 2 actions");

      // The now-disarmed trap must not fire when walked over.
      const map = new GridMap({ cols: 5, rows: 1 });
      const victim = makeCombatant({ id: "victim", maxHP: 20 });
      const moveResult = Stride.performStride({
        combatant: victim,
        map: map,
        destination: { x: 1, y: 0 },
        hazards: [trap],
      });
      t.assertTrue(moveResult.ok);
      t.assertEqual(moveResult.triggeredHazards.length, 0);
      t.assertEqual(victim.currentHP, 20);
    });

    t.test("critical failure while disabling fires the trap at the rogue", function () {
      const trap = new Hazard({
        id: "spear-trap",
        name: "Spear Trap",
        disableDC: 15,
        disableSkill: "thievery",
        triggerArea: [{ x: 1, y: 0 }],
        reaction: { trigger: "enter", formula: "1d6", type: "piercing" },
      });

      const clumsy = makeCombatant({
        id: "clumsy",
        skills: { thievery: 0 },
        maxHP: 20,
      });

      const result = DisableHazard.performDisableHazard({
        combatant: clumsy,
        hazard: trap,
        rollD20: function () {
          return 1;
        },
        rollDie: function () {
          return 5;
        },
      });

      t.assertTrue(result.ok, "the attempt still costs actions");
      t.assertTrue(!result.disarmed);
      t.assertTrue(result.triggeredReaction !== null);
      t.assertEqual(result.degree, "CRITICAL_FAILURE");
      t.assertEqual(clumsy.currentHP, 15, "1d6 (5) piercing damage");
      t.assertTrue(!trap.isArmed, "the trap discharges after firing");
    });
  };
});
