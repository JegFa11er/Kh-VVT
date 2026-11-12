/**
 * Step 6.6: shared Compendium Browser filter metadata and URL builder.
 *
 * Keeping the option lists and URL construction outside the React component
 * makes the equipment filter contract (AND across groups, OR inside a group)
 * easy to unit-test without a DOM.
 *
 * Step 6.8: every option carries a `labelKey` + English `labelEn` so the
 * browser can render RU/EN labels through `t()`. `label` stays as the Russian
 * fallback for code paths that do not have the translation helper.
 */

export const EQUIPMENT_RARITIES = Object.freeze([
  {
    value: "common",
    label: "Обычный",
    labelEn: "Common",
    labelKey: "PF2E.Platform.Option.Rarity.Common",
  },
  {
    value: "uncommon",
    label: "Необычный",
    labelEn: "Uncommon",
    labelKey: "PF2E.Platform.Option.Rarity.Uncommon",
  },
  {
    value: "rare",
    label: "Редкий",
    labelEn: "Rare",
    labelKey: "PF2E.Platform.Option.Rarity.Rare",
  },
  {
    value: "unique",
    label: "Уникальный",
    labelEn: "Unique",
    labelKey: "PF2E.Platform.Option.Rarity.Unique",
  },
]);

export const EQUIPMENT_ITEM_TYPES = Object.freeze([
  {
    value: "ammo",
    label: "Амуниция",
    labelEn: "Ammunition",
    labelKey: "PF2E.Platform.Option.ItemType.Ammo",
  },
  {
    value: "armor",
    label: "Доспех",
    labelEn: "Armor",
    labelKey: "PF2E.Platform.Option.ItemType.Armor",
  },
  {
    value: "weapon",
    label: "Оружие",
    labelEn: "Weapon",
    labelKey: "PF2E.Platform.Option.ItemType.Weapon",
  },
  {
    value: "consumable",
    label: "Расходуемый",
    labelEn: "Consumable",
    labelKey: "PF2E.Platform.Option.ItemType.Consumable",
  },
  {
    value: "equipment",
    label: "Снаряжение",
    labelEn: "Equipment",
    labelKey: "PF2E.Platform.Option.ItemType.Equipment",
  },
  {
    value: "shield",
    label: "Щит",
    labelEn: "Shield",
    labelKey: "PF2E.Platform.Option.ItemType.Shield",
  },
  {
    value: "backpack",
    label: "Рюкзак",
    labelEn: "Backpack",
    labelKey: "PF2E.Platform.Option.ItemType.Backpack",
  },
  {
    value: "kit",
    label: "Набор",
    labelEn: "Kit",
    labelKey: "PF2E.Platform.Option.ItemType.Kit",
  },
  {
    value: "treasure",
    label: "Сокровище",
    labelEn: "Treasure",
    labelKey: "PF2E.Platform.Option.ItemType.Treasure",
  },
  {
    value: "book",
    label: "Книга",
    labelEn: "Book",
    labelKey: "PF2E.Platform.Option.ItemType.Book",
  },
]);

export const ARMOR_CATEGORIES = Object.freeze([
  {
    value: "unarmored",
    label: "Без брони",
    labelEn: "Unarmored",
    labelKey: "PF2E.Platform.Option.Armor.Unarmored",
  },
  {
    value: "light",
    label: "Лёгкий",
    labelEn: "Light",
    labelKey: "PF2E.Platform.Option.Armor.Light",
  },
  {
    value: "medium",
    label: "Средний",
    labelEn: "Medium",
    labelKey: "PF2E.Platform.Option.Armor.Medium",
  },
  {
    value: "heavy",
    label: "Тяжёлый",
    labelEn: "Heavy",
    labelKey: "PF2E.Platform.Option.Armor.Heavy",
  },
]);

export const WEAPON_CATEGORIES = Object.freeze([
  {
    value: "simple",
    label: "Простое",
    labelEn: "Simple",
    labelKey: "PF2E.Platform.Option.Weapon.Simple",
  },
  {
    value: "martial",
    label: "Воинское",
    labelEn: "Martial",
    labelKey: "PF2E.Platform.Option.Weapon.Martial",
  },
  {
    value: "advanced",
    label: "Продвинутое",
    labelEn: "Advanced",
    labelKey: "PF2E.Platform.Option.Weapon.Advanced",
  },
  {
    value: "unarmed",
    label: "Безоружное",
    labelEn: "Unarmed",
    labelKey: "PF2E.Platform.Option.Weapon.Unarmed",
  },
]);

