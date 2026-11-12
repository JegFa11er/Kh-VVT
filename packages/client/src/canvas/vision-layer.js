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
    // Step 5.4: the darkness overlay is hidden together with the fog while a
    // GM browses the map without a selected token.
    this.lightLayer = options.lightLayer || null;
    this.radius = Number.isFinite(Number(options.radius))
      ? Math.max(1, Number(options.radius))
      : DEFAULT_VISION_RADIUS;
    this.gmVision = options.gmVision === true;
    this.enabled = options.enabled !== false;
    this.showOutline = options.showOutline === true;
    /**
     * Current viewer role. `gm` browses the whole scene until a token is
     * selected; `player` always renders the fog through their tokens.
     *
     * @type {"gm"|"player"}
     */
    this.viewerRole = options.viewerRole === "gm" ? "gm" : "player";

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

  /** Switch between GM and player vision rules without reloading the scene. */
  setViewerRole(role) {
    const next = role === "gm" ? "gm" : "player";
    if (next === this.viewerRole) {
      return;
    }
    this.viewerRole = next;
    if (this.tokenLayer) {
      this.tokenLayer.setGMViewer(next === "gm");
    }
    this.refresh();
  }

  get isGM() {
    return this.viewerRole === "gm";
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.refresh();
  }

  setLightLayer(lightLayer) {
    this.lightLayer = lightLayer || null;
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
    const selectedId = this.tokenLayer ? this.tokenLayer.selectedId : null;
    const token =
      selectedId && this.tokenLayer
        ? this.tokenLayer.tokens.get(selectedId) || null
        : null;
    const actorKey = token ? this._actorKeyFor(token) : null;

    // GM vision (Foundry parity): no selection reveals the whole map (fog and
    // darkness hidden); selecting a token switches to that token's LOS.
    this._syncViewerPresentation(Boolean(token), actorKey);

    if (!this.tokenLayer) {
      return null;
    }
    if (!this.enabled || !token) {
      this.polygon = null;
      this.visionOrigin = null;
      this.tokenLayer.applyVisionState(null);
      if (this.fogLayer) {
        this.fogLayer.updateVision(null, actorKey);
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
    // Step 5.3/5.4: the same polygon is the "currently visible" fog mask and is
    // stamped into the selected actor's persistent exploration texture.
    if (this.fogLayer) {
      this.fogLayer.updateVision(polygon, actorKey);
    }
    this._renderOutline();
    return polygon;
  }

  /** Actor/token id that owns the fog exploration for a token. */
  _actorKeyFor(token) {
    if (!token) {
      return null;
    }
    if (
      this.tokenLayer &&
      typeof this.tokenLayer.actorKeyForToken === "function"
    ) {
      return this.tokenLayer.actorKeyForToken(token.combatantId);
    }
    if (typeof token.actorId === "string" && token.actorId !== "") {
      return token.actorId;
    }
    return token.combatantId || null;
  }

  /**
   * Hide the fog and darkness for a GM browsing without a selection, and turn
   * them back on for players or when a token's vision is being emulated.
   */
  _syncViewerPresentation(hasToken, actorKey) {
    const gm = this.isGM;
    const showFog = !gm || hasToken;
    if (this.fogLayer) {
      this.fogLayer.setVisible(showFog);
      if (hasToken) {
        this.fogLayer.setActiveActor(actorKey);
      }
    }
    if (this.lightLayer && typeof this.lightLayer.setRevealAll === "function") {
      this.lightLayer.setRevealAll(gm && !hasToken);
    }
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
    this._syncViewerPresentation(false, null);
    if (this.fogLayer) {
      this.fogLayer.updateVision(null, null);
    }
    this._renderOutline();
  }
}
