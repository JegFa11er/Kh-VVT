"use strict";

/**
 * Step 4.8.1: actor preparation pipeline (equipment, spellcasting, classes).
 *
 * Run with: npm run test --workspace=@pf2e/server
 */

const assert = require("node:assert/strict");

const {
  applyClassToActor,
  createActorFeatFromDocument,
  createActorItemFromDocument,
  createActorSpellFromDocument,
  encumbranceState,
  normalizePhysicalItem,
  prepareActorData,
  totalBulk,
} = require("@pf2e/core/src/actor/prepare-data.js");
const path = require("node:path");
const { EncounterSession } = require("../src/room/encounter-session.js");
const { CatalogService } = require("../src/compendium/catalog-service.js");

const tests = [];

function test(name, handler) {
  tests.push({ name: name, handler: handler });
}

function abilities(overrides) {
  return Object.assign(
    { str: { mod: 0 }, dex: { mod: 0 }, con: { mod: 0 }, int: { mod: 0 }, wis: { mod: 0 }, cha: { mod: 0 } },
    overrides,
  );
}

function actorWith(overrides) {
  return Object.assign(
    {
      id: "actor-pipeline",
      name: "Pipeline Hero",
      system: {
        details: { level: { value: 1 } },
        abilities: abilities(),
        proficiencies: {
          attacks: { simple: 0, martial: 0, advanced: 0, unarmed: 0 },
          defenses: { unarmored: 0, light: 0, medium: 0, heavy: 0 },
          spellcasting: { rank: 0 },
        },
        inventory: { items: [] },
        strikes: [],
      },
      items: [],
    },
    overrides,
  );
}

function makeClassDocument() {
  return {
    id: "class-rogue",
    name: "Rogue",
    img: null,
    system: {
      attacks: { simple: 1, martial: 1, advanced: 0, unarmed: 1 },
      defenses: { unarmored: 1, light: 1, medium: 0, heavy: 0 },
      perception: 2,
      savingThrows: { fortitude: 1, reflex: 2, will: 2 },
      keyAbility: { value: ["dex"] },
      classFeatLevels: { value: [1, 2, 4, 6] },
      generalFeatLevels: { value: [3, 7] },
      items: {
        a: {
          name: "Sneak Attack",
          level: 1,
          img: "sneak.webp",
          uuid: "Compendium.pf2e.classfeatures.Item.Sneak Attack",
        },
        b: {
          name: "Surprise Attack",
          level: 1,
          img: "surprise.webp",
          uuid: "Compendium.pf2e.classfeatures.Item.Surprise Attack",
        },
        c: {
          name: "Deny Advantage",
          level: 3,
          img: "deny.webp",
          uuid: "Compendium.pf2e.classfeatures.Item.Deny Advantage",
        },
      },
    },
  };
}

test("held weapon produces a Strike, stowed weapon produces none", function () {
  const actor = actorWith({
    system: {
      details: { level: { value: 1 } },
      abilities: abilities({ str: { mod: 4 }, dex: { mod: 2 } }),
      proficiencies: {
        attacks: { simple: 0, martial: 1, advanced: 0, unarmed: 0 },
        defenses: { unarmored: 0, light: 0, medium: 0, heavy: 0 },
        spellcasting: { rank: 0 },
      },
      inventory: {
        items: [
          {
            id: "weapon-longsword",
            name: "Longsword",
            type: "weapon",
            carried: "held",
            quantity: 1,
            bulk: 1,
            weaponCategory: "martial",
            damage: "1d8",
            damageType: "slashing",
            traits: "",
          },
        ],
      },
      strikes: [],
    },
  });

  const held = prepareActorData(actor).system;
  const strike = held.strikes.find((entry) => entry.itemId === "weapon-longsword");
  assert.ok(strike, "held weapon should be present in strikes");
  // Strength +4, trained martial at level 1: level 1 + 2 = 3 => +7.
  assert.equal(strike.attack, 7);
  assert.equal(strike.damage, "1d8+4");

  actor.system.inventory.items[0].carried = "stowed";
  const stowed = prepareActorData(actor).system;
  assert.equal(
    stowed.strikes.some((entry) => entry.itemId === "weapon-longsword"),
    false,
    "stowed weapon must not appear in strikes",
  );
});

