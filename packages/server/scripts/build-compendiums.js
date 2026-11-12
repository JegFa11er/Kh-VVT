"use strict";

/**
 * Build the complete PF2e compendium library from the Foundry reference packs.
 *
 * Source: ../pf2e-reference/packs/pf2e (relative to the repository root).
 * Output: packages/server/data/compendiums/<category>.json
 *         packages/server/data/compendiums/<category>.index.json
 *
 * There is deliberately no item limit. Every JSON item found in the matching
 * source directories is normalized unless it is a folder manifest.
 */

const fs = require("node:fs");
const path = require("node:path");

const SCRIPT_DIR = __dirname;
const SERVER_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(SERVER_DIR, "..", "..");
const DEFAULT_PACKS_ROOT = path.resolve(REPO_ROOT, "..", "pf2e-reference", "packs", "pf2e");
const DEFAULT_OUTPUT_DIR = path.join(SERVER_DIR, "data", "compendiums");

const PACKS_ROOT = resolvePacksRoot();
const OUTPUT_DIR = process.env.COMPENDIUM_OUT_DIR
  ? path.resolve(process.env.COMPENDIUM_OUT_DIR)
  : DEFAULT_OUTPUT_DIR;
// Step 6.5: Babele translation packs. The user may place them under the
// upstream community path (`pf2r/data/community/pf2e/packs`) or the compact
// layout shipped in this repository (`pf2r/packs`).
const TRANSLATIONS_PACKS_DIR = resolveTranslationsPacksDir();

const CATEGORY_TRANSLATION_ALIASES = Object.freeze({
  spells: ["pf2e.spells-srd.json"],
  equipment: ["pf2e.equipment-srd.json"],
  feats: ["pf2e.feats-srd.json", "pf2e.classfeatures.json", "pf2e.ancestryfeatures.json"],
  actions: ["pf2e.actionspf2e.json", "pf2e.adventure-specific-actions.json"],
  ancestries: ["pf2e.ancestries.json"],
  heritages: ["pf2e.heritages.json"],
  backgrounds: ["pf2e.backgrounds.json"],
  classes: ["pf2e.classes.json"],
});

const INCLUDED_TYPES = Object.freeze({
  spells: new Set(["spell"]),
  equipment: new Set([
    "ammo",
    "armor",
    "backpack",
    "book",
    "consumable",
    "equipment",
    "kit",
    "shield",
    "treasure",
    "weapon",
  ]),
  feats: new Set(["feat"]),
  monsters: new Set(["npc"]),
  actions: new Set(["action"]),
  ancestries: new Set(["ancestry"]),
  heritages: new Set(["heritage"]),
  backgrounds: new Set(["background"]),
  classes: new Set(["class"]),
});

const CATEGORY_CONFIG = Object.freeze({
  spells: {
    label: "Spells",
    packs: ["spells"],
    includeTypes: INCLUDED_TYPES.spells,
  },
  equipment: {
    label: "Equipment",
    packs: ["equipment"],
    includeTypes: INCLUDED_TYPES.equipment,
  },
  feats: {
    label: "Feats",
    packs: ["feats", "class-features", "ancestry-features"],
    includeTypes: INCLUDED_TYPES.feats,
  },
  monsters: {
    label: "Monsters",
    packs: resolveMonsterSourceDirectories(),
    includeTypes: INCLUDED_TYPES.monsters,
  },
  actions: {
    label: "Actions",
    packs: ["actions", "adventure-specific-actions"],
    includeTypes: INCLUDED_TYPES.actions,
  },
  ancestries: {
    label: "Ancestries",
    packs: ["ancestries"],
    includeTypes: INCLUDED_TYPES.ancestries,
  },
  heritages: {
    label: "Heritages",
    packs: ["heritages"],
    includeTypes: INCLUDED_TYPES.heritages,
  },
  backgrounds: {
    label: "Backgrounds",
    packs: ["backgrounds"],
    includeTypes: INCLUDED_TYPES.backgrounds,
  },
  classes: {
    label: "Classes",
    packs: ["classes"],
    includeTypes: INCLUDED_TYPES.classes,
  },
});

function resolvePacksRoot() {
  const candidates = [
    process.env.PF2E_PACKS_DIR,
    DEFAULT_PACKS_ROOT,
    path.resolve(process.cwd(), "..", "pf2e-reference", "packs", "pf2e"),
    path.resolve(process.cwd(), "..", "..", "pf2e-reference", "packs", "pf2e"),
    path.resolve(process.cwd(), "pf2e-reference", "packs", "pf2e"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return path.resolve(candidate);
    }
  }

  return DEFAULT_PACKS_ROOT;
}

/**
 * Locate the Babele translation packs. Returns the first directory that exists
 * so both the upstream community layout and the local `pf2r/packs` layout work
 * without configuration.
 */
function resolveTranslationsPacksDir() {
  const candidates = [
    process.env.PF2E_TRANSLATIONS_DIR,
    path.join(
      SERVER_DIR,
      "data",
      "translations",
      "pf2r",
      "data",
      "community",
      "pf2e",
      "packs",
    ),
    path.join(SERVER_DIR, "data", "translations", "pf2r", "packs"),
    path.join(SERVER_DIR, "data", "translations", "packs"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return path.resolve(candidate);
    }
  }

  return path.join(SERVER_DIR, "data", "translations", "pf2r", "packs");
}

/**
 * Core monster packs requested by the project. Set PF2E_ALL_BESTIARIES=1 to
 * also include every adventure-specific bestiary pack.
 */
