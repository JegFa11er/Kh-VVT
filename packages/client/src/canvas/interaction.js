/**
 * Mouse routing for the PixiJS scene tools.
 *
 * The toolbar publishes `pf2e:tool-change` (selected category/tool) and
 * `pf2e:toolbar-action` (colour, darkness, GM vision, clear). This layer owns
 * no scene visuals: it converts screen coordinates to world space and forwards
 * gestures to the token, ruler, drawing, wall and light layers. It does own the
 * generic marquee rectangle and the global Delete shortcut.
 */

import { Graphics } from "pixi.js";

import {
  confirmAction,
  openActorSheet,
  openTokenHud,
} from "../ui/overlays/dialog-service.js";
import { showToast } from "../ui/toast.js";

const WALL_TOOLS = new Set([
  "normal",
  "terrain",
  "invisible",
  "ethereal",
  "door",
  "secret",
]);

const DRAW_TOOLS = new Set(["rect", "ellipse", "freehand"]);

export class InteractionLayer {
  constructor(app, viewport, layers = {}) {
    this.app = app;
    this.viewport = viewport;
    this.grid = layers.grid;
    this.tokenLayer = layers.tokenLayer || null;
    this.rulerLayer = layers.rulerLayer || null;
    this.drawLayer = layers.drawLayer || null;
    this.wallLayer = layers.wallLayer || null;
    this.lightLayer = layers.lightLayer || null;
    this.visionLayer = layers.visionLayer || null;
    this.fogLayer = layers.fogLayer || null;
    this.networkClient = layers.networkClient || null;

    // Marquee selection lives above every scene layer.
    this.marqueeGraphics = new Graphics();
    this.marqueeGraphics.label = "selection-marquee";
    this.marqueeGraphics.eventMode = "none";
    this.marquee = null;

    this.activeCategory = "token";
    this.activeSubTool = "select";
    this.gesture = null;
    this.textPress = null;
    this._lastClick = { time: 0, x: 0, y: 0 };
    this._suppressClick = false;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onToolChange = this._onToolChange.bind(this);
    this._onToolbarAction = this._onToolbarAction.bind(this);
    this._onContextMenu = this._onContextMenu.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onWindowPointerDown = this._onWindowPointerDown.bind(this);
    this._onWindowPointerMove = this._onWindowPointerMove.bind(this);
    this._onWindowPointerUp = this._onWindowPointerUp.bind(this);
    this._rulerRmbPressed = false;
    this._lastRulerWaypointAt = 0;
  }

  mount() {
    this.viewport.world.addChild(this.marqueeGraphics);
    if (this.viewport) {
      this.viewport.panGuard = () => this.gesture === "ruler";
    }
    this._bindEvents();
    if (this.lightLayer) {
      this.lightLayer.setActiveCategory(this.activeCategory);
    }
    return this;
  }

  destroy() {
    const stage = this.app.stage;
    stage.off("pointerdown", this._onPointerDown);
    stage.off("pointermove", this._onPointerMove);
    stage.off("pointerup", this._onPointerUp);
    stage.off("pointerupoutside", this._onPointerUp);
    if (typeof window !== "undefined") {
      window.removeEventListener("pf2e:tool-change", this._onToolChange);
      window.removeEventListener("pf2e:toolbar-action", this._onToolbarAction);
      window.removeEventListener("keydown", this._onKeyDown);
      window.removeEventListener("pointerdown", this._onWindowPointerDown, true);
      window.removeEventListener("pointermove", this._onWindowPointerMove, true);
      window.removeEventListener("pointerup", this._onWindowPointerUp, true);
    }
    if (this.app.canvas) {
      this.app.canvas.removeEventListener("contextmenu", this._onContextMenu);
    }
    if (this.viewport) {
      this.viewport.panGuard = null;
    }
    if (this.marqueeGraphics) {
      this.marqueeGraphics.clear();
      this.marqueeGraphics.destroy();
      this.marqueeGraphics = null;
    }
  }

