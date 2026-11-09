/**
 * PF2E REMASTERED — STRIKE ACTION (HEADLESS CORE)
 *
 * One-action melee Strike:
 *   - reach is 5 feet by default (adjacent orthogonal or diagonal cell);
 *   - the target must be a living hostile visible via centre-to-centre LoS;
 *   - the attack resolves base attack bonus + conditions (Frightened) + MAP
 *     [untyped] through the central modifier resolver;
 *   - the target resolves base AC + conditions (Off-Guard, Frightened, Shield
 *     Raised) and flanking through the same resolver;
 *   - the check resolves through the four degrees of success;
 *   - a success deals damage, a critical success doubles total damage;
 *   - damage is applied to the target's HP, marking it defeated at 0.
 *
 * The host may inject deterministic die callbacks for both the d20 and damage
 * dice. Invalid attempts consume no action, no MAP increment, and no dice.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Grid/grid-math.js"),
      require("../Grid/los-math.js"),
      require("../Grid/distance.js"),
      require("../Rules/checks.js"),
      require("../Rules/damage.js"),
      require("../Rules/map.js"),
      require("../Rules/modifiers.js"),
      require("../Grid/flanking.js"),
      require("../Grid/cover.js"),
      require("../Entities/conditions.js"),
      require("../Rules/weapon-traits.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.Strike = factory(
      root.PF2e.Core.Grid,
      root.PF2e.Core.LosMath,
      root.PF2e.Core.Distance3D,
      root.PF2e.Core.Rules.Checks,
      root.PF2e.Core.Rules.Damage,
      root.PF2e.Core.Rules.MultipleAttack,
      root.PF2e.Core.Rules.Modifiers,
      root.PF2e.Core.Flanking,
      root.PF2e.Core.Cover,
      root.PF2e.Core.Conditions,
      root.PF2e.Core.Rules.WeaponTraits,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Grid,
  LosMath,
  Distance3D,
  Checks,
  Damage,
  MultipleAttack,
  Modifiers,
  Flanking,
  Cover,
  Conditions,
  WeaponTraits,
) {
  "use strict";

  const STRIKE_REASONS = Object.freeze({
    NO_ACTIONS: "no-actions",
    INVALID_TARGET: "invalid-target",
    ALLY: "ally",
    OUT_OF_REACH: "out-of-reach",
    NO_LINE_OF_SIGHT: "no-line-of-sight",
    ATTACKER_DEFEATED: "attacker-defeated",
    TARGET_DEFEATED: "target-defeated",
    TARGET_UNDETECTED: "target-undetected",
    OUT_OF_RANGE: "out-of-range",
    NOT_LOADED: "not-loaded",
    DISRUPTED: "disrupted",
    RESTRAINED_ACTION_BLOCKED: "restrained-action-blocked",
  });

  const DEFAULT_REACH_FEET = 5;
  const DEFAULT_AC = 10;
  const DEFAULT_ATTACK_BONUS = 0;
  const DEFAULT_DAMAGE = "1d4";

  function assertCombatant(combatant, label) {
    if (
      combatant === null ||
      typeof combatant !== "object" ||
      !Number.isInteger(combatant.x) ||
      !Number.isInteger(combatant.y)
    ) {
      throw new TypeError(label + " must be a positioned Combatant.");
    }
    if (typeof combatant.alliance !== "string") {
      throw new TypeError(label + " must declare an alliance.");
    }
  }

  function assertInteger(value, label) {
    if (!Number.isInteger(value)) {
      throw new TypeError(label + " must be an integer; received " + String(value) + ".");
    }
  }

  function normalizeReach(reachFeet) {
    const reach = reachFeet === undefined ? DEFAULT_REACH_FEET : reachFeet;
    if (!Number.isInteger(reach) || reach <= 0 || reach % 5 !== 0) {
      throw new RangeError("reachFeet must be a positive multiple of 5.");
    }
    return reach;
  }

  /**
   * Explicit per-Strike reach wins; otherwise use the attacker's weapon reach
   * (including the `reach` trait), then the 5-ft default.
   *
   * @param {object} options
   * @param {object} attacker
   * @returns {number}
   */
  function resolveReachFeet(options, attacker) {
    if (options.reachFeet !== undefined) {
      return normalizeReach(options.reachFeet);
    }
    if (
      attacker !== null &&
      typeof attacker === "object" &&
      typeof attacker.getReachFeet === "function"
    ) {
      return normalizeReach(attacker.getReachFeet());
    }
    if (attacker !== null && typeof attacker === "object" && attacker.traits) {
      return normalizeReach(WeaponTraits.getReachFeet(attacker.traits));
    }
    return DEFAULT_REACH_FEET;
  }

  function normalizeAttackBonus(options, attacker) {
    if (options.attackBonus !== undefined) {
      assertInteger(options.attackBonus, "attackBonus");
      return options.attackBonus;
    }
    return Number.isInteger(attacker.attackBonus)
      ? attacker.attackBonus
      : DEFAULT_ATTACK_BONUS;
  }

  function normalizeTargetAC(options, target) {
    if (options.targetAC !== undefined) {
      assertInteger(options.targetAC, "targetAC");
      return options.targetAC;
    }
    return Number.isInteger(target.ac) ? target.ac : DEFAULT_AC;
  }

  /**
   * Resolve the weapon damage contract to `{ formula, type }`.
   *
   * A per-Strike `damage` override may be a formula string or an object
   * `{ formula, type }`; `damageType` can override the type independently.
   * Otherwise the attacker's `damage`/`damageType` (or `damageSpec`) is used.
   *
   * @param {object} options
   * @param {object} attacker
   * @returns {{formula:string,type:string}}
   */
  function normalizeDamageSpec(options, attacker) {
    if (options.damage !== undefined) {
      return Damage.parseDamageSpec(options.damage, options.damageType);
    }

    const source =
      attacker.damage !== undefined
        ? attacker.damage
        : attacker.damageSpec !== undefined
          ? attacker.damageSpec
          : DEFAULT_DAMAGE;

    return Damage.parseDamageSpec(source, attacker.damageType);
  }

  /**
   * Resolve the complete weapon contract used by the damage calculator:
   * formula, type, and traits. Per-Strike `weapon`/`traits` overrides win;
   * otherwise the attacker's authored weapon traits are used.
   *
   * @param {object} options
   * @param {object} attacker
   * @returns {{formula:string,type:string,traits:Array}}
   */
  function normalizeWeaponSpec(options, attacker) {
    if (options.weapon !== undefined) {
      const spec = Damage.parseDamageSpec(
        options.weapon,
        options.damageType,
      );
      const traitSource =
        options.weapon.traits !== undefined
          ? options.weapon.traits
          : options.traits;
      return {
        formula: spec.formula,
        type: spec.type,
        traits: WeaponTraits.normalizeTraits(traitSource),
      };
    }

    const spec = normalizeDamageSpec(options, attacker);
    const traitSource =
      options.traits !== undefined ? options.traits : attacker.traits;
    return {
      formula: spec.formula,
      type: spec.type,
      traits: WeaponTraits.normalizeTraits(traitSource),
    };
  }

  function normalizeAgile(options, attacker) {
    if (options.agile !== undefined) {
      if (typeof options.agile !== "boolean") {
        throw new TypeError("agile must be a boolean.");
      }
      return options.agile;
    }
    return attacker.agile === true;
  }

  function currentMapPenalty(attacker, agile) {
    if (typeof attacker.getMultipleAttackPenalty === "function") {
      return attacker.getMultipleAttackPenalty(agile);
    }
    const attacksMade = Number.isInteger(attacker.attacksThisTurn)
      ? attacker.attacksThisTurn
      : 0;
    return MultipleAttack.multipleAttackPenalty(attacksMade, agile);
  }

  function normalizeAllies(options) {
    if (Array.isArray(options.allies)) {
      return options.allies;
    }
    if (Array.isArray(options.combatants)) {
      return options.combatants;
    }
    return [];
  }

  /**
   * A Combatant only establishes hostility when an alliance was authored.
   * Two isolated combatants that both fall back to the default "player"
   * alliance are not treated as allies.
   */
  function isSameAlliance(a, b) {
    if (!a || !b || a.alliance === undefined || b.alliance === undefined) {
      return false;
    }
    if (a.alliance !== b.alliance) {
      return false;
    }
    return a.allianceExplicit !== false && b.allianceExplicit !== false;
  }

  /**
   * Resolve the ranged weapon profile for this Strike. A per-Strike weapon
   * override wins; otherwise the attacker's authored weapon profile is used.
   *
   * @param {object} options
   * @param {object} attacker
   * @returns {object}
   */
  function resolveWeaponProfile(options, attacker) {
    if (options.weapon !== undefined) {
      const weapon = options.weapon;
      if (weapon !== null && typeof weapon === "object" && !Array.isArray(weapon)) {
        const source = Object.assign({}, weapon);
        if (source.traits === undefined && options.traits !== undefined) {
          source.traits = options.traits;
        }
        return WeaponTraits.getWeaponProfile(source);
      }
      return WeaponTraits.getWeaponProfile({
        formula: weapon,
        traits: options.traits,
      });
    }

    if (
      attacker !== null &&
      typeof attacker === "object" &&
      attacker.weapon !== undefined &&
      attacker.weapon !== null &&
      typeof attacker.weapon === "object" &&
      attacker.weapon.isRanged !== undefined
    ) {
      return attacker.weapon;
    }

    if (attacker !== null && typeof attacker.getWeapon === "function") {
      return WeaponTraits.getWeaponProfile(attacker.getWeapon());
    }

    return WeaponTraits.getWeaponProfile(attacker);
  }

  /**
   * Resolve Reactive Strike against a ranged attacker before the shot. The
   * module is loaded lazily to avoid a CommonJS cycle with reactive-strike.js,
   * which itself depends on this file.
   *
   * @returns {object|null}
   */
  function getReactiveStrikeModule() {
    if (typeof module === "object" && module.exports && typeof require === "function") {
      return require("./reactive-strike.js");
    }
    const globalRoot = typeof globalThis !== "undefined" ? globalThis : null;
    if (
      globalRoot &&
      globalRoot.PF2e &&
      globalRoot.PF2e.Core &&
      globalRoot.PF2e.Core.Actions
    ) {
      return globalRoot.PF2e.Core.Actions.ReactiveStrike || null;
    }
    return null;
  }

  /**
   * A ranged Strike is a manipulate action while threatened. Every living
   * enemy with a reaction and the shooter inside its melee reach may make a
   * Reactive Strike. A critical hit (or a lethal hit) disrupts the shot.
   *
   * @param {object} options
   * @param {object} attacker
   * @param {object} profile
   * @returns {{disrupted:boolean, reactions:object[], threats:object[]}}
   */
  function resolveRangedReactions(options, attacker, profile) {
    // Prefer the full roster for threat scanning; `allies` is the flanking
    // helper and may intentionally contain only the attacker's side.
    const combatants = Array.isArray(options.combatants)
      ? options.combatants
      : normalizeAllies(options);
    if (profile.isRanged !== true || combatants.length === 0) {
      return { disrupted: false, reactions: [], threats: [] };
    }

    const ReactiveStrike = getReactiveStrikeModule();
    if (!ReactiveStrike) {
      return { disrupted: false, reactions: [], threats: [] };
    }

    const cell =
      attacker.position !== undefined && attacker.position !== null
        ? attacker.position
        : { x: attacker.x, y: attacker.y };

    const threats = ReactiveStrike.findThreatenedEnemies({
      mover: attacker,
      cell: cell,
      combatants: combatants,
      reachFeet: options.reactionReachFeet,
    });

    const reactions = [];
    let disrupted = false;

    for (const threat of threats) {
      const reaction = ReactiveStrike.performReactiveStrike({
        attacker: threat,
        target: attacker,
        map: options.map,
        combatants: combatants,
        allies: options.allies,
        rollD20:
          typeof options.rollReactionD20 === "function"
            ? options.rollReactionD20
            : options.rollD20,
        rollDamageDie:
          typeof options.rollReactionDamageDie === "function"
            ? options.rollReactionDamageDie
            : options.rollDamageDie,
        rollDie:
          typeof options.rollReactionDie === "function"
            ? options.rollReactionDie
            : options.rollDie,
      });
      reactions.push(reaction);

      if (
        reaction.ok === true &&
        (reaction.critical === true ||
          attacker.isDefeated === true ||
          attacker.currentHP === 0)
      ) {
        disrupted = true;
        break;
      }
    }

    return { disrupted: disrupted, reactions: reactions, threats: threats };
  }

  function detectFlanking(attacker, target, options) {
    const flankers = Flanking.getFlankingAllies(
      target,
      attacker,
      normalizeAllies(options),
      options.map,
      { reachFeet: options.reachFeet },
    );
    return {
      flanked: flankers.length > 0,
      flankers: flankers.map(function (combatant) {
        return { id: combatant.id, name: combatant.name };
      }),
    };
  }

  /**
   * Whether a target is Off-Guard for the purpose of backstabber and other
   * effects that check the condition. Prone grants Off-Guard in PF2e, so it is
   * treated as a source here even though the engine models the AC penalty
   * directly on the prone condition instead of adding a second condition.
   */
  function hasOffGuard(target) {
    return (
      typeof target.hasCondition === "function" &&
      (target.hasCondition("off-guard") ||
        target.hasCondition("prone") ||
        target.hasCondition("grabbed") ||
        target.hasCondition("restrained"))
    );
  }

  /**
   * Attack-side modifiers: the attacker's frightened (status) and the current
   * Multiple Attack Penalty (untyped). Off-Guard never applies to attacks.
   */
  function collectAttackModifiers(attacker, mapPenalty) {
    const modifiers =
      typeof attacker.getConditionModifiers === "function"
        ? attacker.getConditionModifiers("attack")
        : [];

    const result = modifiers.slice();
    if (mapPenalty !== 0) {
      result.push({
        name: "MAP",
        type: Modifiers.MODIFIER_TYPES.UNTYPED,
        value: mapPenalty,
        source: "multiple-attack-penalty",
      });
    }
    return result;
  }

  /**
   * Defense-side modifiers: the target's conditions (Off-Guard, Frightened,
   * Shield Raised, Greater Cover) plus flanking and geometric cover. A target
   * that already has Off-Guard must not receive a second circumstance penalty
   * from being flanked. All circumstance bonuses (Shield Raised, Take Cover,
   * Lesser/Standard/Greater Cover) flow through the resolver, which keeps only
   * the highest one, so cover never stacks with a raised shield.
   *
   * @param {object} target
   * @param {boolean} flanked
   * @param {object|string|null} [cover] determineCover() result or degree
   * @param {boolean} [hiddenAttacker] the attacker is Hidden or Undetected
   */
  function collectDefenseModifiers(target, flanked, cover, hiddenAttacker) {
    const modifiers =
      typeof target.getConditionModifiers === "function"
        ? target.getConditionModifiers("ac")
        : [];

    const result = modifiers.slice();
    const alreadyOffGuard =
      hasOffGuard(target) ||
      result.some(function (modifier) {
        return modifier.source === "off-guard";
      });

    // Flanking and a Hidden/Undetected attacker both impose the same
    // Off-Guard circumstance penalty. The resolver would suppress a duplicate,
    // but only one modifier is injected so the log does not show a phantom
    // second source.
    if ((flanked || hiddenAttacker === true) && !alreadyOffGuard) {
      result.push({
        name: hiddenAttacker === true ? "Hidden Attacker" : "Off-Guard",
        type: Modifiers.MODIFIER_TYPES.CIRCUMSTANCE,
        value: -2,
        source: "off-guard",
      });
    }

    const coverModifier = Cover.coverModifier(cover);
    if (coverModifier !== null) {
      result.push(coverModifier);
    }

    return result;
  }

  /**
   * Edge-to-edge line of sight between two combatants. For multi-cell (Large+)
   * creatures this tests every pair of occupied cells, so line of effect is
   * judged from the closest / most favourable edge of each footprint rather
   * than a single anchor (top-left) cell. Returns the first visible trace, or
   * (when no pair is visible) the first blocked trace for `blockedBy` reporting.
   *
   * @param {object} attacker
   * @param {object} target
   * @param {object} map
   * @returns {object} a LosMath.traceLineOfSight result
   */
  function traceCombatantLineOfSight(attacker, target, map) {
    const fromCells = Grid.occupiedCellsOf(attacker);
    const toCells = Grid.occupiedCellsOf(target);
    let firstBlocked = null;
    for (const from of fromCells) {
      for (const to of toCells) {
        const trace = LosMath.traceLineOfSight(from, to, map);
        if (trace.visible) {
          return trace;
        }
        if (firstBlocked === null) {
          firstBlocked = trace;
        }
      }
    }
    return firstBlocked;
  }

  /**
   * Validation without spending an action or rolling dice.
   *
   * @param {{
   *   attacker: object,
   *   target: object,
   *   map: object,
   *   reachFeet?: number,
   *   allies?: object[]
   * }} options
   * @returns {{
   *   ok:true, distanceFeet:number, reachFeet:number, lineOfSight:true
   * } | {ok:false, reason:string, distanceFeet?:number}}
   */
  function evaluateStrike(options) {
    const opts = options || {};
    assertCombatant(opts.attacker, "attacker");
    assertCombatant(opts.target, "target");

    const attacker = opts.attacker;
    const target = opts.target;
    const weaponProfile = resolveWeaponProfile(opts, attacker);
    const ranged = weaponProfile.isRanged === true;
    const reachFeet = resolveReachFeet(opts, attacker);

    // A map is optional for isolated headless math. When supplied it must be
    // a real GridMap so line of sight and cover stay authoritative.
    const hasMap = opts.map !== undefined && opts.map !== null;
    if (hasMap && typeof opts.map.hasObstacle !== "function") {
      throw new TypeError("Strike map must be a GridMap.");
    }

    if (attacker.isDefeated === true) {
      return { ok: false, reason: STRIKE_REASONS.ATTACKER_DEFEATED };
    }

    // Restrained blocks every attack-trait action. Strike is an attack action
    // and is therefore refused before any target, geometry, or dice work.
    if (
      typeof Conditions.isRestrainedActionBlocked === "function" &&
      Conditions.isRestrainedActionBlocked(attacker, {
        traits: ["attack"],
        action: "strike",
      })
    ) {
      return {
        ok: false,
        reason: STRIKE_REASONS.RESTRAINED_ACTION_BLOCKED,
        traits: ["attack"],
      };
    }

    if (attacker === target) {
      return { ok: false, reason: STRIKE_REASONS.INVALID_TARGET };
    }
    if (
      attacker.id !== undefined &&
      target.id !== undefined &&
      attacker.id === target.id
    ) {
      return { ok: false, reason: STRIKE_REASONS.INVALID_TARGET };
    }
    if (attacker.x === target.x && attacker.y === target.y) {
      return { ok: false, reason: STRIKE_REASONS.INVALID_TARGET };
    }
    if (isSameAlliance(attacker, target)) {
      return { ok: false, reason: STRIKE_REASONS.ALLY };
    }

    // Ammunition state is checked before target validity so a discharged
    // crossbow reports `not-loaded` even if the previous shot dropped the
    // target. Reload 0 weapons are always ready.
    if (
      ranged &&
      weaponProfile.reload > 0 &&
      attacker.isLoaded === false
    ) {
      return {
        ok: false,
        reason: STRIKE_REASONS.NOT_LOADED,
        ranged: true,
        rangeIncrement: weaponProfile.rangeIncrement,
        reload: weaponProfile.reload,
        isLoaded: false,
      };
    }

    if (target.isDefeated === true) {
      return { ok: false, reason: STRIKE_REASONS.TARGET_DEFEATED };
    }

    // An Undetected creature cannot be chosen as a direct target at all. This
    // is a targeting restriction, not a miss: no action, reaction, or MAP is
    // spent when the attempt is rejected.
    const visibility = Conditions.getVisibility(target);
    const hiddenAttacker = Conditions.isHiddenAttacker(attacker);
    if (visibility.undetected) {
      return {
        ok: false,
        reason: STRIKE_REASONS.TARGET_UNDETECTED,
        visibility: visibility,
        hiddenAttacker: hiddenAttacker,
      };
    }

    const distanceFeet = Distance3D.getCombatantDistance3D(attacker, target);
    // Melee reach uses the reach-aware distance so a 10-ft reach can target
    // the second diagonal square even though it normally costs 15 ft.
    const reachDistanceFeet = ranged
      ? distanceFeet
      : Distance3D.getCombatantReachDistance3D(attacker, target, reachFeet);

    let rangeIncrementResult = null;
    let rangePenalty = 0;
    if (ranged) {
      if (weaponProfile.rangeIncrement !== null) {
        rangeIncrementResult = WeaponTraits.rangeIncrementPenalty(
          distanceFeet,
          weaponProfile.rangeIncrement,
        );
        if (!rangeIncrementResult.ok) {
          return {
            ok: false,
            reason: STRIKE_REASONS.OUT_OF_RANGE,
            distanceFeet: distanceFeet,
            rangeIncrement: weaponProfile.rangeIncrement,
            maxRangeFeet: rangeIncrementResult.maxRangeFeet,
            ranged: true,
            visibility: visibility,
            hiddenAttacker: hiddenAttacker,
          };
        }
        rangePenalty = rangeIncrementResult.penalty;
      }
    } else if (reachDistanceFeet > reachFeet) {
      return {
        ok: false,
        reason: STRIKE_REASONS.OUT_OF_REACH,
        distanceFeet: distanceFeet,
        reachDistanceFeet: reachDistanceFeet,
        visibility: visibility,
        flatCheckCondition: visibility.condition,
        flatCheckDC: visibility.flatCheckDC,
        hiddenAttacker: hiddenAttacker,
      };
    }

    const volleyPenalty = ranged
      ? WeaponTraits.volleyPenalty(distanceFeet, weaponProfile.volley)
      : 0;

    let sight = null;
    let cover = null;
    if (hasMap) {
      sight = traceCombatantLineOfSight(attacker, target, opts.map);
      if (!sight.visible) {
        return {
          ok: false,
          reason: STRIKE_REASONS.NO_LINE_OF_SIGHT,
          distanceFeet: distanceFeet,
          blockedBy: sight.blockedBy,
          visibility: visibility,
          flatCheckCondition: visibility.condition,
          flatCheckDC: visibility.flatCheckDC,
          hiddenAttacker: hiddenAttacker,
        };
      }

      // The canonical cover check can also prove that all four corner rays
      // are blocked even when the centre ray grazes the wall. In that case the
      // target cannot be seen and the Strike is impossible.
      cover = Cover.determineCover(
        attacker,
        target,
        opts.map,
        normalizeAllies(opts),
      );
      if (cover.noLineOfSight) {
        return {
          ok: false,
          reason: STRIKE_REASONS.NO_LINE_OF_SIGHT,
          distanceFeet: distanceFeet,
          blockedBy: sight.blockedBy,
          cover: cover,
          coverDegree: cover.degree,
          coverBonus: cover.acBonus,
          blockedRaysCount: cover.blockedRaysCount,
          noLineOfSight: true,
          visibility: visibility,
          flatCheckCondition: visibility.condition,
          flatCheckDC: visibility.flatCheckDC,
          hiddenAttacker: hiddenAttacker,
        };
      }
    }

    // Flanking is a melee-only condition. Ranged attacks never benefit from
    // it, even when allies are geometrically opposite the target.
    const flanking = ranged
      ? { flanked: false, flankers: [] }
      : detectFlanking(attacker, target, opts);

    return {
      ok: true,
      distanceFeet: distanceFeet,
      reachDistanceFeet: reachDistanceFeet,
      reachFeet: reachFeet,
      lineOfSight: hasMap ? true : null,
      cover: cover,
      coverDegree: cover ? cover.degree : Cover.COVER_DEGREES.NONE,
      coverBonus: cover ? cover.acBonus : 0,
      coverRays: cover ? cover.rays : [],
      blockedRaysCount: cover ? cover.blockedRaysCount : 0,
      flanked: flanking.flanked,
      flankers: flanking.flankers,
      offGuard: flanking.flanked || hiddenAttacker || hasOffGuard(target),
      hiddenAttacker: hiddenAttacker,
      visibility: visibility,
      flatCheckCondition: visibility.condition,
      flatCheckDC: visibility.flatCheckDC,
      ranged: ranged,
      rangeIncrement: weaponProfile.rangeIncrement,
      reload: weaponProfile.reload,
      volley: weaponProfile.volley,
      rangePenalty: rangePenalty,
      volleyPenalty: volleyPenalty,
      rangeIncrementIndex: rangeIncrementResult
        ? rangeIncrementResult.incrementIndex
        : 0,
      maxRangeFeet: rangeIncrementResult
        ? rangeIncrementResult.maxRangeFeet
        : null,
    };
  }

  function rollAttack(options) {
    const opts = options || {};
    let value;

    if (typeof opts.rollD20 === "function") {
      value = opts.rollD20();
    } else if (typeof opts.rollDie === "function") {
      value = opts.rollDie(20);
    } else {
      value = 1 + Math.floor(Math.random() * 20);
    }

    if (!Number.isInteger(value) || value < 1 || value > 20) {
      throw new RangeError("rollD20 must return an integer from 1 to 20.");
    }
    return value;
  }

  /**
   * Resolve the flat check imposed by Concealed or Hidden. A dedicated
   * `rollFlatCheck` callback keeps the visibility die independent from the
   * attack die in deterministic tests and host logs.
   *
   * @param {object} options
   * @param {number} dc
   * @param {string} condition
   * @returns {{passed:boolean, dc:number, roll:number, condition:string}}
   */
  function rollVisibilityFlatCheck(options, dc, condition) {
    const opts = options || {};
    const flatOptions = { dc: dc };

    if (typeof opts.rollFlatCheck === "function") {
      flatOptions.rollD20 = opts.rollFlatCheck;
    } else if (typeof opts.rollD20 === "function") {
      flatOptions.rollD20 = opts.rollD20;
    } else if (typeof opts.rollDie === "function") {
      flatOptions.rollDie = opts.rollDie;
    }

    const result = Checks.evaluateFlatCheck(flatOptions);
    return {
      passed: result.passed,
      dc: result.dc,
      roll: result.d20,
      condition: condition,
    };
  }

  function resolveDamageDie(options) {
    if (typeof options.rollDamageDie === "function") {
      return options.rollDamageDie;
    }
    if (typeof options.rollDie === "function") {
      return options.rollDie;
    }
    return undefined;
  }

  /**
   * A resolved hostile Strike ends the attacker's Hidden/Undetected state.
   * The helper only runs after the action was actually spent; rejected
   * attempts never call it.
   *
   * @param {object} attacker
   * @returns {{revealed:boolean,revealedConditions:string[],visibilityAfter:object}}
   */
  function resolveHostileReveal(attacker) {
    const reveal =
      typeof Conditions.revealAfterHostileAction === "function"
        ? Conditions.revealAfterHostileAction(attacker)
        : { removed: [], visibility: Conditions.getVisibility(attacker) };
    return {
      revealed: reveal.removed.length > 0,
      revealedConditions: reveal.removed.map(function (condition) {
        return condition.slug || condition.name;
      }),
      visibilityAfter: reveal.visibility,
    };
  }

  /**
   * @param {{
   *   attacker: object,
   *   target: object,
   *   map: object,
   *   reachFeet?: number,
   *   attackBonus?: number,
   *   targetAC?: number,
   *   damage?: string|{formula:string,type?:string},
   *   damageType?: string,
   *   agile?: boolean,
   *   allies?: object[],
   *   rollD20?: () => number,
   *   rollDamageDie?: (sides: number) => number,
   *   rollDie?: (sides: number) => number
   * }} options
   * @returns {object}
   */
  function performStrike(options) {
    const opts = options || {};
    assertCombatant(opts.attacker, "attacker");
    if (typeof opts.attacker.canSpendActions !== "function") {
      throw new TypeError("Strike requires a Combatant with an action pool.");
    }
    if (!opts.attacker.canSpendActions(1)) {
      return { ok: false, reason: STRIKE_REASONS.NO_ACTIONS };
    }

    const evaluation = evaluateStrike(opts);
    if (!evaluation.ok) {
      return evaluation;
    }

    const attacker = opts.attacker;
    const target = opts.target;

    const attackBonus = normalizeAttackBonus(opts, attacker);
    const targetAC = normalizeTargetAC(opts, target);
    const weaponSpec = normalizeWeaponSpec(opts, attacker);
    const weaponProfile = resolveWeaponProfile(opts, attacker);
    const ranged = weaponProfile.isRanged === true;
    const agile = normalizeAgile(opts, attacker);
    const mapPenalty = currentMapPenalty(attacker, agile);
    const flanked = evaluation.flanked === true;
    const hiddenAttacker = evaluation.hiddenAttacker === true;
    const offGuard = flanked || hiddenAttacker || hasOffGuard(target);
    const cover = evaluation.cover || null;
    const visibility = evaluation.visibility || Conditions.getVisibility(target);

    // A ranged Strike is a manipulate action while threatened. Resolve every
    // Reactive Strike before the shot. A critical or lethal reaction disrupts
    // the attack: the Strike action is spent, no attack roll is made, and the
    // loaded ammunition is not consumed.
    const reactionPhase = resolveRangedReactions(opts, attacker, weaponProfile);
    if (reactionPhase.disrupted) {
      attacker.spendActions(1);
      const reveal = resolveHostileReveal(attacker);
      return {
        ok: false,
        disrupted: true,
        revealed: reveal.revealed,
        revealedConditions: reveal.revealedConditions,
        visibilityAfter: reveal.visibilityAfter,
        reason: STRIKE_REASONS.DISRUPTED,
        attackerId: attacker.id,
        targetId: target.id,
        distanceFeet: evaluation.distanceFeet,
        ranged: true,
        rangeIncrement: weaponProfile.rangeIncrement,
        reload: weaponProfile.reload,
        volley: weaponProfile.volley,
        rangePenalty: evaluation.rangePenalty,
        volleyPenalty: evaluation.volleyPenalty,
        reactionStrikes: reactionPhase.reactions,
        reactionStrike:
          reactionPhase.reactions.length > 0
            ? reactionPhase.reactions[reactionPhase.reactions.length - 1]
            : null,
        reactionThreats: reactionPhase.threats,
        attackRoll: null,
        hit: false,
        isHit: false,
        critical: false,
        isCritical: false,
        damage: null,
        damageDealt: 0,
        hpBefore: null,
        hpAfter: null,
        targetDefeated: target.isDefeated === true,
        isLoaded: attacker.isLoaded,
        attackerDefeated: attacker.isDefeated === true,
        attacksThisTurn: attacker.attacksThisTurn,
        actionsLeft: attacker.actionsRemaining,
      };
    }

    // A Concealed target needs a DC 5 flat check and a Hidden target DC 11.
    // The check happens before the attack roll. On a failure the action and
    // MAP are still consumed, but no attack roll and no damage are produced.
    let flatCheck = null;
    if (visibility.condition && visibility.flatCheckDC !== null) {
      flatCheck = rollVisibilityFlatCheck(
        opts,
        visibility.flatCheckDC,
        visibility.condition,
      );

      if (!flatCheck.passed) {
        attacker.spendActions(1);
        attacker.attacksThisTurn = Number.isInteger(attacker.attacksThisTurn)
          ? attacker.attacksThisTurn + 1
          : 1;
        if (ranged && weaponProfile.reload > 0) {
          attacker.isLoaded = false;
        }

        const reveal = resolveHostileReveal(attacker);
        return {
          ok: true,
          automaticMiss: true,
          revealed: reveal.revealed,
          revealedConditions: reveal.revealedConditions,
          visibilityAfter: reveal.visibilityAfter,
          attackerId: attacker.id,
          targetId: target.id,
          flatCheck: flatCheck,
          visibility: visibility,
          hiddenAttacker: hiddenAttacker,
          ranged: ranged,
          rangeIncrement: weaponProfile.rangeIncrement,
          reload: weaponProfile.reload,
          volley: weaponProfile.volley,
          rangePenalty: evaluation.rangePenalty,
          volleyPenalty: evaluation.volleyPenalty,
          isLoaded: attacker.isLoaded,
          disrupted: false,
          reactionStrikes: reactionPhase.reactions,
          attackRoll: null,
          attackBonus: attackBonus,
          baseAttackBonus: attackBonus,
          attackModifier: null,
          mapPenalty: mapPenalty,
          multipleAttackPenalty: mapPenalty,
          total: null,
          attackTotal: null,
          dc: null,
          targetAC: null,
          targetACBase: targetAC,
          degree: null,
          hit: false,
          isHit: false,
          critical: false,
          isCritical: false,
          damage: null,
          iwr: null,
          damageDealt: 0,
          damageAmount: 0,
          damageTotal: 0,
          hpDamage: 0,
          hpBefore: null,
          hpAfter: null,
          targetMaxHP: Number.isInteger(target.maxHP) ? target.maxHP : null,
          targetDefeated: target.isDefeated === true,
          attacksThisTurn: attacker.attacksThisTurn,
          actionsLeft: attacker.actionsRemaining,
        };
      }
    }

    // Resolve both sides through the single modifier pipeline. The attack
    // bonus and base AC are base values; conditions, MAP, flanking, cover, and
    // the Off-Guard penalty from a Hidden attacker are typed modifiers.
    const attackModifiers = collectAttackModifiers(attacker, mapPenalty);
    if (evaluation.rangePenalty < 0) {
      attackModifiers.push({
        name: "Range Increment Penalty",
        type: Modifiers.MODIFIER_TYPES.UNTYPED,
        value: evaluation.rangePenalty,
        source: "range-increment",
      });
    }
    if (evaluation.volleyPenalty < 0) {
      attackModifiers.push({
        name: "Volley Penalty",
        type: Modifiers.MODIFIER_TYPES.UNTYPED,
        value: evaluation.volleyPenalty,
        source: "volley",
      });
    }
    const attackResolution = Modifiers.resolveModifiers(attackBonus, attackModifiers);
    const defenseModifiers = collectDefenseModifiers(
      target,
      flanked,
      cover,
      hiddenAttacker,
    );
    const defenseResolution = Modifiers.resolveModifiers(targetAC, defenseModifiers);

    // Roll only after every validation passed, so invalid attempts consume no
    // randomness, no action, and no MAP increment.
    const d20 = rollAttack(opts);
    const check = Checks.evaluateCheck({
      d20: d20,
      modifier: attackResolution.total,
      dc: defenseResolution.total,
    });

    const hit =
      check.degree === Checks.DEGREES.SUCCESS ||
      check.degree === Checks.DEGREES.CRITICAL_SUCCESS;
    const critical = check.degree === Checks.DEGREES.CRITICAL_SUCCESS;

    let damage = null;
    if (hit) {
      if (typeof target.takeDamage !== "function") {
        throw new TypeError("Strike target must implement takeDamage(amount).");
      }
      damage = WeaponTraits.calculateWeaponDamage({
        weapon: weaponSpec,
        degree: check.degree,
        isOffGuard: offGuard,
        rollDamageDie: resolveDamageDie(opts),
      });
    }

    attacker.spendActions(1);
    attacker.attacksThisTurn = Number.isInteger(attacker.attacksThisTurn)
      ? attacker.attacksThisTurn + 1
      : 1;

    // A fired weapon with a reload cost is discharged. Reload 0 weapons
    // (bows, thrown weapons) remain ready.
    if (ranged && weaponProfile.reload > 0) {
      attacker.isLoaded = false;
    }

    let hpBefore = null;
    let hpAfter = null;
    let targetDefeated = target.isDefeated === true;
    let damageDealt = 0;
    let hpDamage = 0;
    let iwr = null;

    if (hit) {
      hpBefore = Number.isInteger(target.currentHP) ? target.currentHP : null;
      const applied = target.takeDamage(damage.total, {
        type: damage.type,
      });
      iwr = applied.iwr || null;
      damageDealt =
        applied.damageApplied === undefined
          ? damage.total
          : applied.damageApplied;
      hpDamage = applied.damageTaken;
      hpAfter = applied.currentHP;
      targetDefeated = applied.isDefeated;
    }

    // The hostile action resolved, so any Hidden/Undetected state ends now.
    // The attack above still used the hidden-attacker Off-Guard benefit.
    const reveal = resolveHostileReveal(attacker);

    return {
      ok: true,
      revealed: reveal.revealed,
      revealedConditions: reveal.revealedConditions,
      visibilityAfter: reveal.visibilityAfter,
      attackerId: attacker.id,
      targetId: target.id,
      distanceFeet: evaluation.distanceFeet,
      reachDistanceFeet: evaluation.reachDistanceFeet,
      reachFeet: evaluation.reachFeet,
      ranged: ranged,
      rangeIncrement: weaponProfile.rangeIncrement,
      reload: weaponProfile.reload,
      volley: weaponProfile.volley,
      rangePenalty: evaluation.rangePenalty,
      volleyPenalty: evaluation.volleyPenalty,
      rangeIncrementIndex: evaluation.rangeIncrementIndex,
      maxRangeFeet: evaluation.maxRangeFeet,
      isLoaded: attacker.isLoaded,
      disrupted: false,
      reactionStrikes: reactionPhase.reactions,
      flatCheck: flatCheck,
      visibility: visibility,
      hiddenAttacker: hiddenAttacker,
      attackRoll: d20,
      attackBonus: attackBonus,
      baseAttackBonus: attackBonus,
      attackModifier: attackResolution.total,
      attackModifiers: attackResolution.effectiveModifiers,
      attackBreakdown: attackResolution.breakdown,
      mapPenalty: mapPenalty,
      multipleAttackPenalty: mapPenalty,
      total: check.total,
      attackTotal: check.total,
      dc: defenseResolution.total,
      targetAC: defenseResolution.total,
      targetACTotal: defenseResolution.total,
      targetACBase: targetAC,
      baseTargetAC: targetAC,
      targetACModifiers: defenseResolution.effectiveModifiers,
      defenseModifiers: defenseResolution.effectiveModifiers,
      targetACSuppressedModifiers: defenseResolution.suppressedModifiers,
      suppressedACModifiers: defenseResolution.suppressedModifiers,
      targetACBreakdown: defenseResolution.breakdown,
      defenseBreakdown: defenseResolution.breakdown,
      cover: cover,
      coverDegree: cover ? cover.degree : Cover.COVER_DEGREES.NONE,
      coverBonus: cover ? cover.acBonus : 0,
      coverRays: cover ? cover.rays : [],
      blockedRaysCount: cover ? cover.blockedRaysCount : 0,
      flanked: flanked,
      flankers: evaluation.flankers || [],
      offGuard: offGuard,
      degree: check.degree,
      isNatural20: check.isNatural20,
      isNatural1: check.isNatural1,
      hit: hit,
      isHit: hit,
      critical: critical,
      isCritical: critical,
      attack: {
        d20: check.d20,
        attackBonus: attackBonus,
        baseAttackBonus: attackBonus,
        attackModifier: attackResolution.total,
        modifiers: attackResolution.effectiveModifiers,
        breakdown: attackResolution.breakdown,
        mapPenalty: mapPenalty,
        modifier: check.modifier,
        total: check.total,
        dc: check.dc,
        degree: check.degree,
        isNatural20: check.isNatural20,
        isNatural1: check.isNatural1,
      },
      damage: damage,
      iwr: iwr,
      damageDealt: damageDealt,
      damageAmount: damageDealt,
      damageTotal: damageDealt,
      hpDamage: hpDamage,
      hpBefore: hpBefore,
      hpAfter: hpAfter,
      targetMaxHP: Number.isInteger(target.maxHP) ? target.maxHP : null,
      targetDefeated: targetDefeated,
      attacksThisTurn: attacker.attacksThisTurn,
      actionsLeft: attacker.actionsRemaining,
    };
  }

  return Object.freeze({
    STRIKE_REASONS: STRIKE_REASONS,
    DEFAULT_REACH_FEET: DEFAULT_REACH_FEET,
    DEFAULT_AC: DEFAULT_AC,
    DEFAULT_ATTACK_BONUS: DEFAULT_ATTACK_BONUS,
    DEFAULT_DAMAGE: DEFAULT_DAMAGE,
    evaluateStrike: evaluateStrike,
    performStrike: performStrike,
    // Shared with Reactive Strike so both attacks use the exact same
    // modifier collection and d20 handling. These do not spend actions.
    collectAttackModifiers: collectAttackModifiers,
    collectDefenseModifiers: collectDefenseModifiers,
    rollAttack: rollAttack,
    rollVisibilityFlatCheck: rollVisibilityFlatCheck,
    resolveDamageDie: resolveDamageDie,
    resolveHostileReveal: resolveHostileReveal,
    resolveReachFeet: resolveReachFeet,
    // Shared with Reactive Strike so both attacks resolve the same typed
    // damage contract and weapon traits.
    normalizeDamageSpec: normalizeDamageSpec,
    normalizeWeaponSpec: normalizeWeaponSpec,
  });
});