test("spellcasting entry computes spell attack and DC", function () {
  const actor = actorWith({
    system: {
      details: { level: { value: 5 } },
      abilities: abilities({ int: { mod: 4 } }),
      proficiencies: {
        attacks: { simple: 0, martial: 0, advanced: 0, unarmed: 0 },
        defenses: { unarmored: 0, light: 0, medium: 0, heavy: 0 },
        spellcasting: { rank: 1 },
      },
      inventory: { items: [] },
      strikes: [],
    },
    items: [
      {
        id: "sc-arcane",
        name: "Arcane Prepared",
        type: "spellcastingEntry",
        system: {
          prepared: "prepared",
          mode: "attack",
          tradition: "arcane",
          ability: "int",
          proficiency: { value: 1 },
          slots: [{ rank: "1", value: 1, max: 1 }],
        },
      },
    ],
  });

  const prepared = prepareActorData(actor);
  const entry = prepared.items.find((item) => item.id === "sc-arcane");
  assert.ok(entry);
  // Level 5 + Rank 1 * 2 + Int +4 = 11; DC = 10 + 11 = 21.
  assert.equal(entry.spellAttack, 11);
  assert.equal(entry.spellDC, 21);
  assert.equal(prepared.system.derived.spellcasting[0].spellAttack, 11);

  actor.items[0].system.proficiency = { value: 2 };
  const expert = prepareActorData(actor).items[0];
  assert.equal(expert.spellAttack, 13);
  assert.equal(expert.spellDC, 23);
});

test("stowed armor contributes no AC bonus or Dex cap", function () {
  const actor = actorWith({
    system: {
      details: { level: { value: 1 } },
      abilities: abilities({ dex: { mod: 4 } }),
      proficiencies: {
        attacks: { simple: 0, martial: 0, advanced: 0, unarmed: 0 },
        defenses: { unarmored: 0, light: 1, medium: 0, heavy: 0 },
        spellcasting: { rank: 0 },
      },
      inventory: {
        items: [
          {
            id: "armor-leather",
            name: "Leather Armor",
            type: "armor",
            carried: "stowed",
            category: "light",
            acBonus: 2,
            dexCap: 1,
          },
        ],
      },
      strikes: [],
    },
  });

  assert.equal(prepareActorData(actor).system.attributes.ac.value, 14);

  actor.system.inventory.items[0].carried = "worn";
  const worn = prepareActorData(actor).system;
  // 10 + capped Dex 1 + item 2 + trained light (level 1 + 2) = 16.
  assert.equal(worn.attributes.ac.value, 16);
  assert.equal(worn.derived.armorClass.itemBonus, 2);
});

test("backpack rule removes the first 2 Bulk of stowed items", function () {
  const actor = actorWith({
    system: {
      details: { level: { value: 1 } },
      abilities: abilities(),
      proficiencies: {
        attacks: { simple: 0, martial: 0, advanced: 0, unarmed: 0 },
        defenses: { unarmored: 0, light: 0, medium: 0, heavy: 0 },
        spellcasting: { rank: 0 },
      },
      inventory: {
        items: [
          { id: "held", name: "Sword", type: "weapon", carried: "held", quantity: 1, bulk: 1 },
          { id: "back-1", name: "Rope", type: "equipment", carried: "stowed", quantity: 1, bulk: 1 },
          { id: "back-2", name: "Rations", type: "equipment", carried: "stowed", quantity: 1, bulk: 2 },
        ],
      },
      strikes: [],
    },
  });

  // Raw total 4; stowed 3; first 2 Bulk are ignored => 2.
  assert.equal(totalBulk(prepareActorData(actor).system), 2);
});