  _bindEvents() {
    const stage = this.app.stage;
    stage.on("pointerdown", this._onPointerDown);
    stage.on("pointermove", this._onPointerMove);
    stage.on("pointerup", this._onPointerUp);
    stage.on("pointerupoutside", this._onPointerUp);

    if (typeof window !== "undefined") {
      window.addEventListener("pf2e:tool-change", this._onToolChange);
      window.addEventListener("pf2e:toolbar-action", this._onToolbarAction);
      window.addEventListener("keydown", this._onKeyDown);
      // PixiJS may drop the second `pointerdown` when LMB is already held, so
      // ruler waypoints are also captured globally in the capture phase.
      window.addEventListener("pointerdown", this._onWindowPointerDown, true);
      window.addEventListener("pointermove", this._onWindowPointerMove, true);
      window.addEventListener("pointerup", this._onWindowPointerUp, true);
    }
    if (this.app.canvas) {
      this.app.canvas.addEventListener("contextmenu", this._onContextMenu);
    }
  }

  get cameraEnabled() {
    return this.activeCategory === "token" && this.activeSubTool === "select";
  }

  _pauseCamera() {
    if (!this.viewport) {
      return;
    }
    // Equivalent to pixi-viewport's `viewport.plugins.pause("drag")`.
    if (this.viewport.plugins && typeof this.viewport.plugins.pause === "function") {
      this.viewport.plugins.pause("drag");
    } else if (typeof this.viewport.pauseDrag === "function") {
      this.viewport.pauseDrag();
    }
  }

  _resumeCamera() {
    if (!this.viewport) {
      return;
    }
    // Equivalent to pixi-viewport's `viewport.plugins.resume("drag")`.
    if (this.viewport.plugins && typeof this.viewport.plugins.resume === "function") {
      this.viewport.plugins.resume("drag");
    } else if (typeof this.viewport.resumeDrag === "function") {
      this.viewport.resumeDrag();
    }
  }

  _onContextMenu(event) {
    // Right-click is a scene gesture (door lock / ruler waypoint); never open
    // the browser menu.
    event.preventDefault();
    // Fallback for browsers that only surface the RMB through `contextmenu`
    // while another button is held. The capture handler usually runs first,
    // so only add a point if no waypoint was just dropped by pointerdown.
    if (
      this.gesture === "ruler" &&
      this.rulerLayer &&
      this.rulerLayer.dragging &&
      typeof performance !== "undefined" &&
      performance.now() - this._lastRulerWaypointAt > 250
    ) {
      this._dropRulerWaypoint(event);
    }
  }

