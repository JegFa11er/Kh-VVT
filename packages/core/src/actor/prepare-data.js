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
const SKILL_KEYS = Object.freeze(SKILL_DEFINITIONS.map((skill) => skill.key));
const FEAT_SECTION_IDS = Object.freeze([
  // Step 5.7: automatically granted class features are their own section and
  // never compete with the player's selectable feat slots.
  "classfeature",
  "ancestry",
  "heritage",
  "class",
  "skill",
  "general",
  "bonus",
]);

/** PF2e Remastered feat-slot cadence used when a class document omits a list. */
const DEFAULT_FEAT_SLOT_LEVELS = Object.freeze({
  ancestry: Object.freeze([1, 5, 9, 13, 17]),
  class: Object.freeze([1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20]),
  skill: Object.freeze([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]),
  general: Object.freeze([3, 7, 11, 15, 19]),
});

/** Canonical creature sizes written by ancestry documents. */
const SIZE_VALUES = Object.freeze(["tiny", "sm", "med", "lg", "huge", "grg"]);
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

// Step 6.3: a Focus pool never exceeds 3 points, no matter how many focus
// spells the actor knows (`src/module/actor/character/document.ts`).
const FOCUS_POOL_CAP = 3;

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

/**
 * Step 5.5: minimum skill ranks granted by the selected background and class.
 *
 * PF2e Remastered backgrounds and class base proficiencies grant fixed trained
 * skills that the player cannot later remove. The sheet stores the floor on
 * each skill as `minRank` and clamps the current rank to it during preparation.
 */
function minimumSkillRanks(system) {
  const floors = {};
  const add = (value) => {
    const key = String(value || "").trim().toLowerCase();
    if (SKILL_KEYS.includes(key) && (floors[key] || 0) < 1) {
      floors[key] = 1;
    }
  };
  const addTraining = (node) => {
    if (node === null || node === undefined) {
      return;
    }
    if (typeof node === "string") {
      add(node);
      return;
    }
    const value = asObject(node).value !== undefined ? asObject(node).value : node;
    if (typeof value === "string") {
      add(value);
      return;
    }
    asArray(value).forEach(add);
  };

  addTraining(asObject(system.details?.background).trainedSkills);
  addTraining(asObject(system.details?.class).trainedSkills);
  return floors;
}

// ---------------------------------------------------------------------------
// Step 5.8: rule-element proficiency floors
// ---------------------------------------------------------------------------

/** Split `a, b, c` while respecting nested calls (`ternary(gte(..), 3, 2)`). */
function splitRuleArguments(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const character of String(text || "")) {
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    }
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim());
}

/**
 * Resolve a Foundry `@actor.*` reference against the current system.
 * Only the numeric paths used by proficiency rule elements are supported.
 */
function resolveRuleReference(reference, system) {
  const path = String(reference || "")
    .trim()
    .replace(/^@actor\./, "")
    .split(".");
  if (path[0] === "level") {
    return asNumber(system.details?.level?.value, 0);
  }
  let cursor = system;
  if (path[0] === "system") {
    path.shift();
  }
  for (const key of path) {
    if (cursor === null || typeof cursor !== "object" || !(key in cursor)) {
      return null;
    }
    cursor = cursor[key];
  }
  if (typeof cursor === "number") {
    return cursor;
  }
  if (typeof cursor === "string" && /^-?\d+(\.\d+)?$/.test(cursor.trim())) {
    return Number(cursor);
  }
  return null;
}

/**
 * Evaluate the small expression language used by proficiency rule elements:
 * numeric literals, `@actor.*` references, `ternary`, comparisons and min/max.
 * Returns a number (booleans become 1/0) or `null` when unsupported, so an
 * unknown formula never grants a wrong rank.
 */
function evaluateRuleExpression(expression, system) {
  if (typeof expression === "number") {
    return Number.isFinite(expression) ? expression : null;
  }
  if (expression !== null && typeof expression === "object") {
    return expression.value === undefined
      ? null
      : evaluateRuleExpression(expression.value, system);
  }
  if (typeof expression !== "string") {
    return null;
  }
  const text = expression.trim();
  if (text === "") {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }
  if (text.startsWith("@")) {
    return resolveRuleReference(text, system);
  }

  const call = /^([A-Za-z]+)\s*\(([\s\S]*)\)$/.exec(text);
  if (!call) {
    return null;
  }
  const name = call[1].toLowerCase();
  const args = splitRuleArguments(call[2]);

  if (name === "ternary" && args.length === 3) {
    const condition = evaluateRuleExpression(args[0], system);
    if (condition === null) {
      return null;
    }
    return evaluateRuleExpression(
      condition === 0 ? args[2] : args[1],
      system,
    );
  }

  const comparisons = {
    gte: (left, right) => left >= right,
    gt: (left, right) => left > right,
    lte: (left, right) => left <= right,
    lt: (left, right) => left < right,
    eq: (left, right) => left === right,
    ne: (left, right) => left !== right,
  };
  if (comparisons[name] && args.length === 2) {
    const left = evaluateRuleExpression(args[0], system);
    const right = evaluateRuleExpression(args[1], system);
    if (left === null || right === null) {
      return null;
    }
    return comparisons[name](left, right) ? 1 : 0;
  }

  if ((name === "max" || name === "min") && args.length === 2) {
    const left = evaluateRuleExpression(args[0], system);
    const right = evaluateRuleExpression(args[1], system);
    if (left === null || right === null) {
      return null;
    }
    return name === "max" ? Math.max(left, right) : Math.min(left, right);
  }

  return null;
}

/** Identifiers of the actor's selected class, used by `class:<slug>` predicates. */
function actorClassIdentifiers(system) {
  const detail = asObject(system.details?.class);
  return [detail.slug, detail.id, detail.name, detail.value]
    .filter((value) => typeof value === "string" && value.trim() !== "")
    .map((value) => value.trim().toLowerCase());
}

/**
 * Step 6.7: active RollOption toggles.
 *
 * Foundry stores the on/off state in `flags.pf2e.rollOptions`; both the flat
 * shape (`{ "nimble-dodge": true }`) and the Foundry domain shape
 * (`{ all: { "nimble-dodge": true } }`) are supported. The prepared
 * `system.toggles` array is also treated as an active source, so rules with
 * `alwaysActive: true` work before the client has written an explicit flag.
 */
function readRollOptionFlags(system) {
  const rollOptions = asObject(
    asObject(asObject(system && system.flags).pf2e).rollOptions,
  );
  const result = Object.create(null);
  const read = (source) => {
    for (const [key, value] of Object.entries(asObject(source))) {
      if (typeof value === "boolean") {
        result[key] = value;
      } else if (value && typeof value === "object" && typeof value.value === "boolean") {
        result[key] = value.value;
      }
    }
  };
  read(rollOptions);
  read(rollOptions.all);
  return result;
}

