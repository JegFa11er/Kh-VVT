/**
 * PF2E REMASTERED — WEAPON TRAITS & DAMAGE (HEADLESS CORE)
 *
 * Implements the Remastered weapon traits that change damage or reach:
 *
 *   - reach:       the weapon's melee reach is 10 ft instead of 5 ft.
 *   - deadly <d>:  on a critical success add one extra damage die that is
 *                  NOT doubled by the critical multiplier.
 *   - fatal <d>:   on a critical success replace the weapon's base damage die
 *                  with the fatal die, double the replaced base damage, then
 *                  add one extra fatal die that is NOT doubled.
 *   - backstabber: +1 damage against an Off-Guard target, doubled along with
 *                  the base damage on a critical success (+2 before the
 *                  critical multiplier is applied).
 *
 * The module is pure: the caller supplies the degree of success and the die
 * callbacks. It does not mutate a Combatant and does not apply IWR.
 *
 * Accepted trait authoring forms:
 *
 *   ["reach", "backstabber", "deadly-d8", "fatal-d10"]
 *   ["deadly d8", "fatal d10"]
 *   [{ name: "deadly", dieSize: 8 }, { name: "fatal", die: "d10" }]
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./damage.js"),
      require("./checks.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Rules = root.PF2e.Core.Rules || {};
    root.PF2e.Core.Rules.WeaponTraits = factory(
      root.PF2e.Core.Rules.Damage,
      root.PF2e.Core.Rules.Checks,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Damage, Checks) {
  "use strict";

  const TRAIT_NAMES = Object.freeze({
    REACH: "reach",
    BACKSTABBER: "backstabber",
    DEADLY: "deadly",
    FATAL: "fatal",
    RANGED: "ranged",
    THROWN: "thrown",
    VOLLEY: "volley",
    RELOAD: "reload",
  });

  const KNOWN_TRAITS = Object.freeze([
    TRAIT_NAMES.REACH,
    TRAIT_NAMES.BACKSTABBER,
    TRAIT_NAMES.DEADLY,
    TRAIT_NAMES.FATAL,
  ]);

  /**
   * Remastered ranged traits carry a numeric value as part of the slug:
   * `ranged-30`, `thrown-20`, `volley-30`, `reload-1`. They are parsed into
   * `{ name, slug, value }` so the weapon profile can read them without a
   * second ad-hoc regex at every call site.
   */
  const PARAMETERIZED_TRAITS = Object.freeze([
    TRAIT_NAMES.RANGED,
    TRAIT_NAMES.THROWN,
    TRAIT_NAMES.VOLLEY,
    TRAIT_NAMES.RELOAD,
  ]);

  const REACH_WITH_TRAIT_FEET = 10;
  const DEFAULT_REACH_FEET = 5;
  const RANGE_PENALTY_PER_INCREMENT = 2;
  const MAX_RANGE_INCREMENTS = 6;
  const VOLLEY_PENALTY = 2;

  function normalizeText(value) {
    return String(value).trim().toLowerCase().replace(/[-_\s]+/g, " ");
  }

  function parseDieSize(value) {
    if (value === undefined || value === null || value === "") {
      return null;
    }
    if (typeof value === "number") {
      if (!Number.isInteger(value) || value <= 0) {
        throw new RangeError("Weapon trait die size must be a positive integer.");
      }
      return value;
    }
    const text = String(value).trim().toLowerCase();
    const match = /^d?(\d+)$/.exec(text);
    if (!match) {
      throw new RangeError(
        'Weapon trait die must look like "d8", "8" or 8; received ' + String(value) + ".",
      );
    }
    const size = Number.parseInt(match[1], 10);
    if (size <= 0) {
      throw new RangeError("Weapon trait die size must be positive.");
    }
    return size;
  }

  function parseTraitAmount(value) {
    if (value === undefined || value === null || value === "") {
      return null;
    }
    if (typeof value === "number") {
      if (!Number.isInteger(value) || value <= 0) {
        throw new RangeError("Weapon trait value must be a positive integer.");
      }
      return value;
    }
    const match = /(\d+)/.exec(String(value));
    if (!match) {
      throw new RangeError(
        'Weapon trait value must contain a positive integer; received ' +
          String(value) +
          ".",
      );
    }
    const parsed = Number.parseInt(match[1], 10);
    if (parsed <= 0) {
      throw new RangeError("Weapon trait value must be a positive integer.");
    }
    return parsed;
  }

  function makeTrait(name, dieSize) {
    const hasDie = dieSize !== null && dieSize !== undefined;
    return Object.freeze({
      name: name,
      slug: hasDie ? name + "-d" + dieSize : name,
      label: hasDie ? name + " d" + dieSize : name,
      dieSize: hasDie ? dieSize : null,
    });
  }

  function makeParameterizedTrait(name, value) {
    const hasValue = value !== null && value !== undefined;
    if (hasValue && (!Number.isInteger(value) || value <= 0)) {
      throw new RangeError(
        'Weapon trait "' + name + '" requires a positive integer value.',
      );
    }
    return Object.freeze({
      name: name,
      slug: hasValue ? name + "-" + value : name,
      label: hasValue ? name + " " + value : name,
      dieSize: null,
      value: hasValue ? value : null,
    });
  }

  /**
   * Bridge the legacy/inert trait shape (`{ name, slug, label, dieSize }`)
   * to the ranged profile shape, preserving an explicit `value` when present.
   *
   * @param {object} trait
   * @returns {number|null}
   */
  function traitValue(trait) {
    if (trait === null || typeof trait !== "object") {
      return null;
    }
    if (Number.isInteger(trait.value)) {
      return trait.value;
    }
    const slug = typeof trait.slug === "string" ? trait.slug : "";
    const match = /^([a-z]+)-(\d+)$/.exec(slug);
    return match ? Number.parseInt(match[2], 10) : null;
  }

  /**
   * Normalize one authored trait.
   *
   * @param {string|object} input
   * @returns {{name:string,slug:string,label:string,dieSize:number|null}}
   */
  function normalizeTrait(input) {
    if (input === null || input === undefined) {
      throw new TypeError("Weapon trait must be a string or an object.");
    }

    if (typeof input === "object") {
      if (Array.isArray(input)) {
        throw new TypeError("A single weapon trait cannot be an array.");
      }
      const rawName = input.name || input.trait || input.slug || input.id;
      if (rawName === undefined) {
        throw new TypeError("Weapon trait object requires a name.");
      }
      const rawText = normalizeText(rawName);
      const parameterized = /^(ranged|thrown|volley|reload)(?: (\d+))?$/.exec(
        rawText,
      );
      if (parameterized) {
        const authored =
          input.value !== undefined
            ? input.value
            : input.range !== undefined
              ? input.range
              : input.feet !== undefined
                ? input.feet
                : input.increment !== undefined
                  ? input.increment
                  : input.actions !== undefined
                    ? input.actions
                    : parameterized[2];
        const fallback =
          authored === undefined &&
          parameterized[1] === TRAIT_NAMES.RELOAD
            ? 1
            : undefined;
        return makeParameterizedTrait(
          parameterized[1],
          parseTraitAmount(authored === undefined ? fallback : authored),
        );
      }
      const die = input.dieSize !== undefined ? input.dieSize : input.die;
      if (die !== undefined && die !== null) {
        const text = normalizeText(rawName);
        if (text === TRAIT_NAMES.DEADLY || text === TRAIT_NAMES.FATAL) {
          return makeTrait(text, parseDieSize(die));
        }
      }
      // Fall back to parsing the name, which may itself carry "-d8".
      return normalizeTrait(String(rawName));
    }

    if (typeof input !== "string" || input.trim() === "") {
      throw new TypeError("Weapon trait must be a non-empty string.");
    }

    const text = normalizeText(input);
    if (text === TRAIT_NAMES.REACH) {
      return makeTrait(TRAIT_NAMES.REACH, null);
    }
    if (text === TRAIT_NAMES.BACKSTABBER) {
      return makeTrait(TRAIT_NAMES.BACKSTABBER, null);
    }

    const deadly = /^deadly(?: d(\d+))?$/.exec(text);
    if (deadly) {
      return makeTrait(
        TRAIT_NAMES.DEADLY,
        deadly[1] === undefined ? null : Number.parseInt(deadly[1], 10),
      );
    }

    const fatal = /^fatal(?: d(\d+))?$/.exec(text);
    if (fatal) {
      return makeTrait(
        TRAIT_NAMES.FATAL,
        fatal[1] === undefined ? null : Number.parseInt(fatal[1], 10),
      );
    }

    const parameterized = /^(ranged|thrown|volley|reload)(?: (\d+))?$/.exec(
      text,
    );
    if (parameterized) {
      const amount =
        parameterized[2] !== undefined
          ? Number.parseInt(parameterized[2], 10)
          : parameterized[1] === TRAIT_NAMES.RELOAD
            ? 1
            : null;
      return makeParameterizedTrait(parameterized[1], amount);
    }

    // Unknown traits are kept as inert labels. The engine never guesses at a
    // rule it does not implement.
    return Object.freeze({
      name: text.replace(/\s+/g, "-"),
      slug: text.replace(/\s+/g, "-"),
      label: text,
      dieSize: null,
    });
  }

  /**
   * @param {string|object|Array} input
   * @returns {Array<{name:string,slug:string,label:string,dieSize:number|null}>}
   */
  function normalizeTraits(input) {
    if (input === undefined || input === null) {
      return [];
    }
    if (Array.isArray(input)) {
      return input.map(normalizeTrait);
    }
    if (typeof input === "object") {
      if (input.traits !== undefined) {
        return normalizeTraits(input.traits);
      }

      // Structured map authoring: { reach: true, deadly: "d8", fatal: 10 }.
      const mapKeys = KNOWN_TRAITS.filter(function (name) {
        return input[name] !== undefined && input[name] !== false && input[name] !== null;
      });
      if (mapKeys.length > 0) {
        const authored = [];
        for (const name of mapKeys) {
          const value = input[name];
          if (name === TRAIT_NAMES.DEADLY || name === TRAIT_NAMES.FATAL) {
            if (value === true) {
              authored.push(name);
            } else if (typeof value === "number") {
              authored.push({ name: name, dieSize: value });
            } else if (typeof value === "string") {
              authored.push({ name: name, die: value });
            }
          } else if (value === true || value === "true") {
            authored.push(name);
          }
        }
        if (authored.length > 0) {
          return normalizeTraits(authored);
        }
      }

      return [normalizeTrait(input)];
    }
    return [normalizeTrait(input)];
  }

  function traitDefinitions(input) {
    return normalizeTraits(input);
  }

  /**
   * Whether the trait list contains a trait by canonical name or full slug.
   * `hasTrait(traits, "deadly")` and `hasTrait(traits, "deadly-d8")` both work.
   *
   * @param {string|object|Array} input
   * @param {string} name
   * @returns {boolean}
   */
  function hasTrait(input, name) {
    if (typeof name !== "string" || name.trim() === "") {
      return false;
    }
    const target = normalizeText(name);
    return normalizeTraits(input).some(function (trait) {
      return trait.name === target || trait.slug === target.replace(/\s+/g, "-");
    });
  }

  /**
   * @param {string|object|Array} input
   * @param {string} name
   * @returns {object|null}
   */
  function getTrait(input, name) {
    if (typeof name !== "string" || name.trim() === "") {
      return null;
    }
    const target = normalizeText(name);
    const found = normalizeTraits(input).find(function (trait) {
      return trait.name === target || trait.slug === target.replace(/\s+/g, "-");
    });
    return found === undefined ? null : found;
  }

  /**
   * Human-readable trait list, e.g. ["reach", "deadly d8"].
   *
   * @param {string|object|Array} input
   * @returns {string[]}
   */
  function traitLabels(input) {
    return normalizeTraits(input).map(function (trait) {
      return trait.label;
    });
  }

  /**
   * Frozen canonical trait slugs, e.g. ["reach", "deadly-d8"].
   *
   * @param {string|object|Array} input
   * @returns {string[]}
   */
  function traitSlugs(input) {
    return normalizeTraits(input).map(function (trait) {
      return trait.slug;
    });
  }

  // ----------------------------------------------------------------- ranged

  function readTraitDefinitions(source) {
    if (Array.isArray(source)) {
      return normalizeTraits(source);
    }
    if (
      source !== null &&
      typeof source === "object" &&
      source.traits !== undefined
    ) {
      return normalizeTraits(source.traits);
    }
    return [];
  }

  function parseFeet(value, label) {
    if (typeof value === "number") {
      if (!Number.isInteger(value) || value <= 0) {
        throw new RangeError(label + " must be a positive integer number of feet.");
      }
      return value;
    }
    if (value !== null && typeof value === "object") {
      if (value.increment !== undefined) {
        return parseFeet(value.increment, label);
      }
      if (value.feet !== undefined) {
        return parseFeet(value.feet, label);
      }
      throw new TypeError(label + " must be a number of feet or a range object.");
    }
    const text = String(value).trim();
    const match = /(\d+)/.exec(text);
    if (!match) {
      throw new RangeError(
        label + ' must contain a positive number of feet; received "' + text + '".',
      );
    }
    const parsed = Number.parseInt(match[1], 10);
    if (parsed <= 0) {
      throw new RangeError(label + " must be a positive number of feet.");
    }
    return parsed;
  }

  function traitNumericValue(traits, name) {
    for (const trait of traits) {
      if (trait.name !== name) {
        continue;
      }
      const value = traitValue(trait);
      if (value !== null) {
        return value;
      }
    }
    return null;
  }

  /**
   * Range increment in feet. Explicit `rangeIncrement` wins over `range`,
   * which wins over the `ranged-N` / `thrown-N` traits. Melee weapons return
   * null.
   *
   * @param {object|string[]} source weapon object or trait list
   * @returns {number|null}
   */
  function getRangeIncrement(source) {
    if (
      source !== null &&
      typeof source === "object" &&
      !Array.isArray(source)
    ) {
      if (source.rangeIncrement !== undefined && source.rangeIncrement !== null) {
        return parseFeet(source.rangeIncrement, "rangeIncrement");
      }
      if (source.range !== undefined && source.range !== null) {
        return parseFeet(source.range, "range");
      }
    }

    const traits = readTraitDefinitions(source);
    const ranged = traitNumericValue(traits, TRAIT_NAMES.RANGED);
    if (ranged !== null) {
      return ranged;
    }
    return traitNumericValue(traits, TRAIT_NAMES.THROWN);
  }

  /**
   * Reload cost in actions. A plain weapon is reload 0; bows and thrown
   * weapons are explicitly authored as 0, crossbows as 1 or 2.
   *
   * @param {object|string[]} source
   * @returns {number}
   */
  function getReload(source) {
    if (
      source !== null &&
      typeof source === "object" &&
      !Array.isArray(source) &&
      source.reload !== undefined
    ) {
      if (source.reload === true) {
        return 1;
      }
      if (source.reload === false) {
        return 0;
      }
      if (typeof source.reload === "number") {
        if (!Number.isInteger(source.reload) || source.reload < 0) {
          throw new RangeError("reload must be a non-negative integer.");
        }
        return source.reload;
      }
      const match = /(\d+)/.exec(String(source.reload));
      if (!match) {
        throw new RangeError("reload must be a non-negative integer.");
      }
      return Number.parseInt(match[1], 10);
    }

    const traits = readTraitDefinitions(source);
    const value = traitNumericValue(traits, TRAIT_NAMES.RELOAD);
    if (value !== null) {
      return value;
    }
    // A bare `reload` trait defaults to one action.
    return hasTrait(traits, TRAIT_NAMES.RELOAD) ? 1 : 0;
  }

  /**
   * Volley range in feet, or null when the weapon has no volley trait.
   *
   * @param {object|string[]} source
   * @returns {number|null}
   */
  function getVolley(source) {
    if (
      source !== null &&
      typeof source === "object" &&
      !Array.isArray(source) &&
      source.volley !== undefined &&
      source.volley !== null &&
      source.volley !== false
    ) {
      return parseFeet(source.volley, "volley");
    }

    const traits = readTraitDefinitions(source);
    return traitNumericValue(traits, TRAIT_NAMES.VOLLEY);
  }

  /**
   * Whether the weapon attacks at range. True when it has a range increment
   * or the ranged/thrown/volley trait.
   *
   * @param {object|string[]} source
   * @returns {boolean}
   */
  function isRanged(source) {
    if (getRangeIncrement(source) !== null) {
      return true;
    }
    const traits = readTraitDefinitions(source);
    return (
      hasTrait(traits, TRAIT_NAMES.RANGED) ||
      hasTrait(traits, TRAIT_NAMES.THROWN) ||
      hasTrait(traits, TRAIT_NAMES.VOLLEY)
    );
  }

  /**
   * Frozen normalized ranged-ready weapon profile used by Strike.
   *
   * @param {object|string[]} source
   * @returns {{
   *   formula: string|undefined,
   *   type: string|undefined,
   *   traits: object[],
   *   traitSlugs: string[],
   *   rangeIncrement: number|null,
   *   reload: number,
   *   volley: number|null,
   *   isRanged: boolean
   * }}
   */
  function getWeaponProfile(source) {
    const weapon =
      source !== null && typeof source === "object" && !Array.isArray(source)
        ? source
        : {};
    const traits = readTraitDefinitions(source);

    return Object.freeze({
      formula:
        weapon.formula !== undefined
          ? weapon.formula
          : weapon.damage !== undefined
            ? weapon.damage
            : undefined,
      type:
        weapon.type !== undefined
          ? weapon.type
          : weapon.damageType !== undefined
            ? weapon.damageType
            : undefined,
      traits: Object.freeze(traits.slice()),
      traitSlugs: Object.freeze(
        traits.map(function (trait) {
          return trait.slug;
        }),
      ),
      rangeIncrement: getRangeIncrement(source),
      reload: getReload(source),
      volley: getVolley(source),
      isRanged: isRanged(source),
    });
  }

  /**
   * PF2e Remastered range increment penalty.
   *
   * The first increment has no penalty; every additional (full or partial)
   * increment imposes -2. Attacks beyond the sixth increment are impossible.
   *
   * @param {number} distanceFeet
   * @param {number} rangeIncrement positive feet
   * @returns {{
   *   ok: boolean,
   *   reason?: string,
   *   penalty: number|null,
   *   incrementIndex: number,
   *   maxRangeFeet: number
   * }}
   */
  function rangeIncrementPenalty(distanceFeet, rangeIncrement) {
    if (!Number.isInteger(distanceFeet) || distanceFeet < 0) {
      throw new RangeError("distanceFeet must be a non-negative integer.");
    }
    if (!Number.isInteger(rangeIncrement) || rangeIncrement <= 0) {
      throw new RangeError("rangeIncrement must be a positive integer.");
    }

    const maxRangeFeet = rangeIncrement * MAX_RANGE_INCREMENTS;
    const incrementIndex = Math.max(
      0,
      Math.ceil(distanceFeet / rangeIncrement) - 1,
    );

    if (incrementIndex >= MAX_RANGE_INCREMENTS) {
      return {
        ok: false,
        reason: "out-of-range",
        penalty: null,
        incrementIndex: incrementIndex,
        maxRangeFeet: maxRangeFeet,
      };
    }

    return {
      ok: true,
      penalty:
        incrementIndex === 0
          ? 0
          : -RANGE_PENALTY_PER_INCREMENT * incrementIndex,
      incrementIndex: incrementIndex,
      maxRangeFeet: maxRangeFeet,
    };
  }

  /**
   * Volley penalty: -2 when the target is at or inside the listed volley
   * range. No penalty outside it.
   *
   * @param {number} distanceFeet
   * @param {number|null} volleyFeet
   * @returns {number}
   */
  function volleyPenalty(distanceFeet, volleyFeet) {
    if (!Number.isInteger(distanceFeet) || distanceFeet < 0) {
      throw new RangeError("distanceFeet must be a non-negative integer.");
    }
    if (volleyFeet === null || volleyFeet === undefined) {
      return 0;
    }
    if (!Number.isInteger(volleyFeet) || volleyFeet <= 0) {
      throw new RangeError("volleyFeet must be a positive integer.");
    }
    return distanceFeet <= volleyFeet ? -VOLLEY_PENALTY : 0;
  }

  /**
   * Melee reach in feet for a combatant or a trait list.
   *
   * The `reach` trait extends the default 5-ft melee reach to 10 ft. An
   * explicit `baseReachFeet` may be supplied for future creature sizes.
   *
   * @param {object|Array|string} source combatant, trait list, or single trait
   * @param {number} [baseReachFeet]
   * @returns {number}
   */
  function getReachFeet(source, baseReachFeet) {
    const base =
      baseReachFeet === undefined ? DEFAULT_REACH_FEET : baseReachFeet;
    if (!Number.isInteger(base) || base <= 0 || base % 5 !== 0) {
      throw new RangeError("baseReachFeet must be a positive multiple of 5.");
    }

    const traits =
      source !== null &&
      typeof source === "object" &&
      !Array.isArray(source) &&
      source.traits !== undefined
        ? source.traits
        : source;

    if (hasTrait(traits, TRAIT_NAMES.REACH)) {
      return Math.max(base, REACH_WITH_TRAIT_FEET);
    }
    return base;
  }

  function buildFormula(diceCount, dieSize, modifier) {
    if (diceCount <= 0) {
      return String(modifier);
    }
    let formula = diceCount + "d" + dieSize;
    if (modifier > 0) {
      formula += "+" + modifier;
    } else if (modifier < 0) {
      formula += "-" + Math.abs(modifier);
    }
    return formula;
  }

  function resolveRollDie(options) {
    if (typeof options.rollDamageDie === "function") {
      return options.rollDamageDie;
    }
    if (typeof options.rollDie === "function") {
      return options.rollDie;
    }
    return Damage.defaultRollDie;
  }

  function rollExtraDie(dieSize, rollDie) {
    const value = rollDie(dieSize);
    if (!Number.isInteger(value) || value < 1 || value > dieSize) {
      throw new RangeError(
        "rollDie(" + dieSize + ") must return an integer from 1 to " + dieSize + ".",
      );
    }
    return value;
  }

  /**
   * Calculate weapon damage for a hit or critical hit.
   *
   * @param {{
   *   weapon: {formula:string,type?:string,traits?:Array},
   *   degree: string,
   *   isOffGuard?: boolean,
   *   rollDie?: (sides:number)=>number,
   *   rollDamageDie?: (sides:number)=>number
   * }} options
   * @returns {object|null} null on a failure or critical failure
   */
  function calculateWeaponDamage(options) {
    const opts = options || {};
    if (opts.weapon === null || opts.weapon === undefined) {
      throw new TypeError("calculateWeaponDamage requires a weapon object.");
    }
    const weaponInput =
      typeof opts.weapon === "string"
        ? { formula: opts.weapon, type: opts.type, traits: opts.traits }
        : opts.weapon;

    const degree = opts.degree;
    const isCritical = degree === Checks.DEGREES.CRITICAL_SUCCESS;
    const isHit =
      isCritical || degree === Checks.DEGREES.SUCCESS;
    if (!isHit) {
      return null;
    }

    const spec = Damage.parseDamageSpec(weaponInput);
    const traits = normalizeTraits(
      weaponInput.traits === undefined ? opts.traits : weaponInput.traits,
    );
    const parsed = Damage.parseDamageFormula(spec.formula);
    const rollDie = resolveRollDie(opts);

    const fatalTrait = traits.find(function (trait) {
      return trait.name === TRAIT_NAMES.FATAL && trait.dieSize !== null;
    });
    const deadlyTrait = traits.find(function (trait) {
      return trait.name === TRAIT_NAMES.DEADLY && trait.dieSize !== null;
    });

    // Fatal replaces the base die on a critical success before the critical
    // multiplier. It never applies to a normal hit.
    const effectiveDieSize =
      isCritical && fatalTrait ? fatalTrait.dieSize : parsed.dieSize;
    const effectiveFormula =
      parsed.diceCount > 0
        ? buildFormula(parsed.diceCount, effectiveDieSize, parsed.modifier)
        : spec.formula;

    const rolled = Damage.rollDamage({
      formula: effectiveFormula,
      type: spec.type,
      rollDie: rollDie,
    });

    // Backstabber is +1 precision damage against an Off-Guard target. On a
    // critical success it is part of the doubled base damage, i.e. +2 before
    // the x2 multiplier. The damage type follows the weapon.
    const backstabberBonus =
      hasTrait(traits, TRAIT_NAMES.BACKSTABBER) && opts.isOffGuard === true
        ? 1
        : 0;
    const multiplier = isCritical ? 2 : 1;
    const baseWithBackstabber = rolled.total + backstabberBonus;
    const doubledBase = Math.max(0, baseWithBackstabber * multiplier);

    const extras = [];
    let fatalInfo = null;
    if (isCritical && fatalTrait) {
      const roll = rollExtraDie(fatalTrait.dieSize, rollDie);
      const extra = {
        kind: TRAIT_NAMES.FATAL,
        trait: fatalTrait,
        dieSize: fatalTrait.dieSize,
        roll: roll,
        total: roll,
        doubled: false,
      };
      extras.push(extra);
      fatalInfo = {
        trait: fatalTrait,
        dieSize: fatalTrait.dieSize,
        originalDieSize: parsed.dieSize,
        replaced: true,
        formula: effectiveFormula,
        extraRoll: roll,
        extraTotal: roll,
      };
    }

    let deadlyInfo = null;
    if (isCritical && deadlyTrait) {
      const roll = rollExtraDie(deadlyTrait.dieSize, rollDie);
      const extra = {
        kind: TRAIT_NAMES.DEADLY,
        trait: deadlyTrait,
        dieSize: deadlyTrait.dieSize,
        roll: roll,
        total: roll,
        doubled: false,
      };
      extras.push(extra);
      deadlyInfo = {
        trait: deadlyTrait,
        dieSize: deadlyTrait.dieSize,
        roll: roll,
        total: roll,
      };
    }

    const extrasTotal = extras.reduce(function (sum, extra) {
      return sum + extra.total;
    }, 0);

    return {
      formula: spec.formula,
      effectiveFormula: effectiveFormula,
      type: spec.type,
      traits: traits.map(function (trait) {
        return trait.label;
      }),
      traitSlugs: traits.map(function (trait) {
        return trait.slug;
      }),
      degree: degree,
      critical: isCritical,
      isOffGuard: opts.isOffGuard === true,
      diceCount: rolled.diceCount,
      dieSize: rolled.dieSize,
      modifier: rolled.modifier,
      rolls: rolled.rolls,
      diceTotal: rolled.diceTotal,
      baseTotal: rolled.total,
      backstabber: backstabberBonus,
      doubledBase: doubledBase,
      doubled: isCritical,
      multiplier: multiplier,
      fatal: fatalInfo,
      deadly: deadlyInfo,
      extras: extras,
      extrasTotal: extrasTotal,
      total: doubledBase + extrasTotal,
    };
  }

  return Object.freeze({
    TRAIT_NAMES: TRAIT_NAMES,
    KNOWN_TRAITS: KNOWN_TRAITS,
    PARAMETERIZED_TRAITS: PARAMETERIZED_TRAITS,
    REACH_WITH_TRAIT_FEET: REACH_WITH_TRAIT_FEET,
    DEFAULT_REACH_FEET: DEFAULT_REACH_FEET,
    RANGE_PENALTY_PER_INCREMENT: RANGE_PENALTY_PER_INCREMENT,
    MAX_RANGE_INCREMENTS: MAX_RANGE_INCREMENTS,
    VOLLEY_PENALTY: VOLLEY_PENALTY,
    normalizeTrait: normalizeTrait,
    normalizeTraits: normalizeTraits,
    traitDefinitions: traitDefinitions,
    hasTrait: hasTrait,
    getTrait: getTrait,
    traitLabels: traitLabels,
    traitSlugs: traitSlugs,
    getRangeIncrement: getRangeIncrement,
    getReload: getReload,
    getVolley: getVolley,
    isRanged: isRanged,
    getWeaponProfile: getWeaponProfile,
    rangeIncrementPenalty: rangeIncrementPenalty,
    volleyPenalty: volleyPenalty,
    getReachFeet: getReachFeet,
    calculateWeaponDamage: calculateWeaponDamage,
  });
});
