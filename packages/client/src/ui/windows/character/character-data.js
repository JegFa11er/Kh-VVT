/**
 * Step 4.8 (Part 1/2): PF2e Remastered character-sheet data model.
 *
 * The shape mirrors the Foundry PF2e actor system closely enough for the
 * React sheet to read/write `actor.system` without translation layers. All
 * dictionaries below are derived from the reference configuration files
 * (`src/scripts/config/iwr.ts`, `damage.ts`, `traits.ts` and the actor
 * template context) rather than invented ad-hoc lists.
 *
 * The actual preparation math lives in the headless core package
 * (`@pf2e/core/src/actor/prepare-data.js`) so the server test-suite and the
 * browser sheet execute exactly the same formulas.
 */

import {
  abilityMod,
  proficiencyBonus,
  clampRank,
  normalizeCharacterSystem,
  createDefaultCharacterSystem,
  armorClassBreakdown,
  prepareStrikes,
  prepareActorSystem,
  prepareActorData,
  skillModifier,
  saveModifier,
  perceptionModifier,
  initiativeModifier,
  effectiveMaxHp,
  totalBulk,
  encumbranceState,
  signed,
  normalizeActorItems,
  normalizePhysicalItem,
  physicalActorItems,
  mergePhysicalActorItems,
  createActorItemFromDocument,
  isPhysicalItemType,
  parseBulkValue,
  applyStrikingRune,
  weaponStrike,
  prepareActorItems,
  prepareFeatSections,
  featSectionForItem,
  spellRankValue,
  spellcastingEntryId,
  createActorFeatFromDocument,
  createActorSpellFromDocument,
  wornArmorItem,
  armorCheckPenaltyState,
  armorCheckPenaltyForSkill,
  spellcastingStats,
  spellcastingRank,
  spellcastingAbility,
  classFeatureItems,
  mergeActorItems,
  computeFeatSlots,
  applyClassDocument,
  applyClassToActor,
} from "@pf2e/core/src/actor/prepare-data.js";

export {
  abilityMod,
  proficiencyBonus,
  clampRank,
  normalizeCharacterSystem,
  createDefaultCharacterSystem,
  armorClassBreakdown,
  prepareStrikes,
  prepareActorSystem,
  prepareActorData,
  skillModifier,
  saveModifier,
  perceptionModifier,
  initiativeModifier,
  effectiveMaxHp,
  totalBulk,
  encumbranceState,
  signed,
  normalizeActorItems,
  normalizePhysicalItem,
  physicalActorItems,
  mergePhysicalActorItems,
  createActorItemFromDocument,
  isPhysicalItemType,
  parseBulkValue,
  applyStrikingRune,
  weaponStrike,
  prepareActorItems,
  prepareFeatSections,
  featSectionForItem,
  spellRankValue,
  spellcastingEntryId,
  createActorFeatFromDocument,
  createActorSpellFromDocument,
  wornArmorItem,
  armorCheckPenaltyState,
  armorCheckPenaltyForSkill,
  spellcastingStats,
  spellcastingRank,
  spellcastingAbility,
  classFeatureItems,
  mergeActorItems,
  computeFeatSlots,
  applyClassDocument,
  applyClassToActor,
};

export const ABILITIES = [
  { key: "str", abbr: "СИЛ", label: "Сила" },
  { key: "dex", abbr: "ЛВК", label: "Ловкость" },
  { key: "con", abbr: "ТЕЛ", label: "Телосложение" },
  { key: "int", abbr: "ИНТ", label: "Интеллект" },
  { key: "wis", abbr: "МДР", label: "Мудрость" },
  { key: "cha", abbr: "ХАР", label: "Харизма" },
];

const ABILITY_KEYS = ABILITIES.map((ability) => ability.key);

/**
 * Step 4.8.2: ability-builder levels. PF2e Remastered grants four free ability
 * boosts at 1st level and four more at 5th, 10th, 15th and 20th level.
 */
export const ABILITY_BUILDER_LEVELS = [1, 5, 10, 15, 20];

function uniqueAbilityKeys(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value === "string" && ABILITY_KEYS.includes(value) && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function normalizeAbilitySlots(node) {
  if (!node || typeof node !== "object") {
    return [];
  }
  const entries = Array.isArray(node)
    ? node
    : Object.keys(node)
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => node[key]);
  const slots = [];
  for (const entry of entries) {
    const raw = Array.isArray(entry)
      ? entry
      : entry && Array.isArray(entry.value)
        ? entry.value
        : [];
    const options = uniqueAbilityKeys(raw);
    if (options.length > 0) {
      slots.push(options);
    }
  }
  return slots;
}

/**
 * PF2e Remastered player backgrounds grant exactly two ability boosts (one
 * restricted slot plus one free boost). Some adventure-path backgrounds in the
 * compendium carry a third legacy slot; the sheet deliberately extracts only
 * the first two so the builder never offers three background boosts.
 */
export function trimBackgroundBoosts(boosts) {
  return normalizeAbilitySlots(boosts).slice(0, 2);
}

/**
 * Read the boost/flaw/key-ability slots from either a compendium document
 * (`{ system: ... }`) or the compact summary stored on `system.details`.
 */
export function readAbilitySource(source) {
  const root = source && typeof source.system === "object" ? source.system : source || {};
  const keyAbilityNode = root.keyAbility !== undefined ? root.keyAbility : source?.keyAbility;
  const explicitType = String(source?.type || root.type || "").toLowerCase();
  const isBackground =
    explicitType === "background" ||
    (root.trainedSkills !== undefined &&
      root.keyAbility === undefined &&
      source?.keyAbility === undefined);
  const boosts = normalizeAbilitySlots(root.boosts);
  return {
    boosts: isBackground ? boosts.slice(0, 2) : boosts,
    flaws: normalizeAbilitySlots(root.flaws),
    keyAbility: uniqueAbilityKeys(
      Array.isArray(keyAbilityNode) ? keyAbilityNode : keyAbilityNode?.value,
    ),
  };
}