function resolveMonsterSourceDirectories() {
  if (!fs.existsSync(PACKS_ROOT)) {
    return [];
  }

  const allDirectories = fs
    .readdirSync(PACKS_ROOT, { withFileTypes: true })
    .filter(function (entry) {
      return entry.isDirectory();
    })
    .map(function (entry) {
      return entry.name;
    });

  const corePattern = /^(pathfinder-monster-core(?:-2)?|pathfinder-bestiary(?:-[23])?|pathfinder-npc-core|npc-gallery)$/i;
  const allBestiaryPattern = /(bestiary|monster-core|npc-core|npc-gallery)/i;
  const pattern = process.env.PF2E_ALL_BESTIARIES === "1" ? allBestiaryPattern : corePattern;

  return allDirectories.filter(function (name) {
    return pattern.test(name);
  }).sort(function (a, b) {
    return a.localeCompare(b);
  });
}

// --------------------------------------------------------------- HTML cleanup

const NAMED_ENTITIES = Object.freeze({
  amp: "&",
  apos: "'",
  bull: "\u2022",
  cent: "\u00a2",
  copy: "\u00a9",
  deg: "\u00b0",
  divide: "\u00f7",
  emdash: "\u2014",
  euro: "\u20ac",
  frac12: "\u00bd",
  frac14: "\u00bc",
  frac34: "\u00be",
  gt: ">",
  hellip: "\u2026",
  laquo: "\u00ab",
  ldquo: "\u201c",
  lsquo: "\u2018",
  lt: "<",
  mdash: "\u2014",
  middot: "\u00b7",
  minus: "\u2212",
  nbsp: " ",
  ndash: "\u2013",
  pound: "\u00a3",
  quot: '"',
  raquo: "\u00bb",
  rdquo: "\u201d",
  reg: "\u00ae",
  rsquo: "\u2019",
  sect: "\u00a7",
  times: "\u00d7",
  trade: "\u2122",
});

function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, function (_match, hex) {
      const code = Number.parseInt(hex, 16);
      if (!Number.isFinite(code)) {
        return _match;
      }
      try {
        return String.fromCodePoint(code);
      } catch (error) {
        return _match;
      }
    })
    .replace(/&#(\d+);/g, function (_match, decimal) {
      const code = Number.parseInt(decimal, 10);
      if (!Number.isFinite(code)) {
        return _match;
      }
      try {
        return String.fromCodePoint(code);
      } catch (error) {
        return _match;
      }
    })
    .replace(/&([a-z][a-z0-9]+);/gi, function (match, name) {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key)
        ? NAMED_ENTITIES[key]
        : match;
    });
}

function stripFoundryEnrichers(text) {
  let value = String(text);

  // @UUID[Compendium.pf2e.conditionitems.Item.Frightened]{Frightened 1}
  // @UUID[Compendium.pf2e.actionspf2e.Item.Identify Alchemy]
  value = value.replace(/@UUID\[([^\]]+)\](?:\{([^}]*)\})?/gi, function (_match, target, label) {
    if (label !== undefined && label !== "") {
      return label;
    }
    const parts = String(target).split(".");
    const last = parts[parts.length - 1];
    return last && last.trim() !== "" ? last : target;
  });

  // @Damage[2d6[fire]] -> 2d6 fire
  value = value.replace(
    /@Damage\[((?:[^\[\]]|\[[^\]]*\])*)\](?:\{([^}]*)\})?/gi,
    function (_match, formula, label) {
      return label || formula.replace(/\[([^\]]*)\]/g, " $1");
    },
  );

  // @Check[fortitude|dc:22|basic] -> fortitude (DC 22, basic)
  value = value.replace(/@Check\[([^\]]+)\](?:\{([^}]*)\})?/gi, function (_match, body, label) {
    if (label !== undefined && label !== "") {
      return label;
    }
    const parts = String(body).split("|");
    const type = parts[0] || "check";
    const dc = parts.find(function (part) {
      return /^dc:/i.test(part);
    });
    const basic = parts.some(function (part) {
      return part.trim().toLowerCase() === "basic";
    });
    const details = [];
    if (dc) {
      details.push("DC " + dc.slice(3));
    }
    if (basic) {
      details.push("basic");
    }
    return type + (details.length > 0 ? " (" + details.join(", ") + ")" : "");
  });

  // @Localize[PF2E.NPC.Abilities.Glossary.Telepathy] -> Telepathy
  value = value.replace(/@Localize\[([^\]]+)\]/gi, function (_match, key) {
    const parts = String(key).split(".");
    return parts[parts.length - 1] || key;
  });

  // @Template[type:burst|distance:15] -> 15-foot burst
  value = value.replace(/@Template\[([^\]]*)\](?:\{([^}]*)\})?/gi, function (_match, body, label) {
    if (label !== undefined && label !== "") {
      return label;
    }
    const parameters = Object.create(null);
    for (const part of String(body).split("|")) {
      const separator = part.indexOf(":");
      if (separator !== -1) {
        parameters[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
      }
    }
    const type = parameters.type || "area";
    const distance = parameters.distance || parameters.radius || parameters.width;
    return distance ? distance + "-foot " + type : type;
  });

  // @Embed[Compendium.pf2e.classfeatures.Item.PoclGJ7BCEyIuqJe inline]
  value = value.replace(
    /@Embed\[((?:[^\[\]]|\[[^\]]*\])*)\](?:\{([^}]*)\})?/gi,
    function (_match, _target, label) {
      return label !== undefined && label !== "" ? label : "[Embedded content]";
    },
  );

  // @item[...]{Longsword}, @actor[...], @spell[...], @weapon[...], etc.
  value = value.replace(
    /@(item|actor|spell|weapon|armor|kingdom|self|target|origin|blast)\[([^\]]*)\](?:\{([^}]*)\})?/gi,
    function (_match, _kind, target, label) {
      if (label !== undefined && label !== "") {
        return label;
      }
      const parts = String(target).split(".");
      return parts[parts.length - 1] || target;
    },
  );

  // Generic fallback for any remaining Foundry enricher.
  value = value.replace(
    /@([A-Za-z]+)\[([^\]]*)\](?:\{([^}]*)\})?/g,
    function (_match, _kind, target, label) {
      if (label !== undefined && label !== "") {
        return label;
      }
      const parts = String(target).split(".");
      return parts[parts.length - 1] || target;
    },
  );

  return value;
}