  _clientToWorld(event) {
    const canvas = this.app.canvas;
    const rect =
      canvas && typeof canvas.getBoundingClientRect === "function"
        ? canvas.getBoundingClientRect()
        : { left: 0, top: 0 };
    return this.viewport.screenToWorld({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }

  _dropRulerWaypoint(event) {
    if (
      !this.rulerLayer ||
      !this.rulerLayer.dragging ||
      typeof this.rulerLayer.addWaypoint !== "function"
    ) {
      return false;
    }
    const point = this._clientToWorld(event);
    const added = this.rulerLayer.addWaypoint(point);
    if (added) {
      this._lastRulerWaypointAt =
        typeof performance !== "undefined" ? performance.now() : Date.now();
    }
    return added;
  }

  _onWindowPointerDown(event) {
    if (event.button !== 2) {
      return;
    }
    if (this.gesture !== "ruler" || !this.rulerLayer || !this.rulerLayer.dragging) {
      return;
    }
    // Keep the event away from the viewport: RMB during a measurement adds a
    // waypoint instead of starting a camera pan.
    event.preventDefault();
    event.stopPropagation();
    this._rulerRmbPressed = true;
    this._dropRulerWaypoint(event);
  }

  _onWindowPointerMove(event) {
    if (this.gesture !== "ruler" || !this.rulerLayer || !this.rulerLayer.dragging) {
      this._rulerRmbPressed = false;
      return;
    }
    // `buttons` is a bitmask (LMB=1, RMB=2, both=3). This catches the RMB even
    // when the browser/Pixi did not emit a pointerdown for the second button.
    const rmbHeld = (event.buttons & 2) === 2;
    if (rmbHeld && !this._rulerRmbPressed) {
      this._rulerRmbPressed = true;
      event.preventDefault();
      this._dropRulerWaypoint(event);
    } else if (!rmbHeld) {
      this._rulerRmbPressed = false;
    }
  }

  _onWindowPointerUp(event) {
    if (event.button === 2) {
      this._rulerRmbPressed = false;
    }
  }

  _onToolChange(event) {
    const detail = (event && event.detail) || {};
    this.activeCategory = detail.category === undefined ? null : detail.category;
    this.activeSubTool = detail.tool === undefined ? null : detail.tool;
    // Switching category or tool always drops every selection and the
    // per-layer frames (drawings/walls/lights).
    this._clearAllSelections();
    this._cancelGesture();
    if (this.lightLayer) {
      this.lightLayer.setActiveCategory(this.activeCategory);
    }
  }

  _clearAllSelections() {
    if (this.tokenLayer && typeof this.tokenLayer.clearSelection === "function") {
      this.tokenLayer.clearSelection();
    }
    if (this.drawLayer && typeof this.drawLayer.clearSelection === "function") {
      this.drawLayer.clearSelection();
    }
    if (this.wallLayer && typeof this.wallLayer.clearSelection === "function") {
      this.wallLayer.clearSelection();
    }
    if (this.lightLayer && typeof this.lightLayer.clearSelection === "function") {
      this.lightLayer.clearSelection();
    }
  }

  _notifySceneChanged() {
    if (typeof window === "undefined") {
      return;
    }
    window.dispatchEvent(new CustomEvent("pf2e:scene-canvas-changed"));
  }

  _onKeyDown(event) {
    if (!this.activeCategory || event.key !== "Delete") {
      return;
    }
    const target = event.target;
    const tagName = target && target.tagName ? target.tagName : "";
    if (
      tagName === "INPUT" ||
      tagName === "TEXTAREA" ||
      tagName === "SELECT" ||
      (target && target.isContentEditable)
    ) {
      return;
    }

    let removed = 0;
    if (
      this.activeCategory === "draw" &&
      this.drawLayer &&
      typeof this.drawLayer.deleteSelected === "function"
    ) {
      removed = this.drawLayer.deleteSelected();
      if (removed > 0) {
        this._notifySceneChanged();
      }
    } else if (
      this.activeCategory === "wall" &&
      this.wallLayer &&
      typeof this.wallLayer.deleteSelected === "function"
    ) {
      removed = this.wallLayer.deleteSelected();
      if (removed > 0) {
        this._notifySceneChanged();
      }
    } else if (
      this.activeCategory === "light" &&
      this.lightLayer &&
      typeof this.lightLayer.deleteSelected === "function"
    ) {
      removed = this.lightLayer.deleteSelected();
      if (removed > 0) {
        this._notifySceneChanged();
      }
    } else if (
      this.activeCategory === "token" &&
      this.tokenLayer &&
      typeof this.tokenLayer.deleteSelected === "function"
    ) {
      // Actor-linked scene tokens are deleted through the scene canvas; only
      // legacy combatant tokens go through `room:remove-combatant`.
      const selectedIds = Array.from(this.tokenLayer.selectedIds || []);
      const actorTokenIds = selectedIds.filter((id) =>
        typeof this.tokenLayer.isActorToken === "function"
          ? this.tokenLayer.isActorToken(id)
          : false,
      );
      const ids = this.tokenLayer.deleteSelected();
      removed = ids.length;
      const combatantIds = ids.filter((id) => !actorTokenIds.includes(id));
      if (
        combatantIds.length > 0 &&
        this.networkClient &&
        this.networkClient.role === "gm" &&
        typeof this.networkClient.removeCombatant === "function"
      ) {
        for (const id of combatantIds) {
          this.networkClient.removeCombatant(id).catch(() => {});
        }
      }
      if (actorTokenIds.length > 0) {
        this._notifySceneChanged();
      }
    }

    if (removed > 0) {
      event.preventDefault();
    }
  }

  _onToolbarAction(event) {
    const detail = (event && event.detail) || {};
    const category = detail.category;
    const tool = detail.tool;

    if (category === "draw") {
      if (tool === "color" && detail.color && this.drawLayer) {
        this.drawLayer.setColor(detail.color);
      }
      if (tool === "clear" && this.drawLayer) {
        confirmAction({
          title: "Очистить холст",
          message: "Удалить все рисунки на сцене?",
          danger: true,
        }).then((confirmed) => {
          if (!confirmed) {
            return;
          }
          this.drawLayer.clear();
          this._notifySceneChanged();
        });
      }
    }

    if (category === "wall" && tool === "clear" && this.wallLayer) {
      confirmAction({
        title: "Очистить стены",
        message: "Удалить все стены на сцене?",
        danger: true,
      }).then((confirmed) => {
        if (!confirmed) {
          return;
        }
        this.wallLayer.clear();
        this._notifySceneChanged();
      });
    }

    if (category === "light") {
      if (tool === "clear" && this.lightLayer) {
        confirmAction({
          title: "Очистить освещение",
          message: "Удалить все источники света на сцене?",
          danger: true,
        }).then((confirmed) => {
          if (!confirmed) {
            return;
          }
          this.lightLayer.clear();
          this._notifySceneChanged();
        });
      }
      if (tool === "darkness" && this.lightLayer) {
        this.lightLayer.setDarkness(detail.level);
      }
      if (tool === "gm-vision" && this.lightLayer) {
        this.lightLayer.setGmVision(detail.enabled);
      }
      if (tool === "gm-vision" && this.visionLayer) {
        this.visionLayer.setGmVision(detail.enabled);
      }
      if (tool === "reset-fog" && this.fogLayer) {
        // Clear the accumulated texture locally, then ask the server to wipe
        // `scenes[id].fogExploration` and broadcast `room:reset-fog`.
        this.fogLayer.reset({ notify: true });
        if (this.visionLayer) {
          this.visionLayer.refresh();
        }
        showToast("Туман войны сброшен");
      }
    }
  }

  _worldPoint(event) {
    return this.viewport.screenToWorld({
      x: event.global.x,
      y: event.global.y,
    });
  }

  /** Modifier keys of a pointer event (Shift = free placement, Ctrl = chain). */
  _modifiers(event) {
    const native = event && event.nativeEvent ? event.nativeEvent : event;
    return {
      shift: Boolean(
        (native && native.shiftKey) || (event && event.shiftKey),
      ),
      ctrl: Boolean((native && native.ctrlKey) || (event && event.ctrlKey)),
    };
  }

  /**
   * Movement collision for the token currently being dragged (Step 5.1).
   * Uses the pre-drag cell center and the center of the target cell so the ray
   * matches the grid path the token will actually take.
   */
  _checkTokenDragCollision(worldPoint) {
    if (
      !this.tokenLayer ||
      !this.wallLayer ||
      typeof this.tokenLayer.dragStartCenter !== "function" ||
      typeof this.tokenLayer.dragTargetCenter !== "function" ||
      typeof this.wallLayer.checkCollision !== "function"
    ) {
      return null;
    }
    const start = this.tokenLayer.dragStartCenter();
    const target = this.tokenLayer.dragTargetCenter(worldPoint);
    if (!start || !target) {
      return null;
    }
    return this.wallLayer.checkCollision(start, target, "movement");
  }

  // --------------------------------------------------------------- marquee

  _marqueeRect() {
    const marquee = this.marquee;
    if (!marquee) {
      return null;
    }
    return {
      x: Math.min(marquee.start.x, marquee.current.x),
      y: Math.min(marquee.start.y, marquee.current.y),
      width: Math.abs(marquee.current.x - marquee.start.x),
      height: Math.abs(marquee.current.y - marquee.start.y),
    };
  }

  _startMarquee(worldPoint) {
    this._cancelMarquee(false);
    this._pauseCamera();
    this.marquee = {
      start: { x: worldPoint.x, y: worldPoint.y },
      current: { x: worldPoint.x, y: worldPoint.y },
      category: this.activeCategory,
    };
    this.gesture = "marquee";
    this._renderMarquee();
  }

  _updateMarquee(worldPoint) {
    if (!this.marquee) {
      return;
    }
    this.marquee.current = { x: worldPoint.x, y: worldPoint.y };
    this._renderMarquee();
  }

  _renderMarquee() {
    const g = this.marqueeGraphics;
    if (!g) {
      return;
    }
    g.clear();
    const rect = this._marqueeRect();
    if (!rect) {
      return;
    }
    const width = Math.max(1, 1.5 / (this.viewport.zoom || 1));
    g.rect(rect.x, rect.y, rect.width, rect.height)
      .fill({ color: 0x3b9eff, alpha: 0.12 })
      .stroke({ color: 0xffffff, width, alpha: 0.9 });
  }

  _finishMarquee() {
    const marquee = this.marquee;
    const rect = this._marqueeRect();
    this.marquee = null;
    this.gesture = null;
    if (this.marqueeGraphics) {
      this.marqueeGraphics.clear();
    }
    this._resumeCamera();
    if (!marquee || !rect) {
      return;
    }

    const zoom = this.viewport.zoom || 1;
    const tiny = rect.width < 3 / zoom && rect.height < 3 / zoom;
    const category = marquee.category;

    if (category === "token" && this.tokenLayer) {
      if (tiny) {
        this.tokenLayer.clearSelection();
      } else {
        this.tokenLayer.selectInRect(rect);
      }
    } else if (category === "draw" && this.drawLayer) {
      if (tiny) {
        this.drawLayer.clearSelection();
      } else {
        this.drawLayer.selectItems(this.drawLayer.itemsInRect(rect));
      }
    } else if (category === "wall" && this.wallLayer) {
      if (tiny) {
        this.wallLayer.clearSelection();
      } else {
        this.wallLayer.selectInRect(rect);
      }
    } else if (category === "light" && this.lightLayer) {
      if (tiny) {
        this.lightLayer.clearSelection();
      } else {
        this.lightLayer.selectInRect(rect);
      }
    }
  }

  _cancelMarquee(resumeCamera = true) {
    if (!this.marquee) {
      return;
    }
    this.marquee = null;
    if (this.marqueeGraphics) {
      this.marqueeGraphics.clear();
    }
    if (resumeCamera) {
      this._resumeCamera();
    }
    if (this.gesture === "marquee") {
      this.gesture = null;
    }
  }

  _isDoubleClick(point) {
    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const last = this._lastClick;
    const isDouble =
      now - last.time < 350 &&
      Math.hypot(point.x - last.x, point.y - last.y) < 10;
    this._lastClick = { time: now, x: point.x, y: point.y };
    return isDouble;
  }

  _onPointerDown(event) {
    const category = this.activeCategory;
    const tool = this.activeSubTool;
    if (!category || category === "dice") {
      return;
    }

    const point = this._worldPoint(event);
    const screen = { x: event.global.x, y: event.global.y };
    const doubleClick = this._isDoubleClick(screen);

    // The two click phases of a double-click are consumed by the light editor.
    if (this.gesture === "light-drag" && this.lightLayer) {
      this.lightLayer.endSelect();
      this.gesture = null;
    }
    if (doubleClick && category === "light" && this.lightLayer) {
      // The light editor is async because its radii dialog is an in-game React
      // prompt; only consume the click when a bulb was actually hit.
      if (this.lightLayer.sourceAt(point)) {
        const pending = this.lightLayer.handleDoubleClick(point);
        this._cancelGesture();
        this._suppressClick = true;
        if (pending && typeof pending.then === "function") {
          pending
            .then((handled) => {
              if (handled) {
                this._notifySceneChanged();
              }
            })
            .catch(() => {});
        } else if (pending) {
          this._notifySceneChanged();
        }
        return;
      }
    }

    if (event.button === 2) {
      // Step 5.8: RMB on a token opens the in-game Token HUD instead of
      // clearing the selection. The viewport's stage listener runs first and
      // arms a camera pan, so stop it explicitly.
      if (
        category === "token" &&
        tool === "select" &&
        this.tokenLayer
      ) {
        const token = this.tokenLayer.tokenAt(point);
        if (token) {
          if (this.viewport) {
            this.viewport.panning = false;
          }
          if (!this.tokenLayer.isSelected(token.combatantId)) {
            this.tokenLayer.selectToken(token.combatantId);
          }
          const actorId =
            typeof this.tokenLayer.actorIdForToken === "function"
              ? this.tokenLayer.actorIdForToken(token)
              : token.actorId || null;
          openTokenHud({
            tokenId: token.combatantId,
            actorId: actorId,
            world: { x: token.x, y: token.y },
          });
          return;
        }
      }

      // Right-drag is always the camera. Make sure a previous marquee/token
      // gesture has not left the drag plugin paused, then let the viewport's
      // own pointerdown listener start panning.
      this._resumeCamera();

      // RMB during a measurement drops a ruler waypoint.
      if (
        this.gesture === "ruler" &&
        this.rulerLayer &&
        this.rulerLayer.dragging
      ) {
        this.rulerLayer.addWaypoint(point);
        return;
      }
      // RMB closes a polygon: the rubber-band segment is discarded and the
      // last left-clicked vertex is joined to the first one.
      if (
        category === "draw" &&
        tool === "polygon" &&
        this.drawLayer &&
        this.drawLayer.polygonActive
      ) {
        this.drawLayer.finishPolygon();
        this._notifySceneChanged();
        return;
      }
      // Doors stay operable from the wall tool, but Shift+RMB keeps the plain
      // right-drag free for camera panning in every category.
      const modifiers = this._modifiers(event);
      if (modifiers.shift && category === "wall" && this.wallLayer) {
        if (this.wallLayer.handleDoorAction(point, 2)) {
          this._notifySceneChanged();
        }
      }
      return;
    }
    if (event.button !== 0) {
      return;
    }

    // Step 5.8: double-clicking a token opens the linked character sheet.
    if (doubleClick && category === "token" && tool === "select" && this.tokenLayer) {
      const token = this.tokenLayer.tokenAt(point);
      const actorId =
        token && typeof this.tokenLayer.actorIdForToken === "function"
          ? this.tokenLayer.actorIdForToken(token)
          : null;
      if (actorId) {
        this._resumeCamera();
        this._suppressClick = true;
        openActorSheet(actorId);
        return;
      }
    }

    if (category === "token") {
      if (tool === "ruler" && this.rulerLayer) {
        this.rulerLayer.begin(point);
        this.gesture = "ruler";
        return;
      }
      if (tool === "select") {
        const token = this.tokenLayer ? this.tokenLayer.tokenAt(point) : null;
        if (token) {
          // Dragging a token must not drag the camera underneath it.
          this._pauseCamera();
          this.tokenLayer.selectToken(token.combatantId);
          this.tokenLayer.beginDrag(point);
          this.gesture = "token-drag";
          return;
        }

        // Doors belong to the wall layer but are operated from the token tool.
        if (this.wallLayer && this.wallLayer.doorAt(point)) {
          this._pauseCamera();
          this.wallLayer.handleDoorAction(point, 0);
          this.gesture = "door-click";
          return;
        }

        // Empty space starts a marquee instead of panning the camera; the
        // middle mouse button still pans.
        this._startMarquee(point);
      }
      return;
    }

    if (category === "draw") {
      if (tool === "text") {
        this.textPress = { world: point, screen: screen };
        this.gesture = "text-click";
        return;
      }
      if (tool === "select" && this.drawLayer) {
        // Corner handle first, then item drag, then marquee.
        if (this.drawLayer.beginResize(point)) {
          this.gesture = "drawing-resize";
          return;
        }
        const item = this.drawLayer.beginItemDrag(point);
        if (item) {
          this.gesture = "drawing-drag";
          return;
        }
        this._startMarquee(point);
        return;
      }
      if (tool === "polygon" && this.drawLayer) {
        // Vertices are added with LMB; RMB closes the polygon.
        this.drawLayer.addPolygonPoint(point);
        return;
      }
      if (DRAW_TOOLS.has(tool) && this.drawLayer) {
        this.drawLayer.begin(point, tool);
        this.gesture = "draw";
      }
      return;
    }

    if (category === "wall") {
      if (tool === "select" && this.wallLayer) {
        if (this.wallLayer.wallAt(point)) {
          this.wallLayer.beginDrag(point);
          this.gesture = "wall-drag";
          return;
        }
        this._startMarquee(point);
        return;
      }
      if (WALL_TOOLS.has(tool) && this.wallLayer) {
        const modifiers = this._modifiers(event);
        this.wallLayer.begin(point, tool, { free: modifiers.shift });
        this.gesture = "wall";
      }
      return;
    }

    if (category === "light") {
      if (tool === "draw" && this.lightLayer) {
        this.lightLayer.begin(point);
        this.gesture = "light";
        return;
      }
      if (tool === "select" && this.lightLayer) {
        if (this.lightLayer.beginSelect(point)) {
          this.gesture = "light-drag";
          return;
        }
        this._startMarquee(point);
      }
    }
  }

  _onPointerMove(event) {
    const point = this._worldPoint(event);

    // Polygon preview follows the cursor between clicks (no held gesture).
    if (
      this.activeCategory === "draw" &&
      this.activeSubTool === "polygon" &&
      this.drawLayer &&
      this.drawLayer.polygonActive
    ) {
      this.drawLayer.updatePolygonPreview(point);
    }

    if (!this.gesture) {
      return;
    }

    if (this.gesture === "token-drag" && this.tokenLayer) {
      this.tokenLayer.updateDrag(point);
    } else if (this.gesture === "marquee") {
      this._updateMarquee(point);
    } else if (this.gesture === "ruler" && this.rulerLayer) {
      this.rulerLayer.update(point);
    } else if (this.gesture === "draw" && this.drawLayer) {
      this.drawLayer.update(point);
    } else if (this.gesture === "drawing-drag" && this.drawLayer) {
      this.drawLayer.updateDrag(point);
    } else if (this.gesture === "drawing-resize" && this.drawLayer) {
      this.drawLayer.updateResize(point);
    } else if (this.gesture === "wall" && this.wallLayer) {
      const modifiers = this._modifiers(event);
      this.wallLayer.update(point, { free: modifiers.shift });
    } else if (this.gesture === "wall-drag" && this.wallLayer) {
      const modifiers = this._modifiers(event);
      this.wallLayer.updateDrag(point, { free: modifiers.shift });
    } else if (this.gesture === "light" && this.lightLayer) {
      this.lightLayer.update(point);
    } else if (this.gesture === "light-drag" && this.lightLayer) {
      this.lightLayer.updateSelect(point);
    }
  }

  _onPointerUp(event) {
    // Only the left button completes a drag gesture. RMB is a modifier
    // gesture (ruler waypoint / polygon close) and must not end a held LMB.
    if (typeof event.button === "number" && event.button !== 0) {
      return;
    }
    const point = this._worldPoint(event);
    if (this.gesture === "marquee") {
      this._finishMarquee();
      this.textPress = null;
      return;
    }

    const gesture = this.gesture;

    if (gesture === "token-drag" && this.tokenLayer) {
      const collision = this._checkTokenDragCollision(point);
      if (collision) {
        // Blocked drop: snap the token back and never notify the scene save
        // pipeline, so no coordinate update reaches the server.
        if (typeof this.tokenLayer.cancelDrag === "function") {
          this.tokenLayer.cancelDrag();
        }
        showToast("Движение заблокировано препятствием");
      } else {
        this.tokenLayer.endDrag(point);
        this._notifySceneChanged();
      }
      this._resumeCamera();
    } else if (gesture === "door-click") {
      this._resumeCamera();
    } else if (gesture === "ruler" && this.rulerLayer) {
      this.rulerLayer.end(point);
    } else if (gesture === "draw" && this.drawLayer) {
      this.drawLayer.end(point);
      this._notifySceneChanged();
    } else if (gesture === "drawing-drag" && this.drawLayer) {
      this.drawLayer.endDrag();
      this._notifySceneChanged();
    } else if (gesture === "drawing-resize" && this.drawLayer) {
      this.drawLayer.endResize();
      this._notifySceneChanged();
    } else if (gesture === "wall" && this.wallLayer) {
      const modifiers = this._modifiers(event);
      const before = this.wallLayer.walls.length;
      const continuing = this.wallLayer.end(point, {
        free: modifiers.shift,
        chain: modifiers.ctrl,
      });
      if (this.wallLayer.walls.length !== before) {
        this._notifySceneChanged();
      }
      if (continuing) {
        // Ctrl is held: the tool stays armed and the next segment is anchored
        // at the endpoint that was just committed.
        this.textPress = null;
        return;
      }
    } else if (gesture === "wall-drag" && this.wallLayer) {
      this.wallLayer.endDrag();
      this._notifySceneChanged();
    } else if (gesture === "light" && this.lightLayer) {
      this.lightLayer.end(point);
      this._notifySceneChanged();
    } else if (gesture === "light-drag" && this.lightLayer) {
      this.lightLayer.endSelect();
      this._notifySceneChanged();
    } else if (gesture === "text-click" && this.drawLayer) {
      const press = this.textPress;
      const isClick =
        press &&
        Math.hypot(
          event.global.x - press.screen.x,
          event.global.y - press.screen.y,
        ) <= 5;
      if (isClick) {
        const pending = this.drawLayer.handleTextClick(point);
        if (pending && typeof pending.then === "function") {
          pending
            .then(() => this._notifySceneChanged())
            .catch(() => {});
        } else {
          this._notifySceneChanged();
        }
      }
    }

    this.gesture = null;
    this.textPress = null;
  }

  _cancelGesture() {
    this._cancelMarquee();
    if (this.tokenLayer && this.tokenLayer.draggingToken) {
      if (typeof this.tokenLayer.cancelDrag === "function") {
        this.tokenLayer.cancelDrag();
      } else {
        this.tokenLayer.endDrag();
      }
    }
    if (this.rulerLayer) {
      this.rulerLayer.cancel();
    }
    if (this.drawLayer) {
      this.drawLayer.cancelPreview();
      this.drawLayer.endDrag();
      if (typeof this.drawLayer.endResize === "function") {
        this.drawLayer.endResize();
      }
    }
    if (this.wallLayer) {
      this.wallLayer.cancelPreview();
      if (typeof this.wallLayer.endDrag === "function") {
        this.wallLayer.endDrag();
      }
    }
    if (this.lightLayer) {
      this.lightLayer.cancelPreview();
      this.lightLayer.endSelect();
    }
    this._resumeCamera();
    this.gesture = null;
    this.textPress = null;
  }
}
