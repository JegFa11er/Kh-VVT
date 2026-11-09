/**
 * PF2E REMASTERED — LINE OF SIGHT (HEADLESS CORE)
 *
 * Pure center-to-center raycasting on the square grid. The ray runs from the
 * centre of the origin cell to the centre of the target cell and collects every
 * cell it touches.
 *
 * Corner-touch policy: a ray that passes exactly through a grid vertex also
 * touches the two orthogonal cells at that vertex, and any solid obstacle
 * among them blocks sight. This mirrors the project-canonical "block-any"
 * diagonal movement policy. It is intentionally conservative and deterministic.
 *
 * Creature occupancy and cover degrees are not part of this module.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.LosMath = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EPSILON = 1e-9;

  function assertCell(cell, label) {
    if (cell === null || typeof cell !== "object") {
      throw new TypeError(label + " must be a cell object { x, y }.");
    }
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) {
      throw new TypeError(label + " must contain integer coordinates.");
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

  function sameCell(a, b) {
    return a.x === b.x && a.y === b.y;
  }

  function addCell(cells, seen, x, y) {
    const key = x + "," + y;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    cells.push({ x: x, y: y });
  }

  function crossingsFor(from, to) {
    const x0 = from.x + 0.5;
    const y0 = from.y + 0.5;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const crossings = [];

    if (dx !== 0) {
      if (dx > 0) {
        for (let k = from.x + 1; k <= to.x; k += 1) {
          crossings.push({ t: (k - x0) / dx, axis: "x", coord: k });
        }
      } else {
        for (let k = from.x; k >= to.x + 1; k -= 1) {
          crossings.push({ t: (k - x0) / dx, axis: "x", coord: k });
        }
      }
    }
    if (dy !== 0) {
      if (dy > 0) {
        for (let k = from.y + 1; k <= to.y; k += 1) {
          crossings.push({ t: (k - y0) / dy, axis: "y", coord: k });
        }
      } else {
        for (let k = from.y; k >= to.y + 1; k -= 1) {
          crossings.push({ t: (k - y0) / dy, axis: "y", coord: k });
        }
      }
    }

    crossings.sort(function (a, b) {
      return a.t - b.t;
    });
    return crossings;
  }

  function groupCrossings(crossings) {
    const groups = [];
    for (const crossing of crossings) {
      const last = groups[groups.length - 1];
      if (last && Math.abs(crossing.t - last.t) <= EPSILON) {
        last.items.push(crossing);
      } else {
        groups.push({ t: crossing.t, items: [crossing] });
      }
    }
    return groups;
  }

  /**
   * Every grid cell touched by the centre-to-centre segment. Cells touched only
   * at a corner are included (conservative supercover semantics).
   *
   * @param {{x:number,y:number}} from
   * @param {{x:number,y:number}} to
   * @returns {{x:number,y:number}[]}
   */
  function lineCells(from, to) {
    assertCell(from, "from");
    assertCell(to, "to");

    const cells = [];
    const seen = new Set();
    addCell(cells, seen, from.x, from.y);

    if (sameCell(from, to)) {
      return cells;
    }

    const x0 = from.x + 0.5;
    const y0 = from.y + 0.5;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const groups = groupCrossings(crossingsFor(from, to));

    // A vertex is touched by both the vertical and horizontal grid lines.
    for (const group of groups) {
      let xCoord = null;
      let yCoord = null;
      for (const item of group.items) {
        if (item.axis === "x") {
          xCoord = item.coord;
        } else {
          yCoord = item.coord;
        }
      }
      if (xCoord !== null && yCoord !== null) {
        addCell(cells, seen, xCoord - 1, yCoord - 1);
        addCell(cells, seen, xCoord, yCoord - 1);
        addCell(cells, seen, xCoord - 1, yCoord);
        addCell(cells, seen, xCoord, yCoord);
      }
    }

    // Sample the midpoint of every interval between consecutive crossings.
    const boundaries = [0];
    for (const group of groups) {
      boundaries.push(group.t);
    }
    boundaries.push(1);

    for (let index = 1; index < boundaries.length; index += 1) {
      const start = boundaries[index - 1];
      const end = boundaries[index];
      if (end - start <= EPSILON) {
        continue;
      }
      const mid = (start + end) / 2;
      addCell(cells, seen, Math.floor(x0 + dx * mid), Math.floor(y0 + dy * mid));
    }

    addCell(cells, seen, to.x, to.y);
    return cells;
  }

  /**
   * @param {{x:number,y:number}} from
   * @param {{x:number,y:number}} to
   * @param {object} map
   * @returns {{
   *   visible: boolean,
   *   blockedBy: {x:number,y:number} | null,
   *   blockedCells: {x:number,y:number}[],
   *   cells: {x:number,y:number}[]
   * }}
   */
  function traceLineOfSight(from, to, map) {
    assertCell(from, "from");
    assertCell(to, "to");
    assertMap(map);

    if (sameCell(from, to)) {
      return {
        visible: true,
        blockedBy: null,
        blockedCells: [],
        cells: [{ x: from.x, y: from.y }],
      };
    }

    const cells = lineCells(from, to);
    const blockedCells = cells.filter(function (cell) {
      return isObstacle(map, cell.x, cell.y);
    });

    return {
      visible: blockedCells.length === 0,
      blockedBy: blockedCells.length > 0 ? blockedCells[0] : null,
      blockedCells: blockedCells,
      cells: cells,
    };
  }

  /**
   * @param {{x:number,y:number}} from
   * @param {{x:number,y:number}} to
   * @param {object} map
   * @returns {boolean}
   */
  function hasLineOfSight(from, to, map) {
    return traceLineOfSight(from, to, map).visible;
  }

  return Object.freeze({
    lineCells: lineCells,
    traceLineOfSight: traceLineOfSight,
    hasLineOfSight: hasLineOfSight,
  });
});
