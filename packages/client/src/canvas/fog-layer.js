import { Assets, Container, Graphics, RenderTexture, Sprite } from "pixi.js";

/**
 * Fog of War (Step 5.3).
 *
 * The layer is deliberately built out of exactly two tinted planes:
 *
 *  1. "Unexplored" — an opaque black plane. Its inverse mask is a GPU copy of
 *     `fogTexture`, so any polygon that was ever seen punches a permanent hole
 *     into it.
 *  2. "Explored" — a 50 % black plane. Its inverse mask is the *current*
 *     line-of-sight polygon, so the area around the selected token is fully
 *     clear while previously visited (but no longer visible) ground keeps a
 *     dim veil.
 *
 * The visibility history is never stored as polygons. Each new LOS polygon is
 * painted white into `fogTexture` with `clear: false`, so the texture itself is
 * the complete accumulation. A second `historyTexture` is refreshed from it
 * after every reveal and is the only texture exposed to the mask sampler (Pixi
 * clears a RenderTexture that is rendered to and sampled as a mask at the same
 * time). The server only ever receives the encoded accumulation
 * (`data:image/png;base64,…`), which keeps `session.json` compact and makes
 * reloading a scene a single sprite draw into the same texture.
 */

/** Opacity of the "already explored but currently out of sight" plane. */
export const FOG_EXPLORED_ALPHA = 0.5;

/** Delay between the last reveal and the persistence write (Step 5.3). */
export const FOG_SAVE_DEBOUNCE_MS = 2000;

/** Default scene size used when no explicit dimensions are supplied. */
const DEFAULT_FOG_WIDTH = 2400;
const DEFAULT_FOG_HEIGHT = 1600;

function isValidPolygon(polygon) {
  return Array.isArray(polygon) && polygon.length >= 3;
}

function polygonSignature(polygon) {
  if (!isValidPolygon(polygon)) {
    return "";
  }
  // Cheap deterministic hash over every vertex. It is only used to skip a
  // redundant texture write when the selected token did not move.
  let hash = polygon.length * 2654435761;
  for (const point of polygon) {
    const x = Math.round(Number(point.x) || 0);
    const y = Math.round(Number(point.y) || 0);
    hash = (hash ^ x) * 16777619;
    hash = (hash ^ y) * 16777619;
    hash >>>= 0;
  }
  return String(hash);
}

export class FogLayer extends Container {
  constructor(app, viewport, grid, options = {}) {
    super();
    this.label = "fog";
    this.app = app;
    this.viewport = viewport;
    this.grid = grid;

    // NOTE: do not name these `width`/`height`: Pixi's Container owns those
    // accessors and assigning them resizes the whole layer instead of storing
    // the world-space fog dimensions.
    this.fogWidth = Math.max(
      1,
      Math.round(
        Number(options.width) > 0 ? Number(options.width) : DEFAULT_FOG_WIDTH,
      ),
    );
    this.fogHeight = Math.max(
      1,
      Math.round(
        Number(options.height) > 0 ? Number(options.height) : DEFAULT_FOG_HEIGHT,
      ),
    );

    /** Active scene id (`null` is the base scene) used by the save callback. */
    this.sceneId =
      typeof options.sceneId === "string" && options.sceneId !== ""
        ? options.sceneId
        : null;
    this.persistenceEnabled = options.persistenceEnabled !== false;

    /**
     * Fired (debounced) with the encoded fog texture and the scene it belongs
     * to. `main.js` forwards it to `room:update-fog`.
     *
     * @type {((dataUrl:string, sceneId:string|null) => void)|null}
     */
    this.onFogChanged = null;
    /** Fired after a local reset so the client can broadcast `room:reset-fog`. */
    this.onFogReset = null;

    // Never intercept canvas pointer events.
    this.eventMode = "none";

    /**
     * Accumulated visibility. White/opaque = explored. This texture is only
     * ever a render target, never a mask: Pixi clears a RenderTexture that is
     * simultaneously sampled as an alpha mask, which would erase the history
     * on the next frame.
     */
    this.fogTexture = RenderTexture.create({
      width: this.fogWidth,
      height: this.fogHeight,
      resolution: 1,
    });

    /**
     * GPU copy of `fogTexture` used exclusively as the inverse mask sprite.
     * It is refreshed after every reveal (detach mask -> copy -> reattach) so
     * writing the accumulation never fights the mask sampler.
     */
    this.historyTexture = RenderTexture.create({
      width: this.fogWidth,
      height: this.fogHeight,
      resolution: 1,
    });

    // Layers and their masks -------------------------------------------------
    this.unexplored = new Container();
    this.unexplored.label = "fog:unexplored";
    this.unexplored.eventMode = "none";

    this.unexploredFill = new Graphics();
    this.unexploredFill.eventMode = "none";
    // Deliberately larger than the texture: everything outside the mapped
    // scene must stay black even after the camera is panned past its edge.
    this.unexploredFill
      .rect(-100000, -100000, 200000, 200000)
      .fill({ color: 0x000000, alpha: 1 });

    this.explored = new Container();
    this.explored.label = "fog:explored";
    this.explored.eventMode = "none";

    this.exploredFill = new Graphics();
    this.exploredFill.eventMode = "none";
    this.exploredFill
      .rect(-100000, -100000, 200000, 200000)
      .fill({ color: 0x000000, alpha: FOG_EXPLORED_ALPHA });

    // Mask 1: a GPU copy of the accumulated visibility texture (inverse ->
    // holes). The accumulation itself stays in `fogTexture` so the mask
    // sampler and the render target never share one texture.
    this.historyMask = new Sprite(this.historyTexture);
    this.historyMask.label = "fog:history-mask";
    this.historyMask.eventMode = "none";
    this.historyMask.position.set(0, 0);
    this.historyMask.width = this.fogWidth;
    this.historyMask.height = this.fogHeight;

    // Mask 2: the current line-of-sight polygon (inverse -> fully clear area).
    this.losMask = new Graphics();
    this.losMask.label = "fog:los-mask";
    this.losMask.eventMode = "none";

    this.unexplored.addChild(this.unexploredFill, this.historyMask);
    this.unexplored.setMask({ mask: this.historyMask, inverse: true });

    this.explored.addChild(this.exploredFill, this.losMask);
    this.explored.setMask({ mask: this.losMask, inverse: true });

    this.addChild(this.unexplored, this.explored);

    // Internal render helpers (never added to the scene graph).
    this.revealBrush = new Graphics();
    this.revealBrush.label = "fog:reveal-brush";
    this.emptyGraphics = new Graphics();
    this.emptyGraphics.label = "fog:clear-brush";

    this.currentPolygon = null;
    this._lastRevealSignature = "";
    this._persistTimer = null;
    this._loadGeneration = 0;
  }

