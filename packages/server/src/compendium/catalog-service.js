"use strict";

const fs = require("node:fs");
const path = require("node:path");

const INDEX_SUFFIX = ".index.json";
const DEFAULT_LANGUAGE = "en";
const SUPPORTED_LANGUAGES = Object.freeze(["en", "ru"]);
const LEGACY_LANGUAGE = "legacy";

/**
 * Step 6.7: skill identifiers used by the feat "Навыки" filter. The catalogue
 * stores selectors in English, while the UI supplies Russian labels.
 */
const CATALOG_SKILL_KEYS = Object.freeze([
  "acrobatics",
  "arcana",
  "athletics",
  "crafting",
  "deception",
  "diplomacy",
  "intimidation",
  "medicine",
  "nature",
  "occultism",
  "performance",
  "religion",
  "society",
  "stealth",
  "survival",
  "thievery",
]);

const SKILL_NAME_ALIASES = Object.freeze({
  acrobatics: "acrobatics",
  акробатика: "acrobatics",
  arcana: "arcana",
  аркана: "arcana",
  athletics: "athletics",
  атлетика: "athletics",
  crafting: "crafting",
  ремесло: "crafting",
  deception: "deception",
  обман: "deception",
  diplomacy: "diplomacy",
  дипломатия: "diplomacy",
  intimidation: "intimidation",
  запугивание: "intimidation",
  medicine: "medicine",
  медицина: "medicine",
  nature: "nature",
  природа: "nature",
  occultism: "occultism",
  оккультизм: "occultism",
  performance: "performance",
  выступление: "performance",
  religion: "religion",
  религия: "religion",
  society: "society",
  общество: "society",
  stealth: "stealth",
  скрытность: "stealth",
  survival: "survival",
  выживание: "survival",
  thievery: "thievery",
  воровство: "thievery",
});

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Step 6.5: normalize a `?lang=` value. Unknown languages fall back to English,
 * which keeps every pre-6.5 API client working.
 */
function normalizeLanguage(value) {
  if (!isNonEmptyString(value)) {
    return DEFAULT_LANGUAGE;
  }
  const language = value.trim().toLowerCase();
  return SUPPORTED_LANGUAGES.indexOf(language) === -1
    ? DEFAULT_LANGUAGE
    : language;
}

function languageFileSuffix(language) {
  return language === LEGACY_LANGUAGE ? "" : "." + language;
}

function normalizeCategoryId(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  const id = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
    return null;
  }
  return id;
}

function normalizeTraitsFilter(value) {
  if (value === null || value === undefined) {
    return [];
  }
  const list = Array.isArray(value) ? value : [value];
  const result = [];
  for (const entry of list) {
    if (typeof entry !== "string") {
      continue;
    }
    for (const part of entry.split(",")) {
      const trait = part.trim().toLowerCase();
      if (trait !== "") {
        result.push(trait);
      }
    }
  }
  return result;
}

/**
 * Step 6.6: query parameters may arrive as repeated values (`rarity=rare&rarity=unique`)
 * or comma-separated (`itemTypes=armor,shield`). Normalize both into a
 * lower-case list of distinct values.
 */
function normalizeFilterList(value) {
  return Array.from(new Set(normalizeTraitsFilter(value)));
}

function normalizeText(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Step 6.6: price units in copper pieces. PF2e uses the decimal coin system
 * (1 pp = 10 gp = 100 sp = 1000 cp); the aliases cover the Russian UI labels
 * ("зм", "см", "мм") as well as the abbreviations stored in the Foundry data.
 */
const PRICE_UNITS_IN_CP = Object.freeze({
  cp: 1,
  copper: 1,
  copperpiece: 1,
  c: 1,
  мм: 1,
  м: 1,
  медь: 1,
  медный: 1,
  медная: 1,
  медных: 1,
  sp: 10,
  silver: 10,
  silverpiece: 10,
  s: 10,
  см: 10,
  с: 10,
  серебро: 10,
  серебряный: 10,
  серебряная: 10,
  серебряных: 10,
  gp: 100,
  gold: 100,
  goldpiece: 100,
  g: 100,
  зм: 100,
  з: 100,
  золото: 100,
  золотой: 100,
  золотая: 100,
  золотых: 100,
  pp: 1000,
  platinum: 1000,
  platinumpiece: 1000,
  p: 1000,
  пп: 1000,
  плм: 1000,
  пм: 1000,
  платина: 1000,
  платиновый: 1000,
  платиновых: 1000,
});

/**
 * Parse a human price string ("5 зм", "10 см", "4 gp", "1 зм 5 см") into a
 * single integer amount of copper pieces. A bare number is interpreted as gold
 * pieces, matching how the Filter sidebar labels its inputs.
 *
 * @param {string|number|string[]|null|undefined} value
 * @returns {number|null} copper pieces, or null when the value is empty/invalid
 */
function parsePriceToCp(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = parsePriceToCp(entry);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }

  const text = String(value).trim().toLowerCase().replace(/,/g, ".");
  if (text === "" || text.startsWith("-")) {
    return null;
  }

  const pattern = /(\d+(?:\.\d+)?)\s*([a-zа-яё]*)/g;
  let match;
  let total = 0;
  let matched = false;
  while ((match = pattern.exec(text)) !== null) {
    const amount = Number.parseFloat(match[1]);
    if (!Number.isFinite(amount)) {
      continue;
    }
    const unit = match[2].replace(/\.+$/g, "");
    let multiplier;
    if (unit === "") {
      multiplier = PRICE_UNITS_IN_CP.gp;
    } else if (Object.prototype.hasOwnProperty.call(PRICE_UNITS_IN_CP, unit)) {
      multiplier = PRICE_UNITS_IN_CP[unit];
    } else {
      continue;
    }
    total += amount * multiplier;
    matched = true;
  }

  return matched ? Math.round(total) : null;
}

