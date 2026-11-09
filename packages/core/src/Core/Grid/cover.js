/**
 * PF2E REMASTERED — COVER GEOMETRY (HEADLESS CORE)
 *
 * Cover is evaluated from the attacker's best corner to every corner of the
 * target's footprint, edge-to-edge:
 *
 *   - for a multi-cell (Large/Huge/Gargantuan) creature the corners are the
 *     four outer corners of its whole footprint, not the anchor (top-left) cell;
 *   - the attacker chooses the corner that produces the fewest wall-blocked
 *     rays;
 *   - each ray that crosses the interior of a solid obstacle counts as blocked;
 *   - 1-2 blocked rays -> standard cover (+2 circumstance AC);
 *   - 3 blocked rays  -> greater cover (+4 circumstance AC);
 *   - 4 blocked rays  -> no line of sight at all;
 *   - with no wall-blocked rays, any ray crossing an able creature other than
 *     the attacker or target grants lesser cover (+1 circumstance AC).
 *
 * Rays are corner-to-corner, so a ray that only touches a wall edge or corner
 * does NOT count as blocked. This mirrors the literal Remastered cover rule
 * and keeps the result stable on a square grid.
 *
 * This module is pure geometry. It does not mutate combatants and does not
 * apply modifiers; Strike injects the returned AC bonus through the central
 * modifier resolver.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./grid-math.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Cover = factory(root.PF2e.Core.Grid);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Grid) {
  "use strict";

  const COVER_DEGREES = Object.freeze({
    NONE: "none",
    LESSER: "lesser",
    STANDARD: "standard",
    GREATER: "greater",
  });

  const COVER_AC_BONUS = Object.freeze({
    none: 0,
    lesser: 1,
    standard: 2,
    greater: 4,
  });

  /**
   * Cover grants its circumstance bonus to Reflex saves and Reflex DC only at
   * standard (+2) or greater (+4) cover. Lesser cover is AC-only.
   */
  const COVER_REFLEX_BONUS = Object.freeze({
    none: 0,
    lesser: 0,
    standard: 2,
    greater: 4,
  });

  const COVER_LABELS = Object.freeze({
    none: "No Cover",
    lesser: "Lesser Cover",
    standard: "Standard Cover",
    greater: "Greater Cover",
  });

  const EPSILON = 1e-9;

  function assertUnit(unit, label) {
    if (
      unit === null ||
      typeof unit !== "object" ||
      !Number.isInteger(unit.x) ||
      !Number.isInteger(unit.y)
    ) {
      throw new TypeError(label + " must be a positioned combatant with integer x and y.");
    }
  }

  function assertMap(map) {
    if (
      map === null ||
      typeof map !== "object" ||
      (typeof map.hasObstacle !== "function" && typeof map.isBlocked !== "function")
    ) {
      throw new TypeError("map must be a GridMap or expose hasObstacle(x, y).");
    }
  }

  function isObstacle(map, x, y) {
    if (typeof map.hasObstacle === "function") {
      return map.hasObstacle(x, y);
    }
    return map.isBlocked(x, y);
  }

  function normalizeCombatants(combatants) {
    if (combatants === undefined || combatants === null) {
      return [];
    }
    if (!Array.isArray(combatants)) {
      throw new TypeError("combatants must be an array of positioned combatants.");
    }
    return combatants;
  }

  function sameCreature(a, b) {
    if (a === b) {
      return true;
    }
    return a.id !== undefined && b.id !== undefined && a.id === b.id;
  }

  function isAble(unit) {
    return (
      unit !== null &&
      typeof unit === "object" &&
      unit.isDefeated !== true &&
      unit.currentHP !== 0
    );
  }

  function footprintsOverlap(a, b) {
    const aCells = Grid.occupiedCellsOf(a);
    const bCells = Grid.occupiedCellsOf(b);
    const seen = new Set();
    for (const cell of aCells) {
      seen.add(cell.x + "," + cell.y);
    }
    for (const cell of bCells) {
      if (seen.has(cell.x + "," + cell.y)) {
        return true;
      }
    }
    return false;
  }

  function copyCell(cell) {
    return { x: cell.x, y: cell.y };
  }

  /**
   * The four outer grid-vertex corners of a unit's whole footprint, in NW, NE,
   * SW, SE order. A Medium (1x1) creature yields the same corners as its single
   * cell; a Large (2x2) creature yields the four corners of the 2x2 area, so
   * cover and line of effect are judged edge-to-edge rather than from the
   * anchor (top-left) cell only.
   *
   * @param {object} unit
   * @returns {{x:number,y:number}[]}
   */
  function footprintCorners(unit) {
    const cells = Grid.occupiedCellsOf(unit);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cell of cells) {
      if (cell.x < minX) minX = cell.x;
      if (cell.y < minY) minY = cell.y;
      if (cell.x > maxX) maxX = cell.x;
      if (cell.y > maxY) maxY = cell.y;
    }
    return [
      { x: minX, y: minY },
      { x: maxX + 1, y: minY },
      { x: minX, y: maxY + 1 },
      { x: maxX + 1, y: maxY + 1 },
    ];
  }

  /**
   * Closed-slab clipping against a cell, followed by a strict-interior check at
   * the midpoint of the clipped interval. This deliberately rejects segments
   * that only run along a cell edge or touch a corner.
   *
   * @param {{x:number,y:number}} from
   * @param {{x:number,y:number}} to
   * @param {{x:number,y:number}} cell
   * @returns {boolean}
   */
  function segmentIntersectsCellInterior(from, to, cell) {
    const minX = cell.x;
    const maxX = cell.x + 1;
    const minY = cell.y;
    const maxY = cell.y + 1;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    let t0 = 0;
    let t1 = 1;

    function clip(p, q) {
      if (Math.abs(p) < EPSILON) {
        return q >= -EPSILON;
      }
      const ratio = q / p;
      if (p < 0) {
        if (ratio > t1) {
          return false;
        }
        if (ratio > t0) {
          t0 = ratio;
        }
      } else {
        if (ratio < t0) {
          return false;
        }
        if (ratio < t1) {
          t1 = ratio;
        }
      }
      return true;
    }

    if (!clip(-dx, from.x - minX)) {
      return false;
    }
    if (!clip(dx, maxX - from.x)) {
      return false;
    }
    if (!clip(-dy, from.y - minY)) {
      return false;
    }
    if (!clip(dy, maxY - from.y)) {
      return false;
    }

    if (t1 - t0 <= EPSILON) {
      return false;
    }

    const mid = (t0 + t1) / 2;
    const px = from.x + dx * mid;
    const py = from.y + dy * mid;
    return (
      px > minX + EPSILON &&
      px < maxX - EPSILON &&
      py > minY + EPSILON &&
      py < maxY - EPSILON
    );
  }

  /**
   * Candidate cells touched by a segment, limited to the segment's bounding
   * box. Out-of-bounds cells are skipped; only real obstacles matter for cover.
   */
  function cellsInSegmentBounds(from, to, map) {
    const minX = Math.floor(Math.min(from.x, to.x));
    const maxX = Math.floor(Math.max(from.x, to.x));
    const minY = Math.floor(Math.min(from.y, to.y));
    const maxY = Math.floor(Math.max(from.y, to.y));
    const cells = [];

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (typeof map.isInBounds === "function" && !map.isInBounds(x, y)) {
          continue;
        }
        cells.push({ x: x, y: y });
      }
    }
    return cells;
  }

  function firstWallAlongRay(from, to, map) {
    const candidates = cellsInSegmentBounds(from, to, map);
    for (const cell of candidates) {
      if (isObstacle(map, cell.x, cell.y) && segmentIntersectsCellInterior(from, to, cell)) {
        return cell;
      }
    }
    return null;
  }

  function firstCreatureAlongRay(from, to, roster, attacker, target) {
    for (const creature of roster) {
      if (!isAble(creature)) {
        continue;
      }
      if (!Number.isInteger(creature.x) || !Number.isInteger(creature.y)) {
        continue;
      }
      if (sameCreature(creature, attacker) || sameCreature(creature, target)) {
        continue;
      }
      // A creature that happens to share the attacker's or target's square is
      // not an intervening body.
      if (
        (creature.x === attacker.x && creature.y === attacker.y) ||
        (creature.x === target.x && creature.y === target.y)
      ) {
        continue;
      }

      const cell = { x: creature.x, y: creature.y };
      if (segmentIntersectsCellInterior(from, to, cell)) {
        return {
          id: creature.id,
          name: creature.name,
          cell: copyCell(cell),
        };
      }
    }
    return null;
  }

  function buildRays(corner, target, map, roster, attacker) {
    return footprintCorners(target).map(function (to) {
      const wall = firstWallAlongRay(corner, to, map);
      const creature = wall === null
        ? firstCreatureAlongRay(corner, to, roster, attacker, target)
        : null;

      return {
        from: copyCell(corner),
        to: copyCell(to),
        blocked: wall !== null,
        blockedBy: wall,
        creatureBlocked: creature !== null,
        creatureBlockedBy: creature,
      };
    });
  }

  function countBlockedRays(rays) {
    return rays.filter(function (ray) {
      return ray.blocked;
    }).length;
  }

  function emptyCover() {
    return {
      degree: COVER_DEGREES.NONE,
      acBonus: 0,
      label: COVER_LABELS.none,
      bestCorner: null,
      attackerCorner: null,
      targetCorners: [],
      rays: [],
      blockedRaysCount: 0,
      creatureCover: false,
      creatureCoverCells: [],
      lineOfSight: true,
      noLineOfSight: false,
    };
  }

  /**
   * Canonical PF2e cover evaluation.
   *
   * @param {object} attacker positioned attacker
   * @param {object} target positioned target
   * @param {object} gridMap GridMap or any map exposing hasObstacle(x, y)
   * @param {object[]} [combatants] roster used for creature-provided lesser cover
   * @returns {{
   *   degree: "none"|"lesser"|"standard"|"greater",
   *   acBonus: 0|1|2|4,
   *   label: string,
   *   bestCorner: {x:number,y:number},
   *   attackerCorner: {x:number,y:number},
   *   targetCorners: {x:number,y:number}[],
   *   rays: object[],
   *   blockedRaysCount: number,
   *   creatureCover: boolean,
   *   lineOfSight: boolean,
   *   noLineOfSight: boolean
   * }}
   */
  function determineCover(attacker, target, gridMap, combatants) {
    assertUnit(attacker, "attacker");
    assertUnit(target, "target");
    assertMap(gridMap);

    const roster = normalizeCombatants(combatants);

    if (sameCreature(attacker, target) || footprintsOverlap(attacker, target)) {
      return emptyCover();
    }

    const candidates = footprintCorners(attacker).map(function (corner) {
      const rays = buildRays(corner, target, gridMap, roster, attacker);
      return {
        corner: corner,
        rays: rays,
        blockedRaysCount: countBlockedRays(rays),
      };
    });

    let best = candidates[0];
    for (let index = 1; index < candidates.length; index += 1) {
      if (candidates[index].blockedRaysCount < best.blockedRaysCount) {
        best = candidates[index];
      }
    }

    const blockedRaysCount = best.blockedRaysCount;
    const creatures = best.rays.filter(function (ray) {
      return ray.creatureBlocked;
    });
    const creatureCover = blockedRaysCount === 0 && creatures.length > 0;

    let degree = COVER_DEGREES.NONE;
    if (blockedRaysCount >= 4) {
      degree = COVER_DEGREES.NONE;
    } else if (blockedRaysCount === 3) {
      degree = COVER_DEGREES.GREATER;
    } else if (blockedRaysCount >= 1) {
      degree = COVER_DEGREES.STANDARD;
    } else if (creatureCover) {
      degree = COVER_DEGREES.LESSER;
    }

    return {
      degree: degree,
      acBonus: COVER_AC_BONUS[degree],
      label: COVER_LABELS[degree],
      bestCorner: copyCell(best.corner),
      attackerCorner: copyCell(best.corner),
      targetCorners: footprintCorners(target),
      rays: best.rays,
      blockedRaysCount: blockedRaysCount,
      creatureCover: creatureCover,
      creatureCoverCells: (function () {
        const seen = new Set();
        const cells = [];
        for (const ray of creatures) {
          const cell = ray.creatureBlockedBy.cell;
          const key = cell.x + "," + cell.y;
          if (!seen.has(key)) {
            seen.add(key);
            cells.push(copyCell(cell));
          }
        }
        return cells;
      })(),
      lineOfSight: blockedRaysCount < 4,
      noLineOfSight: blockedRaysCount >= 4,
    };
  }

  /**
   * Best cover the defender has against any living hostile in the roster.
   * Used by the Take Cover action and the View button.
   *
   * @param {object} defender
   * @param {object[]} combatants
   * @param {object} gridMap
   * @param {{hostileOnly?: boolean}} [options]
   * @returns {object} a determineCover result
   */
  function getBestCover(defender, combatants, gridMap, options) {
    assertUnit(defender, "defender");
    assertMap(gridMap);
    const roster = normalizeCombatants(combatants);
    const opts = options || {};
    const hostileOnly = opts.hostileOnly !== false;

    let best = null;
    for (const candidate of roster) {
      if (!isAble(candidate)) {
        continue;
      }
      if (!Number.isInteger(candidate.x) || !Number.isInteger(candidate.y)) {
        continue;
      }
      if (sameCreature(candidate, defender)) {
        continue;
      }
      if (
        hostileOnly &&
        candidate.alliance !== undefined &&
        defender.alliance !== undefined &&
        candidate.alliance === defender.alliance
      ) {
        continue;
      }

      const cover = determineCover(candidate, defender, gridMap, roster);
      if (best === null || cover.acBonus > best.acBonus) {
        best = cover;
      }
    }

    return best === null ? emptyCover() : best;
  }

  function isStandardOrGreater(cover) {
    return (
      cover !== null &&
      typeof cover === "object" &&
      (cover.degree === COVER_DEGREES.STANDARD || cover.degree === COVER_DEGREES.GREATER)
    );
  }

  /**
   * Modifier object for the central resolver. Returns null for no cover.
   *
   * @param {object|string} cover result object or degree string
   * @returns {{name:string,type:string,value:number,source:string}|null}
   */
  function coverModifier(cover) {
    if (cover === null || cover === undefined) {
      return null;
    }
    const degree =
      typeof cover === "string" ? cover : cover.degree;
    const value = COVER_AC_BONUS[degree] || 0;
    if (value <= 0) {
      return null;
    }
    return {
      name: COVER_LABELS[degree],
      type: "circumstance",
      value: value,
      source: "cover",
    };
  }

  /**
   * Cover modifier for Reflex saves and Reflex DC. Returns null for no cover
   * and for lesser cover, which improves AC only.
   *
   * @param {object|string} cover result object or degree string
   * @returns {{name:string,type:string,value:number,source:string}|null}
   */
  function coverReflexModifier(cover) {
    if (cover === null || cover === undefined) {
      return null;
    }
    const degree = typeof cover === "string" ? cover : cover.degree;
    const value = COVER_REFLEX_BONUS[degree] || 0;
    if (value <= 0) {
      return null;
    }
    return {
      name: COVER_LABELS[degree],
      type: "circumstance",
      value: value,
      source: "cover",
    };
  }

  return Object.freeze({
    COVER_DEGREES: COVER_DEGREES,
    COVER_AC_BONUS: COVER_AC_BONUS,
    COVER_REFLEX_BONUS: COVER_REFLEX_BONUS,
    COVER_LABELS: COVER_LABELS,
    segmentIntersectsCellInterior: segmentIntersectsCellInterior,
    determineCover: determineCover,
    getBestCover: getBestCover,
    coverModifier: coverModifier,
    coverReflexModifier: coverReflexModifier,
    isStandardOrGreater: isStandardOrGreater,
  });
});