test("compendium dagger dropped into actor.items becomes a held Strike", function () {
  const catalog = new CatalogService({
    directory: path.join(__dirname, "..", "data", "compendiums"),
  });
  const daggerDoc = catalog.getItem("equipment", "rQWaJhI5Bko5x14Z");
  assert.ok(daggerDoc, "the reference dagger must exist in the equipment catalog");

  const dagger = createActorItemFromDocument(daggerDoc, {
    id: "dagger-1",
    carried: "held",
  });
  // system.bulk.value = 0.1 in Foundry => Light Bulk.
  assert.equal(dagger.bulk, "L");
  assert.equal(dagger.damage, "1d4");
  assert.equal(dagger.damageType, "piercing");
  assert.equal(dagger.carried, "held");
  assert.equal(dagger.handsHeld, 1);
  assert.ok(dagger.traits.includes("finesse"));

  const actor = actorWith({
    system: {
      details: { level: { value: 1 } },
      abilities: abilities({ str: { mod: 4 }, dex: { mod: 2 } }),
      proficiencies: {
        attacks: { simple: 1, martial: 0, advanced: 0, unarmed: 0 },
        defenses: { unarmored: 0, light: 0, medium: 0, heavy: 0 },
        spellcasting: { rank: 0 },
      },
      inventory: { items: [] },
      strikes: [],
    },
    items: [dagger],
  });

  const prepared = prepareActorData(actor);
  const strike = prepared.system.strikes.find((entry) => entry.itemId === "dagger-1");
  assert.ok(strike, "a held compendium weapon must generate a strike");
  // Finesse => Dex +2; simple proficiency trained at level 1 => +3.
  assert.equal(strike.attack, 5);
  assert.equal(strike.attackAbility, "dex");
  // Damage still uses Strength for a melee finesse weapon.
  assert.equal(strike.damage, "1d4+4");
  assert.equal(strike.handsHeld, 1);
  assert.equal(strike.agile, true);
  // Agile changes the multiple attack penalty to -4 / -8.
  assert.equal(strike.attackMap, 1);
  assert.equal(strike.attackMap2, -3);

  // Dropping it (stowed) removes the generated strike.
  actor.items[0].carried = "stowed";
  assert.equal(
    prepareActorData(actor).system.strikes.some((entry) => entry.itemId === "dagger-1"),
    false,
  );
});

test("striking/potency runes and two-handed usage feed the Strike math", function () {
  const weapon = normalizePhysicalItem(
    {
      id: "runic-warhammer",
      name: "Runic Warhammer",
      type: "weapon",
      system: {
        category: "martial",
        damage: { dice: 1, die: "d8", damageType: "bludgeoning" },
        traits: { value: ["two-hand-d10"] },
        usage: { value: "held-in-two-hands" },
        runes: { potency: 2, striking: 1, property: [] },
        bonus: { value: 0 },
        bonusDamage: { value: 1 },
        bulk: { value: 1 },
        equipped: { carryType: "held", handsHeld: 2, invested: false },
      },
    },
    0,
  );
  assert.equal(weapon.carried, "held");
  assert.equal(weapon.handsHeld, 2);
  assert.equal(weapon.bulk, 1);

  const actor = actorWith({
    system: {
      details: { level: { value: 5 } },
      abilities: abilities({ str: { mod: 4 }, dex: { mod: 1 } }),
      proficiencies: {
        attacks: { simple: 0, martial: 3, advanced: 0, unarmed: 0 },
        defenses: { unarmored: 0, light: 0, medium: 0, heavy: 0 },
        spellcasting: { rank: 0 },
      },
      inventory: { items: [] },
      strikes: [],
    },
    items: [weapon],
  });

  const strike = prepareActorData(actor).system.strikes.find(
    (entry) => entry.itemId === "runic-warhammer",
  );
  assert.ok(strike);
  // Str +4 + master martial (level 5 + 6) + potency 2 = 17.
  assert.equal(strike.attack, 17);
  assert.equal(strike.itemBonus, 2);
  // Striking rune: 1d8 becomes 2d8, then +Str 4 and +1 item damage.
  assert.equal(strike.damage, "2d8+5");
  assert.equal(strike.striking, 1);
  assert.equal(strike.handsHeld, 2);
});

