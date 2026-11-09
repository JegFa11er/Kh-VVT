/**
 * PF2E REMASTERED — ILLUMINATION, SENSES & PERCEIVED VISIBILITY (HEADLESS CORE)
 *
 * Pure rules module. It reads a GridMap's sparse light levels and a
 * combatant's senses, then resolves how well one creature perceives another:
 *
 *   - bright light: observed;
 *   - dim light: concealed (DC 5 flat check) unless the observer has
 *     low-light vision or darkvision;
 *   - darkness: hidden (DC 11 flat check) when the target is noisy, or
 *     undetected when the target is silent; darkvision sees through darkness.
 *
 * Explicit visibility conditions are preserved because they represent effects
 * other than light (invisibility, cover, fog). `{ ignoreConditions: true }`
 * asks for the raw light/sense result, which the stealth actions use when they
 * evaluate whether a square offers concealment.
 *
 * No rendering or input code lives here.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Grid = root.PF2e.Core.Grid || {};
    root.PF2e.Core.Grid.Illumination = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ILLUMINATION_LEVELS = Object.freeze({
    BRIGHT: "bright",
    DIM: "dim",
    DARKNESS: "darkness",
  });

  const VISIBILITY = Object.freeze({
    OBSERVED: "observed",
    CONCEALED: "concealed",
    HIDDEN: "hidden",
    UNDETECTED: "undetected",
  });

  const VISIBILITY_RANK = Object.freeze({
    observed: 0,
    concealed: 1,
    hidden: 2,
    undetected: 3,
  });

  const FLAT_CHECK_DC = Object.freeze({
    observed: null,
    concealed: 5,
    hidden: 11,
    undetected: null,
  });

  const LIGHT_RANK = Object.freeze({
    bright: 0,
    dim: 1,
    darkness: 2,
  });

  function canonicalSenseName(value) {
    if (typeof value !== "string") {
      return "";
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
   * Duck-typed sense lookup. Combatant instances expose `hasSense`; plain
   * fixtures with a `senses` array are supported as well.
   *
   * @param {object} unit
   * @param {string} name
   * @returns {boolean}
   */
  function hasSense(unit, name) {
    if (unit === null || typeof unit !== "object") {
      return false;
    }
    if (typeof unit.hasSense === "function") {
      return unit.hasSense(name) === true;
    }
    if (!Array.isArray(unit.senses)) {
      return false;
    }
    const query = canonicalSenseName(name);
    return unit.senses.some(function (entry) {
      const stored = canonicalSenseName(
        typeof entry === "string" ? entry : entry && (entry.type || entry.name || entry.sense),
      );
      if (stored === query) {
        return true;
      }
      return !/\d/.test(query) && stored.indexOf(query + "-") === 0;
    });
  }

  function hasLowLightVision(unit) {
    return hasSense(unit, "low-light-vision");
  }

  function hasDarkvision(unit) {
    return hasSense(unit, "darkvision");
  }

  function occupiedCellsOf(unit) {
    if (unit !== null && typeof unit === "object") {
      if (typeof unit.getOccupiedCells === "function") {
        return unit.getOccupiedCells();
      }
      if (Number.isInteger(unit.x) && Number.isInteger(unit.y)) {
        return [{ x: unit.x, y: unit.y }];
      }
    }
    return [];
  }

  function normalizeLevel(value) {
    if (typeof value !== "string") {
      return ILLUMINATION_LEVELS.BRIGHT;
    }
    const level = value.trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(LIGHT_RANK, level)
      ? level
      : ILLUMINATION_LEVELS.BRIGHT;
  }

  /**
   * Read a cell's light level from a GridMap. A map without illumination
   * support is treated as fully bright, which keeps isolated headless fixtures
   * working without terrain data.
   *
   * @param {object} gridMap
   * @param {number} x
   * @param {number} y
   * @returns {"bright"|"dim"|"darkness"}
   */
  function getCellIllumination(gridMap, x, y) {
    if (gridMap === null || gridMap === undefined) {
      return ILLUMINATION_LEVELS.BRIGHT;
    }
    if (typeof gridMap.getIllumination === "function") {
      return normalizeLevel(gridMap.getIllumination(x, y));
    }
    if (gridMap.illumination instanceof Map) {
      return normalizeLevel(gridMap.illumination.get(x + "," + y));
    }
    return ILLUMINATION_LEVELS.BRIGHT;
  }

  /**
   * The most favorable cell of the target's footprint. A Large creature that
   * straddles a dim and a bright square is perceived from the bright square.
   *
   * @param {object} target
   * @param {object} gridMap
   * @returns {{cell:{x:number,y:number}|null, level:string}}
   */
  function getTargetIllumination(target, gridMap) {
    const cells = occupiedCellsOf(target);
    if (cells.length === 0) {
      return { cell: null, level: ILLUMINATION_LEVELS.BRIGHT };
    }

    let bestCell = cells[0];
    let bestLevel = getCellIllumination(gridMap, bestCell.x, bestCell.y);
    for (let index = 1; index < cells.length; index += 1) {
      const level = getCellIllumination(gridMap, cells[index].x, cells[index].y);
      if (LIGHT_RANK[level] < LIGHT_RANK[bestLevel]) {
        bestCell = cells[index];
        bestLevel = level;
      }
    }
    return { cell: { x: bestCell.x, y: bestCell.y }, level: bestLevel };
  }

  function hasCondition(unit, name) {
    if (unit === null || typeof unit !== "object") {
      return false;
    }
    if (typeof unit.hasCondition === "function") {
      return unit.hasCondition(name) === true;
    }
    if (Array.isArray(unit.conditions)) {
      return unit.conditions.some(function (entry) {
        return entry === name || (entry && entry.name === name);
      });
    }
    return false;
  }

  function strongestVisibility(a, b) {
    return VISIBILITY_RANK[a] >= VISIBILITY_RANK[b] ? a : b;
  }

  /**
   * Resolve how `observer` perceives `target` under the current light.
   *
   * Options:
   *   - `ignoreConditions: true` — ignore existing visibility conditions and
   *     return the raw light/sense result (used for concealment checks).
   *   - `silent: true` / `targetNoisy: false` — darkness yields `undetected`
   *     instead of `hidden`.
   *   - `invisible: true` — the target is undetected regardless of light.
   *
   * @param {object} observer
   * @param {object} target
   * @param {object} [gridMap]
   * @param {{ignoreConditions?:boolean,silent?:boolean,targetSilent?:boolean,targetNoisy?:boolean,noise?:boolean,invisible?:boolean}} [options]
   * @returns {{
   *   level: string,
   *   lightLevel: string,
   *   cell: {x:number,y:number}|null,
   *   visibility: string,
   *   condition: string|null,
   *   flatCheckDC: number|null,
   *   targetable: boolean,
   *   observed: boolean,
   *   senses: {lowLightVision:boolean,darkvision:boolean}
   * }}
   */
  function getPerceivedVisibility(observer, target, gridMap, options) {
    if (observer === null || typeof observer !== "object") {
      throw new TypeError("observer must be a positioned combatant.");
    }
    if (target === null || typeof target !== "object") {
      throw new TypeError("target must be a positioned combatant.");
    }

    const opts = options || {};
    const illumination = getTargetIllumination(target, gridMap);
    const level = illumination.level;
    const lowLight = hasLowLightVision(observer);
    const darkvision = hasDarkvision(observer);
    const silent =
      opts.silent === true ||
      opts.targetSilent === true ||
      opts.noise === false ||
      opts.targetNoisy === false ||
      target.silent === true;

    let visibility;
    if (level === ILLUMINATION_LEVELS.BRIGHT) {
      visibility = VISIBILITY.OBSERVED;
    } else if (level === ILLUMINATION_LEVELS.DIM) {
      visibility = lowLight || darkvision
        ? VISIBILITY.OBSERVED
        : VISIBILITY.CONCEALED;
    } else if (darkvision) {
      visibility = VISIBILITY.OBSERVED;
    } else {
      visibility = silent ? VISIBILITY.UNDETECTED : VISIBILITY.HIDDEN;
    }

    if (opts.invisible === true || target.invisible === true) {
      visibility = strongestVisibility(visibility, VISIBILITY.UNDETECTED);
    }

    if (opts.ignoreConditions !== true) {
      if (hasCondition(target, VISIBILITY.UNDETECTED)) {
        visibility = strongestVisibility(visibility, VISIBILITY.UNDETECTED);
      } else if (hasCondition(target, VISIBILITY.HIDDEN)) {
        visibility = strongestVisibility(visibility, VISIBILITY.HIDDEN);
      } else if (hasCondition(target, VISIBILITY.CONCEALED)) {
        visibility = strongestVisibility(visibility, VISIBILITY.CONCEALED);
      }
    }

    return {
      level: level,
      lightLevel: level,
      cell: illumination.cell,
      visibility: visibility,
      condition: visibility === VISIBILITY.OBSERVED ? null : visibility,
      flatCheckDC: FLAT_CHECK_DC[visibility],
      targetable: visibility !== VISIBILITY.UNDETECTED,
      observed: visibility === VISIBILITY.OBSERVED,
      senses: {
        lowLightVision: lowLight,
        darkvision: darkvision,
      },
    };
  }

  /**
   * Convenience predicate used by the stealth actions.
   *
   * @param {object} observer
   * @param {object} target
   * @param {object} [gridMap]
   * @returns {boolean}
   */
  function canObserve(observer, target, gridMap) {
    return getPerceivedVisibility(observer, target, gridMap).observed;
  }

  return Object.freeze({
    ILLUMINATION_LEVELS: ILLUMINATION_LEVELS,
    VISIBILITY: VISIBILITY,
    VISIBILITY_RANK: VISIBILITY_RANK,
    FLAT_CHECK_DC: FLAT_CHECK_DC,
    hasSense: hasSense,
    hasLowLightVision: hasLowLightVision,
    hasDarkvision: hasDarkvision,
    getCellIllumination: getCellIllumination,
    getTargetIllumination: getTargetIllumination,
    getPerceivedVisibility: getPerceivedVisibility,
    canObserve: canObserve,
  });
});