/** Step 6.7: spell accordion groups. */
export const SPELL_CATEGORIES = Object.freeze([
  {
    value: "spell",
    label: "Заклинание",
    labelEn: "Spell",
    labelKey: "PF2E.Platform.Option.SpellCategory.Spell",
  },
  {
    value: "cantrip",
    label: "Чары",
    labelEn: "Cantrip",
    labelKey: "PF2E.Platform.Option.SpellCategory.Cantrip",
  },
  {
    value: "focus",
    label: "Фокус",
    labelEn: "Focus",
    labelKey: "PF2E.Platform.Option.SpellCategory.Focus",
  },
  {
    value: "ritual",
    label: "Ритуал",
    labelEn: "Ritual",
    labelKey: "PF2E.Platform.Option.SpellCategory.Ritual",
  },
]);

export const SPELL_TRADITIONS = Object.freeze([
  {
    value: "arcane",
    label: "Арканный",
    labelEn: "Arcane",
    labelKey: "PF2E.Platform.Option.Tradition.Arcane",
  },
  {
    value: "occult",
    label: "Оккультный",
    labelEn: "Occult",
    labelKey: "PF2E.Platform.Option.Tradition.Occult",
  },
  {
    value: "primal",
    label: "Природный",
    labelEn: "Primal",
    labelKey: "PF2E.Platform.Option.Tradition.Primal",
  },
  {
    value: "divine",
    label: "Сакральный",
    labelEn: "Divine",
    labelKey: "PF2E.Platform.Option.Tradition.Divine",
  },
]);

export const SPELL_RANKS = Object.freeze(
  Array.from({ length: 10 }, function (_, index) {
    const rank = index + 1;
    return { value: String(rank), label: String(rank), labelEn: String(rank) };
  }),
);

/** Step 6.7: bestiary accordion groups (PF2e size identifiers). */
export const CREATURE_SIZES = Object.freeze([
  {
    value: "tiny",
    label: "Крошечный",
    labelEn: "Tiny",
    labelKey: "PF2E.Platform.Option.Size.Tiny",
  },
  {
    value: "sm",
    label: "Маленький",
    labelEn: "Small",
    labelKey: "PF2E.Platform.Option.Size.Small",
  },
  {
    value: "med",
    label: "Средний",
    labelEn: "Medium",
    labelKey: "PF2E.Platform.Option.Size.Medium",
  },
  {
    value: "lg",
    label: "Большой",
    labelEn: "Large",
    labelKey: "PF2E.Platform.Option.Size.Large",
  },
  {
    value: "huge",
    label: "Огромный",
    labelEn: "Huge",
    labelKey: "PF2E.Platform.Option.Size.Huge",
  },
  {
    value: "grg",
    label: "Исполинский",
    labelEn: "Gargantuan",
    labelKey: "PF2E.Platform.Option.Size.Gargantuan",
  },
]);

/** Step 6.7: feat category identifiers used by Foundry documents. */
export const FEAT_CATEGORIES = Object.freeze([
  {
    value: "class",
    label: "Способность класса",
    labelEn: "Class Feat",
    labelKey: "PF2E.Platform.Option.Feat.Class",
  },
  {
    value: "classfeature",
    label: "Классовая особенность",
    labelEn: "Class Feature",
    labelKey: "PF2E.Platform.Option.Feat.ClassFeature",
  },
  {
    value: "skill",
    label: "Способность навыка",
    labelEn: "Skill Feat",
    labelKey: "PF2E.Platform.Option.Feat.Skill",
  },
  {
    value: "ancestry",
    label: "Способность родословной",
    labelEn: "Ancestry Feat",
    labelKey: "PF2E.Platform.Option.Feat.Ancestry",
  },
  {
    value: "ancestryfeature",
    label: "Особенность родословной",
    labelEn: "Ancestry Feature",
    labelKey: "PF2E.Platform.Option.Feat.AncestryFeature",
  },
  {
    value: "general",
    label: "Общая способность",
    labelEn: "General Feat",
    labelKey: "PF2E.Platform.Option.Feat.General",
  },
  {
    value: "bonus",
    label: "Бонусная способность",
    labelEn: "Bonus Feat",
    labelKey: "PF2E.Platform.Option.Feat.Bonus",
  },
  {
    value: "calling",
    label: "Призвание",
    labelEn: "Calling",
    labelKey: "PF2E.Platform.Option.Feat.Calling",
  },
]);

