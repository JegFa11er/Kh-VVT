import test from "node:test";
import assert from "node:assert/strict";

import {
  abilityBuildBreakdown,
  abilityMod,
  defaultAbilityBuild,
  matchSelectionsToSlots,
  prepareActorData,
  prepareActorSystem,
  proficiencyBonus,
  sanitizeAbilityBuild,
} from "../src/ui/windows/character/character-data.js";

function makeActor(systemOverrides = {}) {
  return {
    id: "actor-1",
    name: "Test Hero",
    system: {
      details: { level: { value: 5 } },
      abilities: {
        str: { mod: 4 },
        dex: { mod: 2 },
        con: { mod: 0 },
        int: { mod: 0 },
        wis: { mod: 1 },
        cha: { mod: 0 },
      },
      perception: { rank: 1 },
      saves: {
        fortitude: { rank: 1 },
        reflex: { rank: 2 },
        will: { rank: 0 },
      },
      proficiencies: {
        attacks: { unarmed: 2 },
        defenses: { unarmored: 0, light: 1 },
      },
      strikes: [],
      ...systemOverrides,
    },
  };
}

test("ability modifier reads the pure Remastered modifier", function () {
  assert.equal(abilityMod({ abilities: { str: { mod: 4 } } }, "str"), 4);
  assert.equal(abilityMod({ abilities: { str: { mod: -2 } } }, "str"), -2);
  // Scores are not part of live math any more.
  assert.equal(abilityMod({ abilities: { str: { score: 18 } } }, "str"), 0);
});

test("legacy score-only abilities are migrated once to pure modifiers", function () {
  const system = prepareActorSystem({
    abilities: { str: { score: 18 }, dex: { score: 8 } },
  });
  assert.equal(system.abilities.str.mod, 4);
  assert.equal(system.abilities.str.score, undefined);
  assert.equal(system.abilities.dex.mod, -1);
});

test("proficiency bonus is level + rank * 2, untrained is 0", function () {
  assert.equal(proficiencyBonus(5, 0), 0);
  assert.equal(proficiencyBonus(5, 1), 7);
  assert.equal(proficiencyBonus(5, 2), 9);
  assert.equal(proficiencyBonus(5, 3), 11);
  assert.equal(proficiencyBonus(5, 4), 13);
});

test("prepared fighter gets Strength on fists and automatic saves/perception", function () {
  const prepared = prepareActorData(makeActor()).system;
  const fist = prepared.strikes.find((strike) => strike.unarmed);
  assert.ok(fist);
  // Strength +4, expert unarmed: level 5 + 4 = 9 => +13 attack.
  assert.equal(fist.attack, 13);
  assert.equal(fist.damage, "1d4+4");
  // Untrained unarmored AC: 10 + Dex 2.
  assert.equal(prepared.attributes.ac.value, 12);
  assert.equal(prepared.saves.fortitude.mod, 7);
  assert.equal(prepared.saves.reflex.mod, 11);
  assert.equal(prepared.saves.will.mod, 1);
  assert.equal(prepared.perception.mod, 8);
});

test("worn armor caps Dex and adds item/proficiency bonuses", function () {
  const prepared = prepareActorData(
    makeActor({
      details: { level: { value: 1 } },
      abilities: {
        str: { mod: 0 },
        dex: { mod: 4 },
        con: { mod: 0 },
        int: { mod: 0 },
        wis: { mod: 0 },
        cha: { mod: 0 },
      },
      inventory: {
        items: [
          {
            id: "armor-1",
            name: "Leather Armor",
            type: "armor",
            carried: "worn",
            category: "light",
            acBonus: 2,
            dexCap: 3,
          },
        ],
      },
      proficiencies: {
        attacks: {},
        defenses: { unarmored: 0, light: 1 },
      },
    }),
  ).system;
  // 10 + capped Dex 3 + item 2 + (level 1 + trained 2 = 3)
  assert.equal(prepared.attributes.ac.value, 18);
});