function activeRollOptions(system) {
  const flags = readRollOptionFlags(system);
  const active = new Set(
    Object.keys(flags).filter((key) => flags[key] === true),
  );
  for (const toggle of asArray(system && system.toggles)) {
    if (toggle && toggle.enabled === true && toggle.option) {
      active.add(String(toggle.option).trim().toLowerCase());
    }
  }
  return active;
}

function isRollOptionEnabled(system, option) {
  const key = String(option || "").trim().toLowerCase();
  if (key === "") {
    return false;
  }
  return activeRollOptions(system).has(key);
}

/**
 * Collect every toggleable `RollOption` rule from the actor's items. The
 * character sheet renders one checkbox per entry in `system.toggles`.
 */
function collectToggleableRollOptions(rawItems, system) {
  const toggles = [];
  const seen = new Set();
  const flags = readRollOptionFlags(system);
  for (const item of asArray(rawItems)) {
    const itemSystem = asObject(item && item.system);
    for (const rule of asArray(itemSystem.rules)) {
      if (
        !rule ||
        rule.key !== "RollOption" ||
        rule.toggleable !== true ||
        !isNonEmptyStringValue(rule.option)
      ) {
        continue;
      }
      const option = String(rule.option).trim().toLowerCase();
      if (seen.has(option)) {
        continue;
      }
      seen.add(option);
      const explicit = Object.prototype.hasOwnProperty.call(flags, option)
        ? flags[option]
        : null;
      const enabled =
        explicit !== null ? explicit : rule.alwaysActive === true;
      toggles.push({
        id: option,
        option,
        label: asString(rule.label) || asString(item && item.name) || option,
        itemId: asString(item && item.id) || null,
        itemName: asString(item && item.name) || null,
        domain: asString(rule.domain) || null,
        enabled,
      });
    }
  }
  return toggles;
}

function isNonEmptyStringValue(value) {
  return typeof value === "string" && value.trim() !== "";
}

function itemTraitsForRules(item) {
  if (!item || typeof item !== "object") {
    return [];
  }
  return traitListFrom(item, asObject(item.system));
}

/** Evaluate the subset of Foundry predicates that can be resolved locally. */
function rulePredicatesPass(predicate, system, item) {
  if (predicate === undefined || predicate === null) {
    return true;
  }
  const list = Array.isArray(predicate) ? predicate : [predicate];
  if (list.length === 0) {
    return true;
  }
  const classes = actorClassIdentifiers(system);
  const options = activeRollOptions(system);
  const traits = itemTraitsForRules(item);
  return list.every((entry) => {
    if (typeof entry === "string") {
      const normalized = entry.trim().toLowerCase();
      const separator = normalized.indexOf(":");
      if (separator === -1) {
        // Bare option names, e.g. `ageless-patience`.
        return options.has(normalized);
      }
      const namespace = normalized.slice(0, separator).trim();
      const value = normalized.slice(separator + 1).trim();
      if (namespace === "class") {
        return classes.includes(value);
      }
      if (namespace === "item") {
        const itemSystem = asObject(item && item.system);
        if (value.startsWith("trait:")) {
          return traits.includes(value.slice("trait:".length));
        }
        if (value.startsWith("type:")) {
          return asString(item && item.type).toLowerCase() === value.slice("type:".length);
        }
        if (value.startsWith("category:")) {
          return (
            asString(asObject(itemSystem).category).toLowerCase() ===
            value.slice("category:".length)
          );
        }
        if (value === "equipped" || value === "held" || value === "worn") {
          return asString(item && item.carried).toLowerCase() === value;
        }
        return false;
      }
      // Unknown predicate namespaces are not granted silently.
      return false;
    }
    if (entry !== null && typeof entry === "object") {
      if (Array.isArray(entry.or)) {
        return entry.or.some((nested) =>
          rulePredicatesPass([nested], system, item),
        );
      }
      if (Array.isArray(entry.and)) {
        return entry.and.every((nested) =>
          rulePredicatesPass([nested], system, item),
        );
      }
      if (entry.not !== undefined) {
        return !rulePredicatesPass([entry.not], system, item);
      }
    }
    return false;
  });
}

function normalizeModifierType(value) {
  const type = String(value || "").trim().toLowerCase();
  return type === "circumstance" ||
    type === "status" ||
    type === "item" ||
    type === "untyped"
    ? type
    : "untyped";
}

/** Expand Foundry statistic selectors into the sheet's concrete keys. */
function expandRuleSelector(selector) {
  const raw = String(selector || "").trim().toLowerCase();
  if (raw === "") {
    return [];
  }
  if (raw === "all") {
    return ["all"];
  }
  if (
    raw === "saving-throw" ||
    raw === "saving-throws" ||
    raw === "save" ||
    raw === "saves"
  ) {
    return SAVE_DEFINITIONS.map((save) => save.key);
  }
  if (
    raw === "skill-check" ||
    raw === "skill-checks" ||
    raw === "skill" ||
    raw === "skills"
  ) {
    return SKILL_KEYS.slice();
  }
  const aliases = {
    "armor-class": "ac",
    "attack-roll": "attack",
    "strike-attack": "attack",
    "strike-attack-roll": "attack",
    strike: "attack",
  };
  return [aliases[raw] || raw];
}

/**
 * Apply `FlatModifier` rule elements whose predicates are satisfied by the
 * active RollOptions. Results are grouped by selector and re-derived on every
 * preparation, so toggling a feat cannot leak a stale bonus.
 */
function collectRuleModifiers(system, rawItems) {
  const modifiers = Object.create(null);
  const push = (selector, entry) => {
    if (!selector) {
      return;
    }
    if (!modifiers[selector]) {
      modifiers[selector] = [];
    }
    modifiers[selector].push(entry);
  };

  for (const item of asArray(rawItems)) {
    const itemSystem = asObject(item && item.system);
    for (const rule of asArray(itemSystem.rules)) {
      if (!rule || rule.key !== "FlatModifier" || rule.ignored === true) {
        continue;
      }
      if (!rulePredicatesPass(rule.predicate, system, item)) {
        continue;
      }
      const value = evaluateRuleExpression(rule.value, system);
      if (value === null || !Number.isFinite(Number(value)) || Number(value) === 0) {
        continue;
      }
      const selectors = Array.isArray(rule.selector)
        ? rule.selector
        : [rule.selector];
      const entry = {
        value: Math.trunc(Number(value)),
        type: normalizeModifierType(rule.type),
        label:
          asString(rule.label) ||
          asString(item && item.name) ||
          "FlatModifier",
        slug: asString(rule.slug) || null,
        itemId: asString(item && item.id) || null,
      };
      for (const selector of selectors) {
        for (const expanded of expandRuleSelector(selector)) {
          push(expanded, entry);
        }
      }
    }
  }

  return modifiers;
}

