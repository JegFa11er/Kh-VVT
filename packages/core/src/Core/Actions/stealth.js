/**
 * PF2E REMASTERED — STEALTH ACTIONS (HEADLESS CORE)
 *
 * Implements the Phase 17 stealth slice:
 *
 *   - Seek  (1 action, concentrate/secret): 30-ft cone or 15-ft burst,
 *            Perception vs each hidden/undetected target's Stealth DC.
 *   - Hide  (1 action, secret): requires cover or concealment, Stealth vs the
 *            highest Perception DC among observers able to see the hider.
 *   - Sneak (1 action, move/secret): requires Hidden/Undetected, moves at most
 *            half Speed, Stealth vs the observers' Perception DCs.
 *   - Point Out (1 action, auditory/visual/manipulate): turns an Undetected
 *            target into Hidden for the allies.
 *
 * All dice are injectable (`d20` or `rollD20`) so the Core stays deterministic
 * under seeded play. This module never touches View/HTML state.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Rules/checks.js"),
      require("../Rules/modifiers.js"),
      require("../Entities/conditions.js"),
      require("../Grid/cover.js"),
      require("../Grid/aoe.js"),
      require("../Grid/pathfinding.js"),
      require("../Grid/occupancy.js"),
      require("../Grid/illumination.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.Stealth = factory(
      root.PF2e.Core.Rules.Checks,
      root.PF2e.Core.Rules.Modifiers,
      root.PF2e.Core.Conditions,
      root.PF2e.Core.Cover,
      root.PF2e.Core.Grid.AoE,
      root.PF2e.Core.Pathfinding,
      root.PF2e.Core.Occupancy,
      root.PF2e.Core.Grid.Illumination,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Checks,
  Modifiers,
  Conditions,
  Cover,
  AoE,
  Pathfinding,
  Occupancy,
  Illumination,
) {
  "use strict";

  const ACTION_COST = 1;

  const TRAITS = Object.freeze({
    SEEK: Object.freeze(["concentrate", "secret"]),
    HIDE: Object.freeze(["secret"]),
    SNEAK: Object.freeze(["move", "secret"]),
    POINT_OUT: Object.freeze(["auditory", "visual", "manipulate"]),
  });

  const REASONS = Object.freeze({
    NO_ACTIONS: "no-actions",
    CANNOT_ACT: "cannot-act",
    NO_OBSERVERS: "no-observers",
    NO_COVER_OR_CONCEALMENT: "no-cover-or-concealment",
    NOT_HIDDEN: "not-hidden",
    NOT_UNDETECTED: "target-not-undetected",
    EXCEEDS_SNEAK_SPEED: "exceeds-sneak-speed",
    ALREADY_THERE: "already-there",
    OUT_OF_BOUNDS: "out-of-bounds",
    BLOCKED_DESTINATION: "blocked-destination",
    UNREACHABLE: "unreachable",
    MISSING_DIRECTION: "missing-direction",
    INVALID_DESTINATION: "invalid-destination",
    RESTRAINED_ACTION_BLOCKED: "restrained-action-blocked",
    GRABBED_MANIPULATE_FAILED: "grabbed-manipulate-failed",
  });

  const VISIBILITY_CONDITIONS = Object.freeze([
    "concealed",
    "hidden",
    "undetected",
  ]);

  const DOT = Checks.DEGREES;

  function assertActor(actor, label) {
    if (
      actor === null ||
      typeof actor !== "object" ||
      typeof actor.canSpendActions !== "function" ||
      typeof actor.spendActions !== "function"
    ) {
      throw new TypeError(label + " must be a Combatant instance.");
    }
  }

  function assertMap(map) {
    if (
      map === null ||
      typeof map !== "object" ||
      typeof map.isBlocked !== "function"
    ) {
      throw new TypeError("map must be a GridMap.");
    }
  }

  function assertCell(cell, label) {
    if (
      cell === null ||
      typeof cell !== "object" ||
      !Number.isInteger(cell.x) ||
      !Number.isInteger(cell.y)
    ) {
      throw new TypeError(label + " must be a cell object with integer x and y.");
    }
  }

  function isAble(unit) {
    return (
      unit !== null &&
      typeof unit === "object" &&
      unit.isDefeated !== true &&
      unit.currentHP !== 0
    );
  }

  function normalizeObservers(observers, self) {
    if (observers === undefined || observers === null) {
      return [];
    }
    if (!Array.isArray(observers)) {
      throw new TypeError("observers must be an array of combatants.");
    }
    return observers.filter(function (observer) {
      return isAble(observer) && observer !== self;
    });
  }

  /**
   * Spend-action gate shared by every action in the slice.
   *
   * @param {object} actor
   * @returns {{ok:boolean,reason?:string}}
   */
  function actionGate(actor, options) {
    if (typeof actor.canAct === "function") {
      const gate = actor.canAct(options);
      if (gate === null || typeof gate !== "object" || gate.ok !== true) {
        return {
          ok: false,
          reason: gate && gate.reason ? gate.reason : REASONS.CANNOT_ACT,
        };
      }
    }
    if (!actor.canSpendActions(ACTION_COST)) {
      return { ok: false, reason: REASONS.NO_ACTIONS };
    }
    return { ok: true };
  }

  /**
   * Resolve one d20, preferring an explicit authored value, then an injected
   * callback, then the browser random fallback.
   *
   * @param {object} options
   * @returns {number}
   */
  function resolveD20(options) {
    const opts = options || {};
    let value;
    if (opts.d20 !== undefined) {
      value = opts.d20;
    } else if (typeof opts.rollD20 === "function") {
      value = opts.rollD20();
    } else if (typeof opts.rollDie === "function") {
      value = opts.rollDie(20);
    } else {
      value = 1 + Math.floor(Math.random() * 20);
    }
    if (!Number.isInteger(value) || value < 1 || value > 20) {
      throw new RangeError("d20 must be an integer from 1 to 20.");
    }
    return value;
  }

  /**
   * A skill modifier through the central typed modifier resolver.
   *
   * @param {object} actor
   * @param {string} skill
   * @returns {{base:number,modifiers:object[],total:number,breakdown:object}}
   */
  function resolveSkillTotal(actor, skill) {
    if (
      typeof actor.getSkillModifier !== "function" ||
      typeof actor.getSkillModifiers !== "function"
    ) {
      throw new TypeError("A combatant must expose skill modifiers.");
    }
    const base = actor.getSkillModifier(skill);
    const modifiers = actor.getSkillModifiers(skill);
    const resolved = Modifiers.resolveModifiers(base, modifiers);
    return {
      base: base,
      modifiers: modifiers,
      total: resolved.total,
      breakdown: resolved.breakdown,
    };
  }

  /**
   * Defended DC for one of a creature's skills (`10 + modifier + mods`).
   *
   * @param {object} unit
   * @param {string} skill
   * @returns {number}
   */
  function getSkillDC(unit, skill) {
    return Checks.calculateDC(
      unit.getSkillModifier(skill),
      unit.getSkillModifiers(skill),
    );
  }

  /**
   * @param {object[]} observers
   * @returns {{observer:object,observerId:string,observerName:string,dc:number}[]}
   */
  function getPerceptionRecords(observers) {
    return observers.map(function (observer) {
      return {
        observer: observer,
        observerId: observer.id,
        observerName: observer.name,
        dc: getSkillDC(observer, "perception"),
      };
    });
  }

  /**
   * Highest Perception DC, with stable roster order as the tie-breaker.
   *
   * @param {object[]} observers
   * @returns {{observer:object,observerId:string,observerName:string,dc:number}|null}
   */
  function highestPerceptionDC(observers) {
    let best = null;
    for (const record of getPerceptionRecords(observers)) {
      if (best === null || record.dc > best.dc) {
        best = record;
      }
    }
    return best;
  }

  /**
   * Current resolved visibility state of a creature.
   *
   * @param {object} combatant
   * @returns {"observed"|"concealed"|"hidden"|"undetected"}
   */
  function visibilityOf(combatant) {
    const visibility = Conditions.getVisibility(combatant);
    return visibility.condition === null ? "observed" : visibility.condition;
  }

  /**
   * Replace every visibility condition with the requested state.
   *
   * @param {object} combatant
   * @param {"observed"|"concealed"|"hidden"|"undetected"} visibility
   * @returns {object}
   */
  function setVisibility(combatant, visibility) {
    for (const slug of VISIBILITY_CONDITIONS) {
      combatant.removeCondition(slug);
    }
    if (visibility !== "observed") {
      combatant.addCondition(visibility);
    }
    return combatant;
  }

  /**
   * Evaluate cover and light-based concealment for a creature at its current
   * position. Hidden/undetected conditions are ignored so this answers the
   * physical question "does this square provide cover or concealment?".
   *
   * @param {object} actor
   * @param {object[]} observers
   * @param {object} map
   * @param {object[]} roster
   * @returns {{cover:object|null,hasCover:boolean,hasConcealment:boolean,ok:boolean}}
   */
  function evaluateConcealment(actor, observers, map, roster) {
    let bestCover = null;
    let hasCover = false;
    let hasConcealment =
      typeof actor.hasCondition === "function" && actor.hasCondition("concealed");

    for (const observer of observers) {
      if (map !== undefined && map !== null) {
        const cover = Cover.determineCover(observer, actor, map, roster);
        if (bestCover === null || cover.acBonus > bestCover.acBonus) {
          bestCover = cover;
        }
        if (Cover.isStandardOrGreater(cover)) {
          hasCover = true;
        }
      }

      const perceived = Illumination.getPerceivedVisibility(
        observer,
        actor,
        map,
        { ignoreConditions: true },
      );
      if (perceived.visibility !== "observed") {
        hasConcealment = true;
      }
    }

    return {
      cover: bestCover,
      hasCover: hasCover,
      hasConcealment: hasConcealment,
      ok: hasCover || hasConcealment,
    };
  }

  function observerHasLineOfSight(observer, actor, map, roster) {
    if (map === undefined || map === null) {
      return true;
    }
    const cover = Cover.determineCover(observer, actor, map, roster);
    return cover.lineOfSight !== false;
  }

  function normalizeAreaType(value) {
    if (value === undefined || value === null) {
      return "burst";
    }
    if (typeof value !== "string") {
      throw new TypeError("areaType must be \"cone\" or \"burst\".");
    }
    const areaType = value.trim().toLowerCase();
    if (areaType !== "cone" && areaType !== "burst") {
      throw new RangeError('areaType must be "cone" or "burst".');
    }
    return areaType;
  }

  function normalizeRadius(radiusFeet, areaType) {
    const value =
      radiusFeet === undefined ? (areaType === "cone" ? 30 : 15) : radiusFeet;
    if (!Number.isInteger(value) || value <= 0 || value % 5 !== 0) {
      throw new RangeError("radiusFeet must be a positive multiple of 5.");
    }
    return value;
  }

  /**
   * Seek — 1 action, concentrate/secret.
   *
   * One Perception check is compared against the Stealth DC of every hidden or
   * undetected creature inside the area:
   *   - critical success: the target becomes observed;
   *   - success: undetected becomes hidden, hidden stays hidden;
   *   - failure / critical failure: no change.
   *
   * @param {{
   *   seeker: object,
   *   areaType?: "cone"|"burst",
   *   origin?: {x:number,y:number},
   *   direction?: string|{x?:number,y?:number},
   *   radiusFeet?: number,
   *   combatants?: object[],
   *   map?: object,
   *   d20?: number,
   *   rollD20?: () => number,
   *   rollDie?: (sides:number) => number
   * }} options
   * @returns {object}
   */
  function performSeek(options) {
    const opts = options || {};
    const seeker = opts.seeker;
    assertActor(seeker, "seeker");

    const gate = actionGate(seeker);
    if (!gate.ok) {
      return { ok: false, reason: gate.reason };
    }

    const areaType = normalizeAreaType(opts.areaType);
    const radiusFeet = normalizeRadius(opts.radiusFeet, areaType);
    const origin =
      opts.origin === undefined
        ? { x: seeker.x, y: seeker.y }
        : { x: opts.origin.x, y: opts.origin.y };
    assertCell(origin, "origin");

    let cells;
    if (areaType === "cone") {
      if (opts.direction === undefined || opts.direction === null) {
        return { ok: false, reason: REASONS.MISSING_DIRECTION };
      }
      cells = AoE.getConeCells(origin, opts.direction, radiusFeet, opts.map);
    } else {
      cells = AoE.getBurstCells(origin, radiusFeet, opts.map);
    }

    const roster = Array.isArray(opts.combatants) ? opts.combatants : [];
    const inArea = AoE.getTargetsInArea(cells, roster).filter(function (target) {
      return target !== seeker && target.id !== seeker.id;
    });
    const candidates = inArea.filter(function (target) {
      return (
        target.hasCondition("hidden") || target.hasCondition("undetected")
      );
    });

    const perception = resolveSkillTotal(seeker, "perception");
    let check = null;
    let d20 = null;
    if (candidates.length > 0) {
      d20 = resolveD20(opts);
      check = {
        d20: d20,
        modifier: perception.total,
        total: d20 + perception.total,
        base: perception.base,
        modifiers: perception.modifiers,
      };
    }

    // The action is spent once the area is legal, even when it finds nothing.
    seeker.spendActions(ACTION_COST);

    const targets = [];
    if (check !== null) {
      for (const target of candidates) {
        const stealthDC = getSkillDC(target, "stealth");
        const evaluation = Checks.evaluateCheck({
          d20: d20,
          modifier: perception.total,
          dc: stealthDC,
        });
        const previousVisibility = visibilityOf(target);
        let visibility = previousVisibility;
        let changed = false;

        if (evaluation.degree === DOT.CRITICAL_SUCCESS) {
          if (previousVisibility !== "observed") {
            setVisibility(target, "observed");
            visibility = "observed";
            changed = true;
          }
        } else if (evaluation.degree === DOT.SUCCESS) {
          if (previousVisibility === "undetected") {
            setVisibility(target, "hidden");
            visibility = "hidden";
            changed = true;
          }
        }

        targets.push({
          targetId: target.id,
          targetName: target.name,
          stealthDC: stealthDC,
          previousVisibility: previousVisibility,
          visibility: visibility,
          degree: evaluation.degree,
          check: evaluation,
          changed: changed,
        });
      }
    }

    return {
      ok: true,
      actionType: "seek",
      actionCost: ACTION_COST,
      traits: TRAITS.SEEK.slice(),
      actionsLeft: seeker.actionsRemaining,
      areaType: areaType,
      radiusFeet: radiusFeet,
      origin: origin,
      cells: cells,
      check: check,
      targets: targets,
      revealed: targets
        .filter(function (entry) {
          return entry.previousVisibility !== "observed" && entry.visibility === "observed";
        })
        .map(function (entry) {
          return entry.targetId;
        }),
      downgraded: targets
        .filter(function (entry) {
          return (
            entry.previousVisibility === "undetected" &&
            entry.visibility === "hidden"
          );
        })
        .map(function (entry) {
          return entry.targetId;
        }),
    };
  }

  /**
   * Hide — 1 action, secret.
   *
   * Requires standard/greater cover from at least one observer, or
   * concealment (dim/darkness relative to an observer, or an explicit
   * Concealed condition). The Stealth check is rolled against the highest
   * Perception DC among observers with line of sight.
   *
   * @param {{
   *   combatant: object,
   *   observers: object[],
   *   map?: object,
   *   combatants?: object[],
   *   d20?: number,
   *   rollD20?: () => number,
   *   rollDie?: (sides:number) => number
   * }} options
   * @returns {object}
   */
  function performHide(options) {
    const opts = options || {};
    const combatant = opts.combatant;
    assertActor(combatant, "combatant");

    const gate = actionGate(combatant);
    if (!gate.ok) {
      return { ok: false, reason: gate.reason };
    }

    const observers = normalizeObservers(opts.observers, combatant);
    if (observers.length === 0) {
      return { ok: false, reason: REASONS.NO_OBSERVERS };
    }

    const roster =
      Array.isArray(opts.combatants) && opts.combatants.length > 0
        ? opts.combatants
        : observers.concat([combatant]);
    const concealment = evaluateConcealment(
      combatant,
      observers,
      opts.map,
      roster,
    );
    if (!concealment.ok) {
      return {
        ok: false,
        reason: REASONS.NO_COVER_OR_CONCEALMENT,
        cover: concealment.cover,
      };
    }

    const visibleObservers = observers.filter(function (observer) {
      return observerHasLineOfSight(observer, combatant, opts.map, roster);
    });
    if (visibleObservers.length === 0) {
      return { ok: false, reason: REASONS.NO_OBSERVERS };
    }

    const perception = highestPerceptionDC(visibleObservers);
    const d20 = resolveD20(opts);
    const stealth = resolveSkillTotal(combatant, "stealth");
    const check = Checks.evaluateCheck({
      d20: d20,
      modifier: stealth.total,
      dc: perception.dc,
    });

    combatant.spendActions(ACTION_COST);

    const succeeded =
      check.degree === DOT.SUCCESS || check.degree === DOT.CRITICAL_SUCCESS;
    const previousVisibility = visibilityOf(combatant);
    let visibility;
    if (succeeded) {
      setVisibility(combatant, "hidden");
      visibility = "hidden";
    } else {
      setVisibility(combatant, "observed");
      visibility = "observed";
    }

    return {
      ok: true,
      actionType: "hide",
      actionCost: ACTION_COST,
      traits: TRAITS.HIDE.slice(),
      actionsLeft: combatant.actionsRemaining,
      succeeded: succeeded,
      check: check,
      stealth: stealth,
      perceptionDC: perception.dc,
      perception: {
        observerId: perception.observerId,
        observerName: perception.observerName,
        dc: perception.dc,
      },
      requirement: concealment.hasCover ? "cover" : "concealment",
      cover: concealment.cover,
      hiddenBefore: previousVisibility === "hidden",
      previousVisibility: previousVisibility,
      visibility: visibility,
      condition: visibility === "hidden" ? "hidden" : null,
    };
  }

  /**
   * Sneak — 1 action, move/secret.
   *
   * The creature must already be hidden or undetected and may move at most
   * `Math.floor(Speed / 10) * 5` feet (half Speed rounded down to a square).
   *
   * @param {{
   *   combatant: object,
   *   destination: {x:number,y:number},
   *   observers?: object[],
   *   map: object,
   *   combatants?: object[],
   *   d20?: number,
   *   rollD20?: () => number,
   *   rollDie?: (sides:number) => number
   * }} options
   * @returns {object}
   */
  function performSneak(options) {
    const opts = options || {};
    const combatant = opts.combatant;
    const destination = opts.destination;
    assertActor(combatant, "combatant");
    assertMap(opts.map);

    const gate = actionGate(combatant);
    if (!gate.ok) {
      return { ok: false, reason: gate.reason };
    }

    const previousVisibility = visibilityOf(combatant);
    if (
      !combatant.hasCondition("hidden") &&
      !combatant.hasCondition("undetected")
    ) {
      return {
        ok: false,
        reason: REASONS.NOT_HIDDEN,
        visibility: previousVisibility,
      };
    }

    assertCell(destination, "destination");
    if (destination.x === combatant.x && destination.y === combatant.y) {
      return { ok: false, reason: REASONS.ALREADY_THERE };
    }

    const observers = normalizeObservers(opts.observers, combatant);
    const roster =
      Array.isArray(opts.combatants) && opts.combatants.length > 0
        ? opts.combatants
        : observers.concat([combatant]);
    const occupancy = Occupancy.buildOccupancy(roster, combatant);

    const pathResult = Pathfinding.findPath(
      { x: combatant.x, y: combatant.y },
      destination,
      {
        map: opts.map,
        startDiagonalParity:
          Number.isInteger(combatant.diagonalStepsThisTurn)
            ? combatant.diagonalStepsThisTurn % 2
            : 0,
        occupancy: occupancy,
        footprint:
          typeof combatant.getFootprint === "function"
            ? combatant.getFootprint()
            : 1,
      },
    );

    if (pathResult.found !== true) {
      return {
        ok: false,
        reason:
          pathResult.reason === "blocked-goal"
            ? REASONS.BLOCKED_DESTINATION
            : pathResult.reason === "out-of-bounds"
              ? REASONS.OUT_OF_BOUNDS
              : REASONS.UNREACHABLE,
        pathfinding: pathResult,
      };
    }

    const speedFeet =
      Number.isInteger(combatant.speed) ? combatant.speed : combatant.speedFeet;
    const maxFeet = Math.floor(speedFeet / 10) * 5;
    if (pathResult.costFeet > maxFeet) {
      return {
        ok: false,
        reason: REASONS.EXCEEDS_SNEAK_SPEED,
        costFeet: pathResult.costFeet,
        maxFeet: maxFeet,
      };
    }

    let check = null;
    let degree = DOT.SUCCESS;
    let perception = null;
    if (observers.length > 0) {
      perception = highestPerceptionDC(observers);
      const d20 = resolveD20(opts);
      const stealth = resolveSkillTotal(combatant, "stealth");
      check = Checks.evaluateCheck({
        d20: d20,
        modifier: stealth.total,
        dc: perception.dc,
      });
      check.stealth = stealth;
      degree = check.degree;
    }

    combatant.spendActions(ACTION_COST);

    // Critical failure: spotted where the creature started. It never moves.
    if (degree === DOT.CRITICAL_FAILURE) {
      setVisibility(combatant, "observed");
      return {
        ok: true,
        actionType: "sneak",
        actionCost: ACTION_COST,
        traits: TRAITS.SNEAK.slice(),
        actionsLeft: combatant.actionsRemaining,
        succeeded: false,
        degree: degree,
        check: check,
        perceptionDC: perception === null ? null : perception.dc,
        perception: perception === null ? null : {
          observerId: perception.observerId,
          observerName: perception.observerName,
          dc: perception.dc,
        },
        previousVisibility: previousVisibility,
        visibility: "observed",
        moved: false,
        keptHidden: false,
        stoppedAt: { x: combatant.x, y: combatant.y },
        path: pathResult.path,
        costFeet: pathResult.costFeet,
        maxFeet: maxFeet,
        destination: { x: destination.x, y: destination.y },
      };
    }

    // Move along the validated path. The secret check has already been made,
    // so the movement itself is unconditional from here.
    combatant.setPosition(destination.x, destination.y);
    if (typeof combatant.registerDiagonalSteps === "function") {
      combatant.registerDiagonalSteps(pathResult.diagonalSteps);
    }
    if (typeof combatant.removeCondition === "function") {
      combatant.removeCondition("greater-cover");
    }

    let visibility;
    let keptHidden = false;
    if (degree === DOT.FAILURE) {
      setVisibility(combatant, "observed");
      visibility = "observed";
    } else if (observers.length === 0) {
      // Nobody is watching: retain the existing stealth state.
      visibility = previousVisibility;
      if (previousVisibility === "observed") {
        setVisibility(combatant, "hidden");
        visibility = "hidden";
      }
      keptHidden = visibility === "hidden" || visibility === "undetected";
    } else {
      const atDestination = evaluateConcealment(
        combatant,
        observers,
        opts.map,
        roster,
      );
      if (atDestination.ok) {
        setVisibility(combatant, "hidden");
        visibility = "hidden";
        keptHidden = true;
      } else {
        setVisibility(combatant, "observed");
        visibility = "observed";
      }
    }

    return {
      ok: true,
      actionType: "sneak",
      actionCost: ACTION_COST,
      traits: TRAITS.SNEAK.slice(),
      actionsLeft: combatant.actionsRemaining,
      succeeded: degree === DOT.SUCCESS || degree === DOT.CRITICAL_SUCCESS,
      degree: degree,
      check: check,
      perceptionDC: perception === null ? null : perception.dc,
      perception: perception === null ? null : {
        observerId: perception.observerId,
        observerName: perception.observerName,
        dc: perception.dc,
      },
      previousVisibility: previousVisibility,
      visibility: visibility,
      moved: true,
      keptHidden: keptHidden,
      path: pathResult.path,
      costFeet: pathResult.costFeet,
      maxFeet: maxFeet,
      destination: { x: destination.x, y: destination.y },
      position: { x: combatant.x, y: combatant.y },
    };
  }

  /**
   * Point Out — 1 action, auditory/visual/manipulate.
   *
   * The target must currently be undetected. Pointing it out reveals the
   * square, so the target becomes hidden (still requiring a DC 11 flat check)
   * instead of undetected.
   *
   * @param {{
   *   combatant: object,
   *   target: object,
   *   allies?: object[]
   * }} options
   * @returns {object}
   */
  function performPointOut(options) {
    const opts = options || {};
    const combatant = opts.combatant;
    const target = opts.target;
    assertActor(combatant, "combatant");

    if (target === null || typeof target !== "object") {
      throw new TypeError("target must be a Combatant instance.");
    }

    const gate = actionGate(combatant, {
      traits: TRAITS.POINT_OUT,
      action: "point-out",
    });
    if (!gate.ok) {
      return { ok: false, reason: gate.reason };
    }

    // Point Out is a manipulate action. Grabbed forces the DC 5 flat check; a
    // failure spends the action but does not reveal the target.
    if (typeof combatant.resolveGrabbedManipulate === "function") {
      const grabCheck = combatant.resolveGrabbedManipulate({
        traits: TRAITS.POINT_OUT,
        d20: opts.d20,
        rollFlatCheck: opts.rollFlatCheck,
        rollD20: opts.rollD20,
        rollDie: opts.rollDie,
      });
      if (grabCheck.required && !grabCheck.passed) {
        combatant.spendActions(ACTION_COST);
        return {
          ok: false,
          reason: REASONS.GRABBED_MANIPULATE_FAILED,
          flatCheck: grabCheck.flatCheck,
          actionsLeft: combatant.actionsRemaining,
        };
      }
    }

    if (!target.hasCondition("undetected")) {
      return {
        ok: false,
        reason: REASONS.NOT_UNDETECTED,
        visibility: visibilityOf(target),
      };
    }

    const allies = Array.isArray(opts.allies)
      ? opts.allies.filter(function (ally) {
          return isAble(ally) && ally !== combatant;
        })
      : [];

    const previousVisibility = visibilityOf(target);
    combatant.spendActions(ACTION_COST);
    setVisibility(target, "hidden");

    return {
      ok: true,
      actionType: "point-out",
      actionCost: ACTION_COST,
      traits: TRAITS.POINT_OUT.slice(),
      actionsLeft: combatant.actionsRemaining,
      targetId: target.id,
      targetName: target.name,
      previousVisibility: previousVisibility,
      visibility: "hidden",
      condition: "hidden",
      allies: allies.map(function (ally) {
        return {
          id: ally.id,
          name: ally.name,
          awareness: "hidden",
        };
      }),
    };
  }

  return Object.freeze({
    ACTION_COST: ACTION_COST,
    TRAITS: TRAITS,
    REASONS: REASONS,
    resolveD20: resolveD20,
    resolveSkillTotal: resolveSkillTotal,
    getSkillDC: getSkillDC,
    getPerceptionRecords: getPerceptionRecords,
    highestPerceptionDC: highestPerceptionDC,
    visibilityOf: visibilityOf,
    setVisibility: setVisibility,
    evaluateConcealment: evaluateConcealment,
    performSeek: performSeek,
    performHide: performHide,
    performSneak: performSneak,
    performPointOut: performPointOut,
  });
});