/** Read the compact or Foundry rarity field from an index/full entry. */
function readEntryRarity(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  if (isNonEmptyString(entry.rarity)) {
    return entry.rarity.trim().toLowerCase();
  }
  const traits = entry.system && entry.system.traits;
  if (traits && isNonEmptyString(traits.rarity)) {
    return traits.rarity.trim().toLowerCase();
  }
  return null;
}

/** Read `system.category` (armor/weapon/shield categories) from either shape. */
function readEntryCategory(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  if (isNonEmptyString(entry.category)) {
    return entry.category.trim().toLowerCase();
  }
  if (isNonEmptyString(entry.systemCategory)) {
    return entry.systemCategory.trim().toLowerCase();
  }
  const system = entry.system;
  if (system && isNonEmptyString(system.category)) {
    return system.category.trim().toLowerCase();
  }
  for (const key of ["weapon", "armor", "shield"]) {
    const typed = entry[key];
    if (typed && isNonEmptyString(typed.category)) {
      return typed.category.trim().toLowerCase();
    }
  }
  return null;
}

/** Normalise an entry's trait list from either index or Foundry shape. */
function readEntryTraits(entry) {
  if (!entry || typeof entry !== "object") {
    return [];
  }
  const source =
    entry.traits !== undefined
      ? entry.traits
      : entry.system && entry.system.traits
        ? entry.system.traits.value
        : [];
  const values = Array.isArray(source)
    ? source
    : typeof source === "string"
      ? source.split(",")
      : [];
  return values
    .map(function (trait) {
      return String(trait || "").trim().toLowerCase();
    })
    .filter(Boolean);
}

/**
 * PF2e Remastered spell categories are derived from traits: cantrips and focus
 * spells do not have a separate `system.category` field in the compendium data.
 */
function readEntrySpellCategory(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const explicit = isNonEmptyString(entry.spellCategory)
    ? entry.spellCategory
    : entry.system && entry.system.category !== undefined
      ? typeof entry.system.category === "object"
        ? entry.system.category.value
        : entry.system.category
      : null;
  if (isNonEmptyString(explicit)) {
    const normalized = explicit.trim().toLowerCase();
    if (normalized !== "spell" || readEntryTraits(entry).includes("spell")) {
      return normalized;
    }
  }
  const traits = readEntryTraits(entry);
  if (traits.includes("cantrip")) {
    return "cantrip";
  }
  if (traits.includes("focus")) {
    return "focus";
  }
  if (traits.includes("ritual")) {
    return "ritual";
  }
  return "spell";
}

/** Magical traditions live on `system.traits.traditions` in Foundry data. */
function readEntryTraditions(entry) {
  if (!entry || typeof entry !== "object") {
    return [];
  }
  const source =
    entry.traditions !== undefined
      ? entry.traditions
      : entry.system && entry.system.traits
        ? entry.system.traits.traditions
        : [];
  return (Array.isArray(source) ? source : [source])
    .map(function (tradition) {
      return String(tradition || "").trim().toLowerCase();
    })
    .filter(Boolean);
}

/** Creature size: compact `entry.size` or `system.traits.size.value`. */
function readEntrySize(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const source =
    entry.size !== undefined
      ? entry.size
      : entry.system && entry.system.traits
        ? entry.system.traits.size
        : entry.system && entry.system.size;
  const raw =
    source !== null && typeof source === "object" ? source.value : source;
  return isNonEmptyString(raw) ? raw.trim().toLowerCase() : null;
}

/** Feat category (`class`, `skill`, `ancestry`, `general`, ...). */
function readEntryFeatCategory(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const source =
    entry.featCategory !== undefined
      ? entry.featCategory
      : entry.system && entry.system.category !== undefined
        ? entry.system.category
        : entry.category;
  if (!isNonEmptyString(source)) {
    return null;
  }
  return source.trim().toLowerCase();
}

/**
 * Associated skills for a feat. Foundry stores this implicitly: skill feats put
 * the skill in a rule selector or in a prerequisite string such as
 * "trained in Acrobatics". Both sources are read so the filter works without a
 * separate authored field.
 */