function ruleModifierEntries(system, selector) {
  const modifiers = asObject(system && system.ruleModifiers);
  const entries = asArray(modifiers[selector]).slice();
  if (selector !== "all") {
    entries.push(...asArray(modifiers.all));
  }
  return entries;
}

/** PF2e typed stacking: best bonus/worst penalty per type, untyped stacks. */
function combineRuleModifierEntries(entries) {
  const bonuses = Object.create(null);
  const penalties = Object.create(null);
  let untyped = 0;
  for (const entry of asArray(entries)) {
    const value = Math.trunc(asNumber(entry && entry.value, 0));
    if (value === 0) {
      continue;
    }
    const type = normalizeModifierType(entry && entry.type);
    if (type === "untyped") {
      untyped += value;
    } else if (value > 0) {
      bonuses[type] = Math.max(bonuses[type] || 0, value);
    } else {
      penalties[type] = Math.min(penalties[type] || 0, value);
    }
  }
  let total = untyped;
  for (const value of Object.values(bonuses)) {
    total += value;
  }
  for (const value of Object.values(penalties)) {
    total += value;
  }
  return total;
}

function ruleModifierTotal(system, selector) {
  return combineRuleModifierEntries(ruleModifierEntries(system, selector));
}

/**
 * Apply attack-roll FlatModifiers to every strike. `baseAttack` makes the
 * operation idempotent for manually authored strikes that are persisted back
 * into `system.strikes`.
 */
function applyRuleModifiersToStrikes(system) {
  const attackBonus = ruleModifierTotal(system, "attack");
  const strikes = asArray(system && system.strikes).map((strike) => {
    if (!strike || typeof strike !== "object") {
      return strike;
    }
    const baseAttack = Number.isFinite(Number(strike.baseAttack))
      ? Number(strike.baseAttack)
      : asNumber(strike.attack, 0);
    const agile = strike.agile === true;
    const map = Number.isFinite(Number(strike.map))
      ? Number(strike.map)
      : agile
        ? -4
        : -5;
    const map2 = Number.isFinite(Number(strike.map2))
      ? Number(strike.map2)
      : agile
        ? -8
        : -10;
    const attack = baseAttack + attackBonus;
    return {
      ...strike,
      baseAttack,
      attack,
      attackMap: attack + map,
      attackMap2: attack + map2,
      map,
      map2,
    };
  });
  system.strikes = strikes;
  return strikes;
}

function rankFloorForNode(node) {
  if (node === null || node === undefined) {
    return 0;
  }
  const raw = typeof node === "object" ? node.rank : node;
  return clampRank(raw);
}

/**
 * Step 5.8: minimum proficiency ranks granted by feats / class features.
 *
 * Two data shapes are supported:
 *  - rule elements: `{ key: "ActiveEffectLike", path: "system.saves.reflex.rank",
 *    value: 2 }` (including level-scaled `ternary(...)` values), and
 *  - Remastered compendium class features, which store fixed grants in
 *    `system.subfeatures.proficiencies` (`{ reflex: { rank: 2 } }`).
 *
 * The result is a per-statistic floor used exactly like `minRank` for skills,
 * so a player cannot manually lower an automatically granted rank.
 */
function ruleElementRankFloors(rawItems, system) {
  const floors = {
    saves: {},
    skills: {},
    attacks: {},
    defenses: {},
    perception: 0,
    spellcasting: 0,
  };

  const apply = (target, key, rank) => {
    if (!key || !Number.isFinite(Number(rank))) {
      return;
    }
    target[key] = Math.max(target[key] || 0, clampRank(rank));
  };

  // Step 5.8.1: class base proficiencies are stored on the actor when the
  // class is selected. They are floors exactly like rule-element grants, so a
  // player cannot un-train a cleric's simple weapons or unarmored defense.
  const classFloors = asObject(
    asObject(asObject(system && system.details).class).proficiencyFloors,
  );
  for (const group of ["attacks", "defenses", "saves"]) {
    const entries = asObject(classFloors[group]);
    for (const [key, rank] of Object.entries(entries)) {
      apply(floors[group], key, rank);
    }
  }
  if (classFloors.perception !== undefined) {
    floors.perception = Math.max(
      floors.perception,
      clampRank(classFloors.perception),
    );
  }

  for (const item of asArray(rawItems)) {
    const itemSystem = asObject(item && item.system);

    for (const rule of asArray(itemSystem.rules)) {
      if (!rule || rule.key !== "ActiveEffectLike") {
        continue;
      }
      if (!rulePredicatesPass(rule.predicate, system)) {
        continue;
      }
      const path = asString(rule.path);
      if (!path.endsWith(".rank")) {
        continue;
      }
      const value = evaluateRuleExpression(rule.value, system);
      if (value === null || !Number.isFinite(Number(value))) {
        continue;
      }
      const rank = clampRank(value);

      let match = /^system\.saves\.([a-z]+)\.rank$/.exec(path);
      if (match) {
        apply(floors.saves, match[1], rank);
        continue;
      }
      match = /^system\.skills\.([a-z-]+)\.rank$/.exec(path);
      if (match) {
        apply(floors.skills, match[1], rank);
        continue;
      }
      if (path === "system.perception.rank") {
        floors.perception = Math.max(floors.perception, rank);
        continue;
      }
      match = /^system\.proficiencies\.(attacks|defenses)\.([a-z-]+)\.rank$/.exec(
        path,
      );
      if (match) {
        apply(floors[match[1]], match[2], rank);
        continue;
      }
      if (path === "system.proficiencies.spellcasting.rank") {
        floors.spellcasting = Math.max(floors.spellcasting, rank);
      }
    }

    const subfeatures = asObject(asObject(itemSystem.subfeatures).proficiencies);
    for (const [key, node] of Object.entries(subfeatures)) {
      const rank = rankFloorForNode(node);
      if (rank <= 0) {
        continue;
      }
      if (SAVE_DEFINITIONS.some((save) => save.key === key)) {
        apply(floors.saves, key, rank);
      } else if (key === "perception") {
        floors.perception = Math.max(floors.perception, rank);
      } else if (DEFENSE_KEYS.includes(key)) {
        apply(floors.defenses, key, rank);
      } else if (ATTACK_KEYS.includes(key)) {
        apply(floors.attacks, key, rank);
      } else if (SKILL_KEYS.includes(key)) {
        apply(floors.skills, key, rank);
      }
    }
  }

  return floors;
}

/**
 * Merge automatically granted ranks into `system`. The `minRank` field mirrors
 * the skill contract so the React sheet can disable lower ranks in every
 * select. Called before strikes / AC / modifier math.
 */