/** Convert Foundry's HTML descriptions into readable plain text. */
function cleanHtml(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value !== "string") {
    return String(value);
  }

  let text = value;

  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<hr\s*\/?>/gi, "\n");
  text = text.replace(/<li[^>]*>/gi, "\n- ");
  text = text.replace(/<\/li>/gi, "");
  text = text.replace(/<\/(p|div|section|article|blockquote|h[1-6]|tr|table|ul|ol)>/gi, "\n");
  text = text.replace(/<\/t[dh]>/gi, " | ");
  text = text.replace(/<[^>]*>/g, "");

  text = decodeHtmlEntities(text);
  text = stripFoundryEnrichers(text);

  text = text.replace(/\r\n?/g, "\n");
  text = text.replace(/[ \t\f\v]+/g, " ");
  text = text.replace(/ *\n */g, "\n");
  text = text.replace(/(?:\n\s*){3,}/g, "\n\n");
  text = text.replace(/ +\n/g, "\n");
  text = text.replace(/\n +/g, "\n");
  text = text.replace(/^[\s|]+|[\s|]+$/g, "");

  return text;
}

/**
 * Deep-clone a Foundry data tree while converting only descriptive fields to
 * readable text. All mechanical objects (numbers, arrays, rules, traits, etc.)
 * are preserved exactly.
 */
function cleanDeep(value) {
  if (Array.isArray(value)) {
    return value.map(cleanDeep);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const result = {};
  for (const key of Object.keys(value)) {
    const child = value[key];

    if (
      (key === "description" || key === "publicNotes" || key === "blurb" || key === "privateNotes") &&
      typeof child === "string"
    ) {
      result[key] = cleanHtml(child);
      continue;
    }

    if (
      key === "description" &&
      child !== null &&
      typeof child === "object" &&
      !Array.isArray(child) &&
      typeof child.value === "string"
    ) {
      result[key] = Object.assign({}, cleanDeep(child), { value: cleanHtml(child.value) });
      continue;
    }

    result[key] = cleanDeep(child);
  }
  return result;
}

// ------------------------------------------------------------- field readers

function readTraits(system) {
  const traitsNode = system && system.traits;
  const info = {
    traits: [],
    rarity: null,
    traditions: [],
    missing: false,
    malformed: false,
    badEntries: 0,
  };

  if (traitsNode === null || traitsNode === undefined || typeof traitsNode !== "object") {
    info.missing = true;
    return info;
  }

  const rawValue = traitsNode.value;
  if (Array.isArray(rawValue)) {
    for (const entry of rawValue) {
      if (typeof entry === "string" && entry.trim() !== "") {
        info.traits.push(entry.trim());
      } else if (entry !== null && entry !== undefined) {
        info.badEntries += 1;
      }
    }
  } else if (typeof rawValue === "string" && rawValue.trim() !== "") {
    info.traits.push(rawValue.trim());
  } else if (rawValue !== null && rawValue !== undefined) {
    info.malformed = true;
  }

  if (typeof traitsNode.rarity === "string" && traitsNode.rarity.trim() !== "") {
    info.rarity = traitsNode.rarity.trim();
  }

  if (Array.isArray(traitsNode.traditions)) {
    info.traditions = traitsNode.traditions.filter(function (entry) {
      return typeof entry === "string" && entry.trim() !== "";
    });
  }

  if (info.badEntries > 0) {
    info.malformed = true;
  }

  return info;
}

function readLevel(system) {
  if (!system || typeof system !== "object") {
    return null;
  }

  const candidates = [];
  if (system.details && system.details.level !== undefined) {
    candidates.push(system.details.level);
  }
  if (system.level !== undefined) {
    candidates.push(system.level);
  }

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (
      candidate !== null &&
      typeof candidate === "object" &&
      typeof candidate.value === "number" &&
      Number.isFinite(candidate.value)
    ) {
      return candidate.value;
    }
  }

  return null;
}

function readDescription(system, type) {
  if (!system || typeof system !== "object") {
    return "";
  }

  if (system.description && typeof system.description.value === "string") {
    return cleanHtml(system.description.value);
  }

  if (type === "npc" && system.details) {
    const notes = [];
    if (typeof system.details.publicNotes === "string") {
      notes.push(cleanHtml(system.details.publicNotes));
    }
    if (typeof system.details.blurb === "string" && system.details.blurb.trim() !== "") {
      notes.push(cleanHtml(system.details.blurb));
    }
    return notes.join("\n\n").trim();
  }

  return "";
}

// ------------------------------------------------------- category extractors

