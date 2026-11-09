/**
 * PF2E REMASTERED — EQUIPMENT & HANDS (HEADLESS CORE)
 *
 * Shared, presentation-free helpers for held items:
 *   - every creature has two hands (`mainHand`, `offHand`);
 *   - one-handed weapons/shields occupy one hand;
 *   - two-handed weapons and weapons with the `two-hand-dN` trait occupy both;
 *   - Trip/Shove/Grapple need a free hand unless the wielded weapon carries the
 *     matching trait.
 *
 * Inventory items are plain authored records. Keeping this module independent
 * from Combatant and Shield avoids a circular dependency and lets tests build
 * isolated item fixtures.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Equipment = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const HAND_SLOTS = Object.freeze({
    MAIN: "mainHand",
    OFF: "offHand",
  });

  const HAND_SLOT_NAMES = Object.freeze([HAND_SLOTS.MAIN, HAND_SLOTS.OFF]);

  const ITEM_HANDS = Object.freeze({
    ONE: 1,
    TWO: 2,
  });

  const ITEM_TYPES = Object.freeze({
    WEAPON: "weapon",
    SHIELD: "shield",
    ARMOR: "armor",
    GEAR: "gear",
  });

  function normalizeText(value) {
    return String(value).trim().toLowerCase().replace(/[-_\s]+/g, " ");
  }

  function slugify(value) {
    return String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function assertNonEmptyString(value, label) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(label + " must be a non-empty string.");
    }
  }

  /**
   * Flatten every authored trait form into text tokens.
   *
   * @param {object} item
   * @returns {string[]}
   */
  function traitTokens(item) {
    const source =
      item && item.traits !== undefined
        ? item.traits
        : item && item.traitDefinitions !== undefined
          ? item.traitDefinitions
          : [];
    const values = Array.isArray(source)
      ? source
      : source === undefined || source === null
        ? []
        : [source];

    const tokens = [];
    for (const value of values) {
      if (value === null || value === undefined) {
        continue;
      }
      if (typeof value === "string") {
        tokens.push(value);
      } else if (typeof value === "object") {
        if (typeof value.slug === "string") tokens.push(value.slug);
        if (typeof value.name === "string") tokens.push(value.name);
        if (typeof value.label === "string") tokens.push(value.label);
      }
    }
    return tokens;
  }

  function isTwoHandedTraitToken(token) {
    const text = normalizeText(token);
    return /^two hand(?:ed)?(?: d(?:4|6|8|10|12))?$/.test(text);
  }

  /**
   * Number of hands an item occupies.
   *
   * Explicit `hands` wins. `twoHanded`/`handUse: "two"` and the `two-hand-dN`
   * trait are also accepted. Shields and ordinary weapons default to one hand.
   *
   * @param {object|string} item
   * @returns {1|2}
   */
  function getItemHands(item) {
    if (item === null || item === undefined || typeof item === "string") {
      return ITEM_HANDS.ONE;
    }
    if (typeof item !== "object") {
      return ITEM_HANDS.ONE;
    }

    const explicit =
      item.hands !== undefined
        ? item.hands
        : item.handsRequired !== undefined
          ? item.handsRequired
          : item.handCount;
    if (explicit === 2 || explicit === "2" || explicit === "two") {
      return ITEM_HANDS.TWO;
    }
    if (item.twoHanded === true || item.handUse === "two") {
      return ITEM_HANDS.TWO;
    }
    if (item.type === ITEM_TYPES.SHIELD) {
      return ITEM_HANDS.ONE;
    }
    if (traitTokens(item).some(isTwoHandedTraitToken)) {
      return ITEM_HANDS.TWO;
    }
    if (explicit === 1 || explicit === "1" || explicit === "one") {
      return ITEM_HANDS.ONE;
    }
    if (item.handUse === "one") {
      return ITEM_HANDS.ONE;
    }
    return ITEM_HANDS.ONE;
  }

  function isTwoHandedItem(item) {
    return getItemHands(item) === ITEM_HANDS.TWO;
  }

  function normalizeSlot(slot) {
    if (slot === undefined || slot === null || slot === "auto") {
      return null;
    }
    const text = String(slot).trim().toLowerCase();
    if (text === "main" || text === "mainhand" || text === "main-hand") {
      return HAND_SLOTS.MAIN;
    }
    if (text === "off" || text === "offhand" || text === "off-hand") {
      return HAND_SLOTS.OFF;
    }
    throw new RangeError('slot must be "mainHand" or "offHand".');
  }

  function otherSlot(slot) {
    return slot === HAND_SLOTS.MAIN ? HAND_SLOTS.OFF : HAND_SLOTS.MAIN;
  }

  function assertInventoryItem(item) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new TypeError("Inventory item must be an object.");
    }
  }

  function inferItemType(input) {
    if (typeof input.type === "string" && input.type.trim() !== "") {
      return normalizeText(input.type);
    }
    if (
      input.hardness !== undefined ||
      input.acBonus !== undefined ||
      input.brokenThreshold !== undefined
    ) {
      return ITEM_TYPES.SHIELD;
    }
    if (
      input.damage !== undefined ||
      input.formula !== undefined ||
      input.traits !== undefined ||
      input.rangeIncrement !== undefined
    ) {
      return ITEM_TYPES.WEAPON;
    }
    return ITEM_TYPES.GEAR;
  }

  /**
   * Normalize an authored inventory record without mutating the input.
   *
   * @param {object|string} input
   * @param {object} [defaults]
   * @returns {object}
   */
  function createInventoryItem(input, defaults) {
    const base = defaults || {};
    if (typeof input === "string") {
      const name = input.trim();
      assertNonEmptyString(name, "item name");
      return Object.assign({}, base, {
        id: slugify(name),
        name: name,
        type: ITEM_TYPES.GEAR,
        hands: ITEM_HANDS.ONE,
        equipped: false,
      });
    }

    assertInventoryItem(input);
    const name = input.name === undefined ? input.id : input.name;
    assertNonEmptyString(name, "item name");
    const id =
      input.id === undefined || input.id === null || String(input.id).trim() === ""
        ? slugify(name)
        : String(input.id);

    const type = inferItemType(input);
    const item = Object.assign({}, base, input, {
      id: id,
      name: name,
      type: type,
      hands: getItemHands(Object.assign({}, input, { type: type })),
      equipped: input.equipped === true,
    });

    if (Array.isArray(input.traits)) {
      item.traits = input.traits.slice();
    }
    return item;
  }

  function copyItem(item) {
    if (item === null || typeof item !== "object") {
      return item;
    }
    const copy = Object.assign({}, item);
    if (Array.isArray(item.traits)) {
      copy.traits = item.traits.map(function (trait) {
        return trait && typeof trait === "object"
          ? Object.assign({}, trait)
          : trait;
      });
    }
    return copy;
  }

  function itemIdOf(item, fallback) {
    if (item === null || item === undefined) {
      return fallback === undefined ? null : fallback;
    }
    if (typeof item === "string") {
      return item;
    }
    if (typeof item.id === "string") {
      return item.id;
    }
    if (typeof item.name === "string") {
      return slugify(item.name);
    }
    return fallback === undefined ? null : fallback;
  }

  function sameItem(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) {
      return false;
    }
    if (a === b) {
      return true;
    }
    const aId = itemIdOf(a);
    const bId = itemIdOf(b);
    return aId !== null && bId !== null && aId === bId;
  }

  function findItem(items, reference) {
    if (!Array.isArray(items) || reference === null || reference === undefined) {
      return null;
    }
    for (const item of items) {
      if (sameItem(item, reference)) {
        return item;
      }
    }
    return null;
  }

  function freeHandCount(hands) {
    if (hands === null || typeof hands !== "object") {
      return 2;
    }
    // A two-handed item consumes both hands even if a caller authored only one
    // slot directly.
    if (
      (hands.mainHand !== null &&
        hands.mainHand !== undefined &&
        isTwoHandedItem(hands.mainHand)) ||
      (hands.offHand !== null &&
        hands.offHand !== undefined &&
        isTwoHandedItem(hands.offHand))
    ) {
      return 0;
    }
    let free = 0;
    if (hands.mainHand === null || hands.mainHand === undefined) {
      free += 1;
    }
    if (hands.offHand === null || hands.offHand === undefined) {
      free += 1;
    }
    return free;
  }

  function heldItems(hands) {
    if (hands === null || typeof hands !== "object") {
      return [];
    }
    const items = [];
    const seen = [];
    for (const slot of HAND_SLOT_NAMES) {
      const item = hands[slot];
      if (item === null || item === undefined) {
        continue;
      }
      if (seen.some(function (entry) { return sameItem(entry, item); })) {
        continue;
      }
      seen.push(item);
      items.push(item);
    }
    return items;
  }

  function combatantTraits(combatant) {
    if (!combatant || typeof combatant !== "object") {
      return [];
    }
    const tokens = [];
    if (typeof combatant.getTraits === "function") {
      tokens.push.apply(tokens, combatant.getTraits());
    } else if (Array.isArray(combatant.traits)) {
      tokens.push.apply(tokens, combatant.traits);
    } else if (Array.isArray(combatant.traitDefinitions)) {
      for (const trait of combatant.traitDefinitions) {
        tokens.push(
          trait && typeof trait === "object"
            ? trait.slug || trait.name
            : trait,
        );
      }
    }

    // Traits of the weapons actually held in the hands. This is what makes a
    // drawn `trip`/`shove`/`grapple` weapon work even when the combatant was
    // authored without a default weapon profile.
    const held =
      typeof combatant.getHeldItems === "function"
        ? combatant.getHeldItems()
        : heldItems(combatant.hands);
    for (const item of held) {
      tokens.push.apply(tokens, traitTokens(item));
    }
    return tokens;
  }

  function combatantHasManeuverTrait(combatant, maneuver) {
    const target = normalizeText(maneuver);
    if (typeof combatant.hasTrait === "function" && combatant.hasTrait(target)) {
      return true;
    }
    return combatantTraits(combatant).some(function (trait) {
      const text = normalizeText(trait);
      return text === target || text.indexOf(target + " ") === 0;
    });
  }

  /**
   * Hand requirement for Trip, Shove, and Grapple.
   *
   * A creature needs at least one free hand unless its wielded weapon carries
   * the maneuver's trait (`trip`, `shove`, `grapple`). Engines/tests that have
   * not authored hands at all are assumed to have two free hands.
   *
   * @param {object} combatant
   * @param {"trip"|"shove"|"grapple"} maneuver
   * @returns {{ok:boolean,reason?:string,freeHands:number,viaTrait:boolean}}
   */
  function checkManeuverHands(combatant, maneuver) {
    if (!combatant || typeof combatant !== "object") {
      return { ok: true, freeHands: 2, viaTrait: false };
    }
    const freeHands =
      typeof combatant.getFreeHandsCount === "function"
        ? combatant.getFreeHandsCount()
        : freeHandCount(combatant.hands);
    if (freeHands >= 1) {
      return { ok: true, freeHands: freeHands, viaTrait: false };
    }
    if (combatantHasManeuverTrait(combatant, maneuver)) {
      return { ok: true, freeHands: 0, viaTrait: true };
    }
    return {
      ok: false,
      reason: "no-free-hand",
      freeHands: 0,
      viaTrait: false,
    };
  }

  return Object.freeze({
    HAND_SLOTS: HAND_SLOTS,
    HAND_SLOT_NAMES: HAND_SLOT_NAMES,
    ITEM_HANDS: ITEM_HANDS,
    ITEM_TYPES: ITEM_TYPES,
    normalizeText: normalizeText,
    slugify: slugify,
    getItemHands: getItemHands,
    isTwoHandedItem: isTwoHandedItem,
    normalizeSlot: normalizeSlot,
    otherSlot: otherSlot,
    createInventoryItem: createInventoryItem,
    copyItem: copyItem,
    itemIdOf: itemIdOf,
    sameItem: sameItem,
    findItem: findItem,
    freeHandCount: freeHandCount,
    heldItems: heldItems,
    checkManeuverHands: checkManeuverHands,
  });
});