function applyRuleElementRankFloors(system, items) {
  const floors = ruleElementRankFloors(items, system);

  const perceptionFloor = clampRank(floors.perception);
  system.perception = {
    ...system.perception,
    rank: Math.max(clampRank(system.perception?.rank), perceptionFloor),
    minRank: perceptionFloor,
  };

  for (const save of SAVE_DEFINITIONS) {
    const minRank = clampRank(floors.saves[save.key]);
    system.saves[save.key] = {
      ...system.saves[save.key],
      rank: Math.max(clampRank(system.saves[save.key]?.rank), minRank),
      minRank,
    };
  }

  for (const group of ["attacks", "defenses"]) {
    for (const key of Object.keys(system.proficiencies[group] || {})) {
      const entry = asObject(system.proficiencies[group][key]);
      const minRank = clampRank(floors[group][key]);
      system.proficiencies[group][key] = {
        ...entry,
        rank: Math.max(clampRank(entry.rank), minRank),
        minRank,
      };
    }
  }

  const spellcastingFloor = clampRank(floors.spellcasting);
  system.proficiencies.spellcasting = {
    ...system.proficiencies.spellcasting,
    rank: Math.max(
      clampRank(system.proficiencies.spellcasting?.rank),
      spellcastingFloor,
    ),
    minRank: spellcastingFloor,
  };

  return floors;
}

/**
 * Step 5.7: ancestry/heritage traits and ancestry size drive
 * `actor.system.traits`.
 *
 * Foundry ancestries store their tags on the document (`traits: ["gnome",
 * "humanoid"]`) and their size on `system.size` (`"sm"`, `"med"`, ...). The
 * sheet persists a compact summary in `details.ancestry`, so preparation folds
 * those values into the live traits block every time the actor is derived.
 * This makes a gnome Small (`sm`) and keeps the ancestry/heritage tags visible
 * in the Character tab without any manual editing.
 */