function readEntrySkills(entry) {
  if (!entry || typeof entry !== "object") {
    return [];
  }
  const skills = new Set();
  const add = function (value) {
    const text = String(value || "").trim().toLowerCase();
    if (text === "") {
      return;
    }
    const alias = SKILL_NAME_ALIASES[text];
    if (alias) {
      skills.add(alias);
      return;
    }
    for (const key of CATALOG_SKILL_KEYS) {
      if (text.includes(key)) {
        skills.add(key);
        return;
      }
    }
  };

  const explicit = Array.isArray(entry.skills)
    ? entry.skills
    : entry.skills !== undefined
      ? [entry.skills]
      : [];
  explicit.forEach(add);

  const system = asObject(entry.system);
  for (const rule of asArray(system.rules)) {
    const selector = rule && rule.selector;
    for (const value of Array.isArray(selector) ? selector : [selector]) {
      add(value);
    }
  }
  const prerequisites = system.prerequisites;
  const values =
    prerequisites && typeof prerequisites === "object"
      ? asArray(prerequisites.value)
      : asArray(prerequisites);
  for (const prerequisite of values) {
    if (typeof prerequisite === "string") {
      add(prerequisite);
    } else if (prerequisite && typeof prerequisite === "object") {
      add(prerequisite.value);
    }
  }

  return Array.from(skills).sort();
}

function asObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/** Convert a Foundry `price` object/string into copper pieces. */
function readPriceObjectToCp(price) {
  if (price === null || price === undefined) {
    return null;
  }
  if (typeof price === "number") {
    return Number.isFinite(price) && price >= 0
      ? Math.round(price * PRICE_UNITS_IN_CP.gp)
      : null;
  }
  if (typeof price === "string") {
    return parsePriceToCp(price);
  }
  if (typeof price !== "object" || Array.isArray(price)) {
    return null;
  }

  const value = price.value !== undefined ? price.value : price;
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0
      ? Math.round(value * PRICE_UNITS_IN_CP.gp)
      : null;
  }
  if (typeof value === "string") {
    return parsePriceToCp(value);
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  let total = 0;
  let matched = false;
  for (const key of ["pp", "gp", "sp", "cp"]) {
    const raw = value[key];
    if (raw === null || raw === undefined || raw === "") {
      continue;
    }
    const coins = Number(raw);
    if (Number.isFinite(coins)) {
      total += coins * PRICE_UNITS_IN_CP[key];
      matched = true;
    }
  }
  return matched ? Math.round(total) : null;
}

/** Read a price from the compact index or the full Foundry document. */
function readEntryPriceCp(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  if (typeof entry.priceCp === "number" && Number.isFinite(entry.priceCp)) {
    return Math.round(entry.priceCp);
  }
  if (entry.price !== undefined) {
    const compact = readPriceObjectToCp(entry.price);
    if (compact !== null) {
      return compact;
    }
  }
  const system = entry.system;
  if (system && system.price !== undefined) {
    const price = readPriceObjectToCp(system.price);
    if (price !== null) {
      return price;
    }
  }
  for (const key of ["weapon", "armor", "shield"]) {
    const typed = entry[key];
    if (typed && typed.price !== undefined) {
      const price = readPriceObjectToCp(typed.price);
      if (price !== null) {
        return price;
      }
    }
  }
  return null;
}

/**
 * Step 6.7: the set of trait tags available in a catalogue (optionally
 * narrowed by document type). The Compendium Browser uses this to build the
 * "Признаки" palette, so excluding a tag never requires that tag to be present
 * on the currently paginated cards.
 */
function collectCatalogTraits(entries, type) {
  const normalizedType = isNonEmptyString(type)
    ? type.trim().toLowerCase()
    : null;
  const tags = new Set();
  for (const entry of asArray(entries)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    if (
      normalizedType !== null &&
      (!isNonEmptyString(entry.type) ||
        entry.type.trim().toLowerCase() !== normalizedType)
    ) {
      continue;
    }
    for (const trait of readEntryTraits(entry)) {
      tags.add(trait);
    }
  }
  return Array.from(tags).sort(function (a, b) {
    return a.localeCompare(b);
  });
}

function hasFilterValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value !== null && value !== undefined && value !== "";
}

/** A new index stores the key on every entry, even when its value is null. */
function indexHasField(entries, field) {
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !Object.prototype.hasOwnProperty.call(entry, field)
    ) {
      return false;
    }
  }
  return true;
}

function readNonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function readInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * Read an entry level from either the compact index shape (`level: 3`) or the
 * full Foundry document shape (`system.level.value: 3`).
 */
function readEntryLevel(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  if (typeof entry.level === "number" && Number.isFinite(entry.level)) {
    return entry.level;
  }
  const system = entry.system;
  if (system && system.level && typeof system.level.value === "number") {
    return system.level.value;
  }
  return null;
}

/**
 * Step 4.7: level is the primary sort key, name is only a tie-breaker.
 * Entries without a level (most equipment) sort after levelled entries.
 */