function extractWeapon(system) {
  const damage = system.damage !== undefined ? system.damage : null;
  const formula =
    damage &&
    Number.isInteger(damage.dice) &&
    typeof damage.die === "string" &&
    damage.dice > 0
      ? damage.dice + damage.die
      : null;

  let rangeIncrement = null;
  if (typeof system.range === "number" && Number.isFinite(system.range)) {
    rangeIncrement = system.range;
  } else if (system.range && typeof system.range === "object") {
    if (typeof system.range.increment === "number") {
      rangeIncrement = system.range.increment;
    } else if (typeof system.range.value === "number") {
      rangeIncrement = system.range.value;
    }
  }

  return {
    category: system.category !== undefined ? system.category : null,
    group: system.group !== undefined ? system.group : null,
    baseItem: system.baseItem !== undefined ? system.baseItem : null,
    damage: damage,
    formula: formula,
    damageType: damage && typeof damage.damageType === "string" ? damage.damageType : null,
    bonus: system.bonus !== undefined ? system.bonus : null,
    bonusDamage: system.bonusDamage !== undefined ? system.bonusDamage : null,
    splashDamage: system.splashDamage !== undefined ? system.splashDamage : null,
    range: system.range !== undefined ? system.range : null,
    rangeIncrement: rangeIncrement,
    reload: system.reload !== undefined ? system.reload : null,
    usage: system.usage !== undefined ? system.usage : null,
    bulk: system.bulk !== undefined ? system.bulk : null,
    price: system.price !== undefined ? system.price : null,
    runes: system.runes !== undefined ? system.runes : null,
    material: system.material !== undefined ? system.material : null,
    hp: system.hp !== undefined ? system.hp : null,
    hardness: system.hardness !== undefined ? system.hardness : null,
  };
}

function extractArmor(system) {
  return {
    category: system.category !== undefined ? system.category : null,
    group: system.group !== undefined ? system.group : null,
    baseItem: system.baseItem !== undefined ? system.baseItem : null,
    acBonus: system.acBonus !== undefined ? system.acBonus : null,
    dexCap: system.dexCap !== undefined ? system.dexCap : null,
    checkPenalty: system.checkPenalty !== undefined ? system.checkPenalty : null,
    speedPenalty: system.speedPenalty !== undefined ? system.speedPenalty : null,
    strength: system.strength !== undefined ? system.strength : null,
    bulk: system.bulk !== undefined ? system.bulk : null,
    price: system.price !== undefined ? system.price : null,
    material: system.material !== undefined ? system.material : null,
    runes: system.runes !== undefined ? system.runes : null,
    hp: system.hp !== undefined ? system.hp : null,
    hardness: system.hardness !== undefined ? system.hardness : null,
  };
}

function extractShield(system) {
  return {
    category: system.category !== undefined ? system.category : null,
    baseItem: system.baseItem !== undefined ? system.baseItem : null,
    acBonus: system.acBonus !== undefined ? system.acBonus : null,
    speedPenalty: system.speedPenalty !== undefined ? system.speedPenalty : null,
    bulk: system.bulk !== undefined ? system.bulk : null,
    price: system.price !== undefined ? system.price : null,
    hp: system.hp !== undefined ? system.hp : null,
    hardness: system.hardness !== undefined ? system.hardness : null,
    material: system.material !== undefined ? system.material : null,
    runes: system.runes !== undefined ? system.runes : null,
  };
}

function extractMonster(system) {
  const attributes = system.attributes || {};
  const details = system.details || {};
  return {
    size: system.traits && system.traits.size ? system.traits.size.value : null,
    hp: attributes.hp !== undefined ? attributes.hp : null,
    ac: attributes.ac !== undefined ? attributes.ac : null,
    speed: attributes.speed !== undefined ? attributes.speed : null,
    allSaves: attributes.allSaves !== undefined ? attributes.allSaves : null,
    immunities: attributes.immunities !== undefined ? attributes.immunities : null,
    weaknesses: attributes.weaknesses !== undefined ? attributes.weaknesses : null,
    resistances: attributes.resistances !== undefined ? attributes.resistances : null,
    saves: system.saves !== undefined ? system.saves : null,
    perception: system.perception !== undefined ? system.perception : null,
    abilities: system.abilities !== undefined ? system.abilities : null,
    skills: system.skills !== undefined ? system.skills : null,
    languages: details.languages !== undefined ? details.languages : null,
    publication: details.publication !== undefined ? details.publication : null,
  };
}

