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

test("a raised held shield adds its circumstance bonus to AC", function () {
  function shieldActor(raised, carried) {
    return actorWith({
      system: {
        details: { level: { value: 1 } },
        abilities: abilities({ dex: { mod: 2 } }),
        proficiencies: {
          attacks: { simple: 0, martial: 0, advanced: 0, unarmed: 0 },
          defenses: { unarmored: 1, light: 0, medium: 0, heavy: 0 },
          spellcasting: { rank: 0 },
        },
        inventory: { items: [] },
        strikes: [],
      },
      items: [
        {
          id: "shield-steel",
          name: "Steel Shield",
          type: "shield",
          carried: carried,
          raised: raised,
          acBonus: 2,
          system: { acBonus: 2, hardness: 5, hp: { value: 20, max: 20 } },
        },
      ],
    });
  }

  const lowered = prepareActorData(shieldActor(false, "held")).system;
  assert.equal(lowered.attributes.ac.value, 15);
  assert.equal(lowered.attributes.shield.raised, false);
  assert.equal(lowered.attributes.shield.hp.max, 20);
  assert.equal(lowered.attributes.shield.hardness, 5);

  const raised = prepareActorData(shieldActor(true, "held")).system;
  assert.equal(raised.attributes.ac.value, 17);
  assert.equal(raised.derived.armorClass.shieldBonus, 2);
  assert.equal(raised.attributes.shield.raised, true);

  // A stowed shield cannot be raised and never contributes to AC.
  const stowed = prepareActorData(shieldActor(true, "stowed")).system;
  assert.equal(stowed.attributes.ac.value, 15);
  assert.equal(stowed.derived.armorClass.shieldBonus, 0);
});

