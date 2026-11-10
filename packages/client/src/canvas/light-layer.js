import { Container, Graphics, Text } from "pixi.js";

import { computePolygon } from "./math.js";

const DARKNESS_ALPHA = {
  light: 0,
  dim: 0.4,
  dark: 0.8,
};

/** Radius in world pixels used for the drag preview shadow polygon. */
const PREVIEW_ARC_SAMPLES = 96;

/**
 * Light sources and scene darkness.
 *
 * Drawing a light drags out its radius. Sources render as warm polygons that
 * are clipped by the scene walls through the raycast shadow caster
 * (`computePolygon(..., "light")`); the bright core is a second, smaller
 * polygon. The same polygons are baked into an inverse mask on the darkness
 * overlay, so lit areas punch holes in the black scene tint instead of
 * ignoring walls. Double-clicking the bulb icon edits the PF2e bright/dim
 * radii in feet. The darkness level and GM vision follow the toolbar events.
 */
export class LightLayer extends Container {
  constructor(app, viewport, grid, options = {}) {
    super();
    this.label = "lights";
    this.app = app;
    this.viewport = viewport;
    this.grid = grid;

    /**
     * Source of truth for wall geometry. Either a `WallLayer` (preferred) or
     * a plain wall array (tests / headless use).
     */
    this.wallLayer = options.wallLayer || null;
    this.walls = Array.isArray(options.walls) ? options.walls : [];

    // The darkness overlay is a container so the inverse light mask can be a
    // child of the masked subtree (PixiJS requirement for correct bounds).
    this.darknessContainer = new Container();
    this.darknessContainer.label = "lights:darkness";

    this.darknessGraphics = new Graphics();
    this.darknessGraphics.label = "lights:darkness:fill";
    this.darknessGraphics.eventMode = "none";

    this.lightMaskGraphics = new Graphics();
    this.lightMaskGraphics.label = "lights:darkness:mask";
    this.lightMaskGraphics.eventMode = "none";

    this.darknessContainer.addChild(this.darknessGraphics, this.lightMaskGraphics);
    // Inverse mask: the black rectangle stays everywhere except where a light
    // polygon was drawn into the mask.
    this.darknessContainer.setMask({
      mask: this.lightMaskGraphics,
      inverse: true,
    });

    this.storage = new Container();
    this.storage.label = "lights:sources";
    this.selection = new Graphics();
    this.selection.label = "lights:selection";
    this.preview = new Graphics();
    this.preview.label = "lights:preview";

    this.addChild(
      this.darknessContainer,
      this.storage,
      this.selection,
      this.preview,
    );

    /** @type {Array<{id:string,x:number,y:number,brightFeet:number,dimFeet:number}>} */
    this.sources = [];
    this._sequence = 0;
    this.darknessLevel = "light";
    this.gmVision = false;
    // The bulb marker is an editing affordance: it is only visible while the
    // Lighting category is open (Step 4.8 canvas polish).
    this.activeCategory = "token";
    this.selectedIds = new Set();

    this.activeStart = null;
    this.activeWorld = null;
    this.dragSource = null;
    this.dragOffset = { x: 0, y: 0 };

    this.darknessGraphics
      .rect(-100000, -100000, 200000, 200000)
      .fill({ color: 0x000000, alpha: 1 });
    this._renderDarknessMask();
    this._applyDarkness();
  }

  get _zoom() {
    return this.viewport && this.viewport.zoom ? this.viewport.zoom : 1;
  }

  /** Attach the live wall layer used to clip every light polygon. */
  setWallLayer(wallLayer) {
    this.wallLayer = wallLayer || null;
    this.renderAll();
  }

  _wallList() {
    if (this.wallLayer && Array.isArray(this.wallLayer.walls)) {
      return this.wallLayer.walls;
    }
    return Array.isArray(this.walls) ? this.walls : [];
  }

  /** Wall-clipped shadow polygon for one radius (Step 5.2). */
  polygonFor(origin, radius, arcSamples = undefined) {
    const options =
      Number.isFinite(arcSamples) && arcSamples > 0
        ? { arcSamples: arcSamples }
        : undefined;
    return computePolygon(
      origin,
      radius,
      this._wallList(),
      "light",
      options,
    );
  }