function normalizeItem(raw, category, source) {
  const system = raw.system !== null && typeof raw.system === "object"
    ? cleanDeep(raw.system)
    : {};

  const traitInfo = readTraits(system);
  const level = readLevel(system);
  const description = readDescription(system, raw.type);

  const item = {
    id: String(raw._id),
    name: String(raw.name),
    type: typeof raw.type === "string" ? raw.type : "unknown",
    img: typeof raw.img === "string" ? raw.img : null,
    level: level,
    rarity: traitInfo.rarity,
    traits: traitInfo.traits,
    description: description,
    source: source,
    system: system,
  };

  if (source && typeof source.file === "string") {
    const slash = source.file.lastIndexOf("/");
    const fileName = slash === -1 ? source.file : source.file.slice(slash + 1);
    if (fileName.toLowerCase().endsWith(".json")) {
      item.slug = fileName.slice(0, -5);
    }
  }

  if (category === "spells") {
    item.rank = level;
    item.traditions = traitInfo.traditions;
    item.defense = system.defense !== undefined ? system.defense : null;
    item.time = system.time !== undefined ? system.time : null;
    item.components = system.components !== undefined ? system.components : null;
    item.damage = system.damage !== undefined ? system.damage : null;
    item.area = system.area !== undefined ? system.area : null;
    item.range = system.range !== undefined ? system.range : null;
    item.target = system.target !== undefined ? system.target : null;
    item.duration = system.duration !== undefined ? system.duration : null;
    item.cost = system.cost !== undefined ? system.cost : null;
    item.requirements = system.requirements !== undefined ? system.requirements : null;
    item.counteraction = system.counteraction !== undefined ? system.counteraction : null;

    const save = system.defense && system.defense.save ? system.defense.save : null;
    item.saveType = save && typeof save.statistic === "string" ? save.statistic : null;
    item.basicSave = Boolean(save && save.basic === true);

    const timeValue = system.time && system.time.value !== undefined ? system.time.value : null;
    if (typeof timeValue === "number" && Number.isInteger(timeValue)) {
      item.actionCost = timeValue;
    } else if (typeof timeValue === "string" && /^\d+$/.test(timeValue.trim())) {
      item.actionCost = Number.parseInt(timeValue.trim(), 10);
    } else {
      item.actionCost = null;
    }

    const damageEntries =
      system.damage && typeof system.damage === "object"
        ? Object.values(system.damage)
        : [];
    const primaryDamage = damageEntries.find(function (entry) {
      return entry && typeof entry === "object" && typeof entry.formula === "string";
    });
    item.damageFormula = primaryDamage ? primaryDamage.formula : null;
    item.damageType =
      primaryDamage && typeof primaryDamage.type === "string" ? primaryDamage.type : null;
  } else if (category === "equipment") {
    if (raw.type === "weapon") {
      item.weapon = extractWeapon(system);
      item.weapon.traits = traitInfo.traits;
      item.damage = system.damage !== undefined ? system.damage : null;
    } else if (raw.type === "armor") {
      item.armor = extractArmor(system);
      item.armor.traits = traitInfo.traits;
    } else if (raw.type === "shield") {
      item.shield = extractShield(system);
      item.shield.traits = traitInfo.traits;
    }
  } else if (category === "feats" || category === "actions") {
    item.actionType = system.actionType !== undefined ? system.actionType : null;
    item.actions = system.actions !== undefined ? system.actions : null;
    item.category = system.category !== undefined ? system.category : null;
    item.prerequisites = system.prerequisites !== undefined ? system.prerequisites : null;
    item.frequency = system.frequency !== undefined ? system.frequency : null;
    item.trigger = system.trigger !== undefined ? system.trigger : null;
    item.requirements = system.requirements !== undefined ? system.requirements : null;

    item.actionTypeValue =
      system.actionType && typeof system.actionType.value === "string"
        ? system.actionType.value
        : null;
    item.actionCost =
      system.actions &&
      typeof system.actions.value === "number" &&
      Number.isInteger(system.actions.value)
        ? system.actions.value
        : null;
  } else if (category === "monsters") {
    item.monster = extractMonster(system);
    if (Array.isArray(raw.items)) {
      item.items = cleanDeep(raw.items);
    }
  }

  if (raw.flags !== null && typeof raw.flags === "object") {
    item.flags = cleanDeep(raw.flags);
  }

  return { item: item, traitInfo: traitInfo };
}

function makeIndexEntry(item) {
  const entry = {
    id: item.id,
    name: item.name,
    type: item.type,
    level: item.level,
    rarity: item.rarity || null,
    traits: item.traits,
    img: item.img,
    source: item.source,
  };

  // Step 6.6: the equipment filter sidebar needs these compact fields so the
  // server can filter by rarity/type/category/price before pagination without
  // loading the multi-megabyte full catalog. The keys are always present (even
  // when the value is null) so the catalog service can tell a new index from a
  // legacy one that needs a one-time hydration from the full file.
  const system = item.system && typeof item.system === "object" ? item.system : null;
  entry.category =
    system && typeof system.category === "string" && system.category.trim() !== ""
      ? system.category.trim()
      : null;
  entry.price =
    system && system.price && typeof system.price === "object"
      ? system.price
      : null;

  // Step 4.8.2: heritages are filtered by their ancestry. Versatile heritages
  // (Nephilim, Dhampir, ...) have no ancestry link and are available to every
  // character, so the flag has to be part of the compact index.
  if (item.type === "heritage") {
    const ancestry = item.system && item.system.ancestry;
    const traits = Array.isArray(item.traits) ? item.traits : [];
    entry.ancestry = ancestry && typeof ancestry.slug === "string" ? ancestry.slug : null;
    entry.ancestryName =
      ancestry && typeof ancestry.name === "string" ? ancestry.name : null;
    // Versatile heritages have no ancestry link. The explicit trait is also
    // honoured for future data packs that mark them directly.
    entry.versatile = !ancestry || traits.includes("versatile");
  }

  return entry;
}

// -------------------------------------------------------------- file helpers

function collectJsonFiles(rootDirectory) {
  const files = [];
  if (!fs.existsSync(rootDirectory)) {
    return files;
  }

  const walk = function (directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "_folders.json" || entry.name.startsWith("_")) {
        continue;
      }
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        files.push(fullPath);
      }
    }
  };

  walk(rootDirectory);
  return files;
}

function toPosixPath(value) {
  return String(value).replace(/\\/g, "/");
}

function formatMegabytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function writeJson(filePath, data) {
  const payload = JSON.stringify(data);
  fs.writeFileSync(filePath, payload + "\n", "utf8");
  return Buffer.byteLength(payload, "utf8");
}

