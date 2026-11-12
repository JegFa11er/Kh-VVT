import { Container, Graphics } from "pixi.js";

/**
 * Draws square grid lines for a PF2e map.
 *
 * Each PF2e square is 5 feet, so a map that is 120 ft wide is 24 cells.
 */
export class GridLayer extends Container {
  constructor(options = {}) {
    super();
    this.label = "grid";

    this.cellSize = options.cellSize || 70;
    this.cols = options.cols || 24;
    this.rows = options.rows || 16;
    this.color = options.color === undefined ? 0x39404f : options.color;
    this.alpha = options.alpha === undefined ? 0.8 : options.alpha;
    this.thickness = options.thickness || 1;
    // Step 6.3: a scene background image must stay visible under the grid, so
    // the layer exposes its dark fill opacity.
    this.fillAlpha = options.fillAlpha === undefined ? 0.55 : options.fillAlpha;

    this.graphics = new Graphics();
    this.addChild(this.graphics);
    this.draw();
  }

  resize(cols, rows, cellSize) {
    this.cols = cols || this.cols;
    this.rows = rows || this.rows;
    this.cellSize = cellSize || this.cellSize;
    this.draw();
  }

  setFillAlpha(alpha) {
    const next = Number(alpha);
    this.fillAlpha = Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : 0.55;
    this.draw();
  }

  draw() {
    const g = this.graphics;
    const width = this.cols * this.cellSize;
    const height = this.rows * this.cellSize;

    g.clear();
    if (this.fillAlpha > 0) {
      g.rect(0, 0, width, height).fill({
        color: 0x1a1e27,
        alpha: this.fillAlpha,
      });
    }

    for (let col = 1; col < this.cols; col += 1) {
      const x = col * this.cellSize;
      g.moveTo(x, 0).lineTo(x, height);
    }

    for (let row = 1; row < this.rows; row += 1) {
      const y = row * this.cellSize;
      g.moveTo(0, y).lineTo(width, y);
    }

    g.stroke({ color: this.color, width: this.thickness, alpha: this.alpha });
    g.rect(0, 0, width, height).stroke({ color: this.color, width: this.thickness * 2, alpha: this.alpha });
  }

  /** Convert world coordinates to grid cell coordinates. */
  worldToCell(x, y) {
    return { col: Math.floor(x / this.cellSize), row: Math.floor(y / this.cellSize) };
  }

  /** Convert grid cell coordinates to the cell's top-left world position. */
  cellToWorld(col, row) {
    return { x: col * this.cellSize, y: row * this.cellSize };
  }
}