function compareCatalogEntries(a, b, language) {
  const levelA = readEntryLevel(a);
  const levelB = readEntryLevel(b);
  const rankA = levelA === null ? Number.POSITIVE_INFINITY : levelA;
  const rankB = levelB === null ? Number.POSITIVE_INFINITY : levelB;
  if (rankA !== rankB) {
    return rankA - rankB;
  }
  return String((a && a.name) || "").localeCompare(
    String((b && b.name) || ""),
    normalizeLanguage(language),
    {
      numeric: true,
      sensitivity: "base",
    },
  );
}

/**
 * Step 5.6: heritage pickers list ancestry-bound heritages first, then the
 * universal (`versatile`) ones. Both groups are alphabetical — a heritage
 * describes the character's ancestry and the matching options must be the most
 * obvious choice.
 */
function compareHeritageEntries(ancestry, language) {
  return function (a, b) {
    const groupA =
      normalizeText((a && (a.ancestry || a.ancestryName)) || "") === ancestry ? 0 : 1;
    const groupB =
      normalizeText((b && (b.ancestry || b.ancestryName)) || "") === ancestry ? 0 : 1;
    if (groupA !== groupB) {
      return groupA - groupB;
    }
    return String((a && a.name) || "").localeCompare(
      String((b && b.name) || ""),
      normalizeLanguage(language),
      {
        numeric: true,
        sensitivity: "base",
      },
    );
  };
}

function parseLevelFilter(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (Array.isArray(value)) {
    const levels = value
      .map(function (entry) {
        return Number.parseInt(String(entry), 10);
      })
      .filter(Number.isInteger);
    return levels.length > 0 ? { exact: levels } : null;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return { exact: [value] };
  }
  const text = String(value).trim();
  if (text === "") {
    return null;
  }
  const range = /^(-?\d+)\s*-\s*(-?\d+)$/.exec(text);
  if (range) {
    return {
      min: Number.parseInt(range[1], 10),
      max: Number.parseInt(range[2], 10),
    };
  }
  const exact = Number.parseInt(text, 10);
  return Number.isInteger(exact) ? { exact: [exact] } : null;
}

/**
 * Read-only compendium catalog backed by `<category>.index.json` files.
 *
 * Indexes are loaded into memory when the service is constructed. Full item
 * files (`<category>.json`) are read lazily, cached by mtime, and queried by
 * item id or slug.
 */
class CatalogService {
  constructor(options) {
    const opts = options || {};
    this.directory = opts.directory
      ? path.resolve(opts.directory)
      : path.join(__dirname, "..", "..", "data", "compendiums");

    /**
     * Step 6.5: category -> language -> catalog. Files are named
     * `<category>.<lang>.index.json`; legacy `<category>.index.json` files are
     * kept under the `legacy` key as a fallback for old builds.
     *
     * @type {Map<string, Map<string, {id:string, lang:string, file:string, fullFile:string, entries:object[]}>>}
     */
    this._indexes = new Map();
    /** @type {Map<string, {mtimeMs:number, size:number, items:object[], byId:Map<string,object>, bySlug:Map<string,object>}>} */
    this._itemCache = new Map();

    this._loadIndexes();
  }

  _ensureDirectory() {
    if (!fs.existsSync(this.directory)) {
      fs.mkdirSync(this.directory, { recursive: true });
    }
  }

  _loadIndexes() {
    this._ensureDirectory();
    this._indexes.clear();

    const entries = fs.readdirSync(this.directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(INDEX_SUFFIX)) {
        continue;
      }

      const fileBase = entry.name.slice(0, -INDEX_SUFFIX.length);
      let language = LEGACY_LANGUAGE;
      let categoryBase = fileBase;
      const localized = /^(.+)\.(en|ru)$/i.exec(fileBase);
      if (localized) {
        categoryBase = localized[1];
        language = localized[2].toLowerCase();
      }

      const categoryId = normalizeCategoryId(categoryBase);
      if (!categoryId) {
        continue;
      }

      const indexPath = path.join(this.directory, entry.name);
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      } catch (error) {
        console.warn("Skipping invalid compendium index " + entry.name + ": " + error.message);
        continue;
      }

      if (!Array.isArray(parsed)) {
        console.warn("Skipping compendium index " + entry.name + ": expected an array.");
        continue;
      }

