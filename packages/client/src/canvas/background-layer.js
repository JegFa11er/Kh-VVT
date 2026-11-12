import { Assets, Container, Graphics, Sprite } from "pixi.js";

const DEFAULT_BACKGROUND_COLOR = "#12151c";

/** Normalize a user-supplied HEX colour, falling back to the stock dark tone. */
export function normalizeBackgroundColor(value) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim())
    ? value.trim().toLowerCase()
    : DEFAULT_BACKGROUND_COLOR;
}

/**
 * Step 6.3: scene background layer.
 *
 * The map image (if any) is drawn as a `PIXI.Sprite` at world `(0, 0)`. Without
 * an image the layer paints the grid-sized map rectangle with the configured
 * colour, while the renderer's own background colour covers everything outside
 * the map.
 */
export class BackgroundLayer extends Container {
  constructor(options = {}) {
    super();
    this.label = "background";

    this.gridSize = Math.max(20, Number(options.gridSize) || 100);
    this.cols = Math.max(1, Number(options.cols) || 24);
    this.rows = Math.max(1, Number(options.rows) || 16);
    this.mapWidth = this.cols * this.gridSize;
    this.mapHeight = this.rows * this.gridSize;
    this.backgroundColor = normalizeBackgroundColor(options.backgroundColor);

    this._sprite = null;
    this._imageUrl = null;
    this._generation = 0;

    this.fill = new Graphics();
    this.addChild(this.fill);
    this._drawFill();
  }

  /** Configure the logical map size (used before/without a background image). */
  setGrid(gridSize, cols, rows) {
    this.gridSize = Math.max(20, Number(gridSize) || this.gridSize);
    this.cols = Math.max(1, Number(cols) || this.cols);
    this.rows = Math.max(1, Number(rows) || this.rows);
    if (!this._sprite) {
      this.mapWidth = this.cols * this.gridSize;
      this.mapHeight = this.rows * this.gridSize;
      this._drawFill();
    }
  }

  setBackgroundColor(value) {
    this.backgroundColor = normalizeBackgroundColor(value);
    this._drawFill();
  }

  /**
   * Load or clear the map image.
   *
   * @param {string|null} url
   * @returns {Promise<{width:number,height:number}|null>} intrinsic image size
   */
  async setImage(url) {
    const generation = ++this._generation;
    const nextUrl = typeof url === "string" && url.trim() !== "" ? url.trim() : "";

    if (nextUrl === "") {
      this._clearSprite();
      this.mapWidth = this.cols * this.gridSize;
      this.mapHeight = this.rows * this.gridSize;
      this._drawFill();
      return null;
    }

    try {
      const texture = await Assets.load(nextUrl);
      if (generation !== this._generation) {
        // A newer scene/settings change superseded this load.
        Assets.unload(nextUrl).catch(function () {});
        return null;
      }
      this._clearSprite(this._imageUrl !== nextUrl);
      const sprite = new Sprite(texture);
      sprite.position.set(0, 0);
      this._sprite = sprite;
      this._imageUrl = nextUrl;
      this.mapWidth = Math.max(1, Number(texture.width) || 1);
      this.mapHeight = Math.max(1, Number(texture.height) || 1);
      this.addChild(sprite);
      this._drawFill();
      return { width: this.mapWidth, height: this.mapHeight };
    } catch (error) {
      if (generation === this._generation) {
        console.warn("[pf2e] failed to load scene background", error);
        this._clearSprite();
        this._drawFill();
      }
      return null;
    }
  }

  /** Release the current sprite/texture, e.g. when switching scenes. */
  clear() {
    this._generation += 1;
    this._clearSprite();
    this.mapWidth = this.cols * this.gridSize;
    this.mapHeight = this.rows * this.gridSize;
    this._drawFill();
  }

  _clearSprite(releaseTexture = true) {
    if (this._sprite) {
      this.removeChild(this._sprite);
      this._sprite.destroy();
      this._sprite = null;
    }
    if (this._imageUrl) {
      const url = this._imageUrl;
      this._imageUrl = null;
      if (releaseTexture) {
        // Scene backgrounds are exclusive to this layer; release the cache
        // entry so switching maps does not retain every decoded texture.
        Assets.unload(url).catch(function () {});
      }
    }
  }

  _drawFill() {
    this.fill.clear();
    this.fill
      .rect(0, 0, this.mapWidth, this.mapHeight)
      .fill({ color: this.backgroundColor, alpha: this._sprite ? 0 : 1 });
  }
}
