/**
 * PF2E REMASTERED — GRID MATHEMATICS (HEADLESS CORE)
 *
 * Pure rules code. No DOM, canvas, or rendering dependencies.
 *
 * Grid model:
 *   - One square = 5 feet.
 *   - Cells are integer coordinates { x, y }; (0, 0) is the top-left cell.
 *   - Diagonal movement alternates 5 ft / 10 ft / 5 ft / 10 ft.
 *     Cumulative diagonal distance: 0, 5, 15, 20, 30, 35, ...
 *
 * The module works both as a classic browser script (PF2e.Core.Grid)
 * and as a CommonJS module for the Node test runner.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../Rules/size.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Grid = factory(root.PF2e.Core.Rules.Size);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Size) {
  "use strict";

  /** @typedef {{ x: number, y: number }} Cell */
  /** @typedef {{ x: number, y: number, distanceFeet: number }} ReachableCell */

  const FEET_PER_SQUARE = 5;
  const DIFFICULT_TERRAIN_EXTRA_FEET = 5;

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

  function assertFeetBudget(maxFeet) {
    if (typeof maxFeet !== "number" || !Number.isFinite(maxFeet) || maxFeet < 0) {
      throw new TypeError("maxFeet must be a non-negative finite number; received " + String(maxFeet) + ".");
    }
  }

  /**
   * Incremental cost of one diagonal square, using a 0-based diagonal index.
   * 0 -> 5 ft, 1 -> 10 ft, 2 -> 5 ft, 3 -> 10 ft, ...
   *
   * @param {number} diagonalIndex
   * @returns {number}
   */
  function diagonalStepCostFeet(diagonalIndex) {
    assertInteger(diagonalIndex, "diagonalIndex");
    if (diagonalIndex < 0) {
      throw new RangeError("diagonalIndex must be >= 0.");
    }
    return diagonalIndex % 2 === 0 ? FEET_PER_SQUARE : FEET_PER_SQUARE * 2;
  }

  /**
   * Cumulative PF2e cost of N diagonal squares.
   * 0 -> 0, 1 -> 5, 2 -> 15, 3 -> 20, 4 -> 30, 5 -> 35 ...
   *
   * Closed form: N * 5 + floor(N / 2) * 5.
   *
   * @param {number} diagonalCount
   * @returns {number}
   */
  function diagonalDistanceFeet(diagonalCount) {
    assertInteger(diagonalCount, "diagonalCount");
    if (diagonalCount < 0) {
      throw new RangeError("diagonalCount must be >= 0.");
    }
    return diagonalCount * FEET_PER_SQUARE + Math.floor(diagonalCount / 2) * FEET_PER_SQUARE;
  }

  /**
   * PF2e Remastered distance between two grid cells.
   *
   * Every cell-to-cell step is either straight (5 ft) or diagonal. The
   * diagonal steps within the whole move share one 5-10-5 alternation,
   * regardless of where straight steps are inserted. For an unobstructed
   * grid the cheapest path takes the minimum number of diagonal steps,
   * giving the closed form:
   *
   *   5 * (max(dx, dy) + floor(min(dx, dy) / 2))
   *
   * @param {Cell} from
   * @param {Cell} to
   * @returns {number}
   */
  function distanceFeet(from, to) {
    assertCell(from, "from");
    assertCell(to, "to");

    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    const diagonalCount = Math.min(dx, dy);
    const straightCount = Math.max(dx, dy) - diagonalCount;

    return straightCount * FEET_PER_SQUARE + diagonalDistanceFeet(diagonalCount);
  }

  /**
   * @param {Cell} from
   * @param {Cell} to
   * @param {number} maxFeet
   * @returns {boolean}
   */
  function isWithinDistanceFeet(from, to, maxFeet) {
    assertFeetBudget(maxFeet);
    return distanceFeet(from, to) <= maxFeet;
  }

  /**
   * A creature's footprint edge length. Plain cells are treated as 1x1.
   *
   * @param {object} unit
   * @returns {number}
   */
  function footprintOf(unit) {
    if (unit !== null && typeof unit === "object") {
      if (typeof unit.getFootprint === "function") {
        return unit.getFootprint();
      }
      if (unit.size !== undefined && Size) {
        return Size.getFootprintForSize(unit.size);
      }
    }
    return 1;
  }

  /**
   * Build every cell of a square footprint anchored at its top-left corner.
   *
   * @param {number} x
   * @param {number} y
   * @param {number} footprint
   * @returns {Cell[]}
   */
  function getFootprintCells(x, y, footprint) {
    assertInteger(x, "x");
    assertInteger(y, "y");
    assertInteger(footprint, "footprint");
    if (footprint < 1) {
      throw new RangeError("footprint must be >= 1.");
    }

    const cells = [];
    for (let dx = 0; dx < footprint; dx += 1) {
      for (let dy = 0; dy < footprint; dy += 1) {
        cells.push({ x: x + dx, y: y + dy });
      }
    }
    return cells;
  }

  /**
   * All cells a unit occupies. Combatants expose getOccupiedCells(); a plain
   * { x, y } cell is treated as a single 1x1 square.
   *
   * @param {object} unit
   * @returns {Cell[]}
   */
  function occupiedCellsOf(unit) {
    if (unit === null || typeof unit !== "object") {
      throw new TypeError("unit must be a positioned cell or combatant.");
    }
    if (typeof unit.getOccupiedCells === "function") {
      return unit.getOccupiedCells();
    }
    assertCell(unit, "unit");
    const footprint = footprintOf(unit);
    if (footprint > 1) {
      return getFootprintCells(unit.x, unit.y, footprint);
    }
    return [{ x: unit.x, y: unit.y }];
  }

  /**
   * PF2e distance between two sets of occupied cells, taking the closest pair
   * of edges. This is the canonical reach / threatened-square measurement for
   * creatures larger than Medium.
   *
   * @param {Cell[]} fromCells
   * @param {Cell[]} toCells
   * @returns {number}
   */
  function getCellsDistance(fromCells, toCells) {
    if (!Array.isArray(fromCells) || fromCells.length === 0) {
      throw new TypeError("fromCells must be a non-empty array of cells.");
    }
    if (!Array.isArray(toCells) || toCells.length === 0) {
      throw new TypeError("toCells must be a non-empty array of cells.");
    }

    let minDistance = Infinity;
    for (const from of fromCells) {
      for (const to of toCells) {
        const distance = distanceFeet(from, to);
        if (distance < minDistance) {
          minDistance = distance;
        }
      }
    }
    return minDistance;
  }

  /**
   * Edge-to-edge PF2e distance between two combatants (or plain cells).
   *
   * @param {object} attacker
   * @param {object} target
   * @returns {number}
   */
  function getCombatantDistance(attacker, target) {
    return getCellsDistance(
      occupiedCellsOf(attacker),
      occupiedCellsOf(target),
    );
  }

  /**
   * All in-bounds cells reachable from `origin` within a movement budget.
   * The origin cell is excluded because a token cannot "move" to its own square.
   *
   * Obstacles, difficult terrain, and creature sizes are deliberately out of
   * scope for Session 1.1; those arrive with pathfinding in Session 1.2.
   *
   * @param {Cell} origin
   * @param {number} maxFeet
   * @param {{ cols?: number, rows?: number }} [options]
   * @returns {ReachableCell[]}
   */
  function reachableCells(origin, maxFeet, options) {
    assertCell(origin, "origin");
    assertFeetBudget(maxFeet);

    const opts = options || {};
    const cols = opts.cols === undefined ? 15 : opts.cols;
    const rows = opts.rows === undefined ? 15 : opts.rows;
    assertInteger(cols, "options.cols");
    assertInteger(rows, "options.rows");
    if (cols <= 0 || rows <= 0) {
      throw new RangeError("options.cols and options.rows must be positive.");
    }

    // No single square can cost less than 5 ft, so this bounds the search.
    const radius = Math.ceil(maxFeet / FEET_PER_SQUARE);
    const minX = Math.max(0, origin.x - radius);
    const maxX = Math.min(cols - 1, origin.x + radius);
    const minY = Math.max(0, origin.y - radius);
    const maxY = Math.min(rows - 1, origin.y + radius);
    const cells = [];

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (x === origin.x && y === origin.y) {
          continue;
        }
        const cost = distanceFeet(origin, { x: x, y: y });
        if (cost <= maxFeet) {
          cells.push({ x: x, y: y, distanceFeet: cost });
        }
      }
    }

    return cells;
  }

  /**
   * Human-readable grid label: column letters + 1-based row number.
   * (3, 7) -> "D8"; (25, 0) -> "Z1"; (26, 0) -> "AA1".
   *
   * @param {Cell} cell
   * @returns {string}
   */
  function gridToLabel(cell) {
    assertCell(cell, "cell");
    if (cell.x < 0 || cell.y < 0) {
      throw new RangeError("cell coordinates must be non-negative.");
    }

    let column = "";
    let index = cell.x;
    do {
      column = String.fromCharCode(65 + (index % 26)) + column;
      index = Math.floor(index / 26) - 1;
    } while (index >= 0);

    return column + String(cell.y + 1);
  }

  // Deliberately extensible: sibling Grid modules (AoE, Illumination) attach
  // their namespaces to this object in the classic-script build.
  return {
    FEET_PER_SQUARE: FEET_PER_SQUARE,
    DIFFICULT_TERRAIN_EXTRA_FEET: DIFFICULT_TERRAIN_EXTRA_FEET,
    diagonalStepCostFeet: diagonalStepCostFeet,
    diagonalDistanceFeet: diagonalDistanceFeet,
    distanceFeet: distanceFeet,
    isWithinDistanceFeet: isWithinDistanceFeet,
    footprintOf: footprintOf,
    getFootprintCells: getFootprintCells,
    occupiedCellsOf: occupiedCellsOf,
    getCellsDistance: getCellsDistance,
    getCombatantDistance: getCombatantDistance,
    reachableCells: reachableCells,
    gridToLabel: gridToLabel,
  };
});