test("stowed armor contributes no AC bonus or Dex cap", function () {  const actor = actorWith({
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
  // Step 5.7: automatically granted features live in their own section.
  assert.equal(next.system.feats.classfeature.length, 2);

  // Ancestry/class/skill slots up to level 2 exist; no general slot before 3.
  assert.deepEqual(
    next.system.featSlots.map((slot) => slot.type + ":" + slot.level),
    ["ancestry:1", "class:1", "class:2", "skill:2"],
  );
});

test("class base proficiencies are non-droppable attack and defense floors", function () {
  const classDoc = makeClassDocument();
  const level8 = applyClassToActor(actorWith(), classDoc, { level: 8 });

  // A rogue's class document grants simple/martial/unarmed and light armor.
  assert.equal(level8.system.proficiencies.attacks.martial.rank, 1);
  assert.equal(level8.system.proficiencies.attacks.martial.minRank, 1);
  assert.equal(level8.system.proficiencies.attacks.simple.minRank, 1);
  assert.equal(level8.system.proficiencies.defenses.light.minRank, 1);
  assert.equal(level8.system.proficiencies.defenses.unarmored.minRank, 1);
  // A rank the class does not grant is still freely editable.
  assert.equal(level8.system.proficiencies.attacks.advanced.minRank, 0);

  // Simulate a client trying to un-train the guaranteed proficiencies. The
  // next preparation must clamp them back to the class floor.
  level8.system.proficiencies.attacks.martial = { rank: 0 };
  level8.system.proficiencies.attacks.simple = { rank: 0 };
  level8.system.proficiencies.defenses.light = { rank: 0 };
  const prepared = prepareActorData(level8).system;
  assert.equal(prepared.proficiencies.attacks.martial.rank, 1);
  assert.equal(prepared.proficiencies.attacks.martial.minRank, 1);
  assert.equal(prepared.proficiencies.attacks.simple.rank, 1);
  assert.equal(prepared.proficiencies.attacks.simple.minRank, 1);
  assert.equal(prepared.proficiencies.defenses.light.rank, 1);
  assert.equal(prepared.proficiencies.defenses.light.minRank, 1);
});

test("level-up adds new features/slots and never duplicates items", function () {  const classDoc = makeClassDocument();
  const level2 = applyClassToActor(actorWith(), classDoc, { level: 2 });
  const level7 = applyClassToActor(level2, classDoc, { level: 7 });
  const twice = applyClassToActor(level7, classDoc, { level: 7 });

  const names = twice.items.map((item) => item.name).sort();
  assert.deepEqual(names, ["Deny Advantage", "Sneak Attack", "Surprise Attack"]);
  assert.equal(twice.system.feats.classfeature.length, 3);
  assert.deepEqual(
    twice.system.featSlots.map((slot) => slot.type + ":" + slot.level),
    [
      "ancestry:1",
      "class:1",
      "class:2",
      "skill:2",
      "general:3",
      "class:4",
      "skill:4",
      "ancestry:5",
      "class:6",
      "skill:6",
      "general:7",
    ],
  );
});

test("level-down removes closed feat slots and detaches their feats", function () {
  const classDoc = makeClassDocument();
  const level3 = applyClassToActor(actorWith(), classDoc, { level: 3 });
  assert.deepEqual(
    level3.system.featSlots.map((slot) => slot.type + ":" + slot.level),
    ["ancestry:1", "class:1", "class:2", "skill:2", "general:3"],
  );
  assert.ok(level3.items.some((item) => item.name === "Deny Advantage"));

  // Bind a general feat to the level-3 general slot.
  const generalSlot = level3.system.featSlots.find(
    (slot) => slot.id === "feat-slot-general-3",
  );
  assert.ok(generalSlot);
  const bound = {
    ...level3,
    items: [
      ...level3.items,
      {
        id: "feat-toughness",
        name: "Toughness",
        type: "feat",
        level: 3,
        slotId: "feat-slot-general-3",
        system: {
          category: "general",
          level: { value: 3 },
          location: "feat-slot-general-3",
        },
      },
    ],
    system: {
      ...level3.system,
      featSlots: level3.system.featSlots.map((slot) =>
        slot.id === "feat-slot-general-3"
          ? { ...slot, featId: "feat-toughness" }
          : slot,
      ),
    },
  };

  const level2 = applyClassToActor(bound, classDoc, { level: 2 });
  assert.equal(
    level2.system.featSlots.some((slot) => slot.type === "general"),
    false,
    "the level-3 general slot must disappear",
  );
  assert.equal(
    level2.items.some((item) => item.id === "feat-toughness"),
    false,
    "a feat bound to a closed slot must be detached",
  );
  assert.equal(
    level2.items.some((item) => item.name === "Deny Advantage"),
    false,
    "class features above the new level must be removed",
  );

  // Levelling back up restores the slot as empty, never the old feat.
  const again = applyClassToActor(level2, classDoc, { level: 3 });
  const reopened = again.system.featSlots.find(
    (slot) => slot.id === "feat-slot-general-3",
  );
  assert.ok(reopened);
  assert.equal(reopened.featId, null);
  assert.equal(again.items.some((item) => item.name === "Deny Advantage"), true);
});

test("ancestry selection drives size and traits", function () {
  const actor = actorWith();
  actor.system.details = {
    level: { value: 1 },
    ancestry: {
      name: "Gnome",
      size: "sm",
      traits: ["gnome", "humanoid"],
    },
    heritage: { name: "Wellspring Gnome", traits: ["gnome"] },
  };
  const gnome = prepareActorData(actor).system;
  assert.equal(gnome.traits.size.value, "sm");
  assert.ok(gnome.traits.value.includes("gnome"));
  assert.ok(gnome.traits.value.includes("humanoid"));

  // Switching ancestry replaces inherited tags and restores Medium.
  actor.system.details.ancestry = {
    name: "Human",
    size: "med",
    traits: ["human", "humanoid"],
  };
  actor.system.details.heritage = { name: "Versatile Heritage", traits: [] };
  const human = prepareActorData(actor).system;
  assert.equal(human.traits.size.value, "med");
  assert.ok(human.traits.value.includes("human"));
  assert.equal(human.traits.value.includes("gnome"), false);
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
    "feat-legacy",
  ]);
  assert.deepEqual(feats.classfeature.map((feat) => feat.id), ["feat-feature"]);
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

test("a feat forced into the bonus section stays there after preparation", function () {
  const keepUp = {
    id: "feat-keep-up",
    name: "Keep Up",
    type: "feat",
    system: {
      category: "class",
      level: { value: 7 },
      description: { value: "Keep Up description" },
      traits: { value: ["archetype"] },
    },
  };
  // The sheet's bonus-section drop handler passes category: "bonus"; this is
  // the same contract `createActorFeatFromDocument` receives.
  const forced = createActorFeatFromDocument(keepUp, { category: "bonus" });
  assert.equal(forced.system.category, "bonus");

  const actor = actorWith({ items: [forced] });
  const feats = prepareActorData(actor).system.feats;
  assert.deepEqual(feats.bonus.map((feat) => feat.id), ["feat-keep-up"]);
  assert.equal(feats.class.length, 0);
});

test("class selection only adds class-feature documents, never ordinary class feats", function () {
  const classDoc = makeClassDocument();
  classDoc.items = [
    {
      id: "cf-sneak",
      name: "Sneak Attack",
      type: "feat",
      system: { category: "classfeature", level: { value: 1 } },
    },
    {
      id: "cf-trick",
      name: "Basic Trick",
      type: "feat",
      system: { category: "classfeature", level: { value: 2 } },
    },
    {
      id: "feat-twin-feint",
      name: "Twin Feint",
      type: "feat",
      system: { category: "class", level: { value: 1 } },
    },
  ];

  const next = applyClassToActor(actorWith(), classDoc, { level: 2 });
  const names = next.items.map((item) => item.name).sort();
  assert.deepEqual(names, ["Basic Trick", "Sneak Attack", "Surprise Attack"]);
  assert.equal(next.items.some((item) => item.name === "Twin Feint"), false);
  assert.equal(
    next.items.find((item) => item.name === "Sneak Attack").system.category,
    "classfeature",
  );
});

test("background and class fixed training become a non-droppable skill floor", function () {
  const actor = actorWith();
  actor.system.details = {
    level: { value: 1 },
    background: {
      name: "Acolyte",
      trainedSkills: { value: ["religion"], lore: ["Scribing Lore"] },
    },
    class: {
      name: "Rogue",
      trainedSkills: { value: ["stealth"], additional: 7 },
    },
  };
  actor.system.skills = {
    religion: { rank: 0 },
    stealth: { rank: 0 },
    athletics: { rank: 1 },
  };

  const prepared = prepareActorData(actor).system;
  assert.equal(prepared.skills.religion.rank, 1);
  assert.equal(prepared.skills.religion.minRank, 1);
  assert.equal(prepared.skills.stealth.rank, 1);
  assert.equal(prepared.skills.stealth.minRank, 1);
  // A manually trained skill stays trained but has no artificial floor.
  assert.equal(prepared.skills.athletics.rank, 1);
  assert.equal(prepared.skills.athletics.minRank, 0);

  // Preparation itself clamps an attempted downgrade back to the floor.
  actor.system.skills.religion.rank = 0;
  assert.equal(prepareActorData(actor).system.skills.religion.rank, 1);
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

  // Step 5.6 ordering: ancestry-bound heritages first (A→Z), then versatile.
  const firstVersatile = merfolk.findIndex((entry) => entry.versatile === true);
  const lastBound = merfolk.reduce(
    (last, entry, index) => (entry.versatile === true ? last : index),
    -1,
  );
  assert.ok(firstVersatile > -1 && lastBound < firstVersatile);
  const boundNames = merfolk
    .filter((entry) => entry.versatile !== true)
    .map((entry) => entry.name);
  assert.deepEqual(
    boundNames,
    boundNames.slice().sort((a, b) =>
      String(a).localeCompare(String(b), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    ),
  );
  const versatileNames = merfolk
    .filter((entry) => entry.versatile === true)
    .map((entry) => entry.name);
  assert.deepEqual(
    versatileNames,
    versatileNames.slice().sort((a, b) =>
      String(a).localeCompare(String(b), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    ),
  );

  const versatile = catalog.getIndex("heritages", { versatile: true });
  assert.ok(versatile.some((entry) => entry.name === "Nephilim"));
  assert.ok(versatile.every((entry) => entry.versatile === true));
});

test("toggleable RollOption enables its predicate-gated FlatModifier", function () {
  const actor = actorWith({
    system: {
      details: { level: { value: 1 } },
      abilities: abilities({ dex: { mod: 2 } }),
      proficiencies: {
        attacks: { simple: 0, martial: 0, advanced: 0, unarmed: 0 },
        defenses: { unarmored: 0, light: 0, medium: 0, heavy: 0 },
        spellcasting: { rank: 0 },
      },
      inventory: { items: [] },
      strikes: [],
    },
    items: [
      {
        id: "feat-nimble-dodge",
        name: "Nimble Dodge",
        type: "feat",
        level: 1,
        system: {
          category: "class",
          level: { value: 1 },
          rules: [
            {
              key: "RollOption",
              option: "nimble-dodge",
              toggleable: true,
              label: "Nimble Dodge",
            },
            {
              key: "FlatModifier",
              predicate: ["nimble-dodge"],
              selector: "ac",
              type: "circumstance",
              value: 2,
            },
          ],
        },
      },
    ],
  });

  const disabled = prepareActorData(actor).system;
  // 10 + Dex 2; the predicate is false until the toggle is enabled.
  assert.equal(disabled.attributes.ac.value, 12);
  assert.equal(disabled.toggles.length, 1);
  assert.equal(disabled.toggles[0].option, "nimble-dodge");
  assert.equal(disabled.toggles[0].enabled, false);

  actor.system.flags = {
    pf2e: { rollOptions: { all: { "nimble-dodge": true } } },
  };
  const enabled = prepareActorData(actor).system;
  assert.equal(enabled.toggles[0].enabled, true);
  // The FlatModifier is now active: +2 circumstance AC.
  assert.equal(enabled.attributes.ac.value, 14);
  assert.equal(enabled.derived.armorClass.ruleModifiers.length, 1);
});

test("enabled attack FlatModifier changes Strike attack numbers", function () {
  const actor = actorWith({
    system: {
      details: { level: { value: 1 } },
      abilities: abilities({ str: { mod: 4 } }),
      proficiencies: {
        attacks: { simple: 0, martial: 0, advanced: 0, unarmed: 0 },
        defenses: { unarmored: 0, light: 0, medium: 0, heavy: 0 },
        spellcasting: { rank: 0 },
      },
      inventory: { items: [] },
      strikes: [],
      flags: { pf2e: { rollOptions: { "sure-strike": true } } },
    },
    items: [
      {
        id: "feat-sure-strike",
        name: "Sure Strike",
        type: "feat",
        system: {
          rules: [
            { key: "RollOption", option: "sure-strike", toggleable: true },
            {
              key: "FlatModifier",
              predicate: ["sure-strike"],
              selector: "attack",
              type: "status",
              value: 1,
            },
          ],
        },
      },
    ],
  });

  const prepared = prepareActorData(actor).system;
  const fist = prepared.strikes.find((strike) => strike.unarmed);
  // Str +4, unarmed untrained => +4 base; +1 status from the active toggle.
  assert.equal(fist.baseAttack, 4);
  assert.equal(fist.attack, 5);
  assert.equal(fist.attackMap, 1);
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