// ------------------------------------------------------- translation (6.5)

/**
 * Translation files that may contain entries for one category. Category packs
 * use different upstream names (`spells` -> `pf2e.spells-srd.json`), so the
 * aliases are merged with one candidate per configured source pack.
 */
function translationFileNames(category, config) {
  const names = new Set();
  for (const name of CATEGORY_TRANSLATION_ALIASES[category] || []) {
    names.add(name);
  }
  for (const pack of config.packs || []) {
    names.add("pf2e." + pack + ".json");
  }
  names.add("pf2e." + category + ".json");
  names.add("pf2e." + category + "-srd.json");
  return Array.from(names);
}

function readTranslationEntries(fileName) {
  const filePath = path.join(TRANSLATIONS_PACKS_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const entries = parsed.entries;
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      return null;
    }
    return entries;
  } catch (error) {
    console.warn(
      "Skipping invalid translation file " + fileName + ": " + error.message,
    );
    return null;
  }
}

function readTranslatedDescription(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  if (typeof entry.description === "string" && entry.description.trim() !== "") {
    return entry.description;
  }
  if (
    entry.description &&
    typeof entry.description === "object" &&
    typeof entry.description.value === "string" &&
    entry.description.value.trim() !== ""
  ) {
    return entry.description.value;
  }
  return null;
}

/** Load every translation file that maps onto a category. */
function loadCategoryTranslations(category, config) {
  const byName = new Map();
  const byPack = new Map();
  const loadedFiles = [];

  for (const fileName of translationFileNames(category, config)) {
    const entries = readTranslationEntries(fileName);
    if (!entries) {
      continue;
    }
    loadedFiles.push(fileName);
    const pack = fileName.replace(/^pf2e\./, "").replace(/\.json$/i, "");
    const packMap = byPack.get(pack) || new Map();

    for (const englishName of Object.keys(entries)) {
      const translated = entries[englishName];
      if (!translated || typeof translated !== "object") {
        continue;
      }
      const record = {
        name:
          typeof translated.name === "string" && translated.name.trim() !== ""
            ? translated.name
            : null,
        // The English compendium stores readable text, not HTML, so the
        // translated description is normalized the same way.
        description: readTranslatedDescription(translated),
      };
      byName.set(englishName, record);
      packMap.set(englishName, record);
    }

    byPack.set(pack, packMap);
  }

  return {
    byName: byName,
    byPack: byPack,
    loadedFiles: loadedFiles,
  };
}

/**
 * Deep-copy the English items and replace names/descriptions when the Babele
 * translation uses the original English name as its key.
 */
function translateItems(items, translations) {
  const translatedItems = JSON.parse(JSON.stringify(items));
  if (!translations || translations.loadedFiles.length === 0) {
    return { items: translatedItems, translated: 0 };
  }

  let translated = 0;
  for (const item of translatedItems) {
    const sourcePack = item.source && item.source.pack ? item.source.pack : null;
    const packMap = sourcePack ? translations.byPack.get(sourcePack) : null;
    const entry =
      (packMap && packMap.get(item.name)) ||
      translations.byName.get(item.name) ||
      null;
    if (!entry) {
      continue;
    }

    if (entry.name) {
      item.name = entry.name;
    }
    if (entry.description) {
      const text = cleanHtml(entry.description);
      item.description = text;
      item.system =
        item.system && typeof item.system === "object" ? item.system : {};
      item.system.description =
        item.system.description && typeof item.system.description === "object"
          ? Object.assign({}, item.system.description, { value: text })
          : { value: text };
    }
    translated += 1;
  }

  return { items: translatedItems, translated: translated };
}

// ---------------------------------------------------------------------- build

function collectAllPackFiles() {
  const files = [];
  if (!fs.existsSync(PACKS_ROOT)) {
    return files;
  }

  const packDirectories = fs
    .readdirSync(PACKS_ROOT, { withFileTypes: true })
    .filter(function (entry) {
      return entry.isDirectory();
    })
    .map(function (entry) {
      return path.join(PACKS_ROOT, entry.name);
    })
    .sort(function (a, b) {
      return a.localeCompare(b);
    });

  for (const packDirectory of packDirectories) {
    for (const file of collectJsonFiles(packDirectory)) {
      files.push(file);
    }
  }

  return files;
}

function resolveCategoryForType(type, pack) {
  for (const category of Object.keys(CATEGORY_CONFIG)) {
    const config = CATEGORY_CONFIG[category];
    if (
      Array.isArray(config.packs) &&
      config.packs.indexOf(pack) !== -1 &&
      config.includeTypes.has(type)
    ) {
      return category;
    }
  }
  return null;
}

function createStats() {
  const stats = new Map();
  for (const category of Object.keys(CATEGORY_CONFIG)) {
    const config = CATEGORY_CONFIG[category];
    stats.set(category, {
      category: category,
      label: config.label,
      items: [],
      seenIds: new Set(),
      count: 0,
      candidates: 0,
      duplicateCount: 0,
      missingTraits: 0,
      malformedTraits: 0,
      missingLevel: 0,
      traitWarnings: [],
      duplicateIds: [],
      typeCounts: Object.create(null),
      sourcePacks: new Set(),
      fullBytes: 0,
      indexBytes: 0,
      ruFullBytes: 0,
      ruIndexBytes: 0,
      translatedCount: 0,
      translationFiles: [],
      fullPath: path.join(OUTPUT_DIR, category + ".en.json"),
      indexPath: path.join(OUTPUT_DIR, category + ".en.index.json"),
      ruFullPath: path.join(OUTPUT_DIR, category + ".ru.json"),
      ruIndexPath: path.join(OUTPUT_DIR, category + ".ru.index.json"),
    });
  }
  return stats;
}