/** Normalise the persisted builder state to the shape used by the modal. */
export function normalizeAbilityBuild(rawBuild) {
  const raw = rawBuild && typeof rawBuild === "object" ? rawBuild : {};
  const boosts = raw.boosts && typeof raw.boosts === "object" ? raw.boosts : {};
  const levelsSource = boosts.levels && typeof boosts.levels === "object" ? boosts.levels : {};
  const levels = {};
  for (const level of ABILITY_BUILDER_LEVELS) {
    levels[level] = uniqueAbilityKeys(
      levelsSource[level] !== undefined ? levelsSource[level] : boosts[level],
    ).slice(0, 4);
  }
  return {
    version: Math.max(1, Math.trunc(Number(raw.version) || 1)),
    manual: Boolean(raw.manual),
    boosts: {
      ancestry: uniqueAbilityKeys(boosts.ancestry),
      background: uniqueAbilityKeys(boosts.background),
      class: ABILITY_KEYS.includes(boosts.class) ? boosts.class : null,
      levels,
    },
    flaws: { ancestry: uniqueAbilityKeys(raw.flaws?.ancestry) },
  };
}

/**
 * Assign a flat list of chosen abilities to the document's boost slots.
 *
 * PF2e backgrounds (and some ancestries) mix restricted slots ("Intelligence
 * or Wisdom") with a free slot. A flat list is valid only when every choice
 * can be matched to a distinct slot; restricted slots are matched first, like
 * Foundry's `#findOpenSlot`.
 */
export function matchSelectionsToSlots(slots, selected) {
  const freeSlots = (Array.isArray(slots) ? slots : []).filter(
    (slot) => Array.isArray(slot) && slot.length > 1,
  );
  const remaining = new Set(
    (Array.isArray(selected) ? selected : []).filter((ability) =>
      freeSlots.some((slot) => slot.includes(ability)),
    ),
  );
  const matched = [];
  for (const slot of [...freeSlots].sort((a, b) => a.length - b.length)) {
    const ability = [...remaining].find((entry) => slot.includes(entry));
    if (ability !== undefined) {
      matched.push(ability);
      remaining.delete(ability);
    }
  }
  return matched;
}

function mergeSelectedIntoSlots(slots, selected, target) {
  // Fixed slots are always applied. Their abilities are reserved, so the
  // remaining selections can only fill the genuinely free slots.
  const fixedKeys = slots.filter((slot) => slot.length === 1).map((slot) => slot[0]);
  const remaining = selected.filter((ability) => !fixedKeys.includes(ability));
  for (const slot of slots) {
    if (slot.length === 1) {
      target[slot[0]] = (target[slot[0]] || 0) + 1;
      continue;
    }
    const index = remaining.findIndex((key) => slot.includes(key));
    if (index !== -1) {
      target[remaining[index]] = (target[remaining[index]] || 0) + 1;
      remaining.splice(index, 1);
    }
  }
}

/**
 * Clamp a persisted build to what the currently selected ancestry, background
 * and class actually offer. Fixed boosts and flaws are always included.
 */
export function sanitizeAbilityBuild(rawBuild, sources, level = 1) {
  const build = normalizeAbilityBuild(rawBuild);
  const sourceDocs = sources || {};

  for (const key of ["ancestry", "background"]) {
    const source = readAbilitySource(sourceDocs[key]);
    const slots = source.boosts;
    const fixed = slots.filter((slot) => slot.length === 1).map((slot) => slot[0]);
    const freeSlots = slots.filter((slot) => slot.length > 1);
    const candidates = build.boosts[key]
      .filter((ability) => !fixed.includes(ability))
      .filter((ability, index, list) => list.indexOf(ability) === index);
    build.boosts[key] = [...fixed, ...matchSelectionsToSlots(freeSlots, candidates)];
  }

  const classSource = readAbilitySource(sourceDocs.class);
  if (!classSource.keyAbility.includes(build.boosts.class)) {
    build.boosts.class = null;
  }

  const ancestryFlawSlots = readAbilitySource(sourceDocs.ancestry).flaws;
  const fixedFlaws = ancestryFlawSlots
    .filter((slot) => slot.length === 1)
    .map((slot) => slot[0]);
  const freeFlawCandidates = build.flaws.ancestry.filter(
    (ability) => !fixedFlaws.includes(ability),
  );
  build.flaws.ancestry = [
    ...fixedFlaws,
    ...matchSelectionsToSlots(ancestryFlawSlots, freeFlawCandidates),
  ];

  for (const rowLevel of ABILITY_BUILDER_LEVELS) {
    const row = build.boosts.levels[rowLevel] || [];
    build.boosts.levels[rowLevel] =
      Number(rowLevel) <= Number(level)
        ? row.filter((ability, index, list) => list.indexOf(ability) === index).slice(0, 4)
        : [];
  }

  return build;
}

/**
 * Apply the PF2e Remastered creation cap (18, i.e. a +4 modifier) to ancestry,
 * background, class and 1st-level free boosts, then add the level 5+ boosts.
 */
export function abilityBuildBreakdown(sources, rawBuild, level = 1) {
  const build = sanitizeAbilityBuild(rawBuild, sources, level);
  const sourceDocs = sources || {};
  const creationBoosts = {};
  const flaws = {};
  const levelBoosts = {};

  const ancestry = readAbilitySource(sourceDocs.ancestry);
  mergeSelectedIntoSlots(ancestry.boosts, build.boosts.ancestry, creationBoosts);
  mergeSelectedIntoSlots(ancestry.flaws, build.flaws.ancestry, flaws);

  const background = readAbilitySource(sourceDocs.background);
  mergeSelectedIntoSlots(background.boosts, build.boosts.background, creationBoosts);

  if (build.boosts.class) {
    creationBoosts[build.boosts.class] = (creationBoosts[build.boosts.class] || 0) + 1;
  }

  for (const ability of build.boosts.levels[1] || []) {
    creationBoosts[ability] = (creationBoosts[ability] || 0) + 1;
  }

  const mods = {};
  for (const ability of ABILITY_KEYS) {
    const creation = Math.min(4, creationBoosts[ability] || 0) - (flaws[ability] || 0);
    mods[ability] = creation;
  }

  for (const rowLevel of [5, 10, 15, 20]) {
    if (rowLevel > Number(level)) {
      continue;
    }
    for (const ability of build.boosts.levels[rowLevel] || []) {
      mods[ability] = (mods[ability] || 0) + 1;
      levelBoosts[ability] = (levelBoosts[ability] || 0) + 1;
    }
  }

  return {
    abilities: Object.fromEntries(
      ABILITY_KEYS.map((ability) => [ability, { mod: mods[ability] || 0 }]),
    ),
    build,
    mods,
    creationBoosts,
    flaws,
    levelBoosts,
  };
}