export const FEAT_SKILLS = Object.freeze([
  { value: "acrobatics", label: "Акробатика", labelEn: "Acrobatics", labelKey: "PF2E.Skill.Acrobatics" },
  { value: "arcana", label: "Аркана", labelEn: "Arcana", labelKey: "PF2E.Skill.Arcana" },
  { value: "athletics", label: "Атлетика", labelEn: "Athletics", labelKey: "PF2E.Skill.Athletics" },
  { value: "crafting", label: "Ремесло", labelEn: "Crafting", labelKey: "PF2E.Skill.Crafting" },
  { value: "deception", label: "Обман", labelEn: "Deception", labelKey: "PF2E.Skill.Deception" },
  { value: "diplomacy", label: "Дипломатия", labelEn: "Diplomacy", labelKey: "PF2E.Skill.Diplomacy" },
  { value: "intimidation", label: "Запугивание", labelEn: "Intimidation", labelKey: "PF2E.Skill.Intimidation" },
  { value: "medicine", label: "Медицина", labelEn: "Medicine", labelKey: "PF2E.Skill.Medicine" },
  { value: "nature", label: "Природа", labelEn: "Nature", labelKey: "PF2E.Skill.Nature" },
  { value: "occultism", label: "Оккультизм", labelEn: "Occultism", labelKey: "PF2E.Skill.Occultism" },
  { value: "performance", label: "Выступление", labelEn: "Performance", labelKey: "PF2E.Skill.Performance" },
  { value: "religion", label: "Религия", labelEn: "Religion", labelKey: "PF2E.Skill.Religion" },
  { value: "society", label: "Общество", labelEn: "Society", labelKey: "PF2E.Skill.Society" },
  { value: "stealth", label: "Скрытность", labelEn: "Stealth", labelKey: "PF2E.Skill.Stealth" },
  { value: "survival", label: "Выживание", labelEn: "Survival", labelKey: "PF2E.Skill.Survival" },
  { value: "thievery", label: "Воровство", labelEn: "Thievery", labelKey: "PF2E.Skill.Thievery" },
]);

/** Fresh mutable filter state so tab switches never share checkbox arrays. */
export function createEmptyEquipmentFilters() {
  return {
    rarity: [],
    itemTypes: [],
    armorCategories: [],
    weaponCategories: [],
    priceMin: "",
    priceMax: "",
  };
}

/**
 * Step 6.7: advanced filter state shared by the Spells/Bestiary/Feats tabs.
 * `traitsIn`/`traitsOut` live here because the trait accordion is available on
 * every compendium tab.
 */
export function createEmptyAdvancedFilters() {
  return {
    rarity: [],
    spellCategories: [],
    traditions: [],
    ranks: [],
    sizes: [],
    featCategories: [],
    skills: [],
    traitsIn: [],
    traitsOut: [],
  };
}

export function hasAdvancedFilters(filters) {
  if (!filters) {
    return false;
  }
  return Object.keys(createEmptyAdvancedFilters()).some(function (key) {
    return Array.isArray(filters[key]) && filters[key].length > 0;
  });
}

/** Add/remove a checkbox value without mutating the previous array. */
export function toggleFilterValue(values, value) {
  const list = Array.isArray(values) ? values : [];
  return list.includes(value)
    ? list.filter((entry) => entry !== value)
    : [...list, value];
}

/**
 * Three-state tag selection: none -> included (green) -> excluded (red) -> none.
 * A tag can never be in both lists at once.
 */
