import { Container } from "pixi.js";

/**
 * Camera with pan and zoom. World content lives inside `world`, which is the
 * only transformed node: screen-space UI stays outside the viewport.
 */
export class Viewport {
  constructor(app, options = {}) {
    this.app = app;
    this.world = new Container();
    this.world.label = "world";

    this.minZoom = options.minZoom || 0.25;
    this.maxZoom = options.maxZoom || 4;
    this.zoom = 1;

    this.panning = false;
    this._lastPointer = { x: 0, y: 0 };

    this._bindEvents();
    this.center();
  }

  get stage() {
    return this.app.stage;
  }

  /** Attach the world container to the stage (call once). */
  mount() {
    this.stage.addChild(this.world);
    return this;
  }

  _bindEvents() {
    const stage = this.stage;
    stage.eventMode = "static";
    stage.hitArea = this.app.screen;

    stage.on("pointerdown", (event) => {
      // Middle mouse button or space-less left drag on empty canvas pans.
      if (event.button !== 1 && event.button !== 0) {
        return;
      }
      this.panning = true;
      this._lastPointer.x = event.global.x;
      this._lastPointer.y = event.global.y;
    });

    stage.on("pointermove", (event) => {
      if (!this.panning) {
        return;
      }
      const dx = event.global.x - this._lastPointer.x;
      const dy = event.global.y - this._lastPointer.y;
      this._lastPointer.x = event.global.x;
      this._lastPointer.y = event.global.y;
      this.panBy(dx, dy);
    });

    const endPan = () => {
      this.panning = false;
    };
    stage.on("pointerup", endPan);
    stage.on("pointerupoutside", endPan);

    this.app.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const rect = this.app.canvas.getBoundingClientRect();
        const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
        this.zoomAt(point, this.zoom * factor);
      },
      { passive: false },
    );

    this.app.renderer.on("resize", () => {
      this.stage.hitArea = this.app.screen;
    });
  }

  panBy(dx, dy) {
    this.world.x += dx;
    this.world.y += dy;
  }

  /** Zoom around a screen-space point, keeping world content under it fixed. */
  zoomAt(screenPoint, nextZoom) {
    const clamped = Math.min(this.maxZoom, Math.max(this.minZoom, nextZoom));
    if (clamped === this.zoom) {
      return;
    }

    const worldX = (screenPoint.x - this.world.x) / this.zoom;
    const worldY = (screenPoint.y - this.world.y) / this.zoom;

    this.zoom = clamped;
    this.world.scale.set(clamped);
    this.world.x = screenPoint.x - worldX * clamped;
    this.world.y = screenPoint.y - worldY * clamped;
  }

  setZoom(value, screenPoint) {
    const point = screenPoint || { x: this.app.screen.width / 2, y: this.app.screen.height / 2 };
    this.zoomAt(point, value);
  }

  center() {
    this.world.x = 0;
    this.world.y = 0;
  }

  screenToWorld(screenPoint) {
    return {
      x: (screenPoint.x - this.world.x) / this.zoom,
      y: (screenPoint.y - this.world.y) / this.zoom,
    };
  }

  worldToScreen(worldPoint) {
    return {
      x: worldPoint.x * this.zoom + this.world.x,
      y: worldPoint.y * this.zoom + this.world.y,
    };
  }
}