  _applyDarkness() {
    const base = DARKNESS_ALPHA[this.darknessLevel] || 0;
    // The GM can see the map through the overlay; players keep full darkness.
    this.darknessContainer.alpha = this.gmVision ? base * 0.35 : base;
  }

  setDarkness(level) {
    if (!Object.prototype.hasOwnProperty.call(DARKNESS_ALPHA, level)) {
      return;
    }
    this.darknessLevel = level;
    this._applyDarkness();
  }

  setGmVision(enabled) {
    this.gmVision = Boolean(enabled);
    this._applyDarkness();
  }

  /** Show/hide the 💡 editing markers as the toolbar category changes. */
  setActiveCategory(category) {
    this.activeCategory = typeof category === "string" ? category : null;
    this.renderAll();
  }

  begin(worldPoint) {
    this.activeStart = this.grid.snapToCellCenter(worldPoint);
    this.activeWorld = { x: worldPoint.x, y: worldPoint.y };
    this.preview.clear();
    this._renderPreview();
  }

  update(worldPoint) {
    if (!this.activeStart) {
      return;
    }
    this.activeWorld = { x: worldPoint.x, y: worldPoint.y };
    this._renderPreview();
  }

  end(worldPoint) {
    if (!this.activeStart) {
      return;
    }
    if (worldPoint) {
      this.activeWorld = { x: worldPoint.x, y: worldPoint.y };
    }
    if (this.activeWorld) {
      const radius = Math.hypot(
        this.activeWorld.x - this.activeStart.x,
        this.activeWorld.y - this.activeStart.y,
      );
      if (radius >= this.grid.gridSize * 0.15) {
        // The drag length is the DIM radius, pixel-exact (no cell rounding).
        // Bright light is always half of the dim radius.
        const dimFeet = this.grid.pixelsToFeet(radius);
        const brightFeet = dimFeet / 2;
        this._sequence += 1;
        this.sources.push({
          id: "light-" + this._sequence,
          x: this.activeStart.x,
          y: this.activeStart.y,
          brightFeet: brightFeet,
          dimFeet: dimFeet,
        });
        this.renderAll();
      }
    }
    this.activeStart = null;
    this.activeWorld = null;
    this.preview.clear();
  }

  cancelPreview() {
    this.activeStart = null;
    this.activeWorld = null;
    this.preview.clear();
  }

  _renderPreview() {
    const g = this.preview;
    g.clear();
    if (!this.activeStart || !this.activeWorld) {
      return;
    }
    // The pointer distance defines the dim radius exactly; bright is dim / 2.
    const dimRadius = Math.hypot(
      this.activeWorld.x - this.activeStart.x,
      this.activeWorld.y - this.activeStart.y,
    );
    const brightRadius = dimRadius / 2;
    const width = Math.max(1, 2 / this._zoom);
    const origin = { x: this.activeStart.x, y: this.activeStart.y };
    const dimPolygon = this.polygonFor(origin, dimRadius, PREVIEW_ARC_SAMPLES);
    const brightPolygon = this.polygonFor(origin, brightRadius, PREVIEW_ARC_SAMPLES);
    this._drawPolygon(g, dimPolygon, {
      fill: { color: 0xffbb55, alpha: 0.1 },
      stroke: { color: 0xffd166, width, alpha: 0.9 },
    });
    this._drawPolygon(g, brightPolygon, {
      fill: { color: 0xffd166, alpha: 0.16 },
      stroke: { color: 0xffe0a3, width, alpha: 0.7 },
    });
    g.circle(this.activeStart.x, this.activeStart.y, Math.max(3, 5 / this._zoom))
      .fill({ color: 0xffd166, alpha: 1 });
  }

  /** Draw a raycast polygon (`[]` is silently skipped). */
  _drawPolygon(graphics, points, style = {}) {
    if (!Array.isArray(points) || points.length < 3) {
      return false;
    }
    const flat = [];
    for (const point of points) {
      flat.push(point.x, point.y);
    }
    graphics.poly(flat);
    if (style.fill) {
      graphics.fill(style.fill);
    }
    if (style.stroke) {
      graphics.stroke(style.stroke);
    }
    return true;
  }

