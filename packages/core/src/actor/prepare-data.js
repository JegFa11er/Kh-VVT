"use strict";

/**
 * Step 4.8.1: PF2e Remastered actor preparation pipeline.
 *
 * This module is deliberately free of DOM / React / network dependencies. Both
 * the server test-suite and the web client call it so the character sheet can
 * never drift from the canonical rules math.
 *
 * Remastered attribute model
 * --------------------------
 * PF2e Remastered uses *pure* attribute modifiers (+0, +1, +2, ...) and does
 * not derive them from an ability score. `actor.system.abilities[attr].mod` is
 * therefore the source of truth. The old `floor((score - 10) / 2)` formula is
 * only kept inside `normalizeCharacterSystem` as a one-time migration for
 * payloads created before this slice; it is never used for live math.
 */

const ABILITY_KEYS = Object.freeze(["str", "dex", "con", "int", "wis", "cha"]);

const SAVE_DEFINITIONS = Object.freeze([
  Object.freeze({ key: "fortitude", ability: "con" }),
  Object.freeze({ key: "reflex", ability: "dex" }),
  Object.freeze({ key: "will", ability: "wis" }),
]);

const SKILL_DEFINITIONS = Object.freeze([
  Object.freeze({ key: "acrobatics", ability: "dex" }),
  Object.freeze({ key: "arcana", ability: "int" }),
  Object.freeze({ key: "athletics", ability: "str" }),
  Object.freeze({ key: "crafting", ability: "int" }),
  Object.freeze({ key: "deception", ability: "cha" }),
  Object.freeze({ key: "diplomacy", ability: "cha" }),
  Object.freeze({ key: "intimidation", ability: "cha" }),
  Object.freeze({ key: "medicine", ability: "wis" }),
  Object.freeze({ key: "nature", ability: "wis" }),
  Object.freeze({ key: "occultism", ability: "int" }),
  Object.freeze({ key: "performance", ability: "cha" }),
  Object.freeze({ key: "religion", ability: "wis" }),
  Object.freeze({ key: "society", ability: "int" }),
  Object.freeze({ key: "stealth", ability: "dex" }),
  Object.freeze({ key: "survival", ability: "wis" }),
  Object.freeze({ key: "thievery", ability: "dex" }),
]);

const SPEED_KEYS = Object.freeze(["land", "burrow", "climb", "fly", "swim"]);
const FEAT_SECTION_IDS = Object.freeze([
  "ancestry",
  "heritage",
  "class",
  "skill",
  "general",
  "bonus",
]);
const ATTACK_KEYS = Object.freeze(["simple", "martial", "advanced", "unarmed"]);
const DEFENSE_KEYS = Object.freeze(["unarmored", "light", "medium", "heavy"]);
const CARRIED_VALUES = Object.freeze(["held", "worn", "stowed"]);
const ARMOR_CATEGORIES = Object.freeze(["unarmored", "light", "medium", "heavy"]);

/**
 * Step 4.8.3: physical inventory lives in `actor.items`, exactly like Foundry.
 * Everything else (`feat`, `action`, `spellcastingEntry`, `ancestry`, `class`,
 * `spell`, `condition`, ...) is a non-physical document and is excluded from
 * Bulk / armor / strike preparation.
 */
const PHYSICAL_ITEM_TYPES = Object.freeze([
  "weapon",
  "armor",
  "shield",
  "equipment",
  "consumable",
  "ammo",
  "backpack",
  "kit",
  "treasure",
  // The manual item editor exposes "misc" for generic gear.
  "misc",
]);

const HANDS_USAGE = Object.freeze({
  worngloves: 0,
  "held-in-one-hand": 1,
  "held-in-one-plus-hands": 1,
  "held-in-two-hands": 2,
});

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function asObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function clone(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function splitTraitList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function signed(value) {
  const number = asNumber(value, 0);
  return (number >= 0 ? "+" : "") + number;
}

function roundBulk(value) {
  return Math.round(asNumber(value, 0) * 10) / 10;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "feature";
}

function clampRank(value) {
  const rank = Math.trunc(asNumber(value, 0));
  return Math.max(0, Math.min(4, rank));
}

function rankOf(value) {
  if (value !== null && typeof value === "object") {
    return clampRank(value.rank !== undefined ? value.rank : value.value);
  }
  return clampRank(value);
}

function maxRank(a, b) {
  return Math.max(clampRank(a), clampRank(b));
}

/** Skills whose checks the reference implementation marks as `armor` skills. */
const ARMOR_SKILL_KEYS = Object.freeze([
  "acrobatics",
  "athletics",
  "stealth",
  "thievery",
]);

/**
 * Foundry feat categories mapped onto the sheet's feat groups. The compendium
 * also uses the legacy `classfeature`/`ancestryfeature` spellings.
 */
const FEAT_CATEGORY_SECTIONS = Object.freeze({
  ancestry: "ancestry",
  ancestryfeature: "ancestry",
  heritage: "heritage",
  class: "class",
  classfeature: "class",
  skill: "skill",
  general: "general",
  bonus: "bonus",
});

/** Split a damage formula into dice/expression and a trailing static bonus. */
function stripStaticDamageBonus(value) {
  const formula = typeof value === "string" ? value.trim() : "";
  if (formula === "") {
    return "";
  }
  return formula.replace(/\s*[+-]\s*\d+\s*$/, "").trim() || formula;
}

function isPhysicalItemType(type) {
  return PHYSICAL_ITEM_TYPES.includes(asString(type).toLowerCase());
}

function normalizeCarried(item) {
  const raw = asString(item && item.carried).toLowerCase();
  if (CARRIED_VALUES.includes(raw)) {
    return raw;
  }
  // Foundry stores the carry state on `system.equipped.carryType`; dropping a
  // compendium document keeps that shape until the sheet writes a flat
  // `carried` field back.
  const carryType = asString(
    asObject(item && item.system).equipped &&
      asObject(item.system).equipped.carryType,
  ).toLowerCase();
  if (CARRIED_VALUES.includes(carryType)) {
    return carryType;
  }
  // Legacy payloads used a boolean `equipped` flag. Armor that was equipped is
  // worn; every other equipped item is held; everything else is stowed.
  if (item && item.equipped === true) {
    return item.type === "armor" || ARMOR_CATEGORIES.includes(item.category)
      ? "worn"
      : "held";
  }
  return "stowed";
}

/**
 * Foundry represents Light Bulk as `0.1` in `system.bulk.value` and everything
 * else as a plain number. The sheet keeps the human-readable `"L"` marker, so
 * both shapes are normalised here. Ten Light items equal one Bulk.
 */
function parseBulkValue(raw) {
  if (raw === null || raw === undefined || raw === "") {
    return 0;
  }
  if (typeof raw === "string") {
    const text = raw.trim().toUpperCase();
    if (text === "L" || text === "Л") {
      return "L";
    }
    if (text === "-" || text === "") {
      return 0;
    }
  }
  const number = Number(raw);
  if (!Number.isFinite(number)) {
    return 0;
  }
  if (number > 0 && number <= 0.1) {
    return "L";
  }
  return Math.max(0, Math.round(number * 10) / 10);
}

function readBulk(item, system) {
  const topLevel = item.bulk !== undefined ? item.bulk : item.system?.bulk;
  if (topLevel !== undefined) {
    return parseBulkValue(
      topLevel !== null && typeof topLevel === "object" ? topLevel.value : topLevel,
    );
  }
  return parseBulkValue(
    system.bulk !== null && typeof system.bulk === "object"
      ? system.bulk.value
      : system.bulk,
  );
}

function traitListFrom(item, system) {
  const source =
    item.traits !== undefined && item.traits !== null
      ? item.traits
      : system.traits !== undefined && system.traits !== null
        ? system.traits.value !== undefined
          ? system.traits.value
          : system.traits
        : [];
  if (Array.isArray(source)) {
    return source
      .map((trait) => String(trait || "").trim().toLowerCase())
      .filter(Boolean);
  }
  return splitTraitList(source);
}

function readWeaponDamageNode(item, system) {
  const candidates = [
    system.damage,
    asObject(system.weapon).damage,
    item.damage,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") {
      const die = asString(candidate.die);
      if (die !== "") {
        return {
          dice: Math.max(1, Math.trunc(asNumber(candidate.dice, 1))),
          die,
          damageType: asString(candidate.damageType, "untyped"),
        };
      }
    }
  }
  return null;
}

function damageFormulaFrom(item, system, damageNode) {
  const explicit =
    typeof item.baseDamage === "string" && item.baseDamage.trim() !== ""
      ? item.baseDamage.trim()
      : typeof item.damage === "string" && item.damage.trim() !== ""
        ? item.damage.trim()
        : typeof asObject(system.weapon).formula === "string"
          ? asObject(system.weapon).formula.trim()
          : "";
  if (explicit !== "") {
    return explicit;
  }
  if (damageNode) {
    const sides = String(damageNode.die || "").replace(/^d/i, "");
    return asNumber(damageNode.dice, 1) + "d" + sides;
  }
  return "";
}

function staticDamageBonus(value) {
  const formula = typeof value === "string" ? value.trim() : "";
  const match = /([+-])\s*(\d+)\s*$/.exec(formula);
  if (!match) {
    return 0;
  }
  return (match[1] === "-" ? -1 : 1) * Number(match[2]);
}

