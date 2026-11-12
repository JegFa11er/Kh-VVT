import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompendiumUrl,
  createEmptyAdvancedFilters,
  createEmptyEquipmentFilters,
  cycleTraitFilter,
  hasAdvancedFilters,
  hasEquipmentFilters,
  toggleFilterValue,
  traitFilterState,
} from "../src/ui/compendium-filters.js";

test("toggleFilterValue adds and removes checkbox values", function () {
  assert.deepEqual(toggleFilterValue([], "rare"), ["rare"]);
  assert.deepEqual(toggleFilterValue(["rare"], "unique"), ["rare", "unique"]);
  assert.deepEqual(toggleFilterValue(["rare", "unique"], "rare"), ["unique"]);
});

test("equipment filters are detected for the clear button/state", function () {
  const empty = createEmptyEquipmentFilters();
  assert.equal(hasEquipmentFilters(empty), false);
  assert.equal(hasEquipmentFilters({ ...empty, rarity: ["rare"] }), true);
  assert.equal(hasEquipmentFilters({ ...empty, priceMax: "10 зм" }), true);
});

test("equipment URL carries combined rarity/type/category/price filters", function () {
  const url = buildCompendiumUrl(
    { id: "equipment", category: "equipment" },
    {
      language: "ru",
      search: "  доспех  ",
      minLevel: "1",
      maxLevel: "10",
      rarity: ["rare", "unique"],
      itemTypes: ["armor"],
      armorCategories: ["light", "medium"],
      weaponCategories: [],
      priceMin: "0 мм",
      priceMax: "10 зм",
      limit: 100,
    },
  );

  const query = new URLSearchParams(url.split("?")[1]);
  assert.equal(url.startsWith("/api/compendiums/equipment?"), true);
  assert.equal(query.get("lang"), "ru");
  assert.equal(query.get("search"), "доспех");
  assert.equal(query.get("minLevel"), "1");
  assert.equal(query.get("maxLevel"), "10");
  assert.equal(query.get("rarity"), "rare,unique");
  assert.equal(query.get("itemTypes"), "armor");
  assert.equal(query.get("armorCategories"), "light,medium");
  assert.equal(query.get("weaponCategories"), null);
  assert.equal(query.get("priceMin"), "0 мм");
  assert.equal(query.get("priceMax"), "10 зм");
  assert.equal(query.get("limit"), "100");
});

test("non-equipment tabs never send stale equipment filters", function () {
  const url = buildCompendiumUrl(
    { id: "spells", category: "spells" },
    {
      language: "en",
      rarity: ["rare"],
      itemTypes: ["armor"],
      priceMax: "10 зм",
      limit: 100,
    },
  );
  const query = new URLSearchParams(url.split("?")[1]);
  assert.equal(query.get("lang"), "en");
  assert.equal(query.get("rarity"), null);
  assert.equal(query.get("itemTypes"), null);
  assert.equal(query.get("priceMax"), null);
});

test("trait filter cycles none -> included -> excluded -> none", function () {
  let filters = createEmptyAdvancedFilters();
  assert.equal(traitFilterState(filters, "android"), "none");

  filters = cycleTraitFilter(filters, "android");
  assert.deepEqual(filters.traitsIn, ["android"]);
  assert.deepEqual(filters.traitsOut, []);
  assert.equal(traitFilterState(filters, "android"), "in");

  filters = cycleTraitFilter(filters, "android");
  assert.deepEqual(filters.traitsIn, []);
  assert.deepEqual(filters.traitsOut, ["android"]);
  assert.equal(traitFilterState(filters, "android"), "out");

  filters = cycleTraitFilter(filters, "android");
  assert.deepEqual(filters.traitsIn, []);
  assert.deepEqual(filters.traitsOut, []);
  assert.equal(traitFilterState(filters, "android"), "none");
});

test("advanced filters are detected and included only on relevant tabs", function () {
  const empty = createEmptyAdvancedFilters();
  assert.equal(hasAdvancedFilters(empty), false);
  assert.equal(hasAdvancedFilters({ ...empty, traitsOut: ["android"] }), true);

  const spellsUrl = buildCompendiumUrl(
    { id: "spells", category: "spells" },
    {
      language: "ru",
      rarities: ["uncommon"],
      spellCategories: ["focus"],
      traditions: ["occult", "divine"],
      ranks: ["1", "2"],
      traitsIn: ["mental"],
      traitsOut: ["android"],
      limit: 100,
    },
  );
  const spellsQuery = new URLSearchParams(spellsUrl.split("?")[1]);
  assert.equal(spellsQuery.get("rarity"), "uncommon");
  assert.equal(spellsQuery.get("spellCategories"), "focus");
  assert.equal(spellsQuery.get("traditions"), "occult,divine");
  assert.equal(spellsQuery.get("ranks"), "1,2");
  assert.equal(spellsQuery.get("traitsIn"), "mental");
  assert.equal(spellsQuery.get("traitsOut"), "android");
  assert.equal(spellsQuery.get("sizes"), null);

  const bestiaryUrl = buildCompendiumUrl(
    { id: "bestiary", category: "monsters", type: "npc" },
    { language: "ru", sizes: ["med", "huge"], limit: 100 },
  );
  const bestiaryQuery = new URLSearchParams(bestiaryUrl.split("?")[1]);
  assert.equal(bestiaryQuery.get("type"), "npc");
  assert.equal(bestiaryQuery.get("sizes"), "med,huge");

  const featsUrl = buildCompendiumUrl(
    { id: "feats", category: "feats" },
    {
      language: "ru",
      featCategories: ["skill"],
      skills: ["acrobatics"],
      limit: 100,
    },
  );
  const featsQuery = new URLSearchParams(featsUrl.split("?")[1]);
  assert.equal(featsQuery.get("featCategories"), "skill");
  assert.equal(featsQuery.get("skills"), "acrobatics");
});