test("Bulk counts ten Light items as one Bulk and applies the backpack rule", function () {
  const lightItems = Array.from({ length: 10 }, function (_, index) {
    return {
      id: "light-" + index,
      name: "Chalk " + index,
      type: "equipment",
      carried: "held",
      quantity: 1,
      bulk: "L",
    };
  });
  const actor = actorWith({
    items: [
      ...lightItems,
      {
        id: "backpack-rope",
        name: "Rope",
        type: "equipment",
        carried: "stowed",
        quantity: 1,
        bulk: 2,
      },
    ],
  });

  const prepared = prepareActorData(actor);
  // 10 Light = 1 Bulk; the stowed 2 Bulk is ignored by the backpack rule.
  assert.equal(totalBulk(prepared.system), 1);
  assert.equal(prepared.system.derived.inventory.bulk, 1);

  actor.items[0].carried = "stowed";
  // Raw 3 Bulk, stowed 2.1 Bulk => 3 - 2 = 1 (first 2 Bulk in the backpack free).
  assert.equal(totalBulk(prepareActorData(actor).system), 1);
});

test("encumbrance uses 5+Str as the limit and 10+Str as the maximum", function () {
  const actor = actorWith();
  actor.system.abilities = abilities({ str: { mod: 2 } });

  const addHeldBulk = function (bulk) {
    actor.items = [
      {
        id: "load-" + bulk,
        name: "Load",
        type: "equipment",
        carried: "held",
        quantity: 1,
        bulk,
      },
    ];
  };

  addHeldBulk(7);
  const normal = encumbranceState(prepareActorData(actor).system);
  assert.equal(normal.limit, 7);
  assert.equal(normal.max, 12);
  assert.equal(normal.state, "normal");

  addHeldBulk(8);
  const encumbered = encumbranceState(prepareActorData(actor).system);
  assert.equal(encumbered.state, "encumbered");

  addHeldBulk(13);
  const overloaded = encumbranceState(prepareActorData(actor).system);
  assert.equal(overloaded.state, "overloaded");
});

test("legacy system.inventory.items migrate into actor.items without duplicates", function () {
  const actor = actorWith();
  actor.system.inventory = {
    items: [
      {
        id: "legacy-sword",
        name: "Legacy Sword",
        type: "weapon",
        carried: "held",
        quantity: 1,
        bulk: 1,
        weaponCategory: "martial",
        damage: "1d8",
        damageType: "slashing",
      },
    ],
  };
  actor.system.proficiencies.attacks.martial = { rank: 1 };

  const prepared = prepareActorData(actor);
  assert.equal(prepared.items.filter((item) => item.id === "legacy-sword").length, 1);
  assert.ok(prepared.system.strikes.some((strike) => strike.itemId === "legacy-sword"));
  assert.equal(prepared.system.inventory.items.length, 1);

  // Re-running preparation must not duplicate the migrated row.
  const twice = prepareActorData({ ...actor, items: prepared.items });
  assert.equal(twice.items.filter((item) => item.id === "legacy-sword").length, 1);
  assert.equal(twice.system.inventory.items.length, 1);
});

test("max HP uses ancestry + (class + Constitution) * level", function () {
  const actor = actorWith();
  actor.system.details = {
    level: { value: 3 },
    ancestry: { id: "ancestry-elf", name: "Elf", hp: 6 },
    class: { id: "class-fighter", name: "Fighter", hp: 10 },
  };
  actor.system.abilities = abilities({ con: { mod: 2 } });

  const prepared = prepareActorData(actor).system;
  // 6 + (10 + 2) * 3 = 42
  assert.equal(prepared.attributes.hp.max, 42);
  assert.equal(prepared.derived.hp.conMod, 2);
  assert.equal(prepared.derived.hp.ancestryHp, 6);
  assert.equal(prepared.derived.hp.classHp, 10);
});