function abilitySources() {
  return {
    ancestry: {
      system: {
        boosts: {
          0: { value: ["str"] },
          1: { value: ["dex"] },
          2: { value: ["str", "dex", "con", "int", "wis", "cha"] },
        },
        flaws: { 0: { value: ["con"] } },
      },
    },
    background: {
      system: {
        boosts: {
          0: { value: ["str", "con"] },
          1: { value: ["str", "con", "int", "wis"] },
        },
      },
    },
    class: { system: { keyAbility: { value: ["str"] } } },
  };
}

function gridBuild() {
  return {
    manual: false,
    boosts: {
      ancestry: ["str", "dex", "wis"],
      background: ["str", "con"],
      class: "str",
      levels: { 1: ["str", "con", "wis", "cha"], 5: ["str"] },
    },
    flaws: { ancestry: ["con"] },
  };
}

test("ability builder caps creation boosts at +4 and applies level boosts", function () {
  const level1 = abilityBuildBreakdown(abilitySources(), gridBuild(), 1);
  assert.deepEqual(level1.mods, {
    str: 4,
    dex: 1,
    con: 1,
    int: 0,
    wis: 2,
    cha: 1,
  });
  // Level-1 flaws are applied after the 18-cap.
  assert.equal(level1.flaws.con, 1);

  const level5 = abilityBuildBreakdown(abilitySources(), gridBuild(), 5);
  assert.equal(level5.mods.str, 5);
  assert.equal(level5.mods.con, 1);
});

test("ability builder keeps fixed ancestry boosts and rejects unknown choices", function () {
  const build = sanitizeAbilityBuild(
    {
      boosts: {
        ancestry: ["cha", "dex"],
        background: ["str", "con"],
        class: "cha",
        levels: { 1: ["str", "str", "wis", "cha"] },
      },
    },
    abilitySources(),
    1,
  );
  // Strength is fixed by the ancestry document and cannot be deselected.
  assert.ok(build.boosts.ancestry.includes("str"));
  assert.equal(build.boosts.class, null);
  assert.deepEqual(build.boosts.levels[1], ["str", "wis", "cha"]);
});

test("default builder reconstructs a plausible grid from current modifiers", function () {
  const build = defaultAbilityBuild(
    abilitySources(),
    1,
    { str: { mod: 4 }, dex: { mod: 1 }, con: { mod: 1 }, int: { mod: 0 }, wis: { mod: 2 }, cha: { mod: 1 } },
  );
  assert.deepEqual(build.boosts.levels[1].length, 4);
  assert.equal(new Set(build.boosts.levels[1]).size, 4);
  assert.ok(build.boosts.ancestry.includes("str"));
});

test("restricted background slots only accept a valid assignment", function () {
  const sources = {
    background: {
      system: {
        boosts: {
          0: { value: ["int", "wis"] },
          1: { value: ["str", "dex", "con", "int", "wis", "cha"] },
        },
      },
    },
  };
  const all = ["str", "dex", "con", "int", "wis", "cha"];

  // "str + dex" cannot satisfy the Intelligence-or-Wisdom slot.
  assert.deepEqual(
    sanitizeAbilityBuild({ boosts: { background: ["str", "dex"] } }, sources, 1)
      .boosts.background,
    ["str"],
  );
  // "int + dex" does: Int fills the restricted slot and Dex the free one.
  assert.deepEqual(
    sanitizeAbilityBuild({ boosts: { background: ["int", "dex"] } }, sources, 1)
      .boosts.background,
    ["int", "dex"],
  );
  assert.deepEqual(
    matchSelectionsToSlots([["int", "wis"], all], ["str", "dex"]),
    ["str"],
  );
  assert.deepEqual(
    matchSelectionsToSlots([["int", "wis"], all], ["int", "dex"]),
    ["int", "dex"],
  );
});

test("preparation is idempotent and never doubles the fist modifier", function () {
  const once = prepareActorSystem(makeActor().system);
  const twice = prepareActorSystem(once);
  assert.equal(
    twice.strikes.find((strike) => strike.unarmed).damage,
    once.strikes.find((strike) => strike.unarmed).damage,
  );
});
