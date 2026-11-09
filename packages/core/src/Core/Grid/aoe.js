/**
 * PF2E REMASTERED — AREAS OF EFFECT (HEADLESS CORE)
 *
 * Grid-native area geometry for the spellcasting slices:
 *
 *   - Burst: every cell whose centre is within `radiusFeet` of the origin.
 *   - Line: a straight strip that begins at the edge of the origin cell and
 *     walks outward using the PF2e 5-10-5 diagonal alternation.
 *   - Cone: a 90-degree wedge (45 degrees either side of the axis) whose
 *     cells must have their centre inside the wedge and be within range.
 *   - Emanation: a radius measured from the outer edge of every cell the
 *     creature occupies; the caster's own footprint is excluded.
 *
 * Every distance is centre-to-centre with the canonical 5-10-5 alternation.
 * Monolithic obstacles are never part of an area, and they block cones/lines
 * from reaching cells behind them. Rendering stays in View.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./grid-math.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Grid = root.PF2e.Core.Grid || {};
    root.PF2e.Core.Grid.AoE = factory(root.PF2e.Core.Grid);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Grid) {
  "use strict";

  const FEET_PER_SQUARE = Grid.FEET_PER_SQUARE;

  // Clockwise ring starting at east. Screen-space Y increases downward, which
  // matches Math.atan2(dy, dx) and keeps direction snapping deterministic.
  const DIRECTION_RING = Object.freeze([
    Object.freeze({ x: 1, y: 0 }), // east
    Object.freeze({ x: 1, y: 1 }), // south-east
    Object.freeze({ x: 0, y: 1 }), // south
    Object.freeze({ x: -1, y: 1 }), // south-west
    Object.freeze({ x: -1, y: 0 }), // west
    Object.freeze({ x: -1, y: -1 }), // north-west
    Object.freeze({ x: 0, y: -1 }), // north
    Object.freeze({ x: 1, y: -1 }), // north-east
  ]);

  const DIRECTION_ALIASES = Object.freeze({
    n: { x: 0, y: -1 },
    north: { x: 0, y: -1 },
    up: { x: 0, y: -1 },
    ne: { x: 1, y: -1 },
    northeast: { x: 1, y: -1 },
    e: { x: 1, y: 0 },
    east: { x: 1, y: 0 },
    right: { x: 1, y: 0 },
    se: { x: 1, y: 1 },
    southeast: { x: 1, y: 1 },
    s: { x: 0, y: 1 },
    south: { x: 0, y: 1 },
    down: { x: 0, y: 1 },
    sw: { x: -1, y: 1 },
    southwest: { x: -1, y: 1 },
    w: { x: -1, y: 0 },
    west: { x: -1, y: 0 },
    left: { x: -1, y: 0 },
    nw: { x: -1, y: -1 },
    northwest: { x: -1, y: -1 },
  });

  function assertInteger(value, label) {
    if (!Number.isInteger(value)) {
      throw new TypeError(label + " must be an integer; received " + String(value) + ".");
    }
  }

  function assertCell(cell, label) {
    if (cell === null || typeof cell !== "object") {
      throw new TypeError(label + " must be a cell object { x, y }.");
    }
    assertInteger(cell.x, label + ".x");
    assertInteger(cell.y, label + ".y");
  }

  function cellKey(cell) {
    return cell.x + "," + cell.y;
  }

  function copyCell(cell) {
    return { x: cell.x, y: cell.y };
  }

  function sortCells(cells) {
    cells.sort(function (a, b) {
      return a.y - b.y || a.x - b.x;
    });
    return cells;
  }

  /**
   * Resolve a direction token to one of the eight grid unit vectors. The input
   * may be a compass name ("ne", "south-west", ...), a vector (`{x,y}` or
   * `{dx,dy}`), or any non-zero vector, which is snapped to the nearest
   * 45-degree axis.
   *
   * @param {string|{x?:number,y?:number,dx?:number,dy?:number}} input
   * @returns {{x:number,y:number}}
   */
  function normalizeDirection(input) {
    if (typeof input === "string") {
      const key = input.trim().toLowerCase().replace(/[\s_-]/g, "");
      const alias = DIRECTION_ALIASES[key];
      if (alias === undefined) {
        throw new RangeError("Unknown grid direction: " + JSON.stringify(input) + ".");
      }
      return { x: alias.x, y: alias.y };
    }

    if (input !== null && typeof input === "object") {
      const dx = input.dx !== undefined ? input.dx : input.x;
      const dy = input.dy !== undefined ? input.dy : input.y;
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
        throw new RangeError("Direction vector must be non-zero and finite.");
      }
      const angle = Math.atan2(dy, dx);
      const index = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
      return { x: DIRECTION_RING[index].x, y: DIRECTION_RING[index].y };
    }

    throw new TypeError("Direction must be a compass name or a {x,y} vector.");
  }

  function assertAreaLength(value, label) {
    if (
      !Number.isInteger(value) ||
      value < 0 ||
      value % FEET_PER_SQUARE !== 0
    ) {
      throw new RangeError(label + " must be a non-negative multiple of 5.");
    }
  }

  function assertGridMap(gridMap, label) {
    if (
      gridMap !== undefined &&
      gridMap !== null &&
      typeof gridMap.isBlocked !== "function"
    ) {
      throw new TypeError(label + " map must be a GridMap.");
    }
  }

  function mapHasBounds(gridMap) {
    return (
      gridMap !== undefined &&
      gridMap !== null &&
      Number.isInteger(gridMap.cols) &&
      Number.isInteger(gridMap.rows)
    );
  }

  function isOutOfBounds(gridMap, x, y) {
    return (
      mapHasBounds(gridMap) &&
      (x < 0 || y < 0 || x >= gridMap.cols || y >= gridMap.rows)
    );
  }

  function isBlockedAt(gridMap, x, y) {
    if (gridMap === undefined || gridMap === null) {
      return false;
    }
    if (isOutOfBounds(gridMap, x, y)) {
      return true;
    }
    return gridMap.isBlocked(x, y);
  }

  /**
   * Integer cells touched by the segment between two cell centres. Used for
   * cone line-of-effect so a wall blocks everything strictly behind it.
   *
   * @param {{x:number,y:number}} from
   * @param {{x:number,y:number}} to
   * @returns {{x:number,y:number}[]}
   */
  function cellsBetween(from, to) {
    let x = from.x;
    let y = from.y;
    const dx = Math.abs(to.x - x);
    const dy = -Math.abs(to.y - y);
    const sx = x < to.x ? 1 : -1;
    const sy = y < to.y ? 1 : -1;
    let error = dx + dy;
    const cells = [];

    while (true) {
      cells.push({ x: x, y: y });
      if (x === to.x && y === to.y) {
        break;
      }
      const doubled = 2 * error;
      if (doubled >= dy) {
        error += dy;
        x += sx;
      }
      if (doubled <= dx) {
        error += dx;
        y += sy;
      }
    }
    return cells;
  }

  function hasLineOfEffect(gridMap, from, to) {
    if (gridMap === undefined || gridMap === null) {
      return true;
    }
    const path = cellsBetween(from, to);
    for (let index = 1; index < path.length - 1; index += 1) {
      if (isBlockedAt(gridMap, path[index].x, path[index].y)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Every non-blocked grid cell whose centre lies within `radiusFeet` of the
   * origin cell's centre.
   *
   * With a GridMap the result is clipped to the map bounds and monolithic
   * obstacles are excluded. Without a map the mathematical burst is returned,
   * which keeps isolated headless damage math independent of terrain.
   *
   * @param {{x:number,y:number}} centerOrigin
   * @param {number} radiusFeet positive multiple of 5
   * @param {object} [gridMap] optional GridMap
   * @returns {{x:number,y:number}[]}
   */
  function getBurstCells(centerOrigin, radiusFeet, gridMap) {
    assertCell(centerOrigin, "centerOrigin");
    if (
      !Number.isInteger(radiusFeet) ||
      radiusFeet < 0 ||
      radiusFeet % FEET_PER_SQUARE !== 0
    ) {
      throw new RangeError("radiusFeet must be a non-negative multiple of 5.");
    }

    const hasMap = gridMap !== undefined && gridMap !== null;
    if (hasMap && typeof gridMap.isBlocked !== "function") {
      throw new TypeError("getBurstCells map must be a GridMap.");
    }

    const radiusSquares = Math.ceil(radiusFeet / FEET_PER_SQUARE);
    let minX = centerOrigin.x - radiusSquares;
    let maxX = centerOrigin.x + radiusSquares;
    let minY = centerOrigin.y - radiusSquares;
    let maxY = centerOrigin.y + radiusSquares;

    if (hasMap) {
      minX = Math.max(0, minX);
      minY = Math.max(0, minY);
      maxX = Math.min(gridMap.cols - 1, maxX);
      maxY = Math.min(gridMap.rows - 1, maxY);
    }

    const cells = [];
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (hasMap && gridMap.isBlocked(x, y)) {
          continue;
        }
        const candidate = { x: x, y: y };
        if (Grid.distanceFeet(centerOrigin, candidate) <= radiusFeet) {
          cells.push(candidate);
        }
      }
    }

    return sortCells(cells);
  }

  /**
   * A straight line template.
   *
   * The origin cell is the caster's space; like a PF2e line, the strip begins
   * at the edge of that space, so the origin cell itself is not included.
   * Every step moves one cell; diagonal steps use the same 5/10 alternation
   * as movement and reach. The first blocked centreline cell stops the line,
   * so no area continues behind a wall.
   *
   * A width greater than 5 ft adds cells perpendicular to the direction.
   * For even square widths the strip starts on the centreline (`10 ft` gives
   * the centreline plus one perpendicular lane).
   *
   * @param {{x:number,y:number}} origin
   * @param {string|{x?:number,y?:number,dx?:number,dy?:number}} targetDirection
   * @param {number} lengthFeet non-negative multiple of 5
   * @param {number} [widthFeet=5] positive multiple of 5
   * @param {object} [gridMap] optional GridMap
   * @returns {{x:number,y:number}[]}
   */
  function getLineCells(origin, targetDirection, lengthFeet, widthFeet, gridMap) {
    assertCell(origin, "origin");
    const direction = normalizeDirection(targetDirection);

    // Friendly overload: getLineCells(origin, dir, length, map) uses the
    // default 5-ft width.
    if (
      gridMap === undefined &&
      widthFeet !== undefined &&
      widthFeet !== null &&
      typeof widthFeet === "object" &&
      typeof widthFeet.isBlocked === "function"
    ) {
      gridMap = widthFeet;
      widthFeet = FEET_PER_SQUARE;
    }

    const width = widthFeet === undefined ? FEET_PER_SQUARE : widthFeet;
    assertAreaLength(lengthFeet, "lengthFeet");
    assertAreaLength(width, "widthFeet");
    if (width <= 0) {
      throw new RangeError("widthFeet must be a positive multiple of 5.");
    }
    assertGridMap(gridMap, "getLineCells");
    if (lengthFeet === 0) {
      return [];
    }

    const widthSquares = width / FEET_PER_SQUARE;
    const offsetStart = -Math.floor((widthSquares - 1) / 2);
    const offsetEnd = offsetStart + widthSquares - 1;
    const perpendicular = { x: -direction.y, y: direction.x };
    const isDiagonal = direction.x !== 0 && direction.y !== 0;
    const seen = new Set();
    const cells = [];

    let x = origin.x;
    let y = origin.y;
    let travelled = 0;
    let diagonalIndex = 0;

    while (true) {
      const stepCost = isDiagonal
        ? Grid.diagonalStepCostFeet(diagonalIndex)
        : FEET_PER_SQUARE;
      if (travelled + stepCost > lengthFeet) {
        break;
      }
      travelled += stepCost;
      if (isDiagonal) {
        diagonalIndex += 1;
      }
      x += direction.x;
      y += direction.y;

      // A wall blocks the centreline and everything beyond it.
      if (isBlockedAt(gridMap, x, y)) {
        break;
      }

      for (let offset = offsetStart; offset <= offsetEnd; offset += 1) {
        const cell = {
          x: x + perpendicular.x * offset,
          y: y + perpendicular.y * offset,
        };
        if (isBlockedAt(gridMap, cell.x, cell.y)) {
          continue;
        }
        const key = cellKey(cell);
        if (!seen.has(key)) {
          seen.add(key);
          cells.push(cell);
        }
      }
    }

    return sortCells(cells);
  }

  /**
   * A 90-degree cone template.
   *
   * The axis is one of the eight grid directions; the wedge spans 45 degrees
   * either side of it. A cell is affected when:
   *   1. its centre lies inside the wedge,
   *   2. its 5-10-5 distance from the apex is at most `lengthFeet`,
   *   3. it is not itself an obstacle, and
   *   4. a wall does not cut the line of effect from the apex.
   *
   * The apex cell is not part of the cone.
   *
   * @param {{x:number,y:number}} origin
   * @param {string|{x?:number,y?:number,dx?:number,dy?:number}} direction
   * @param {number} lengthFeet non-negative multiple of 5
   * @param {object} [gridMap] optional GridMap
   * @returns {{x:number,y:number}[]}
   */
  function getConeCells(origin, direction, lengthFeet, gridMap) {
    assertCell(origin, "origin");
    const axis = normalizeDirection(direction);
    assertAreaLength(lengthFeet, "lengthFeet");
    assertGridMap(gridMap, "getConeCells");
    if (lengthFeet === 0) {
      return [];
    }

    const radiusSquares = Math.ceil(lengthFeet / FEET_PER_SQUARE);
    let minX = origin.x - radiusSquares;
    let maxX = origin.x + radiusSquares;
    let minY = origin.y - radiusSquares;
    let maxY = origin.y + radiusSquares;

    if (mapHasBounds(gridMap)) {
      minX = Math.max(0, minX);
      minY = Math.max(0, minY);
      maxX = Math.min(gridMap.cols - 1, maxX);
      maxY = Math.min(gridMap.rows - 1, maxY);
    }

    const cells = [];
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (x === origin.x && y === origin.y) {
          continue;
        }
        if (isBlockedAt(gridMap, x, y)) {
          continue;
        }

        const vx = x - origin.x;
        const vy = y - origin.y;
        const dot = vx * axis.x + vy * axis.y;
        if (dot <= 0) {
          continue;
        }
        // |v x axis| <= v . axis is the inclusive 90-degree wedge test.
        const cross = vx * axis.y - vy * axis.x;
        if (Math.abs(cross) > dot) {
          continue;
        }

        const cell = { x: x, y: y };
        if (Grid.distanceFeet(origin, cell) > lengthFeet) {
          continue;
        }
        if (!hasLineOfEffect(gridMap, origin, cell)) {
          continue;
        }
        cells.push(cell);
      }
    }

    return sortCells(cells);
  }

  /**
   * An emanation measured outward from every cell the creature occupies.
   * The footprint itself is excluded, so the caster is never its own target.
   * Blocked cells are skipped and the region is clipped to the map bounds.
   *
   * @param {object} combatant
   * @param {number} radiusFeet non-negative multiple of 5
   * @param {object} [gridMap] optional GridMap
   * @returns {{x:number,y:number}[]}
   */
  function getEmanationCells(combatant, radiusFeet, gridMap) {
    if (combatant === null || typeof combatant !== "object") {
      throw new TypeError("combatant must be a positioned Combatant.");
    }
    assertAreaLength(radiusFeet, "radiusFeet");
    assertGridMap(gridMap, "getEmanationCells");

    const footprintCells = occupiedCellsOf(combatant);
    if (footprintCells.length === 0) {
      throw new TypeError("combatant must expose a grid position.");
    }

    const footprint = new Set();
    const radiusSquares = Math.ceil(radiusFeet / FEET_PER_SQUARE);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const cell of footprintCells) {
      assertCell(cell, "combatant.getOccupiedCells()");
      footprint.add(cellKey(cell));
      minX = Math.min(minX, cell.x - radiusSquares);
      maxX = Math.max(maxX, cell.x + radiusSquares);
      minY = Math.min(minY, cell.y - radiusSquares);
      maxY = Math.max(maxY, cell.y + radiusSquares);
    }

    if (mapHasBounds(gridMap)) {
      minX = Math.max(0, minX);
      minY = Math.max(0, minY);
      maxX = Math.min(gridMap.cols - 1, maxX);
      maxY = Math.min(gridMap.rows - 1, maxY);
    }

    const cells = [];
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const candidate = { x: x, y: y };
        if (footprint.has(cellKey(candidate))) {
          continue;
        }
        if (isBlockedAt(gridMap, x, y)) {
          continue;
        }
        if (Grid.getCellsDistance(footprintCells, [candidate]) <= radiusFeet) {
          cells.push(candidate);
        }
      }
    }

    return sortCells(cells);
  }

  /**
   * Whether a combatant is still a valid area target.
   *
   * @param {object} combatant
   * @returns {boolean}
   */
  function isLivingCombatant(combatant) {
    if (combatant === null || typeof combatant !== "object") {
      return false;
    }
    if (combatant.isAlive === true) {
      return true;
    }
    if (combatant.isAlive === false || combatant.isDefeated === true) {
      return false;
    }
    return !Number.isInteger(combatant.currentHP) || combatant.currentHP > 0;
  }

  function occupiedCellsOf(combatant) {
    if (typeof combatant.getOccupiedCells === "function") {
      return combatant.getOccupiedCells();
    }
    if (Number.isInteger(combatant.x) && Number.isInteger(combatant.y)) {
      return [{ x: combatant.x, y: combatant.y }];
    }
    return [];
  }

  /**
   * Living combatants whose occupied footprint intersects the area. Roster
   * order is preserved so deterministic replays and logs stay stable.
   *
   * @param {{x:number,y:number}[]} cells
   * @param {object[]} combatants
   * @returns {object[]}
   */
  function getTargetsInArea(cells, combatants) {
    if (!Array.isArray(cells)) {
      throw new TypeError("cells must be an array of grid cells.");
    }
    if (!Array.isArray(combatants)) {
      throw new TypeError("combatants must be an array.");
    }

    const area = new Set();
    for (const cell of cells) {
      assertCell(cell, "cells[]");
      area.add(cellKey(cell));
    }

    const targets = [];
    for (const combatant of combatants) {
      if (!isLivingCombatant(combatant)) {
        continue;
      }
      const occupied = occupiedCellsOf(combatant);
      const inside = occupied.some(function (cell) {
        return area.has(cellKey(cell));
      });
      if (inside) {
        targets.push(combatant);
      }
    }
    return targets;
  }

  return Object.freeze({
    getBurstCells: getBurstCells,
    getLineCells: getLineCells,
    getConeCells: getConeCells,
    getEmanationCells: getEmanationCells,
    getTargetsInArea: getTargetsInArea,
    normalizeDirection: normalizeDirection,
    // Small utilities reused by the casting action and its tests.
    cellKey: cellKey,
    copyCell: copyCell,
    isLivingCombatant: isLivingCombatant,
  });
});