test("max HP also reads ancestry/class documents stored in actor.items", function () {
  const actor = actorWith();
  actor.system.details = { level: { value: 2 } };
  actor.system.abilities = abilities({ con: { mod: 1 } });
  actor.items = [
    { id: "ancestry-dwarf", name: "Dwarf", type: "ancestry", system: { hp: 10 } },
    { id: "class-cleric", name: "Cleric", type: "class", system: { hp: 8 } },
  ];

  assert.equal(prepareActorData(actor).system.attributes.hp.max, 10 + (8 + 1) * 2);
});

test("custom AC modifiers follow circumstance/status stacking", function () {
  const actor = actorWith();
  actor.system.abilities = abilities({ dex: { mod: 3 } });
  actor.system.attributes = {
    ac: {
      modifiers: [
        { id: "cover", name: "Cover", value: 2, type: "circumstance" },
        { id: "shield", name: "Shield", value: 1, type: "circumstance" },
        { id: "frightened", name: "Frightened", value: -1, type: "status" },
        { id: "status", name: "Bless", value: 2, type: "status" },
      ],
    },
  };

  const prepared = prepareActorData(actor).system;
  // 10 + Dex 3 + circumstance max(2, 1) + status max(2) - worst(1) = 16.
  assert.equal(prepared.attributes.ac.value, 16);
  assert.equal(prepared.derived.armorClass.circumstance, 2);
  assert.equal(prepared.derived.armorClass.status, 1);
  assert.equal(prepared.derived.armorClass.customBonus, 3);
  assert.equal(prepared.derived.armorClass.modifiers.length, 4);
});

test("class selection adds level-1 features and base proficiencies", function () {
  const classDoc = makeClassDocument();
  const next = applyClassToActor(actorWith(), classDoc, { level: 2 });

  const names = next.items.map((item) => item.name);
  assert.deepEqual(names.sort(), ["Sneak Attack", "Surprise Attack"]);
  assert.equal(next.system.proficiencies.attacks.martial.rank, 1);
  assert.equal(next.system.proficiencies.defenses.light.rank, 1);
  assert.equal(next.system.perception.rank, 2);
  assert.equal(next.system.saves.reflex.rank, 2);
  assert.equal(next.system.details.keyability.value, "dex");
  assert.equal(next.system.details.class.id, "class-rogue");
  assert.equal(next.system.feats.class.length, 2);

  // Class feat slots at 1/2 exist; no general slot before level 3.
  assert.deepEqual(
    next.system.featSlots.map((slot) => slot.type + ":" + slot.level),
    ["class:1", "class:2"],
  );
});

test("level-up adds new features/slots and never duplicates items", function () {
  const classDoc = makeClassDocument();
  const level2 = applyClassToActor(actorWith(), classDoc, { level: 2 });
  const level7 = applyClassToActor(level2, classDoc, { level: 7 });
  const twice = applyClassToActor(level7, classDoc, { level: 7 });

  const names = twice.items.map((item) => item.name).sort();
  assert.deepEqual(names, ["Deny Advantage", "Sneak Attack", "Surprise Attack"]);
  assert.equal(twice.system.feats.class.length, 3);
  assert.deepEqual(
    twice.system.featSlots.map((slot) => slot.type + ":" + slot.level),
    ["class:1", "class:2", "general:3", "class:4", "class:6", "general:7"],
  );
});