      let byLanguage = this._indexes.get(categoryId);
      if (!byLanguage) {
        byLanguage = new Map();
        this._indexes.set(categoryId, byLanguage);
      }
      byLanguage.set(language, {
        id: categoryId,
        lang: language,
        file: entry.name,
        fullFile:
          categoryId +
          languageFileSuffix(language) +
          ".json",
        entries: parsed,
      });
    }
  }

  /** Drop every cache and re-read the index files from disk. */
  reload() {
    this._itemCache.clear();
    this._loadIndexes();
  }

  /**
   * Resolve a category in the requested language, falling back to a legacy
   * unsuffixed index and then to the other language.
   *
   * @param {string} categoryId
   * @param {string} [lang]
   */
  _findCatalog(categoryId, lang) {
    const id = normalizeCategoryId(categoryId);
    if (id === null) {
      return null;
    }
    const byLanguage = this._indexes.get(id);
    if (!byLanguage) {
      return null;
    }
    const language = normalizeLanguage(lang);
    return (
      byLanguage.get(language) ||
      byLanguage.get(LEGACY_LANGUAGE) ||
      byLanguage.get(language === "ru" ? "en" : "ru") ||
      null
    );
  }

  /** @returns {boolean} */
  hasCategory(categoryId, lang) {
    return this._findCatalog(categoryId, lang) !== null;
  }

  /** @returns {{id:string, lang:string, file:string, fullFile:string, entries:object[]}|null} */
  getCategory(categoryId, lang) {
    return this._findCatalog(categoryId, lang);
  }

  /** @returns {{id:string, name:string, count:number, file:string, lang:string}[]} */
  listCategories(lang) {
    const language = normalizeLanguage(lang);
    const categories = [];
    for (const categoryId of this._indexes.keys()) {
      const catalog = this._findCatalog(categoryId, language);
      if (!catalog) {
        continue;
      }
      categories.push({
        id: catalog.id,
        name: catalog.id.charAt(0).toUpperCase() + catalog.id.slice(1),
        count: catalog.entries.length,
        file: catalog.fullFile,
        lang: catalog.lang,
      });
    }
    categories.sort(function (a, b) {
      return a.id.localeCompare(b.id);
    });
    return categories;
  }

  /** Backwards-compatible alias used by the original server wiring. */
  listCatalogs(lang) {
    return this.listCategories(lang).map(function (category) {
      return {
        id: category.id,
        file: category.file,
        count: category.count,
        lang: category.lang,
      };
    });
  }

  /**
   * Filter an index by name, level, traits or type.
   *
   * Supported filters:
   *   - name / search / q: case-insensitive substring
   *   - level: exact number, "3", or a range "1-5"
   *   - minLevel / maxLevel: inclusive bounds
   *   - traits: string or string[]; all traits must match unless traitMode/any
   *   - traitMode: "all" (default) or "any"
   *   - type: exact match
   *   - rarity: string or string[] of `system.traits.rarity` values
   *   - itemTypes: string or string[] of document `type` values
   *   - armorCategories / weaponCategories: string or string[] of
   *     `system.category` values for armor/weapon documents
   *   - priceMin / priceMax: price string ("5 зм", "10 см", "4 gp") or a
   *     number of gold pieces, compared in copper pieces
   *   - limit, offset: optional pagination (no default limit)
   *
   * Step 6.6: every active filter is combined with AND; values inside one
   * checkbox group are combined with OR.
   *
   * @param {string} categoryId
   * @param {object} [filters]
   * @param {string} [lang]
   * @returns {object[]}
   */
  getIndex(categoryId, filters, lang) {
    const catalog = this.getCategory(categoryId, lang);
    if (!catalog) {
      return [];
    }
    this._hydrateFilterFields(catalog, filters);
    return CatalogService.filterIndex(
      catalog.entries,
      filters,
      categoryId,
      catalog.lang,
    );
  }

  /**
   * Step 6.7: distinct trait tags for the filter palette. `filters.type`
   * narrows the bestiary (`npc`) without touching the actual result list.
   *
   * @param {string} categoryId
   * @param {{type?: string}} [filters]
   * @param {string} [lang]
   * @returns {string[]}
   */
  listTraits(categoryId, filters, lang) {
    const catalog = this.getCategory(categoryId, lang);
    if (!catalog) {
      return [];
    }
    const opts = filters || {};
    return collectCatalogTraits(catalog.entries, opts.type);
  }

  /**
   * Step 6.6: older index files only stored id/name/type/level/traits. When a
   * request filters on rarity/category/price, backfill those compact fields
   * from the cached full document so the filters still run on the index before
   * pagination. Newer builds write the fields directly into the index.
   */
  _hydrateFilterFields(catalog, filters) {
    const opts = filters || {};
    const needsRarity = hasFilterValue(opts.rarity) || hasFilterValue(opts.rarities);
    const needsCategory =
      hasFilterValue(opts.armorCategories) ||
      hasFilterValue(opts.armorCategory) ||
      hasFilterValue(opts.weaponCategories) ||
      hasFilterValue(opts.weaponCategory);
    const needsPrice =
      hasFilterValue(opts.priceMin) || hasFilterValue(opts.priceMax);
    // Step 6.7: spell/bestiary/feat accordions need fields that the compact
    // index does not always store.
    const needsTraditions =
      hasFilterValue(opts.traditions) || hasFilterValue(opts.tradition);
    const needsSpellCategory =
      hasFilterValue(opts.spellCategories) ||
      hasFilterValue(opts.spellCategory);
    const needsSize = hasFilterValue(opts.sizes) || hasFilterValue(opts.size);
    const needsFeatCategory =
      hasFilterValue(opts.featCategories) ||
      hasFilterValue(opts.featCategory);
    const needsSkills = hasFilterValue(opts.skills) || hasFilterValue(opts.skill);

    if (
      !needsRarity &&
      !needsCategory &&
      !needsPrice &&
      !needsTraditions &&
      !needsSpellCategory &&
      !needsSize &&
      !needsFeatCategory &&
      !needsSkills
    ) {
      return;
    }
    if (catalog.filterFieldsLoaded) {
      return;
    }

    const indexComplete =
      (!needsRarity || indexHasField(catalog.entries, "rarity")) &&
      (!needsCategory || indexHasField(catalog.entries, "category")) &&
      (!needsPrice || indexHasField(catalog.entries, "price")) &&
      (!needsTraditions || indexHasField(catalog.entries, "traditions")) &&
      (!needsSpellCategory ||
        indexHasField(catalog.entries, "spellCategory")) &&
      (!needsSize || indexHasField(catalog.entries, "size")) &&
      (!needsFeatCategory ||
        indexHasField(catalog.entries, "featCategory")) &&
      (!needsSkills || indexHasField(catalog.entries, "skills"));
    if (indexComplete) {
      // Do not mark the whole catalogue as hydrated: a later request may need
      // fields this index still lacks.
      return;
    }

    const record = this._loadItems(catalog.id, catalog.lang);
    if (!record) {
      catalog.filterFieldsLoaded = true;
      return;
    }

    for (const entry of catalog.entries) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const full = record.byId.get(String(entry.id));
      if (!full) {
        continue;
      }
      if (entry.rarity === undefined || entry.rarity === null) {
        const rarity = readEntryRarity(full);
        if (rarity !== null) {
          entry.rarity = rarity;
        }
      }
      if (entry.category === undefined || entry.category === null) {
        const category = readEntryCategory(full);
        if (category !== null) {
          entry.category = category;
        }
      }
      if (entry.price === undefined || entry.price === null) {
        const systemPrice =
          full.system && full.system.price !== undefined
            ? full.system.price
            : null;
        if (systemPrice !== null) {
          entry.price = systemPrice;
        }
      }
      if (entry.traditions === undefined || entry.traditions === null) {
        const traditions = readEntryTraditions(full);
        if (traditions.length > 0) {
          entry.traditions = traditions;
        }
      }
      if (entry.spellCategory === undefined || entry.spellCategory === null) {
        const spellCategory = readEntrySpellCategory(full);
        if (spellCategory !== null) {
          entry.spellCategory = spellCategory;
        }
      }
      if (entry.size === undefined || entry.size === null) {
        const size = readEntrySize(full);
        if (size !== null) {
          entry.size = size;
        }
      }
      if (
        entry.featCategory === undefined ||
        entry.featCategory === null
      ) {
        const featCategory = readEntryFeatCategory(full);
        if (featCategory !== null) {
          entry.featCategory = featCategory;
        }
      }
      if (entry.skills === undefined || entry.skills === null) {
        const skills = readEntrySkills(full);
        if (skills.length > 0) {
          entry.skills = skills;
        }
      }
    }

    catalog.filterFieldsLoaded = true;
  }

  static filterIndex(entries, filters, categoryId, lang) {
    const opts = filters || {};
    const language = normalizeLanguage(lang);
    const nameFilter = isNonEmptyString(opts.name)
      ? opts.name
      : isNonEmptyString(opts.search)
        ? opts.search
        : isNonEmptyString(opts.q)
          ? opts.q
          : null;
    const normalizedName = nameFilter === null ? null : normalizeText(nameFilter);

    // `ranks` is the UI name for spell levels; accept it directly as well as
    // the HTTP layer's normalization to `level`.
    const levelFilter = parseLevelFilter(
      opts.level !== undefined
        ? opts.level
        : opts.ranks !== undefined
          ? opts.ranks
          : opts.levels !== undefined
            ? opts.levels
            : opts.rank,
    );
    const minLevel = readInteger(opts.minLevel);
    const maxLevel = readInteger(opts.maxLevel);
    const traits = normalizeTraitsFilter(
      opts.traits !== undefined ? opts.traits : opts.trait,
    );
    const traitMode = String(opts.traitMode || opts.match || "").toLowerCase() === "any"
      ? "any"
      : "all";
    const type = isNonEmptyString(opts.type) ? opts.type.trim().toLowerCase() : null;
    const rarities = normalizeFilterList(
      opts.rarity !== undefined ? opts.rarity : opts.rarities,
    );
    const itemTypes = normalizeFilterList(
      opts.itemTypes !== undefined ? opts.itemTypes : opts.itemType,
    );
    const armorCategories = normalizeFilterList(
      opts.armorCategories !== undefined
        ? opts.armorCategories
        : opts.armorCategory,
    );
    const weaponCategories = normalizeFilterList(
      opts.weaponCategories !== undefined
        ? opts.weaponCategories
        : opts.weaponCategory,
    );
    // Step 6.7: advanced compendium filters. `traitsIn` requires every tag and
    // `traitsOut` rejects any matching tag.
    const traitsIn = normalizeFilterList(opts.traitsIn);
    const traitsOut = normalizeFilterList(opts.traitsOut);
    const spellCategories = normalizeFilterList(
      opts.spellCategories !== undefined
        ? opts.spellCategories
        : opts.spellCategory,
    );
    const traditions = normalizeFilterList(
      opts.traditions !== undefined ? opts.traditions : opts.tradition,
    );
    const sizes = normalizeFilterList(
      opts.sizes !== undefined ? opts.sizes : opts.size,
    );
    const featCategories = normalizeFilterList(
      opts.featCategories !== undefined
        ? opts.featCategories
        : opts.featCategory,
    );
    const skills = normalizeFilterList(
      opts.skills !== undefined ? opts.skills : opts.skill,
    );
    const priceMin = parsePriceToCp(opts.priceMin);
    const priceMax = parsePriceToCp(opts.priceMax);
    const ancestry = isNonEmptyString(opts.ancestry) ? normalizeText(opts.ancestry) : null;
    const includeVersatile =
      opts.includeVersatile === true ||
      String(opts.includeVersatile || "").toLowerCase() === "1" ||
      String(opts.includeVersatile || "").toLowerCase() === "true";
    const versatileOnly =
      opts.versatile === true ||
      String(opts.versatile || "").toLowerCase() === "1" ||
      String(opts.versatile || "").toLowerCase() === "true";
    const limit = readNonNegativeInteger(opts.limit);
    const offset = readNonNegativeInteger(opts.offset);

    let result = entries.filter(function (entry) {
      if (!entry || typeof entry !== "object") {
        return false;
      }

      if (versatileOnly && entry.versatile !== true) {
        return false;
      }

      if (ancestry !== null) {
        const entryAncestry = normalizeText(entry.ancestry || "");
        const entryAncestryName = normalizeText(entry.ancestryName || "");
        const isVersatile = entry.versatile === true;
        const matchesAncestry =
          entryAncestry === ancestry || entryAncestryName === ancestry;
        if (!matchesAncestry && !(includeVersatile && isVersatile)) {
          return false;
        }
      }

      if (normalizedName !== null) {
        if (!isNonEmptyString(entry.name) || !normalizeText(entry.name).includes(normalizedName)) {
          return false;
        }
      }

      const level = readEntryLevel(entry);
      if (levelFilter !== null) {
        if (level === null) {
          return false;
        }
        if (levelFilter.exact && levelFilter.exact.indexOf(level) === -1) {
          return false;
        }
        if (levelFilter.min !== undefined && level < levelFilter.min) {
          return false;
        }
        if (levelFilter.max !== undefined && level > levelFilter.max) {
          return false;
        }
      }
      if (minLevel !== null && (level === null || level < minLevel)) {
        return false;
      }
      if (maxLevel !== null && (level === null || level > maxLevel)) {
        return false;
      }

      if (traits.length > 0 || traitsIn.length > 0 || traitsOut.length > 0) {
        const entryTraits = readEntryTraits(entry);
        if (traits.length > 0) {
          const matches =
            traitMode === "any"
              ? traits.some(function (trait) {
                  return entryTraits.indexOf(trait) !== -1;
                })
              : traits.every(function (trait) {
                  return entryTraits.indexOf(trait) !== -1;
                });
          if (!matches) {
            return false;
          }
        }
        // traitsIn: every requested tag must be present (AND).
        if (
          traitsIn.length > 0 &&
          !traitsIn.every(function (trait) {
            return entryTraits.indexOf(trait) !== -1;
          })
        ) {
          return false;
        }
        // traitsOut: no excluded tag may be present.
        if (
          traitsOut.length > 0 &&
          traitsOut.some(function (trait) {
            return entryTraits.indexOf(trait) !== -1;
          })
        ) {
          return false;
        }
      }

      if (spellCategories.length > 0) {
        const spellCategory = readEntrySpellCategory(entry);
        if (
          spellCategory === null ||
          spellCategories.indexOf(spellCategory) === -1
        ) {
          return false;
        }
      }

      if (traditions.length > 0) {
        const entryTraditions = readEntryTraditions(entry);
        if (
          !traditions.some(function (tradition) {
            return entryTraditions.indexOf(tradition) !== -1;
          })
        ) {
          return false;
        }
      }

      if (sizes.length > 0) {
        const size = readEntrySize(entry);
        if (size === null || sizes.indexOf(size) === -1) {
          return false;
        }
      }

      if (featCategories.length > 0) {
        const featCategory = readEntryFeatCategory(entry);
        if (
          featCategory === null ||
          featCategories.indexOf(featCategory) === -1
        ) {
          return false;
        }
      }

      if (skills.length > 0) {
        const entrySkills = readEntrySkills(entry);
        if (
          !skills.some(function (skill) {
            return entrySkills.indexOf(skill) !== -1;
          })
        ) {
          return false;
        }
      }

      if (type !== null) {
        if (!isNonEmptyString(entry.type) || entry.type.toLowerCase() !== type) {
          return false;
        }
      }

      if (itemTypes.length > 0) {
        if (
          !isNonEmptyString(entry.type) ||
          itemTypes.indexOf(entry.type.trim().toLowerCase()) === -1
        ) {
          return false;
        }
      }

      if (rarities.length > 0) {
        const rarity = readEntryRarity(entry);
        if (rarity === null || rarities.indexOf(rarity) === -1) {
          return false;
        }
      }

      // Step 6.6: armor and weapon category groups are independent AND
      // constraints. Selecting a category from either group pins the document
      // type; selecting from both can never match (an item cannot be both).
      if (armorCategories.length > 0) {
        const entryType = isNonEmptyString(entry.type)
          ? entry.type.trim().toLowerCase()
          : "";
        const category = readEntryCategory(entry);
        if (
          entryType !== "armor" ||
          category === null ||
          armorCategories.indexOf(category) === -1
        ) {
          return false;
        }
      }

      if (weaponCategories.length > 0) {
        const entryType = isNonEmptyString(entry.type)
          ? entry.type.trim().toLowerCase()
          : "";
        const category = readEntryCategory(entry);
        if (
          entryType !== "weapon" ||
          category === null ||
          weaponCategories.indexOf(category) === -1
        ) {
          return false;
        }
      }

      if (priceMin !== null || priceMax !== null) {
        const price = readEntryPriceCp(entry);
        if (price === null) {
          return false;
        }
        if (priceMin !== null && price < priceMin) {
          return false;
        }
        if (priceMax !== null && price > priceMax) {
          return false;
        }
      }

      return true;
    });

    // Step 4.7: sort by level first, then by name. Without this the index
    // file's alphabetical order decided the result and the level filter
    // appeared to be ignored whenever the alphabet disagreed with it.
    if (ancestry !== null) {
      // Step 5.6: ancestry-bound heritages first (alphabetical), universal
      // (versatile) heritages last (alphabetical).
      result.sort(
        categoryId === "heritages"
          ? compareHeritageEntries(ancestry, language)
          : function (a, b) {
              return compareCatalogEntries(a, b, language);
            },
      );
    } else {
      result.sort(function (a, b) {
        return compareCatalogEntries(a, b, language);
      });
    }

    if (offset !== null && offset > 0) {
      result = result.slice(offset);
    }
    if (limit !== null) {
      result = result.slice(0, limit);
    }

    return result;
  }

  _loadItems(categoryId, lang) {
    const catalog = this.getCategory(categoryId, lang);
    if (!catalog) {
      return null;
    }

    const fullPath = path.join(this.directory, catalog.fullFile);
    if (!fs.existsSync(fullPath)) {
      return null;
    }

    const stat = fs.statSync(fullPath);
    const cacheKey = catalog.file;
    const cached = this._itemCache.get(cacheKey);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached;
    }

    let items;
    try {
      items = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    } catch (error) {
      console.warn("Skipping invalid compendium data " + catalog.fullFile + ": " + error.message);
      return null;
    }

    if (!Array.isArray(items)) {
      console.warn("Skipping compendium data " + catalog.fullFile + ": expected an array.");
      return null;
    }

    const byId = new Map();
    const bySlug = new Map();
    for (const item of items) {
      if (!item || typeof item !== "object") {
        continue;
      }
      if (item.id !== undefined && item.id !== null) {
        byId.set(String(item.id), item);
      }
      if (isNonEmptyString(item.slug)) {
        bySlug.set(item.slug, item);
      }
      if (item.system && isNonEmptyString(item.system.slug)) {
        bySlug.set(item.system.slug, item);
      }
    }

    const record = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      items: items,
      byId: byId,
      bySlug: bySlug,
    };
    this._itemCache.set(cacheKey, record);
    return record;
  }

  /**
   * Read the full language-specific `<category>.<lang>.json` file and return a
   * single item by id, falling back to its slug when one is present.
   *
   * @param {string} categoryId
   * @param {string} itemId
   * @param {string} [lang]
   * @returns {object|null}
   */
  getItem(categoryId, itemId, lang) {
    if (!isNonEmptyString(itemId)) {
      return null;
    }
    const record = this._loadItems(categoryId, lang);
    if (!record) {
      return null;
    }
    const key = itemId.trim();
    return record.byId.get(key) || record.bySlug.get(key) || null;
  }

  /**
   * Backwards-compatible full-catalog access. Prefer getIndex() for searches.
   * @returns {{id:string,file:string,entries:object[]}|null}
   */
  getCatalog(categoryId, lang) {
    const catalog = this.getCategory(categoryId, lang);
    if (!catalog) {
      return null;
    }
    const record = this._loadItems(categoryId, lang);
    return {
      id: catalog.id,
      file: catalog.fullFile,
      lang: catalog.lang,
      entries: record ? record.items : [],
    };
  }

  /** @returns {object|null} */
  getEntry(categoryId, itemId, lang) {
    return this.getItem(categoryId, itemId, lang);
  }
}

module.exports = {
  CatalogService,
  normalizeCategoryId,
  normalizeLanguage,
  normalizeTraitsFilter,
  parsePriceToCp,
  readEntryCategory,
  readEntryFeatCategory,
  readEntryPriceCp,
  readEntryRarity,
  readEntrySize,
  readEntrySkills,
  readEntrySpellCategory,
  readEntryTraditions,
  readEntryTraits,
  collectCatalogTraits,
  CATALOG_SKILL_KEYS,
  PRICE_UNITS_IN_CP,
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
};