  // ------------------------------------------------------------ scene state

  /** Switch scenes: drops the current reveal and loads the saved texture. */
  setScene(sceneId) {
    const next =
      typeof sceneId === "string" && sceneId !== "" ? sceneId : null;
    this.sceneId = next;
    this._cancelPersistTimer();
    this._lastRevealSignature = "";
    this.currentPolygon = null;
    this._renderLosMask();
  }

  /**
   * Replace the accumulated texture with a previously persisted Base64 PNG.
   * `null`/empty clears the fog to its initial fully-black state.
   *
   * @param {string|null} dataUrl
   * @returns {Promise<boolean>} whether a texture was loaded
   */
  async loadEncoded(dataUrl) {
    this._cancelPersistTimer();
    this._lastRevealSignature = "";
    const generation = ++this._loadGeneration;

    if (typeof dataUrl !== "string" || dataUrl.trim() === "") {
      this.clearLocal();
      return false;
    }

    try {
      const textureUrl = dataUrl.trim();
      const texture = await Assets.load(textureUrl);
      // A newer scene/load superseded this request while assets were loading.
      if (generation !== this._loadGeneration) {
        Assets.unload(textureUrl).catch(function () {});
        return false;
      }
      const sprite = new Sprite(texture);
      sprite.position.set(0, 0);
      sprite.width = this.fogWidth;
      sprite.height = this.fogHeight;
      this.app.renderer.render({
        container: sprite,
        target: this.fogTexture,
        clear: true,
        clearColor: [0, 0, 0, 0],
      });
      sprite.destroy();
      // The encoded fog is unique per save and can be many megabytes. Release
      // it from the Assets cache immediately after the one-time draw so a long
      // session does not accumulate every historical texture.
      Assets.unload(textureUrl).catch(function () {});
      this._syncHistoryTexture();
      return true;
    } catch (error) {
      if (generation === this._loadGeneration) {
        console.warn("[pf2e] failed to restore fog of war", error);
        this.clearLocal();
      }
      return false;
    }
  }

  /** Erase the accumulated texture locally without notifying the server. */
  clearLocal() {
    // Invalidate any in-flight Base64 restore so a reset cannot be undone by a
    // late-arriving texture load.
    this._loadGeneration += 1;
    this._cancelPersistTimer();
    this._lastRevealSignature = "";
    this.app.renderer.render({
      container: this.emptyGraphics,
      target: this.fogTexture,
      clear: true,
      clearColor: [0, 0, 0, 0],
    });
    this._syncHistoryTexture();
  }