test("server persists actor.items alongside actor.system", function () {
  const session = new EncounterSession({ id: "actor-items" });
  const actor = session.createDirectoryEntry("actors", {
    name: "Spellbinder",
    items: [
      {
        id: "sc-1",
        name: "Divine Spontaneous",
        type: "spellcastingEntry",
        system: { ability: "cha", tradition: "divine" },
      },
    ],
  });
  assert.equal(actor.items.length, 1);

  session.updateActor(
    actor.id,
    {
      items: [
        {
          id: "feat-sneak",
          name: "Sneak Attack",
          type: "feat",
          level: 1,
        },
      ],
    },
    "gm-1",
    "gm",
  );

  const stored = session.getDirectories().actors.entries.find(function (entry) {
    return entry.id === actor.id;
  });
  assert.equal(stored.items[0].name, "Sneak Attack");
  assert.equal(stored.items[0].type, "feat");
});

test("skill modifiers recompute when the proficiency rank changes", function () {
  const actor = actorWith();
  actor.system.abilities = abilities({ str: { mod: 4 } });
  actor.system.skills = { athletics: { rank: 0 } };

  const untrained = prepareActorData(actor).system;
  // Str +4, untrained: no level and no proficiency bonus.
  assert.equal(untrained.skills.athletics.rank, 0);
  assert.equal(untrained.skills.athletics.mod, 4);
  assert.equal(untrained.skills.athletics.armorPenalty, 0);

  actor.system.skills = { athletics: { rank: 1 } };
  const trained = prepareActorData(actor).system;
  // Str +4 + trained at level 1 (1 + 2) = 7.
  assert.equal(trained.skills.athletics.rank, 1);
  assert.equal(trained.skills.athletics.mod, 7);

  actor.system.skills = { athletics: { rank: 1, itemBonus: 2 } };
  const itemBonus = prepareActorData(actor).system;
  // Item bonus is a separate bonus type: 7 + 2 = 9.
  assert.equal(itemBonus.skills.athletics.mod, 9);
  assert.equal(itemBonus.skills.athletics.itemBonus, 2);
});

test("worn armor check penalty hits Strength and Dexterity skills", function () {
  const actor = actorWith({
    system: {
      details: { level: { value: 1 } },
      abilities: abilities({ str: { mod: 2 }, dex: { mod: 4 }, int: { mod: 1 } }),
      proficiencies: {
        attacks: { simple: 0, martial: 0, advanced: 0, unarmed: 0 },
        defenses: { unarmored: 0, light: 0, medium: 1, heavy: 0 },
        spellcasting: { rank: 0 },
      },
      skills: {
        athletics: { rank: 1 },
        stealth: { rank: 1 },
        thievery: { rank: 1 },
        arcana: { rank: 1 },
      },
      inventory: {
        items: [
          {
            id: "armor-chain",
            name: "Chain Mail",
            type: "armor",
            carried: "worn",
            category: "medium",
            acBonus: 4,
            dexCap: 1,
            strength: 4,
            checkPenalty: -2,
            traits: "noisy",
          },
        ],
      },
      strikes: [],
    },
  });

  const penalized = prepareActorData(actor).system;
  // Str +2 + trained 3 - 2 = 3; Dex +4 + trained 3 - 2 = 5.
  assert.equal(penalized.skills.athletics.mod, 3);
  assert.equal(penalized.skills.stealth.mod, 5);
  assert.equal(penalized.skills.thievery.mod, 5);
  assert.equal(penalized.skills.athletics.armorPenalty, -2);
  assert.equal(penalized.skills.stealth.armorPenalty, -2);
  // Intelligence skills are never affected by the armor check penalty.
  assert.equal(penalized.skills.arcana.mod, 4);
  assert.equal(penalized.skills.arcana.armorPenalty, 0);
  assert.equal(penalized.derived.armorCheckPenalty.armorId, "armor-chain");
  assert.equal(penalized.derived.armorCheckPenalty.strengthMet, false);

  // Meeting the Strength requirement removes the penalty from most skills.
  actor.system.abilities = abilities({ str: { mod: 4 }, dex: { mod: 4 }, int: { mod: 1 } });
  const met = prepareActorData(actor).system;
  assert.equal(met.skills.athletics.mod, 7);
  assert.equal(met.skills.thievery.mod, 7);
  // Noisy armor keeps its penalty on Stealth even when the requirement is met.
  assert.equal(met.skills.stealth.mod, 5);
  assert.equal(met.skills.stealth.armorPenalty, -2);
  assert.equal(met.derived.armorCheckPenalty.strengthMet, true);
  assert.equal(met.derived.armorCheckPenalty.noisy, true);

  // Legacy payloads may store the requirement as an ability score (Str 16).
  actor.system.inventory.items[0].strength = 16;
  actor.system.abilities = abilities({ str: { mod: 3 }, dex: { mod: 4 }, int: { mod: 1 } });
  const scoreForm = prepareActorData(actor).system;
  assert.equal(scoreForm.derived.armorCheckPenalty.requirement, 3);
  assert.equal(scoreForm.derived.armorCheckPenalty.strengthMet, true);
  assert.equal(scoreForm.skills.athletics.mod, 6);

  // Stowed armor is not worn and therefore never penalizes skills.
  actor.system.inventory.items[0].carried = "stowed";
  const stowed = prepareActorData(actor).system;
  assert.equal(stowed.skills.stealth.mod, 7);
  assert.equal(stowed.derived.armorCheckPenalty.applies, false);
});