function readHandsHeld(item, type, traits, system) {
  const explicit =
    item.handsHeld !== undefined && item.handsHeld !== null
      ? item.handsHeld
      : asObject(system.equipped).handsHeld;
  if (explicit !== undefined && explicit !== null && explicit !== "") {
    return Math.max(0, Math.min(2, Math.trunc(asNumber(explicit, 0))));
  }
  const usage = asString(
    system.usage !== undefined ? asObject(system.usage).value : item.usage,
  ).trim();
  if (HANDS_USAGE[usage] !== undefined) {
    return HANDS_USAGE[usage];
  }
  if (traits.includes("two-hand") || traits.includes("two-handed")) {
    return 2;
  }
  return type === "weapon" || type === "shield" ? 1 : 0;
}

function isRangedWeapon(type, traits, system, item) {
  if (type !== "weapon") {
    return false;
  }
  if (item.ranged === true) {
    return true;
  }
  if (traits.includes("ranged")) {
    return true;
  }
  const range = system.range !== undefined ? system.range : item.range;
  if (range && typeof range === "object" && asNumber(range.increment, 0) > 0) {
    return true;
  }
  return asNumber(range, 0) > 0;
}

/**
 * Normalise a physical document (compendium drop or legacy inventory row) into
 * the flat shape used by the sheet, `prepareStrikes` and Bulk math. The raw
 * Foundry `system` payload is preserved so no compendium data is lost.
 */
function normalizePhysicalItem(item, index) {
  const source = asObject(item);
  const system = asObject(source.system);
  const type = asString(source.type, "equipment");
  const traits = traitListFrom(source, system);
  const damageNode = readWeaponDamageNode(source, system);
  const category =
    typeof source.category === "string"
      ? source.category
      : typeof system.category === "string"
        ? system.category
        : null;
  const weaponCategory = ATTACK_KEYS.includes(source.weaponCategory)
    ? source.weaponCategory
    : ATTACK_KEYS.includes(category)
      ? category
      : "simple";
  const baseDamage =
    stripStaticDamageBonus(damageFormulaFrom(source, system, damageNode)) ||
    asString(source.baseDamage, "");
  const ranged = isRangedWeapon(type, traits, system, source);
  const runes = asObject(system.runes);
  const potency = Math.max(
    0,
    Math.trunc(asNumber(runes.potency !== undefined ? runes.potency : source.potency, 0)),
  );
  const striking = Math.max(
    0,
    Math.min(
      3,
      Math.trunc(
        asNumber(
          runes.striking !== undefined ? runes.striking : source.striking,
          0,
        ),
      ),
    ),
  );
  const attackBonus = Math.max(
    0,
    asNumber(
      asObject(system.bonus).value !== undefined
        ? asObject(system.bonus).value
        : source.attackBonus,
      0,
    ),
  );
  const damageBonus =
    asNumber(
      asObject(system.bonusDamage).value !== undefined
        ? asObject(system.bonusDamage).value
        : source.damageBonus,
      0,
    ) + staticDamageBonus(damageFormulaFrom(source, system, damageNode));
  const dexCapValue =
    source.dexCap !== undefined && source.dexCap !== null
      ? source.dexCap
      : system.dexCap;

  return {
    ...clone(source),
    id: typeof source.id === "string" ? source.id : "item-" + (index + 1),
    name: source.name,
    type,
    img: asString(source.img) || null,
    level: Math.trunc(asNumber(source.level, asNumber(system.level?.value, 0))),
    quantity: Math.max(
      1,
      Math.trunc(
        asNumber(source.quantity, asNumber(system.quantity, 1)),
      ),
    ),
    bulk: readBulk(source, system),
    carried: normalizeCarried(source),
    equipped:
      normalizeCarried(source) === "held" ||
      normalizeCarried(source) === "worn",
    invested: Boolean(source.invested),
    handsHeld: readHandsHeld(source, type, traits, system),
    category,
    weaponCategory,
    acBonus: Math.max(
      0,
      asNumber(
        source.acBonus !== undefined ? source.acBonus : system.acBonus,
        0,
      ),
    ),
    dexCap:
      dexCapValue === null || dexCapValue === undefined
        ? null
        : Math.max(0, asNumber(dexCapValue, 0)),
    strength:
      (source.strength !== undefined ? source.strength : system.strength) ===
        null ||
      (source.strength !== undefined ? source.strength : system.strength) ===
        undefined
        ? null
        : asNumber(
            source.strength !== undefined ? source.strength : system.strength,
            0,
          ),
    checkPenalty: Math.min(
      0,
      asNumber(
        source.checkPenalty !== undefined
          ? source.checkPenalty
          : system.checkPenalty,
        0,
      ),
    ),
    speedPenalty: Math.min(
      0,
      asNumber(
        source.speedPenalty !== undefined
          ? source.speedPenalty
          : system.speedPenalty,
        0,
      ),
    ),
    damage: baseDamage,
    baseDamage,
    damageType: asString(
      source.damageType,
      damageNode ? damageNode.damageType : "untyped",
    ),
    traits: traits.join(", "),
    ranged,
    attackBonus,
    damageBonus,
    potency,
    striking,
    range:
      system.range !== undefined || source.range !== undefined
        ? system.range !== undefined
          ? system.range
          : source.range
        : null,
    container: asString(source.containerId || source.container),
    armor: Object.keys(asObject(source.armor)).length > 0 ? asObject(source.armor) : null,
    system,
  };
}

function physicalActorItems(rawItems) {
  return asArray(rawItems)
    .filter(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        typeof item.name === "string" &&
        isPhysicalItemType(item.type),
    )
    .map(normalizePhysicalItem);
}

/**
 * Merge legacy `system.inventory.items` rows into `actor.items`.
 *
 * Step 4.8.1 stored physical items on `actor.system.inventory.items`; Step
 * 4.8.3 moves them to `actor.items` (Foundry's document collection). The actor
 * collection always wins on an id collision because the Inventory tab updates
 * it directly.
 */
function mergePhysicalActorItems(actorItems, legacyItems) {
  const merged = [];
  const seen = new Set();
  for (const item of [
    ...asArray(actorItems).filter(
      (entry) => entry && typeof entry === "object" && typeof entry.name === "string",
    ),
    ...physicalActorItems(legacyItems),
  ]) {
    const id = typeof item.id === "string" ? item.id : "";
    if (id !== "" && seen.has(id)) {
      continue;
    }
    if (id !== "") {
      seen.add(id);
    }
    merged.push(item);
  }
  return merged;
}

/**
 * Build the persisted actor-item document for a compendium item.
 *
 * The description and publication blocks are the bulk of a Foundry document;
 * they are trimmed so a full inventory fits the server's 256 KB actor payload
 * cap while every mechanical field (damage, runes, bulk, traits, usage) is
 * preserved verbatim.
 */
function createActorItemFromDocument(document, options) {
  const doc = asObject(document);
  const system = clone(asObject(doc.system));
  // Some extracted weapons keep a prepared `weapon` block next to `system`;
  // preserve it as a damage-formula fallback.
  if (!system.weapon && doc.weapon && typeof doc.weapon === "object") {
    system.weapon = clone(doc.weapon);
  }
  const description =
    (typeof system.description === "object"
      ? asString(system.description.value)
      : asString(system.description)) ||
    asString(doc.description);
  delete system.description;
  delete system.publication;
  const opts = asObject(options);
  const id =
    asString(opts.id) ||
    asString(doc.id) ||
    asString(doc.slug) ||
    "item-" + slugify(doc.name);
  const type = asString(doc.type, "equipment");
  const traits = traitListFrom({ traits: doc.traits }, system);
  const handsHeld =
    opts.handsHeld !== undefined
      ? opts.handsHeld
      : readHandsHeld({}, type, traits, system);
  return normalizePhysicalItem(
    {
      id,
      name: asString(doc.name, "Item"),
      type,
      img: asString(doc.img) || null,
      level: Math.trunc(asNumber(doc.level, asNumber(system.level?.value, 0))),
      slug: asString(doc.slug) || null,
      description: description.slice(0, 4000),
      carried: CARRIED_VALUES.includes(asString(opts.carried))
        ? opts.carried
        : "stowed",
      handsHeld,
      quantity: 1,
      system,
    },
    0,
  );
}

// ---------------------------------------------------------------------------
// Defaults / normalisation
// ---------------------------------------------------------------------------