function applySourceTraits(system) {
  // `traits.inherited` records the tags contributed by the *previous*
  // ancestry/heritage summary. They are stripped before the current source is
  // applied so switching a gnome to a human does not leave the `gnome` tag
  // behind, while player-authored tags in `traits.value` are preserved.
  const previous = new Set(
    asArray(system.traits.inherited)
      .map((trait) => String(trait || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const inherited = new Set();
  for (const key of ["ancestry", "heritage"]) {
    const detail = asObject(system.details?.[key]);
    const source = detail.traits;
    const traits = Array.isArray(source)
      ? source
          .map((trait) => String(trait || "").trim().toLowerCase())
          .filter(Boolean)
      : traitListFrom({ traits: source }, {});
    for (const trait of traits) {
      inherited.add(trait);
    }
  }
  const manual = asArray(system.traits.value)
    .map((trait) => String(trait || "").trim().toLowerCase())
    .filter((trait) => trait !== "" && !previous.has(trait));
  const ancestry = asObject(system.details?.ancestry);
  const rawSize =
    ancestry.size !== null && typeof ancestry.size === "object"
      ? ancestry.size.value
      : ancestry.size;
  const size = String(rawSize || "").trim().toLowerCase();
  if (SIZE_VALUES.includes(size)) {
    system.traits.size = { value: size };
  }
  system.traits.inherited = [...inherited];
  system.traits.value = [...new Set([...manual, ...inherited])];
  return system;
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
  classfeature: "classfeature",
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
    // Step 6.3: PF2e Remastered focus pool. `max` is derived from the number of
    // known non-cantrip focus spells unless `override` turns on a manual value.
    resources: {
      focus: { value: 0, max: 0, cap: FOCUS_POOL_CAP, override: false },
    },
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

  // Step 6.3: `override` keeps a GM/player-authored maximum; otherwise the
  // preparation pipeline recomputes it from the actor's focus spells.
  system.resources = asObject(system.resources);
  const focusSource = asObject(system.resources.focus);
  system.resources.focus = {
    value: Math.max(0, Math.trunc(asNumber(focusSource.value, 0))),
    max: Math.max(
      0,
      Math.min(FOCUS_POOL_CAP, Math.trunc(asNumber(focusSource.max, 0))),
    ),
    cap: FOCUS_POOL_CAP,
    override: focusSource.override === true,
  };

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
      // Step 5.7: ancestry, class, skill and general slots are all valid.
      type: ["ancestry", "class", "skill", "general"].includes(slot.type)
        ? slot.type
        : "class",
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
    armorCheckPenaltyForSkill(system, skillKey, ability) +
    // Step 6.7: FlatModifier rule elements targeting this skill.
    ruleModifierTotal(system, skillKey)
  );
}

function saveModifier(system, save) {
  const entry = SAVE_DEFINITIONS.find((candidate) => candidate.key === save);
  const rank = clampRank(system.saves?.[save]?.rank);
  return (
    abilityMod(system, entry ? entry.ability : "con") +
    proficiencyBonus(system.details?.level?.value, rank) +
    // Step 6.7: FlatModifier rule elements targeting this save.
    ruleModifierTotal(system, save)
  );
}

function perceptionModifier(system) {
  return (
    abilityMod(system, "wis") +
    proficiencyBonus(system.details?.level?.value, system.perception?.rank) +
    // Step 6.7: FlatModifier rule elements targeting perception.
    ruleModifierTotal(system, "perception")
  );
}

function initiativeModifier(system) {
  const statistic = system.initiative?.statistic || "perception";
  // `initiative` is its own selector, independent of the chosen statistic.
  const initiativeBonus = ruleModifierTotal(system, "initiative");
  if (statistic === "perception") {
    return perceptionModifier(system) + initiativeBonus;
  }
  for (const save of SAVE_DEFINITIONS) {
    if (statistic === save.key) {
      return saveModifier(system, save.key) + initiativeBonus;
    }
  }
  const skill = SKILL_DEFINITIONS.find((entry) => entry.key === statistic);
  if (skill) {
    return skillModifier(system, skill.key, skill.ability) + initiativeBonus;
  }
  return perceptionModifier(system) + initiativeBonus;
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
 * Step 5.6: the shield currently in hand. Raise a Shield requires the shield to
 * be *held*; a shield strapped to the back (`worn`) or stowed cannot be raised.
 * `raised` is authored on the physical item (`actor.items[]`), mirroring
 * Foundry's per-item `system.raised` flag.
 */
function heldShieldItem(items) {
  return (
    asArray(items).find((item) => {
      if (!item || item.type !== "shield" || item.carried !== "held") {
        return false;
      }
      // Prefer an actively raised shield when several are held (one per hand).
      return true;
    }) || null
  );
}

function raisedShieldItem(items) {
  return asArray(items).find(
    (item) =>
      item &&
      item.type === "shield" &&
      item.carried === "held" &&
      item.raised === true,
  ) || null;
}

function shieldAcBonus(shield) {
  if (!shield) {
    return 0;
  }
  const value =
    shield.acBonus !== undefined ? shield.acBonus : asObject(shield.system).acBonus;
  // Raise a Shield grants the shield's item bonus as a circumstance bonus.
  return Math.max(0, Math.trunc(asNumber(value, 0)));
}

/**
 * PF2e armor class: 10 + Dex modifier (capped by *worn* armor) + the armor's
 * item bonus + proficiency with that armor category.
 *
 * Armor only contributes when `carried === "worn"`. Armor stowed in a backpack
 * or merely held in one hand is treated exactly like no armor.
 *
 * A held shield adds its bonus as a circumstance bonus only while it is raised.
 */
function armorClassBreakdown(system, items) {
  const armor = wornArmorItem(system);
  const raisedShield = raisedShieldItem(
    items !== undefined ? items : system.inventory?.items,
  );
  const shieldBonus = shieldAcBonus(raisedShield);

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

  // Temporary custom AC modifiers and FlatModifier rule elements use the
  // canonical PF2e stacking rules: bonuses of one type do not stack (take the
  // best), penalties of one type do not stack (take the worst), untyped values
  // stack, and a bonus and a penalty of the same type are tracked separately.
  const modifiers = asArray(system.attributes?.ac?.modifiers).filter(
    (entry) => entry && Number.isFinite(Number(entry.value)) && Number(entry.value) !== 0,
  );
  const ruleAcModifiers = ruleModifierEntries(system, "ac");
  const byType = {
    circumstance: { bonus: 0, penalty: 0 },
    status: { bonus: 0, penalty: 0 },
    item: { bonus: 0, penalty: 0 },
    untyped: { bonus: 0, penalty: 0 },
  };
  const addModifier = (value, type) => {
    const normalized = normalizeModifierType(type);
    const amount = Math.trunc(asNumber(value, 0));
    if (amount === 0) {
      return;
    }
    if (amount > 0) {
      byType[normalized].bonus = Math.max(byType[normalized].bonus, amount);
    } else {
      byType[normalized].penalty = Math.min(byType[normalized].penalty, amount);
    }
  };

  // Armour's item bonus and a raised shield's circumstance bonus participate
  // in the same typed stacking as custom/rule-element modifiers.
  addModifier(itemBonus, "item");
  addModifier(shieldBonus, "circumstance");
  for (const entry of modifiers) {
    addModifier(entry.value, entry.type);
  }
  for (const entry of ruleAcModifiers) {
    addModifier(entry.value, entry.type);
  }

  const effectiveItemBonus = byType.item.bonus + byType.item.penalty;
  const circumstanceBonus = byType.circumstance.bonus;
  const circumstance = circumstanceBonus + byType.circumstance.penalty;
  const statusBonus = byType.status.bonus;
  const status = statusBonus + byType.status.penalty;
  const untyped = byType.untyped.bonus + byType.untyped.penalty;
  // `customBonus` keeps the historical meaning used by the sheet breakdown:
  // everything on top of the armour item bonus.
  const customBonus =
    circumstance + status + untyped + (effectiveItemBonus - itemBonus);

  return {
    value:
      10 +
      appliedDex +
      effectiveItemBonus +
      proficiency +
      circumstance +
      status +
      untyped,
    base: 10,
    dexMod,
    appliedDex,
    dexCap,
    itemBonus,
    effectiveItemBonus,
    proficiency,
    rank,
    category,
    armorName: armor ? armor.name : null,
    shieldBonus,
    shieldRaised: Boolean(raisedShield),
    shieldName: raisedShield ? raisedShield.name : null,
    circumstanceBonus,
    statusBonus,
    modifiers: modifiers.map((entry) => ({
      id: entry.id,
      name: asString(entry.name, "Модификатор"),
      value: Math.trunc(asNumber(entry.value, 0)),
      type: entry.type === "status" ? "status" : "circumstance",
    })),
    ruleModifiers: ruleAcModifiers.map((entry) => ({
      value: Math.trunc(asNumber(entry.value, 0)),
      type: normalizeModifierType(entry.type),
      label: asString(entry.label, "Правило"),
      slug: entry.slug || null,
      itemId: entry.itemId || null,
    })),
    circumstance,
    status,
    untyped,
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
 * Step 6.3: the Focus pool size is the number of known focus spells, capped at
 * 3 (`SpellPF2e#prepareActorData` increments `resources.focus.max` for every
 * spell with the `focus` trait that is not a cantrip). Duplicate copies of the
 * same spell never widen the pool.
 *
 * @param {object[]} rawItems
 * @returns {number}
 */
function focusSpellCount(rawItems) {
  const names = new Set();
  for (const item of asArray(rawItems)) {
    if (!item || item.type !== "spell") {
      continue;
    }
    const system = asObject(item.system);
    const traits = traitListFrom(item, system);
    if (!traits.includes("focus") || traits.includes("cantrip")) {
      continue;
    }
    if (spellRankValue(item) === 0) {
      continue;
    }
    const key = asString(item.name).trim().toLowerCase() || asString(item.id);
    if (key !== "") {
      names.add(key);
    }
  }
  return Math.min(FOCUS_POOL_CAP, names.size);
}

/** Apply the derived (or manually overridden) focus maximum to `system`. */
function applyFocusPool(system, items) {
  const current = asObject(system.resources?.focus);
  const known = focusSpellCount(items);
  const authored = Math.max(
    0,
    Math.min(FOCUS_POOL_CAP, Math.trunc(asNumber(current.max, 0))),
  );
  const max = current.override === true ? authored : known;
  system.resources = asObject(system.resources);
  system.resources.focus = {
    ...current,
    value: Math.max(0, Math.min(max, Math.trunc(asNumber(current.value, 0)))),
    max,
    cap: FOCUS_POOL_CAP,
    override: current.override === true,
    known,
  };
  return system.resources.focus;
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
    type: item.type === "action" ? "action" : "feat",
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
    if (!item) {
      continue;
    }
    // Step 5.7: class features can be passive feats or activated actions; both
    // belong to the "Особенности класса" section at the top of the Feats tab.
    const isClassFeature =
      asString(asObject(item.system).category).trim().toLowerCase() ===
      "classfeature";
    if (item.type !== "feat" && !(item.type === "action" && isClassFeature)) {
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
    asString(opts.category) ||
    asString(system.category) ||
    asString(doc.category) ||
    "bonus";
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

function classFeatureRecord(key, feature) {
  const system = asObject(feature && feature.system);
  const levelNode =
    system.level !== undefined ? system.level : feature && feature.level;
  const level =
    levelNode !== null && typeof levelNode === "object"
      ? levelNode.value
      : levelNode;
  return {
    key:
      asString(key) ||
      asString(feature && feature.id) ||
      slugify(feature && feature.name),
    name: asString(feature && feature.name),
    level: Math.trunc(asNumber(level, 1)),
    img: asString(feature && feature.img) || null,
    uuid: asString(feature && feature.uuid) || asString(feature && feature.id),
    traits: asString(feature && feature.traits) ||
      traitListFrom(feature || {}, system).join(", "),
    description:
      asString(feature && feature.description) ||
      readDocumentDescription(feature || {}, system),
    actionType: asString(
      feature?.actionType ||
        system.actionType?.value ||
        system.actionType,
    ),
    // Step 5.8: keep automated proficiency grants on the generated item so
    // class features such as "Reflex Expertise" behave like dropped feats.
    rules: asArray(system.rules).filter(
      (rule) => rule !== null && typeof rule === "object",
    ),
    subfeatures:
      system.subfeatures !== null && typeof system.subfeatures === "object"
        ? clone(system.subfeatures)
        : null,
  };
}

/**
 * Candidate list from the top-level `classDoc.items` collection. Full Foundry
 * class documents embed both class features and ordinary class feats here, so
 * only `system.category === "classfeature"` entries are accepted.
 */
function classDocumentFeatureEntries(classDoc) {
  const raw = classDoc && classDoc.items;
  const list = Array.isArray(raw)
    ? raw
    : Object.entries(asObject(raw)).map(([key, item]) => ({ key, item }));
  const result = [];
  for (const entry of list) {
    const key = entry && entry.key;
    const item = entry && entry.item !== undefined ? entry.item : entry;
    const system = asObject(item && item.system);
    const category = asString(system.category || item?.category)
      .trim()
      .toLowerCase();
    // A missing category is only acceptable for the legacy summary map
    // (`classDoc.system.items`), which never contains ordinary feats.
    if (category !== "classfeature") {
      continue;
    }
    const record = classFeatureRecord(key, item);
    if (record.name !== "") {
      result.push(record);
    }
  }
  return result;
}

function readClassFeatureEntries(classDoc) {
  const summary = Object.entries(
    asObject(asObject(classDoc && classDoc.system).items),
  )
    .filter(([, feature]) => feature && typeof feature.name === "string")
    .map(([key, feature]) => classFeatureRecord(key, feature));
  const combined = [...classDocumentFeatureEntries(classDoc), ...summary];
  const seen = new Set();
  return combined
    .filter((feature) => {
      const keys = [
        asString(feature.uuid),
        asString(feature.name).trim().toLowerCase(),
      ].filter(Boolean);
      if (keys.length === 0 || keys.some((key) => seen.has(key))) {
        return false;
      }
      keys.forEach((key) => seen.add(key));
      return true;
    })
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
        // Full Foundry class-feature documents use `classfeature`; ordinary
        // class feats use `class` and must not be auto-added here.
        category: "classfeature",
        level: { value: feature.level },
        actionType: feature.actionType
          ? { value: feature.actionType }
          : undefined,
        ...(Array.isArray(feature.rules) && feature.rules.length > 0
          ? { rules: clone(feature.rules) }
          : {}),
        ...(feature.subfeatures && typeof feature.subfeatures === "object"
          ? { subfeatures: clone(feature.subfeatures) }
          : {}),
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

/**
 * Read a class document's feat-slot cadence. Step 5.7 uses the same helper for
 * slot generation and for persisting the cadence into `details.class.featLevels`
 * so later derivations can rebuild slots without re-fetching the compendium.
 */
function featSlotLevels(classDoc) {
  const classSystem = asObject(classDoc && classDoc.system);
  const readLevels = (node, fallback) => {
    const listed = asArray(asObject(node).value)
      .map((entry) => Math.trunc(asNumber(entry, 0)))
      .filter((entry) => entry >= 1);
    return listed.length > 0 ? listed : [...fallback];
  };
  return {
    ancestry: readLevels(
      classSystem.ancestryFeatLevels,
      DEFAULT_FEAT_SLOT_LEVELS.ancestry,
    ),
    class: readLevels(
      classSystem.classFeatLevels,
      DEFAULT_FEAT_SLOT_LEVELS.class,
    ),
    skill: readLevels(
      classSystem.skillFeatLevels,
      DEFAULT_FEAT_SLOT_LEVELS.skill,
    ),
    general: readLevels(
      classSystem.generalFeatLevels,
      DEFAULT_FEAT_SLOT_LEVELS.general,
    ),
  };
}

const FEAT_SLOT_TYPE_ORDER = Object.freeze([
  "ancestry",
  "class",
  "skill",
  "general",
]);

function computeFeatSlots(classDoc, level, existingSlots) {
  const target = Math.max(1, Math.trunc(asNumber(level, 1)));
  const existingById = new Map(
    asArray(existingSlots).map((slot) => [slot.id, slot]),
  );
  const levelsByType = featSlotLevels(classDoc);

  const slots = [];
  for (const type of FEAT_SLOT_TYPE_ORDER) {
    for (const slotLevel of levelsByType[type]) {
      // A slot only exists once the actor has reached its level. Levelling
      // down therefore removes the slot (and any feat bound to it).
      if (slotLevel > target) {
        continue;
      }
      const id = "feat-slot-" + type + "-" + slotLevel;
      const previous = existingById.get(id);
      slots.push({
        id,
        type,
        level: slotLevel,
        featId: previous && previous.featId ? previous.featId : null,
      });
    }
  }

  return slots.sort(
    (a, b) =>
      a.level - b.level ||
      FEAT_SLOT_TYPE_ORDER.indexOf(a.type) -
        FEAT_SLOT_TYPE_ORDER.indexOf(b.type),
  );
}

/**
 * Step 5.7: rebuild the four slot groups from `details.class.featLevels` (or
 * the Remastered defaults) on every derivation. This makes slots appear and
 * disappear immediately when the actor's level changes, including actors saved
 * before the four-group slot model existed.
 */
function ensureFeatSlots(system) {
  const classDetail = asObject(system.details?.class);
  const hasClass = Boolean(
    asString(classDetail.id) ||
      asString(classDetail.name) ||
      asString(classDetail.value),
  );
  if (!hasClass && asArray(system.featSlots).length === 0) {
    return system;
  }
  const target = Math.max(
    1,
    Math.trunc(asNumber(system.details?.level?.value, 1)),
  );
  const stored = asObject(classDetail.featLevels);
  const readStored = (key, fallback) => {
    const listed = asArray(stored[key])
      .map((entry) => Math.trunc(asNumber(entry, 0)))
      .filter((entry) => entry >= 1);
    return listed.length > 0 ? listed : [...fallback];
  };
  const levelsByType = {
    ancestry: readStored("ancestry", DEFAULT_FEAT_SLOT_LEVELS.ancestry),
    class: readStored("class", DEFAULT_FEAT_SLOT_LEVELS.class),
    skill: readStored("skill", DEFAULT_FEAT_SLOT_LEVELS.skill),
    general: readStored("general", DEFAULT_FEAT_SLOT_LEVELS.general),
  };
  const existingById = new Map(
    asArray(system.featSlots).map((slot) => [slot.id, slot]),
  );
  const slots = [];
  for (const type of FEAT_SLOT_TYPE_ORDER) {
    for (const slotLevel of levelsByType[type]) {
      if (slotLevel > target) {
        continue;
      }
      const id = "feat-slot-" + type + "-" + slotLevel;
      const previous = existingById.get(id);
      slots.push({
        id,
        type,
        level: slotLevel,
        featId: previous && previous.featId ? previous.featId : null,
      });
    }
  }
  system.featSlots = slots.sort(
    (a, b) =>
      a.level - b.level ||
      FEAT_SLOT_TYPE_ORDER.indexOf(a.type) -
        FEAT_SLOT_TYPE_ORDER.indexOf(b.type),
  );
  return system;
}

/**
 * Step 5.8.1: fixed base proficiencies from a class document.
 *
 * The class pipeline used to apply these ranks once, which let a player lower
 * them afterwards. Persisting the grant on `details.class.proficiencyFloors`
 * lets every preparation re-apply it as a normal `minRank` floor for saves,
 * Perception, attacks and defenses (skills already use their own floor from
 * trainedSkills/backgrounds).
 */
function classProficiencyFloors(classDoc) {
  const classSystem = asObject(classDoc && classDoc.system);
  const attacks = asObject(classSystem.attacks);
  const defenses = asObject(classSystem.defenses);
  const savingThrows = asObject(classSystem.savingThrows);
  const floors = {
    attacks: {},
    defenses: {},
    saves: {},
    perception: 0,
  };
  for (const key of ATTACK_KEYS) {
    if (attacks[key] !== undefined) {
      floors.attacks[key] = clampRank(attacks[key]);
    }
  }
  for (const key of DEFENSE_KEYS) {
    if (defenses[key] !== undefined) {
      floors.defenses[key] = clampRank(defenses[key]);
    }
  }
  for (const save of SAVE_DEFINITIONS) {
    if (savingThrows[save.key] !== undefined) {
      floors.saves[save.key] = clampRank(savingThrows[save.key]);
    }
  }
  if (classSystem.perception !== undefined) {
    floors.perception = clampRank(classSystem.perception);
  }
  return floors;
}

function applyClassProficiencies(system, classDoc) {
  const classSystem = asObject(classDoc && classDoc.system);
  const attacks = asObject(classSystem.attacks);
  const defenses = asObject(classSystem.defenses);
  const savingThrows = asObject(classSystem.savingThrows);

  for (const key of ATTACK_KEYS) {
    if (attacks[key] !== undefined) {
      const current = asObject(system.proficiencies.attacks[key]);
      const classRank = clampRank(attacks[key]);
      system.proficiencies.attacks[key] = {
        ...current,
        rank: maxRank(current.rank, classRank),
        minRank: Math.max(clampRank(current.minRank), classRank),
      };
    }
  }
  for (const key of DEFENSE_KEYS) {
    if (defenses[key] !== undefined) {
      const current = asObject(system.proficiencies.defenses[key]);
      const classRank = clampRank(defenses[key]);
      system.proficiencies.defenses[key] = {
        ...current,
        rank: maxRank(current.rank, classRank),
        minRank: Math.max(clampRank(current.minRank), classRank),
      };
    }
  }
  if (classSystem.perception !== undefined) {
    const classRank = clampRank(classSystem.perception);
    system.perception = {
      ...system.perception,
      rank: maxRank(system.perception.rank, classRank),
      minRank: Math.max(clampRank(system.perception?.minRank), classRank),
    };
  }
  for (const save of SAVE_DEFINITIONS) {
    if (savingThrows[save.key] !== undefined) {
      const current = asObject(system.saves[save.key]);
      const classRank = clampRank(savingThrows[save.key]);
      system.saves[save.key] = {
        ...current,
        rank: maxRank(current.rank, classRank),
        minRank: Math.max(clampRank(current.minRank), classRank),
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
    // Step 5.5: fixed class training becomes a floor on the skill rank so the
    // sheet cannot untrain a skill granted by the class.
    ...(classSystem.trainedSkills !== undefined
      ? { trainedSkills: clone(asObject(classSystem.trainedSkills)) }
      : {}),
    // Step 5.7: remember the class feat cadence so slots can be rebuilt on
    // every derivation without another compendium request.
    featLevels: featSlotLevels(classDoc),
    // Step 5.8.1: non-droppable base proficiencies for attacks and defenses
    // (plus saves/Perception) are re-applied as floors on every preparation.
    proficiencyFloors: classProficiencyFloors(classDoc),
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
  const feats = asArray(system.feats.classfeature);
  if (!feats.some((entry) => entry.id === item.id)) {
    system.feats.classfeature = [
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
 * Foundry stores a feat's slot binding on `system.location`; the sheet also
 * keeps a flat `slotId`. Read either shape.
 */
function itemSlotId(item) {
  if (!item) {
    return "";
  }
  const flat = asString(item.slotId);
  if (flat !== "") {
    return flat;
  }
  // Spells also use `system.location` (their spellcasting entry id) and must
  // never be mistaken for a feat slot binding.
  if (item.type !== "feat") {
    return "";
  }
  const system = asObject(item.system);
  const location =
    typeof system.location === "string"
      ? system.location
      : asString(asObject(system.location).value);
  return location.startsWith("feat-slot-") ? location : "";
}

/**
 * Remove feat items whose bound slot no longer exists (e.g. the actor was
 * levelled down). Called from `prepareActorSystem` so the rule holds even for
 * payloads edited outside the class pipeline.
 */
function pruneOrphanSlotFeats(system, items) {
  // Without any slot model (a classless NPC, or a pre-Step-5.7 payload) a
  // stored slot id cannot be validated, so the feat is kept as a loose entry.
  if (asArray(system.featSlots).length === 0) {
    return asArray(items);
  }
  const validSlotIds = new Set(
    asArray(system.featSlots).map((slot) => slot.id),
  );
  const removed = new Set();
  const kept = [];
  for (const item of asArray(items)) {
    if (!item) {
      continue;
    }
    const slotId = itemSlotId(item);
    if (slotId !== "" && !validSlotIds.has(slotId)) {
      removed.add(item.id);
      continue;
    }
    kept.push(item);
  }
  if (removed.size > 0) {
    for (const section of FEAT_SECTION_IDS) {
      system.feats[section] = asArray(system.feats[section]).filter(
        (feat) => !removed.has(feat.id),
      );
    }
    system.featSlots = asArray(system.featSlots).map((slot) =>
      removed.has(slot.featId) ? { ...slot, featId: null } : slot,
    );
  }
  return kept;
}

/**
 * Step 5.7: keep `actor.items` consistent with the current level and class.
 *
 * - levelling down removes class features above the new level,
 * - a feat bound to a slot that no longer exists is unbound and deleted,
 * - switching classes removes features of the previous class.
 */
function pruneInactiveClassFeatures(system, items, classDoc, level) {
  const classId =
    asString(classDoc && classDoc.id) || slugify(classDoc && classDoc.name);
  const validSlotIds = new Set(
    asArray(system.featSlots).map((slot) => slot.id),
  );
  const removed = new Set();
  const kept = [];
  for (const item of asArray(items)) {
    if (!item) {
      continue;
    }
    const itemSystem = asObject(item.system);
    const isClassFeature =
      asString(itemSystem.category).trim().toLowerCase() === "classfeature";
    const itemClassId =
      asString(item.classId) || asString(itemSystem.classId);
    const featureLevel = Math.trunc(
      asNumber(item.level, asNumber(asObject(itemSystem.level).value, 1)),
    );
    if (isClassFeature && itemClassId !== "" && itemClassId !== classId) {
      removed.add(item.id);
      continue;
    }
    if (isClassFeature && itemClassId === classId && featureLevel > level) {
      removed.add(item.id);
      continue;
    }
    const slotId = itemSlotId(item);
    if (slotId !== "" && !validSlotIds.has(slotId)) {
      removed.add(item.id);
      continue;
    }
    kept.push(item);
  }
  if (removed.size > 0) {
    for (const section of FEAT_SECTION_IDS) {
      system.feats[section] = asArray(system.feats[section]).filter(
        (feat) => !removed.has(feat.id),
      );
    }
    for (const section of ["encounter", "exploration", "downtime"]) {
      system.actions[section] = asArray(system.actions[section]).filter(
        (action) => !removed.has(action.id),
      );
    }
    system.featSlots = asArray(system.featSlots).map((slot) =>
      removed.has(slot.featId) ? { ...slot, featId: null } : slot,
    );
  }
  return kept;
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
  const items = pruneInactiveClassFeatures(
    system,
    mergeActorItems(source.items, features),
    classDoc,
    level,
  );
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
  // Step 5.7: an ancestry/heritage selection contributes its tags and the
  // ancestry's size (e.g. a gnome is Small) to the live trait block.
  applySourceTraits(system);
  // Step 5.7: slots are derived from the current level on every preparation.
  ensureFeatSlots(system);
  // When a caller passes `actor.items`, it is the authoritative physical-item
  // collection (Foundry model). When it is omitted, legacy callers that only
  // keep `system.inventory.items` still work.
  const hasActorItems = rawItems !== undefined && rawItems !== null;
  let items = normalizeActorItems(
    hasActorItems ? rawItems : system.inventory.items,
  );
  // A feat whose slot was closed by a level change is detached automatically.
  items = pruneOrphanSlotFeats(system, items);
  const inventoryItems = hasActorItems
    ? physicalActorItems(rawItems)
    : asArray(system.inventory.items).map(normalizePhysicalItem);
  system.inventory.items = inventoryItems;

  // Step 6.7: every toggleable RollOption becomes a checkbox in the Combat tab.
  // The on/off state is read from `system.flags.pf2e.rollOptions`.
  system.toggles = collectToggleableRollOptions(items, system);

  // Step 6.3: the focus pool is derived from the actor's focus spells on every
  // derivation unless a manual maximum was authored.
  applyFocusPool(system, items);

  // Step 5.8: feats and class features may grant fixed proficiency ranks via
  // `system.rules` (ActiveEffectLike) or Remastered `system.subfeatures`. They
  // are applied as floors before AC, strikes, saves and skill modifiers read
  // the proficiency ranks.
  const ruleFloors = applyRuleElementRankFloors(system, items);

  // Step 6.7: FlatModifier rule elements only apply when their predicate is
  // satisfied by an active (enabled) RollOption. They are collected before AC,
  // saves, perception, skills and strikes are derived.
  system.ruleModifiers = collectRuleModifiers(system, items);

  // Step 5.6: a held shield feeds the sidebar's shield HP block and, while
  // raised, contributes its AC bonus (as a circumstance bonus).
  const shieldItem =
    raisedShieldItem(inventoryItems) || heldShieldItem(inventoryItems);
  if (shieldItem) {
    const shieldSource = asObject(shieldItem.system);
    const shieldHp = asObject(shieldSource.hp);
    const shieldMax = Math.max(0, Math.trunc(asNumber(shieldHp.max, 0)));
    const currentShield = asObject(system.attributes.shield);
    const currentHp = asObject(currentShield.hp);
    const maxUnchanged =
      Math.trunc(asNumber(currentHp.max, -1)) === shieldMax && shieldMax > 0;
    const shieldValue = maxUnchanged
      ? Math.trunc(asNumber(currentHp.value, shieldMax))
      : Math.trunc(asNumber(shieldHp.value, shieldMax));
    system.attributes.shield = {
      ...currentShield,
      ac: shieldAcBonus(shieldItem),
      hardness: Math.max(
        0,
        Math.trunc(asNumber(shieldSource.hardness, shieldItem.hardness)),
      ),
      hp: {
        max: shieldMax,
        value: Math.max(0, Math.min(shieldMax, shieldValue)),
      },
      brokenThreshold: Math.floor(shieldMax / 2),
      broken: shieldMax > 0 && shieldValue <= Math.floor(shieldMax / 2),
      raised: shieldItem.raised === true,
      name: shieldItem.name || null,
      itemId: shieldItem.id || null,
    };
  } else if (system.attributes.shield) {
    system.attributes.shield = {
      ...system.attributes.shield,
      raised: false,
    };
  }

  const hpBreakdown = maxHpBreakdown(system, items);
  if (hpBreakdown) {
    system.attributes.hp.max = hpBreakdown.max;
  }

  system.strikes = prepareStrikes(system);
  applyRuleModifiersToStrikes(system);

  const ac = armorClassBreakdown(system, items);
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
  const skillFloors = minimumSkillRanks(system);
  for (const skill of SKILL_DEFINITIONS) {
    const armorPenalty = armorCheckPenaltyForSkill(
      system,
      skill.key,
      skill.ability,
      armorCheckPenalty,
    );
    const minRank = Math.max(
      clampRank(skillFloors[skill.key]),
      clampRank(ruleFloors.skills[skill.key]),
    );
    const rank = Math.max(clampRank(system.skills[skill.key]?.rank), minRank);
    system.skills[skill.key] = {
      ...system.skills[skill.key],
      rank,
      minRank,
      ability: skill.ability,
      armorPenalty,
    };
    system.skills[skill.key].mod = skillModifier(
      system,
      skill.key,
      skill.ability,
    );
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
  minimumSkillRanks,
  ruleElementRankFloors,
  rulePredicatesPass,
  readRollOptionFlags,
  activeRollOptions,
  collectToggleableRollOptions,
  collectRuleModifiers,
  combineRuleModifierEntries,
  ruleModifierEntries,
  ruleModifierTotal,
  applyRuleModifiersToStrikes,
  expandRuleSelector,
  normalizeModifierType,
  evaluateRuleExpression,
  applySourceTraits,
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
  focusSpellCount,
  applyFocusPool,
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
