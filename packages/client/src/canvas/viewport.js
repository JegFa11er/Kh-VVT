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
    // The camera only pans/zooms while the token selection tool is active.
    // Every other scene tool needs the pointer for its own drag gesture.
    this.cameraEnabled = true;
    // Temporary drag lock used while a token (or other world object) is being
    // dragged; unlike `cameraEnabled` it does not survive the gesture.
    this.dragPaused = false;
    this._toolChangeHandler = null;
    // Optional predicate from InteractionLayer: returning true keeps a
    // right-button gesture (e.g. a ruler waypoint) away from the camera.
    this.panGuard = null;

    // Minimal compatibility shim for code written against pixi-viewport:
    // `viewport.plugins.pause("drag")` / `viewport.plugins.resume("drag")`.
    this.plugins = {
      pause: (name) => {
        if (name === "drag") {
          this.pauseDrag();
        }
      },
      resume: (name) => {
        if (name === "drag") {
          this.resumeDrag();
        }
      },
    };

    this._bindEvents();
    this.center();
  }

  /** Enable/disable drag, wheel and touch camera movement. */
  setCameraEnabled(enabled) {
    this.cameraEnabled = Boolean(enabled);
    if (!this.cameraEnabled) {
      this.panning = false;
    }
  }

  /** Temporarily stop camera drag, e.g. while a token is under the cursor. */
  pauseDrag() {
    this.dragPaused = true;
    this.panning = false;
  }

  /** Hand the drag gesture back to the camera after an object drag ends. */
  resumeDrag() {
    this.dragPaused = false;
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
      // Step 4.8: camera navigation is strictly right-drag. The left button is
      // reserved for selection (token click, marquee) in every scene tool, so
      // the camera must never start panning on LMB.
      if (event.button !== 2) {
        return;
      }
      if (typeof this.panGuard === "function" && this.panGuard()) {
        return;
      }
      this.panning = true;
      this._lastPointer.x = event.global.x;
      this._lastPointer.y = event.global.y;
      if (event.nativeEvent && typeof event.nativeEvent.preventDefault === "function") {
        event.nativeEvent.preventDefault();
      }
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
        // While a drawing/measuring tool owns the mouse, the wheel must not
        // move the camera either.
        if (!this.cameraEnabled || this.dragPaused) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        const rect = this.app.canvas.getBoundingClientRect();
        const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
        this.zoomAt(point, this.zoom * factor);
      },
      { passive: false },
    );

    // Global scene-tool listener. Right-drag panning is tool-independent, so
    // this flag only gates wheel zoom while a drawing/measuring tool owns the
    // pointer. This mirrors `viewport.plugins.pause("drag")` from
    // pixi-viewport, but the project uses a lightweight custom viewport.
    this._toolChangeHandler = (event) => {
      const detail = (event && event.detail) || {};
      this.setCameraEnabled(
        detail.category === "token" && detail.tool === "select",
      );
    };
    if (typeof window !== "undefined") {
      window.addEventListener("pf2e:tool-change", this._toolChangeHandler);
    }

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

  /** Alias used by the canvas drag-and-drop pipeline (`viewport.toWorld`). */
  toWorld(screenPoint) {
    return this.screenToWorld(screenPoint);
  }

  worldToScreen(worldPoint) {
    return {
      x: worldPoint.x * this.zoom + this.world.x,
      y: worldPoint.y * this.zoom + this.world.y,
    };
  }
}