function createDefaultCharacterSystem() {
  return {
    abilities: Object.fromEntries(
      ABILITY_KEYS.map((ability) => [ability, { mod: 0 }]),
    ),
    attributes: {
      hp: { value: 10, max: 10, temp: 0 },
      ac: { value: 10, modifiers: [] },
      shield: {
        hp: { value: 0, max: 0 },
        ac: 0,
        hardness: 0,
        brokenThreshold: 0,
        broken: false,
        destroyed: false,
      },
      immunities: [],
      weaknesses: [],
      resistances: [],
    },
    details: {
      level: { value: 1 },
      xp: { value: 0, max: 1000 },
      age: { value: "" },
      gender: { value: "" },
      ethnicity: { value: "" },
      nationality: { value: "" },
      keyability: { value: "str" },
      ancestry: { value: "" },
      heritage: { value: "" },
      background: { value: "" },
      class: { value: "" },
      deity: { value: "" },
      languages: { value: ["Всеобщий"], details: "" },
      biography: { value: "" },
    },
    traits: { value: [], size: { value: "med" } },
    perception: { rank: 0 },
    initiative: { statistic: "perception" },
    saves: Object.fromEntries(
      SAVE_DEFINITIONS.map((save) => [save.key, { rank: 0 }]),
    ),
    skills: Object.fromEntries(
      SKILL_DEFINITIONS.map((skill) => [skill.key, { rank: 0 }]),
    ),
    lore: [],
    speeds: {
      land: { value: 25 },
      burrow: { value: 0 },
      climb: { value: 0 },
      fly: { value: 0 },
      swim: { value: 0 },
    },
    proficiencies: {
      attacks: {
        simple: { rank: 0 },
        martial: { rank: 0 },
        advanced: { rank: 0 },
        unarmed: { rank: 0 },
      },
      defenses: {
        unarmored: { rank: 0 },
        light: { rank: 0 },
        medium: { rank: 0 },
        heavy: { rank: 0 },
      },
      spellcasting: { rank: 0 },
    },
    strikes: [
      {
        id: "strike-unarmed",
        name: "Без оружия",
        attack: 0,
        damage: "1d4",
        damageType: "bludgeoning",
        traits: "agile, finesse, nonlethal, unarmed",
      },
    ],
    inventory: {
      coins: { pp: 0, gp: 0, sp: 0, cp: 0 },
      items: [],
    },
    actions: { encounter: [], exploration: [], downtime: [] },
    spells: [],
    feats: {
      ancestry: [],
      heritage: [],
      class: [],
      skill: [],
      general: [],
      bonus: [],
    },
    featSlots: [],
    conditions: [],
    effects: [],
    // Step 4.8.2: persistent record of the ability-builder grid. The derived
    // modifiers live in `abilities`; this object only remembers how they were
    // distributed so the builder can be reopened without losing the layout.
    build: {
      manual: false,
      boosts: {
        ancestry: [],
        background: [],
        class: null,
        levels: {},
      },
      flaws: { ancestry: [] },
    },
  };
}

function mergeKnown(defaults, source) {
  const target = Array.isArray(defaults) ? [...defaults] : { ...defaults };
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    return target;
  }
  if (Array.isArray(defaults)) {
    return asArray(source);
  }
  for (const key of Object.keys(source)) {
    const incoming = source[key];
    if (
      key in defaults &&
      defaults[key] !== null &&
      typeof defaults[key] === "object" &&
      !Array.isArray(defaults[key])
    ) {
      target[key] = mergeKnown(defaults[key], incoming);
    } else {
      target[key] = incoming;
    }
  }
  return target;
}

function normalizeProficiencies(raw) {
  const source = asObject(raw);
  const attacks = asObject(source.attacks);
  const defenses = asObject(source.defenses);
  return {
    attacks: Object.fromEntries(
      ATTACK_KEYS.map((key) => [key, { rank: rankOf(attacks[key]) }]),
    ),
    defenses: Object.fromEntries(
      DEFENSE_KEYS.map((key) => [key, { rank: rankOf(defenses[key]) }]),
    ),
    spellcasting: { rank: rankOf(source.spellcasting) },
  };
}

function normalizeInventoryItem(item, index) {
  // Legacy inventory rows use the same flat contract as actor.items. The
  // conversion is shared so `system.inventory.items` and `actor.items` can
  // never disagree about Bulk, hands or weapon damage.
  return normalizePhysicalItem(item, index);
}

/**
 * Coerce persisted actor data into the sheet contract without discarding extras.
 *
 * Attribute modifiers are authoritative. Score-only payloads are migrated once
 * so existing saved characters keep working; the formula is not used anywhere
 * else in the pipeline.
 */
function normalizeCharacterSystem(raw) {
  const defaults = createDefaultCharacterSystem();
  const source = asObject(raw);
  const system = mergeKnown(defaults, source);

  system.abilities = Object.fromEntries(
    ABILITY_KEYS.map((ability) => {
      const entry = asObject(asObject(source.abilities)[ability]);
      let mod = Number(entry.mod);
      if (!Number.isFinite(mod)) {
        const score = Number(entry.score);
        // One-time migration only: legacy payloads stored ability scores.
        mod = Number.isFinite(score) ? Math.floor((score - 10) / 2) : 0;
      }
      return [ability, { mod: Math.trunc(mod) }];
    }),
  );

  system.attributes = asObject(system.attributes);
  system.attributes.hp = {
    value: asNumber(system.attributes.hp?.value, 10),
    max: asNumber(system.attributes.hp?.max, 10),
    temp: asNumber(system.attributes.hp?.temp, 0),
  };
  system.attributes.ac = {
    value: asNumber(system.attributes.ac?.value, 10),
    modifiers: asArray(system.attributes.ac?.modifiers)
      .filter((entry) => entry && typeof entry === "object")
      .map((entry, index) => ({
        id:
          typeof entry.id === "string"
            ? entry.id
            : "ac-modifier-" + (index + 1),
        name: asString(entry.name, "Модификатор"),
        value: Math.trunc(asNumber(entry.value, 0)),
        type: entry.type === "status" ? "status" : "circumstance",
      }))
      .filter((entry) => entry.value !== 0),
  };
  system.attributes.shield = mergeKnown(
    defaults.attributes.shield,
    asObject(system.attributes.shield),
  );
  system.attributes.immunities = asArray(system.attributes.immunities).filter(
    (entry) => entry && typeof entry.type === "string",
  );
  system.attributes.weaknesses = asArray(system.attributes.weaknesses).filter(
    (entry) => entry && typeof entry.type === "string",
  );
  system.attributes.resistances = asArray(system.attributes.resistances).filter(
    (entry) => entry && typeof entry.type === "string",
  );

  system.details.level = { value: asNumber(system.details.level?.value, 1) };
  system.details.xp = {
    value: asNumber(system.details.xp?.value, 0),
    max: asNumber(system.details.xp?.max, 1000),
  };
  system.details.languages = {
    value: asArray(system.details.languages?.value).filter(
      (entry) => typeof entry === "string",
    ),
    details: asString(system.details.languages?.details),
  };

  system.traits.value = asArray(system.traits.value).filter(
    (entry) => typeof entry === "string",
  );
  system.perception.rank = clampRank(system.perception.rank);
  system.initiative.statistic = asString(
    system.initiative.statistic,
    "perception",
  );

  for (const save of SAVE_DEFINITIONS) {
    system.saves[save.key] = { rank: clampRank(system.saves[save.key]?.rank) };
  }
  system.skills = Object.fromEntries(
    SKILL_DEFINITIONS.map((skill) => {
      const entry = asObject(system.skills[skill.key]);
      return [
        skill.key,
        {
          ...entry,
          rank: clampRank(entry.rank),
          // Step 4.8.4: typed item bonus supplied by feats/equipment. It is a
          // separate bonus type, so it never scales with proficiency.
          itemBonus: asNumber(
            entry.itemBonus !== undefined ? entry.itemBonus : entry.bonus,
            0,
          ),
        },
      ];
    }),
  );

  system.lore = asArray(system.lore)
    .filter((entry) => entry && typeof entry.name === "string")
    .map((entry, index) => ({
      id: typeof entry.id === "string" ? entry.id : "lore-" + (index + 1),
      name: entry.name,
      rank: clampRank(entry.rank),
    }));

  for (const key of SPEED_KEYS) {
    system.speeds[key] = {
      value: asNumber(system.speeds[key]?.value, key === "land" ? 25 : 0),
    };
  }

  system.proficiencies = normalizeProficiencies(
    source.proficiencies !== undefined
      ? source.proficiencies
      : system.proficiencies,
  );

  system.inventory = asObject(system.inventory);
  system.inventory.coins = {
    pp: asNumber(system.inventory.coins?.pp, 0),
    gp: asNumber(system.inventory.coins?.gp, 0),
    sp: asNumber(system.inventory.coins?.sp, 0),
    cp: asNumber(system.inventory.coins?.cp, 0),
  };
  system.inventory.items = asArray(system.inventory.items)
    .filter((item) => item && typeof item.name === "string")
    .map(normalizeInventoryItem);

  system.strikes = asArray(system.strikes)
    .filter((strike) => strike && typeof strike.name === "string")
    .map((strike, index) => ({
      ...clone(strike),
      id: typeof strike.id === "string" ? strike.id : "strike-" + (index + 1),
      name: strike.name,
      attack: asNumber(strike.attack, 0),
      damage: typeof strike.damage === "string" ? strike.damage : "",
      baseDamage:
        typeof strike.baseDamage === "string" && strike.baseDamage.trim() !== ""
          ? strike.baseDamage
          : stripStaticDamageBonus(strike.damage),
      damageType: asString(strike.damageType, "untyped"),
      traits: asString(strike.traits),
      unarmed:
        strike.unarmed === true ||
        strike.id === "strike-unarmed" ||
        splitTraitList(strike.traits).includes("unarmed"),
    }));

  for (const section of ["encounter", "exploration", "downtime"]) {
    system.actions[section] = asArray(system.actions[section])
      .filter((action) => action && typeof action.name === "string")
      .map((action, index) => ({
        ...clone(action),
        id:
          typeof action.id === "string"
            ? action.id
            : section + "-" + (index + 1),
        name: action.name,
        cost: asString(action.cost, "1"),
        traits: asString(action.traits),
        description: asString(action.description),
      }));
  }

  system.spells = asArray(system.spells)
    .filter((spell) => spell && typeof spell.name === "string")
    .map((spell, index) => ({
      ...clone(spell),
      id: typeof spell.id === "string" ? spell.id : "spell-" + (index + 1),
      name: spell.name,
      rank: asString(spell.rank, "1"),
      tradition: asString(spell.tradition, "arcane"),
      actions: asString(spell.actions, "2"),
      prepared: Boolean(spell.prepared),
      description: asString(spell.description),
      entryId: asString(spell.entryId),
    }));

  for (const section of FEAT_SECTION_IDS) {
    system.feats[section] = asArray(system.feats[section])
      .filter((feat) => feat && typeof feat.name === "string")
      .map((feat, index) => ({
        ...clone(feat),
        id:
          typeof feat.id === "string"
            ? feat.id
            : section + "-" + (index + 1),
        name: feat.name,
        level: asNumber(feat.level, 1),
        traits: asString(feat.traits),
        description: asString(feat.description),
        uuid: asString(feat.uuid),
        source: asString(feat.source),
        slotId: asString(feat.slotId),
      }));
  }

  system.featSlots = asArray(system.featSlots)
    .filter((slot) => slot && typeof slot === "object")
    .map((slot, index) => ({
      id: asString(slot.id, "feat-slot-" + (index + 1)),
      type: slot.type === "general" ? "general" : "class",
      level: Math.max(1, Math.trunc(asNumber(slot.level, 1))),
      featId: asString(slot.featId) || null,
    }))
    .sort((a, b) => a.level - b.level || a.type.localeCompare(b.type));

  system.effects = asArray(system.effects)
    .filter((effect) => effect && typeof effect.name === "string")
    .map((effect, index) => ({
      ...clone(effect),
      id: typeof effect.id === "string" ? effect.id : "effect-" + (index + 1),
      name: effect.name,
      description: asString(effect.description),
    }));

  system.conditions = asArray(system.conditions)
    .filter((condition) => condition && typeof condition.value === "string")
    .map((condition, index) => ({
      ...clone(condition),
      id:
        typeof condition.id === "string"
          ? condition.id
          : "condition-" + (index + 1),
      value: condition.value,
      label: asString(condition.label, condition.value),
      value2: asNumber(condition.value2, 0),
    }));

  return system;
}