/**
 * Step 5.6: opening the builder must never pre-spend free boosts.
 *
 * Only the *fixed* ancestry/background boosts (single-option slots, e.g. a
 * dwarf's Constitution boost) are applied automatically. Every free boost —
 * the 1st-level four, the class key-ability pick and the 5th/10th/15th/20th
 * level boosts — starts empty so the player clicks them explicitly. Foundry's
 * ability builder behaves the same way; auto-distributing them corrupted the
 * character's starting attributes.
 */
export function defaultAbilityBuild(sources, level = 1) {
  const sourceDocs = sources || {};
  const build = normalizeAbilityBuild({ manual: false });

  for (const key of ["ancestry", "background"]) {
    const slots = readAbilitySource(sourceDocs[key]).boosts;
    for (const slot of slots) {
      if (slot.length === 1 && !build.boosts[key].includes(slot[0])) {
        build.boosts[key].push(slot[0]);
      }
    }
  }

  // Class key ability and every free/level boost stay `null`/empty.
  build.boosts.class = null;
  for (const rowLevel of ABILITY_BUILDER_LEVELS) {
    build.boosts.levels[rowLevel] = [];
  }

  return sanitizeAbilityBuild(build, sourceDocs, level);
}

export const ABILITY_BY_KEY = Object.fromEntries(
  ABILITIES.map((ability) => [ability.key, ability]),
);

export const SAVES = [
  { key: "fortitude", slug: "fortitude", label: "Стойкость", ability: "con" },
  { key: "reflex", slug: "reflex", label: "Реакция", ability: "dex" },
  { key: "will", slug: "will", label: "Воля", ability: "wis" },
];

export const SAVE_BY_KEY = Object.fromEntries(
  SAVES.map((save) => [save.key, save]),
);

export const SKILLS = [
  { key: "acrobatics", label: "Акробатика", name: "Acrobatics", labelKey: "PF2E.Skill.Acrobatics", ability: "dex" },
  { key: "arcana", label: "Аркана", name: "Arcana", labelKey: "PF2E.Skill.Arcana", ability: "int" },
  { key: "athletics", label: "Атлетика", name: "Athletics", labelKey: "PF2E.Skill.Athletics", ability: "str" },
  { key: "crafting", label: "Ремесло", name: "Crafting", labelKey: "PF2E.Skill.Crafting", ability: "int" },
  { key: "deception", label: "Обман", name: "Deception", labelKey: "PF2E.Skill.Deception", ability: "cha" },
  { key: "diplomacy", label: "Дипломатия", name: "Diplomacy", labelKey: "PF2E.Skill.Diplomacy", ability: "cha" },
  { key: "intimidation", label: "Запугивание", name: "Intimidation", labelKey: "PF2E.Skill.Intimidation", ability: "cha" },
  { key: "medicine", label: "Медицина", name: "Medicine", labelKey: "PF2E.Skill.Medicine", ability: "wis" },
  { key: "nature", label: "Природа", name: "Nature", labelKey: "PF2E.Skill.Nature", ability: "wis" },
  { key: "occultism", label: "Оккультизм", name: "Occultism", labelKey: "PF2E.Skill.Occultism", ability: "int" },
  { key: "performance", label: "Выступление", name: "Performance", labelKey: "PF2E.Skill.Performance", ability: "cha" },
  { key: "religion", label: "Религия", name: "Religion", labelKey: "PF2E.Skill.Religion", ability: "wis" },
  { key: "society", label: "Общество", name: "Society", labelKey: "PF2E.Skill.Society", ability: "int" },
  { key: "stealth", label: "Скрытность", name: "Stealth", labelKey: "PF2E.Skill.Stealth", ability: "dex" },
  { key: "survival", label: "Выживание", name: "Survival", labelKey: "PF2E.Skill.Survival", ability: "wis" },
  { key: "thievery", label: "Воровство", name: "Thievery", labelKey: "PF2E.Skill.Thievery", ability: "dex" },
];

export const SKILL_BY_KEY = Object.fromEntries(
  SKILLS.map((skill) => [skill.key, skill]),
);

/** Proficiency ranks, matching Foundry's `PF2E.ProficiencyLevel{0..4}`. */
export const RANKS = [
  { value: 0, short: "U", label: "Не владеет", title: "Нет владения" },
  { value: 1, short: "T", label: "Обучен", title: "Обучен (+2)" },
  { value: 2, short: "E", label: "Эксперт", title: "Эксперт (+4)" },
  { value: 3, short: "M", label: "Мастер", title: "Мастер (+6)" },
  { value: 4, short: "L", label: "Легенда", title: "Легенда (+8)" },
];

export const RANK_BY_VALUE = Object.fromEntries(
  RANKS.map((rank) => [rank.value, rank]),
);

export const SIZES = [
  { value: "tiny", label: "Крошечный" },
  { value: "sm", label: "Маленький" },
  { value: "med", label: "Средний" },
  { value: "lg", label: "Большой" },
  { value: "huge", label: "Огромный" },
  { value: "grg", label: "Громадный" },
];

export const SPEED_TYPES = [
  { key: "land", label: "Скорость" },
  { key: "burrow", label: "Копание" },
  { key: "climb", label: "Лазание" },
  { key: "fly", label: "Полёт" },
  { key: "swim", label: "Плавание" },
];

export const ACTION_COSTS = [
  { value: "1", label: "1 действие" },
  { value: "2", label: "2 действия" },
  { value: "3", label: "3 действия" },
  { value: "reaction", label: "Реакция" },
  { value: "free", label: "Свободное" },
];