test("spell documents bind to their spellcasting entry by id", function () {
  const entry = {
    id: "sc-arcane",
    name: "Arcane Prepared",
    type: "spellcastingEntry",
    system: { ability: "int", tradition: "arcane", proficiency: { value: 1 } },
  };
  const spellDocument = {
    id: "spell-fireball",
    name: "Fireball",
    type: "spell",
    img: "fireball.webp",
    system: {
      level: { value: 3 },
      description: { value: "<p>A roaring blast of flame.</p>" },
      traits: { value: ["fire"] },
    },
  };
  const spell = createActorSpellFromDocument(spellDocument, {
    entryId: "sc-arcane",
  });
  assert.equal(spell.type, "spell");
  assert.equal(spell.system.location.value, "sc-arcane");
  assert.equal(spell.system.level.value, 3);
  assert.equal(spell.entryId, "sc-arcane");
  assert.equal(spell.description, "<p>A roaring blast of flame.</p>");

  const actor = actorWith({
    system: {
      details: { level: { value: 5 } },
      abilities: abilities({ int: { mod: 4 } }),
      proficiencies: {
        attacks: { simple: 0, martial: 0, advanced: 0, unarmed: 0 },
        defenses: { unarmored: 0, light: 0, medium: 0, heavy: 0 },
        spellcasting: { rank: 1 },
      },
      inventory: { items: [] },
      strikes: [],
    },
    items: [entry, spell],
  });

  const prepared = prepareActorData(actor);
  const preparedSpell = prepared.items.find((item) => item.type === "spell");
  assert.equal(preparedSpell.entryId, "sc-arcane");
  assert.equal(preparedSpell.rank, 3);
  // Level 5 + rank 1 * 2 + Int +4 = 11; DC = 21.
  assert.equal(preparedSpell.spellAttack, 11);
  assert.equal(preparedSpell.spellDC, 21);

  const grouped = prepared.system.derived.spellsByEntry["sc-arcane"];
  assert.ok(Array.isArray(grouped));
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].name, "Fireball");
  assert.equal(grouped[0].rank, 3);
  assert.equal(grouped[0].spellDC, 21);
  const spellcastingEntry = prepared.system.derived.spellcasting.find(
    (item) => item.id === "sc-arcane",
  );
  assert.equal(spellcastingEntry.spells.length, 1);
  assert.equal(spellcastingEntry.spells[0].name, "Fireball");

  // A spell whose location points at an unknown entry stays bound verbatim.
  const orphan = createActorSpellFromDocument(spellDocument, {
    entryId: "sc-missing",
  });
  assert.equal(orphan.system.location.value, "sc-missing");
});