function ingestItem(raw, file, category, stat) {
  stat.candidates += 1;

  const relativeFile = toPosixPath(path.relative(PACKS_ROOT, file));
  const pack = relativeFile.split("/")[0];
  stat.sourcePacks.add(pack);

  const source = {
    pack: pack,
    file: relativeFile,
  };

  if (raw.system && raw.system.publication) {
    source.publication = raw.system.publication;
  } else if (raw.system && raw.system.details && raw.system.details.publication) {
    source.publication = raw.system.details.publication;
  }

  const normalized = normalizeItem(raw, category, source);
  const item = normalized.item;
  const traitInfo = normalized.traitInfo;

  if (traitInfo.missing || traitInfo.malformed) {
    if (traitInfo.missing) {
      stat.missingTraits += 1;
    } else {
      stat.malformedTraits += 1;
    }
    if (stat.traitWarnings.length < 25) {
      stat.traitWarnings.push({
        name: item.name,
        type: item.type,
        file: relativeFile,
        reason: traitInfo.missing
          ? "missing system.traits"
          : "malformed system.traits.value",
      });
    }
  }

  if (item.level === null) {
    stat.missingLevel += 1;
  }

  stat.typeCounts[item.type] = (stat.typeCounts[item.type] || 0) + 1;

  if (stat.seenIds.has(item.id)) {
    stat.duplicateCount += 1;
    if (stat.duplicateIds.length < 25) {
      stat.duplicateIds.push({ id: item.id, name: item.name, file: relativeFile });
    }
    return;
  }

  stat.seenIds.add(item.id);
  stat.items.push(item);
}

function writeCategory(category, stat) {
  stat.items.sort(function (a, b) {
    const byName = a.name.localeCompare(b.name, "en");
    return byName !== 0 ? byName : a.id.localeCompare(b.id);
  });

  // Step 6.5: always emit an English set. The Russian set is a deep copy with
  // names/descriptions replaced from the matching Babele pack (English text is
  // kept for every entry without a translation).
  stat.count = stat.items.length;
  stat.fullBytes = writeJson(stat.fullPath, stat.items);
  stat.indexBytes = writeJson(stat.indexPath, stat.items.map(makeIndexEntry));

  const translations = loadCategoryTranslations(category, CATEGORY_CONFIG[category]);
  const russian = translateItems(stat.items, translations);
  stat.translatedCount = russian.translated;
  stat.translationFiles = translations.loadedFiles;
  stat.ruFullBytes = writeJson(stat.ruFullPath, russian.items);
  stat.ruIndexBytes = writeJson(
    stat.ruIndexPath,
    russian.items.map(makeIndexEntry),
  );

  return {
    category: category,
    label: stat.label,
    count: stat.count,
    candidates: stat.candidates,
    duplicateCount: stat.duplicateCount,
    duplicateIds: stat.duplicateIds,
    missingTraits: stat.missingTraits,
    malformedTraits: stat.malformedTraits,
    missingLevel: stat.missingLevel,
    traitWarnings: stat.traitWarnings,
    typeCounts: stat.typeCounts,
    sourcePacks: Array.from(stat.sourcePacks).sort(function (a, b) {
      return a.localeCompare(b);
    }),
    fullBytes: stat.fullBytes,
    indexBytes: stat.indexBytes,
    ruFullBytes: stat.ruFullBytes,
    ruIndexBytes: stat.ruIndexBytes,
    translatedCount: stat.translatedCount,
    translationFiles: stat.translationFiles,
    fullPath: stat.fullPath,
    indexPath: stat.indexPath,
    ruFullPath: stat.ruFullPath,
    ruIndexPath: stat.ruIndexPath,
    sources: CATEGORY_CONFIG[category].packs || null,
  };
}

function runBuild(categoryNames) {
  const startedAt = Date.now();
  const selected = categoryNames && categoryNames.length > 0
    ? categoryNames.slice()
    : Object.keys(CATEGORY_CONFIG);
  const stats = createStats();
  const global = {
    filesScanned: 0,
    parsedObjects: 0,
    skippedArrays: 0,
    invalidFiles: 0,
    withoutIdentity: 0,
    unmatchedTypes: 0,
    filteredCategories: 0,
  };

  const files = collectAllPackFiles();
  global.filesScanned = files.length;

  console.log("Scanning " + files.length + " JSON files across all packs...");

  let index = 0;
  for (const file of files) {
    index += 1;
    if (index % 5000 === 0) {
      console.log("  scanned " + index + "/" + files.length + " files...");
    }

    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      global.invalidFiles += 1;
      continue;
    }

    if (!raw || Array.isArray(raw) || typeof raw !== "object") {
      global.skippedArrays += 1;
      continue;
    }
    global.parsedObjects += 1;

    if (!raw._id || !raw.name || !raw.type) {
      global.withoutIdentity += 1;
      continue;
    }

    const relativeFile = toPosixPath(path.relative(PACKS_ROOT, file));
    const pack = relativeFile.split("/")[0];
    const category = resolveCategoryForType(raw.type, pack);

    if (!category) {
      global.unmatchedTypes += 1;
      continue;
    }

    if (selected.indexOf(category) === -1) {
      global.filteredCategories += 1;
      continue;
    }

    ingestItem(raw, file, category, stats.get(category));
  }

  const results = [];
  for (const category of selected) {
    const stat = stats.get(category);
    if (!stat) {
      continue;
    }
    results.push(writeCategory(category, stat));
  }

  return {
    stats: results,
    global: global,
    elapsedMs: Date.now() - startedAt,
  };
}