// ---------------------------------------------------------------------------
// PF2e Remastered math
// ---------------------------------------------------------------------------

/**
 * `src/module/actor/modifiers.ts`: untrained (rank 0) does not add level;
 * trained and above add `level + [0, 2, 4, 6, 8][rank]`.
 */
function proficiencyBonus(level, rank) {
  const clamped = clampRank(rank);
  return (clamped > 0 ? asNumber(level, 1) : 0) + [0, 2, 4, 6, 8][clamped];
}

/** Read the Remastered pure attribute modifier; there is no score formula. */
function abilityMod(system, ability) {
  const entry = asObject(asObject(system.abilities)[ability]);
  return Number.isFinite(Number(entry.mod)) ? Math.trunc(Number(entry.mod)) : 0;
}

/**
 * PF2e Remastered skill modifier:
 *
 *   ability modifier + proficiency (level + rank * 2) + item bonus
 *   + armor check penalty (Str/Dex skills only)
 *
 * The armor check penalty rules mirror `CharacterPF2e#prepareSkills` in
 * `src/module/actor/character/document.ts`: Athletics/Acrobatics ignore the
 * penalty when the armour's Strength requirement is met, Stealth keeps it for
 * noisy armour, and every other Str/Dex skill ignores it once the requirement
 * is met.
 */
function skillModifier(system, skillKey, ability, extraBonus) {
  const rank = clampRank(system.skills?.[skillKey]?.rank);
  const itemBonus = asNumber(
    system.skills?.[skillKey]?.itemBonus !== undefined
      ? system.skills[skillKey].itemBonus
      : system.skills?.[skillKey]?.bonus,
    0,
  );
  return (
    abilityMod(system, ability) +
    proficiencyBonus(system.details?.level?.value, rank) +
    itemBonus +
    asNumber(extraBonus, 0) +
    armorCheckPenaltyForSkill(system, skillKey, ability)
  );
}

function saveModifier(system, save) {
  const entry = SAVE_DEFINITIONS.find((candidate) => candidate.key === save);
  const rank = clampRank(system.saves?.[save]?.rank);
  return (
    abilityMod(system, entry ? entry.ability : "con") +
    proficiencyBonus(system.details?.level?.value, rank)
  );
}

function perceptionModifier(system) {
  return (
    abilityMod(system, "wis") +
    proficiencyBonus(system.details?.level?.value, system.perception?.rank)
  );
}

function initiativeModifier(system) {
  const statistic = system.initiative?.statistic || "perception";
  if (statistic === "perception") {
    return perceptionModifier(system);
  }
  for (const save of SAVE_DEFINITIONS) {
    if (statistic === save.key) {
      return saveModifier(system, save.key);
    }
  }
  const skill = SKILL_DEFINITIONS.find((entry) => entry.key === statistic);
  if (skill) {
    return skillModifier(system, skill.key, skill.ability);
  }
  return perceptionModifier(system);
}

/**
 * The single worn suit of armour, if any. Armour stowed in a backpack or merely
 * held in one hand is treated exactly like no armour.
 */
function wornArmorItem(system) {
  return (
    asArray(system.inventory?.items).find((item) => {
      if (!item || item.carried !== "worn") {
        return false;
      }
      if (item.type === "armor") {
        return true;
      }
      return ARMOR_CATEGORIES.includes(item.category);
    }) || null
  );
}

/**
 * Armour strength requirements are stored in modifier form (`+3`). Legacy or
 * hand-authored payloads may instead carry an ability score (`16`); PF2e armour
 * never requires more than `+5`, so anything above 6 is treated as a score and
 * converted once. Live compendium data is always `+0..+5`.
 */
function normalizeStrengthRequirement(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const raw = asNumber(value, 0);
  return raw > 6 ? Math.floor((raw - 10) / 2) : raw;
}

/**
 * Armor check penalty state for the currently worn armour.
 *
 * `strength` is the armour's Strength requirement in Remastered *modifier*
 * form (e.g. chain mail `+4`), exactly like `wornArmor.system.strength` in
 * `src/module/item/armor/data.ts`.
 */
function armorCheckPenaltyState(system) {
  const armor = wornArmorItem(system);
  const traits = armor ? splitTraitList(armor.traits) : [];
  const requirement =
    armor && armor.strength !== null && armor.strength !== undefined
      ? normalizeStrengthRequirement(armor.strength)
      : null;
  const value = armor ? Math.min(0, asNumber(armor.checkPenalty, 0)) : 0;
  const strengthMod = abilityMod(system, "str");
  return {
    applies: Boolean(armor) && value < 0,
    value,
    armorId: armor ? armor.id : null,
    armorName: armor ? armor.name : null,
    requirement,
    strengthMod,
    strengthMet: requirement === null ? true : strengthMod >= requirement,
    flexible: traits.includes("flexible"),
    noisy: traits.includes("noisy"),
  };
}

/**
 * Penalty applied to one skill, matching the reference predicates:
 * - only Strength/Dexterity skills are affected at all,
 * - Athletics/Acrobatics ignore it when the armour's Strength requirement is
 *   met (or the armour is *flexible*),
 * - Stealth only keeps it for *noisy* armour when the requirement is met,
 * - every other Str/Dex skill ignores it once the requirement is met.
 */
function armorCheckPenaltyForSkill(system, skillKey, ability, state) {
  const acp = state || armorCheckPenaltyState(system);
  const attributes = ability ? [ability] : [];
  const isArmorSkill =
    attributes.some((entry) => entry === "str" || entry === "dex") ||
    ARMOR_SKILL_KEYS.includes(skillKey);
  if (!acp.applies || !isArmorSkill) {
    return 0;
  }
  if (!acp.strengthMet) {
    return acp.value;
  }
  if (skillKey === "acrobatics" || skillKey === "athletics") {
    return 0;
  }
  if (skillKey === "stealth") {
    return acp.noisy ? acp.value : 0;
  }
  return 0;
}

/**
 * PF2e armor class: 10 + Dex modifier (capped by *worn* armor) + the armor's
 * item bonus + proficiency with that armor category.
 *
 * Armor only contributes when `carried === "worn"`. Armor stowed in a backpack
 * or merely held in one hand is treated exactly like no armor.
 */
function armorClassBreakdown(system) {
  const armor = wornArmorItem(system);

  let category = "unarmored";
  let itemBonus = 0;
  let dexCap = null;
  if (armor) {
    if (ARMOR_CATEGORIES.includes(armor.category)) {
      category = armor.category;
    }
    itemBonus = asNumber(armor.acBonus, 0);
    dexCap =
      armor.dexCap === null || armor.dexCap === undefined
        ? null
        : asNumber(armor.dexCap, 0);
  }

  const dexMod = abilityMod(system, "dex");
  const appliedDex = dexCap === null ? dexMod : Math.min(dexMod, dexCap);
  const rank = clampRank(system.proficiencies?.defenses?.[category]?.rank);
  const proficiency = proficiencyBonus(system.details?.level?.value, rank);

  // Temporary custom AC modifiers use the canonical PF2e stacking rules:
  // bonuses of one type do not stack (take the best), penalties of one type do
  // not stack (take the worst), and a bonus and a penalty of the same type are
  // tracked separately.
  const modifiers = asArray(system.attributes?.ac?.modifiers).filter(
    (entry) => entry && Number.isFinite(Number(entry.value)) && Number(entry.value) !== 0,
  );
  const byType = { circumstance: 0, status: 0 };
  for (const type of ["circumstance", "status"]) {
    let bonus = 0;
    let penalty = 0;
    for (const entry of modifiers) {
      const value = Math.trunc(asNumber(entry.value, 0));
      if ((entry.type === "status" ? "status" : "circumstance") !== type) {
        continue;
      }
      if (value > 0) {
        bonus = Math.max(bonus, value);
      } else {
        penalty = Math.min(penalty, value);
      }
    }
    byType[type] = bonus + penalty;
  }
  const circumstance = byType.circumstance;
  const status = byType.status;
  const customBonus = circumstance + status;

  return {
    value: 10 + appliedDex + itemBonus + proficiency + customBonus,
    base: 10,
    dexMod,
    appliedDex,
    dexCap,
    itemBonus,
    proficiency,
    rank,
    category,
    armorName: armor ? armor.name : null,
    modifiers: modifiers.map((entry) => ({
      id: entry.id,
      name: asString(entry.name, "Модификатор"),
      value: Math.trunc(asNumber(entry.value, 0)),
      type: entry.type === "status" ? "status" : "circumstance",
    })),
    circumstance,
    status,
    customBonus,
  };
}

