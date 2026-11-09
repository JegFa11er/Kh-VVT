/**
 * PF2E REMASTERED — CONDITION MANAGER (HEADLESS CORE)
 *
 * Owns the canonical condition records used by Combatant. The manager is
 * intentionally presentation-free: it exposes slugs, labels, values, and the
 * modifier objects each condition contributes to checks, DCs, and AC.
 *
 * Conditions implemented in this slice:
 *   - off-guard: -2 circumstance penalty to AC (not to attack checks).
 *   - prone: Off-Guard (-2 circumstance AC) and -2 circumstance penalty to
 *     attack rolls. The only movement actions available while prone are Stand
 *     and Crawl; Stand is implemented in Actions/stand.js.
 *   - frightened N: -N status penalty to all checks and DCs, including attack
 *     rolls and AC. The value decreases by 1 at the end of the frightened
 *     creature's turn and the condition is removed at 0.
 *   - shield-raised: +2 circumstance bonus to AC until the start of the
 *     raiser's next turn. Combatant.resetTurn() removes it unconditionally.
 *   - greater-cover: +4 circumstance bonus to AC from Take Cover until the
 *     start of the creature's next turn or its next Stride/Step.
 *   - concealed / hidden / undetected: visibility states. They contribute no
 *     AC modifiers; instead a Strike resolves a flat check before the attack
 *     roll. Hidden and Undetected attackers make their target Off-Guard.
 *   - grabbed / restrained: Off-Guard (-2 circumstance AC) plus Immobilized.
 *     Both carry the grappler's `sourceId` and the source turn on which they
 *     expire, so the Encounter can end them on the grappler's turn rather
 *     than the victim's.
 *   - immobilized: no modifiers of its own. Stride, Step, and Stand refuse to
 *     run while it is present. Grabbed and Restrained are treated as
 *     Immobilized even if the companion condition was authored separately.
 *   - unconscious: Off-Guard, Prone, and a -4 status penalty to AC, Reflex
 *     saves, and Reflex DC. Combatant.canAct() refuses every action.
 *   - dying N / wounded N: valued death-and-recovery states. Dying is capped
 *     at 4, where the combatant is defeated.
 *   - paralyzed: Off-Guard and no actions at all. Combatant.canAct() refuses
 *     every action with reason "paralyzed".
 *   - stunned N / slowed N: action-pool reductions resolved at the start of
 *     the creature's turn. Stunned refuses canAct() while the value is above
 *     zero and is paid down by the actions it removes; slowed merely reduces
 *     the action pool without blocking the turn. When both are present the
 *     larger value is applied once, so Stunned overrides Slowed for the
 *     action loss.
 *
 * Duration metadata:
 *   - `duration` (rounds), `durationOrigin` ("start" | "end"), and the
 *     `appliedRound` stamp are stored on the condition record. Combatant
 *     ticks them at the matching turn phase against Encounter.round.
 *
 * Unknown condition slugs are stored for forward compatibility but contribute
 * no modifiers until a definition is added here.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../Rules/modifiers.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Conditions = factory(root.PF2e.Core.Rules.Modifiers);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Modifiers) {
  "use strict";

  const MODIFIER_TYPES = Modifiers.MODIFIER_TYPES;

  const CONDITION_SLUGS = Object.freeze({
    OFF_GUARD: "off-guard",
    PRONE: "prone",
    FRIGHTENED: "frightened",
    SHIELD_RAISED: "shield-raised",
    GREATER_COVER: "greater-cover",
    CONCEALED: "concealed",
    HIDDEN: "hidden",
    UNDETECTED: "undetected",
    IMMOBILIZED: "immobilized",
    GRABBED: "grabbed",
    RESTRAINED: "restrained",
    UNCONSCIOUS: "unconscious",
    DYING: "dying",
    WOUNDED: "wounded",
    PARALYZED: "paralyzed",
    STUNNED: "stunned",
    SLOWED: "slowed",
  });

  /** Conditions that prevent every action through Combatant.canAct(). */
  const INCAPACITATING_CONDITIONS = Object.freeze([
    "unconscious",
    "paralyzed",
    "stunned",
  ]);

  /** Legal values for the round-duration phase metadata. */
  const DURATION_ORIGINS = Object.freeze(["start", "end"]);

  /** Conditions that a Grapple action can apply. */
  const GRAPPLE_CONDITIONS = Object.freeze(["grabbed", "restrained"]);

  /**
   * Action trait slugs that the Grabbed/Restrained conditions care about.
   * Restrained blocks both; Grabbed only gates manipulate actions.
   */
  const ACTION_TRAITS = Object.freeze({
    ATTACK: "attack",
    MANIPULATE: "manipulate",
  });

  /**
   * Conditions that prevent Stride, Step, and Stand. Grabbed and Restrained
   * both include Immobilized, but they are listed here as a defensive fallback
   * for authored or migrated saves that only carry the parent condition.
   */
  const MOVEMENT_BLOCKING_CONDITIONS = Object.freeze([
    "immobilized",
    "grabbed",
    "restrained",
  ]);

  /**
   * Visibility states and the flat check they impose on an attack that targets
   * the creature. `undetected` cannot be targeted directly at all.
   */
  const VISIBILITY_CONDITIONS = Object.freeze({
    concealed: Object.freeze({
      slug: "concealed",
      label: "Concealed",
      flatCheckDC: 5,
      targetable: true,
    }),
    hidden: Object.freeze({
      slug: "hidden",
      label: "Hidden",
      flatCheckDC: 11,
      targetable: true,
    }),
    undetected: Object.freeze({
      slug: "undetected",
      label: "Undetected",
      flatCheckDC: null,
      targetable: false,
    }),
  });

  /** Hidden is stricter than concealed when a creature has both. */
  const VISIBILITY_PRIORITY = Object.freeze(["undetected", "hidden", "concealed"]);

  const DEFINITIONS = Object.freeze({
    "off-guard": Object.freeze({
      slug: "off-guard",
      label: "Off-Guard",
      valued: false,
      description: "-2 circumstance penalty to AC.",
    }),
    prone: Object.freeze({
      slug: "prone",
      label: "Prone",
      valued: false,
      description:
        "Off-Guard (-2 circumstance AC) and a -2 circumstance penalty to attack rolls. Stand or Crawl to move.",
    }),
    frightened: Object.freeze({
      slug: "frightened",
      label: "Frightened",
      valued: true,
      description:
        "Status penalty equal to the value to all checks and DCs; decreases by 1 at the end of each turn.",
    }),
    "shield-raised": Object.freeze({
      slug: "shield-raised",
      label: "Shield Raised",
      valued: false,
      description:
        "+2 circumstance bonus to AC until the start of the raiser's next turn.",
    }),
    "greater-cover": Object.freeze({
      slug: "greater-cover",
      label: "Greater Cover",
      valued: false,
      description:
        "+4 circumstance bonus to AC from Take Cover until the start of the creature's next turn or its next movement.",
    }),
    concealed: Object.freeze({
      slug: "concealed",
      label: "Concealed",
      valued: false,
      description:
        "Attacks against this creature require a DC 5 flat check; a failure misses. The creature's AC is unchanged.",
    }),
    hidden: Object.freeze({
      slug: "hidden",
      label: "Hidden",
      valued: false,
      description:
        "Attacks against this creature require a DC 11 flat check; a failure misses. The creature's AC is unchanged, but its own attacks leave the target Off-Guard.",
    }),
    undetected: Object.freeze({
      slug: "undetected",
      label: "Undetected",
      valued: false,
      description:
        "Enemies do not know the exact position. The creature cannot be selected as a direct target; its own attacks leave the target Off-Guard.",
    }),
    immobilized: Object.freeze({
      slug: "immobilized",
      label: "Immobilized",
      valued: false,
      description:
        "Speed is 0. The creature cannot use move actions such as Stride, Step, or Stand.",
    }),
    grabbed: Object.freeze({
      slug: "grabbed",
      label: "Grabbed",
      valued: false,
      description:
        "Off-Guard (-2 circumstance AC) and Immobilized. Ends at the end of the grappler's next turn, or when the grappler moves or is defeated.",
    }),
    restrained: Object.freeze({
      slug: "restrained",
      label: "Restrained",
      valued: false,
      description:
        "Off-Guard (-2 circumstance AC) and Immobilized. In this tactical prototype Restrained uses the same movement and AC effects as Grabbed.",
    }),
    unconscious: Object.freeze({
      slug: "unconscious",
      label: "Unconscious",
      valued: false,
      description:
        "Off-Guard (-2 circumstance AC), Prone (-2 circumstance attack), and a -4 status penalty to AC, Reflex saves, and Reflex DC. The creature cannot act.",
    }),
    dying: Object.freeze({
      slug: "dying",
      label: "Dying",
      valued: true,
      description:
        "The creature is at 0 HP and makes a recovery flat check at the start of each turn against DC 10 + Dying. Dying 4 means death.",
    }),
    wounded: Object.freeze({
      slug: "wounded",
      label: "Wounded",
      valued: true,
      description:
        "Adds its value to the initial Dying value whenever the creature is reduced to 0 HP.",
    }),
    paralyzed: Object.freeze({
      slug: "paralyzed",
      label: "Paralyzed",
      valued: false,
      description:
        "Off-Guard (-2 circumstance AC). The creature cannot act at all; only purely mental actions are possible and are not modelled here.",
    }),
    stunned: Object.freeze({
      slug: "stunned",
      label: "Stunned",
      valued: true,
      description:
        "The creature cannot act while stunned. At the start of its turn it loses a number of actions equal to the value; the value is reduced by the actions actually lost, so any debt carries to the next turn. When Slowed is also present only the larger value removes actions.",
    }),
    slowed: Object.freeze({
      slug: "slowed",
      label: "Slowed",
      valued: true,
      description:
        "At the start of its turn the creature regains that many fewer actions. Slowed does not block the remaining actions and does not stack with Stunned for the same action loss.",
    }),
  });

  function assertNonEmptyString(value, label) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(label + " must be a non-empty string.");
    }
  }

  function normalizeSlug(name) {
    assertNonEmptyString(name, "condition name");
    return name.trim().toLowerCase();
  }

  function prettifySlug(slug) {
    return slug
      .split("-")
      .map(function (part) {
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(" ");
  }

  function isKnownCondition(name) {
    return Object.prototype.hasOwnProperty.call(DEFINITIONS, normalizeSlug(name));
  }

  /**
   * Build a normalized condition record. Frightened 0 removes the condition,
   * so this helper returns null for it.
   *
   * `options` carries source-linked metadata used by Grapple and timed
   * conditions:
   *   - `sourceId`: the combatant that applied the condition;
   *   - `expiresOnSourceTurn`: the source combatant's turn number at whose
   *     end the condition expires. The Grapple action sets this to
   *     `source.turnNumber + 1`, implementing "until the end of your next
   *     turn" without expiring on the turn it was applied.
   *   - `duration`: round duration (positive integer).
   *   - `durationOrigin`: "start" (default) or "end"; the turn phase at which
   *     the duration is checked and counted.
   *   - `round`: encounter round in which the condition was applied. The
   *     Combatant stamps its current `encounterRound` when this is omitted.
   *
   * @param {string} name
   * @param {number} [value] required for valued conditions, ignored otherwise
   * @param {{sourceId?:string,expiresOnSourceTurn?:number,duration?:number,durationOrigin?:string,round?:number}} [options]
   * @returns {{name:string,slug:string,label:string,value:number|null,sourceId:string|null,expiresOnSourceTurn:number|null,duration:number|null,durationOrigin:string|null,appliedRound:number|null}|null}
   */
  function createCondition(name, value, options) {
    const slug = normalizeSlug(name);
    const definition = DEFINITIONS[slug] || null;
    const isValued = definition
      ? definition.valued
      : value !== undefined && value !== null;
    const opts = options || {};
    const sourceId =
      typeof opts.sourceId === "string" && opts.sourceId.trim() !== ""
        ? opts.sourceId
        : null;
    const expiresOnSourceTurn = Number.isInteger(opts.expiresOnSourceTurn)
      ? opts.expiresOnSourceTurn
      : null;

    let duration = null;
    if (opts.duration !== undefined && opts.duration !== null) {
      if (!Number.isInteger(opts.duration) || opts.duration <= 0) {
        throw new RangeError(
          "condition " + slug + " duration must be a positive integer.",
        );
      }
      duration = opts.duration;
    }

    let durationOrigin = null;
    if (duration !== null) {
      durationOrigin =
        opts.durationOrigin === undefined ? "start" : opts.durationOrigin;
      if (DURATION_ORIGINS.indexOf(durationOrigin) === -1) {
        throw new RangeError(
          'durationOrigin must be "start" or "end"; received ' +
            String(durationOrigin) +
            ".",
        );
      }
    }

    const appliedRound =
      duration !== null && Number.isInteger(opts.round) ? opts.round : null;

    if (isValued) {
      const actualValue = value === undefined ? 1 : value;
      if (!Number.isInteger(actualValue) || actualValue < 0) {
        throw new RangeError(
          "condition " + slug + " value must be a non-negative integer; received " +
            String(actualValue) +
            ".",
        );
      }
      if (actualValue === 0) {
        return null;
      }
      return {
        name: slug,
        slug: slug,
        label: (definition ? definition.label : prettifySlug(slug)) + " " + actualValue,
        value: actualValue,
        sourceId: sourceId,
        expiresOnSourceTurn: expiresOnSourceTurn,
        duration: duration,
        durationOrigin: durationOrigin,
        appliedRound: appliedRound,
      };
    }

    if (value !== undefined && value !== null) {
      if (!Number.isInteger(value) || value < 0) {
        throw new RangeError(
          "condition " + slug + " value must be a non-negative integer.",
        );
      }
    }

    return {
      name: slug,
      slug: slug,
      label: definition ? definition.label : prettifySlug(slug),
      value: null,
      sourceId: sourceId,
      expiresOnSourceTurn: expiresOnSourceTurn,
      duration: duration,
      durationOrigin: durationOrigin,
      appliedRound: appliedRound,
    };
  }

  /**
   * Copy a condition so callers cannot mutate the Combatant's internal store.
   */
  function copyCondition(condition) {
    return {
      name: condition.name,
      slug: condition.slug,
      label: condition.label,
      value: condition.value,
      sourceId: condition.sourceId === undefined ? null : condition.sourceId,
      expiresOnSourceTurn:
        condition.expiresOnSourceTurn === undefined
          ? null
          : condition.expiresOnSourceTurn,
      duration: condition.duration === undefined ? null : condition.duration,
      durationOrigin:
        condition.durationOrigin === undefined
          ? null
          : condition.durationOrigin,
      appliedRound:
        condition.appliedRound === undefined ? null : condition.appliedRound,
    };
  }

  /**
   * Normalize a scope argument into a tag set. A scope may be one string or an
   * array of strings. Named scopes expand to their family tag:
   * `"skill:athletics"` also counts as `"skill"`, `"save:reflex"` as `"save"`,
   * and `"dc:reflex"` as `"dc"`.
   *
   * @param {string|string[]|undefined} scope
   * @returns {Set<string>}
   */
  function scopeTags(scope) {
    const tags = new Set();
    if (scope === undefined || scope === null || scope === "all") {
      tags.add("all");
      return tags;
    }

    const list = Array.isArray(scope) ? scope : [scope];
    for (const entry of list) {
      if (typeof entry !== "string" || entry.trim() === "") {
        continue;
      }
      const value = entry.trim().toLowerCase();
      if (value === "all") {
        tags.clear();
        tags.add("all");
        return tags;
      }
      tags.add(value);
      if (value.indexOf("skill:") === 0) {
        tags.add("skill");
      } else if (value.indexOf("save:") === 0) {
        tags.add("save");
      } else if (value.indexOf("dc:") === 0) {
        tags.add("dc");
      }
    }
    return tags;
  }

  /**
   * Modifiers contributed by one condition.
   *
   * Scope values:
   *   - "attack": attack rolls (checks); off-guard does not apply
   *   - "ac": AC (a DC); off-guard and frightened apply
   *   - "check": generic non-AC checks; frightened applies
   *   - "skill:<name>": skill checks; frightened applies (prone applies only
   *     when the caller also requests the attack scope)
   *   - "save:<name>": saving throws; frightened applies
   *   - "dc:<name>": DCs such as Reflex DC; frightened applies
   *   - "all" / undefined: every modifier the condition can contribute
   *
   * Arrays of scopes are supported, so a caller can request
   * `["skill:athletics", "attack"]` for an Athletics check with the attack
   * trait without double-counting Frightened.
   *
   * @param {object} condition
   * @param {string|string[]} [scope]
   * @returns {{name:string,type:string,value:number,source:string}[]}
   */
  function conditionModifiers(condition, scope) {
    const modifiers = [];
    const tags = scopeTags(scope);
    const all = tags.has("all");
    const appliesToAc =
      all || tags.has("ac") || tags.has("dc:ac");
    const appliesToAttack = all || tags.has("attack");

    if (condition.name === CONDITION_SLUGS.OFF_GUARD && appliesToAc) {
      modifiers.push({
        name: "Off-Guard",
        type: MODIFIER_TYPES.CIRCUMSTANCE,
        value: -2,
        source: "off-guard",
      });
    }

    // Prone grants Off-Guard, so its AC contribution uses the same
    // circumstance/source identity as the condition. That lets the resolver
    // suppress a duplicate when Off-Guard is also present.
    if (condition.name === CONDITION_SLUGS.PRONE) {
      if (appliesToAc) {
        modifiers.push({
          name: "Off-Guard (Prone)",
          type: MODIFIER_TYPES.CIRCUMSTANCE,
          value: -2,
          source: "off-guard",
        });
      }
      if (appliesToAttack) {
        modifiers.push({
          name: "Prone",
          type: MODIFIER_TYPES.CIRCUMSTANCE,
          value: -2,
          source: "prone",
        });
      }
    }

    // A raised shield is an AC-only circumstance bonus. The resolver keeps
    // this bonus separate from any circumstance penalty (for example
    // Off-Guard), so both contribute to the final AC.
    if (condition.name === CONDITION_SLUGS.SHIELD_RAISED && appliesToAc) {
      modifiers.push({
        name: "Shield Raised",
        type: MODIFIER_TYPES.CIRCUMSTANCE,
        value: 2,
        source: "shield-raised",
      });
    }

    // Take Cover upgrades the defender to greater cover. It is a circumstance
    // bonus, so the resolver compares it with Shield Raised and any geometric
    // cover modifier and keeps only the highest.
    if (condition.name === CONDITION_SLUGS.GREATER_COVER && appliesToAc) {
      modifiers.push({
        name: "Greater Cover",
        type: MODIFIER_TYPES.CIRCUMSTANCE,
        value: 4,
        source: "greater-cover",
      });
    }

    // Grabbed and Restrained both impose Off-Guard. Their AC contribution
    // uses the same circumstance/source identity as the Off-Guard condition so
    // the resolver suppresses a duplicate when more than one Off-Guard source
    // is present. Unlike Prone they do not penalize the creature's own attack
    // rolls; their action restriction is Immobilized instead.
    if (
      (condition.name === CONDITION_SLUGS.GRABBED ||
        condition.name === CONDITION_SLUGS.RESTRAINED) &&
      appliesToAc
    ) {
      modifiers.push({
        name:
          condition.name === CONDITION_SLUGS.GRABBED
            ? "Off-Guard (Grabbed)"
            : "Off-Guard (Restrained)",
        type: MODIFIER_TYPES.CIRCUMSTANCE,
        value: -2,
        source: "off-guard",
      });
    }

    // Paralyzed embeds Off-Guard. It contributes no attack penalty of its
    // own; the action lock is enforced by Combatant.canAct().
    if (condition.name === CONDITION_SLUGS.PARALYZED && appliesToAc) {
      modifiers.push({
        name: "Off-Guard (Paralyzed)",
        type: MODIFIER_TYPES.CIRCUMSTANCE,
        value: -2,
        source: "off-guard",
      });
    }

    // Unconscious embeds the Off-Guard and Prone penalties and adds its own
    // -4 status penalty to AC, Reflex saves, and Reflex DC. The Off-Guard and
    // Prone contributions reuse the canonical sources so the resolver
    // suppresses duplicates when those conditions are also present.
    if (condition.name === CONDITION_SLUGS.UNCONSCIOUS) {
      const penalizesReflex =
        all || tags.has("save:reflex") || tags.has("dc:reflex");

      if (appliesToAc) {
        modifiers.push({
          name: "Off-Guard (Unconscious)",
          type: MODIFIER_TYPES.CIRCUMSTANCE,
          value: -2,
          source: "off-guard",
        });
      }
      if (appliesToAttack) {
        modifiers.push({
          name: "Prone (Unconscious)",
          type: MODIFIER_TYPES.CIRCUMSTANCE,
          value: -2,
          source: "prone",
        });
      }
      if (appliesToAc || penalizesReflex) {
        modifiers.push({
          name: "Unconscious",
          type: MODIFIER_TYPES.STATUS,
          value: -4,
          source: "unconscious",
        });
      }
    }

    // Frightened applies to every check and DC, which includes attack rolls,
    // AC, skills, saving throws, and Reflex/Fortitude/Will DCs in this engine.
    // It is therefore valid in every scope and must contribute exactly once.
    if (condition.name === CONDITION_SLUGS.FRIGHTENED && condition.value > 0) {
      modifiers.push({
        name: "Frightened " + condition.value,
        type: MODIFIER_TYPES.STATUS,
        value: -condition.value,
        source: "frightened",
      });
    }

    return modifiers;
  }

  function hasCondition(combatant, name) {
    return (
      combatant !== null &&
      typeof combatant === "object" &&
      typeof combatant.hasCondition === "function" &&
      combatant.hasCondition(name)
    );
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  function isVisibilityCondition(name) {
    if (typeof name !== "string") {
      return false;
    }
    return Object.prototype.hasOwnProperty.call(
      VISIBILITY_CONDITIONS,
      normalizeSlug(name),
    );
  }

  /**
   * Flat check required to target a creature with this visibility condition,
   * or null when the condition does not allow direct targeting.
   *
   * @param {string} name
   * @returns {number|null}
   */
  function visibilityFlatCheckDC(name) {
    if (typeof name !== "string") {
      return null;
    }
    const definition = VISIBILITY_CONDITIONS[normalizeSlug(name)];
    return definition === undefined ? null : definition.flatCheckDC;
  }

  /**
   * Resolve the strictest visibility state on a creature. Hidden supersedes
   * concealed, and undetected supersedes both.
   *
   * @param {object} combatant
   * @returns {{
   *   condition: string|null,
   *   label: string|null,
   *   flatCheckDC: number|null,
   *   targetable: boolean,
   *   undetected: boolean
   * }}
   */
  function getVisibility(combatant) {
    for (const slug of VISIBILITY_PRIORITY) {
      if (hasCondition(combatant, slug)) {
        const definition = VISIBILITY_CONDITIONS[slug];
        return {
          condition: definition.slug,
          label: definition.label,
          flatCheckDC: definition.flatCheckDC,
          targetable: definition.targetable,
          undetected: definition.slug === "undetected",
        };
      }
    }

    return {
      condition: null,
      label: null,
      flatCheckDC: null,
      targetable: true,
      undetected: false,
    };
  }

  /**
   * A hidden or undetected attacker leaves its target Off-Guard against its
   * own attack. This is a boolean helper only; the Strike action injects the
   * circumstance penalty through the modifier resolver.
   *
   * @param {object} combatant
   * @returns {boolean}
   */
  function isHiddenAttacker(combatant) {
    return (
      hasCondition(combatant, CONDITION_SLUGS.HIDDEN) ||
      hasCondition(combatant, CONDITION_SLUGS.UNDETECTED)
    );
  }

  /** Visibility states ended by a hostile action. Concealment is not removed. */
  const HOSTILE_VISIBILITY_CONDITIONS = Object.freeze(["hidden", "undetected"]);

  /**
   * A creature that takes a hostile action (Strike, an attack spell, or a
   * save spell) is no longer Hidden or Undetected afterwards. Remove those
   * stealth states; light-based Concealment is a separate sensory condition
   * and survives.
   *
   * The caller decides when the action actually resolved. Rejected attempts
   * (out of reach, invalid target, no actions) must not call this helper.
   *
   * @param {object} combatant
   * @returns {{removed:object[],visibility:{condition:string|null,label:string|null,flatCheckDC:number|null,targetable:boolean,undetected:boolean}}}
   */
  function revealAfterHostileAction(combatant) {
    const removed = [];
    if (
      combatant === null ||
      typeof combatant !== "object" ||
      typeof combatant.removeCondition !== "function"
    ) {
      return { removed: removed, visibility: getVisibility(combatant) };
    }

    for (const slug of HOSTILE_VISIBILITY_CONDITIONS) {
      if (!hasCondition(combatant, slug)) {
        continue;
      }
      const record =
        typeof combatant.getCondition === "function"
          ? combatant.getCondition(slug)
          : null;
      combatant.removeCondition(slug);
      removed.push(record || { name: slug, slug: slug });
    }

    return { removed: removed, visibility: getVisibility(combatant) };
  }

  /**
   * A creature is immobilized while it has the Immobilized condition or any
   * grapple condition that implies it. This is the single predicate used by
   * Stride, Step, Stand, and the View, so the rule is not duplicated.
   *
   * @param {object} combatant
   * @returns {boolean}
   */
  function isImmobilized(combatant) {
    for (const slug of MOVEMENT_BLOCKING_CONDITIONS) {
      if (hasCondition(combatant, slug)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Normalize an action's trait list into a case-insensitive Set. Accepts a
   * single string or an array of strings; unknown entries are ignored.
   *
   * @param {string|string[]|undefined|null} traits
   * @returns {Set<string>}
   */
  function normalizeActionTraits(traits) {
    const set = new Set();
    if (traits === undefined || traits === null) {
      return set;
    }
    const list = Array.isArray(traits) ? traits : [traits];
    for (const entry of list) {
      if (typeof entry !== "string") {
        continue;
      }
      const value = entry.trim().toLowerCase();
      if (value !== "") {
        set.add(value);
      }
    }
    return set;
  }

  /**
   * Whether the action described by `options` is the Escape action, which is
   * the sole exception to the Restrained action block.
   *
   * @param {{action?:string,isEscape?:boolean}|undefined|null} options
   * @returns {boolean}
   */
  function isEscapeAction(options) {
    if (options === undefined || options === null) {
      return false;
    }
    if (options.isEscape === true) {
      return true;
    }
    return (
      typeof options.action === "string" &&
      options.action.trim().toLowerCase() === "escape"
    );
  }

  /**
   * Restrained: "you can't use actions with the attack or manipulate traits,
   * except to Escape." This predicate is deterministic and never rolls dice.
   *
   * @param {object} combatant
   * @param {{traits?:string|string[],action?:string,isEscape?:boolean}} [options]
   * @returns {boolean}
   */
  function isRestrainedActionBlocked(combatant, options) {
    if (!hasCondition(combatant, CONDITION_SLUGS.RESTRAINED)) {
      return false;
    }
    if (isEscapeAction(options)) {
      return false;
    }
    const traits = normalizeActionTraits(
      options === undefined || options === null ? undefined : options.traits,
    );
    return (
      traits.has(ACTION_TRAITS.ATTACK) ||
      traits.has(ACTION_TRAITS.MANIPULATE)
    );
  }

  /**
   * Grabbed: "If you attempt a manipulate action while grabbed, you must
   * succeed at a DC 5 flat check or it is lost." This predicate only reports
   * whether the check is required; the caller resolves the die.
   *
   * @param {object} combatant
   * @param {{traits?:string|string[]}} [options]
   * @returns {boolean}
   */
  function isGrabbedManipulate(combatant, options) {
    if (!hasCondition(combatant, CONDITION_SLUGS.GRABBED)) {
      return false;
    }
    const traits = normalizeActionTraits(
      options === undefined || options === null ? undefined : options.traits,
    );
    return traits.has(ACTION_TRAITS.MANIPULATE);
  }

  /**
   * The active grapple condition on a creature. Restrained supersedes Grabbed
   * because it is the stronger state, even if both records exist.
   *
   * @param {object} combatant
   * @returns {object|null}
   */
  function getGrappleCondition(combatant) {
    if (hasCondition(combatant, CONDITION_SLUGS.RESTRAINED)) {
      return combatant.getCondition(CONDITION_SLUGS.RESTRAINED);
    }
    if (hasCondition(combatant, CONDITION_SLUGS.GRABBED)) {
      return combatant.getCondition(CONDITION_SLUGS.GRABBED);
    }
    return null;
  }

  /**
   * Remove every grapple condition and the companion Immobilized record that
   * a single source applied to a combatant. Conditions from other sources are
   * left untouched.
   *
   * The Combatant owns the actual store; this helper only adapts a roster to
   * that API so movement and Encounter code can call one function.
   *
   * @param {object[]} combatants
   * @param {string} sourceId
   * @returns {{combatant:object,removed:object[]}[]}
   */
  function releaseGrapplesBySource(combatants, sourceId) {
    if (!Array.isArray(combatants) || typeof sourceId !== "string") {
      return [];
    }
    const released = [];
    for (const combatant of combatants) {
      if (
        combatant === null ||
        typeof combatant !== "object" ||
        typeof combatant.releaseGrappleFrom !== "function"
      ) {
        continue;
      }
      const removed = combatant.releaseGrappleFrom(sourceId);
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

  return Object.freeze({
    CONDITION_SLUGS: CONDITION_SLUGS,
    CONDITIONS: CONDITION_SLUGS,
    DEFINITIONS: DEFINITIONS,
    CONDITION_DEFINITIONS: DEFINITIONS,
    VISIBILITY_CONDITIONS: VISIBILITY_CONDITIONS,
    VISIBILITY_PRIORITY: VISIBILITY_PRIORITY,
    HOSTILE_VISIBILITY_CONDITIONS: HOSTILE_VISIBILITY_CONDITIONS,
    GRAPPLE_CONDITIONS: GRAPPLE_CONDITIONS,
    ACTION_TRAITS: ACTION_TRAITS,
    normalizeActionTraits: normalizeActionTraits,
    isEscapeAction: isEscapeAction,
    isRestrainedActionBlocked: isRestrainedActionBlocked,
    isGrabbedManipulate: isGrabbedManipulate,
    MOVEMENT_BLOCKING_CONDITIONS: MOVEMENT_BLOCKING_CONDITIONS,
    INCAPACITATING_CONDITIONS: INCAPACITATING_CONDITIONS,
    DURATION_ORIGINS: DURATION_ORIGINS,
    isKnownCondition: isKnownCondition,
    isVisibilityCondition: isVisibilityCondition,
    visibilityFlatCheckDC: visibilityFlatCheckDC,
    getVisibility: getVisibility,
    isHiddenAttacker: isHiddenAttacker,
    revealAfterHostileAction: revealAfterHostileAction,
    isImmobilized: isImmobilized,
    getGrappleCondition: getGrappleCondition,
    releaseGrapplesBySource: releaseGrapplesBySource,
    createCondition: createCondition,
    copyCondition: copyCondition,
    conditionModifiers: conditionModifiers,
  });
});