  /**
   * Copy the accumulation texture into the mask texture.
   *
   * The mask is temporarily detached: writing to a texture that is sampled as
   * an alpha mask in the same GPU frame is undefined and can silently drop the
   * draw. Detach -> render copy -> reattach keeps both textures independent.
   */
  _syncHistoryTexture() {
    if (!this.fogTexture || !this.historyTexture || !this.unexplored) {
      return;
    }
    const hadMask = this.unexplored.mask === this.historyMask;
    if (hadMask) {
      this.unexplored.mask = null;
    }
    try {
      const sprite = new Sprite(this.fogTexture);
      sprite.position.set(0, 0);
      sprite.width = this.fogWidth;
      sprite.height = this.fogHeight;
      this.app.renderer.render({
        container: sprite,
        target: this.historyTexture,
        clear: true,
        clearColor: [0, 0, 0, 0],
      });
      sprite.destroy();
    } finally {
      if (hadMask) {
        this.unexplored.setMask({ mask: this.historyMask, inverse: true });
      }
    }
  }

  /**
   * Clear locally and (unless silenced) ask the client to broadcast
   * `room:reset-fog`, which clears the server copy and every other client.
   */
  reset(options = {}) {
    this.clearLocal();
    const notify = options.notify !== false;
    if (notify && typeof this.onFogReset === "function") {
      this.onFogReset(this.sceneId);
    }
  }

  // -------------------------------------------------------------- visibility

  /**
   * Update the current line-of-sight mask (the fully clear area around the
   * selected token). No history is written here.
   *
   * @param {Array<{x:number,y:number}>|null} polygon
   */
  setCurrentVision(polygon) {
    this.currentPolygon = isValidPolygon(polygon) ? polygon : null;
    this._renderLosMask();
  }

  /**
   * Permanently add a LOS polygon to the explored texture. Repeated calls with
   * an identical polygon are skipped so idle refreshes do not schedule writes.
   *
   * @param {Array<{x:number,y:number}>} polygon
   * @returns {boolean} true when the texture was actually updated
   */
  revealPolygon(polygon) {
    if (!isValidPolygon(polygon)) {
      return false;
    }
    const signature = polygonSignature(polygon);
    if (signature === this._lastRevealSignature) {
      return false;
    }
    this._lastRevealSignature = signature;

    const flat = [];
    for (const point of polygon) {
      flat.push(Number(point.x) || 0, Number(point.y) || 0);
    }

    this.revealBrush.clear();
    this.revealBrush.poly(flat).fill({ color: 0xffffff, alpha: 1 });

    // `clear: false` is the whole point of the slice: every render stamps the
    // new polygon on top of the accumulated texture instead of resetting it.
    this.app.renderer.render({
      container: this.revealBrush,
      target: this.fogTexture,
      clear: false,
    });
    this._syncHistoryTexture();
    this._schedulePersist();
    return true;
  }

  /** Convenience helper used by `VisionLayer.refresh()`. */
  updateVision(polygon) {
    const valid = isValidPolygon(polygon);
    this.setCurrentVision(valid ? polygon : null);
    if (valid) {
      this.revealPolygon(polygon);
    }
    return valid;
  }

  _renderLosMask() {
    const mask = this.losMask;
    if (!mask) {
      return;
    }
    mask.clear();
    if (!isValidPolygon(this.currentPolygon)) {
      return;
    }
    const flat = [];
    for (const point of this.currentPolygon) {
      flat.push(Number(point.x) || 0, Number(point.y) || 0);
    }
    mask.poly(flat).fill({ color: 0xffffff, alpha: 1 });
  }

  // ------------------------------------------------------------- persistence

  _schedulePersist() {
    if (!this.persistenceEnabled || typeof this.onFogChanged !== "function") {
      return;
    }
    if (this._persistTimer !== null) {
      clearTimeout(this._persistTimer);
    }
    const sceneId = this.sceneId;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._persist(sceneId);
    }, FOG_SAVE_DEBOUNCE_MS);
  }

  async _persist(sceneId) {
    if (typeof this.onFogChanged !== "function" || !this.app.renderer) {
      return;
    }
    try {
      const dataUrl = await this.app.renderer.extract.base64(this.fogTexture);
      // The user may have switched scenes while the PNG was being encoded.
      if (sceneId !== this.sceneId) {
        return;
      }
      this.onFogChanged(dataUrl, sceneId);
    } catch (error) {
      console.warn("[pf2e] fog of war encoding failed", error);
    }
  }

  _cancelPersistTimer() {
    if (this._persistTimer !== null) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
  }

  destroy(options) {
    this._cancelPersistTimer();
    if (this.historyTexture) {
      this.historyTexture.destroy(true);
      this.historyTexture = null;
    }
    if (this.fogTexture) {
      this.fogTexture.destroy(true);
      this.fogTexture = null;
    }
    super.destroy(options);
  }
}