/**
 * Read base HP from the ancestry/class source document.
 *
 * The sheet stores a compact summary on `system.details.ancestry|class`, but
 * actors created by other clients may instead carry the full document inside
 * `actor.items` (`type: "ancestry"` / `type: "class"`). Both paths are
 * supported; the detail summary wins when present.
 */
function sourceBaseHp(system, items, detailKey, itemType) {
  const detail = asObject(system.details?.[detailKey]);
  const detailedHp = Number(detail.hp);

  if (Number.isFinite(detailedHp) && detailedHp > 0) {
    return detailedHp;
  }

  const identifiers = new Set(
    [detail.id, detail.name, detail.value].filter(
      (value) => typeof value === "string" && value.trim() !== "",
    ),
  );
  const item = asArray(items).find((candidate) => {
    if (!candidate || candidate.type !== itemType) {
      return false;
    }
    if (identifiers.size === 0) {
      // No identity on the detail entry: any ancestry/class item is better than
      // nothing when the actor only stores source documents in `items`.
      return true;
    }
    return (
      identifiers.has(candidate.id) ||
      identifiers.has(candidate.name) ||
      identifiers.has(candidate.slug)
    );
  });
  if (!item) {
    return null;
  }

  const itemSystem = asObject(item.system);
  const rawHp =
    itemSystem.hp !== undefined
      ? itemSystem.hp
      : item.hp !== undefined
        ? item.hp
        : null;
  const hp = Number(rawHp);
  return Number.isFinite(hp) && hp > 0 ? hp : null;
}

/**
 * PF2e Remastered maximum HP:
 * `ancestryHP + (classHP + Constitution modifier) * level`.
 *
 * Returns `null` when the actor has not selected both sources yet, so a
 * manually entered maximum is not overwritten by an incomplete formula.
 */
function maxHpBreakdown(system, items) {
  const ancestryHp = sourceBaseHp(system, items, "ancestry", "ancestry");
  const classHp = sourceBaseHp(system, items, "class", "class");
  if (ancestryHp === null || classHp === null) {
    return null;
  }
  const level = Math.max(1, Math.trunc(asNumber(system.details?.level?.value, 1)));
  const conMod = abilityMod(system, "con");
  const max = Math.max(1, ancestryHp + (classHp + conMod) * level);
  return { max, ancestryHp, classHp, conMod, level };
}

function isUnarmedStrike(strike) {
  return (
    strike.unarmed === true ||
    strike.id === "strike-unarmed" ||
    splitTraitList(strike.traits).includes("unarmed")
  );
}

function ensureUnarmedStrike(strikes) {
  const list = asArray(strikes);
  if (list.some(isUnarmedStrike)) {
    return list;
  }
  return [
    ...list,
    {
      id: "strike-unarmed",
      name: "Без оружия",
      attack: 0,
      baseDamage: "1d4",
      damage: "1d4",
      damageType: "bludgeoning",
      traits: "agile, finesse, nonlethal, unarmed",
      unarmed: true,
    },
  ];
}

/**
 * A striking rune adds one damage die per rank (striking / greater / major).
 * A plain `1d6` weapon with `system.runes.striking = 1` therefore rolls `2d6`.
 */
function applyStrikingRune(baseDamage, striking) {
  const extra = Math.max(0, Math.min(3, Math.trunc(asNumber(striking, 0))));
  if (extra === 0) {
    return baseDamage;
  }
  const match = /^(\d+)d(\d+)$/.exec(String(baseDamage || "").trim());
  if (!match) {
    return baseDamage;
  }
  return Number(match[1]) + extra + "d" + match[2];
}

function weaponStrike(item, system) {
  const traits = splitTraitList(item.traits);
  const ranged =
    item.ranged === true ||
    traits.includes("ranged") ||
    asNumber(asObject(item.range).increment, 0) > 0;
  const finesse = traits.includes("finesse");
  const strMod = abilityMod(system, "str");
  // Finesse weapons can use Dexterity for the attack roll; ranged weapons
  // always do. An explicit `system.attribute` override wins, mirroring
  // Foundry's `WeaponPF2e.defaultAttribute`.
  const explicitAttribute = asString(
    item.attribute !== undefined
      ? item.attribute
      : asObject(item.system).attribute,
  ).toLowerCase();
  const attackAbility = ABILITY_KEYS.includes(explicitAttribute)
    ? explicitAttribute
    : ranged || finesse
      ? "dex"
      : "str";
  const attackMod = abilityMod(system, attackAbility);
  const category = ATTACK_KEYS.includes(item.weaponCategory)
    ? item.weaponCategory
    : "simple";
  const proficiency = proficiencyBonus(
    system.details?.level?.value,
    system.proficiencies?.attacks?.[category]?.rank,
  );
  // Potency runes and specific-magic bonuses are both item bonuses: PF2e
  // stacking keeps only the highest of the same type.
  const potency = Math.max(0, Math.trunc(asNumber(item.potency, 0)));
  const itemAttack = Math.max(asNumber(item.attackBonus, 0), potency);
  const baseDamage =
    applyStrikingRune(
      (typeof item.baseDamage === "string" && item.baseDamage.trim() !== ""
        ? item.baseDamage.trim()
        : stripStaticDamageBonus(item.damage)) || "1d6",
      item.striking,
    ) || "1d6";

  let damageBonus;
  if (!ranged) {
    damageBonus = strMod;
  } else if (traits.includes("propulsive")) {
    // Propulsive: add half your Strength modifier, minimum 0.
    damageBonus = Math.max(0, Math.floor(strMod / 2));
  } else if (traits.some((trait) => trait === "thrown" || trait.startsWith("thrown-"))) {
    damageBonus = strMod;
  } else {
    damageBonus = 0;
  }
  damageBonus += asNumber(item.damageBonus, 0);

  const agile = traits.includes("agile");
  const map = agile ? -4 : -5;
  const map2 = agile ? -8 : -10;
  const attack = attackMod + proficiency + itemAttack;

  return {
    id: "strike-weapon-" + item.id,
    itemId: item.id,
    source: "weapon",
    name: item.name,
    img: item.img || null,
    attack,
    attackAbility,
    proficiency,
    itemBonus: itemAttack,
    potency,
    striking: Math.max(0, Math.trunc(asNumber(item.striking, 0))),
    attackMap: attack + map,
    attackMap2: attack + map2,
    map,
    map2,
    agile,
    handsHeld: Math.max(0, Math.trunc(asNumber(item.handsHeld, 0))),
    baseDamage,
    damage: baseDamage + (damageBonus === 0 ? "" : signed(damageBonus)),
    damageBonus,
    damageType: asString(item.damageType, "untyped"),
    traits: asString(item.traits),
    unarmed: false,
  };
}

/**
 * Build the Strikes list for the Combat tab.
 *
 * Only weapons with `carried === "held"` produce a strike. Manually authored
 * strikes are preserved, but authored weapon strikes whose source item is no
 * longer held are removed. The unarmed strike is always available.
 */
function prepareStrikes(system) {
  const items = asArray(system.inventory?.items);
  const itemById = new Map(items.map((item) => [item.id, item]));

  const authored = asArray(system.strikes).filter((strike) => {
    if (strike.source === "weapon" || String(strike.id).startsWith("strike-weapon-")) {
      // Previously generated: regenerate from the current inventory state.
      return false;
    }
    if (strike.itemId) {
      const sourceItem = itemById.get(strike.itemId);
      return Boolean(sourceItem && sourceItem.carried === "held");
    }
    return true;
  });

  const authoredItemIds = new Set(
    authored.map((strike) => strike.itemId).filter(Boolean),
  );
  const weaponStrikes = items
    .filter(
      (item) => item.type === "weapon" && item.carried === "held",
    )
    .filter((item) => !authoredItemIds.has(item.id))
    .map((item) => weaponStrike(item, system));

  const strMod = abilityMod(system, "str");
  const unarmedRank = system.proficiencies?.attacks?.unarmed?.rank || 0;
  const attackBonus =
    strMod + proficiencyBonus(system.details?.level?.value, unarmedRank);
  const strikes = ensureUnarmedStrike([...authored, ...weaponStrikes]);

  return strikes.map((strike) => {
    if (!isUnarmedStrike(strike)) {
      return strike;
    }
    const baseDamage =
      (typeof strike.baseDamage === "string" && strike.baseDamage.trim() !== ""
        ? strike.baseDamage.trim()
        : stripStaticDamageBonus(strike.damage)) || "1d4";
    const agile = splitTraitList(strike.traits).includes("agile");
    return {
      ...strike,
      unarmed: true,
      baseDamage,
      attack: attackBonus,
      attackAbility: "str",
      attackMap: attackBonus + (agile ? -4 : -5),
      attackMap2: attackBonus + (agile ? -8 : -10),
      map: agile ? -4 : -5,
      map2: agile ? -8 : -10,
      agile,
      damage: baseDamage + (strMod === 0 ? "" : signed(strMod)),
      damageBonus: strMod,
    };
  });
}

