/**
 * PF2E REMASTERED — COMBATANT (HEADLESS CORE)
 *
 * Combat entity for the movement, turn, and combat slices:
 *   - Speed in feet (multiple of 5).
 *   - Three actions per turn by default.
 *   - Cumulative diagonal count, used for the 5-10-5 alternation.
 *   - Alliance ("player" / "enemy") and initiative for encounter order.
 *   - HP, AC, attack bonus, damage formula, and agile trait.
 *   - Multiple Attack Penalty counter reset at the start of each turn.
 *   - One reaction per turn by default, spent by reactions such as Reactive
 *     Strike and restored at the start of the combatant's turn.
 *   - Active condition store (Off-Guard, Frightened, Shield Raised) with typed
 *     modifiers, end-of-turn Frightened decay, and start-of-turn shield reset.
 *
 * Presentation data (token color, portrait, etc.) is intentionally absent.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Rules/map.js"),
      require("../Rules/damage.js"),
      require("../Rules/size.js"),
      require("./conditions.js"),
      require("../Rules/iwr.js"),
      require("../Rules/weapon-traits.js"),
      require("./persistent-damage.js"),
      require("../Grid/cover.js"),
      require("../Rules/checks.js"),
      require("../Rules/afflictions.js"),
      require("./equipment.js"),
      require("./shield.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Combatant = factory(
      root.PF2e.Core.Rules.MultipleAttack,
      root.PF2e.Core.Rules.Damage,
      root.PF2e.Core.Rules.Size,
      root.PF2e.Core.Conditions,
      root.PF2e.Core.Rules.IWR,
      root.PF2e.Core.Rules.WeaponTraits,
      root.PF2e.Core.PersistentDamage,
      root.PF2e.Core.Cover,
      root.PF2e.Core.Rules.Checks,
      root.PF2e.Core.Rules.Afflictions,
      root.PF2e.Core.Equipment,
      root.PF2e.Core.Shield,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  MultipleAttack,
  Damage,
  Size,
  Conditions,
  IWR,
  WeaponTraits,
  PersistentDamage,
  Cover,
  Checks,
  Afflictions,
  Equipment,
  Shield,
) {
  "use strict";

  function assertNonEmptyString(value, label) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(label + " must be a non-empty string.");
    }
  }

  function assertInteger(value, label) {
    if (!Number.isInteger(value)) {
      throw new TypeError(label + " must be an integer; received " + String(value) + ".");
    }
  }

  const ALLIANCES = Object.freeze({
    PLAYER: "player",
    ENEMY: "enemy",
  });

  /**
   * Saving throws are treated the same way as PF2e: a static modifier used to
   * derive a defence DC (`10 + modifier`). Skills use the same underlying math
   * for Athletics, Acrobatics, Stealth, and Perception checks.
   */
  const SAVE_NAMES = Object.freeze(["fortitude", "reflex", "will"]);
  const SKILL_NAMES = Object.freeze([
    "acrobatics",
    "athletics",
    "perception",
    "stealth",
  ]);

  function normalizeStatName(value, label) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(label + " must be a non-empty string.");
    }
    return value.trim().toLowerCase();
  }

  /**
   * Normalize an authored save/skill block. Known names default to 0 and any
   * additional future name is preserved, so the engine stays forward
   * compatible without silently dropping authored data.
   *
   * @param {object|undefined} input
   * @param {string[]} defaults
   * @param {string} label
   * @returns {Object<string, number>}
   */
  function normalizeStatBlock(input, defaults, label) {
    const result = {};
    for (const name of defaults) {
      result[name] = 0;
    }
    if (input === undefined || input === null) {
      return result;
    }
    if (typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError(label + " must be an object of integer modifiers.");
    }
    for (const key of Object.keys(input)) {
      const name = normalizeStatName(key, label + " key");
      assertInteger(input[key], label + "." + name);
      result[name] = input[key];
    }
    return result;
  }

  function appendExtraModifiers(modifiers, extraModifiers) {
    if (extraModifiers === undefined || extraModifiers === null) {
      return;
    }
    if (!Array.isArray(extraModifiers)) {
      throw new TypeError("extraModifiers must be an array.");
    }
    for (const modifier of extraModifiers) {
      modifiers.push(modifier);
    }
  }

  function normalizeAlliance(value) {
    const alliance = value === undefined ? ALLIANCES.PLAYER : value;
    if (alliance !== ALLIANCES.PLAYER && alliance !== ALLIANCES.ENEMY) {
      throw new RangeError('alliance must be "player" or "enemy".');
    }
    return alliance;
  }

  /** Every creature perceives its surroundings unless a sense replaces vision. */
  const DEFAULT_SENSES = Object.freeze(["vision"]);

  /**
   * Canonicalize one authored sense token. Accepted inputs are the plain names
   * ("darkvision", "low-light-vision") and the ranged forms
   * ("tremorsense-30", "scent-15"). Spacing, underscores, and case are
   * normalized so authored data is forgiving.
   *
   * @param {string} value
   * @param {string} label
   * @returns {string}
   */
  function canonicalSenseName(value, label) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(label + " must be a non-empty sense name.");
    }
    let name = value
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-");

    if (
      name === "lowlightvision" ||
      name === "lowlight" ||
      name === "low-light"
    ) {
      return "low-light-vision";
    }
    if (name === "dark-vision") {
      return "darkvision";
    }
    if (name.indexOf("tremor-sense") === 0) {
      name = "tremorsense" + name.slice("tremor-sense".length);
    }
    return name;
  }

  /**
   * Normalize one authored sense entry (string or object) to its canonical
   * string form. Object form accepts `{ type }`, `{ name }`, `{ sense }`, or
   * `{ slug }`, plus an optional `range` / `rangeFeet` for ranged senses.
   *
   * @param {string|object} entry
   * @param {number} index
   * @returns {string}
   */
  function senseFromEntry(entry, index) {
    const label = "senses[" + index + "]";
    if (typeof entry === "string") {
      return canonicalSenseName(entry, label);
    }
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError(label + " must be a sense string or object.");
    }

    const raw =
      entry.type !== undefined
        ? entry.type
        : entry.name !== undefined
          ? entry.name
          : entry.sense !== undefined
            ? entry.sense
            : entry.slug;
    const name = canonicalSenseName(raw, label);
    const range =
      entry.rangeFeet !== undefined ? entry.rangeFeet : entry.range;

    if (range === undefined || range === null) {
      return name;
    }
    if (!Number.isInteger(range) || range <= 0) {
      throw new RangeError(label + ".range must be a positive integer.");
    }
    if (name === "tremorsense" || name === "scent") {
      return name + "-" + range;
    }
    return name;
  }

  /**
   * Normalize the authored senses array. Vision is always present because the
   * engine does not model blindness; authored senses are appended in order and
   * de-duplicated.
   *
   * @param {Array<string|object>|undefined|null} input
   * @returns {string[]}
   */
  function normalizeSenses(input) {
    const senses = DEFAULT_SENSES.slice();
    if (input === undefined || input === null) {
      return senses;
    }
    if (!Array.isArray(input)) {
      throw new TypeError("senses must be an array of sense names or objects.");
    }
    for (let index = 0; index < input.length; index += 1) {
      const sense = senseFromEntry(input[index], index);
      if (senses.indexOf(sense) === -1) {
        senses.push(sense);
      }
    }
    return senses;
  }

  /**
   * Normalize an authored spell-slot pool.
   *
   * Accepted forms:
   *   { 1: 3, 2: 2 }                       // max == current
   *   { 1: { max: 3, current: 2 } }
   *   { 1: { max: 3 } }                    // current defaults to max
   *
   * @param {object|undefined|null} input
   * @returns {Object<number, {max:number,current:number}>}
   */
  function normalizeSpellSlots(input) {
    const slots = {};
    if (input === undefined || input === null) {
      return slots;
    }
    if (typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("spellSlots must be an object keyed by spell rank.");
    }

    for (const key of Object.keys(input)) {
      const rank = Number(key);
      if (!Number.isInteger(rank) || rank < 0) {
        throw new RangeError("spellSlots keys must be non-negative integer ranks.");
      }
      const value = input[key];
      let max;
      let current;
      if (Number.isInteger(value)) {
        max = value;
        current = value;
      } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        max = value.max;
        current = value.current === undefined ? value.max : value.current;
      } else {
        throw new TypeError("spellSlots[" + key + "] must be an integer or { max, current }.");
      }
      if (!Number.isInteger(max) || max < 0) {
        throw new RangeError("spellSlots[" + key + "].max must be a non-negative integer.");
      }
      if (!Number.isInteger(current) || current < 0 || current > max) {
        throw new RangeError(
          "spellSlots[" + key + "].current must be an integer between 0 and max.",
        );
      }
      slots[rank] = { max: max, current: current };
    }
    return slots;
  }

  /**
   * Normalize focus points. An omitted pool is `{ max: 0, current: 0 }`.
   * A plain integer is treated as both max and current.
   *
   * @param {number|object|undefined|null} input
   * @returns {{max:number,current:number}}
   */
  function normalizeFocusPoints(input) {
    if (input === undefined || input === null) {
      return { max: 0, current: 0 };
    }
    let max;
    let current;
    if (Number.isInteger(input)) {
      max = input;
      current = input;
    } else if (typeof input === "object" && !Array.isArray(input)) {
      max = input.max === undefined ? 0 : input.max;
      current = input.current === undefined ? max : input.current;
    } else {
      throw new TypeError("focusPoints must be an integer or { max, current }.");
    }
    if (!Number.isInteger(max) || max < 0) {
      throw new RangeError("focusPoints.max must be a non-negative integer.");
    }
    if (!Number.isInteger(current) || current < 0 || current > max) {
      throw new RangeError("focusPoints.current must be an integer between 0 and max.");
    }
    return { max: max, current: current };
  }

  function copySustainedSpell(entry) {
    return {
      id: entry.id,
      spellId: entry.spellId,
      spell: entry.spell,
      target: entry.target,
      expiresAtRound: entry.expiresAtRound,
    };
  }

  /**
   * Normalize an authored active-sustained-spell list. Only the stable
   * metadata is copied; the spell and target references stay live so callers
   * can inspect the original definitions.
   *
   * @param {object[]|undefined|null} input
   * @returns {object[]}
   */
  function normalizeActiveSustainedSpells(input) {
    if (input === undefined || input === null) {
      return [];
    }
    if (!Array.isArray(input)) {
      throw new TypeError("activeSustainedSpells must be an array.");
    }
    return input.map(function (entry, index) {
      if (entry === null || typeof entry !== "object") {
        throw new TypeError("activeSustainedSpells entries must be objects.");
      }
      return {
        id: entry.id === undefined ? "sustained-" + (index + 1) : entry.id,
        spellId: entry.spellId === undefined ? null : entry.spellId,
        spell: entry.spell === undefined ? null : entry.spell,
        target: entry.target === undefined ? null : entry.target,
        expiresAtRound: Number.isInteger(entry.expiresAtRound)
          ? entry.expiresAtRound
          : null,
      };
    });
  }

  /**
   * Resolve the d20 for a recovery flat check. Deterministic callers inject
   * `d20`, `rollD20`, `rollFlatCheck`, or a generic `rollDie(20)`; the browser
   * host falls back to Math.random.
   *
   * @param {object} options
   * @returns {number}
   */
  function resolveRecoveryD20(options) {
    const opts = options || {};
    let value;

    if (opts.d20 !== undefined) {
      value = opts.d20;
    } else if (typeof opts.rollD20 === "function") {
      value = opts.rollD20();
    } else if (typeof opts.rollFlatCheck === "function") {
      value = opts.rollFlatCheck();
    } else if (typeof opts.rollDie === "function") {
      value = opts.rollDie(20);
    } else {
      value = 1 + Math.floor(Math.random() * 20);
    }

    assertInteger(value, "d20");
    if (value < 1 || value > 20) {
      throw new RangeError("d20 must be an integer from 1 to 20.");
    }
    return value;
  }

  const DYING_MAX = 4;

  class Combatant {
    constructor(options) {
      const opts = options || {};

      assertNonEmptyString(opts.id, "id");
      // Headless tests and quick skirmish setups may only author an id. A
      // missing display name falls back to the stable id, and the default
      // Medium creature speed is 25 ft.
      const name = opts.name === undefined ? opts.id : opts.name;
      assertNonEmptyString(name, "name");
      assertInteger(opts.x, "x");
      assertInteger(opts.y, "y");

      const speedFeet = opts.speedFeet === undefined ? 25 : opts.speedFeet;
      if (!Number.isInteger(speedFeet) || speedFeet <= 0 || speedFeet % 5 !== 0) {
        throw new RangeError("speedFeet must be a positive multiple of 5.");
      }

      const maxActions = opts.maxActions === undefined ? 3 : opts.maxActions;
      if (!Number.isInteger(maxActions) || maxActions <= 0) {
        throw new RangeError("maxActions must be a positive integer.");
      }

      if (opts.actionsRemaining !== undefined) {
        if (
          !Number.isInteger(opts.actionsRemaining) ||
          opts.actionsRemaining < 0 ||
          opts.actionsRemaining > maxActions
        ) {
          throw new RangeError("actionsRemaining must be between 0 and maxActions.");
        }
      }

      const maxReactions = opts.maxReactions === undefined ? 1 : opts.maxReactions;
      if (!Number.isInteger(maxReactions) || maxReactions < 0) {
        throw new RangeError("maxReactions must be a non-negative integer.");
      }

      if (opts.reactionsRemaining !== undefined) {
        if (
          !Number.isInteger(opts.reactionsRemaining) ||
          opts.reactionsRemaining < 0 ||
          opts.reactionsRemaining > maxReactions
        ) {
          throw new RangeError("reactionsRemaining must be between 0 and maxReactions.");
        }
      }

      if (opts.diagonalStepsThisTurn !== undefined) {
        if (!Number.isInteger(opts.diagonalStepsThisTurn) || opts.diagonalStepsThisTurn < 0) {
          throw new RangeError("diagonalStepsThisTurn must be a non-negative integer.");
        }
      }

      const initiative = opts.initiative === undefined ? 0 : opts.initiative;
      assertInteger(initiative, "initiative");

      // `hp` is accepted as a friendly alias for authored hit points when
      // `maxHP` is omitted; `maxHP` remains the canonical field.
      const maxHP =
        opts.maxHP === undefined
          ? opts.hp === undefined
            ? 1
            : opts.hp
          : opts.maxHP;
      if (!Number.isInteger(maxHP) || maxHP <= 0) {
        throw new RangeError("maxHP must be a positive integer.");
      }

      const currentHP = opts.currentHP === undefined ? maxHP : opts.currentHP;
      if (!Number.isInteger(currentHP) || currentHP < 0 || currentHP > maxHP) {
        throw new RangeError("currentHP must be an integer between 0 and maxHP.");
      }

      const ac = opts.ac === undefined ? 10 : opts.ac;
      assertInteger(ac, "ac");

      const attackBonus = opts.attackBonus === undefined ? 0 : opts.attackBonus;
      assertInteger(attackBonus, "attackBonus");

      // Spellcasting parameters. The spell DC defaults to 10 + spell attack
      // bonus, matching PF2e's "spell DC = 10 + spellcasting modifier".
      const spellAttackBonus =
        opts.spellAttackBonus === undefined ? 0 : opts.spellAttackBonus;
      assertInteger(spellAttackBonus, "spellAttackBonus");
      const spellDC =
        opts.spellDC === undefined ? 10 + spellAttackBonus : opts.spellDC;
      assertInteger(spellDC, "spellDC");
      const spells = opts.spells === undefined ? [] : opts.spells;
      if (!Array.isArray(spells)) {
        throw new TypeError("spells must be an array of spell definitions.");
      }

      // Authored spellcasting resources may live directly on the options or
      // under an optional `data` block. Both forms share one normalizer.
      const data =
        opts.data !== null &&
        typeof opts.data === "object" &&
        !Array.isArray(opts.data)
          ? opts.data
          : {};
      const spellSlots = normalizeSpellSlots(
        opts.spellSlots === undefined ? data.spellSlots : opts.spellSlots,
      );
      const focusPoints = normalizeFocusPoints(
        opts.focusPoints === undefined ? data.focusPoints : opts.focusPoints,
      );
      const activeSustainedSpells = normalizeActiveSustainedSpells(
        opts.activeSustainedSpells === undefined
          ? data.activeSustainedSpells
          : opts.activeSustainedSpells,
      );

      const saves = normalizeStatBlock(opts.saves, SAVE_NAMES, "saves");
      const skills = normalizeStatBlock(opts.skills, SKILL_NAMES, "skills");

      const damageInput =
        opts.damage === undefined
          ? opts.weapon === undefined
            ? "1d4"
            : opts.weapon
          : opts.damage;
      const damageSpec = Damage.parseDamageSpec(damageInput, opts.damageType);
      const traitsInput =
        opts.traits === undefined
          ? opts.weapon && opts.weapon.traits
          : opts.traits;
      const traitDefinitions = WeaponTraits.normalizeTraits(traitsInput);

      const immunities = IWR.normalizeImmunities(opts.immunities);
      const weaknesses = IWR.normalizeIWRValues(opts.weaknesses, "weaknesses");
      const resistances = IWR.normalizeIWRValues(
        opts.resistances,
        "resistances",
      );

      const agile = opts.agile === undefined ? false : opts.agile;
      if (typeof agile !== "boolean") {
        throw new TypeError("agile must be a boolean.");
      }

      const attacksThisTurn =
        opts.attacksThisTurn === undefined ? 0 : opts.attacksThisTurn;
      if (!Number.isInteger(attacksThisTurn) || attacksThisTurn < 0) {
        throw new RangeError("attacksThisTurn must be a non-negative integer.");
      }

      this.id = opts.id;
      this.name = name;
      this.alliance = normalizeAlliance(opts.alliance);
      // Only an explicitly declared alliance establishes hostility. Combatants
      // used in isolated headless math (no alliance authored) must not be
      // treated as allies of each other.
      this.allianceExplicit = opts.alliance !== undefined;
      this.initiative = initiative;
      this.speedFeet = speedFeet;
      this.maxActions = maxActions;
      this.actionsRemaining =
        opts.actionsRemaining === undefined ? maxActions : opts.actionsRemaining;
      this.maxReactions = maxReactions;
      this.reactionsRemaining =
        opts.reactionsRemaining === undefined ? maxReactions : opts.reactionsRemaining;
      this.diagonalStepsThisTurn =
        opts.diagonalStepsThisTurn === undefined ? 0 : opts.diagonalStepsThisTurn;
      this.maxHP = maxHP;
      this.currentHP = currentHP;
      this.ac = ac;
      this.attackBonus = attackBonus;
      this.spellAttackBonus = spellAttackBonus;
      this.spellDC = spellDC;
      this.spells = spells.slice();
      this.spellSlots = spellSlots;
      this.focusPoints = focusPoints;
      this.activeSustainedSpells = activeSustainedSpells;
      this._sustainedSpellCounter = activeSustainedSpells.length;
      this.saves = saves;
      this.skills = skills;
      // `damage` stays a formula string for backwards compatibility. The
      // companion `damageType`/`damageSpec` fields carry the typed contract.
      this.damage = damageSpec.formula;
      this.damageType = damageSpec.type;
      this.damageSpec = damageSpec;
      this.traitDefinitions = Object.freeze(traitDefinitions.slice());
      this.traits = Object.freeze(
        traitDefinitions.map(function (trait) {
          return trait.slug;
        }),
      );

      // Ranged weapon profile: range increment, reload cost, volley range.
      // Authored weapon fields win over the equivalent ranged/thrown/volley/
      // reload traits. Melee weapons get rangeIncrement = null and reload = 0.
      const weaponSource = Object.assign(
        {},
        opts.weapon !== undefined &&
          opts.weapon !== null &&
          typeof opts.weapon === "object" &&
          !Array.isArray(opts.weapon)
          ? opts.weapon
          : {},
        {
          formula: damageSpec.formula,
          type: damageSpec.type,
          traits: traitDefinitions,
        },
      );
      if (opts.rangeIncrement !== undefined && weaponSource.rangeIncrement === undefined) {
        weaponSource.rangeIncrement = opts.rangeIncrement;
      }
      if (opts.range !== undefined && weaponSource.range === undefined) {
        weaponSource.range = opts.range;
      }
      if (opts.reload !== undefined && weaponSource.reload === undefined) {
        weaponSource.reload = opts.reload;
      }
      if (opts.volley !== undefined && weaponSource.volley === undefined) {
        weaponSource.volley = opts.volley;
      }
      this.weapon = WeaponTraits.getWeaponProfile(weaponSource);

      const isLoaded = opts.isLoaded === undefined ? true : opts.isLoaded;
      if (typeof isLoaded !== "boolean") {
        throw new TypeError("isLoaded must be a boolean.");
      }
      this.isLoaded = isLoaded;

      this.immunities = immunities;
      this.weaknesses = weaknesses;
      this.resistances = resistances;
      this.agile = agile;
      this.attacksThisTurn = attacksThisTurn;
      this.isDefeated = currentHP <= 0;
      this.conditions = new Map();
      // Grabbed/Restrained/Immobilized can exist once per source. The Map above
      // keeps the canonical primary record per slug (for modifiers and legacy
      // accessors); this registry keeps every simultaneous instance so a
      // second grappler no longer overwrites the first source's metadata.
      this._conditionInstances = new Map();
      this._conditionInstanceSeq = 0;
      this.persistentDamage = [];
      this.lastRecoveryCheck = null;
      this.lastDurationExpiry = [];
      this.lastActionLoss = null;
      // Monotonic count of the turns this combatant has begun. Grapple
      // duration is expressed against the grappler's turn count so it expires
      // at the end of the grappler's next turn, not the victim's.
      const turnNumber = opts.turnNumber === undefined ? 0 : opts.turnNumber;
      if (!Number.isInteger(turnNumber) || turnNumber < 0) {
        throw new RangeError("turnNumber must be a non-negative integer.");
      }
      this.turnNumber = turnNumber;
      // Current encounter round, synchronised by Encounter. Round-based
      // condition durations are stamped and checked against this value.
      const encounterRound =
        opts.encounterRound === undefined ? 0 : opts.encounterRound;
      if (!Number.isInteger(encounterRound) || encounterRound < 0) {
        throw new RangeError("encounterRound must be a non-negative integer.");
      }
      this.encounterRound = encounterRound;
      this.size = Size.normalizeSize(opts.size);
      // Vertical position in feet above the battlefield baseline. Elevation
      // feeds 3D distance / reach and defaults to ground level (0 ft).
      const elevation = opts.elevation === undefined ? 0 : opts.elevation;
      if (typeof elevation !== "number" || !Number.isFinite(elevation)) {
        throw new TypeError("elevation must be a finite number of feet.");
      }
      this.elevation = elevation;
      // Senses drive light-dependent perception. Supported authored forms:
      //   ["vision", "low-light-vision", "darkvision", "tremorsense-30",
      //    "scent-15", { type: "tremorsense", range: 30 }]
      this.senses = normalizeSenses(opts.senses);
      this.afflictions = [];
      // Equipment state. Every creature has exactly two hands; items occupy a
      // slot by reference. A two-handed item fills both slots with the same
      // object. `shield` points at the authored shield (if any) and is used by
      // Raise a Shield and Shield Block.
      this.inventory = [];
      this.hands = { mainHand: null, offHand: null };
      this.shield = null;
      this._x = opts.x;
      this._y = opts.y;

      if (opts.inventory !== undefined) {
        this._initializeInventory(opts.inventory);
      }
      if (opts.shield !== undefined && opts.shield !== null) {
        this.shield = this._addShield(opts.shield);
      } else {
        const firstShield = this.inventory.find(function (item) {
          return item.type === Equipment.ITEM_TYPES.SHIELD;
        });
        if (firstShield !== undefined) {
          this.shield = firstShield;
        }
      }
      if (opts.hands !== undefined) {
        this._initializeHands(opts.hands);
      } else if (opts.shield !== undefined && this.shield !== null) {
        // An authored shield is wielded by default. Explicitly authored hands
        // are never overridden.
        this.equipItem(this.shield, { slot: Equipment.HAND_SLOTS.OFF });
      }

      if (opts.conditions !== undefined) {
        this._initializeConditions(opts.conditions);
      }
      if (opts.afflictions !== undefined) {
        this._initializeAfflictions(opts.afflictions);
      }
      if (opts.persistentDamage !== undefined) {
        this._initializePersistentDamage(opts.persistentDamage);
      }

      // Optional presentation/integration bridge. When absent every emit is a
      // no-op, keeping the core fully headless.
      this.eventBus = opts.eventBus || opts.bus || null;
    }

    /**
     * Attach or replace the combat event bus.
     *
     * @param {object|null} bus
     * @returns {Combatant}
     */
    setEventBus(bus) {
      this.eventBus = bus || null;
      return this;
    }

    /**
     * Dispatch one core event. Payloads always carry the stable combatant id
     * and display name; callers may override either explicitly.
     *
     * @param {string} eventType
     * @param {object} [payload]
     * @returns {number} number of listeners invoked
     */
    emitEvent(eventType, payload) {
      if (!this.eventBus || typeof this.eventBus.emit !== "function") {
        return 0;
      }
      const body = Object.assign(
        { combatantId: this.id, combatantName: this.name },
        payload || {},
      );
      return this.eventBus.emit(eventType, body);
    }

    _initializeConditions(source) {
      if (source instanceof Map) {
        for (const entry of source.entries()) {
          const value = entry[1];
          this.addCondition(
            entry[0],
            value && typeof value === "object" ? value.value : value,
            value && typeof value === "object" ? value : undefined,
          );
        }
        return;
      }
      if (Array.isArray(source)) {
        for (const entry of source) {
          if (typeof entry === "string") {
            this.addCondition(entry);
          } else if (entry && typeof entry === "object") {
            this.addCondition(
              entry.name || entry.slug,
              entry.value,
              entry,
            );
          }
        }
        return;
      }
      if (source && typeof source === "object") {
        for (const name of Object.keys(source)) {
          const value = source[name];
          this.addCondition(
            name,
            value && typeof value === "object" ? value.value : value,
            value && typeof value === "object" ? value : undefined,
          );
        }
        return;
      }
      throw new TypeError("conditions must be a Map, array, or object.");
    }

    _initializeAfflictions(source) {
      if (!Array.isArray(source)) {
        throw new TypeError("afflictions must be an array.");
      }
      for (const entry of source) {
        this.addAffliction(entry);
      }
    }

    _initializePersistentDamage(source) {
      if (Array.isArray(source)) {
        for (const entry of source) {
          this.addPersistentDamage(entry);
        }
        return;
      }
      if (source !== null && typeof source === "object") {
        if (source.formula !== undefined || source.damage !== undefined) {
          this.addPersistentDamage(source);
          return;
        }
        // Type-keyed map: { fire: "1d6", bleed: "1d4" }.
        for (const type of Object.keys(source)) {
          const value = source[type];
          if (value !== null && typeof value === "object") {
            this.addPersistentDamage(
              Object.assign({}, value, { type: value.type || type }),
            );
          } else {
            this.addPersistentDamage({ formula: String(value), type: type });
          }
        }
        return;
      }
      throw new TypeError(
        "persistentDamage must be an array, an object, or a type-keyed map.",
      );
    }

    // ------------------------------------------------------- equipment & hands

    _initializeInventory(source) {
      if (!Array.isArray(source)) {
        throw new TypeError("inventory must be an array of items.");
      }
      for (const entry of source) {
        this._addInventoryEntry(entry);
      }
    }

    _addInventoryEntry(entry) {
      if (entry === null || typeof entry !== "object") {
        return Equipment.createInventoryItem(entry);
      }
      const existing =
        entry.id !== undefined
          ? this.inventory.find(function (item) {
              return item.id === entry.id;
            })
          : this.inventory.find(function (item) {
              return Equipment.sameItem(item, entry);
            });
      if (existing !== undefined) {
        return existing;
      }

      const normalized =
        String(entry.type || "").toLowerCase() === Equipment.ITEM_TYPES.SHIELD ||
        (entry.type === undefined &&
          (entry.hardness !== undefined ||
            entry.acBonus !== undefined ||
            entry.brokenThreshold !== undefined))
          ? Shield.normalizeShield(entry)
          : Equipment.createInventoryItem(entry);
      this.inventory.push(normalized);
      return normalized;
    }

    /**
     * Add a shield to the inventory (or return the existing record) and point
     * `combatant.shield` at it.
     *
     * @param {object} input
     * @returns {object}
     */
    _addShield(input) {
      const normalized = Shield.normalizeShield(input);
      const existing = this.inventory.find(function (item) {
        return item.id === normalized.id;
      });
      const shield = existing === undefined ? normalized : existing;
      if (existing === undefined) {
        this.inventory.push(shield);
      } else {
        Object.assign(existing, Shield.normalizeShield(input));
      }
      this.shield = shield;
      return shield;
    }

    _resolveItemReference(reference) {
      if (reference === null || reference === undefined) {
        return null;
      }
      const found = Equipment.findItem(this.inventory, reference);
      if (found !== null) {
        return found;
      }
      if (typeof reference === "string") {
        throw new RangeError("Unknown inventory item: " + reference + ".");
      }
      const normalized =
        String(reference.type || "").toLowerCase() === "shield"
          ? Shield.normalizeShield(reference)
          : Equipment.createInventoryItem(reference);
      this.inventory.push(normalized);
      return normalized;
    }

    _initializeHands(source) {
      if (source === null || typeof source !== "object" || Array.isArray(source)) {
        throw new TypeError("hands must be an object with mainHand/offHand.");
      }
      for (const slot of Equipment.HAND_SLOT_NAMES) {
        if (source[slot] === undefined || source[slot] === null) {
          continue;
        }
        const item = this._resolveItemReference(source[slot]);
        this.hands[slot] = item;
        if (item !== null && typeof item === "object") {
          item.equipped = true;
        }
      }

      // A two-handed item always fills both hands, even when the author only
      // named one slot.
      const main = this.hands.mainHand;
      const off = this.hands.offHand;
      if (main !== null && Equipment.isTwoHandedItem(main)) {
        if (off !== null && !Equipment.sameItem(main, off)) {
          throw new RangeError("A two-handed item cannot share hands with another item.");
        }
        this.hands.offHand = main;
        main.equipped = true;
      } else if (off !== null && Equipment.isTwoHandedItem(off)) {
        if (main !== null && !Equipment.sameItem(main, off)) {
          throw new RangeError("A two-handed item cannot share hands with another item.");
        }
        this.hands.mainHand = off;
        off.equipped = true;
      }

      if (this.shield === null) {
        const heldShield = this.getEquippedShield();
        if (heldShield !== null) {
          this.shield = heldShield;
        }
      }
    }

    /**
     * @returns {number} 0, 1, or 2 free hands
     */
    getFreeHandsCount() {
      return Equipment.freeHandCount(this.hands);
    }

    /**
     * @returns {{mainHand:object|null, offHand:object|null}}
     */
    getHands() {
      return {
        mainHand: this.hands.mainHand,
        offHand: this.hands.offHand,
      };
    }

    /**
     * Unique items currently held (a two-handed item appears once).
     *
     * @returns {object[]}
     */
    getHeldItems() {
      return Equipment.heldItems(this.hands);
    }

    /**
     * @param {object|string} item
     * @returns {boolean}
     */
    isItemHeld(item) {
      return this.getHeldItems().some(function (held) {
        return Equipment.sameItem(held, item);
      });
    }

    /**
     * @param {string} id
     * @returns {object|null}
     */
    findInventoryItem(id) {
      const found = Equipment.findItem(this.inventory, id);
      return found === null ? null : found;
    }

    /**
     * Add an item to the inventory. Re-adding the same id returns the existing
     * record instead of duplicating it.
     *
     * @param {object|string} input
     * @returns {object}
     */
    addInventoryItem(input) {
      return this._addInventoryEntry(input);
    }

    /**
     * Remove an inventory item. A held item is released first.
     *
     * @param {string|object} idOrItem
     * @returns {boolean}
     */
    removeInventoryItem(idOrItem) {
      const index = this.inventory.findIndex(function (item) {
        return Equipment.sameItem(item, idOrItem);
      });
      if (index === -1) {
        return false;
      }
      const item = this.inventory[index];
      if (this.isItemHeld(item)) {
        this.unequipItem(item);
      }
      this.inventory.splice(index, 1);
      if (this.shield === item) {
        this.shield = null;
      }
      return true;
    }

    /**
     * @returns {object[]} defensive inventory copies
     */
    getInventory() {
      return this.inventory.map(function (item) {
        return Equipment.copyItem(item);
      });
    }

    /**
     * Validate that an item fits in the requested hand(s) without mutating
     * state.
     *
     * @param {object|string} item
     * @param {{slot?:string}} [options]
     * @returns {{ok:boolean,reason?:string,slot?:string|null,hands?:number}}
     */
    canEquipItem(item, options) {
      const opts = options || {};
      if (item === null || item === undefined) {
        return { ok: false, reason: "missing-item" };
      }
      const handsNeeded = Equipment.getItemHands(item);
      const requestedSlot = Equipment.normalizeSlot(opts.slot);
      const main = this.hands.mainHand;
      const off = this.hands.offHand;
      const self = this;

      function freeOrSame(slotItem) {
        return (
          slotItem === null ||
          slotItem === undefined ||
          Equipment.sameItem(slotItem, item)
        );
      }

      if (handsNeeded === Equipment.ITEM_HANDS.TWO) {
        if (freeOrSame(main) && freeOrSame(off)) {
          return { ok: true, slot: null, hands: 2 };
        }
        return { ok: false, reason: "no-free-hand", hands: 2 };
      }

      if (requestedSlot !== null) {
        if (freeOrSame(this.hands[requestedSlot])) {
          return { ok: true, slot: requestedSlot, hands: 1 };
        }
        return { ok: false, reason: "slot-occupied", hands: 1 };
      }

      if (freeOrSame(main)) {
        return { ok: true, slot: Equipment.HAND_SLOTS.MAIN, hands: 1 };
      }
      if (freeOrSame(off)) {
        return { ok: true, slot: Equipment.HAND_SLOTS.OFF, hands: 1 };
      }
      return { ok: false, reason: "no-free-hand", hands: 1 };
    }

    /**
     * Equip an item from the inventory.
     *
     * @param {object|string} item
     * @param {{slot?:string}} [options]
     * @returns {{ok:boolean,reason?:string,item?:object,slot?:string|null,hands?:object}}
     */
    equipItem(item, options) {
      const resolved = this._resolveItemReference(item);
      if (resolved === null) {
        return { ok: false, reason: "missing-item" };
      }
      const validation = this.canEquipItem(resolved, options);
      if (!validation.ok) {
        return validation;
      }

      if (validation.hands === 2) {
        this.hands.mainHand = resolved;
        this.hands.offHand = resolved;
      } else {
        this.hands[validation.slot] = resolved;
      }
      resolved.equipped = true;
      if (resolved.type === Equipment.ITEM_TYPES.SHIELD) {
        this.shield = resolved;
      }

      return {
        ok: true,
        item: resolved,
        slot: validation.slot,
        hands: this.getHands(),
      };
    }

    /**
     * Free one or both hands. `slotOrItem` may be "mainHand", "offHand", an
     * item id, or an item object; omitting it releases everything held.
     *
     * @param {string|object} [slotOrItem]
     * @returns {{ok:boolean,reason?:string,items?:object[],slots?:string[],hands?:object}}
     */
    unequipItem(slotOrItem) {
      const released = [];
      const slots = [];
      let itemToMatch = null;

      if (slotOrItem === undefined || slotOrItem === null) {
        for (const slot of Equipment.HAND_SLOT_NAMES) {
          if (this.hands[slot] !== null) {
            slots.push(slot);
            if (!released.some(function (item) {
              return Equipment.sameItem(item, this.hands[slot]);
            }, this)) {
              released.push(this.hands[slot]);
            }
            this.hands[slot] = null;
          }
        }
      } else if (
        typeof slotOrItem === "string" &&
        Equipment.HAND_SLOT_NAMES.indexOf(slotOrItem) !== -1
      ) {
        const slot = slotOrItem;
        if (this.hands[slot] === null) {
          return { ok: false, reason: "empty-hand", hands: this.getHands() };
        }
        const item = this.hands[slot];
        itemToMatch = item;
        for (const candidate of Equipment.HAND_SLOT_NAMES) {
          if (Equipment.sameItem(this.hands[candidate], itemToMatch)) {
            slots.push(candidate);
            this.hands[candidate] = null;
          }
        }
        released.push(item);
      } else {
        itemToMatch = Equipment.findItem(this.getHeldItems(), slotOrItem);
        if (itemToMatch === null) {
          return { ok: false, reason: "empty-hand", hands: this.getHands() };
        }
        for (const slot of Equipment.HAND_SLOT_NAMES) {
          if (Equipment.sameItem(this.hands[slot], itemToMatch)) {
            slots.push(slot);
            this.hands[slot] = null;
          }
        }
        released.push(itemToMatch);
      }

      for (const item of released) {
        if (item !== null && typeof item === "object" && !this.isItemHeld(item)) {
          item.equipped = false;
        }
      }

      return {
        ok: true,
        items: released,
        slots: slots,
        hands: this.getHands(),
      };
    }

    /**
     * Release everything currently held (used by the Interact swap action).
     *
     * @returns {object[]} the released items
     */
    clearHands() {
      const result = this.unequipItem();
      return result.items || [];
    }

    /**
     * The shield this combatant is currently holding, if any.
     *
     * @returns {object|null}
     */
    getEquippedShield() {
      const held = this.getHeldItems();
      for (const item of held) {
        if (item.type === Equipment.ITEM_TYPES.SHIELD) {
          return item;
        }
      }
      return null;
    }

    /**
     * @returns {object|null}
     */
    getShield() {
      return this.shield;
    }

    /**
     * @returns {object|null}
     */
    getShieldState() {
      return Shield.getShieldState(this.shield);
    }

    /**
     * Shield Block trigger validation for this combatant.
     *
     * @param {{damage?:number,damageType?:string,type?:string}} [options]
     * @returns {{ok:boolean,reason?:string,shield?:object}}
     */
    canShieldBlock(options) {
      return Shield.canShieldBlock(this, options);
    }

    get x() {
      return this._x;
    }

    get y() {
      return this._y;
    }

    get position() {
      return { x: this._x, y: this._y };
    }

    /**
     * Number of grid squares along one edge of this creature's footprint.
     * PF2e sizes: tiny/small/medium = 1x1, large = 2x2, huge = 3x3,
     * gargantuan = 4x4.
     *
     * @returns {number}
     */
    getFootprint() {
      return Size.getFootprintForSize(this.size);
    }

    /**
     * Canonical size-category rank: tiny 0, small/medium 1, large 2, huge 3,
     * gargantuan 4.
     *
     * @returns {number}
     */
    getSizeRank() {
      return Size.sizeRankOfName(this.size);
    }

    /**
     * Every grid cell currently occupied by this creature. `x`/`y` are the
     * top-left (minimum) corner of the footprint.
     *
     * @returns {{x:number,y:number}[]}
     */
    getOccupiedCells() {
      const cells = [];
      const footprint = this.getFootprint();
      for (let dx = 0; dx < footprint; dx++) {
        for (let dy = 0; dy < footprint; dy++) {
          cells.push({ x: this._x + dx, y: this._y + dy });
        }
      }
      return cells;
    }

    get speedSquares() {
      return this.speedFeet / 5;
    }

    get diagonalParity() {
      return this.diagonalStepsThisTurn % 2;
    }

    get hpRatio() {
      return this.maxHP > 0 ? this.currentHP / this.maxHP : 0;
    }

    get isAlive() {
      return !this.isDefeated && this.currentHP > 0;
    }

    /**
     * Gate for every action. An unconscious creature cannot act at all; a
     * defeated creature is likewise refused. Callers may surface `reason`
     * directly in the combat log.
     *
     * The optional `options` argument lets callers declare the action's
     * traits. Restrained then blocks attack/manipulate actions (Escape is the
     * only exception) with `reason: "restrained-action-blocked"`. Calling
     * `canAct()` with no arguments keeps the legacy unconditional gate.
     *
     * @param {{traits?:string|string[],action?:string,isEscape?:boolean}} [options]
     * @returns {{ok:boolean, reason?:string, traits?:string[]}}
     */
    canAct(options) {
      const opts = options || {};
      if (this.hasCondition("unconscious")) {
        return { ok: false, reason: "unconscious" };
      }
      if (this.hasCondition("paralyzed")) {
        return { ok: false, reason: "paralyzed" };
      }
      if (this.hasCondition("stunned")) {
        return { ok: false, reason: "stunned" };
      }
      if (this.isDefeated) {
        return { ok: false, reason: "defeated" };
      }
      if (Conditions.isRestrainedActionBlocked(this, opts)) {
        return {
          ok: false,
          reason: "restrained-action-blocked",
          traits: Array.isArray(opts.traits)
            ? opts.traits.slice()
            : opts.traits === undefined
              ? []
              : [opts.traits],
        };
      }
      return { ok: true };
    }

    /**
     * Resolve the Grabbed manipulate flat check (DC 5). The check is only
     * required while Grabbed and when the action carries the `manipulate`
     * trait. This method never spends actions; the caller must spend the
     * action on a failed check (`passed === false`).
     *
     * @param {{traits?:string|string[],d20?:number,rollD20?:Function,rollFlatCheck?:Function,rollDie?:Function}} [options]
     * @returns {{required:boolean, passed:boolean, flatCheck:object|null, dc:number}}
     */
    resolveGrabbedManipulate(options) {
      const opts = options || {};
      if (!Conditions.isGrabbedManipulate(this, opts)) {
        return { required: false, passed: true, flatCheck: null, dc: 5 };
      }

      let rollD20;
      if (typeof opts.rollFlatCheck === "function") {
        rollD20 = opts.rollFlatCheck;
      } else if (typeof opts.rollD20 === "function") {
        rollD20 = opts.rollD20;
      }

      const result = Checks.evaluateFlatCheck({
        dc: 5,
        d20: opts.d20,
        rollD20: rollD20,
        rollDie: opts.rollDie,
      });

      return {
        required: true,
        passed: result.passed,
        flatCheck: {
          passed: result.passed,
          dc: result.dc,
          roll: result.d20,
          condition: "grabbed",
        },
        dc: 5,
      };
    }

    /**
     * Current Multiple Attack Penalty for the next attack this turn.
     *
     * @param {boolean} [agile] override the weapon trait for this query
     * @returns {number}
     */
    getMultipleAttackPenalty(agile) {
      const isAgile = agile === undefined ? this.agile : agile === true;
      return MultipleAttack.multipleAttackPenalty(this.attacksThisTurn, isAgile);
    }

    // ---------------------------------------- spell slots, focus & sustain

    /**
     * @returns {Object<number, {max:number,current:number}>} defensive copy
     */
    getSpellSlots() {
      const slots = {};
      for (const key of Object.keys(this.spellSlots)) {
        slots[key] = {
          max: this.spellSlots[key].max,
          current: this.spellSlots[key].current,
        };
      }
      return slots;
    }

    /**
     * @param {number} rank
     * @returns {{max:number,current:number}|null}
     */
    getSpellSlot(rank) {
      assertInteger(rank, "rank");
      if (rank < 0) {
        throw new RangeError("rank must be a non-negative integer.");
      }
      const slot = this.spellSlots[rank];
      return slot === undefined
        ? null
        : { max: slot.max, current: slot.current };
    }

    /**
     * @param {number} rank
     * @returns {boolean}
     */
    hasSpellSlot(rank) {
      const slot = this.getSpellSlot(rank);
      return slot !== null && slot.current > 0;
    }

    /**
     * Spend one slot of the given rank.
     *
     * @param {number} rank
     * @returns {{ok:boolean,reason?:string,rank:number,remaining:number,max?:number}}
     */
    spendSpellSlot(rank) {
      assertInteger(rank, "rank");
      if (rank < 0) {
        throw new RangeError("rank must be a non-negative integer.");
      }
      const slot = this.spellSlots[rank];
      if (slot === undefined || slot.current <= 0) {
        return {
          ok: false,
          reason: "no-spell-slots",
          rank: rank,
          remaining: slot === undefined ? 0 : slot.current,
        };
      }
      slot.current -= 1;
      return {
        ok: true,
        rank: rank,
        remaining: slot.current,
        max: slot.max,
      };
    }

    /**
     * @returns {{max:number,current:number}} defensive copy
     */
    getFocusPoints() {
      return { max: this.focusPoints.max, current: this.focusPoints.current };
    }

    /**
     * @returns {boolean}
     */
    hasFocusPoint() {
      return this.focusPoints.current > 0;
    }

    /**
     * @param {number} [count=1]
     * @returns {{ok:boolean,reason?:string,spent:number,remaining:number,max?:number}}
     */
    spendFocusPoint(count) {
      const amount = count === undefined ? 1 : count;
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new RangeError("Focus Point cost must be a positive integer.");
      }
      if (this.focusPoints.current < amount) {
        return {
          ok: false,
          reason: "no-focus-points",
          spent: 0,
          remaining: this.focusPoints.current,
        };
      }
      this.focusPoints.current -= amount;
      return {
        ok: true,
        spent: amount,
        remaining: this.focusPoints.current,
        max: this.focusPoints.max,
      };
    }

    /**
     * Restore focus points, capped at the pool maximum.
     *
     * @param {number} [amount] omit to refill the pool
     * @returns {{max:number,current:number}}
     */
    restoreFocusPoints(amount) {
      const value =
        amount === undefined ? this.focusPoints.max : amount;
      if (!Number.isInteger(value) || value < 0) {
        throw new RangeError("Focus Point restore amount must be a non-negative integer.");
      }
      this.focusPoints.current = Math.min(
        this.focusPoints.max,
        this.focusPoints.current + value,
      );
      return this.getFocusPoints();
    }

    /**
     * @returns {object[]} defensive copies in casting order
     */
    getActiveSustainedSpells() {
      return this.activeSustainedSpells.map(copySustainedSpell);
    }

    /**
     * Find an active sustained spell by instance id, falling back to the
     * authored spell id when no instance matches.
     *
     * @param {string} id
     * @returns {object|null}
     */
    getActiveSustainedSpell(id) {
      if (typeof id !== "string" || id.trim() === "") {
        return null;
      }
      let found = this.activeSustainedSpells.find(function (entry) {
        return entry.id === id;
      });
      if (found === undefined) {
        found = this.activeSustainedSpells.find(function (entry) {
          return entry.spellId === id;
        });
      }
      return found === undefined ? null : copySustainedSpell(found);
    }

    /**
     * Register a spell that was just cast and has the "sustained" trait.
     *
     * @param {object} spell
     * @param {object|null} target
     * @param {number} expiresAtRound
     * @returns {object} a copy of the new active-spell record
     */
    addSustainedSpell(spell, target, expiresAtRound) {
      if (spell === null || typeof spell !== "object") {
        throw new TypeError("A sustained spell must be a spell definition object.");
      }
      if (!Number.isInteger(expiresAtRound) || expiresAtRound < 0) {
        throw new RangeError("expiresAtRound must be a non-negative integer.");
      }

      let id;
      do {
        this._sustainedSpellCounter += 1;
        id = "sustained-" + this._sustainedSpellCounter;
      } while (
        this.activeSustainedSpells.some(function (entry) {
          return entry.id === id;
        })
      );

      const entry = {
        id: id,
        spellId: spell.id === undefined ? null : spell.id,
        spell: spell,
        target: target === undefined ? null : target,
        expiresAtRound: expiresAtRound,
      };
      this.activeSustainedSpells.push(entry);
      return copySustainedSpell(entry);
    }

    /**
     * Extend the expiry of one active sustained spell.
     *
     * @param {string} id active instance id
     * @param {number} expiresAtRound
     * @returns {object|null} updated copy, or null if it is not active
     */
    extendSustainedSpell(id, expiresAtRound) {
      if (!Number.isInteger(expiresAtRound) || expiresAtRound < 0) {
        throw new RangeError("expiresAtRound must be a non-negative integer.");
      }
      const entry = this.activeSustainedSpells.find(function (candidate) {
        return candidate.id === id;
      });
      if (entry === undefined) {
        return null;
      }
      entry.expiresAtRound = expiresAtRound;
      return copySustainedSpell(entry);
    }

    /**
     * Remove an active sustained spell by instance id (or spell id).
     *
     * @param {string} id
     * @returns {object|null} the removed record, or null
     */
    removeSustainedSpell(id) {
      if (typeof id !== "string" || id.trim() === "") {
        return null;
      }
      let index = this.activeSustainedSpells.findIndex(function (entry) {
        return entry.id === id;
      });
      if (index === -1) {
        index = this.activeSustainedSpells.findIndex(function (entry) {
          return entry.spellId === id;
        });
      }
      if (index === -1) {
        return null;
      }
      const removed = this.activeSustainedSpells.splice(index, 1);
      return copySustainedSpell(removed[0]);
    }

    /**
     * End-of-turn expiry. A sustained spell cast in round R stores
     * `expiresAtRound = R + 1`, so it survives the end of round R and is
     * removed at the end of round R + 1 unless Sustain a Spell extended it.
     *
     * @param {number} [round] defaults to this.encounterRound
     * @returns {object[]} removed records
     */
    expireSustainedSpells(round) {
      const current = Number.isInteger(round) ? round : this.encounterRound;
      const expired = [];
      const remaining = [];
      for (const entry of this.activeSustainedSpells) {
        if (
          Number.isInteger(entry.expiresAtRound) &&
          current >= entry.expiresAtRound
        ) {
          const expiredEntry = copySustainedSpell(entry);
          expiredEntry.reason = "sustained spell expired";
          expired.push(expiredEntry);
        } else {
          remaining.push(entry);
        }
      }
      if (expired.length > 0) {
        this.activeSustainedSpells = remaining;
      }
      return expired;
    }

    // ------------------------------------------------------------ conditions

    _conditionKey(name) {
      // createCondition validates the slug and returns the canonical key.
      return Conditions.createCondition(name).name;
    }

    /**
     * Conditions that can exist simultaneously once per source. The Map keeps
     * the primary record for the slug; the instance registry keeps every
     * source-linked record.
     *
     * @param {string} slug
     * @returns {boolean}
     */
    _isInstancedCondition(slug) {
      return (
        slug === Conditions.CONDITION_SLUGS.GRABBED ||
        slug === Conditions.CONDITION_SLUGS.RESTRAINED ||
        slug === Conditions.CONDITION_SLUGS.IMMOBILIZED
      );
    }

    _instanceSourceKey(sourceId) {
      return sourceId === null || sourceId === undefined
        ? "__none__"
        : sourceId;
    }

    _instanceList(slug, create) {
      let list = this._conditionInstances.get(slug);
      if (list === undefined && create === true) {
        list = [];
        this._conditionInstances.set(slug, list);
      }
      return list;
    }

    /**
     * Re-point the canonical Map entry at the earliest surviving instance.
     * The first grappler therefore keeps ownership of `getCondition().sourceId`
     * until that specific grab is removed.
     *
     * @param {string} slug
     * @returns {object|null}
     */
    _syncPrimaryInstance(slug) {
      const list = this._conditionInstances.get(slug);
      if (list === undefined || list.length === 0) {
        this._conditionInstances.delete(slug);
        this.conditions.delete(slug);
        return null;
      }

      let primary = list[0];
      for (const wrapper of list) {
        if (wrapper.seq < primary.seq) {
          primary = wrapper;
        }
      }
      this.conditions.set(slug, primary.condition);
      return primary.condition;
    }

    /**
     * Add or refresh one source's instance of a grapple-family condition.
     *
     * @param {object} condition
     * @returns {{condition:object,refreshed:boolean}}
     */
    _registerConditionInstance(condition) {
      const slug = condition.name;
      const list = this._instanceList(slug, true);
      const sourceKey = this._instanceSourceKey(condition.sourceId);
      let wrapper = list.find(function (entry) {
        return entry.sourceKey === sourceKey;
      });
      let refreshed = false;

      if (wrapper === undefined) {
        wrapper = {
          seq: ++this._conditionInstanceSeq,
          sourceKey: sourceKey,
          condition: condition,
        };
        list.push(wrapper);
      } else {
        wrapper.condition = condition;
        refreshed = true;
      }

      this._syncPrimaryInstance(slug);
      return {
        condition: Conditions.copyCondition(condition),
        refreshed: refreshed,
      };
    }

    _clearConditionInstances(slug) {
      this._conditionInstances.delete(slug);
    }

    /**
     * Add or refresh a condition. Frightened uses the higher of the old and new
     * values, matching PF2e's non-stacking condition value rule.
     *
     * `options` carries source-linked metadata for Grapple and round
     * durations: `{ sourceId, expiresOnSourceTurn, duration, durationOrigin,
     * round }`. Re-applying the same unvalued condition refreshes its
     * duration instead of stacking.
     *
     * @param {string} name
     * @param {number} [value]
     * @param {{sourceId?:string,expiresOnSourceTurn?:number,duration?:number,durationOrigin?:string,round?:number}} [options]
     * @returns {object|null} a copy of the stored condition, or null when the
     *   condition was removed (frightened 0)
     */
    addCondition(name, value, options) {
      const opts = options || {};
      const effective = Object.assign({}, opts);
      // Stamp the application round from the encounter clock when the caller
      // does not supply one explicitly.
      if (
        effective.duration !== undefined &&
        effective.duration !== null &&
        effective.round === undefined
      ) {
        effective.round = this.encounterRound;
      }

      const condition = Conditions.createCondition(name, value, effective);
      if (condition === null) {
        this.removeCondition(name);
        return null;
      }

      // Grabbed/Restrained/Immobilized are source-linked instance families.
      // A record from a different grappler is added alongside the existing one
      // instead of replacing it.
      if (this._isInstancedCondition(condition.name)) {
        const registered = this._registerConditionInstance(condition);
        const stored = registered.condition;
        this.emitEvent("condition:added", {
          condition: stored,
          name: stored.name,
          value: stored.value,
          refreshed: registered.refreshed,
        });
        return stored;
      }

      const existing = this.conditions.get(condition.name);
      if (existing !== undefined) {
        if (
          existing.value !== null &&
          condition.value !== null &&
          condition.value > existing.value
        ) {
          this.conditions.set(condition.name, condition);
          const stored = Conditions.copyCondition(condition);
          this.emitEvent("condition:added", {
            condition: stored,
            name: stored.name,
            value: stored.value,
            refreshed: false,
          });
          return stored;
        }
        // Unvalued conditions (Grabbed, Restrained, Immobilized, ...) refresh
        // their source and expiry metadata rather than stacking. A duration
        // supplied by the caller refreshes the round timer; omitting it keeps
        // the existing timer.
        existing.sourceId = condition.sourceId;
        existing.expiresOnSourceTurn = condition.expiresOnSourceTurn;
        if (opts.duration !== undefined) {
          existing.duration = condition.duration;
          existing.durationOrigin = condition.durationOrigin;
          existing.appliedRound = condition.appliedRound;
        }
        const stored = Conditions.copyCondition(existing);
        this.emitEvent("condition:added", {
          condition: stored,
          name: stored.name,
          value: stored.value,
          refreshed: true,
        });
        return stored;
      }

      this.conditions.set(condition.name, condition);
      const stored = Conditions.copyCondition(condition);
      this.emitEvent("condition:added", {
        condition: stored,
        name: stored.name,
        value: stored.value,
        refreshed: false,
      });
      return stored;
    }

    /**
     * @param {string} name
     * @returns {boolean} true when a condition was removed
     */
    removeCondition(name) {
      const slug = this._conditionKey(name);
      if (this._isInstancedCondition(slug)) {
        // A direct removal clears every source's instance of this slug. Escape
        // and grapple expiry use releaseGrappleFrom / removeConditionFrom to
        // remove only one source at a time.
        this._clearConditionInstances(slug);
      }
      const existing = this.conditions.get(slug);
      if (existing === undefined) {
        return false;
      }
      this.conditions.delete(slug);
      this.emitEvent("condition:removed", {
        condition: Conditions.copyCondition(existing),
        name: slug,
        value: existing.value,
      });
      return true;
    }

    /**
     * @param {string} name
     * @returns {object|null} a defensive copy of the condition record
     */
    getCondition(name) {
      const slug = this._conditionKey(name);
      const condition = this.conditions.get(slug);
      return condition === undefined ? null : Conditions.copyCondition(condition);
    }

    /**
     * Every recorded instance of an instance-family condition (Grabbed,
     * Restrained, Immobilized), oldest first. Optionally filter by source.
     *
     * @param {string} name
     * @param {string} [sourceId]
     * @returns {object[]}
     */
    getConditionInstances(name, sourceId) {
      const slug = this._conditionKey(name);
      const list = this._conditionInstances.get(slug);
      if (list === undefined) {
        return [];
      }
      return list
        .slice()
        .sort(function (a, b) {
          return a.seq - b.seq;
        })
        .filter(function (wrapper) {
          return (
            sourceId === undefined ||
            wrapper.condition.sourceId === sourceId
          );
        })
        .map(function (wrapper) {
          return Conditions.copyCondition(wrapper.condition);
        });
    }

    /**
     * The specific record one source applied for this slug, or null.
     *
     * @param {string} name
     * @param {string} sourceId
     * @returns {object|null}
     */
    getConditionFrom(name, sourceId) {
      const instances = this.getConditionInstances(name, sourceId);
      return instances.length === 0 ? null : instances[0];
    }

    /**
     * Every simultaneous Grabbed/Restrained instance, oldest first.
     *
     * @param {string} [sourceId]
     * @returns {object[]}
     */
    getGrappleInstances(sourceId) {
      const instances = [];
      for (const slug of Conditions.GRAPPLE_CONDITIONS) {
        const list = this.getConditionInstances(slug, sourceId);
        for (const condition of list) {
          instances.push(condition);
        }
      }
      return instances;
    }

    /**
     * Stable ids of every source currently maintaining a grapple.
     *
     * @returns {string[]}
     */
    getGrappleSources() {
      const sources = [];
      for (const condition of this.getGrappleInstances()) {
        if (
          typeof condition.sourceId === "string" &&
          sources.indexOf(condition.sourceId) === -1
        ) {
          sources.push(condition.sourceId);
        }
      }
      return sources;
    }

    /**
     * Remove only the instance one source applied. Other grapplers keep their
     * holds and the canonical condition remains until the last one is gone.
     *
     * @param {string} name
     * @param {string} sourceId
     * @returns {object|null} the removed record
     */
    removeConditionFrom(name, sourceId) {
      const slug = this._conditionKey(name);
      if (!this._isInstancedCondition(slug)) {
        const existing = this.getCondition(slug);
        if (
          existing !== null &&
          (sourceId === undefined || existing.sourceId === sourceId)
        ) {
          this.removeCondition(slug);
          return existing;
        }
        return null;
      }

      const list = this._instanceList(slug, false);
      if (list === undefined) {
        return null;
      }
      const index = list.findIndex(function (wrapper) {
        return wrapper.condition.sourceId === sourceId;
      });
      if (index === -1) {
        return null;
      }
      const removed = list.splice(index, 1)[0].condition;
      this._syncPrimaryInstance(slug);
      const stored = Conditions.copyCondition(removed);
      this.emitEvent("condition:removed", {
        condition: stored,
        name: slug,
        value: stored.value,
      });
      return stored;
    }

    /**
     * Numeric value of a valued condition, or 0 when it is absent/unvalued.
     *
     * @param {string} name
     * @returns {number}
     */
    getConditionValue(name) {
      const condition = this.conditions.get(this._conditionKey(name));
      return condition && Number.isInteger(condition.value) ? condition.value : 0;
    }

    /**
     * @param {string} name
     * @returns {boolean}
     */
    hasCondition(name) {
      return this.conditions.has(this._conditionKey(name));
    }

    /**
     * Whether movement actions are forbidden. Grabbed and Restrained imply
     * Immobilized, so all three conditions count even if only the parent was
     * authored.
     *
     * @returns {boolean}
     */
    isImmobilized() {
      return Conditions.isImmobilized(this);
    }

    /**
     * Active grapple condition (Restrained before Grabbed), or null.
     *
     * @returns {object|null}
     */
    getGrappleCondition() {
      return Conditions.getGrappleCondition(this);
    }

    _removeGrappleRecords(sourceId, predicate) {
      const removed = [];

      for (const slug of Conditions.GRAPPLE_CONDITIONS) {
        const list = this._instanceList(slug, false);
        if (list === undefined) {
          continue;
        }
        const remaining = [];
        for (const wrapper of list) {
          if (
            wrapper.condition.sourceId === sourceId &&
            predicate(wrapper.condition)
          ) {
            removed.push(Conditions.copyCondition(wrapper.condition));
          } else {
            remaining.push(wrapper);
          }
        }
        if (remaining.length === 0) {
          this._conditionInstances.delete(slug);
        } else {
          this._conditionInstances.set(slug, remaining);
        }
        this._syncPrimaryInstance(slug);
      }

      // Each source owns its companion Immobilized instance. Release/expiry
      // removes that source's record even when another grappler still holds the
      // victim; the other grappler's Immobilized instance keeps them locked
      // down.
      const list = this._instanceList(
        Conditions.CONDITION_SLUGS.IMMOBILIZED,
        false,
      );
      if (list !== undefined) {
        const remaining = [];
        for (const wrapper of list) {
          if (
            wrapper.condition.sourceId === sourceId &&
            predicate(wrapper.condition)
          ) {
            removed.push(Conditions.copyCondition(wrapper.condition));
          } else {
            remaining.push(wrapper);
          }
        }
        if (remaining.length === 0) {
          this._conditionInstances.delete(
            Conditions.CONDITION_SLUGS.IMMOBILIZED,
          );
        } else {
          this._conditionInstances.set(
            Conditions.CONDITION_SLUGS.IMMOBILIZED,
            remaining,
          );
        }
        this._syncPrimaryInstance(Conditions.CONDITION_SLUGS.IMMOBILIZED);
      }

      return removed;
    }

    /**
     * Break every grapple this source maintains on this combatant. Called when
     * the grappler Strides/Steps or is defeated.
     *
     * @param {string} sourceId
     * @returns {object[]} removed condition records
     */
    releaseGrappleFrom(sourceId) {
      if (typeof sourceId !== "string") {
        return [];
      }
      return this._removeGrappleRecords(sourceId, function () {
        return true;
      });
    }

    /**
     * End this source's grapples when the source's turn ends. The duration is
     * "until the end of the grappler's next turn": a grapple applied on the
     * grappler's turn N stores `expiresOnSourceTurn = N + 1`, so the end of
     * turn N keeps it and the end of turn N + 1 removes it.
     *
     * @param {string} sourceId
     * @param {number} sourceTurnNumber
     * @returns {object[]} removed condition records
     */
    expireGrapplesFrom(sourceId, sourceTurnNumber) {
      if (typeof sourceId !== "string" || !Number.isInteger(sourceTurnNumber)) {
        return [];
      }
      return this._removeGrappleRecords(sourceId, function (condition) {
        return (
          condition.expiresOnSourceTurn !== null &&
          condition.expiresOnSourceTurn !== undefined &&
          sourceTurnNumber >= condition.expiresOnSourceTurn
        );
      });
    }

    /**
     * @returns {object[]} defensive copies in insertion order
     */
    getConditions() {
      const conditions = [];
      for (const entry of this.conditions) {
        const slug = entry[0];
        const condition = entry[1];
        if (this._isInstancedCondition(slug)) {
          const list = this._conditionInstances.get(slug);
          if (list !== undefined && list.length > 0) {
            list
              .slice()
              .sort(function (a, b) {
                return a.seq - b.seq;
              })
              .forEach(function (wrapper) {
                conditions.push(Conditions.copyCondition(wrapper.condition));
              });
            continue;
          }
        }
        conditions.push(Conditions.copyCondition(condition));
      }
      return conditions;
    }

    /**
     * Modifier objects contributed by active conditions.
     *
     * @param {"attack"|"ac"|"check"|"all"} [scope]
     * @returns {{name:string,type:string,value:number,source:string}[]}
     */
    getConditionModifiers(scope) {
      const modifiers = [];
      for (const condition of this.conditions.values()) {
        // A broken or destroyed shield cannot contribute its AC bonus, even if
        // a stale shield-raised record is still present.
        if (
          condition.name === Conditions.CONDITION_SLUGS.SHIELD_RAISED &&
          this.shield !== null &&
          (Shield.isShieldBroken(this.shield) ||
            Shield.isShieldDestroyed(this.shield))
        ) {
          continue;
        }
        const contributed = Conditions.conditionModifiers(condition, scope);
        for (const modifier of contributed) {
          if (
            condition.name === Conditions.CONDITION_SLUGS.SHIELD_RAISED &&
            this.shield !== null &&
            modifier.source === "shield-raised"
          ) {
            // Use the equipped shield's authored AC bonus (bucklers/tower
            // shields). The condition's +2 remains the default when no shield
            // item is authored, preserving the headless legacy fixtures.
            modifiers.push(
              Object.assign({}, modifier, {
                value: Shield.getACBonus(this.shield),
              }),
            );
            continue;
          }
          modifiers.push(modifier);
        }
      }
      return modifiers;
    }

    // ------------------------------------------------- saves, skills & DCs

    /**
     * @returns {Object<string, number>} defensive copy of the saving throws
     */
    getSaves() {
      return Object.assign({}, this.saves);
    }

    /**
     * @returns {Object<string, number>} defensive copy of the skill modifiers
     */
    getSkills() {
      return Object.assign({}, this.skills);
    }

    /**
     * Raw saving-throw modifier, defaulting to 0 for an unknown save.
     *
     * @param {string} saveName
     * @returns {number}
     */
    getSaveModifier(saveName) {
      const name = normalizeStatName(saveName, "saveName");
      return Number.isInteger(this.saves[name]) ? this.saves[name] : 0;
    }

    /**
     * Raw skill modifier, defaulting to 0 for an unknown skill.
     *
     * @param {string} skillName
     * @returns {number}
     */
    getSkillModifier(skillName) {
      const name = normalizeStatName(skillName, "skillName");
      return Number.isInteger(this.skills[name]) ? this.skills[name] : 0;
    }

    /**
     * Situational modifiers for a skill check.
     *
     * Frightened contributes its status penalty. Attack-roll modifiers such as
     * Prone deliberately do NOT apply: an Attack-trait action such as Trip is a
     * skill check, not an attack roll, even though it uses MAP. Future
     * skill-specific bonuses can be appended through `extraModifiers`.
     *
     * @param {string} skillName
     * @param {{extraModifiers?:object[]}} [options]
     * @returns {object[]}
     */
    getSkillModifiers(skillName, options) {
      const name = normalizeStatName(skillName, "skillName");
      const opts = options || {};
      const modifiers = this.getConditionModifiers([
        "skill",
        "skill:" + name,
        "check",
      ]);
      appendExtraModifiers(modifiers, opts.extraModifiers);
      return modifiers;
    }

    /**
     * Situational modifiers for a saving throw. Standard and greater cover add
     * a circumstance bonus to Reflex saves; lesser cover is AC-only.
     *
     * @param {string} saveName
     * @param {{cover?:object|string, extraModifiers?:object[]}} [options]
     * @returns {object[]}
     */
    getSaveModifiers(saveName, options) {
      const name = normalizeStatName(saveName, "saveName");
      const opts = options || {};
      const modifiers = this.getConditionModifiers([
        "save",
        "save:" + name,
      ]);

      if (name === "reflex" && opts.cover !== undefined) {
        const coverModifier = Cover.coverReflexModifier(opts.cover);
        if (coverModifier !== null) {
          modifiers.push(coverModifier);
        }
      }

      appendExtraModifiers(modifiers, opts.extraModifiers);
      return modifiers;
    }

    /**
     * Situational modifiers for a defence DC such as Reflex DC, Fortitude DC,
     * or Will DC. Cover applies to Reflex DC at standard/greater cover.
     * `"ac"` is also accepted for AC-scope condition queries; AC itself is
     * already a DC and is resolved directly by Strike rather than through
     * `calculateDC`.
     *
     * @param {string} dcName
     * @param {{cover?:object|string, extraModifiers?:object[]}} [options]
     * @returns {object[]}
     */
    getDCModifiers(dcName, options) {
      const name = normalizeStatName(dcName, "dcName");
      const opts = options || {};
      const scopes = ["dc", "dc:" + name];
      if (name === "ac") {
        scopes.push("ac");
      }
      const modifiers = this.getConditionModifiers(scopes);

      if (name === "reflex" && opts.cover !== undefined) {
        const coverModifier = Cover.coverReflexModifier(opts.cover);
        if (coverModifier !== null) {
          modifiers.push(coverModifier);
        }
      }

      appendExtraModifiers(modifiers, opts.extraModifiers);
      return modifiers;
    }

    // ----------------------------------------------------- persistent damage

    /**
     * Add or upgrade persistent damage. Same-type instances do not stack; the
     * stronger formula wins. Different types coexist.
     *
     * @param {{id?:string,formula:string,type?:string}|string} input
     * @param {string} [fallbackType]
     * @returns {{instance:object,added:boolean,replaced:boolean,keptExisting:boolean,previous:object|null}}
     */
    addPersistentDamage(input, fallbackType) {
      return PersistentDamage.addPersistentDamage(
        this.persistentDamage,
        input,
        fallbackType,
      );
    }

    /**
     * Remove by instance id, or by damage type. A type removes every instance
     * of that type (there is at most one by construction).
     *
     * @param {string} idOrType
     * @returns {boolean}
     */
    removePersistentDamage(idOrType) {
      return PersistentDamage.removePersistentDamage(
        this.persistentDamage,
        idOrType,
      );
    }

    /**
     * @param {string} [type] omit to ask whether any persistent damage is active
     * @returns {boolean}
     */
    hasPersistentDamage(type) {
      return PersistentDamage.hasPersistentDamage(
        this.persistentDamage,
        type,
      );
    }

    /**
     * @returns {{id:string,formula:string,type:string}[]} defensive copies
     */
    getPersistentDamage() {
      return PersistentDamage.getPersistentDamage(this.persistentDamage);
    }

    clearPersistentDamage() {
      this.persistentDamage.length = 0;
      return this;
    }

    /**
     * Decrease timed condition values at the end of this combatant's turn.
     * Frightened is the only timed condition in this slice.
     *
     * @returns {{name:string,from:number,to:number,removed:boolean}|null}
     */
    tickConditions() {
      const slug = Conditions.CONDITION_SLUGS.FRIGHTENED;
      const frightened = this.conditions.get(slug);
      if (frightened === undefined) {
        return null;
      }

      const from = frightened.value;
      const to = from - 1;
      if (to <= 0) {
        this.conditions.delete(slug);
        return { name: slug, from: from, to: 0, removed: true };
      }

      const next = Conditions.createCondition(slug, to);
      this.conditions.set(slug, next);
      return { name: slug, from: from, to: to, removed: false };
    }

    /**
     * Expire round-duration conditions at the matching turn phase.
     *
     * Semantics:
     *   - `durationOrigin: "start"` (default) with duration N applied in
     *     encounter round R expires at the start phase of round R + N;
     *   - `durationOrigin: "end"` with duration N expires at the end phase of
     *     round R + N - 1, so a 1-round "end" effect resolves at the end of
     *     the round in which it was applied.
     *
     * @param {{phase?:"start"|"end", round?:number}} [options]
     * @returns {object[]} removed condition records
     */
    tickDurations(options) {
      const opts = options || {};
      const phase = opts.phase === undefined ? "start" : opts.phase;
      if (Conditions.DURATION_ORIGINS.indexOf(phase) === -1) {
        throw new RangeError('phase must be "start" or "end".');
      }
      const round = Number.isInteger(opts.round)
        ? opts.round
        : this.encounterRound;

      const removed = [];
      for (const entry of this.conditions) {
        const slug = entry[0];
        const condition = entry[1];
        if (!Number.isInteger(condition.duration) || condition.duration <= 0) {
          continue;
        }
        const origin =
          condition.durationOrigin === null ||
          condition.durationOrigin === undefined
            ? "start"
            : condition.durationOrigin;
        if (origin !== phase) {
          continue;
        }
        const appliedRound = Number.isInteger(condition.appliedRound)
          ? condition.appliedRound
          : round;
        const threshold =
          origin === "start"
            ? condition.duration
            : Math.max(0, condition.duration - 1);
        if (round - appliedRound >= threshold) {
          this.conditions.delete(slug);
          if (this._isInstancedCondition(slug)) {
            this._clearConditionInstances(slug);
          }
          removed.push(Conditions.copyCondition(condition));
        }
      }
      return removed;
    }

    /**
     * Spend the start-of-turn action tax from Stunned and Slowed.
     *
     * Stunned and Slowed never stack for this purpose: the larger value is
     * applied once. Stunned is then paid down by the actions actually lost.
     * When the pool is smaller than the Stunned value the remaining value
     * carries into the next turn (the debt); once it reaches zero the
     * condition is removed.
     *
     * @returns {{
     *   stunned:number,
     *   slowed:number,
     *   loss:number,
     *   lost:number,
     *   actionsRemaining:number
     * }}
     */
    _applyStartOfTurnActionLoss() {
      const stunned = this.getConditionValue(Conditions.CONDITION_SLUGS.STUNNED);
      const slowed = this.getConditionValue(Conditions.CONDITION_SLUGS.SLOWED);
      const loss = Math.max(stunned, slowed);
      const before = this.actionsRemaining;

      if (loss <= 0 || before <= 0) {
        return {
          stunned: stunned,
          slowed: slowed,
          loss: loss,
          lost: 0,
          actionsRemaining: before,
        };
      }

      const lost = Math.min(loss, before);
      this.actionsRemaining = before - lost;

      let stunnedRemaining = stunned;
      if (stunned > 0) {
        stunnedRemaining = Math.max(0, stunned - lost);
        if (stunnedRemaining === 0) {
          this.conditions.delete(Conditions.CONDITION_SLUGS.STUNNED);
        } else {
          const record = this.conditions.get(
            Conditions.CONDITION_SLUGS.STUNNED,
          );
          const next = Conditions.createCondition(
            Conditions.CONDITION_SLUGS.STUNNED,
            stunnedRemaining,
            {
              sourceId:
                record && record.sourceId ? record.sourceId : undefined,
              expiresOnSourceTurn:
                record && Number.isInteger(record.expiresOnSourceTurn)
                  ? record.expiresOnSourceTurn
                  : undefined,
              duration:
                record && Number.isInteger(record.duration)
                  ? record.duration
                  : undefined,
              durationOrigin:
                record && record.durationOrigin ? record.durationOrigin : undefined,
              round:
                record && Number.isInteger(record.appliedRound)
                  ? record.appliedRound
                  : undefined,
            },
          );
          this.conditions.set(Conditions.CONDITION_SLUGS.STUNNED, next);
        }
      }

      return {
        stunned: stunnedRemaining,
        slowed: slowed,
        loss: loss,
        lost: lost,
        actionsRemaining: this.actionsRemaining,
      };
    }

    // ---------------------------------------------------------- afflictions

    /**
     * Add an affliction (poison, disease, ...) to this combatant. Re-adding an
     * affliction with the same id refreshes its save profile and keeps the
     * higher current stage.
     *
     * @param {object} input
     * @returns {object} a defensive copy of the stored affliction
     */
    addAffliction(input) {
      if (!Afflictions) {
        throw new Error("Affliction module is not loaded.");
      }
      const affliction = Afflictions.createAffliction(input);
      const index = this.afflictions.findIndex(function (entry) {
        return entry.id === affliction.id;
      });
      if (index !== -1) {
        const existing = this.afflictions[index];
        existing.name = affliction.name;
        existing.saveType = affliction.saveType;
        existing.saveDC = affliction.saveDC;
        existing.maxStage = affliction.maxStage;
        existing.stage = Math.min(
          affliction.maxStage,
          Math.max(existing.stage, affliction.stage),
        );
        if (affliction.sourceId !== null) {
          existing.sourceId = affliction.sourceId;
        }
        return Afflictions.copyAffliction(existing);
      }

      this.afflictions.push(affliction);
      return Afflictions.copyAffliction(affliction);
    }

    /**
     * @param {string} id
     * @returns {boolean} true when an affliction was removed
     */
    removeAffliction(id) {
      const index = this.afflictions.findIndex(function (entry) {
        return entry.id === id;
      });
      if (index === -1) {
        return false;
      }
      this.afflictions.splice(index, 1);
      return true;
    }

    /**
     * @param {string} id
     * @returns {boolean}
     */
    hasAffliction(id) {
      return this.afflictions.some(function (entry) {
        return entry.id === id;
      });
    }

    /**
     * @param {string} [id] omit to list every affliction
     * @returns {object|null|object[]} one defensive copy, or all of them
     */
    getAffliction(id) {
      if (id === undefined) {
        return this.getAfflictions();
      }
      const found = this.afflictions.find(function (entry) {
        return entry.id === id;
      });
      return found === undefined ? null : Afflictions.copyAffliction(found);
    }

    /**
     * @returns {object[]} defensive copies
     */
    getAfflictions() {
      return this.afflictions.map(function (entry) {
        return Afflictions.copyAffliction(entry);
      });
    }

    /**
     * End-of-turn resolution. Frightened decays here, every persistent damage
     * instance rolls its damage, recovery check, and IWR, round durations
     * whose origin is "end" expire, and every affliction makes its
     * end-of-turn saving throw.
     *
     * Callbacks:
     *   - `rollDie(sides)` / `rollDamageDie(sides)` for persistent damage dice;
     *   - `rollD20()` / `rollFlatCheck()` for the recovery check.
     *
     * @param {{rollDie?:Function,rollDamageDie?:Function,rollD20?:Function,rollFlatCheck?:Function}} [options]
     * @returns {{
     *   frightened: object|null,
     *   changed: boolean,
     *   persistentTick: object,
     *   persistentChanged: boolean
     * }}
     */
    endTurn(options) {
      const opts = options || {};
      const frightened = this.tickConditions();
      const persistentTick = PersistentDamage.tickPersistentDamage({
        combatant: this,
        instances: this.persistentDamage,
        rollDie: opts.rollDie,
        rollDamageDie: opts.rollDamageDie,
        rollD20: opts.rollD20,
        rollFlatCheck: opts.rollFlatCheck,
      });
      const durationExpiry = this.tickDurations({
        phase: "end",
        round: opts.round,
      });
      const afflictionTick = Afflictions
        ? Afflictions.tickAfflictions({
            combatant: this,
            d20: opts.afflictionD20,
            rollAfflictionSave: opts.rollAfflictionSave,
            rollD20: opts.rollD20,
            rollDie: opts.rollDie,
          })
        : { results: [], changed: false, cured: [] };
      const releasedGrapples = this._releaseGrapplesAtEndOfTurn(opts.combatants);
      const expiredSustainedSpells = this.expireSustainedSpells(opts.round);
      return {
        frightened: frightened,
        changed: frightened !== null,
        persistentTick: persistentTick,
        persistentChanged: persistentTick.changed,
        durationExpiry: durationExpiry,
        afflictionTick: afflictionTick,
        afflictionsChanged: afflictionTick.changed,
        curedAfflictions: afflictionTick.cured,
        releasedGrapples: releasedGrapples,
        expiredSustainedSpells: expiredSustainedSpells,
      };
    }

    /**
     * End or break the grapples this combatant maintains. A living grappler
     * expires only grapples whose `expiresOnSourceTurn` has been reached; a
     * defeated grappler releases them immediately.
     *
     * @param {object[]} [combatants]
     * @returns {{combatant:object,combatantId:string,combatantName:string,removed:object[]}[]}
     */
    _releaseGrapplesAtEndOfTurn(combatants) {
      if (!Array.isArray(combatants)) {
        return [];
      }

      const released = [];
      for (const combatant of combatants) {
        if (
          combatant === null ||
          typeof combatant !== "object" ||
          combatant === this
        ) {
          continue;
        }

        let removed = [];
        if (this.isDefeated) {
          if (typeof combatant.releaseGrappleFrom === "function") {
            removed = combatant.releaseGrappleFrom(this.id);
          }
        } else if (typeof combatant.expireGrapplesFrom === "function") {
          removed = combatant.expireGrapplesFrom(this.id, this.turnNumber);
        }

        if (removed.length > 0) {
          released.push({
            combatant: combatant,
            combatantId: combatant.id,
            combatantName: combatant.name,
            removed: removed,
          });
        }
      }
      return released;
    }

    /**
     * Frozen typed damage contract for this combatant's weapon/attack.
     *
     * @returns {{formula:string,type:string}}
     */
    getDamageSpec() {
      return this.damageSpec;
    }

    /**
     * Active weapon definition used by the damage calculator.
     *
     * @returns {{formula:string,type:string,traits:string[]}}
     */
    getWeapon() {
      return {
        formula: this.damage,
        type: this.damageType,
        traits: this.traits.slice(),
        rangeIncrement: this.weapon.rangeIncrement,
        reload: this.weapon.reload,
        volley: this.weapon.volley,
        isRanged: this.weapon.isRanged,
      };
    }

    /**
     * @returns {number|null} range increment in feet, or null for melee
     */
    getRangeIncrement() {
      return this.weapon.rangeIncrement;
    }

    /**
     * @returns {number} reload cost in actions (0 when no reload is required)
     */
    getReload() {
      return this.weapon.reload;
    }

    /**
     * @returns {number|null} volley range in feet
     */
    getVolley() {
      return this.weapon.volley;
    }

    /**
     * @returns {boolean} true when a shot must be followed by Reload
     */
    requiresReload() {
      return this.weapon.reload > 0;
    }

    /**
     * @returns {boolean}
     */
    isRangedWeapon() {
      return this.weapon.isRanged === true;
    }

    /**
     * @param {string} name canonical trait name or full slug ("deadly" or "deadly-d8")
     * @returns {boolean}
     */
    hasTrait(name) {
      return WeaponTraits.hasTrait(this.traitDefinitions, name);
    }

    /**
     * @param {string} name
     * @returns {object|null} structured trait definition
     */
    getTrait(name) {
      return WeaponTraits.getTrait(this.traitDefinitions, name);
    }

    /**
     * @returns {string[]} canonical trait slugs, e.g. ["reach", "deadly-d8"]
     */
    getTraits() {
      return this.traits.slice();
    }

    /**
     * @returns {string[]} display labels, e.g. ["reach", "deadly d8"]
     */
    getTraitLabels() {
      return WeaponTraits.traitLabels(this.traitDefinitions);
    }

    // ------------------------------------------------------------------ senses

    /**
     * @returns {string[]} defensive copy of the canonical sense slugs
     */
    getSenses() {
      return this.senses.slice();
    }

    /**
     * Whether this creature has a sense. A base query such as `"tremorsense"`
     * matches any ranged variant (`"tremorsense-30"`); a ranged query requires
     * an exact match.
     *
     * @param {string} name
     * @returns {boolean}
     */
    hasSense(name) {
      const query = canonicalSenseName(name, "sense");
      return this.senses.some(function (stored) {
        if (stored === query) {
          return true;
        }
        // A base sense name matches its ranged variants.
        return !/\d/.test(query) && stored.indexOf(query + "-") === 0;
      });
    }

    /**
     * @returns {boolean}
     */
    hasLowLightVision() {
      return this.hasSense("low-light-vision");
    }

    /**
     * @returns {boolean}
     */
    hasDarkvision() {
      return this.hasSense("darkvision");
    }

    /**
     * Authored range in feet for a ranged sense, or null when the sense has no
     * authored range (vision, darkvision, low-light vision).
     *
     * @param {string} name
     * @returns {number|null}
     */
    getSenseRange(name) {
      const query = canonicalSenseName(name, "sense");
      for (const stored of this.senses) {
        const matches =
          stored === query ||
          (!/\d/.test(query) && stored.indexOf(query + "-") === 0);
        if (!matches) {
          continue;
        }
        const ranged = stored.match(/-(\d+)$/);
        return ranged === null ? null : Number(ranged[1]);
      }
      return null;
    }

    /**
     * Add a sense if it is not already present.
     *
     * @param {string|object} sense
     * @returns {boolean} true when the list changed
     */
    addSense(sense) {
      const normalized = senseFromEntry(sense, this.senses.length);
      if (this.senses.indexOf(normalized) !== -1) {
        return false;
      }
      this.senses.push(normalized);
      return true;
    }

    /**
     * Remove a sense. A base name removes every ranged variant.
     *
     * @param {string} name
     * @returns {boolean} true when anything was removed
     */
    removeSense(name) {
      const query = canonicalSenseName(name, "sense");
      const before = this.senses.length;
      this.senses = this.senses.filter(function (stored) {
        if (stored === query) {
          return false;
        }
        return !(!/\d/.test(query) && stored.indexOf(query + "-") === 0);
      });
      return this.senses.length !== before;
    }

    /**
     * Melee reach in feet. The `reach` weapon trait increases it to 10 ft.
     *
     * @returns {number}
     */
    getReachFeet() {
      return WeaponTraits.getReachFeet(this.traitDefinitions, 5);
    }

    /**
     * Snapshot of this combatant's authored IWR profile.
     *
     * @returns {{
     *   immunities: string[],
     *   weaknesses: {type:string,value:number}[],
     *   resistances: {type:string,value:number}[]
     * }}
     */
    getIWR() {
      return {
        immunities: this.immunities.slice(),
        weaknesses: this.weaknesses.map(function (entry) {
          return { type: entry.type, value: entry.value };
        }),
        resistances: this.resistances.map(function (entry) {
          return { type: entry.type, value: entry.value };
        }),
      };
    }

    /**
     * Apply damage through the canonical Immunity -> Weakness -> Resistance
     * pipeline. HP floors at 0 and the combatant becomes defeated at 0.
     *
     * Options:
     *   - `type`: damage type for a single-instance hit (default `untyped`).
     *   - `damageInstances`: pre-split typed instances, used when an attack
     *     deals more than one type. When present, `amount` is only the base
     *     caller amount and the instances drive the calculation.
     *   - `applyIWR: false`: bypass IWR entirely (e.g. future healing rules).
     *   - `isCrit: true`: the damage came from a critical hit, which starts
     *     Dying at 2 + Wounded instead of 1 + Wounded.
     *   - `shieldBlock: false`: opt out of the automatic Shield Block
     *     reaction for this damage instance. When omitted, the reaction fires
     *     automatically if the defender has a raised, unbroken shield, an
     *     unspent reaction, and the damage is physical. Passing `true` also
     *     returns a structured failure report when the trigger is not legal.
     *
     * `damageTaken` remains the actual HP lost (clamped), while
     * `damageApplied` is the post-IWR damage (before Shield Block) and
     * `actorDamageApplied` is the damage that actually reached the wielder.
     * `baseDamage` is the pre-IWR amount. This keeps overkill visible in the
     * log exactly like Phase 4.
     *
     * @param {number} amount non-negative integer
     * @param {{type?:string, damageInstances?:{amount:number,type:string}[], applyIWR?:boolean, shieldBlock?:boolean}} [options]
     * @returns {{
     *   damageTaken: number,
     *   damageApplied: number,
     *   actorDamageApplied: number,
     *   baseDamage: number,
     *   currentHP: number,
     *   maxHP: number,
     *   isDefeated: boolean,
     *   iwr: object|null,
     *   shieldBlock: object|null
     * }}
     */
    takeDamage(amount, options) {
      if (!Number.isInteger(amount) || amount < 0) {
        throw new RangeError("Damage must be a non-negative integer.");
      }

      const opts = options || {};
      let finalDamage = amount;
      let iwr = null;

      const damageInstances = Array.isArray(opts.damageInstances)
        ? opts.damageInstances
        : [
            {
              amount: amount,
              type: opts.type === undefined ? "untyped" : opts.type,
            },
          ];

      if (opts.applyIWR !== false) {
        iwr = IWR.applyIWR({
          damageInstances: damageInstances,
          immunities: this.immunities,
          weaknesses: this.weaknesses,
          resistances: this.resistances,
        });
        finalDamage = iwr.totalDamage;
      }

      // Shield Block happens after IWR: Hardness reduces the damage that
      // would otherwise reach the wielder. The reaction triggers automatically
      // when the defender has a raised, unbroken shield, an unspent reaction,
      // and the damage is physical. Callers may opt out with
      // `{ shieldBlock: false }`; `true` forces a structured failure report
      // when the trigger is not legal.
      let shieldBlock = null;
      let damageAfterShield = finalDamage;
      if (opts.shieldBlock !== false && finalDamage > 0) {
        let shieldDamageType = opts.type;
        if (shieldDamageType === undefined && damageInstances.length > 0) {
          const types = damageInstances.map(function (instance) {
            return String(instance.type || "untyped").toLowerCase();
          });
          if (
            types.every(function (type) {
              return Shield.isPhysicalDamageType(type);
            })
          ) {
            shieldDamageType = types[0];
          }
        }
        const report = Shield.resolveShieldBlock({
          combatant: this,
          damage: finalDamage,
          damageType: shieldDamageType,
        });
        if (report.ok === true) {
          shieldBlock = report;
          damageAfterShield = report.damageToActor;
        } else if (opts.shieldBlock === true) {
          shieldBlock = report;
        }
      }

      const before = this.currentHP;
      this.currentHP = Math.max(0, before - damageAfterShield);

      if (this.currentHP === 0) {
        // 0 HP is the defeated state for backwards compatibility. The dying
        // track below records whether the creature is still recoverable.
        this.isDefeated = true;

        if (before > 0) {
          // A living creature reduced to 0 HP becomes unconscious, prone,
          // and dying. Wounded increases the initial dying value, and a
          // critical hit starts one step higher.
          this.addCondition("unconscious");
          this.addCondition("prone");

          const wounded = this.getConditionValue("wounded");
          const initialDying = Math.min(
            DYING_MAX,
            (opts.isCrit === true ? 2 : 1) + wounded,
          );
          this.conditions.set(
            Conditions.CONDITION_SLUGS.DYING,
            Conditions.createCondition("dying", initialDying),
          );
          if (initialDying >= DYING_MAX) {
            this.isDefeated = true;
          }
        } else if (damageAfterShield > 0 && this.hasCondition("dying")) {
          // Already dying at 0 HP: further damage advances the dying track.
          const currentDying = this.getConditionValue("dying");
          const nextDying = Math.min(
            DYING_MAX,
            currentDying + (opts.isCrit === true ? 2 : 1),
          );
          this.conditions.set(
            Conditions.CONDITION_SLUGS.DYING,
            Conditions.createCondition("dying", nextDying),
          );
          if (nextDying >= DYING_MAX) {
            this.isDefeated = true;
          }
        }
      }

      const result = {
        damageTaken: before - this.currentHP,
        damageApplied: finalDamage,
        actorDamageApplied: damageAfterShield,
        baseDamage: amount,
        currentHP: this.currentHP,
        maxHP: this.maxHP,
        isDefeated: this.isDefeated,
        iwr: iwr,
        shieldBlock: shieldBlock,
      };

      const eventType =
        opts.type !== undefined
          ? opts.type
          : damageInstances.length > 0
            ? damageInstances[0].type
            : "untyped";
      this.emitEvent("combatant:damaged", {
        amount: amount,
        damageType: eventType,
        damageTaken: result.damageTaken,
        damageApplied: result.damageApplied,
        actorDamageApplied: result.actorDamageApplied,
        baseDamage: result.baseDamage,
        currentHP: result.currentHP,
        maxHP: result.maxHP,
        isDefeated: result.isDefeated,
        iwr: result.iwr,
        shieldBlock: result.shieldBlock,
        source: opts.source === undefined ? null : opts.source,
      });

      return result;
    }

    /**
     * Apply healing to this combatant. Healing a dying creature removes Dying,
     * increases Wounded by 1, and wakes it up (Unconscious is removed).
     * A creature that died at Dying 4 cannot be healed by this method.
     *
     * @param {number} amount non-negative integer
     * @returns {{ok:boolean, reason?:string, healed?:number, currentHP?:number, wokeUp?:boolean}}
     */
    applyHealing(amount) {
      if (!Number.isInteger(amount) || amount < 0) {
        throw new RangeError("Healing must be a non-negative integer.");
      }

      if (
        this.isDefeated &&
        this.hasCondition("dying") &&
        this.getConditionValue("dying") >= DYING_MAX
      ) {
        return { ok: false, reason: "dead" };
      }

      const prevHP = this.currentHP;
      this.currentHP = Math.min(this.maxHP, this.currentHP + amount);

      let wokeUp = false;
      if (this.hasCondition("dying")) {
        this.removeCondition("dying");
        const currentWounded = this.getConditionValue("wounded");
        this.addCondition("wounded", currentWounded + 1);
        this.removeCondition("unconscious");
        wokeUp = true;
      }

      if (this.currentHP > 0) {
        this.isDefeated = false;
      }

      return {
        ok: true,
        healed: this.currentHP - prevHP,
        currentHP: this.currentHP,
        wokeUp: wokeUp,
      };
    }

    /**
     * PF2e Remastered recovery check at the start of a dying creature's turn.
     * Flat check DC 10 + Dying:
     *   - critical success: Dying -2;
     *   - success: Dying -1;
     *   - failure: Dying +1;
     *   - critical failure: Dying +2.
     * Reaching 0 removes Dying (the creature is stable but still at 0 HP and
     * unconscious); reaching 4 kills it.
     *
     * @param {object} [options]
     * @returns {object|null} a log record, or null when no check was made
     */
    resolveRecoveryCheck(options) {
      const dying = this.conditions.get(Conditions.CONDITION_SLUGS.DYING);
      if (dying === undefined) {
        return null;
      }
      if (dying.value >= DYING_MAX) {
        this.isDefeated = true;
        return null;
      }

      const dc = 10 + dying.value;
      const d20 = resolveRecoveryD20(options);
      const check = Checks.evaluateCheck({
        d20: d20,
        modifier: 0,
        dc: dc,
      });

      let delta;
      if (check.degree === Checks.DEGREES.CRITICAL_SUCCESS) {
        delta = -2;
      } else if (check.degree === Checks.DEGREES.SUCCESS) {
        delta = -1;
      } else if (check.degree === Checks.DEGREES.FAILURE) {
        delta = 1;
      } else {
        delta = 2;
      }

      const from = dying.value;
      const next = Math.max(0, Math.min(DYING_MAX, from + delta));
      let removed = false;
      if (next === 0) {
        this.conditions.delete(Conditions.CONDITION_SLUGS.DYING);
        removed = true;
      } else {
        this.conditions.set(
          "dying",
          Conditions.createCondition("dying", next),
        );
      }

      if (next >= DYING_MAX) {
        this.isDefeated = true;
      }

      return {
        d20: d20,
        dc: dc,
        degree: check.degree,
        from: from,
        to: next,
        removed: removed,
        defeated: this.isDefeated === true,
        isNatural20: check.isNatural20,
        isNatural1: check.isNatural1,
      };
    }

    canSpendActions(count) {
      const amount = count === undefined ? 1 : count;
      return Number.isInteger(amount) && amount > 0 && this.actionsRemaining >= amount;
    }

    spendActions(count) {
      const amount = count === undefined ? 1 : count;
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new RangeError("Action cost must be a positive integer.");
      }
      if (this.actionsRemaining < amount) {
        throw new Error(
          this.name + " has only " + this.actionsRemaining + " action(s) remaining.",
        );
      }
      this.actionsRemaining -= amount;
      return this.actionsRemaining;
    }

    /**
     * Whether the combatant can still pay for a reaction this round.
     *
     * @param {number} [count]
     * @returns {boolean}
     */
    canSpendReaction(count) {
      const amount = count === undefined ? 1 : count;
      return (
        Number.isInteger(amount) &&
        amount > 0 &&
        this.reactionsRemaining >= amount
      );
    }

    /**
     * Spend reactions. Reactions are a separate pool from actions and are
     * restored only at the start of this combatant's own turn.
     *
     * Optional `metadata` is merged into a `"reaction:triggered"` event so the
     * caller can distinguish Reactive Strike, Shield Block, and future
     * reactions without the Combatant knowing the action names.
     *
     * @param {number} [count]
     * @param {object} [metadata]
     * @returns {number} reactions remaining
     */
    spendReaction(count, metadata) {
      const amount = count === undefined ? 1 : count;
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new RangeError("Reaction cost must be a positive integer.");
      }
      if (this.reactionsRemaining < amount) {
        throw new Error(
          this.name +
            " has only " +
            this.reactionsRemaining +
            " reaction(s) remaining.",
        );
      }
      this.reactionsRemaining -= amount;
      const info = metadata || {};
      this.emitEvent(
        "reaction:triggered",
        Object.assign(
          {
            reactionType:
              typeof info.type === "string" ? info.type : "reaction",
            reactionCost: amount,
            reactionsLeft: this.reactionsRemaining,
          },
          info,
        ),
      );
      return this.reactionsRemaining;
    }

    setPosition(x, y) {
      assertInteger(x, "x");
      assertInteger(y, "y");
      this._x = x;
      this._y = y;
      return this;
    }

    /**
     * Current elevation in feet above the battlefield baseline (0 ft default).
     *
     * @returns {number}
     */
    getElevation() {
      return this.elevation;
    }

    /**
     * Set the elevation in feet. Accepts any finite number (typically a
     * multiple of 5, but the 3D distance math rounds partial squares up).
     *
     * @param {number} feet
     * @returns {Combatant}
     */
    setElevation(feet) {
      if (typeof feet !== "number" || !Number.isFinite(feet)) {
        throw new TypeError("elevation must be a finite number of feet.");
      }
      this.elevation = feet;
      return this;
    }

    registerDiagonalSteps(count) {
      const amount = count === undefined ? 1 : count;
      if (!Number.isInteger(amount) || amount < 0) {
        throw new RangeError("Diagonal step count must be a non-negative integer.");
      }
      this.diagonalStepsThisTurn += amount;
      return this.diagonalStepsThisTurn;
    }

    /**
     * Reset per-turn action and movement state.
     *
     * By default this also performs the end-of-turn condition tick so a caller
     * that drives turns manually gets the Frightened decay. Encounter passes
     * `{ tickConditions: false }` because it calls endTurn() on the outgoing
     * combatant and must not tick the incoming combatant prematurely.
     *
     * A dying creature also resolves its recovery flat check here, before any
     * other start-of-turn upkeep. The result is exposed as
     * `lastRecoveryCheck` for the combat log.
     *
     * A raised shield lasts until the start of the raiser's next turn, so it
     * is removed here unconditionally, including when the Frightened tick is
     * suppressed for the incoming combatant. Greater cover from Take Cover
     * has the same duration and is cleared here as well. The reaction budget
     * is also restored here: reactions spent during other creatures' turns
     * come back at the start of this combatant's own turn.
     *
     * Start-of-turn upkeep order:
     *   1. dying recovery check;
     *   2. optional end-of-turn tick for manually driven turns;
     *   3. "start" round-duration expiry;
     *   4. reset the action/reaction pools;
     *   5. Stunned/Slowed action loss (the larger value only).
     *
     * @param {{tickConditions?: boolean, round?: number, rollD20?: Function, rollAfflictionSave?: Function}} [options]
     * @returns {Combatant}
     */
    resetTurn(options) {
      const opts = options || {};
      // A dying creature makes its recovery flat check at the very start of
      // its turn, before any other start-of-turn upkeep.
      this.lastRecoveryCheck = this.resolveRecoveryCheck(opts);
      if (opts.tickConditions !== false) {
        this.endTurn(opts);
      }
      this.lastDurationExpiry = this.tickDurations({
        phase: "start",
        round: opts.round,
      });
      this.conditions.delete(Conditions.CONDITION_SLUGS.SHIELD_RAISED);
      this.conditions.delete(Conditions.CONDITION_SLUGS.GREATER_COVER);
      this.actionsRemaining = this.maxActions;
      this.reactionsRemaining = this.maxReactions;
      this.diagonalStepsThisTurn = 0;
      this.attacksThisTurn = 0;
      this.lastActionLoss = this._applyStartOfTurnActionLoss();
      // A new turn begins. Grapple durations are expressed against this
      // monotonic counter so "until the end of your next turn" is exact.
      this.turnNumber += 1;
      return this;
    }
  }

  Combatant.ALLIANCES = ALLIANCES;
  Combatant.SAVE_NAMES = SAVE_NAMES;
  Combatant.SKILL_NAMES = SKILL_NAMES;
  // Allow both `require(combatant).Combatant` and the direct class export used
  // by the existing test suites.
  Combatant.Combatant = Combatant;

  return Combatant;
});
