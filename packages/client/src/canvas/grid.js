/**
 * Shared Pathfinder 2e grid math.
 *
 * A scene cell is `gridSize` world pixels and represents 5 feet. Every layer
 * (ruler, drawings, walls, lights, tokens) derives snapping and distances from
 * this module so the numbers cannot drift apart.
 */

export const GRID_SIZE = 100;
export const FEET_PER_CELL = 5;

export function cellFromWorld(point, gridSize = GRID_SIZE) {
  const x = Number(point && point.x) || 0;
  const y = Number(point && point.y) || 0;
  return {
    col: Math.floor(x / gridSize),
    row: Math.floor(y / gridSize),
  };
}

/** Center of the cell that contains a world-space point. */
export function cellCenterFromWorld(point, gridSize = GRID_SIZE) {
  const cell = cellFromWorld(point, gridSize);
  return cellCenter(cell, gridSize);
}

export function cellCenter(cell, gridSize = GRID_SIZE) {
  return {
    x: cell.col * gridSize + gridSize / 2,
    y: cell.row * gridSize + gridSize / 2,
  };
}

/** Snap a world point to the nearest grid intersection (cell corner). */
export function snapToCorner(point, gridSize = GRID_SIZE) {
  return {
    x: Math.round((Number(point && point.x) || 0) / gridSize) * gridSize,
    y: Math.round((Number(point && point.y) || 0) / gridSize) * gridSize,
  };
}

/** Snap a world point to the nearest cell center. */
export function snapToCellCenter(point, gridSize = GRID_SIZE) {
  const x = Number(point && point.x) || 0;
  const y = Number(point && point.y) || 0;
  const nearestCol = Math.round((x - gridSize / 2) / gridSize);
  const nearestRow = Math.round((y - gridSize / 2) / gridSize);
  return {
    x: nearestCol * gridSize + gridSize / 2,
    y: nearestRow * gridSize + gridSize / 2,
  };
}

/**
 * Cells crossed by a Bresenham line from `startCell` to `endCell` inclusive.
 * The ruler walks this path so it follows the grid instead of cutting across
 * cell corners in a straight screen-space line.
 *
 * @param {{col:number,row:number}} startCell
 * @param {{col:number,row:number}} endCell
 * @returns {{col:number,row:number}[]}
 */
export function cellsBetween(startCell, endCell) {
  let x = Math.trunc(Number(startCell && startCell.col) || 0);
  let y = Math.trunc(Number(startCell && startCell.row) || 0);
  const targetX = Math.trunc(Number(endCell && endCell.col) || 0);
  const targetY = Math.trunc(Number(endCell && endCell.row) || 0);

  const dx = Math.abs(targetX - x);
  const dy = Math.abs(targetY - y);
  const stepX = x < targetX ? 1 : -1;
  const stepY = y < targetY ? 1 : -1;

  const cells = [];
  let error = dx - dy;
  for (;;) {
    cells.push({ col: x, row: y });
    if (x === targetX && y === targetY) {
      break;
    }
    const doubled = error * 2;
    if (doubled > -dy) {
      error -= dy;
      x += stepX;
    }
    if (doubled < dx) {
      error += dx;
      y += stepY;
    }
  }
  return cells;
}

/**
 * PF2e 5-10-5 diagonal measurement.
 *
 * `distance = (straight + floor(diagonal * 1.5)) * 5 ft`
 * (diagonal cells alternate 5/10 ft, which is exactly this formula).
 */
export function measureCells(startCell, endCell) {
  const dx = Math.abs((endCell.col || 0) - (startCell.col || 0));
  const dy = Math.abs((endCell.row || 0) - (startCell.row || 0));
  const diagonal = Math.min(dx, dy);
  const straight = Math.max(dx, dy) - diagonal;
  const cells = straight + Math.floor(diagonal * 1.5);
  return {
    dx,
    dy,
    straight,
    diagonal,
    cells,
  };
}

export function measureFeet(startCell, endCell, feetPerCell = FEET_PER_CELL) {
  return measureCells(startCell, endCell).cells * feetPerCell;
}

/** Convenience wrapper used by the PixiJS layers. */
export function createGrid(options = {}) {
  const gridSize = options.gridSize || GRID_SIZE;
  const feetPerCell = options.feetPerCell || FEET_PER_CELL;

  return {
    gridSize,
    feetPerCell,
    cellFromWorld: (point) => cellFromWorld(point, gridSize),
    cellCenter: (cell) => cellCenter(cell, gridSize),
    cellCenterFromWorld: (point) => cellCenterFromWorld(point, gridSize),
    snapToCorner: (point) => snapToCorner(point, gridSize),
    snapToCellCenter: (point) => snapToCellCenter(point, gridSize),
    cellsBetween: (startCell, endCell) => cellsBetween(startCell, endCell),
    measureCells: (startCell, endCell) => measureCells(startCell, endCell),
    measureFeet: (startCell, endCell) => measureFeet(startCell, endCell, feetPerCell),
    /** World-point distance in feet (uses the cells under both points). */
    feetBetween: (start, end) =>
      measureFeet(cellFromWorld(start, gridSize), cellFromWorld(end, gridSize), feetPerCell),
    pixelsToFeet: (pixels) => (pixels / gridSize) * feetPerCell,
    feetToPixels: (feet) => (feet / feetPerCell) * gridSize,
  };
}