// ---------------------------------------------------------------------------
// Actor items — class features and spellcasting entries
// ---------------------------------------------------------------------------

function readDocumentDescription(source, system) {
  return (
    (typeof system.description === "object"
      ? asString(system.description.value)
      : asString(system.description)) || asString(source.description)
  );
}

function readDocumentSource(source, system) {
  const node = system.source;
  if (node && typeof node === "object") {
    return asString(node.value);
  }
  return asString(node) || asString(source.source);
}

function normalizeActorItems(rawItems) {
  return asArray(rawItems)
    .filter((item) => item && typeof item === "object" && typeof item.name === "string")
    .map((item, index) => {
      const system = asObject(item.system);
      const traits =
        asString(item.traits) || traitListFrom({ traits: item.traits }, system).join(", ");
      const levelNode = system.level !== undefined ? system.level : item.level;
      const rawLevel =
        levelNode !== null && typeof levelNode === "object"
          ? levelNode.value
          : levelNode;
      return {
        ...clone(item),
        id: typeof item.id === "string" ? item.id : "actor-item-" + (index + 1),
        name: item.name,
        type: typeof item.type === "string" ? item.type : "feat",
        img: asString(item.img) || null,
        level: Math.trunc(asNumber(rawLevel, 1)),
        description:
          asString(item.description) || readDocumentDescription(item, system),
        traits,
        category:
          asString(item.category) || asString(system.category) || null,
        uuid: asString(item.uuid),
        source: asString(item.source) || readDocumentSource(item, system),
        system,
      };
    });
}

/** Read a spell's rank from Foundry (`system.level.value`) or legacy rows. */
function spellRankValue(item) {
  const system = asObject(item && item.system);
  const node =
    system.level !== undefined
      ? system.level
      : system.rank !== undefined
        ? system.rank
        : item && item.level !== undefined
          ? item.level
          : item && item.rank;
  const raw = node !== null && typeof node === "object" ? node.value : node;
  if (raw === "cantrip" || raw === 0 || raw === "0") {
    return 0;
  }
  return Math.max(0, Math.min(10, Math.trunc(asNumber(raw, 1))));
}

/** `system.location.value` is the parent spellcasting-entry document id. */
function spellcastingEntryId(item) {
  const system = asObject(item && item.system);
  const location = system.location;
  if (location !== null && typeof location === "object") {
    return asString(location.value);
  }
  return asString(location) || asString(item && item.entryId);
}

/**
 * Map a Foundry feat category onto one of the sheet's feat sections.
 * `classfeature`/`ancestryfeature` are the legacy compendium spellings.
 */
function featSectionForItem(item) {
  const system = asObject(item && item.system);
  const raw =
    asString(system.category) || asString(item && item.category) || "";
  const category = raw.trim().toLowerCase();
  if (FEAT_CATEGORY_SECTIONS[category]) {
    return FEAT_CATEGORY_SECTIONS[category];
  }
  const traits = splitTraitList(item && item.traits);
  if (traits.includes("heritage")) {
    return "heritage";
  }
  // Class features persisted before Step 4.8.4 have no `system.category` but
  // carry `classId` / the `class` trait.
  if (asString(item && item.classId) || traits.includes("class")) {
    return "class";
  }
  return "bonus";
}

function featRecordFromItem(item, section) {
  const system = asObject(item.system);
  const location = system.location;
  const slotId =
    asString(item.slotId) ||
    (location !== null && typeof location === "object"
      ? asString(location.value)
      : asString(location));
  return {
    id: item.id,
    name: item.name,
    type: "feat",
    img: item.img || null,
    level: Math.trunc(asNumber(item.level, asNumber(system.level?.value, 1))),
    category: featSectionForItem(item),
    section,
    traits: item.traits,
    description: item.description,
    uuid: item.uuid,
    source: asString(item.source) || readDocumentSource(item, system),
    slotId,
  };
}

/**
 * Group `actor.items` feats into the six sheet sections. `actor.items` is the
 * Foundry source of truth; pre-existing `system.feats` rows are kept as a
 * legacy fallback and never duplicated.
 */
function prepareFeatSections(rawItems, existingFeats) {
  const sections = Object.fromEntries(
    FEAT_SECTION_IDS.map((section) => [section, []]),
  );
  const placed = new Set();
  for (const item of asArray(rawItems)) {
    if (!item || item.type !== "feat") {
      continue;
    }
    const section = featSectionForItem(item);
    sections[section].push(featRecordFromItem(item, section));
    placed.add(item.id);
  }
  for (const section of FEAT_SECTION_IDS) {
    for (const legacy of asArray(existingFeats?.[section])) {
      if (!legacy || typeof legacy.name !== "string") {
        continue;
      }
      const id = asString(legacy.id);
      if (id !== "" && placed.has(id)) {
        continue;
      }
      if (id !== "") {
        placed.add(id);
      }
      sections[section].push({ ...clone(legacy), section });
    }
  }
  for (const section of FEAT_SECTION_IDS) {
    sections[section].sort(
      (a, b) => asNumber(a.level, 1) - asNumber(b.level, 1) || a.name.localeCompare(b.name),
    );
  }
  return sections;
}

/**
 * Build the persisted `actor.items` feat document from a compendium document.
 * The `category` field drives the sheet grouping; an optional `slotId` binds
 * the feat to a class/general feat slot created by the class pipeline.
 */
function createActorFeatFromDocument(document, options) {
  const doc = asObject(document);
  const system = clone(asObject(doc.system));
  const description = readDocumentDescription(doc, system);
  delete system.description;
  delete system.publication;
  const opts = asObject(options);
  const id =
    asString(opts.id) ||
    asString(doc.id) ||
    asString(doc.slug) ||
    "feat-" + slugify(doc.name);
  const category =
    asString(system.category) || asString(doc.category) || "bonus";
  const slotId = asString(opts.slotId);
  system.category = category;
  if (slotId !== "") {
    // Foundry stores the feat slot document id in `system.location`.
    system.location = slotId;
  }
  const level = Math.trunc(
    asNumber(system.level?.value, asNumber(doc.level, 1)),
  );
  system.level = { ...asObject(system.level), value: level };
  return {
    id,
    name: asString(doc.name, "Feat"),
    type: "feat",
    img: asString(doc.img) || null,
    level,
    category,
    slotId,
    description: description.slice(0, 6000),
    traits: traitListFrom({ traits: doc.traits }, system).join(", "),
    uuid: asString(doc.uuid) || asString(doc.id),
    source: readDocumentSource(doc, system),
    system,
  };
}

/**
 * Build the persisted `actor.items` spell document from a compendium document.
 * `system.location.value` is the parent spellcasting entry id, matching the
 * reference `SpellPF2e#location` contract.
 */
function createActorSpellFromDocument(document, options) {
  const doc = asObject(document);
  const system = clone(asObject(doc.system));
  const description = readDocumentDescription(doc, system);
  delete system.description;
  delete system.publication;
  const opts = asObject(options);
  const id =
    asString(opts.id) ||
    asString(doc.id) ||
    asString(doc.slug) ||
    "spell-" + slugify(doc.name);
  const entryId = asString(opts.entryId) || spellcastingEntryId({ system });
  const level = spellRankValue({ system, level: doc.level });
  system.level = { ...asObject(system.level), value: level };
  system.location = { ...asObject(system.location), value: entryId };
  return {
    id,
    name: asString(doc.name, "Spell"),
    type: "spell",
    img: asString(doc.img) || null,
    level,
    rank: level,
    entryId,
    description: description.slice(0, 6000),
    traits: traitListFrom({ traits: doc.traits }, system).join(", "),
    uuid: asString(doc.uuid) || asString(doc.id),
    source: readDocumentSource(doc, system),
    system,
  };
}

function prepareActorItems(rawItems, system) {
  const items = normalizeActorItems(rawItems).map((item) => {
    return isPhysicalItemType(item.type) ? normalizePhysicalItem(item) : item;
  });

  const entryStats = new Map();
  const prepared = items.map((item) => {
    if (item.type !== "spellcastingEntry") {
      return item;
    }
    const stats = spellcastingStats(system, item);
    entryStats.set(item.id, stats);
    return {
      ...item,
      spellAttack: stats.spellAttack,
      spellDC: stats.spellDC,
      spellcasting: stats,
      system: {
        ...item.system,
        proficiency: { value: stats.rank },
        attack: stats.spellAttack,
        dc: stats.spellDC,
      },
    };
  });

  return prepared.map((item) => {
    if (item.type !== "spell") {
      return item;
    }
    const entryId = spellcastingEntryId(item);
    const stats = entryStats.get(entryId) || null;
    const rank = spellRankValue(item);
    return {
      ...item,
      entryId,
      rank,
      level: rank,
      spellAttack: stats ? stats.spellAttack : null,
      spellDC: stats ? stats.spellDC : null,
      system: {
        ...item.system,
        level: { ...asObject(item.system.level), value: rank },
        location: { ...asObject(item.system.location), value: entryId },
      },
    };
  });
}

