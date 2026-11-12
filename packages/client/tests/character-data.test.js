import test from "node:test";
import assert from "node:assert/strict";

import {
  ABILITY_BUILDER_LEVELS,
  abilityBuildBreakdown,
  abilityMod,
  clampHpToMax,
  createActorSpellFromDocument,
  defaultAbilityBuild,
  focusSpellPointCost,
  isFocusSpellcastingEntry,
  matchSelectionsToSlots,
  maxSpellRankForLevel,
  parseHpInput,
  prepareActorData,
  prepareActorSystem,
  proficiencyBonus,
  sanitizeAbilityBuild,
  strikeMapLabel,
  trimBackgroundBoosts,
} from "../src/ui/windows/character/character-data.js";
import {
  conditionIcon,
  conditionMaxStage,
  conditionStage,
  initialConditionStage,
  isStagedCondition,
} from "../src/ui/conditions.js";

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

test("default builder leaves every free boost empty for the player", function () {
  const build = defaultAbilityBuild(abilitySources(), 1);
  // Free 1st-level boosts are never pre-spent (Step 5.6).
  assert.deepEqual(build.boosts.levels[1], []);
  // The class key ability is a player choice as well.
  assert.equal(build.boosts.class, null);
  // Fixed ancestry/background boosts are still applied automatically.
  assert.ok(build.boosts.ancestry.includes("str"));
  for (const level of ABILITY_BUILDER_LEVELS) {
    assert.deepEqual(build.boosts.levels[level], []);
  }
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

test("background parsing keeps exactly two ability boost slots", function () {
  const legacyThree = {
    0: { value: ["cha", "con", "dex", "int", "str", "wis"] },
    1: { value: ["cha", "con", "dex", "int", "str", "wis"] },
    2: { value: ["cha", "con", "dex", "int", "str", "wis"] },
  };
  const trimmed = trimBackgroundBoosts(legacyThree);
  assert.equal(trimmed.length, 2);

  const build = abilityBuildBreakdown(
    {
      background: {
        type: "background",
        system: { boosts: legacyThree, trainedSkills: { value: [] } },
      },
    },
    { boosts: { background: ["str", "dex", "con"] } },
    1,
  );
  // Only the first two background choices are applied.
  assert.equal(build.creationBoosts.str, 1);
  assert.equal(build.creationBoosts.dex, 1);
  assert.equal(build.creationBoosts.con || 0, 0);
});

test("preparation is idempotent and never doubles the fist modifier", function () {
  const once = prepareActorSystem(makeActor().system);
  const twice = prepareActorSystem(once);
  assert.equal(
    twice.strikes.find((strike) => strike.unarmed).damage,
    once.strikes.find((strike) => strike.unarmed).damage,
  );
});

test("ancestry selection applies size and trait tags", function () {
  const prepared = prepareActorData({
    id: "gnome-1",
    name: "Gnome",
    system: {
      details: {
        level: { value: 1 },
        ancestry: { name: "Gnome", size: "sm", traits: ["gnome", "humanoid"] },
        heritage: { name: "Wellspring Gnome", traits: ["gnome"] },
      },
    },
  }).system;

  assert.equal(prepared.traits.size.value, "sm");
  assert.ok(prepared.traits.value.includes("gnome"));
  assert.ok(prepared.traits.value.includes("humanoid"));

  // Switching to a Medium ancestry resets size and drops the old tags.
  const human = prepareActorData({
    id: "human-1",
    name: "Human",
    system: {
      details: {
        level: { value: 1 },
        ancestry: { name: "Human", size: "med", traits: ["human", "humanoid"] },
      },
      traits: {
        ...prepared.traits,
        value: prepared.traits.value,
      },
    },
  }).system;

  assert.equal(human.traits.size.value, "med");
  assert.ok(human.traits.value.includes("human"));
  assert.equal(human.traits.value.includes("gnome"), false);
});

// ---------------------------------------------------------------------------
// Step 5.8 — ActiveEffectLike rule elements / minRank floors
// ---------------------------------------------------------------------------

function featWithRule(id, path, value) {
  return {
    id,
    name: id,
    type: "feat",
    system: {
      category: "classfeature",
      rules: [{ key: "ActiveEffectLike", mode: "upgrade", path, value }],
    },
  };
}

test("ActiveEffectLike rule elements make Reflex Expertise a floor", function () {
  const actor = makeActor({
    saves: {
      fortitude: { rank: 1 },
      reflex: { rank: 0 },
      will: { rank: 0 },
    },
  });
  actor.items = [featWithRule("reflex-expertise", "system.saves.reflex.rank", 2)];

  const prepared = prepareActorData(actor).system;
  assert.equal(prepared.saves.reflex.rank, 2);
  assert.equal(prepared.saves.reflex.minRank, 2);
  // Dex +2 and expert proficiency at level 5: 2 + 5 + 4 = +11.
  assert.equal(prepared.saves.reflex.mod, 11);

  // A persisted rank below the granted floor is clamped back up.
  const lowered = prepareActorData({
    ...actor,
    system: {
      ...actor.system,
      saves: { ...actor.system.saves, reflex: { rank: 0 } },
    },
  }).system;
  assert.equal(lowered.saves.reflex.rank, 2);
});

test("Remastered subfeatures grant save and defense proficiency floors", function () {
  const actor = makeActor({});
  actor.items = [
    {
      id: "fortitude-expertise",
      name: "Fortitude Expertise",
      type: "feat",
      system: { subfeatures: { proficiencies: { fortitude: { rank: 2 } } } },
    },
    {
      id: "light-armor-expertise",
      name: "Light Armor Expertise",
      type: "feat",
      system: {
        subfeatures: {
          proficiencies: { light: { rank: 2 }, unarmored: { rank: 2 } },
        },
      },
    },
  ];

  const prepared = prepareActorData(actor).system;
  assert.equal(prepared.saves.fortitude.rank, 2);
  assert.equal(prepared.saves.fortitude.minRank, 2);
  assert.equal(prepared.proficiencies.defenses.light.rank, 2);
  assert.equal(prepared.proficiencies.defenses.light.minRank, 2);
  assert.equal(prepared.proficiencies.defenses.unarmored.rank, 2);
});

test("rule-element ternary values scale with the actor level", function () {
  const make = (level) => {
    const actor = makeActor({ details: { level: { value: level } } });
    actor.items = [
      featWithRule(
        "acrobat-dedication",
        "system.skills.acrobatics.rank",
        "ternary(gte(@actor.level,15),4,ternary(gte(@actor.level,7),3,2))",
      ),
    ];
    return prepareActorData(actor).system.skills.acrobatics;
  };

  assert.equal(make(1).rank, 2);
  assert.equal(make(7).rank, 3);
  assert.equal(make(15).rank, 4);
  assert.equal(make(7).minRank, 3);
});

test("condition helpers distinguish staged and boolean conditions", function () {
  assert.equal(conditionMaxStage("frightened"), 4);
  assert.equal(conditionMaxStage("wounded"), 3);
  assert.equal(conditionMaxStage("prone"), 0);
  assert.equal(isStagedCondition("frightened"), true);
  assert.equal(isStagedCondition("prone"), false);
  assert.equal(initialConditionStage("frightened"), 1);
  assert.equal(initialConditionStage("prone"), 0);
  assert.equal(conditionStage({ value: "frightened", value2: 2 }), 2);
  assert.equal(conditionStage({ value: "frightened" }), 0);
  assert.equal(conditionIcon("frightened"), "😱");
  assert.equal(conditionIcon("unknown-condition"), "◉");
});

// ---------------------------------------------------------------------------
// Step 5.9: HP clamping, spell-rank gating and MAP formatting
// ---------------------------------------------------------------------------

test("current HP can never exceed maximum HP", function () {
  assert.equal(clampHpToMax(20, 12), 12);
  assert.equal(clampHpToMax(12, 12), 12);
  assert.equal(clampHpToMax(3, 12), 3);
  assert.equal(clampHpToMax(-4, 12), 0);
  assert.equal(clampHpToMax(7, 0), 0);
});

test("HP input accepts absolute values and signed deltas", function () {
  assert.equal(parseHpInput("15", 10), 15);
  assert.equal(parseHpInput("+10", 10), 20);
  assert.equal(parseHpInput("-5", 10), 5);
  assert.equal(parseHpInput("+ 3", 10), 13);
  assert.equal(parseHpInput("", 10), null);
  assert.equal(parseHpInput("abc", 10), null);
  // Token HUD `+20` then clamps to the maximum.
  assert.equal(clampHpToMax(parseHpInput("+20", 10), 12), 12);
});

test("maximum spell rank follows the character level", function () {
  assert.equal(maxSpellRankForLevel(1), 1);
  assert.equal(maxSpellRankForLevel(2), 1);
  assert.equal(maxSpellRankForLevel(3), 2);
  assert.equal(maxSpellRankForLevel(9), 5);
  assert.equal(maxSpellRankForLevel(10), 5);
  assert.equal(maxSpellRankForLevel(19), 10);
  assert.equal(maxSpellRankForLevel(20), 10);
  assert.equal(maxSpellRankForLevel(30), 10);
  assert.equal(maxSpellRankForLevel(undefined), 1);
});

test("MAP labels follow Foundry's one-line format", function () {
  assert.equal(strikeMapLabel(3, -5), "+3 (MAP -5)");
  assert.equal(strikeMapLabel(-2, -10), "-2 (MAP -10)");
  assert.equal(strikeMapLabel(6, -4), "+6 (MAP -4)");
  assert.equal(strikeMapLabel(2, -8), "+2 (MAP -8)");
  assert.equal(strikeMapLabel(0, 0), "+0 (MAP 0)");
});

// Step 6.3: Focus Points are derived from known focus spells, capped at 3.
function focusSpell(id, name, { cantrip = false, traits = ["focus"] } = {}) {
  return {
    id,
    name,
    type: "spell",
    traits: traits.join(", "),
    system: {
      level: { value: cantrip ? 0 : 1 },
      traits: { value: traits },
    },
  };
}

test("focus pool max is the number of non-cantrip focus spells, capped at 3", function () {
  const none = prepareActorData(makeActor()).system;
  assert.equal(none.resources.focus.max, 0);
  assert.equal(none.resources.focus.cap, 3);

  const one = prepareActorData({
    ...makeActor(),
    items: [focusSpell("f1", "Healer's Blessing")],
  }).system;
  assert.equal(one.resources.focus.max, 1);
  assert.equal(one.resources.focus.known, 1);

  const four = prepareActorData({
    ...makeActor(),
    items: [
      focusSpell("f1", "Healer's Blessing"),
      focusSpell("f2", "Fire Ray"),
      focusSpell("f3", "Lay on Hands"),
      focusSpell("f4", "Zeal for Battle"),
    ],
  }).system;
  assert.equal(four.resources.focus.max, 3);
  assert.equal(four.resources.focus.known, 3);

  // Cantrips never widen the pool, and duplicate copies count once.
  const cantrips = prepareActorData({
    ...makeActor(),
    items: [
      focusSpell("f1", "Inspire Courage", {
        cantrip: true,
        traits: ["focus", "cantrip", "auditory"],
      }),
      focusSpell("f2", "Healer's Blessing"),
      focusSpell("f3", "Healer's Blessing"),
    ],
  }).system;
  assert.equal(cantrips.resources.focus.max, 1);
});

test("focus pool supports a manual maximum override and clamps value", function () {
  const actor = {
    ...makeActor({
      resources: { focus: { value: 2, max: 2, override: true } },
    }),
    items: [focusSpell("f1", "Healer's Blessing")],
  };
  const overridden = prepareActorData(actor).system;
  assert.equal(overridden.resources.focus.max, 2);
  assert.equal(overridden.resources.focus.value, 2);
  assert.equal(overridden.resources.focus.override, true);

  const clamped = prepareActorData({
    ...actor,
    system: {
      ...actor.system,
      resources: { focus: { value: 9, max: 9, override: true } },
    },
  }).system;
  assert.equal(clamped.resources.focus.max, 3);
  assert.equal(clamped.resources.focus.value, 3);

  const derived = prepareActorData({
    ...actor,
    system: {
      ...actor.system,
      resources: { focus: { value: 1, max: 3, override: false } },
    },
  }).system;
  assert.equal(derived.resources.focus.max, 1);
  assert.equal(derived.resources.focus.value, 1);
});

// Step 6.3.1: Focus sets are rankless and cast from the shared Focus pool.
test("focus spellcasting entries are detected across authored spellings", function () {
  assert.equal(isFocusSpellcastingEntry({ system: { prepared: "focus" } }), true);
  assert.equal(isFocusSpellcastingEntry({ system: { mode: "focus" } }), true);
  assert.equal(isFocusSpellcastingEntry({ system: { type: "focus" } }), true);
  assert.equal(
    isFocusSpellcastingEntry({ system: { prepared: "prepared", mode: "attack" } }),
    false,
  );
  assert.equal(isFocusSpellcastingEntry({ system: { prepared: "spontaneous" } }), false);
  assert.equal(isFocusSpellcastingEntry({}), false);
  assert.equal(isFocusSpellcastingEntry(null), false);
});

test("focus casts spend one point for ranked spells and none for cantrips", function () {
  assert.equal(focusSpellPointCost(0), 0);
  assert.equal(focusSpellPointCost("0"), 0);
  assert.equal(focusSpellPointCost("cantrip"), 0);
  assert.equal(focusSpellPointCost(1), 1);
  assert.equal(focusSpellPointCost(7), 1);
});

test("spells dropped into a focus set keep location.value and no slot rank", function () {
  const spell = createActorSpellFromDocument(
    {
      name: "Fire Ray",
      type: "spell",
      system: {
        level: { value: 1 },
        traits: { value: ["attack", "focus", "fire"] },
      },
    },
    { entryId: "focus-entry" },
  );
  assert.equal(spell.entryId, "focus-entry");
  assert.equal(spell.system.location.value, "focus-entry");
  assert.equal(spell.rank, 1);
  assert.equal(spell.system.slots, undefined);
});