  /**
   * Rebuild the union of every light polygon inside the inverse darkness mask.
   * Areas covered by the mask become transparent, i.e. walls now cast shadows
   * instead of the old plain circle glow.
   */
  _renderDarknessMask() {
    const mask = this.lightMaskGraphics;
    if (!mask) {
      return;
    }
    mask.clear();
    for (const source of this.sources) {
      const origin = { x: source.x, y: source.y };
      const dimRadius = this.grid.feetToPixels(source.dimFeet);
      const brightRadius = this.grid.feetToPixels(source.brightFeet);
      for (const radius of [dimRadius, brightRadius]) {
        const points = this.polygonFor(origin, radius);
        if (points.length >= 3) {
          const flat = [];
          for (const point of points) {
            flat.push(point.x, point.y);
          }
          mask.poly(flat).fill({ color: 0xffffff, alpha: 1 });
        }
      }
    }
  }

  renderAll() {
    const removed = this.storage.removeChildren();
    for (const child of removed) {
      child.destroy({ children: true });
    }

    for (const source of this.sources) {
      const brightRadius = this.grid.feetToPixels(source.brightFeet);
      const dimRadius = this.grid.feetToPixels(source.dimFeet);
      const origin = { x: source.x, y: source.y };
      const dimPolygon = this.polygonFor(origin, dimRadius);
      const brightPolygon = this.polygonFor(origin, brightRadius);

      const g = new Graphics();
      this._drawPolygon(g, dimPolygon, {
        fill: { color: 0xffbb55, alpha: 0.07 },
        stroke: { color: 0xffd166, width: 1.5, alpha: 0.4 },
      });
      this._drawPolygon(g, brightPolygon, {
        fill: { color: 0xffd166, alpha: 0.18 },
        stroke: { color: 0xffe0a3, width: 2, alpha: 0.55 },
      });
      this.storage.addChild(g);

      const bulb = new Text({
        text: "💡",
        style: { fontSize: 22, fontFamily: "system-ui, sans-serif" },
      });
      bulb.anchor.set(0.5);
      bulb.position.set(source.x, source.y);
      bulb.eventMode = "none";
      bulb.visible = this.activeCategory === "light";
      this.storage.addChild(bulb);
    }

    this._renderDarknessMask();
    this._renderSelection();
  }

  // ----------------------------------------------------- selection / drag

  _renderSelection() {
    const g = this.selection;
    g.clear();
    if (this.selectedIds.size === 0) {
      return;
    }
    const width = Math.max(2, 4 / this._zoom);
    const radius = Math.max(16, 22 / this._zoom);
    for (const source of this.sources) {
      if (!this.selectedIds.has(source.id)) {
        continue;
      }
      g.circle(source.x, source.y, radius).stroke({
        color: 0xffffff,
        width,
        alpha: 0.95,
      });
    }
  }

  selectSource(id) {
    this.selectSources(id ? [id] : []);
    return this.sources.find((source) => source.id === id) || null;
  }

  selectSources(ids) {
    const known = new Set(
      this.sources.map(function (source) {
        return source.id;
      }),
    );
    this.selectedIds = new Set(
      (ids || []).filter(function (id) {
        return known.has(id);
      }),
    );
    this._renderSelection();
    return this.selectedIds;
  }

  clearSelection() {
    this.selectedIds = new Set();
    this.dragSource = null;
    this._renderSelection();
  }

  /** Light sources whose bulb hit circle intersects the marquee rectangle. */
  sourcesInRect(rect) {
    const radius = Math.max(20, this.grid.gridSize * 0.45);
    return this.sources.filter((source) => {
      const minX = source.x - radius;
      const maxX = source.x + radius;
      const minY = source.y - radius;
      const maxY = source.y + radius;
      return (
        minX <= rect.x + rect.width &&
        maxX >= rect.x &&
        minY <= rect.y + rect.height &&
        maxY >= rect.y
      );
    });
  }

  selectInRect(rect) {
    const sources = this.sourcesInRect(rect);
    this.selectSources(
      sources.map(function (source) {
        return source.id;
      }),
    );
    return sources;
  }

