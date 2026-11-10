import { Container, Graphics } from "pixi.js";

import { computePolygon, pointInPolygon } from "./math.js";

/** Default PF2e "unlimited" sight range in world pixels (100 ft on a 100px grid). */
export const DEFAULT_VISION_RADIUS = 2000;

/**
 * Line-of-sight engine (Step 5.2).
 *
 * When a token is selected in `token → select` the layer builds its vision
 * polygon with the raycast shadow caster (`computePolygon(origin, r, walls,
 * "vision")`). Every other token whose center falls outside that polygon is
 * hidden; tokens inside stay visible. A GM with `gm-vision` enabled keeps
 * seeing the whole map, with out-of-sight tokens dimmed instead of hidden.
 *
 * The layer owns no gameplay state: it reads the selected token from
 * `TokenLayer`, the walls from `WallLayer` and pushes the result back through
 * `TokenLayer.applyVisionState()`.
 */
export class VisionLayer extends Container {
  constructor(app, viewport, grid, options = {}) {
    super();
    this.label = "vision";
    this.app = app;
    this.viewport = viewport;
    this.grid = grid;

    this.tokenLayer = options.tokenLayer || null;
    this.wallLayer = options.wallLayer || null;
    // Step 5.3: persistent fog of war accumulation lives in its own layer, but
    // it consumes exactly the same LOS polygons produced here.
    this.fogLayer = options.fogLayer || null;
    this.radius = Number.isFinite(Number(options.radius))
      ? Math.max(1, Number(options.radius))
      : DEFAULT_VISION_RADIUS;
    this.gmVision = options.gmVision === true;
    this.enabled = options.enabled !== false;
    this.showOutline = options.showOutline === true;

    this.outline = new Graphics();
    this.outline.label = "vision:outline";
    this.outline.eventMode = "none";
    this.addChild(this.outline);

    /** Latest polygon for the selected token (array of `{x, y}`). */
    this.polygon = null;
    // NOTE: do not name this `origin`: Pixi's Container owns an `origin`
    // transform point whose setter expects an ObservablePoint.
    this.visionOrigin = null;
  }

  setTokenLayer(tokenLayer) {
    this.tokenLayer = tokenLayer || null;
    this.refresh();
  }

  setWallLayer(wallLayer) {
    this.wallLayer = wallLayer || null;
    this.refresh();
  }

  /** Attach the fog-of-war layer that accumulates explored LOS polygons. */
  setFogLayer(fogLayer) {
    this.fogLayer = fogLayer || null;
    this.refresh();
  }

  setRadius(radius) {
    const value = Number(radius);
    if (!Number.isFinite(value) || value <= 0) {
      return;
    }
    this.radius = value;
    this.refresh();
  }

  setGmVision(enabled) {
    this.gmVision = Boolean(enabled);
    this.refresh();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.refresh();
  }

  /** Debug/verification outline of the current vision polygon. */
  setShowOutline(enabled) {
    this.showOutline = Boolean(enabled);
    this._renderOutline();
  }

  _wallList() {
    if (this.wallLayer && Array.isArray(this.wallLayer.walls)) {
      return this.wallLayer.walls;
    }
    return [];
  }

  /** Polygon for the currently selected token, or null. */
  refresh() {
    if (!this.tokenLayer) {
      return null;
    }
    const selectedId = this.tokenLayer.selectedId;
    const token = selectedId ? this.tokenLayer.tokens.get(selectedId) : null;
    if (!this.enabled || !token) {
      this.polygon = null;
      this.visionOrigin = null;
      this.tokenLayer.applyVisionState(null);
      if (this.fogLayer) {
        this.fogLayer.setCurrentVision(null);
      }
      this._renderOutline();
      return null;
    }

    const origin = { x: token.x, y: token.y };
    const polygon = computePolygon(
      origin,
      this.radius,
      this._wallList(),
      "vision",
    );

    this.polygon = polygon;
    this.visionOrigin = origin;
    this.tokenLayer.applyVisionState({
      origin: origin,
      polygon: polygon,
      gmVision: this.gmVision,
    });
    // Step 5.3: the same polygon is the "currently visible" fog mask and is
    // stamped into the persistent exploration texture. Both calls are no-ops
    // for degenerate polygons.
    if (this.fogLayer) {
      this.fogLayer.updateVision(polygon);
    }
    this._renderOutline();
    return polygon;
  }

  /**
   * Is a world point inside the current vision polygon? With no selection the
   * whole scene counts as visible (nothing is hidden).
   */
  contains(point) {
    if (!this.polygon) {
      return true;
    }
    return pointInPolygon(point, this.polygon);
  }

  _renderOutline() {
    const graphics = this.outline;
    if (!graphics) {
      return;
    }
    graphics.clear();
    if (!this.showOutline || !this.polygon || this.polygon.length < 3) {
      return;
    }
    const flat = [];
    for (const point of this.polygon) {
      flat.push(point.x, point.y);
    }
    graphics.poly(flat)
      .fill({ color: 0x66d9ff, alpha: 0.05 })
      .stroke({ color: 0x66d9ff, width: 1.5, alpha: 0.55 });
  }

  clear() {
    this.polygon = null;
    this.visionOrigin = null;
    if (this.tokenLayer) {
      this.tokenLayer.applyVisionState(null);
    }
    if (this.fogLayer) {
      this.fogLayer.setCurrentVision(null);
    }
    this._renderOutline();
  }
}