function buildCategory(category) {
  if (!CATEGORY_CONFIG[category]) {
    throw new Error("Unknown compendium category: " + String(category));
  }
  const result = runBuild([category]);
  return result.stats[0];
}

function printReport(report) {
  const stats = report.stats;
  const elapsedMs = report.elapsedMs;

  console.log("");
  console.log("=== PF2e compendium build complete ===");
  console.log("Source packs: " + PACKS_ROOT);
  console.log("Output:       " + OUTPUT_DIR);
  console.log("Duration:     " + (elapsedMs / 1000).toFixed(1) + "s");
  console.log("");

  let totalItems = 0;
  let totalFullBytes = 0;
  let totalIndexBytes = 0;
  let totalRuFullBytes = 0;
  let totalRuIndexBytes = 0;
  let totalTranslated = 0;
  let totalTraitWarnings = 0;

  for (const stat of stats) {
    totalItems += stat.count;
    totalFullBytes += stat.fullBytes;
    totalIndexBytes += stat.indexBytes;
    totalRuFullBytes += stat.ruFullBytes;
    totalRuIndexBytes += stat.ruIndexBytes;
    totalTranslated += stat.translatedCount;
    totalTraitWarnings += stat.missingTraits + stat.malformedTraits;

    console.log(
      stat.label.padEnd(10) +
        " " +
        String(stat.count).padStart(6) +
        " items  | EN " +
        formatMegabytes(stat.fullBytes).padStart(9) +
        " full / " +
        formatMegabytes(stat.indexBytes).padStart(9) +
        " index | RU " +
        formatMegabytes(stat.ruFullBytes).padStart(9) +
        " full / " +
        formatMegabytes(stat.ruIndexBytes).padStart(9) +
        " index",
    );
    console.log(
      "           translated=" +
        stat.translatedCount +
        " / " +
        stat.count +
        " via " +
        (stat.translationFiles.length > 0
          ? stat.translationFiles.join(", ")
          : "no translation pack"),
    );
    console.log(
      "           candidates=" +
        stat.candidates +
        " duplicateIds=" +
        stat.duplicateCount +
        " sourcePacks=" +
        stat.sourcePacks.length,
    );
    console.log(
      "           traits: missing=" +
        stat.missingTraits +
        " malformed=" +
        stat.malformedTraits +
        " | missingLevel=" +
        stat.missingLevel +
        (stat.category === "actions" ? " (actions have no native level field)" : ""),
    );

    const typeSummary = Object.keys(stat.typeCounts)
      .sort(function (a, b) {
        return a.localeCompare(b);
      })
      .map(function (type) {
        return type + "=" + stat.typeCounts[type];
      })
      .join(", ");
    if (typeSummary) {
      console.log("           types: " + typeSummary);
    }
    if (stat.category === "monsters") {
      console.log("           packs: " + stat.sourcePacks.join(", "));
    }
  }

  console.log("");
  console.log(
    "TOTAL: " +
      totalItems +
      " items | EN " +
      formatMegabytes(totalFullBytes) +
      " full / " +
      formatMegabytes(totalIndexBytes) +
      " indexes | RU " +
      formatMegabytes(totalRuFullBytes) +
      " full / " +
      formatMegabytes(totalRuIndexBytes) +
      " indexes | " +
      totalTranslated +
      " translated entries",
  );
  console.log(
    "Files: " +
      report.global.filesScanned +
      " scanned, " +
      report.global.parsedObjects +
      " parsed objects, " +
      report.global.skippedArrays +
      " folder manifests, " +
      report.global.invalidFiles +
      " invalid JSON, " +
      report.global.withoutIdentity +
      " without identity, " +
      report.global.unmatchedTypes +
      " unrelated item types",
  );

  if (totalTraitWarnings > 0) {
    console.warn("");
    console.warn("WARNING: " + totalTraitWarnings + " item(s) had missing or malformed traits.");
    for (const stat of stats) {
      for (const warning of stat.traitWarnings) {
        console.warn(
          "  [" + stat.category + "] " + warning.name + " (" + warning.reason + ") -> " + warning.file,
        );
      }
    }
  } else {
    console.log("Traits: every item was parsed with a valid system.traits.value array.");
  }

  const duplicates = stats.reduce(function (sum, stat) {
    return sum + stat.duplicateCount;
  }, 0);
  if (duplicates > 0) {
    console.warn("Duplicate ids were skipped: " + duplicates + ".");
  }
}

function main() {
  if (!fs.existsSync(PACKS_ROOT)) {
    console.error("Reference packs directory not found: " + PACKS_ROOT);
    console.error("Set PF2E_PACKS_DIR to the pf2e pack directory and retry.");
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log("Building compendiums from: " + PACKS_ROOT);
  console.log("Writing compendiums to:   " + OUTPUT_DIR);
  console.log("");

  const report = runBuild(null);
  printReport(report);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildCategory,
  runBuild,
  cleanHtml,
  cleanDeep,
  normalizeItem,
  readTraits,
  readLevel,
  loadCategoryTranslations,
  translateItems,
  CATEGORY_CONFIG,
  PACKS_ROOT,
  OUTPUT_DIR,
  TRANSLATIONS_PACKS_DIR,
};