export const SPELL_RANKS = [
  { value: "cantrip", label: "Чары" },
  { value: "1", label: "1-й круг" },
  { value: "2", label: "2-й круг" },
  { value: "3", label: "3-й круг" },
  { value: "4", label: "4-й круг" },
  { value: "5", label: "5-й круг" },
  { value: "6", label: "6-й круг" },
  { value: "7", label: "7-й круг" },
  { value: "8", label: "8-й круг" },
  { value: "9", label: "9-й круг" },
  { value: "10", label: "10-й круг" },
];

export const FEAT_SECTIONS = [
  { id: "ancestry", label: "Родословная" },
  { id: "heritage", label: "Наследие" },
  { id: "class", label: "Класс" },
  { id: "skill", label: "Навык" },
  { id: "general", label: "Общие" },
  { id: "bonus", label: "Бонусные" },
];

export const TRADITIONS = [
  { value: "arcane", label: "Аркана" },
  { value: "divine", label: "Божественная" },
  { value: "occult", label: "Оккультная" },
  { value: "primal", label: "Природная" },
];

export const CARRIED_STATUSES = [
  { value: "held", label: "В руках" },
  { value: "worn", label: "Надето" },
  { value: "stowed", label: "В рюкзаке" },
];

/**
 * Foundry's inventory groups reduced to the four headings requested by the
 * sheet. `shield`, `backpack` and `treasure` are folded into the closest
 * physical category instead of getting their own section.
 */
export const ITEM_GROUPS = [
  { id: "weapons", label: "Оружие", icon: "⚔️", types: ["weapon"] },
  { id: "armor", label: "Броня", icon: "🛡️", types: ["armor", "shield"] },
  {
    id: "equipment",
    label: "Снаряжение",
    icon: "🎒",
    types: ["equipment", "backpack", "kit", "treasure"],
  },
  { id: "consumables", label: "Расходники", icon: "🧪", types: ["consumable", "ammo"] },
];

export function itemGroupId(type) {
  const normalized = String(type || "").toLowerCase();
  const group = ITEM_GROUPS.find((entry) => entry.types.includes(normalized));
  return group ? group.id : "equipment";
}

/** Weapons/shields can occupy one or two hands while held. */
export function itemCanHoldHands(type) {
  return ["weapon", "shield", "equipment"].includes(String(type || "").toLowerCase());
}

export const SPELLCASTING_TYPES = [
  { value: "prepared", label: "Подготовленные" },
  { value: "spontaneous", label: "Спонтанные" },
  { value: "innate", label: "Врождённые" },
  { value: "focus", label: "Фокусировка" },
];

export const SPELLCASTING_MODES = [
  { value: "attack", label: "Модификатор атаки заклинаний" },
  { value: "classDC", label: "DC Класса" },
];

/**
 * Step 6.3.1: a spellcasting entry is a Focus set when it is authored with
 * `prepared`/`type`/`mode` = "focus". Foundry importers use `prepared`, the
 * setup modal keeps both `prepared` and `mode` in sync, and older sheets may
 * only carry `type`, so all three spellings are accepted.
 *
 * Focus sets have no spell ranks and no slot counts: every spell lives in one
 * flat list and ranked casts spend the shared Focus pool instead.
 */
export function isFocusSpellcastingEntry(entry) {
  const system = entry && typeof entry === "object" ? entry.system || {} : {};
  return ["prepared", "type", "mode"].some(
    (key) => String(system[key] ?? "").trim().toLowerCase() === "focus",
  );
}

/**
 * Step 6.3.1: inside a Focus set a rank-0 cantrip is cast at will and never
 * spends a point; every ranked (1+) spell costs exactly one Focus Point.
 */
export function focusSpellPointCost(rank) {
  return Math.max(0, Math.trunc(Number(rank) || 0)) === 0 ? 0 : 1;
}

export const SPELLCASTING_TRADITIONS = [
  { value: "arcane", label: "Арканный" },
  { value: "divine", label: "Сакральный" },
  { value: "occult", label: "Оккультный" },
  { value: "primal", label: "Природный" },
];

// ---------------------------------------------------------------------------
// IWR dictionaries (mirrors `src/scripts/config/iwr.ts` + `damage.ts`)
// ---------------------------------------------------------------------------

