/**
 * Phase 12 — Spellcasting Foundation, Basic Saves & AoE Geometry.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Actions/cast-spell.js"),
      require("../../src/Core/Grid/aoe.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Actions — Spellcasting & AoE",
      register: factory(
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Actions.CastSpell,
        root.PF2e.Core.Grid.AoE,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Combatant,
  CastSpell,
  AoE,
) {
  "use strict";

  if (!Combatant || !CastSpell || !AoE) {
    throw new Error("Spellcasting tests require Combatant, CastSpell and AoE.");
  }

  const performCastSpell = CastSpell.performCastSpell;
  const getBurstCells = AoE.getBurstCells;

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

  return function registerSpellTests(t) {
    t.test("attack spell uses MAP, applies typed damage and IWR weakness", function () {
      const wizard = makeCombatant({
        id: "wiz",
        name: "Wizard",
        x: 0,
        y: 0,
        spellAttackBonus: 8,
        actionsRemaining: 3,
      });
      const goblin = makeCombatant({
        id: "gob",
        name: "Goblin",
        x: 2,
        y: 0,
        ac: 15,
        maxHP: 12,
        currentHP: 12,
        weaknesses: [{ type: "fire", value: 3 }],
      });
      const spell = {
        id: "ignition",
        cost: 2,
        type: "attack",
        traits: ["attack", "fire"],
        damage: { formula: "2d6", type: "fire" },
      };

      // d20(10) + 8 = 18 vs AC 15 -> Success. 2d6 -> 4 + 4 = 8 fire.
      const res = performCastSpell({
        caster: wizard,
        spell,
        target: goblin,
        rollD20: function () {
          return 10;
        },
        rollDamageDie: function () {
          return 4;
        },
      });

      t.assertEqual(res.ok, true);
      t.assertEqual(res.degree, "SUCCESS");
      t.assertEqual(wizard.actionsRemaining, 1);
      t.assertEqual(wizard.attacksThisTurn, 1);
      // 8 fire + 3 weakness = 11 damage -> HP: 12 - 11 = 1.
      t.assertEqual(goblin.currentHP, 1);
      t.assertEqual(res.results[0].targetId, "gob");
    });

    t.test("basic Reflex save halves damage on a success", function () {
      const wizard = makeCombatant({
        id: "wiz",
        name: "Wizard",
        x: 0,
        y: 0,
        spellDC: 18,
        actionsRemaining: 2,
      });
      const rogue = makeCombatant({
        id: "rogue",
        name: "Rogue",
        x: 2,
        y: 0,
        maxHP: 20,
        currentHP: 20,
        saves: { reflex: 8 },
      });
      const spell = {
        id: "electric-arc",
        cost: 2,
        type: "save",
        saveType: "reflex",
        basic: true,
        damage: { formula: "2d4", type: "electricity" },
      };

      // d20(10) + Reflex 8 = 18 vs DC 18 -> SUCCESS -> half of 8 = 4.
      const res = performCastSpell({
        caster: wizard,
        spell,
        target: rogue,
        rollD20: function () {
          return 10;
        },
        rollDamageDie: function () {
          return 4;
        },
      });

      t.assertEqual(res.ok, true);
      t.assertEqual(res.results[0].degree, "SUCCESS");
      t.assertEqual(wizard.attacksThisTurn, 0);
      t.assertEqual(rogue.currentHP, 16);
    });

    t.test("burst AoE damages every living target in the radius", function () {
      const wizard = makeCombatant({
        id: "wiz",
        name: "Wizard",
        x: 0,
        y: 0,
        spellDC: 16,
        actionsRemaining: 2,
      });
      const enemy1 = makeCombatant({
        id: "e1",
        name: "Enemy 1",
        x: 4,
        y: 4,
        maxHP: 10,
        currentHP: 10,
        saves: { reflex: 0 },
      });
      const enemy2 = makeCombatant({
        id: "e2",
        name: "Enemy 2",
        x: 4,
        y: 5,
        maxHP: 10,
        currentHP: 10,
        saves: { reflex: 0 },
      });
      const spell = {
        id: "fireball-mini",
        cost: 2,
        type: "save",
        saveType: "reflex",
        basic: true,
        area: { type: "burst", radiusFeet: 10 },
        damage: { formula: "2d6", type: "fire" },
      };

      // Both enemies are inside a 10-ft burst centred on (4, 4). d20(7) + 0
      // vs DC 16 is a FAILURE (7 > DC - 10 = 6), so each takes full 6 damage.
      const res = performCastSpell({
        caster: wizard,
        spell,
        origin: { x: 4, y: 4 },
        combatants: [wizard, enemy1, enemy2],
        rollD20: function () {
          return 7;
        },
        rollDamageDie: function () {
          return 3;
        },
      });

      t.assertEqual(res.ok, true);
      t.assertEqual(res.results.length, 2);
      t.assertEqual(res.area.cells.length, 21);
      t.assertEqual(enemy1.currentHP, 4);
      t.assertEqual(enemy2.currentHP, 4);
    });

    t.test("burst cells respect walls and use 5-10-5 distance", function () {
      const cells = getBurstCells({ x: 2, y: 2 }, 10);
      // A 10-ft burst covers the 5x5 box minus the four diagonal corners
      // (which cost 15 ft under the 5-10-5 alternation).
      t.assertEqual(cells.length, 21);
      t.assertTrue(
        cells.some(function (cell) {
          return cell.x === 4 && cell.y === 3;
        }),
      );
      t.assertTrue(
        !cells.some(function (cell) {
          return cell.x === 4 && cell.y === 4;
        }),
      );

      const map = {
        cols: 10,
        rows: 10,
        isBlocked: function (x, y) {
          return x === 3 && y === 2;
        },
      };
      const withWall = getBurstCells({ x: 2, y: 2 }, 10, map);
      t.assertTrue(
        !withWall.some(function (cell) {
          return cell.x === 3 && cell.y === 2;
        }),
      );
      t.assertEqual(withWall.length, 20);
    });
  };
});