function spellcastingRank(entry, system) {
  const sc = asObject(entry.system);
  const explicit =
    sc.proficiency !== undefined
      ? sc.proficiency
      : sc.proficiencyRank !== undefined
        ? sc.proficiencyRank
        : undefined;
  if (explicit !== undefined) {
    return clampRank(
      explicit !== null && typeof explicit === "object"
        ? explicit.value !== undefined
          ? explicit.value
          : explicit.rank
        : explicit,
    );
  }
  return clampRank(system.proficiencies?.spellcasting?.rank);
}

function spellcastingAbility(entry) {
  const ability = asString(asObject(entry.system).ability, "int");
  return ABILITY_KEYS.includes(ability) ? ability : "int";
}

/**
 * `spellAttack = Level + (Rank * 2) + KeyAttributeMod`
 * `spellDC = 10 + spellAttack`
 *
 * Rank is the proficiency rank (U/T/E/M/L -> 0..4). The source of truth is the
 * entry's own proficiency, falling back to the actor's spellcasting rank.
 */
function spellcastingStats(system, entry) {
  const level = asNumber(system.details?.level?.value, 1);
  const rank = spellcastingRank(entry, system);
  const ability = spellcastingAbility(entry);
  const keyAttributeMod = abilityMod(system, ability);
  const spellAttack = level + rank * 2 + keyAttributeMod;
  const sc = asObject(entry.system);
  return {
    level,
    rank,
    ability,
    keyAttributeMod,
    spellAttack,
    spellDC: 10 + spellAttack,
    type: asString(sc.prepared || sc.type, "prepared"),
    tradition: asString(sc.tradition, "arcane"),
    mode: asString(sc.mode, "attack"),
  };
}

// ---------------------------------------------------------------------------
// ABC pipeline — classes, levels, features and feat slots
// ---------------------------------------------------------------------------

