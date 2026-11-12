"use strict";

/**
 * Step 6.6: equipment filter contract for the compendium catalog.
 *
 * Run with: npm run test --workspace=@pf2e/server
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CatalogService,
  collectCatalogTraits,
  parsePriceToCp,
  readEntryCategory,
  readEntryPriceCp,
  readEntryRarity,
} = require("../src/compendium/catalog-service.js");

function withSystem(fields) {
  return {
    system: {
      traits: { rarity: fields.rarity },
      category: fields.category,
      price: fields.price,
    },
  };
}

const EQUIPMENT = [
  {
    id: "common-light",
    name: "Padded Armor",
    type: "armor",
    level: 1,
    ...withSystem({
      rarity: "common",
      category: "light",
      price: { value: { gp: 5 } },
    }),
  },
  {
    id: "rare-light",
    name: "Rare Leather",
    type: "armor",
    level: 3,
    ...withSystem({
      rarity: "rare",
      category: "light",
      price: { value: { gp: 10, sp: 5 } },
    }),
  },
  {
    id: "rare-heavy",
    name: "Rare Plate",
    type: "armor",
    level: 5,
    ...withSystem({
      rarity: "rare",
      category: "heavy",
      price: { value: { gp: 100 } },
    }),
  },
  {
    id: "rare-sword",
    name: "Rare Sword",
    type: "weapon",
    level: 2,
    ...withSystem({
      rarity: "rare",
      category: "martial",
      price: { value: { gp: 4 } },
    }),
  },
  {
    id: "rare-potion",
    name: "Rare Potion",
    type: "consumable",
    level: 1,
    ...withSystem({
      rarity: "rare",
      price: { value: { cp: 50 } },
    }),
  },
];

function ids(entries) {
  return entries.map(function (entry) {
    return entry.id;
  });
}

test("price strings convert to copper pieces", function () {
  assert.equal(parsePriceToCp("5 зм"), 500);
  assert.equal(parsePriceToCp("10 см"), 100);
  assert.equal(parsePriceToCp("4 gp"), 400);
  assert.equal(parsePriceToCp("0 мм"), 0);
  assert.equal(parsePriceToCp("1 зм 5 см"), 150);
  assert.equal(parsePriceToCp("2.5 зм"), 250);
  assert.equal(parsePriceToCp("1,5 см"), 15);
  assert.equal(parsePriceToCp("2"), 200);
  assert.equal(parsePriceToCp(""), null);
  assert.equal(parsePriceToCp("abc"), null);
  assert.equal(parsePriceToCp("-5 зм"), null);
  assert.equal(parsePriceToCp(undefined), null);
});

test("index and full Foundry shapes expose rarity/category/price", function () {
  const compact = {
    id: "compact",
    rarity: "Rare",
    category: "Medium",
    price: { value: { gp: 3 } },
  };
  assert.equal(readEntryRarity(compact), "rare");
  assert.equal(readEntryCategory(compact), "medium");
  assert.equal(readEntryPriceCp(compact), 300);

  const full = {
    id: "full",
    system: {
      traits: { rarity: "unique" },
      category: "heavy",
      price: { value: { gp: 2, sp: 5, cp: 1 } },
    },
  };
  assert.equal(readEntryRarity(full), "unique");
  assert.equal(readEntryCategory(full), "heavy");
  assert.equal(readEntryPriceCp(full), 251);
  assert.equal(readEntryPriceCp({ price: { value: { gp: null } } }), null);
  assert.equal(readEntryPriceCp({ price: { value: {} } }), null);
});

test("rarity AND item type filters leave only rare armor", function () {
  const result = CatalogService.filterIndex(EQUIPMENT, {
    rarity: ["rare"],
    itemTypes: ["armor"],
  });
  assert.deepEqual(ids(result), [
    "rare-light",
    "rare-heavy",
  ]);
});

test("armor and weapon category filters target their own document type", function () {
  const lightArmor = CatalogService.filterIndex(EQUIPMENT, {
    rarity: ["rare"],
    itemTypes: ["armor"],
    armorCategories: ["light"],
  });
  assert.deepEqual(ids(lightArmor), ["rare-light"]);

  const martialWeapons = CatalogService.filterIndex(EQUIPMENT, {
    weaponCategories: ["martial"],
  });
  assert.deepEqual(ids(martialWeapons), ["rare-sword"]);

  // A weapon-only category must never match armor, and vice versa.
  const mismatch = CatalogService.filterIndex(EQUIPMENT, {
    armorCategories: ["light"],
    weaponCategories: ["simple"],
  });
  assert.deepEqual(ids(mismatch), []);
});

test("price range filters use copper-piece comparisons", function () {
  const result = CatalogService.filterIndex(EQUIPMENT, {
    rarity: ["rare"],
    priceMin: "0 мм",
    priceMax: "10 зм",
  });
  // Rare Leather costs 10 gp 5 sp = 1050 cp and is above the cap.
  assert.deepEqual(ids(result), ["rare-potion", "rare-sword"]);
});

test("filters run before limit/offset pagination", function () {
  const page = CatalogService.filterIndex(EQUIPMENT, {
    rarity: ["rare"],
    itemTypes: ["armor"],
    offset: 1,
    limit: 1,
  });
  assert.deepEqual(ids(page), ["rare-heavy"]);
});

test("comma-separated query values share OR semantics inside a group", function () {
  const result = CatalogService.filterIndex(EQUIPMENT, {
    itemTypes: "armor,weapon",
    rarity: "rare,unique",
  });
  assert.deepEqual(ids(result), [
    "rare-sword",
    "rare-light",
    "rare-heavy",
  ]);
});

// ---------------------------------------------------------------------------
// Step 6.7: advanced spell/bestiary/feat filters and include/exclude traits
// ---------------------------------------------------------------------------

const ADVANCED = [
  {
    id: "fireball",
    name: "Fireball",
    type: "spell",
    level: 3,
    traits: ["fire", "manipulate"],
    rarity: "common",
    spellCategory: "spell",
    traditions: ["arcane", "primal"],
  },
  {
    id: "occult-focus",
    name: "Occult Focus",
    type: "spell",
    level: 1,
    traits: ["focus", "mental"],
    rarity: "uncommon",
    spellCategory: "focus",
    traditions: ["occult"],
  },
  {
    id: "teleport",
    name: "Teleport",
    type: "spell",
    level: 6,
    traits: ["teleportation"],
    rarity: "rare",
    spellCategory: "spell",
    traditions: ["arcane", "occult"],
  },
  {
    id: "android",
    name: "Android",
    type: "npc",
    level: 1,
    traits: ["android", "humanoid"],
    rarity: "rare",
    size: "med",
  },
  {
    id: "dragon",
    name: "Dragon",
    type: "npc",
    level: 12,
    traits: ["dragon", "huge"],
    rarity: "uncommon",
    size: "huge",
  },
  {
    id: "acrobat",
    name: "Acrobat",
    type: "feat",
    level: 2,
    traits: ["general", "skill"],
    rarity: "common",
    featCategory: "skill",
    skills: ["acrobatics"],
  },
  {
    id: "fighter",
    name: "Fighter Feat",
    type: "feat",
    level: 4,
    traits: ["fighter"],
    rarity: "common",
    featCategory: "class",
    skills: [],
  },
];

test("traitsIn requires every tag and traitsOut rejects any excluded tag", function () {
  const onlyFire = CatalogService.filterIndex(ADVANCED, {
    traitsIn: ["fire", "manipulate"],
  });
  assert.deepEqual(ids(onlyFire), ["fireball"]);

  const allHumanoids = CatalogService.filterIndex(ADVANCED, {
    traitsIn: ["humanoid"],
  });
  assert.deepEqual(ids(allHumanoids), ["android"]);

  const noAndroids = CatalogService.filterIndex(ADVANCED, {
    traitsOut: ["android"],
  });
  assert.equal(noAndroids.some(function (entry) {
    return entry.id === "android";
  }), false);
  assert.equal(noAndroids.length, ADVANCED.length - 1);
});

test("spell category/tradition/rank filters use AND across groups", function () {
  const occultFocus = CatalogService.filterIndex(ADVANCED, {
    spellCategories: ["focus"],
    traditions: ["occult"],
    level: ["1"],
  });
  assert.deepEqual(ids(occultFocus), ["occult-focus"]);

  const arcaneRank3 = CatalogService.filterIndex(ADVANCED, {
    traditions: ["arcane"],
    ranks: "3",
  });
  assert.deepEqual(ids(arcaneRank3), ["fireball"]);

  const impossible = CatalogService.filterIndex(ADVANCED, {
    spellCategories: ["focus"],
    traditions: ["primal"],
  });
  assert.deepEqual(ids(impossible), []);
});

test("bestiary size and feat category/skill filters are independent groups", function () {
  const huge = CatalogService.filterIndex(ADVANCED, { sizes: ["huge"] });
  assert.deepEqual(ids(huge), ["dragon"]);

  const skillFeat = CatalogService.filterIndex(ADVANCED, {
    featCategories: ["skill"],
    skills: ["acrobatics"],
  });
  assert.deepEqual(ids(skillFeat), ["acrobat"]);

  const mismatched = CatalogService.filterIndex(ADVANCED, {
    featCategories: ["class"],
    skills: ["acrobatics"],
  });
  assert.deepEqual(ids(mismatched), []);
});

test("catalogue facets expose every tag, optionally narrowed by type", function () {
  const npcTraits = collectCatalogTraits(ADVANCED, "npc");
  assert.deepEqual(npcTraits, ["android", "dragon", "huge", "humanoid"]);

  const allTraits = collectCatalogTraits(ADVANCED);
  assert.ok(allTraits.includes("fire"));
  assert.ok(allTraits.includes("skill"));
  assert.equal(allTraits.includes("android"), true);
});

test("spell category is derived from focus/cantrip/ritual traits", function () {
  const derived = CatalogService.filterIndex(
    [
      {
        id: "shield",
        name: "Shield",
        type: "spell",
        level: 1,
        traits: ["cantrip"],
      },
      {
        id: "whispers",
        name: "Whispers",
        type: "spell",
        level: 2,
        traits: ["focus"],
      },
      {
        id: "raise-dead",
        name: "Raise Dead",
        type: "spell",
        level: 6,
        traits: ["ritual"],
      },
    ],
    { spellCategories: ["cantrip", "ritual"] },
  );
  assert.deepEqual(ids(derived), ["shield", "raise-dead"]);
});
