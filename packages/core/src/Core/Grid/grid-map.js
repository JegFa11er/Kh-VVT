/**
 * PF2E REMASTERED — GRID MAP (HEADLESS CORE)
 *
 * Static battlefield geometry: bounds, impassable cells, and difficult
 * terrain. Obstacles and terrain are deliberately data-only; rendering and
 * input live in View.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.GridMap = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function assertPositiveInteger(value, label) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new TypeError(label + " must be a positive integer; received " + String(value) + ".");
    }
  }

  function cellKey(x, y) {
    return x + "," + y;
  }

  /**
   * Light levels used by the sight/sense engine. Every cell defaults to
   * bright; only non-bright cells are stored in the sparse illumination map.
   */
  const ILLUMINATION_LEVELS = Object.freeze({
    BRIGHT: "bright",
    DIM: "dim",
    DARKNESS: "darkness",
  });

  const ILLUMINATION_VALUES = Object.freeze([
    ILLUMINATION_LEVELS.BRIGHT,
    ILLUMINATION_LEVELS.DIM,
    ILLUMINATION_LEVELS.DARKNESS,
  ]);

  /**
   * Movement terrain classes. "difficult" costs +5 ft per entered square;
   * "greater-difficult" costs +10 ft per entered square (so the first square
   * into it costs 15 ft). The default class is "normal" (+0 ft).
   */
  const TERRAIN_TYPES = Object.freeze({
    NORMAL: "normal",
    DIFFICULT: "difficult",
    GREATER_DIFFICULT: "greater-difficult",
  });

  const TERRAIN_VALUES = Object.freeze([
    TERRAIN_TYPES.NORMAL,
    TERRAIN_TYPES.DIFFICULT,
    TERRAIN_TYPES.GREATER_DIFFICULT,
  ]);

  const TERRAIN_EXTRA_FEET = Object.freeze({
    normal: 0,
    difficult: 5,
    "greater-difficult": 10,
  });

  function normalizeTerrainType(type, label) {
    if (typeof type !== "string") {
      throw new TypeError(label + " must be a terrain type string.");
    }
    const value = type.trim().toLowerCase();
    if (TERRAIN_VALUES.indexOf(value) === -1) {
      throw new RangeError(
        label +
          ' must be "normal", "difficult", or "greater-difficult".',
      );
    }
    return value;
  }

  function normalizeIlluminationLevel(level, label) {
    if (typeof level !== "string") {
      throw new TypeError(label + " must be a light level string.");
    }
    const value = level.trim().toLowerCase();
    if (ILLUMINATION_VALUES.indexOf(value) === -1) {
      throw new RangeError(
        label + ' must be "bright", "dim", or "darkness".',
      );
    }
    return value;
  }

  function sortedCells(keys) {
    const cells = [];
    for (const key of keys) {
      const parts = key.split(",");
      cells.push({ x: Number(parts[0]), y: Number(parts[1]) });
    }
    cells.sort(function (a, b) {
      return a.y - b.y || a.x - b.x;
    });
    return cells;
  }

  class GridMap {
    constructor(options) {
      const opts = options || {};
      this.cols = opts.cols === undefined ? 15 : opts.cols;
      this.rows = opts.rows === undefined ? 15 : opts.rows;
      assertPositiveInteger(this.cols, "cols");
      assertPositiveInteger(this.rows, "rows");

      this.blocked = new Set();
      this.difficult = new Set();
      // Greater-difficult terrain (+10 ft). Kept as a sibling set so the
      // legacy `difficult` set keeps its exact "difficult" semantics.
      this.greaterDifficult = new Set();
      // Sparse per-cell hazardous terrain: key -> { damage, type }.
      this.hazardous = new Map();
      // Sparse per-cell illumination. A missing entry means bright light.
      this.illumination = new Map();

      if (opts.illumination !== undefined) {
        if (!Array.isArray(opts.illumination)) {
          throw new TypeError(
            "illumination must be an array of { x, y, level } cells.",
          );
        }
        for (const entry of opts.illumination) {
          if (entry === null || typeof entry !== "object") {
            throw new TypeError("illumination entries must be objects.");
          }
          const level =
            entry.level === undefined ? entry.illumination : entry.level;
          this.setIllumination(entry.x, entry.y, level);
        }
      }

      if (opts.dim !== undefined) {
        if (!Array.isArray(opts.dim)) {
          throw new TypeError("dim must be an array of cells.");
        }
        for (const cell of opts.dim) {
          this.setIllumination(cell.x, cell.y, ILLUMINATION_LEVELS.DIM);
        }
      }

      if (opts.darkness !== undefined) {
        if (!Array.isArray(opts.darkness)) {
          throw new TypeError("darkness must be an array of cells.");
        }
        for (const cell of opts.darkness) {
          this.setIllumination(cell.x, cell.y, ILLUMINATION_LEVELS.DARKNESS);
        }
      }

      if (opts.blocked !== undefined) {
        if (!Array.isArray(opts.blocked)) {
          throw new TypeError("blocked must be an array of cells.");
        }
        for (const cell of opts.blocked) {
          this.setBlocked(cell.x, cell.y, true);
        }
      }

      if (opts.difficult !== undefined) {
        if (!Array.isArray(opts.difficult)) {
          throw new TypeError("difficult must be an array of cells.");
        }
        for (const cell of opts.difficult) {
          this.setDifficultTerrain(cell.x, cell.y, true);
        }
      }

      if (opts.terrain !== undefined) {
        if (!Array.isArray(opts.terrain)) {
          throw new TypeError("terrain must be an array of { x, y, type } cells.");
        }
        for (const cell of opts.terrain) {
          this.setTerrain(cell.x, cell.y, cell.type);
        }
      }

      if (opts.hazardous !== undefined) {
        if (!Array.isArray(opts.hazardous)) {
          throw new TypeError("hazardous must be an array of hazard cells.");
        }
        for (const cell of opts.hazardous) {
          this.setHazardous(cell.x, cell.y, cell);
        }
      }
    }

    /**
     * Build a map from ASCII rows.
     *
     * Characters listed in `blockedChars` are impassable. Characters listed in
     * `options.difficultChars` are difficult terrain (blocked cells win when a
     * character is listed in both sets).
     *
     * @param {string[]} rows
     * @param {string} [blockedChars]
     * @param {{ difficultChars?: string }} [options]
     * @returns {GridMap}
     */
    static fromAscii(rows, blockedChars, options) {
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new TypeError("rows must be a non-empty array of strings.");
      }

      const cols = rows[0].length;
      if (cols === 0) {
        throw new RangeError("ASCII map rows must not be empty.");
      }

      const chars = blockedChars === undefined ? "#" : blockedChars;
      if (typeof chars !== "string" || chars.length === 0) {
        throw new TypeError("blockedChars must be a non-empty string.");
      }

      const opts = options || {};
      const difficultChars = opts.difficultChars === undefined ? "" : opts.difficultChars;
      if (typeof difficultChars !== "string") {
        throw new TypeError("difficultChars must be a string.");
      }

      const blocked = [];
      const difficult = [];
      for (let y = 0; y < rows.length; y += 1) {
        const row = rows[y];
        if (typeof row !== "string" || row.length !== cols) {
          throw new RangeError("All ASCII map rows must have the same length.");
        }
        for (let x = 0; x < cols; x += 1) {
          if (chars.indexOf(row[x]) !== -1) {
            blocked.push({ x: x, y: y });
          } else if (difficultChars.indexOf(row[x]) !== -1) {
            difficult.push({ x: x, y: y });
          }
        }
      }

      return new GridMap({
        cols: cols,
        rows: rows.length,
        blocked: blocked,
        difficult: difficult,
      });
    }

    isInBounds(x, y) {
      return (
        Number.isInteger(x) &&
        Number.isInteger(y) &&
        x >= 0 &&
        y >= 0 &&
        x < this.cols &&
        y < this.rows
      );
    }

    hasObstacle(x, y) {
      return this.blocked.has(cellKey(x, y));
    }

    /**
     * True when entering the cell costs an additional 5 feet. The origin cell
     * of a move never charges terrain; only entering a square does.
     */
    hasDifficultTerrain(x, y) {
      return this.difficult.has(cellKey(x, y));
    }

    /**
     * True when a creature cannot occupy the cell. Out-of-bounds cells count
     * as blocked so pathfinding and corner checks can use one predicate.
     */
    isBlocked(x, y) {
      return !this.isInBounds(x, y) || this.hasObstacle(x, y);
    }

    setBlocked(x, y, blocked) {
      if (!this.isInBounds(x, y)) {
        throw new RangeError("Cannot modify a blocked cell outside the map.");
      }
      if (blocked === false) {
        this.blocked.delete(cellKey(x, y));
      } else {
        this.blocked.add(cellKey(x, y));
      }
      return this;
    }

    setDifficultTerrain(x, y, difficult) {
      if (!this.isInBounds(x, y)) {
        throw new RangeError("Cannot modify terrain outside the map.");
      }
      if (difficult === false) {
        this.difficult.delete(cellKey(x, y));
      } else {
        this.difficult.add(cellKey(x, y));
      }
      return this;
    }

    /**
     * Set the movement terrain class of a cell. "normal" clears any override;
     * "difficult" and "greater-difficult" are mutually exclusive.
     *
     * @param {number} x
     * @param {number} y
     * @param {"normal"|"difficult"|"greater-difficult"} type
     * @returns {GridMap}
     */
    setTerrain(x, y, type) {
      if (!this.isInBounds(x, y)) {
        throw new RangeError("Cannot modify terrain outside the map.");
      }
      const value = normalizeTerrainType(type, "terrain type");
      const key = cellKey(x, y);
      if (value === TERRAIN_TYPES.GREATER_DIFFICULT) {
        this.greaterDifficult.add(key);
        this.difficult.delete(key);
      } else if (value === TERRAIN_TYPES.DIFFICULT) {
        this.difficult.add(key);
        this.greaterDifficult.delete(key);
      } else {
        this.difficult.delete(key);
        this.greaterDifficult.delete(key);
      }
      return this;
    }

    /**
     * Movement terrain class of a cell. Untouched cells read as "normal".
     *
     * @param {number} x
     * @param {number} y
     * @returns {"normal"|"difficult"|"greater-difficult"}
     */
    getTerrain(x, y) {
      const key = cellKey(x, y);
      if (this.greaterDifficult.has(key)) {
        return TERRAIN_TYPES.GREATER_DIFFICULT;
      }
      if (this.difficult.has(key)) {
        return TERRAIN_TYPES.DIFFICULT;
      }
      return TERRAIN_TYPES.NORMAL;
    }

    /**
     * Extra movement cost (in feet) for entering a cell, on top of the base
     * straight/diagonal step cost.
     *
     * @param {number} x
     * @param {number} y
     * @returns {number} 0 (normal), 5 (difficult), or 10 (greater-difficult)
     */
    getTerrainExtraFeet(x, y) {
      return TERRAIN_EXTRA_FEET[this.getTerrain(x, y)];
    }

    /**
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    hasGreaterDifficultTerrain(x, y) {
      return this.greaterDifficult.has(cellKey(x, y));
    }

    /**
     * Whether entering the cell costs any extra movement (difficult or
     * greater-difficult). Step cannot enter either.
     *
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    isDifficultTerrain(x, y) {
      return this.getTerrain(x, y) !== TERRAIN_TYPES.NORMAL;
    }

    /**
     * Set hazardous terrain on a cell. `hazardSpec` is a damage contract such
     * as `{ damage: "1d6", type: "fire" }` or `{ damageSpec: { formula, type } }`.
     * Passing a falsy spec clears the hazard.
     *
     * @param {number} x
     * @param {number} y
     * @param {object|null} [hazardSpec]
     * @returns {GridMap}
     */
    setHazardous(x, y, hazardSpec) {
      if (!this.isInBounds(x, y)) {
        throw new RangeError("Cannot modify hazardous terrain outside the map.");
      }
      const key = cellKey(x, y);
      if (!hazardSpec) {
        this.hazardous.delete(key);
        return this;
      }
      if (hazardSpec === null || typeof hazardSpec !== "object" || Array.isArray(hazardSpec)) {
        throw new TypeError("hazardous terrain must be an object with a damage formula.");
      }
      const nested =
        hazardSpec.damageSpec !== undefined &&
        hazardSpec.damageSpec !== null &&
        typeof hazardSpec.damageSpec === "object"
          ? hazardSpec.damageSpec
          : null;
      const formula =
        hazardSpec.damage !== undefined
          ? hazardSpec.damage
          : hazardSpec.formula !== undefined
            ? hazardSpec.formula
            : nested && nested.formula !== undefined
              ? nested.formula
              : nested && nested.damage !== undefined
                ? nested.damage
                : undefined;
      const type =
        hazardSpec.type !== undefined
          ? hazardSpec.type
          : nested && nested.type !== undefined
            ? nested.type
            : undefined;

      if (typeof formula !== "string" || formula.trim() === "") {
        throw new TypeError("hazardous terrain requires a non-empty damage formula.");
      }
      this.hazardous.set(key, {
        damage: formula.trim(),
        type: type === undefined || type === null ? "untyped" : String(type).toLowerCase(),
      });
      return this;
    }

    /**
     * Hazardous terrain record for a cell, or null when the cell is safe.
     *
     * @param {number} x
     * @param {number} y
     * @returns {{damage:string,type:string}|null}
     */
    getHazardous(x, y) {
      const record = this.hazardous.get(cellKey(x, y));
      return record === undefined ? null : { damage: record.damage, type: record.type };
    }

    /**
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    hasHazardous(x, y) {
      return this.hazardous.has(cellKey(x, y));
    }

    /**
     * Every hazardous cell, sorted by row then column.
     *
     * @returns {{x:number,y:number,damage:string,type:string}[]}
     */
    getHazardousCells() {
      const cells = [];
      for (const entry of this.hazardous) {
        const parts = entry[0].split(",");
        cells.push({
          x: Number(parts[0]),
          y: Number(parts[1]),
          damage: entry[1].damage,
          type: entry[1].type,
        });
      }
      cells.sort(function (a, b) {
        return a.y - b.y || a.x - b.x;
      });
      return cells;
    }

    /**
     * Set the light level of a cell. `"bright"` removes the stored override,
     * because bright is the map-wide default.
     *
     * @param {number} x
     * @param {number} y
     * @param {"bright"|"dim"|"darkness"} level
     * @returns {GridMap}
     */
    setIllumination(x, y, level) {
      if (!this.isInBounds(x, y)) {
        throw new RangeError("Cannot modify illumination outside the map.");
      }
      const value = normalizeIlluminationLevel(level, "illumination level");
      if (value === ILLUMINATION_LEVELS.BRIGHT) {
        this.illumination.delete(cellKey(x, y));
      } else {
        this.illumination.set(cellKey(x, y), value);
      }
      return this;
    }

    /**
     * Light level of a cell. Out-of-bounds cells and untouched cells read as
     * `"bright"`, matching the map-wide default.
     *
     * @param {number} x
     * @param {number} y
     * @returns {"bright"|"dim"|"darkness"}
     */
    getIllumination(x, y) {
      const value = this.illumination.get(cellKey(x, y));
      return value === undefined ? ILLUMINATION_LEVELS.BRIGHT : value;
    }

    /**
     * Every cell at a given light level, sorted by row then column. The
     * `"bright"` query enumerates the whole grid minus the authored overrides.
     *
     * @param {"bright"|"dim"|"darkness"} level
     * @returns {{x:number,y:number}[]}
     */
    getIlluminationCells(level) {
      const value = normalizeIlluminationLevel(level, "illumination level");
      if (value === ILLUMINATION_LEVELS.BRIGHT) {
        const cells = [];
        for (let y = 0; y < this.rows; y += 1) {
          for (let x = 0; x < this.cols; x += 1) {
            if (!this.illumination.has(cellKey(x, y))) {
              cells.push({ x: x, y: y });
            }
          }
        }
        return cells;
      }

      const cells = [];
      for (const entry of this.illumination) {
        if (entry[1] === value) {
          const parts = entry[0].split(",");
          cells.push({ x: Number(parts[0]), y: Number(parts[1]) });
        }
      }
      cells.sort(function (a, b) {
        return a.y - b.y || a.x - b.x;
      });
      return cells;
    }

    /**
     * @returns {{x:number,y:number}[]}
     */
    getBlockedCells() {
      return sortedCells(this.blocked);
    }

    /**
     * @returns {{x:number,y:number}[]}
     */
    getDifficultTerrainCells() {
      return sortedCells(this.difficult);
    }

    /**
     * @returns {{x:number,y:number}[]}
     */
    getGreaterDifficultTerrainCells() {
      return sortedCells(this.greaterDifficult);
    }

    clone() {
      const copy = new GridMap({ cols: this.cols, rows: this.rows });
      for (const key of this.blocked) {
        copy.blocked.add(key);
      }
      for (const key of this.difficult) {
        copy.difficult.add(key);
      }
      for (const key of this.greaterDifficult) {
        copy.greaterDifficult.add(key);
      }
      for (const entry of this.hazardous) {
        copy.hazardous.set(entry[0], { damage: entry[1].damage, type: entry[1].type });
      }
      for (const entry of this.illumination) {
        copy.illumination.set(entry[0], entry[1]);
      }
      return copy;
    }

    toAscii(blockedChar, floorChar, difficultChar) {
      const wall = blockedChar === undefined ? "#" : blockedChar;
      const floor = floorChar === undefined ? "." : floorChar;
      const tough = difficultChar === undefined ? floor : difficultChar;
      const rows = [];
      for (let y = 0; y < this.rows; y += 1) {
        let row = "";
        for (let x = 0; x < this.cols; x += 1) {
          if (this.hasObstacle(x, y)) {
            row += wall;
          } else {
            row +=
              this.hasDifficultTerrain(x, y) || this.hasGreaterDifficultTerrain(x, y)
                ? tough
                : floor;
          }
        }
        rows.push(row);
      }
      return rows;
    }
  }

  GridMap.ILLUMINATION_LEVELS = ILLUMINATION_LEVELS;
  GridMap.ILLUMINATION_VALUES = ILLUMINATION_VALUES;
  GridMap.normalizeIlluminationLevel = normalizeIlluminationLevel;
  GridMap.TERRAIN_TYPES = TERRAIN_TYPES;
  GridMap.TERRAIN_VALUES = TERRAIN_VALUES;
  GridMap.TERRAIN_EXTRA_FEET = TERRAIN_EXTRA_FEET;
  GridMap.normalizeTerrainType = normalizeTerrainType;

  return GridMap;
});