function readClassFeatureEntries(classDoc) {
  const items = asObject(asObject(classDoc && classDoc.system).items);
  return Object.entries(items)
    .filter(([, feature]) => feature && typeof feature.name === "string")
    .map(([key, feature]) => ({
      key,
      name: feature.name,
      level: Math.trunc(asNumber(feature.level, 1)),
      img: asString(feature.img) || null,
      uuid: asString(feature.uuid),
      traits: asString(feature.traits),
      description: asString(feature.description),
      actionType: asString(
        feature.actionType ||
          feature.system?.actionType?.value ||
          feature.system?.actionType,
      ),
    }))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

/**
 * Class features available at or below `level`, shaped as actor items.
 * The extracted class documents list these under `system.items`.
 */
function classFeatureItems(classDoc, level) {
  const target = Math.max(1, Math.trunc(asNumber(level, 1)));
  const classId =
    asString(classDoc && classDoc.id) ||
    slugify(classDoc && classDoc.name);
  return readClassFeatureEntries(classDoc)
    .filter((feature) => feature.level <= target)
    .map((feature) => ({
      id: "class-feature-" + slugify(classId) + "-" + slugify(feature.name),
      name: feature.name,
      type: feature.actionType ? "action" : "feat",
      img: feature.img,
      level: feature.level,
      description: feature.description,
      traits: feature.traits || "class",
      uuid: feature.uuid,
      source: asString(classDoc && classDoc.name),
      classId,
      category: "class",
      system: {
        category: "class",
        level: { value: feature.level },
        actionType: feature.actionType
          ? { value: feature.actionType }
          : undefined,
      },
    }));
}

function mergeActorItems(existingItems, incomingItems) {
  const merged = [];
  const seen = new Set();
  for (const item of [
    ...normalizeActorItems(existingItems),
    ...normalizeActorItems(incomingItems),
  ]) {
    const keys = [item.id, item.uuid, item.name + "|" + item.type].filter(
      Boolean,
    );
    if (keys.some((key) => seen.has(key))) {
      continue;
    }
    keys.forEach((key) => seen.add(key));
    merged.push(item);
  }
  return merged;
}

function computeFeatSlots(classDoc, level, existingSlots) {
  const target = Math.max(1, Math.trunc(asNumber(level, 1)));
  const existingById = new Map(
    asArray(existingSlots).map((slot) => [slot.id, slot]),
  );
  const classLevels = asArray(
    asObject(asObject(classDoc && classDoc.system).classFeatLevels).value,
  );
  const generalLevels = asArray(
    asObject(asObject(classDoc && classDoc.system).generalFeatLevels).value,
  );

  const build = (type, levels) =>
    levels
      .map((entry) => Math.trunc(asNumber(entry, 0)))
      .filter((entry) => entry >= 1 && entry <= target)
      .map((slotLevel) => {
        const id = "feat-slot-" + type + "-" + slotLevel;
        const previous = existingById.get(id);
        return {
          id,
          type,
          level: slotLevel,
          featId: previous && previous.featId ? previous.featId : null,
        };
      });

  return [...build("class", classLevels), ...build("general", generalLevels)]
    .sort((a, b) => a.level - b.level || a.type.localeCompare(b.type));
}

function applyClassProficiencies(system, classDoc) {
  const classSystem = asObject(classDoc && classDoc.system);
  const attacks = asObject(classSystem.attacks);
  const defenses = asObject(classSystem.defenses);
  const savingThrows = asObject(classSystem.savingThrows);

  for (const key of ATTACK_KEYS) {
    if (attacks[key] !== undefined) {
      system.proficiencies.attacks[key] = {
        rank: maxRank(
          system.proficiencies.attacks[key]?.rank,
          attacks[key],
        ),
      };
    }
  }
  for (const key of DEFENSE_KEYS) {
    if (defenses[key] !== undefined) {
      system.proficiencies.defenses[key] = {
        rank: maxRank(
          system.proficiencies.defenses[key]?.rank,
          defenses[key],
        ),
      };
    }
  }
  if (classSystem.perception !== undefined) {
    system.perception.rank = maxRank(
      system.perception.rank,
      classSystem.perception,
    );
  }
  for (const save of SAVE_DEFINITIONS) {
    if (savingThrows[save.key] !== undefined) {
      system.saves[save.key] = {
        rank: maxRank(system.saves[save.key]?.rank, savingThrows[save.key]),
      };
    }
  }

  const keyAbility = asArray(asObject(classSystem.keyAbility).value)[0];
  if (ABILITY_KEYS.includes(keyAbility)) {
    system.details.keyability = { value: keyAbility };
  }
}

/**
 * Apply a full class compendium document to a system.
 *
 * Sets the selected class identity, merges base proficiencies (never lowering a
 * rank the actor already has) and rebuilds class/general feat slots for the
 * current level.
 */
function applyClassDocument(rawSystem, classDoc, level) {
  const system = normalizeCharacterSystem(rawSystem);
  const target = Math.max(1, Math.trunc(asNumber(level, system.details.level.value)));
  const classSystem = asObject(classDoc && classDoc.system);
  const classHp = Number(classSystem.hp);
  const keyAbility = asArray(asObject(classSystem.keyAbility).value).filter(
    (entry) => ABILITY_KEYS.includes(entry),
  );
  system.details.level = { value: target };
  system.details.class = {
    id: asString(classDoc && classDoc.id),
    name: asString(classDoc && classDoc.name),
    img: asString(classDoc && classDoc.img) || null,
    value: asString(classDoc && classDoc.name),
    slug:
      asString(classDoc && classDoc.slug) ||
      asString(classSystem.slug) ||
      null,
    // Step 4.8.2: keep the two class numbers needed by the sheet's automatic
    // max-HP and ability-builder pipelines.
    ...(Number.isFinite(classHp) && classHp > 0 ? { hp: classHp } : {}),
    keyAbility,
  };
  applyClassProficiencies(system, classDoc);
  system.featSlots = computeFeatSlots(
    classDoc,
    target,
    system.featSlots,
  );
  return system;
}

function mirrorFeatureIntoFeats(system, item) {
  const section = item.type === "action" ? "encounter" : "class";
  if (section === "encounter") {
    const actions = asArray(system.actions.encounter);
    if (!actions.some((entry) => entry.id === item.id)) {
      system.actions.encounter = [
        ...actions,
        {
          id: item.id,
          name: item.name,
          cost: "1",
          traits: item.traits,
          description: item.description,
        },
      ];
    }
    return;
  }
  const feats = asArray(system.feats.class);
  if (!feats.some((entry) => entry.id === item.id)) {
    system.feats.class = [
      ...feats,
      {
        id: item.id,
        name: item.name,
        level: item.level,
        traits: item.traits || "class",
        description: item.description,
        uuid: item.uuid,
        source: item.source,
      },
    ];
  }
}

/**
 * Full ABC + level pipeline for an actor payload.
 *
 * - fetches no data itself; the caller passes the already loaded class JSON,
 * - adds every class feature up to `level` to `actor.items`,
 * - mirrors those features into the Feats/Actions tabs,
 * - applies base proficiencies and rebuilds feat slots.
 */
function applyClassToActor(actor, classDoc, options) {
  const source = actor !== null && typeof actor === "object" ? actor : {};
  const opts = asObject(options);
  const level =
    opts.level !== undefined
      ? Math.max(1, Math.trunc(asNumber(opts.level, 1)))
      : Math.max(1, asNumber(source.system?.details?.level?.value, 1));
  const system = applyClassDocument(source.system, classDoc, level);
  const features = classFeatureItems(classDoc, level);
  const items = mergeActorItems(source.items, features);
  for (const feature of features) {
    mirrorFeatureIntoFeats(system, feature);
  }
  return {
    ...source,
    system,
    items,
  };
}

// ---------------------------------------------------------------------------
// Bulk
// ---------------------------------------------------------------------------

function itemBulkContribution(item) {
  const quantity = Math.max(1, asNumber(item.quantity, 1));
  if (item.bulk === "L") {
    return quantity * 0.1;
  }
  return Math.max(0, asNumber(item.bulk, 0)) * quantity;
}

/**
 * PF2e Bulk with the backpack rule: the first 2 Bulk of stowed items do not
 * count against the carrier's limit. (Backpack: "The first 2 Bulk of items in
 * your backpack don't count against your Bulk limit.")
 */
function totalBulk(system) {
  const items = asArray(system.inventory?.items);
  let total = 0;
  let stowed = 0;
  for (const item of items) {
    const contribution = itemBulkContribution(item);
    total += contribution;
    if (item.carried === "stowed") {
      stowed += contribution;
    }
  }
  return roundBulk(Math.max(0, total - Math.min(2, stowed)));
}

function encumbranceState(system) {
  const str = abilityMod(system, "str");
  // PF2e Remastered: encumbered at more than 5 + Str, and you cannot carry
  // more than 10 + Str Bulk at all.
  const limit = 5 + str;
  const max = 10 + str;
  const bulk = totalBulk(system);
  if (bulk > max) {
    return { bulk, limit, max, state: "overloaded", label: "Перегружен" };
  }
  if (bulk > limit) {
    return { bulk, limit, max, state: "encumbered", label: "Обременён" };
  }
  return { bulk, limit, max, state: "normal", label: "Норма" };
}

// ---------------------------------------------------------------------------
// Top-level preparation entry points
// ---------------------------------------------------------------------------

/**
 * Recompute every derived statistic from pure modifiers and proficiencies.
 * Idempotent: generated weapon strikes are stripped and rebuilt.
 */
function prepareActorSystem(rawSystem, rawItems) {
  const system = normalizeCharacterSystem(rawSystem);
  // When a caller passes `actor.items`, it is the authoritative physical-item
  // collection (Foundry model). When it is omitted, legacy callers that only
  // keep `system.inventory.items` still work.
  const hasActorItems = rawItems !== undefined && rawItems !== null;
  const items = normalizeActorItems(
    hasActorItems ? rawItems : system.inventory.items,
  );
  const inventoryItems = hasActorItems
    ? physicalActorItems(rawItems)
    : asArray(system.inventory.items).map(normalizePhysicalItem);
  system.inventory.items = inventoryItems;

  const hpBreakdown = maxHpBreakdown(system, items);
  if (hpBreakdown) {
    system.attributes.hp.max = hpBreakdown.max;
  }

  system.strikes = prepareStrikes(system);

  const ac = armorClassBreakdown(system);
  system.attributes.ac = {
    ...system.attributes.ac,
    value: ac.value,
  };

  system.perception = {
    ...system.perception,
    mod: perceptionModifier(system),
  };
  for (const save of SAVE_DEFINITIONS) {
    system.saves[save.key] = {
      ...system.saves[save.key],
      mod: saveModifier(system, save.key),
    };
  }
  // Step 4.8.4: worn armour may impose its check penalty on Strength/Dexterity
  // skills. The exact per-skill predicates live in the reference document.
  const armorCheckPenalty = armorCheckPenaltyState(system);
  for (const skill of SKILL_DEFINITIONS) {
    const armorPenalty = armorCheckPenaltyForSkill(
      system,
      skill.key,
      skill.ability,
      armorCheckPenalty,
    );
    system.skills[skill.key] = {
      ...system.skills[skill.key],
      ability: skill.ability,
      armorPenalty,
      mod: skillModifier(system, skill.key, skill.ability),
    };
  }

  const preparedItems = prepareActorItems(items, system);

  // Step 4.8.4: `actor.items` is the source of truth for both feat sections and
  // spell containers. The prepared `system` only carries derived summaries so
  // the sheet does not need to re-group documents on every render.
  system.feats = prepareFeatSections(preparedItems, system.feats);

  const spellEntries = preparedItems.filter(
    (item) => item.type === "spellcastingEntry",
  );
  const spellsByEntry = Object.fromEntries(
    spellEntries.map((entry) => [entry.id, []]),
  );
  for (const spell of preparedItems) {
    if (spell.type !== "spell") {
      continue;
    }
    const summary = {
      id: spell.id,
      name: spell.name,
      img: spell.img,
      rank: spell.rank,
      level: spell.level,
      traits: spell.traits,
      description: spell.description,
      entryId: spell.entryId,
      spellAttack: spell.spellAttack,
      spellDC: spell.spellDC,
      actions: asString(spell.system?.time?.value),
    };
    if (spell.entryId && spellsByEntry[spell.entryId]) {
      spellsByEntry[spell.entryId].push(summary);
    }
  }
  for (const entryId of Object.keys(spellsByEntry)) {
    spellsByEntry[entryId].sort(
      (a, b) => a.rank - b.rank || a.name.localeCompare(b.name),
    );
  }

  const spellcasting = spellEntries.map((item) => ({
    id: item.id,
    name: item.name,
    ...item.spellcasting,
    spells: spellsByEntry[item.id] || [],
  }));

  const encumbrance = encumbranceState(system);
  const attributesHp =
    system.attributes && system.attributes.hp ? system.attributes.hp : {};
  const preparedHp = hpBreakdown || {};
  const fallbackMax = asNumber(attributesHp.max, 10);
  const resolvedMax =
    preparedHp.max !== undefined && preparedHp.max !== null
      ? preparedHp.max
      : fallbackMax;

  system.derived = {
    level: system.details?.level?.value || 1,
    initiative: initiativeModifier(system),
    armorClass: ac,
    armorCheckPenalty,
    // `value`/`temp` mirror `system.attributes.hp` so presentation layers
    // (e.g. canvas token HP bars) can read the whole current/max pair from
    // `system.derived.hp` without falling back to raw attributes. When the
    // ancestry/class pipeline is incomplete the authored maximum is kept.
    hp: {
      ...preparedHp,
      max: resolvedMax,
      value: asNumber(attributesHp.value, resolvedMax),
      temp: asNumber(attributesHp.temp, 0),
    },
    spellcasting,
    spellsByEntry,
    inventory: {
      bulk: encumbrance.bulk,
      limit: encumbrance.limit,
      max: encumbrance.max,
      state: encumbrance.state,
    },
  };

  return system;
}

/**
 * Single entry point used by the sheet. Returns an actor-shaped object whose
 * `system` contains all automatic values and whose `items` contain prepared
 * spellcasting statistics; the persisted actor is never mutated.
 */
function prepareActorData(actor) {
  const source = actor !== null && typeof actor === "object" ? actor : {};
  // Migrate Step 4.8.1 `system.inventory.items` rows into the Foundry-style
  // `actor.items` collection. Non-physical documents (feats, spells, classes,
  // spellcasting entries) are kept untouched.
  const mergedItems = mergePhysicalActorItems(
    source.items,
    source.system?.inventory?.items,
  );
  const system = prepareActorSystem(source.system, mergedItems);
  const items = prepareActorItems(mergedItems, system);
  return {
    ...source,
    system,
    items,
    derived: system.derived,
  };
}

function effectiveMaxHp(system) {
  const hp = system.attributes?.hp || {};
  return asNumber(hp.max, 10);
}

module.exports = {
  ABILITY_KEYS,
  SAVE_DEFINITIONS,
  SKILL_DEFINITIONS,
  SPEED_KEYS,
  FEAT_SECTION_IDS,
  ATTACK_KEYS,
  DEFENSE_KEYS,
  CARRIED_VALUES,
  ARMOR_CATEGORIES,
  PHYSICAL_ITEM_TYPES,
  asObject,
  asNumber,
  asArray,
  asString,
  clone,
  splitTraitList,
  signed,
  clampRank,
  createDefaultCharacterSystem,
  normalizeCharacterSystem,
  normalizeActorItems,
  normalizePhysicalItem,
  physicalActorItems,
  mergePhysicalActorItems,
  createActorItemFromDocument,
  isPhysicalItemType,
  parseBulkValue,
  applyStrikingRune,
  weaponStrike,
  proficiencyBonus,
  abilityMod,
  skillModifier,
  saveModifier,
  perceptionModifier,
  initiativeModifier,
  wornArmorItem,
  armorCheckPenaltyState,
  armorCheckPenaltyForSkill,
  armorClassBreakdown,
  maxHpBreakdown,
  sourceBaseHp,
  prepareStrikes,
  prepareActorItems,
  prepareFeatSections,
  featSectionForItem,
  spellRankValue,
  spellcastingEntryId,
  createActorFeatFromDocument,
  createActorSpellFromDocument,
  prepareActorSystem,
  prepareActorData,
  effectiveMaxHp,
  totalBulk,
  encumbranceState,
  spellcastingRank,
  spellcastingAbility,
  spellcastingStats,
  readClassFeatureEntries,
  classFeatureItems,
  mergeActorItems,
  computeFeatSlots,
  applyClassDocument,
  applyClassToActor,
  itemBulkContribution,
};