const IWR_LABELS = {
  // Precious materials
  abysium: "Абузий",
  adamantine: "Адамантин",
  "cold-iron": "Холодное железо",
  dawnsilver: "Рассветное серебро",
  djezet: "Джезет",
  duskwood: "Сумеречное дерево",
  inubrix: "Инубрикс",
  noqual: "Ноквал",
  orichalcum: "Орихалк",
  peachwood: "Персиковое дерево",
  siccatite: "Сиккатит",
  silver: "Серебро",
  // Sanctification and traditions
  holy: "Святое",
  unholy: "Нечестивое",
  arcane: "Арканное",
  divine: "Божественное",
  occult: "Оккультное",
  primal: "Природное",
  // Damage types / conditions / traits
  acid: "Кислота",
  aging: "Старение",
  air: "Воздух",
  alchemical: "Алхимическое",
  "all-damage": "Весь урон",
  "area-damage": "Урон по области",
  "arrow-vulnerability": "Уязвимость к стрелам",
  auditory: "Слуховое",
  "axe-vulnerability": "Уязвимость к топорам",
  axes: "Топоры",
  bleed: "Кровотечение",
  blinded: "Ослеплён",
  bludgeoning: "Дробящий",
  clumsy: "Неуклюжий",
  cold: "Холод",
  confused: "Замешательство",
  controlled: "Контролируемый",
  "critical-hits": "Критические удары",
  curse: "Проклятие",
  custom: "Другое",
  "damage-from-spells": "Урон от заклинаний",
  dazzled: "Ослеплённый",
  deafened: "Оглохший",
  "death-effects": "Эффекты смерти",
  detection: "Обнаружение",
  disease: "Болезнь",
  doomed: "Обречён",
  drained: "Истощён",
  earth: "Земля",
  electricity: "Электричество",
  emotion: "Эмоция",
  energy: "Энергия",
  enfeebled: "Ослаблен",
  fascinated: "Очарован",
  fatigued: "Утомлён",
  "fear-effects": "Эффекты страха",
  fire: "Огонь",
  fleeing: "Бегство",
  force: "Сила",
  "fortune-effects": "Эффекты удачи",
  frightened: "Испуган",
  "ghost-touch": "Призрачное касание",
  glass: "Стекло",
  grabbed: "Схвачен",
  healing: "Лечение",
  illusion: "Иллюзия",
  immobilized: "Обездвижен",
  inhaled: "Вдыхаемое",
  light: "Свет",
  magic: "Магия",
  magical: "Магическое",
  mental: "Ментальный",
  metal: "Металл",
  "misfortune-effects": "Эффекты неудачи",
  mythic: "Мифическое",
  "non-magical": "Немагическое",
  nonlethal: "Нелетальное",
  "nonlethal-attacks": "Нелетальные атаки",
  "object-immunities": "Иммунитеты предметов",
  "off-guard": "Застигнут врасплох",
  olfactory: "Обонятельное",
  paralyzed: "Парализован",
  "persistent-damage": "Продолжительный урон",
  petrified: "Окаменел",
  physical: "Физический",
  piercing: "Колющий",
  plant: "Растение",
  poison: "Яд",
  polymorph: "Полиморф",
  possession: "Одержимость",
  precision: "Точный",
  prediction: "Предсказание",
  "protean-anatomy": "Анатомия протея",
  prone: "Лежит ничком",
  radiation: "Радиация",
  restrained: "Опутан",
  salt: "Соль",
  "salt-water": "Солёная вода",
  scrying: "Наблюдение",
  sickened: "Тошнота",
  slashing: "Режущий",
  sleep: "Сон",
  slowed: "Замедлен",
  sonic: "Звук",
  "spell-deflection": "Отражение заклинаний",
  spells: "Заклинания",
  spirit: "Дух",
  "splash-damage": "Урон брызгами",
  stunned: "Ошеломлён",
  stupefied: "Отуплён",
  "swarm-attacks": "Атаки роя",
  "swarm-mind": "Разум роя",
  time: "Время",
  trip: "Сбивание с ног",
  unarmed: "Без оружия",
  "unarmed-attacks": "Атаки без оружия",
  unconscious: "Без сознания",
  untyped: "Неотмеченный",
  "vampire-weaknesses": "Слабости вампира",
  visual: "Визуальное",
  vitality: "Жизненность",
  void: "Пустота",
  vorpal: "Воральное",
  "vorpal-adamantine": "Воральный адамантин",
  "vorpal-fear": "Воральный страх",
  "vulnerable-to-sunlight": "Уязвимость к солнцу",
  water: "Вода",
  weapons: "Оружие",
  "weapons-shedding-bright-light": "Оружие, излучающее свет",
  wood: "Дерево",
  wounded: "Ранен",
};