export function cycleTraitFilter(filters, tag) {
  const current = filters || createEmptyAdvancedFilters();
  const traitsIn = Array.isArray(current.traitsIn) ? current.traitsIn : [];
  const traitsOut = Array.isArray(current.traitsOut) ? current.traitsOut : [];
  if (traitsIn.includes(tag)) {
    return {
      ...current,
      traitsIn: traitsIn.filter((entry) => entry !== tag),
      traitsOut: [...traitsOut, tag],
    };
  }
  if (traitsOut.includes(tag)) {
    return {
      ...current,
      traitsIn,
      traitsOut: traitsOut.filter((entry) => entry !== tag),
    };
  }
  return { ...current, traitsIn: [...traitsIn, tag], traitsOut };
}

export function traitFilterState(filters, tag) {
  const current = filters || {};
  if (Array.isArray(current.traitsIn) && current.traitsIn.includes(tag)) {
    return "in";
  }
  if (Array.isArray(current.traitsOut) && current.traitsOut.includes(tag)) {
    return "out";
  }
  return "none";
}

export function hasEquipmentFilters(filters) {
  if (!filters) {
    return false;
  }
  return (
    (Array.isArray(filters.rarity) && filters.rarity.length > 0) ||
    (Array.isArray(filters.itemTypes) && filters.itemTypes.length > 0) ||
    (Array.isArray(filters.armorCategories) &&
      filters.armorCategories.length > 0) ||
    (Array.isArray(filters.weaponCategories) &&
      filters.weaponCategories.length > 0) ||
    String(filters.priceMin || "").trim() !== "" ||
    String(filters.priceMax || "").trim() !== ""
  );
}

function appendList(params, name, values) {
  if (!Array.isArray(values) || values.length === 0) {
    return;
  }
  params.set(name, values.join(","));
}

/**
 * Build `/api/compendiums/:category` for the active tab and filter state.
 *
 * Equipment-only filters are omitted for other tabs, so stale checkbox state
 * can never leak into spells/feats/monsters requests.
 *
 * @param {{ id: string, category: string, type?: string }} tab
 * @param {object} state
 * @returns {string}
 */
export function buildCompendiumUrl(tab, state) {
  const options = state || {};
  const params = new URLSearchParams();
  params.set("lang", options.language === "en" ? "en" : "ru");

  const search = String(options.search || "").trim();
  if (search !== "") {
    params.set("search", search);
  }
  if (tab.type) {
    params.set("type", tab.type);
  }

  const minLevel = String(options.minLevel || "").trim();
  if (minLevel !== "") {
    params.set("minLevel", minLevel);
  }
  const maxLevel = String(options.maxLevel || "").trim();
  if (maxLevel !== "") {
    params.set("maxLevel", maxLevel);
  }

  if (tab.id === "equipment") {
    appendList(params, "rarity", options.rarity);
    appendList(params, "itemTypes", options.itemTypes);
    appendList(params, "armorCategories", options.armorCategories);
    appendList(params, "weaponCategories", options.weaponCategories);
    const priceMin = String(options.priceMin || "").trim();
    if (priceMin !== "") {
      params.set("priceMin", priceMin);
    }
    const priceMax = String(options.priceMax || "").trim();
    if (priceMax !== "") {
      params.set("priceMax", priceMax);
    }
  } else {
    // Step 6.7: non-equipment tabs use `rarities` so the legacy top-level
    // `rarity` key stays equipment-only.
    appendList(params, "rarity", options.rarities);
  }

  if (tab.id === "spells") {
    appendList(params, "spellCategories", options.spellCategories);
    appendList(params, "traditions", options.traditions);
    appendList(params, "ranks", options.ranks);
  }
  if (tab.id === "bestiary") {
    appendList(params, "sizes", options.sizes);
  }
  if (tab.id === "feats") {
    appendList(params, "featCategories", options.featCategories);
    appendList(params, "skills", options.skills);
  }

  // Step 6.7: the trait accordion is shared by every compendium tab.
  appendList(params, "traitsIn", options.traitsIn);
  appendList(params, "traitsOut", options.traitsOut);

  const limit = Number(options.limit);
  params.set("limit", String(Number.isFinite(limit) && limit > 0 ? limit : 100));

  const query = params.toString();
  return "/api/compendiums/" + tab.category + (query ? "?" + query : "");
}
