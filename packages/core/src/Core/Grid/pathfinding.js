/**
 * PF2E REMASTERED — PATHFINDING (HEADLESS CORE)
 *
 * A* over a square grid with the PF2e 5-10-5 diagonal alternation.
 *
 * The cost of the next diagonal step depends on how many diagonal steps have
 * already been taken, so every search state is (x, y, diagonalParity), where
 * parity = diagonalSteps % 2. Straight steps do not change parity.
 *
 * Heuristic (admissible, consistent on an empty grid):
 *   5 * (max(dx, dy) - min(dx, dy)) + 5 * min(dx, dy)
 *   + 5 * floor((min(dx, dy) + parity) / 2)
 *
 * Corner-cut policy is configurable because PF2e Remastered does not provide
 * an unambiguous grid-corner rule. The project-canonical policy is "block-any".
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./grid-math.js"), require("./grid-map.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Pathfinding = factory(root.PF2e.Core.Grid, root.PF2e.Core.GridMap);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Grid, GridMap) {
  "use strict";

  const DIAGONAL_CORNER_POLICIES = Object.freeze({
    ALLOW: "allow",
    BLOCK_BOTH: "block-both",
    BLOCK_ANY: "block-any",
  });

  const FEET_PER_SQUARE = Grid.FEET_PER_SQUARE;
  const DIFFICULT_TERRAIN_EXTRA_FEET = Grid.DIFFICULT_TERRAIN_EXTRA_FEET;

  const DIRECTIONS = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: -1 },
    { dx: 1, dy: 1 },
    { dx: -1, dy: 1 },
    { dx: -1, dy: -1 },
  ];

  function assertCell(cell, label) {
    if (cell === null || typeof cell !== "object") {
      throw new TypeError(label + " must be a cell object { x, y }.");
    }
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) {
      throw new TypeError(label + " must contain integer coordinates.");
    }
  }

  function assertMap(map) {
    if (!(map instanceof GridMap)) {
      throw new TypeError("options.map must be a GridMap instance.");
    }
  }

  function normalizeParity(parity) {
    if (parity === undefined) {
      return 0;
    }
    if (parity !== 0 && parity !== 1) {
      throw new RangeError("startDiagonalParity must be 0 or 1.");
    }
    return parity;
  }

  function normalizePolicy(policy) {
    if (policy === undefined) {
      return DIAGONAL_CORNER_POLICIES.BLOCK_ANY;
    }
    if (
      policy !== DIAGONAL_CORNER_POLICIES.ALLOW &&
      policy !== DIAGONAL_CORNER_POLICIES.BLOCK_BOTH &&
      policy !== DIAGONAL_CORNER_POLICIES.BLOCK_ANY
    ) {
      throw new RangeError("Unknown diagonalCornerPolicy: " + String(policy) + ".");
    }
    return policy;
  }

  function cellKeyOf(cell) {
    return cell.x + "," + cell.y;
  }

  function normalizeFootprint(footprint) {
    if (footprint === undefined) {
      return 1;
    }
    if (!Number.isInteger(footprint) || footprint < 1) {
      throw new RangeError("footprint must be a positive integer.");
    }
    return footprint;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} footprint
   * @returns {{x:number,y:number}[]}
   */
  function footprintCells(x, y, footprint) {
    const cells = [];
    for (let dx = 0; dx < footprint; dx += 1) {
      for (let dy = 0; dy < footprint; dy += 1) {
        cells.push({ x: x + dx, y: y + dy });
      }
    }
    return cells;
  }

  /**
   * Whether a square footprint intersects a wall, out-of-bounds cell, or an
   * impassable occupancy cell.
   */
  function footprintImpassable(map, x, y, occupancy, footprint) {
    if (footprint === 1) {
      return map.isBlocked(x, y) || occupancy.blocked.has(x + "," + y);
    }

    for (const cell of footprintCells(x, y, footprint)) {
      if (map.isBlocked(cell.x, cell.y) || occupancy.blocked.has(cellKeyOf(cell))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether any cell of a footprint belongs to the given cell set.
   */
  function footprintOverlapsSet(x, y, footprint, cells) {
    if (footprint === 1) {
      return cells.has(x + "," + y);
    }
    for (const cell of footprintCells(x, y, footprint)) {
      if (cells.has(cellKeyOf(cell))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Occupancy cells may be passed as:
   *   - an array of { x, y } cells,
   *   - an array of "x,y" keys,
   *   - a Set of either.
   *
   * `blockedCells` are impassable (enemies for the mover).
   * `passThroughCells` are traversable but cannot be the final destination
   * (allies for the mover).
   */
  function normalizeCellSet(value, label) {
    const keys = new Set();
    if (value === undefined || value === null) {
      return keys;
    }
    if (!(value instanceof Set) && !Array.isArray(value)) {
      throw new TypeError(label + " must be a cell array, Set, or undefined.");
    }

    for (const entry of value) {
      if (typeof entry === "string") {
        const parts = entry.split(",");
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        if (
          parts.length !== 2 ||
          !Number.isInteger(x) ||
          !Number.isInteger(y)
        ) {
          throw new TypeError(label + " contains an invalid cell key: " + entry + ".");
        }
        keys.add(entry);
        continue;
      }
      if (
        entry === null ||
        typeof entry !== "object" ||
        !Number.isInteger(entry.x) ||
        !Number.isInteger(entry.y)
      ) {
        throw new TypeError(label + " contains an invalid cell.");
      }
      keys.add(cellKeyOf(entry));
    }
    return keys;
  }

  function normalizeOccupancy(occupancy) {
    if (occupancy === undefined || occupancy === null) {
      return { blocked: new Set(), passThrough: new Set() };
    }
    if (typeof occupancy !== "object") {
      throw new TypeError("occupancy must be an object with optional cell sets.");
    }
    return {
      blocked: normalizeCellSet(occupancy.blockedCells, "occupancy.blockedCells"),
      passThrough: normalizeCellSet(
        occupancy.passThroughCells,
        "occupancy.passThroughCells",
      ),
    };
  }

  function terrainExtraFeet(map, x, y) {
    // Greater-difficult terrain adds +10 ft; ordinary difficult terrain adds
    // +5 ft. GridMap exposes the authoritative value; older maps fall back to
    // the legacy difficult-terrain boolean.
    if (typeof map.getTerrainExtraFeet === "function") {
      return map.getTerrainExtraFeet(x, y);
    }
    return typeof map.hasDifficultTerrain === "function" && map.hasDifficultTerrain(x, y)
      ? DIFFICULT_TERRAIN_EXTRA_FEET
      : 0;
  }

  function normalizeBudget(maxFeet) {
    if (typeof maxFeet !== "number" || !Number.isFinite(maxFeet) || maxFeet < 0) {
      throw new TypeError("maxFeet must be a non-negative finite number.");
    }
    return maxFeet;
  }

  function stateKey(x, y, parity) {
    return x + "," + y + "," + parity;
  }

  function heuristicFeet(x, y, goal, parity) {
    const dx = Math.abs(goal.x - x);
    const dy = Math.abs(goal.y - y);
    const diagonalCount = Math.min(dx, dy);
    const straightCount = Math.max(dx, dy) - diagonalCount;
    return (
      straightCount * FEET_PER_SQUARE +
      diagonalCount * FEET_PER_SQUARE +
      Math.floor((diagonalCount + parity) / 2) * FEET_PER_SQUARE
    );
  }

  function cornerAllows(map, x, y, dx, dy, policy) {
    if (policy === DIAGONAL_CORNER_POLICIES.ALLOW) {
      return true;
    }
    const sideA = map.isBlocked(x + dx, y);
    const sideB = map.isBlocked(x, y + dy);
    if (policy === DIAGONAL_CORNER_POLICIES.BLOCK_BOTH) {
      return !(sideA && sideB);
    }
    return !sideA && !sideB;
  }

  class MinHeap {
    constructor(compare) {
      this.items = [];
      this.compare = compare;
    }

    get size() {
      return this.items.length;
    }

    push(item) {
      const items = this.items;
      items.push(item);
      let index = items.length - 1;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (this.compare(items[index], items[parent]) >= 0) {
          break;
        }
        const swap = items[index];
        items[index] = items[parent];
        items[parent] = swap;
        index = parent;
      }
    }

    pop() {
      const items = this.items;
      if (items.length === 0) {
        return undefined;
      }
      const top = items[0];
      const last = items.pop();
      if (items.length > 0) {
        items[0] = last;
        let index = 0;
        for (;;) {
          const left = index * 2 + 1;
          const right = left + 1;
          let smallest = index;
          if (left < items.length && this.compare(items[left], items[smallest]) < 0) {
            smallest = left;
          }
          if (right < items.length && this.compare(items[right], items[smallest]) < 0) {
            smallest = right;
          }
          if (smallest === index) {
            break;
          }
          const swap = items[index];
          items[index] = items[smallest];
          items[smallest] = swap;
          index = smallest;
        }
      }
      return top;
    }
  }

  function openHeap() {
    return new MinHeap(function (a, b) {
      return a.f - b.f || a.h - b.h || a.g - b.g;
    });
  }

  function fail(reason) {
    return { found: false, reason: reason };
  }

  /**
   * @param {{x:number,y:number}} start
   * @param {{x:number,y:number}} goal
   * @param {{
   *   map: GridMap,
   *   startDiagonalParity?: number,
   *   diagonalCornerPolicy?: string,
   *   occupancy?: { blockedCells?: any, passThroughCells?: any },
   *   footprint?: number
   * }} options
   * @returns {{
   *   found: true,
   *   path: {x:number,y:number}[],
   *   costFeet: number,
   *   diagonalSteps: number,
   *   diagonalParity: number
   * } | { found: false, reason: string }}
   */
  function findPath(start, goal, options) {
    assertCell(start, "start");
    assertCell(goal, "goal");

    const opts = options || {};
    assertMap(opts.map);
    const map = opts.map;
    const startParity = normalizeParity(opts.startDiagonalParity);
    const policy = normalizePolicy(opts.diagonalCornerPolicy);
    const occupancy = normalizeOccupancy(opts.occupancy);
    const footprint = normalizeFootprint(opts.footprint);

    if (!map.isInBounds(start.x, start.y)) {
      return fail("out-of-bounds");
    }
    if (!map.isInBounds(goal.x, goal.y)) {
      return fail("out-of-bounds");
    }
    if (footprintImpassable(map, start.x, start.y, occupancy, footprint)) {
      return fail("blocked-start");
    }
    if (footprintImpassable(map, goal.x, goal.y, occupancy, footprint)) {
      return fail("blocked-goal");
    }
    if (footprintOverlapsSet(goal.x, goal.y, footprint, occupancy.passThrough)) {
      return fail("goal-occupied");
    }

    if (start.x === goal.x && start.y === goal.y) {
      return {
        found: true,
        path: [{ x: start.x, y: start.y }],
        costFeet: 0,
        diagonalSteps: 0,
        diagonalParity: startParity,
      };
    }

    const open = openHeap();
    const bestG = new Map();
    const closed = new Set();
    const startH = heuristicFeet(start.x, start.y, goal, startParity);
    const startNode = {
      x: start.x,
      y: start.y,
      parity: startParity,
      g: 0,
      h: startH,
      f: startH,
      parent: null,
    };

    open.push(startNode);
    bestG.set(stateKey(start.x, start.y, startParity), 0);

    let goalNode = null;

    while (open.size > 0) {
      const node = open.pop();
      const key = stateKey(node.x, node.y, node.parity);
      if (closed.has(key)) {
        continue;
      }
      closed.add(key);

      if (node.x === goal.x && node.y === goal.y) {
        goalNode = node;
        break;
      }

      for (const dir of DIRECTIONS) {
        const nx = node.x + dir.dx;
        const ny = node.y + dir.dy;

        if (footprintImpassable(map, nx, ny, occupancy, footprint)) {
          continue;
        }

        const diagonal = dir.dx !== 0 && dir.dy !== 0;
        if (diagonal && !cornerAllows(map, node.x, node.y, dir.dx, dir.dy, policy)) {
          continue;
        }

        const nextParity = diagonal ? 1 - node.parity : node.parity;
        const stepCost =
          (diagonal ? Grid.diagonalStepCostFeet(node.parity) : FEET_PER_SQUARE) +
          terrainExtraFeet(map, nx, ny);
        const tentativeG = node.g + stepCost;
        const nextKey = stateKey(nx, ny, nextParity);
        const knownG = bestG.get(nextKey);

        if (knownG !== undefined && tentativeG >= knownG) {
          continue;
        }

        const nextH = heuristicFeet(nx, ny, goal, nextParity);
        bestG.set(nextKey, tentativeG);
        open.push({
          x: nx,
          y: ny,
          parity: nextParity,
          g: tentativeG,
          h: nextH,
          f: tentativeG + nextH,
          parent: node,
        });
      }
    }

    if (goalNode === null) {
      return fail("no-path");
    }

    const path = [];
    let current = goalNode;
    while (current !== null) {
      path.push({ x: current.x, y: current.y });
      current = current.parent;
    }
    path.reverse();

    let diagonalSteps = 0;
    for (let i = 1; i < path.length; i += 1) {
      if (path[i].x !== path[i - 1].x && path[i].y !== path[i - 1].y) {
        diagonalSteps += 1;
      }
    }

    return {
      found: true,
      path: path,
      costFeet: goalNode.g,
      diagonalSteps: diagonalSteps,
      diagonalParity: goalNode.parity,
    };
  }

  /**
   * Dijkstra over the same (cell, diagonalParity) state space. Returns the
   * minimum cost to each in-bounds walkable cell within the budget.
   *
   * @param {GridMap} map
   * @param {{x:number,y:number}} origin
   * @param {number} maxFeet
   * @param {{
   *   startDiagonalParity?: number,
   *   diagonalCornerPolicy?: string,
   *   occupancy?: { blockedCells?: any, passThroughCells?: any },
   *   footprint?: number
   * }} [options]
   * @returns {{x:number,y:number,costFeet:number}[]}
   */
  function reachableCells(map, origin, maxFeet, options) {
    assertMap(map);
    assertCell(origin, "origin");
    normalizeBudget(maxFeet);

    if (!map.isInBounds(origin.x, origin.y)) {
      throw new RangeError("origin must be inside the map.");
    }

    const opts = options || {};
    const startParity = normalizeParity(opts.startDiagonalParity);
    const policy = normalizePolicy(opts.diagonalCornerPolicy);
    const occupancy = normalizeOccupancy(opts.occupancy);
    const footprint = normalizeFootprint(opts.footprint);

    if (footprintImpassable(map, origin.x, origin.y, occupancy, footprint)) {
      return [];
    }

    const open = new MinHeap(function (a, b) {
      return a.g - b.g || a.parity - b.parity;
    });
    const bestG = new Map();
    const bestCellCost = new Map();

    const startKey = stateKey(origin.x, origin.y, startParity);
    bestG.set(startKey, 0);
    open.push({ x: origin.x, y: origin.y, parity: startParity, g: 0 });

    while (open.size > 0) {
      const node = open.pop();
      const key = stateKey(node.x, node.y, node.parity);
      if (node.g !== bestG.get(key)) {
        continue;
      }

      const cell = node.x + "," + node.y;
      const knownCost = bestCellCost.get(cell);
      if (knownCost === undefined || node.g < knownCost) {
        bestCellCost.set(cell, node.g);
      }

      if (node.g >= maxFeet) {
        continue;
      }

      for (const dir of DIRECTIONS) {
        const nx = node.x + dir.dx;
        const ny = node.y + dir.dy;

        if (footprintImpassable(map, nx, ny, occupancy, footprint)) {
          continue;
        }

        const diagonal = dir.dx !== 0 && dir.dy !== 0;
        if (diagonal && !cornerAllows(map, node.x, node.y, dir.dx, dir.dy, policy)) {
          continue;
        }

        const nextParity = diagonal ? 1 - node.parity : node.parity;
        const stepCost =
          (diagonal ? Grid.diagonalStepCostFeet(node.parity) : FEET_PER_SQUARE) +
          terrainExtraFeet(map, nx, ny);
        const tentativeG = node.g + stepCost;

        if (tentativeG > maxFeet) {
          continue;
        }

        const nextKey = stateKey(nx, ny, nextParity);
        const knownG = bestG.get(nextKey);
        if (knownG !== undefined && tentativeG >= knownG) {
          continue;
        }

        bestG.set(nextKey, tentativeG);
        open.push({ x: nx, y: ny, parity: nextParity, g: tentativeG });
      }
    }

    const cells = [];
    for (const entry of bestCellCost) {
      const parts = entry[0].split(",");
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      if (x === origin.x && y === origin.y) {
        continue;
      }
      if (footprintOverlapsSet(x, y, footprint, occupancy.passThrough)) {
        continue;
      }
      cells.push({ x: x, y: y, costFeet: entry[1] });
    }

    cells.sort(function (a, b) {
      return a.y - b.y || a.x - b.x;
    });
    return cells;
  }

  return Object.freeze({
    DIAGONAL_CORNER_POLICIES: DIAGONAL_CORNER_POLICIES,
    findPath: findPath,
    reachableCells: reachableCells,
  });
});