function typeEntries(keys) {
  return keys
    .map((key) => ({ value: key, label: IWR_LABELS[key] || key }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
}

const MATERIAL_KEYS = [
  "abysium",
  "adamantine",
  "cold-iron",
  "dawnsilver",
  "djezet",
  "duskwood",
  "inubrix",
  "noqual",
  "orichalcum",
  "peachwood",
  "siccatite",
  "silver",
];

export const IMMUNITY_TYPES = typeEntries([
  ...MATERIAL_KEYS,
  "holy",
  "unholy",
  "arcane",
  "divine",
  "occult",
  "primal",
  "acid",
  "aging",
  "air",
  "alchemical",
  "area-damage",
  "auditory",
  "bleed",
  "blinded",
  "bludgeoning",
  "clumsy",
  "cold",
  "confused",
  "controlled",
  "critical-hits",
  "curse",
  "custom",
  "dazzled",
  "deafened",
  "death-effects",
  "detection",
  "disease",
  "doomed",
  "drained",
  "earth",
  "electricity",
  "emotion",
  "energy",
  "enfeebled",
  "fascinated",
  "fatigued",
  "fear-effects",
  "fire",
  "fleeing",
  "force",
  "fortune-effects",
  "frightened",
  "grabbed",
  "healing",
  "illusion",
  "immobilized",
  "inhaled",
  "light",
  "magic",
  "mental",
  "metal",
  "misfortune-effects",
  "non-magical",
  "nonlethal-attacks",
  "object-immunities",
  "off-guard",
  "olfactory",
  "paralyzed",
  "persistent-damage",
  "petrified",
  "physical",
  "piercing",
  "plant",
  "poison",
  "polymorph",
  "possession",
  "precision",
  "prediction",
  "prone",
  "radiation",
  "restrained",
  "salt-water",
  "scrying",
  "sickened",
  "slashing",
  "sleep",
  "slowed",
  "sonic",
  "spell-deflection",
  "spirit",
  "stunned",
  "stupefied",
  "swarm-attacks",
  "swarm-mind",
  "time",
  "trip",
  "unarmed-attacks",
  "unconscious",
  "visual",
  "vitality",
  "void",
  "water",
  "wood",
  "wounded",
]);

export const WEAKNESS_TYPES = typeEntries([
  ...MATERIAL_KEYS,
  "holy",
  "unholy",
  "arcane",
  "divine",
  "occult",
  "primal",
  "acid",
  "air",
  "alchemical",
  "all-damage",
  "area-damage",
  "arrow-vulnerability",
  "axe-vulnerability",
  "bleed",
  "bludgeoning",
  "cold",
  "critical-hits",
  "custom",
  "earth",
  "electricity",
  "emotion",
  "energy",
  "fire",
  "force",
  "ghost-touch",
  "glass",
  "light",
  "magical",
  "mental",
  "metal",
  "mythic",
  "non-magical",
  "nonlethal-attacks",
  "persistent-damage",
  "physical",
  "piercing",
  "plant",
  "poison",
  "precision",
  "radiation",
  "salt",
  "salt-water",
  "slashing",
  "sonic",
  "spells",
  "spirit",
  "splash-damage",
  "time",
  "unarmed-attacks",
  "vampire-weaknesses",
  "vitality",
  "void",
  "vorpal",
  "vorpal-fear",
  "vulnerable-to-sunlight",
  "water",
  "weapons",
  "weapons-shedding-bright-light",
  "wood",
]);

export const RESISTANCE_TYPES = typeEntries([
  ...MATERIAL_KEYS,
  "holy",
  "unholy",
  "arcane",
  "divine",
  "occult",
  "primal",
  "acid",
  "air",
  "alchemical",
  "all-damage",
  "area-damage",
  "axes",
  "bleed",
  "bludgeoning",
  "cold",
  "critical-hits",
  "custom",
  "damage-from-spells",
  "earth",
  "electricity",
  "energy",
  "fire",
  "force",
  "ghost-touch",
  "light",
  "magical",
  "mental",
  "metal",
  "mythic",
  "non-magical",
  "nonlethal",
  "nonlethal-attacks",
  "persistent-damage",
  "physical",
  "piercing",
  "plant",
  "poison",
  "precision",
  "protean-anatomy",
  "radiation",
  "salt",
  "salt-water",
  "slashing",
  "sonic",
  "spells",
  "spirit",
  "time",
  "unarmed-attacks",
  "vitality",
  "void",
  "vorpal",
  "vorpal-adamantine",
  "water",
  "weapons",
  "weapons-shedding-bright-light",
  "wood",
]);

export const IWR_TYPE_LISTS = {
  immunities: IMMUNITY_TYPES,
  weaknesses: WEAKNESS_TYPES,
  resistances: RESISTANCE_TYPES,
};

export const IWR_LABEL_BY_TYPE = IWR_LABELS;

export function iwrLabel(type) {
  return IWR_LABELS[type] || type;
}

// ---------------------------------------------------------------------------
// Languages and conditions
// ---------------------------------------------------------------------------

/**
 * Every language in `CONFIG.PF2E.languages`
 * (`src/module/actor/creature/values.ts`, `LANGUAGES_BY_RARITY.pf2e`).
 * Values are Foundry slugs so they round-trip through `actor.system.details
 * .languages.value` exactly like the reference system.
 */
export const LANGUAGE_OPTIONS = [
  // Common
  { value: "common", label: "Всеобщий", rarity: "common" },
  { value: "draconic", label: "Драконий", rarity: "common" },
  { value: "dwarven", label: "Дварфийский", rarity: "common" },
  { value: "elven", label: "Эльфийский", rarity: "common" },
  { value: "fey", label: "Фейский", rarity: "common" },
  { value: "gnomish", label: "Гномий", rarity: "common" },
  { value: "goblin", label: "Гоблинский", rarity: "common" },
  { value: "halfling", label: "Полуросликов", rarity: "common" },
  { value: "jotun", label: "Великаний", rarity: "common" },
  { value: "orcish", label: "Орочий", rarity: "common" },
  { value: "sakvroth", label: "Сакврот", rarity: "common" },
  { value: "taldane", label: "Талдане", rarity: "common" },
  // Uncommon
  { value: "adlet", label: "Адлет", rarity: "uncommon" },
  { value: "aklo", label: "Акло", rarity: "uncommon" },
  { value: "alghollthu", label: "Альголлту", rarity: "uncommon" },
  { value: "amurrun", label: "Амуррун", rarity: "uncommon" },
  { value: "arboreal", label: "Лесной", rarity: "uncommon" },
  { value: "boggard", label: "Боггардский", rarity: "uncommon" },
  { value: "calda", label: "Кальда", rarity: "uncommon" },
  { value: "caligni", label: "Калиньи", rarity: "uncommon" },
  { value: "chthonian", label: "Хтонический", rarity: "uncommon" },
  { value: "cyclops", label: "Циклопский", rarity: "uncommon" },
  { value: "daemonic", label: "Демонический", rarity: "uncommon" },
  { value: "diabolic", label: "Диаболический", rarity: "uncommon" },
  { value: "ekujae", label: "Экуджае", rarity: "uncommon" },
  { value: "empyrean", label: "Эмпирейский", rarity: "uncommon" },
  { value: "hallit", label: "Халлит", rarity: "uncommon" },
  { value: "iruxi", label: "Ирукси", rarity: "uncommon" },
  { value: "kelish", label: "Келешский", rarity: "uncommon" },
  { value: "kholo", label: "Кхоло", rarity: "uncommon" },
  { value: "kibwani", label: "Кибвани", rarity: "uncommon" },
  { value: "kitsune", label: "Кицунэ", rarity: "uncommon" },
  { value: "lirgeni", label: "Лиргени", rarity: "uncommon" },
  { value: "muan", label: "Муан", rarity: "uncommon" },
  { value: "mwangi", label: "Мванги", rarity: "uncommon" },
  { value: "mzunu", label: "Мзуну", rarity: "uncommon" },
  { value: "nagaji", label: "Нагаджи", rarity: "uncommon" },
  { value: "necril", label: "Некриль", rarity: "uncommon" },
  { value: "ocotan", label: "Окотан", rarity: "uncommon" },
  { value: "osiriani", label: "Осириани", rarity: "uncommon" },
  { value: "petran", label: "Петран", rarity: "uncommon" },
  { value: "protean", label: "Протейский", rarity: "uncommon" },
  { value: "pyric", label: "Пирический", rarity: "uncommon" },
  { value: "requian", label: "Рекуанский", rarity: "uncommon" },
  { value: "shadowtongue", label: "Шэдоутонг", rarity: "uncommon" },
  { value: "shoanti", label: "Шаонта", rarity: "uncommon" },
  { value: "skald", label: "Скальдский", rarity: "uncommon" },
  { value: "sphinx", label: "Сфинкский", rarity: "uncommon" },
  { value: "sussuran", label: "Сусуран", rarity: "uncommon" },
  { value: "tang", label: "Танг", rarity: "uncommon" },
  { value: "tengu", label: "Тэнгу", rarity: "uncommon" },
  { value: "thalassic", label: "Талассийский", rarity: "uncommon" },
  { value: "tien", label: "Тиенский", rarity: "uncommon" },
  { value: "tripkee", label: "Трипки", rarity: "uncommon" },
  { value: "utopian", label: "Утопийский", rarity: "uncommon" },
  { value: "vanara", label: "Ванара", rarity: "uncommon" },
  { value: "varisian", label: "Варисианский", rarity: "uncommon" },
  { value: "vudrani", label: "Вудранский", rarity: "uncommon" },
  { value: "xanmba", label: "Ксанмба", rarity: "uncommon" },
  { value: "wayang", label: "Ваянг", rarity: "uncommon" },
  { value: "ysoki", label: "Ясоки", rarity: "uncommon" },
  // Rare
  { value: "akitonian", label: "Акитонский", rarity: "rare" },
  { value: "anadi", label: "Ананди", rarity: "rare" },
  { value: "ancient-osiriani", label: "Древнеосириани", rarity: "rare" },
  { value: "androffan", label: "Андроффанский", rarity: "rare" },
  { value: "anugobu", label: "Анугобу", rarity: "rare" },
  { value: "arcadian", label: "Аркадийский", rarity: "rare" },
  { value: "azlanti", label: "Азланти", rarity: "rare" },
  { value: "destrachan", label: "Дестрачан", rarity: "rare" },
  { value: "drooni", label: "Друни", rarity: "rare" },
  { value: "dziriak", label: "Д'зириак", rarity: "rare" },
  { value: "elder-thing", label: "Речь Старшего существа", rarity: "rare" },
  { value: "erutaki", label: "Эрутаки", rarity: "rare" },
  { value: "formian", label: "Формианский", rarity: "rare" },
  { value: "garundi", label: "Гарунди", rarity: "rare" },
  { value: "girtablilu", label: "Гиртаблилу", rarity: "rare" },
  { value: "goloma", label: "Голома", rarity: "rare" },
  { value: "grioth", label: "Гриот", rarity: "rare" },
  { value: "hwan", label: "Хван", rarity: "rare" },
  { value: "iblydan", label: "Иблидоси", rarity: "rare" },
  { value: "ikeshti", label: "Икешти", rarity: "rare" },
  { value: "immolis", label: "Иммолис", rarity: "rare" },
  { value: "jistkan", label: "Джисткан", rarity: "rare" },
  { value: "jyoti", label: "Джйоти", rarity: "rare" },
  { value: "kaava", label: "Каава", rarity: "rare" },
  { value: "kashrishi", label: "Кашриши", rarity: "rare" },
  { value: "kovintal", label: "Ковинтал", rarity: "rare" },
  { value: "lashunta", label: "Лашунта", rarity: "rare" },
  { value: "mahwek", label: "Махвек", rarity: "rare" },
  { value: "migo", label: "Ми-Го", rarity: "rare" },
  { value: "minaten", label: "Минатен", rarity: "rare" },
  { value: "minkaian", label: "Минкайский", rarity: "rare" },
  { value: "munavri", label: "Мунаври", rarity: "rare" },
  { value: "okaiyan", label: "Окайян", rarity: "rare" },
  { value: "orvian", label: "Орвиан", rarity: "rare" },
  { value: "rasu", label: "Расу", rarity: "rare" },
  { value: "ratajin", label: "Ратаджин", rarity: "rare" },
  { value: "razatlani", label: "Разатлани", rarity: "rare" },
  { value: "russian", label: "Русский", rarity: "rare" },
  { value: "samsaran", label: "Самсаран", rarity: "rare" },
  { value: "sasquatch", label: "Сасквоч", rarity: "rare" },
  { value: "senzar", label: "Сензар", rarity: "rare" },
  { value: "shae", label: "Шэй", rarity: "rare" },
  { value: "shisk", label: "Шиск", rarity: "rare" },
  { value: "shobhad", label: "Шобхад", rarity: "rare" },
  { value: "shoony", label: "Шуни", rarity: "rare" },
  { value: "shory", label: "Шори", rarity: "rare" },
  { value: "strix", label: "Стрикс", rarity: "rare" },
  { value: "surki", label: "Сурки", rarity: "rare" },
  { value: "talican", label: "Таликан", rarity: "rare" },
  { value: "tanuki", label: "Тануки", rarity: "rare" },
  { value: "tekritanin", label: "Текританский", rarity: "rare" },
  { value: "thassilonian", label: "Тассилонский", rarity: "rare" },
  { value: "varki", label: "Варки", rarity: "rare" },
  { value: "vishkanyan", label: "Вишканский", rarity: "rare" },
  { value: "wyrwood", label: "Вирвуд", rarity: "rare" },
  { value: "yaksha", label: "Якша", rarity: "rare" },
  { value: "yithian", label: "Йитиан", rarity: "rare" },
  // Secret
  { value: "wildsong", label: "Дикая песнь", rarity: "secret" },
];

export const LANGUAGE_LABEL_BY_SLUG = Object.fromEntries(
  LANGUAGE_OPTIONS.map((entry) => [entry.value, entry.label]),
);

export const LANGUAGE_SLUGS = LANGUAGE_OPTIONS.map((entry) => entry.value);

/**
 * Aliases for values written by older builds of this sheet (Russian display
 * names) and by hand-edited actors (English labels). They are converted to the
 * canonical Foundry slug whenever the Languages modal opens or saves.
 */
const LANGUAGE_ALIASES = {
  // Russian labels from the Step 4.8.1 dictionary
  "всеобщий": "common",
  "акло": "aklo",
  "абиссальный": "chthonian",
  "боггардский": "boggard",
  "великаний": "jotun",
  "гномий": "gnomish",
  "гоблинский": "goblin",
  "драконий": "draconic",
  "дварфийский": "dwarven",
  "диаболический": "diabolic",
  "ирукси": "iruxi",
  "йокайский": "ysoki",
  "калиньи": "caligni",
  "келешский": "kelish",
  "кхоло": "kholo",
  "леший": "arboreal",
  "мванги": "mwangi",
  "нагаджи": "nagaji",
  "некриль": "necril",
  "орочий": "orcish",
  "осириани": "osiriani",
  "полуросликов": "halfling",
  "протейский": "protean",
  "рекуанский": "requian",
  "самсаранский": "samsaran",
  "скальдский": "skald",
  "стрикс": "strix",
  "талдане": "taldane",
  "тенгу": "tengu",
  "тэнгу": "tengu",
  "тиенский": "tien",
  "три-крин": "tripkee",
  "утопийский": "utopian",
  "фейский": "fey",
  "халлит": "hallit",
  "целестиальный": "empyrean",
  "чтонийский": "chthonian",
  "шаонта": "shoanti",
  "шэдоутонг": "shadowtongue",
  "эльфийский": "elven",
  "эмпирейский": "empyrean",
  "якша": "yaksha",
  "ясоки": "ysoki",
};

const LANGUAGE_LABEL_TO_SLUG = Object.fromEntries(
  LANGUAGE_OPTIONS.map((entry) => [entry.label.toLowerCase(), entry.value]),
);

export function normalizeLanguageValue(value) {
  const raw = String(value || "").trim();
  if (raw === "") {
    return "";
  }
  const lower = raw.toLowerCase();
  if (LANGUAGE_LABEL_BY_SLUG[lower]) {
    return lower;
  }
  if (LANGUAGE_LABEL_TO_SLUG[lower]) {
    return LANGUAGE_LABEL_TO_SLUG[lower];
  }
  if (LANGUAGE_ALIASES[lower]) {
    return LANGUAGE_ALIASES[lower];
  }
  return raw;
}

export function languageLabel(value) {
  const normalized = normalizeLanguageValue(value);
  return LANGUAGE_LABEL_BY_SLUG[normalized] || String(value || "");
}

/** Backwards-compatible slug list (older imports used `LANGUAGES`). */
export const LANGUAGES = LANGUAGE_SLUGS;

export const COMMON_LANGUAGES = LANGUAGE_SLUGS;

export const CONDITIONS = [
  { value: "blinded", label: "Ослеплён" },
  { value: "clumsy", label: "Неуклюжий" },
  { value: "confused", label: "Замешательство" },
  { value: "controlled", label: "Контролируемый" },
  { value: "dazzled", label: "Ослеплённый" },
  { value: "deafened", label: "Оглохший" },
  { value: "doomed", label: "Обречён" },
  { value: "drained", label: "Истощён" },
  { value: "dying", label: "Умирает" },
  { value: "encumbered", label: "Перегружен" },
  { value: "enfeebled", label: "Ослаблен" },
  { value: "fascinated", label: "Очарован" },
  { value: "fatigued", label: "Утомлён" },
  { value: "fleeing", label: "Бежит" },
  { value: "frightened", label: "Испуган" },
  { value: "grabbed", label: "Схвачен" },
  { value: "immobilized", label: "Обездвижен" },
  { value: "off-guard", label: "Застигнут врасплох" },
  { value: "paralyzed", label: "Парализован" },
  { value: "persistent-damage", label: "Продолжительный урон" },
  { value: "petrified", label: "Окаменел" },
  { value: "prone", label: "Лежит ничком" },
  { value: "quickened", label: "Ускорен" },
  { value: "restrained", label: "Опутан" },
  { value: "sickened", label: "Тошнота" },
  { value: "slowed", label: "Замедлен" },
  { value: "stunned", label: "Ошеломлён" },
  { value: "stupefied", label: "Отуплён" },
  { value: "unconscious", label: "Без сознания" },
  { value: "wounded", label: "Ранен" },
];

// ---------------------------------------------------------------------------
// PF2e Remastered preparation is implemented in @pf2e/core and re-exported
// above. This file only owns UI dictionaries and default ordering.
// ---------------------------------------------------------------------------

export function nextEntryId(prefix) {
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

export function rollFormula(result, attributeLabel) {
  return "/r 1d20" + (result >= 0 ? "+" : "") + result + " " + attributeLabel;
}

// ---------------------------------------------------------------------------
// Step 5.9: shared input/format helpers
// ---------------------------------------------------------------------------

/**
 * PF2e Remastered spell ranks are gated by character level: a caster unlocks
 * one new rank every two levels (`Math.ceil(level / 2)`), capped at 10th.
 */
export function maxSpellRankForLevel(level) {
  const numeric = Math.trunc(Number(level));
  const bounded = Number.isFinite(numeric)
    ? Math.max(1, Math.min(20, numeric))
    : 1;
  return Math.min(10, Math.max(1, Math.ceil(bounded / 2)));
}

/**
 * Foundry's current-HP field accepts an absolute number or a signed delta
 * (`+10`, `-5`). Returns `null` when the text cannot be parsed.
 */
export function parseHpInput(raw, current) {
  const text = String(raw === undefined || raw === null ? "" : raw).trim();
  if (text === "") {
    return null;
  }
  const delta = /^([+-])\s*(\d+)$/.exec(text);
  if (delta) {
    const amount = Number(delta[2]);
    const origin = Number.isFinite(Number(current)) ? Number(current) : 0;
    return delta[1] === "-" ? origin - amount : origin + amount;
  }
  if (/^\d+$/.test(text)) {
    return Number(text);
  }
  return null;
}

/**
 * Current HP can never exceed maximum HP. The clamp is applied for both the
 * character sheet and the token HUD so healing cannot overflow the bar.
 */
export function clampHpToMax(value, maxHp) {
  const raw = Number(value);
  const max = Number(maxHp);
  const normalizedValue = Number.isFinite(raw) ? Math.trunc(raw) : 0;
  const normalizedMax = Number.isFinite(max) ? Math.max(0, Math.trunc(max)) : 0;
  return Math.max(0, Math.min(normalizedValue, normalizedMax));
}

/** Foundry strike button label: `+3 (MAP -5)` for the second/third attack. */
export function strikeMapLabel(modifier, penalty) {
  const value = Number(penalty);
  const map = Number.isFinite(value) ? value : 0;
  return signed(modifier) + " (MAP " + (map > 0 ? "+" + map : map) + ")";
}