test("feat items are grouped into the sheet's feat sections", function () {
  const makeFeat = function (id, name, category) {
    return {
      id,
      name,
      type: "feat",
      img: null,
      system: {
        category,
        level: { value: 1 },
        description: { value: name + " description" },
        traits: { value: ["general"] },
      },
    };
  };
  const actor = actorWith({
    items: [
      makeFeat("feat-ancestry", "Nimble Elf", "ancestry"),
      makeFeat("feat-class", "Power Attack", "class"),
      makeFeat("feat-general", "Toughness", "general"),
      makeFeat("feat-skill", "Acrobatic Performer", "skill"),
      makeFeat("feat-bonus", "Adopted Ancestry", "bonus"),
      makeFeat("feat-feature", "Sneak Attack", "classfeature"),
      {
        id: "feat-legacy",
        name: "Legacy Class Feature",
        type: "feat",
        traits: "class",
        system: { level: { value: 1 } },
      },
    ],
  });

  const prepared = prepareActorData(actor);
  const feats = prepared.system.feats;
  assert.deepEqual(feats.ancestry.map((feat) => feat.id), ["feat-ancestry"]);
  assert.deepEqual(feats.class.map((feat) => feat.id).sort(), [
    "feat-class",
    "feat-feature",
    "feat-legacy",
  ]);
  assert.deepEqual(feats.general.map((feat) => feat.id), ["feat-general"]);
  assert.deepEqual(feats.skill.map((feat) => feat.id), ["feat-skill"]);
  assert.deepEqual(feats.bonus.map((feat) => feat.id), ["feat-bonus"]);
  assert.equal(feats.general[0].description, "Toughness description");
  assert.equal(feats.general[0].traits, "general");

  const droppedDoc = {
    id: "feat-drop",
    name: "Dropped Feat",
    type: "feat",
    system: {
      category: "general",
      level: { value: 3 },
      description: { value: "Dropped description" },
      traits: { value: ["general", "skill"] },
    },
  };
  const dropped = createActorFeatFromDocument(droppedDoc, {
    slotId: "feat-slot-general-3",
  });
  assert.equal(dropped.type, "feat");
  assert.equal(dropped.category, "general");
  assert.equal(dropped.slotId, "feat-slot-general-3");
  assert.equal(dropped.system.location, "feat-slot-general-3");
  assert.equal(dropped.level, 3);

  actor.items = [dropped];
  const withDropped = prepareActorData(actor).system.feats;
  assert.equal(withDropped.general.length, 1);
  assert.equal(withDropped.general[0].slotId, "feat-slot-general-3");
});

test("heritage compendium filters by ancestry and always includes versatile heritages", function () {
  const catalog = new CatalogService({
    directory: path.join(__dirname, "..", "data", "compendiums"),
  });
  const merfolk = catalog.getIndex("heritages", {
    ancestry: "Merfolk",
    includeVersatile: true,
  });

  assert.ok(merfolk.length > 0);
  assert.ok(merfolk.some((entry) => entry.ancestryName === "Merfolk"));
  assert.ok(merfolk.some((entry) => entry.versatile === true));
  assert.ok(
    merfolk.every(
      (entry) =>
        entry.versatile === true ||
        entry.ancestry === "merfolk" ||
        entry.ancestryName === "Merfolk",
    ),
  );

  const versatile = catalog.getIndex("heritages", { versatile: true });
  assert.ok(versatile.some((entry) => entry.name === "Nephilim"));
  assert.ok(versatile.every((entry) => entry.versatile === true));
});

async function main() {
  let failures = 0;
  for (const entry of tests) {
    try {
      await entry.handler();
      console.log("  ok   " + entry.name);
    } catch (error) {
      failures += 1;
      console.error("  FAIL " + entry.name);
      console.error(error && error.stack ? error.stack : String(error));
    }
  }

  console.log("");
  console.log(String(tests.length - failures) + " passed, " + String(failures) + " failed");
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main();