  /** Find a light source whose bulb icon is under the pointer. */
  sourceAt(worldPoint) {
    const radius = Math.max(20, this.grid.gridSize * 0.45);
    for (let index = this.sources.length - 1; index >= 0; index -= 1) {
      const source = this.sources[index];
      if (
        Math.hypot(worldPoint.x - source.x, worldPoint.y - source.y) <= radius
      ) {
        return source;
      }
    }
    return null;
  }

  beginSelect(worldPoint) {
    const source = this.sourceAt(worldPoint);
    if (!source) {
      return false;
    }
    this.selectSource(source.id);
    this.dragSource = source;
    this.dragOffset = {
      x: worldPoint.x - source.x,
      y: worldPoint.y - source.y,
    };
    return true;
  }

  updateSelect(worldPoint) {
    if (!this.dragSource) {
      return;
    }
    this.dragSource.x = worldPoint.x - this.dragOffset.x;
    this.dragSource.y = worldPoint.y - this.dragOffset.y;
    this.renderAll();
  }

  endSelect() {
    this.dragSource = null;
    this._renderSelection();
  }

  get draggingSource() {
    return this.dragSource !== null;
  }

  deleteSelected() {
    if (this.selectedIds.size === 0) {
      return 0;
    }
    const before = this.sources.length;
    this.sources = this.sources.filter(
      (source) => !this.selectedIds.has(source.id),
    );
    const removed = before - this.sources.length;
    this.selectedIds = new Set();
    this.dragSource = null;
    this.renderAll();
    return removed;
  }

  /** JSON-safe light source list for the active scene. */
  serialize() {
    return this.sources.map((source) => ({
      id: source.id,
      x: source.x,
      y: source.y,
      brightFeet: source.brightFeet,
      dimFeet: source.dimFeet,
    }));
  }

  /** Replace the layer contents with a scene's serialized light array. */
  loadState(list) {
    this.cancelPreview();
    this.clearSelection();
    this.sources = [];
    this._sequence = 0;
    for (const raw of Array.isArray(list) ? list : []) {
      if (!raw || typeof raw !== "object") {
        continue;
      }
      const x = Number(raw.x);
      const y = Number(raw.y);
      const brightFeet = Number(raw.brightFeet);
      const dimFeet = Number(raw.dimFeet);
      if (![x, y, brightFeet, dimFeet].every(Number.isFinite)) {
        continue;
      }
      this._sequence += 1;
      const id =
        typeof raw.id === "string" && raw.id.trim() !== ""
          ? raw.id
          : "light-" + this._sequence;
      this.sources.push({
        id: id,
        x: x,
        y: y,
        brightFeet: Math.max(0.1, brightFeet),
        dimFeet: Math.max(0.1, dimFeet),
      });
      const match = /-(\d+)$/.exec(id);
      if (match) {
        this._sequence = Math.max(this._sequence, Number.parseInt(match[1], 10));
      }
    }
    this.renderAll();
  }

  /** Double-click on a bulb edits bright/dim radii (in feet). */
  handleDoubleClick(worldPoint) {
    const source = this.sourceAt(worldPoint);
    if (!source) {
      return false;
    }

    const brightRaw = window.prompt(
      "Радиус яркого света (футы):",
      String(Number(source.brightFeet.toFixed(2))),
    );
    if (brightRaw === null) {
      return true;
    }
    const bright = Number.parseFloat(brightRaw.replace(",", "."));
    if (!Number.isFinite(bright) || bright <= 0) {
      return true;
    }

    const dimRaw = window.prompt(
      "Радиус тусклого света (футы):",
      String(Number(source.dimFeet.toFixed(2))),
    );
    if (dimRaw === null) {
      return true;
    }
    const dim = Number.parseFloat(dimRaw.replace(",", "."));
    if (!Number.isFinite(dim) || dim <= 0) {
      return true;
    }

    source.brightFeet = bright;
    source.dimFeet = dim;
    this.renderAll();
    return true;
  }

  clear() {
    this.cancelPreview();
    this.clearSelection();
    this.sources = [];
    this._sequence = 0;
    this.renderAll();
  }
}
