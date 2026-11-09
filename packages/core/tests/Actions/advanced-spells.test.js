/**
 * Phase 16 — Advanced Spellcasting & Geometry.
 *
 * Covers line/cone/emanation geometry, spell slots, Focus Points, and the
 * Sustain a Spell lifecycle. Runs in the browser (when loaded) and in Node.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Actions/cast-spell.js"),
      require("../../src/Core/Actions/sustain-spell.js"),
      require("../../src/Core/Grid/aoe.js"),
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Encounter/encounter.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Actions — Advanced Spells & Geometry",
      register: factory(
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Actions.CastSpell,
        root.PF2e.Core.Actions.SustainSpell,
        root.PF2e.Core.Grid.AoE,
        root.PF2e.Core.GridMap,
        root.PF2e.Core.Encounter,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Combatant,
  CastSpell,
  SustainSpell,
  AoE,
  GridMap,
  Encounter,
) {
  "use strict";

  if (
    !Combatant ||
    !CastSpell ||
    !SustainSpell ||
    !AoE ||
    !GridMap ||
    !Encounter
  ) {
    throw new Error(
      "Advanced spell tests require Combatant, CastSpell, SustainSpell, AoE, GridMap and Encounter.",
    );
  }

  const performCastSpell = CastSpell.performCastSpell;
  const performSustainSpell = SustainSpell.performSustainSpell;

  function makeCombatant(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "combatant",
          name: "Combatant",
          x: 0,
          y: 0,
          speedFeet: 25,
          maxActions: 3,
        },
        overrides || {},
      ),
    );
  }

  function hasCell(cells, x, y) {
    return cells.some(function (cell) {
      return cell.x === x && cell.y === y;
    });
  }

  function rankedSpell(overrides) {
    return Object.assign(
      {
        id: "ranked-spell",
        rank: 1,
        cost: 1,
        type: "save",
        saveType: "will",
        damage: null,
      },
      overrides || {},
    );
  }

  function constantD20(value) {
    return function () {
      return value;
    };
  }

  return function registerAdvancedSpellTests(t) {
    // ---------------------------------------------------------- geometry

    t.test("15-ft cone covers the 90-degree wedge and excludes the apex", function () {
      const cells = AoE.getConeCells({ x: 0, y: 0 }, { x: 1, y: 0 }, 15);

      // 3 cells at 5 ft, 5 at 10 ft, 3 at 15 ft = 11.
      t.assertEqual(cells.length, 11);
      t.assertTrue(hasCell(cells, 1, 0));
      t.assertTrue(hasCell(cells, 1, -1));
      t.assertTrue(hasCell(cells, 1, 1));
      t.assertTrue(hasCell(cells, 2, 2));
      t.assertTrue(hasCell(cells, 2, -2));
      t.assertTrue(hasCell(cells, 3, 1));
      t.assertTrue(!hasCell(cells, 0, 0), "apex must not be in the cone");
      t.assertTrue(!hasCell(cells, -1, 0), "cells behind the cone are excluded");
      t.assertTrue(!hasCell(cells, 4, 0), "cells beyond 15 ft are excluded");
      t.assertTrue(!hasCell(cells, 3, 2), "cells outside the 90-degree wedge are excluded");

      // Diagonal cones use the same 90-degree wedge around a corner axis.
      const diagonal = AoE.getConeCells({ x: 0, y: 0 }, "southeast", 15);
      t.assertEqual(diagonal.length, 12);
      t.assertTrue(hasCell(diagonal, 1, 1));
      t.assertTrue(hasCell(diagonal, 0, 3));
      t.assertTrue(hasCell(diagonal, 3, 0));
      t.assertTrue(!hasCell(diagonal, 3, 2), "outside the diagonal wedge");
      t.assertTrue(!hasCell(diagonal, 2, 3), "outside the diagonal wedge");
    });

    t.test("a solid wall stops a cone from reaching cells behind it", function () {
      const map = new GridMap({
        cols: 12,
        rows: 12,
        blocked: [
          { x: 3, y: 3 },
          { x: 3, y: 4 },
          { x: 3, y: 5 },
          { x: 3, y: 6 },
          { x: 3, y: 7 },
        ],
      });

      const cells = AoE.getConeCells({ x: 1, y: 5 }, "east", 15, map);
      t.assertDeepEqual(cells, [
        { x: 2, y: 4 },
        { x: 2, y: 5 },
        { x: 2, y: 6 },
      ]);
      t.assertTrue(!hasCell(cells, 3, 5), "wall cells are never affected");
      t.assertTrue(!hasCell(cells, 4, 5), "cells behind the wall are excluded");
    });

    t.test("30-ft line starts at the caster edge and stops at a wall", function () {
      const cells = AoE.getLineCells({ x: 0, y: 0 }, "east", 30);
      t.assertDeepEqual(cells, [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
        { x: 5, y: 0 },
        { x: 6, y: 0 },
      ]);

      const map = new GridMap({
        cols: 12,
        rows: 12,
        blocked: [{ x: 3, y: 0 }],
      });
      const blocked = AoE.getLineCells({ x: 0, y: 0 }, "east", 30, 5, map);
      t.assertDeepEqual(blocked, [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]);
    });

    t.test("diagonal lines use the 5-10-5 alternation", function () {
      const cells = AoE.getLineCells({ x: 0, y: 0 }, { x: 1, y: 1 }, 30);
      // Cumulative diagonal costs: 5, 15, 20, 30 -> four squares.
      t.assertDeepEqual(cells, [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
        { x: 4, y: 4 },
      ]);
    });

    t.test("a 10-ft-wide line adds a perpendicular lane", function () {
      const cells = AoE.getLineCells({ x: 0, y: 0 }, "east", 15, 10);
      t.assertEqual(cells.length, 6);
      t.assertTrue(hasCell(cells, 1, 0));
      t.assertTrue(hasCell(cells, 1, 1));
      t.assertTrue(hasCell(cells, 3, 1));
    });

    t.test("10-ft emanation surrounds a 2x2 Large footprint but excludes it", function () {
      const ogre = makeCombatant({
        id: "ogre",
        name: "Ogre",
        x: 1,
        y: 1,
        size: "large",
      });
      const map = new GridMap({ cols: 20, rows: 20 });
      const cells = AoE.getEmanationCells(ogre, 10, map);

      // All cells within 10 ft of the 2x2 footprint: 20 cells. The far
      // diagonal corner (4,4) is 15 ft away under 5-10-5 and is excluded.
      t.assertEqual(cells.length, 20);
      t.assertTrue(hasCell(cells, 1, 1) === false, "top-left footprint cell excluded");
      t.assertTrue(hasCell(cells, 2, 2) === false, "bottom-right footprint cell excluded");
      t.assertTrue(hasCell(cells, 0, 0), "diagonal perimeter cell is included");
      t.assertTrue(hasCell(cells, 4, 0), "orthogonal 10-ft perimeter cell is included");
      t.assertTrue(hasCell(cells, 0, 4), "orthogonal 10-ft perimeter cell is included");
      t.assertTrue(hasCell(cells, 4, 3), "perimeter corner at 10 ft is included");
      t.assertTrue(!hasCell(cells, 4, 4), "second diagonal step costs 15 ft");
      t.assertTrue(!hasCell(cells, 5, 0), "cells beyond the radius are excluded");
    });

    // ------------------------------------------------------ spell resources

    t.test("a rank-1 cast spends one rank-1 slot", function () {
      const wizard = makeCombatant({
        id: "wiz",
        name: "Wizard",
        x: 0,
        y: 0,
        spellSlots: { 1: { max: 2, current: 2 } },
      });
      const target = makeCombatant({
        id: "target",
        name: "Target",
        x: 3,
        y: 0,
      });
      const spell = rankedSpell({ id: "fear" });

      const first = performCastSpell({
        caster: wizard,
        spell: spell,
        target: target,
        rollD20: constantD20(10),
      });
      t.assertEqual(first.ok, true);
      t.assertEqual(first.resourceCost.type, "slot");
      t.assertEqual(first.resourceCost.rank, 1);
      t.assertEqual(wizard.getSpellSlot(1).current, 1);
      t.assertEqual(wizard.actionsRemaining, 2);

      const second = performCastSpell({
        caster: wizard,
        spell: spell,
        target: target,
        rollD20: constantD20(10),
      });
      t.assertEqual(second.ok, true);
      t.assertEqual(wizard.getSpellSlot(1).current, 0);
    });

    t.test("casting without a free slot returns no-spell-slots and spends nothing", function () {
      const wizard = makeCombatant({
        id: "wiz",
        name: "Wizard",
        x: 0,
        y: 0,
        spellSlots: { 1: { max: 0, current: 0 } },
      });
      const target = makeCombatant({
        id: "target",
        name: "Target",
        x: 3,
        y: 0,
      });

      const result = performCastSpell({
        caster: wizard,
        spell: rankedSpell({ id: "fear" }),
        target: target,
        rollD20: constantD20(10),
      });

      t.assertEqual(result.ok, false);
      t.assertEqual(result.reason, "no-spell-slots");
      t.assertEqual(wizard.actionsRemaining, 3);
      t.assertEqual(wizard.getSpellSlot(1).current, 0);
    });

    t.test("cantrips never spend spell slots", function () {
      const wizard = makeCombatant({
        id: "wiz",
        name: "Wizard",
        x: 0,
        y: 0,
        spellSlots: { 1: { max: 1, current: 0 } },
      });
      const target = makeCombatant({
        id: "target",
        name: "Target",
        x: 3,
        y: 0,
      });
      const cantrip = rankedSpell({
        id: "daze",
        rank: 0,
        traits: ["cantrip", "mental"],
      });

      const result = performCastSpell({
        caster: wizard,
        spell: cantrip,
        target: target,
        rollD20: constantD20(10),
      });

      t.assertEqual(result.ok, true);
      t.assertEqual(result.resourceCost.type, "none");
      t.assertEqual(wizard.getSpellSlot(1).current, 0);
      t.assertEqual(wizard.actionsRemaining, 2);
    });

    t.test("focus spells spend a Focus Point instead of a spell slot", function () {
      const cleric = makeCombatant({
        id: "cleric",
        name: "Cleric",
        x: 0,
        y: 0,
        spellSlots: { 1: { max: 1, current: 1 } },
        focusPoints: { max: 1, current: 1 },
      });
      const target = makeCombatant({
        id: "target",
        name: "Target",
        x: 3,
        y: 0,
      });
      const focusSpell = rankedSpell({
        id: "healer-font",
        traits: ["focus", "healing"],
      });

      const first = performCastSpell({
        caster: cleric,
        spell: focusSpell,
        target: target,
        rollD20: constantD20(10),
      });
      t.assertEqual(first.ok, true);
      t.assertEqual(first.resourceCost.type, "focus");
      t.assertEqual(cleric.getFocusPoints().current, 0);
      t.assertEqual(cleric.getSpellSlot(1).current, 1, "focus must not spend a slot");

      const second = performCastSpell({
        caster: cleric,
        spell: focusSpell,
        target: target,
        rollD20: constantD20(10),
      });
      t.assertEqual(second.ok, false);
      t.assertEqual(second.reason, "no-focus-points");
      t.assertEqual(cleric.getFocusPoints().current, 0);
      t.assertEqual(cleric.getSpellSlot(1).current, 1);
    });

    t.test("focus points default to an empty pool", function () {
      const plain = makeCombatant({ id: "plain", x: 0, y: 0 });
      t.assertDeepEqual(plain.getFocusPoints(), { max: 0, current: 0 });
      t.assertDeepEqual(plain.getSpellSlots(), {});
      t.assertEqual(plain.hasFocusPoint(), false);
      t.assertEqual(plain.spendFocusPoint(1).ok, false);
    });

    // ------------------------------------------------------------ sustain

    t.test("sustained spell is registered, sustained, and expires without support", function () {
      const caster = makeCombatant({
        id: "wiz",
        name: "Wizard",
        x: 0,
        y: 0,
        initiative: 10,
        spellSlots: { 1: { max: 2, current: 2 } },
      });
      const target = makeCombatant({
        id: "target",
        name: "Target",
        x: 3,
        y: 0,
        initiative: 5,
      });
      const encounter = new Encounter({ combatants: [caster, target] });
      encounter.startEncounter();

      const spell = rankedSpell({
        id: "bless",
        traits: ["sustained", "concentrate"],
      });
      const cast = performCastSpell({
        caster: caster,
        spell: spell,
        target: target,
        encounter: encounter,
        rollD20: constantD20(10),
      });

      t.assertEqual(cast.ok, true);
      t.assertEqual(cast.sustainedSpell.spellId, "bless");
      t.assertEqual(cast.sustainedSpell.expiresAtRound, 2);
      t.assertEqual(caster.getActiveSustainedSpells().length, 1);
      t.assertEqual(caster.actionsRemaining, 2);

      const activeId = caster.getActiveSustainedSpells()[0].id;
      const sustain = performSustainSpell({
        caster: caster,
        activeSpellId: activeId,
        encounter: encounter,
      });

      t.assertEqual(sustain.ok, true);
      t.assertEqual(sustain.actionCost, 1);
      t.assertDeepEqual(sustain.traits, ["concentrate"]);
      t.assertEqual(sustain.expiresAtRound, 3);
      t.assertEqual(caster.actionsRemaining, 1);

      // End of round 2: still sustained because the expiry is round 3.
      const endTwo = caster.endTurn({ round: 2 });
      t.assertEqual(endTwo.expiredSustainedSpells.length, 0);
      t.assertEqual(caster.getActiveSustainedSpells().length, 1);

      // End of round 3: no further sustain, the spell expires.
      const endThree = caster.endTurn({ round: 3 });
      t.assertEqual(endThree.expiredSustainedSpells.length, 1);
      t.assertEqual(endThree.expiredSustainedSpells[0].spellId, "bless");
      t.assertEqual(caster.getActiveSustainedSpells().length, 0);
    });

    t.test("unsustained spell expires at the end of the caster's next turn", function () {
      const caster = makeCombatant({
        id: "wiz",
        name: "Wizard",
        x: 0,
        y: 0,
        spellSlots: { 1: { max: 1, current: 1 } },
      });
      const target = makeCombatant({
        id: "target",
        name: "Target",
        x: 3,
        y: 0,
      });
      const spell = rankedSpell({
        id: "bless",
        traits: ["sustained", "concentrate"],
      });

      const cast = performCastSpell({
        caster: caster,
        spell: spell,
        target: target,
        encounter: { round: 1 },
        rollD20: constantD20(10),
      });
      t.assertEqual(cast.sustainedSpell.expiresAtRound, 2);
      t.assertEqual(caster.getActiveSustainedSpells().length, 1);

      const endTwo = caster.endTurn({ round: 2 });
      t.assertEqual(endTwo.expiredSustainedSpells.length, 1);
      t.assertEqual(caster.getActiveSustainedSpells().length, 0);
    });

    t.test("sustain rejects an unknown spell and an empty action pool", function () {
      const caster = makeCombatant({
        id: "wiz",
        name: "Wizard",
        x: 0,
        y: 0,
        spellSlots: { 1: { max: 1, current: 1 } },
      });
      const target = makeCombatant({
        id: "target",
        name: "Target",
        x: 3,
        y: 0,
      });
      performCastSpell({
        caster: caster,
        spell: rankedSpell({ id: "bless", traits: ["sustained"] }),
        target: target,
        encounter: { round: 1 },
        rollD20: constantD20(10),
      });

      const unknown = performSustainSpell({
        caster: caster,
        activeSpellId: "does-not-exist",
        encounter: { round: 1 },
      });
      t.assertEqual(unknown.ok, false);
      t.assertEqual(unknown.reason, "not-sustained");

      const activeId = caster.getActiveSustainedSpells()[0].id;
      caster.actionsRemaining = 0;
      const noActions = performSustainSpell({
        caster: caster,
        activeSpellId: activeId,
        encounter: { round: 1 },
      });
      t.assertEqual(noActions.ok, false);
      t.assertEqual(noActions.reason, "no-actions");
      t.assertEqual(caster.getActiveSustainedSpells()[0].expiresAtRound, 2);
    });

    // ------------------------------------------------ cast-time area shapes

    t.test("cone save spells target only creatures inside the wedge", function () {
      const caster = makeCombatant({
        id: "wiz",
        name: "Wizard",
        x: 0,
        y: 0,
        spellSlots: { 1: { max: 1, current: 1 } },
      });
      const inside = makeCombatant({ id: "inside", name: "Inside", x: 2, y: 0 });
      const outside = makeCombatant({ id: "outside", name: "Outside", x: 0, y: 4 });
      const map = new GridMap({ cols: 12, rows: 12 });
      const spell = rankedSpell({
        id: "burning-hands",
        area: { type: "cone", lengthFeet: 10 },
      });

      const result = performCastSpell({
        caster: caster,
        spell: spell,
        direction: "east",
        combatants: [caster, inside, outside],
        map: map,
        rollD20: constantD20(10),
      });

      t.assertEqual(result.ok, true);
      t.assertEqual(result.area.type, "cone");
      // The 10-ft wedge would be 6 cells on an infinite plane; two cells at
      // y = -1 are clipped because the caster stands on the top map edge.
      t.assertEqual(result.area.cells.length, 4);
      t.assertEqual(result.results.length, 1);
      t.assertEqual(result.results[0].targetId, "inside");
      t.assertEqual(caster.actionsRemaining, 2);
    });

    t.test("line save spells use the caster as the apex and stop at walls", function () {
      const caster = makeCombatant({
        id: "wiz",
        name: "Wizard",
        x: 0,
        y: 0,
        spellSlots: { 1: { max: 1, current: 1 } },
      });
      const near = makeCombatant({ id: "near", name: "Near", x: 2, y: 0 });
      const far = makeCombatant({ id: "far", name: "Far", x: 6, y: 0 });
      const map = new GridMap({
        cols: 12,
        rows: 12,
        blocked: [{ x: 4, y: 0 }],
      });
      const spell = rankedSpell({
        id: "lightning-bolt",
        area: { type: "line", lengthFeet: 30, widthFeet: 5 },
      });

      const result = performCastSpell({
        caster: caster,
        spell: spell,
        direction: { x: 1, y: 0 },
        combatants: [caster, near, far],
        map: map,
        rollD20: constantD20(10),
      });

      t.assertEqual(result.ok, true);
      t.assertEqual(result.area.type, "line");
      t.assertDeepEqual(result.area.cells, [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ]);
      t.assertEqual(result.results.length, 1);
      t.assertEqual(result.results[0].targetId, "near");
      t.assertTrue(!result.results.some(function (entry) {
        return entry.targetId === "far";
      }));
    });

    t.test("emanation save spells radiate from the caster and exclude its footprint", function () {
      const caster = makeCombatant({
        id: "wiz",
        name: "Wizard",
        x: 5,
        y: 5,
        spellSlots: { 1: { max: 1, current: 1 } },
      });
      const inside = makeCombatant({ id: "inside", name: "Inside", x: 6, y: 5 });
      const outside = makeCombatant({ id: "outside", name: "Outside", x: 9, y: 9 });
      const map = new GridMap({ cols: 12, rows: 12 });
      const spell = rankedSpell({
        id: "bless",
        area: { type: "emanation", radiusFeet: 10 },
      });

      const result = performCastSpell({
        caster: caster,
        spell: spell,
        combatants: [caster, inside, outside],
        map: map,
        rollD20: constantD20(10),
      });

      t.assertEqual(result.ok, true);
      t.assertEqual(result.area.type, "emanation");
      t.assertEqual(result.area.cells.length, 20);
      t.assertTrue(!hasCell(result.area.cells, 5, 5), "caster footprint is excluded");
      t.assertEqual(result.results.length, 1);
      t.assertEqual(result.results[0].targetId, "inside");
    });
  };
});
