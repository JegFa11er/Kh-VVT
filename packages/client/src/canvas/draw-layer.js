import { Container, Graphics, Text } from "pixi.js";

import { requestCanvasText } from "../ui/overlays/dialog-service.js";

const DEFAULT_COLOR = "#ff6400";
const TEXT_PADDING = 6;
const HIT_PADDING = 6;

function colorToNumber(value) {
  if (typeof value !== "string") {
    return 0xff6400;
  }
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  if (!match) {
    return 0xff6400;
  }
  return Number.parseInt(match[1], 16);
}

function boundsFromPoints(points, padding = 0) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(1, maxX - minX + padding * 2),
    height: Math.max(1, maxY - minY + padding * 2),
  };
}

/**
 * Drawing layer for rectangles, ellipses, freehand strokes, polygons and text.
 *
 * Shape tools snap their anchor corners to grid intersections. Freehand and
 * polygon vertices use raw pointer positions. Text objects remain interactive:
 * the text tool edits them, while the select tool can select and drag any
 * committed drawing/text and shows a white selection frame around it.
 */
export class DrawLayer extends Container {
  constructor(app, viewport, grid) {
    super();
    this.label = "drawings";
    this.app = app;
    this.viewport = viewport;
    this.grid = grid;

    this.shapes = new Container();
    this.shapes.label = "drawings:committed";
    this.selection = new Graphics();
    this.selection.label = "drawings:selection";
    this.preview = new Graphics();
    this.preview.label = "drawings:preview";
    this.addChild(this.shapes, this.selection, this.preview);

    /** @type {Array<{id:string,kind:string,object:object,localBounds:object}>} */
    this.items = [];
    this.drawings = [];
    this.texts = [];
    this._sequence = 0;

    this.color = DEFAULT_COLOR;
    this.colorValue = colorToNumber(DEFAULT_COLOR);

    this.activeTool = null;
    this.startWorld = null;
    this.startCorner = null;
    this.currentWorld = null;
    this.freehandPoints = [];

    this.polygonActive = false;
    this.polygonPoints = [];
    this.polygonHover = null;

    this.selectionItem = null;
    this.selectionItems = [];
    this.dragItem = null;
    this.dragStart = null;
    this.resizeState = null;
  }

  setColor(value) {
    if (typeof value !== "string" || !/^#?[0-9a-fA-F]{6}$/.test(value.trim())) {
      return;
    }
    this.color = value.trim().startsWith("#") ? value.trim() : "#" + value.trim();
    this.colorValue = colorToNumber(this.color);
  }

  get _zoom() {
    return this.viewport && this.viewport.zoom ? this.viewport.zoom : 1;
  }

  get selectedDrawing() {
    return this.selectionItem;
  }

  // ------------------------------------------------------ drag-shaped tools

  /** Start a drag-shaped drawing (rect/ellipse/freehand). */
  begin(worldPoint, tool) {
    if (tool === "polygon") {
      return;
    }
    this.activeTool = tool;
    this.startWorld = { x: worldPoint.x, y: worldPoint.y };
    this.startCorner = this.grid.snapToCorner(worldPoint);
    this.currentWorld = { x: worldPoint.x, y: worldPoint.y };
    this.freehandPoints = [{ x: worldPoint.x, y: worldPoint.y }];
    this.preview.clear();
  }

  update(worldPoint) {
    if (!this.activeTool || !this.startWorld) {
      return;
    }
    this.currentWorld = { x: worldPoint.x, y: worldPoint.y };
    if (this.activeTool === "freehand") {
      this.freehandPoints.push({ x: worldPoint.x, y: worldPoint.y });
    }
    this._renderPreview();
  }

  end(worldPoint) {
    if (!this.activeTool || !this.startWorld) {
      return;
    }
    if (worldPoint) {
      this.currentWorld = { x: worldPoint.x, y: worldPoint.y };
      if (this.activeTool === "freehand") {
        this.freehandPoints.push({ x: worldPoint.x, y: worldPoint.y });
      }
    }
    const tool = this.activeTool;
    this._commit(tool);
    this.activeTool = null;
    this.startWorld = null;
    this.startCorner = null;
    this.currentWorld = null;
    this.freehandPoints = [];
    this.preview.clear();
  }

  // ---------------------------------------------------------------- polygon

  /** Add a vertex. The first click arms the polygon; later clicks extend it. */
  addPolygonPoint(worldPoint) {
    const point = { x: worldPoint.x, y: worldPoint.y };
    if (!this.polygonActive) {
      this.polygonActive = true;
      this.polygonPoints = [point];
      this.polygonHover = point;
      this.preview.clear();
      this._renderPolygonPreview();
      return;
    }
    this.polygonPoints.push(point);
    this.polygonHover = point;
    this._renderPolygonPreview();
  }

  updatePolygonPreview(worldPoint) {
    if (!this.polygonActive) {
      return;
    }
    this.polygonHover = { x: worldPoint.x, y: worldPoint.y };
    this._renderPolygonPreview();
  }

  /**
   * Finish the polygon on RMB. The rubber-band segment to the cursor is
   * dropped and the last LMB vertex is joined back to the first one.
   * Returns the new item (or null).
   */
  finishPolygon() {
    if (!this.polygonActive) {
      return null;
    }
    const points = this.polygonPoints.slice();
    this.polygonActive = false;
    this.polygonPoints = [];
    this.polygonHover = null;
    this.preview.clear();

    if (points.length < 3) {
      return null;
    }

    const g = new Graphics();
    g.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      g.lineTo(points[index].x, points[index].y);
    }
    g.closePath();
    g.fill({ color: this.colorValue, alpha: 0.12 });
    g.stroke({ color: this.colorValue, width: 3, alpha: 0.95 });

    const item = this._registerGraphic(
      g,
      "polygon",
      boundsFromPoints(points, 2),
      {
        points: points.map((point) => ({ x: point.x, y: point.y })),
      },
      this.color,
    );
    return item;
  }

  _renderPolygonPreview() {
    const g = this.preview;
    g.clear();
    if (!this.polygonActive || this.polygonPoints.length === 0) {
      return;
    }

    const width = Math.max(1, 2 / this._zoom);
    const points = this.polygonPoints.slice();
    if (this.polygonHover) {
      points.push(this.polygonHover);
    }

    g.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      g.lineTo(points[index].x, points[index].y);
    }
    g.stroke({ color: this.colorValue, width, alpha: 0.95 });

    const handle = Math.max(2, 4 / this._zoom);
    for (const point of this.polygonPoints) {
      g.circle(point.x, point.y, handle).fill({
        color: this.colorValue,
        alpha: 1,
      });
    }
  }

  cancelPreview() {
    this.activeTool = null;
    this.startWorld = null;
    this.startCorner = null;
    this.currentWorld = null;
    this.freehandPoints = [];
    this.polygonActive = false;
    this.polygonPoints = [];
    this.polygonHover = null;
    this.preview.clear();
  }

  // --------------------------------------------------------------- commit

  _registerGraphic(g, kind, localBounds, data, color) {
    g.eventMode = "none";
    this.shapes.addChild(g);
    this.drawings.push(g);
    this._sequence += 1;
    const item = {
      id: "drawing-" + this._sequence,
      kind: kind,
      object: g,
      localBounds: localBounds,
      color: color || this.color,
      data: Object.assign({ kind: kind }, data || {}),
    };
    this.items.push(item);
    return item;
  }

  _commit(tool) {
    const color = this.colorValue;
    const alpha = 0.95;

    if (tool === "rect") {
      const endCorner = this.grid.snapToCorner(this.currentWorld);
      const x = Math.min(this.startCorner.x, endCorner.x);
      const y = Math.min(this.startCorner.y, endCorner.y);
      const width = Math.abs(endCorner.x - this.startCorner.x);
      const height = Math.abs(endCorner.y - this.startCorner.y);
      if (width > 0 && height > 0) {
        const g = new Graphics();
        g.rect(x, y, width, height)
          .fill({ color, alpha: 0.12 })
          .stroke({ color, width: 3, alpha });
        this._registerGraphic(
          g,
          "rect",
          { x, y, width, height },
          { x, y, width, height },
          this.color,
        );
      }
      return;
    }

    if (tool === "ellipse") {
      const endCorner = this.grid.snapToCorner(this.currentWorld);
      const width = Math.abs(endCorner.x - this.startCorner.x);
      const height = Math.abs(endCorner.y - this.startCorner.y);
      if (width > 0 && height > 0) {
        const x = Math.min(this.startCorner.x, endCorner.x);
        const y = Math.min(this.startCorner.y, endCorner.y);
        const g = new Graphics();
        g.ellipse(x + width / 2, y + height / 2, width / 2, height / 2)
          .fill({ color, alpha: 0.12 })
          .stroke({ color, width: 3, alpha });
        this._registerGraphic(
          g,
          "ellipse",
          { x, y, width, height },
          { x, y, width, height },
          this.color,
        );
      }
      return;
    }

    if (tool === "freehand") {
      if (this.freehandPoints.length >= 2) {
        const g = new Graphics();
        g.moveTo(this.freehandPoints[0].x, this.freehandPoints[0].y);
        for (let index = 1; index < this.freehandPoints.length; index += 1) {
          g.lineTo(this.freehandPoints[index].x, this.freehandPoints[index].y);
        }
        g.stroke({ color, width: 3, alpha });
        this._registerGraphic(
          g,
          "freehand",
          boundsFromPoints(this.freehandPoints, 2),
          {
            points: this.freehandPoints.map((point) => ({
              x: point.x,
              y: point.y,
            })),
          },
          this.color,
        );
      }
    }
  }

  _renderPreview() {
    if (!this.startCorner || !this.currentWorld) {
      return;
    }
    const g = this.preview;
    g.clear();
    const color = this.colorValue;
    const width = Math.max(1, 2 / this._zoom);

    if (this.activeTool === "rect") {
      const endCorner = this.grid.snapToCorner(this.currentWorld);
      const x = Math.min(this.startCorner.x, endCorner.x);
      const y = Math.min(this.startCorner.y, endCorner.y);
      const w = Math.abs(endCorner.x - this.startCorner.x);
      const h = Math.abs(endCorner.y - this.startCorner.y);
      g.rect(x, y, w, h)
        .fill({ color, alpha: 0.1 })
        .stroke({ color, width, alpha: 1 });
      return;
    }

    if (this.activeTool === "ellipse") {
      const endCorner = this.grid.snapToCorner(this.currentWorld);
      const w = Math.abs(endCorner.x - this.startCorner.x);
      const h = Math.abs(endCorner.y - this.startCorner.y);
      g.ellipse(
        (this.startCorner.x + endCorner.x) / 2,
        (this.startCorner.y + endCorner.y) / 2,
        w / 2,
        h / 2,
      )
        .fill({ color, alpha: 0.1 })
        .stroke({ color, width, alpha: 1 });
      return;
    }

    if (this.activeTool === "freehand" && this.freehandPoints.length >= 2) {
      g.moveTo(this.freehandPoints[0].x, this.freehandPoints[0].y);
      for (let index = 1; index < this.freehandPoints.length; index += 1) {
        g.lineTo(this.freehandPoints[index].x, this.freehandPoints[index].y);
      }
      g.stroke({ color, width, alpha: 0.9 });
    }
  }

  // ------------------------------------------------------------- selection

  _itemBounds(item) {
    const local = item.localBounds;
    const scaleX = item.object.scale ? item.object.scale.x : 1;
    const scaleY = item.object.scale ? item.object.scale.y : 1;
    return {
      x: item.object.x + local.x * scaleX,
      y: item.object.y + local.y * scaleY,
      width: Math.abs(local.width * scaleX),
      height: Math.abs(local.height * scaleY),
    };
  }

  _itemAt(worldPoint) {
    const padding = HIT_PADDING + 4 / this._zoom;
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index];
      const bounds = this._itemBounds(item);
      if (
        worldPoint.x >= bounds.x - padding &&
        worldPoint.x <= bounds.x + bounds.width + padding &&
        worldPoint.y >= bounds.y - padding &&
        worldPoint.y <= bounds.y + bounds.height + padding
      ) {
        return item;
      }
    }
    return null;
  }

  selectAt(worldPoint) {
    const item = this._itemAt(worldPoint);
    this.selectItem(item);
    return item;
  }

  selectItem(item) {
    this.selectItems(item ? [item] : []);
    return this.selectionItem;
  }

  /** Replace the multi-selection (marquee and Ctrl-less shift selection). */
  selectItems(items) {
    const seen = new Set();
    this.selectionItems = [];
    for (const item of items || []) {
      if (item && !seen.has(item.id) && this.items.includes(item)) {
        seen.add(item.id);
        this.selectionItems.push(item);
      }
    }
    this.selectionItem = this.selectionItems.length
      ? this.selectionItems[this.selectionItems.length - 1]
      : null;
    this.resizeState = null;
    this._renderSelection();
    return this.selectionItems;
  }

  isSelected(item) {
    return Boolean(item) && this.selectionItems.includes(item);
  }

  /** Items whose bounding box intersects the marquee rectangle. */
  itemsInRect(rect) {
    return this.items.filter((item) => {
      const bounds = this._itemBounds(item);
      return (
        bounds.x <= rect.x + rect.width &&
        bounds.x + bounds.width >= rect.x &&
        bounds.y <= rect.y + rect.height &&
        bounds.y + bounds.height >= rect.y
      );
    });
  }

  clearSelection() {
    this.selectItems([]);
  }

  _selectionCorners(bounds) {
    const padding = 4 / this._zoom;
    return [
      { x: bounds.x - padding, y: bounds.y - padding },
      { x: bounds.x + bounds.width + padding, y: bounds.y - padding },
      { x: bounds.x - padding, y: bounds.y + bounds.height + padding },
      {
        x: bounds.x + bounds.width + padding,
        y: bounds.y + bounds.height + padding,
      },
    ];
  }

  _renderSelection() {
    const g = this.selection;
    g.clear();
    if (this.selectionItems.length === 0) {
      return;
    }
    const padding = 4 / this._zoom;
    const width = Math.max(1, 2 / this._zoom);
    const handle = Math.max(2, 5 / this._zoom);
    const single = this.selectionItems.length === 1;

    for (const item of this.selectionItems) {
      const bounds = this._itemBounds(item);
      g.rect(
        bounds.x - padding,
        bounds.y - padding,
        bounds.width + padding * 2,
        bounds.height + padding * 2,
      ).stroke({ color: 0xffffff, width, alpha: 0.95 });

      if (!single) {
        continue;
      }
      for (const corner of this._selectionCorners(bounds)) {
        g.rect(
          corner.x - handle / 2,
          corner.y - handle / 2,
          handle,
          handle,
        ).fill({ color: 0xffffff, alpha: 0.95 });
      }
    }
  }

  /** Corner index (0 TL, 1 TR, 2 BL, 3 BR) under the pointer, or null. */
  _handleAt(worldPoint) {
    if (this.selectionItems.length !== 1) {
      return null;
    }
    const bounds = this._itemBounds(this.selectionItems[0]);
    const threshold = Math.max(8, 10 / this._zoom);
    const corners = this._selectionCorners(bounds);
    for (let index = 0; index < corners.length; index += 1) {
      const corner = corners[index];
      if (
        Math.abs(worldPoint.x - corner.x) <= threshold &&
        Math.abs(worldPoint.y - corner.y) <= threshold
      ) {
        return index;
      }
    }
    return null;
  }

  /** Begin selecting/dragging committed drawing items. */
  beginItemDrag(worldPoint) {
    const item = this._itemAt(worldPoint);
    if (!item) {
      return null;
    }
    if (!this.isSelected(item)) {
      this.selectItems([item]);
    }
    this.dragItem = item;
    this.dragStart = {
      x: worldPoint.x,
      y: worldPoint.y,
      items: this.selectionItems.map((entry) => ({
        item: entry,
        objectX: entry.object.x,
        objectY: entry.object.y,
      })),
    };
    return item;
  }

  updateDrag(worldPoint) {
    if (!this.dragItem || !this.dragStart) {
      return;
    }
    const dx = worldPoint.x - this.dragStart.x;
    const dy = worldPoint.y - this.dragStart.y;
    for (const entry of this.dragStart.items) {
      entry.item.object.x = entry.objectX + dx;
      entry.item.object.y = entry.objectY + dy;
    }
    this._renderSelection();
  }

  endDrag() {
    this.dragItem = null;
    this.dragStart = null;
    this._renderSelection();
  }

  get draggingDrawing() {
    return this.dragItem !== null;
  }

  // ------------------------------------------------------------- resizing

  /** Arm a corner-handle resize for the single selected drawing. */
  beginResize(worldPoint) {
    const corner = this._handleAt(worldPoint);
    if (corner === null) {
      return null;
    }
    const item = this.selectionItems[0];
    this.resizeState = {
      item: item,
      corner: corner,
      startX: worldPoint.x,
      startY: worldPoint.y,
      bounds: this._itemBounds(item),
    };
    return item;
  }

  updateResize(worldPoint) {
    const state = this.resizeState;
    if (!state) {
      return;
    }
    const dx = worldPoint.x - state.startX;
    const dy = worldPoint.y - state.startY;
    const base = state.bounds;
    const minSize = Math.max(8, 12 / this._zoom);
    let x = base.x;
    let y = base.y;
    let width = base.width;
    let height = base.height;

    if (state.corner === 0) {
      x = base.x + dx;
      y = base.y + dy;
      width = base.width - dx;
      height = base.height - dy;
    } else if (state.corner === 1) {
      y = base.y + dy;
      width = base.width + dx;
      height = base.height - dy;
    } else if (state.corner === 2) {
      x = base.x + dx;
      width = base.width - dx;
      height = base.height + dy;
    } else {
      width = base.width + dx;
      height = base.height + dy;
    }

    if (width < minSize) {
      if (state.corner === 0 || state.corner === 2) {
        x = base.x + base.width - minSize;
      }
      width = minSize;
    }
    if (height < minSize) {
      if (state.corner === 0 || state.corner === 1) {
        y = base.y + base.height - minSize;
      }
      height = minSize;
    }

    this._applyBounds(state.item, { x, y, width, height });
    this._renderSelection();
  }

  endResize() {
    this.resizeState = null;
    this._renderSelection();
  }

  get resizingDrawing() {
    return this.resizeState !== null;
  }

  _applyBounds(item, bounds) {
    const local = item.localBounds;
    const sx = bounds.width / Math.max(1, local.width);
    const sy = bounds.height / Math.max(1, local.height);
    item.object.scale.set(sx, sy);
    item.object.x = bounds.x - local.x * sx;
    item.object.y = bounds.y - local.y * sy;
  }

  deleteSelected() {
    const doomed = this.selectionItems.slice();
    if (doomed.length === 0) {
      return 0;
    }
    const doomedSet = new Set(doomed);
    this.items = this.items.filter((item) => !doomedSet.has(item));
    this.drawings = this.drawings.filter((object) => {
      const item = doomed.find((entry) => entry.object === object);
      return !item;
    });
    this.texts = this.texts.filter((object) => {
      const item = doomed.find((entry) => entry.object === object);
      return !item;
    });
    for (const item of doomed) {
      item.object.destroy({ children: true });
    }
    if (doomedSet.has(this.dragItem)) {
      this.dragItem = null;
      this.dragStart = null;
    }
    this.resizeState = null;
    this.selectionItems = [];
    this.selectionItem = null;
    this._renderSelection();
    return doomed.length;
  }

  // ------------------------------------------------------- persistence (4.8)

  /** JSON-safe description of every drawing for the active scene. */
  serialize() {
    return this.items.map((item) => {
      const scale = item.object.scale || { x: 1, y: 1 };
      return Object.assign({}, item.data, {
        id: item.id,
        color: item.color,
        tx: item.object.x,
        ty: item.object.y,
        scaleX: scale.x,
        scaleY: scale.y,
      });
    });
  }

  /** Replace the layer contents with a scene's serialized drawing array. */
  loadState(list) {
    this.clear();
    for (const data of Array.isArray(list) ? list : []) {
      this._createFromData(data);
    }
    this._renderSelection();
  }

  _createFromData(data) {
    if (data === null || typeof data !== "object") {
      return null;
    }
    const kind = typeof data.kind === "string" ? data.kind : "rect";
    const colorHex =
      typeof data.color === "string" && /^#[0-9a-fA-F]{6}$/.test(data.color)
        ? data.color
        : DEFAULT_COLOR;
    const color = colorToNumber(colorHex);
    let item = null;

    if (kind === "rect" || kind === "ellipse") {
      const x = Number.isFinite(data.x) ? data.x : 0;
      const y = Number.isFinite(data.y) ? data.y : 0;
      const width = Number.isFinite(data.width) ? Math.abs(data.width) : 0;
      const height = Number.isFinite(data.height) ? Math.abs(data.height) : 0;
      if (width > 0 && height > 0) {
        const g = new Graphics();
        if (kind === "rect") {
          g.rect(x, y, width, height);
        } else {
          g.ellipse(x + width / 2, y + height / 2, width / 2, height / 2);
        }
        g.fill({ color, alpha: 0.12 }).stroke({ color, width: 3, alpha: 0.95 });
        item = this._registerGraphic(
          g,
          kind,
          { x, y, width, height },
          { x, y, width, height },
          colorHex,
        );
      }
    } else if (kind === "polygon" || kind === "freehand") {
      const points = Array.isArray(data.points)
        ? data.points
            .filter(
              (point) =>
                point &&
                Number.isFinite(point.x) &&
                Number.isFinite(point.y),
            )
            .map((point) => ({ x: point.x, y: point.y }))
        : [];
      const minimum = kind === "polygon" ? 3 : 2;
      if (points.length >= minimum) {
        const g = new Graphics();
        g.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
          g.lineTo(points[index].x, points[index].y);
        }
        if (kind === "polygon") {
          g.closePath();
          g.fill({ color, alpha: 0.12 });
        }
        g.stroke({ color, width: 3, alpha: 0.95 });
        item = this._registerGraphic(
          g,
          kind,
          boundsFromPoints(points, 2),
          { points: points },
          colorHex,
        );
      }
    } else if (kind === "text") {
      const value =
        typeof data.text === "string" && data.text.trim() !== ""
          ? data.text
          : "Текст";
      const text = new Text({
        text: value,
        style: {
          fill: color,
          fontSize: 20,
          fontWeight: "600",
          fontFamily: "system-ui, sans-serif",
          stroke: { color: 0x10141c, width: 4 },
        },
      });
      text.anchor.set(0.5);
      text.eventMode = "none";
      this.shapes.addChild(text);
      this.texts.push(text);
      this._sequence += 1;
      item = {
        id: "drawing-" + this._sequence,
        kind: "text",
        object: text,
        color: colorHex,
        data: { kind: "text", text: value },
        localBounds: {
          x: -Math.max(8, text.width / 2) - TEXT_PADDING,
          y: -Math.max(8, text.height / 2) - TEXT_PADDING,
          width: Math.max(16, text.width) + TEXT_PADDING * 2,
          height: Math.max(16, text.height) + TEXT_PADDING * 2,
        },
      };
      text._drawItem = item;
      this.items.push(item);
    }

    if (!item) {
      return null;
    }

    if (typeof data.id === "string" && data.id.trim() !== "") {
      item.id = data.id;
      const match = /-(\d+)$/.exec(item.id);
      if (match) {
        this._sequence = Math.max(this._sequence, Number.parseInt(match[1], 10));
      }
    }
    item.object.x = Number.isFinite(data.tx) ? data.tx : 0;
    item.object.y = Number.isFinite(data.ty) ? data.ty : 0;
    item.object.scale.set(
      Number.isFinite(data.scaleX) && data.scaleX !== 0 ? data.scaleX : 1,
      Number.isFinite(data.scaleY) && data.scaleY !== 0 ? data.scaleY : 1,
    );
    return item;
  }

  // ------------------------------------------------------------------- text

  _textAt(worldPoint) {
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index];
      if (item.kind !== "text") {
        continue;
      }
      const text = item.object;
      const halfWidth = Math.max(8, text.width / 2) + TEXT_PADDING;
      const halfHeight = Math.max(8, text.height / 2) + TEXT_PADDING;
      if (
        Math.abs(worldPoint.x - text.x) <= halfWidth &&
        Math.abs(worldPoint.y - text.y) <= halfHeight
      ) {
        return text;
      }
    }
    return null;
  }

  _createText(worldPoint, value) {
    const text = new Text({
      text: value,
      style: {
        fill: this.colorValue,
        fontSize: 20,
        fontWeight: "600",
        fontFamily: "system-ui, sans-serif",
        stroke: { color: 0x10141c, width: 4 },
      },
    });
    text.anchor.set(0.5);
    text.position.set(worldPoint.x, worldPoint.y);
    text.eventMode = "none";
    this.shapes.addChild(text);
    this.texts.push(text);

    this._sequence += 1;
    const item = {
      id: "drawing-" + this._sequence,
      kind: "text",
      object: text,
      color: this.color,
      data: { kind: "text", text: text.text },
      localBounds: {
        x: -Math.max(8, text.width / 2) - TEXT_PADDING,
        y: -Math.max(8, text.height / 2) - TEXT_PADDING,
        width: Math.max(16, text.width) + TEXT_PADDING * 2,
        height: Math.max(16, text.height) + TEXT_PADDING * 2,
      },
    };
    text._drawItem = item;
    this.items.push(item);
    return text;
  }

  _refreshTextBounds(text) {
    const item = text && text._drawItem;
    if (!item) {
      return;
    }
    if (item.data) {
      item.data.text = text.text;
    }
    item.localBounds = {
      x: -Math.max(8, text.width / 2) - TEXT_PADDING,
      y: -Math.max(8, text.height / 2) - TEXT_PADDING,
      width: Math.max(16, text.width) + TEXT_PADDING * 2,
      height: Math.max(16, text.height) + TEXT_PADDING * 2,
    };
    if (this.selectionItem === item) {
      this._renderSelection();
    }
  }

  /**
   * Text tool click: edit an existing label or create a new one.
   *
   * Step 5.8: the label is typed into an HTML input rendered at the click
   * position (React overlay) instead of a browser `window.prompt`.
   */
  async handleTextClick(worldPoint) {
    const existing = this._textAt(worldPoint);
    if (existing) {
      await this.editText(existing);
      return existing;
    }
    const screen =
      this.viewport && typeof this.viewport.worldToScreen === "function"
        ? this.viewport.worldToScreen(worldPoint)
        : { x: 0, y: 0 };
    const value = await requestCanvasText({
      world: worldPoint,
      screen: screen,
      value: "",
      color: this.color,
    });
    if (value === null) {
      return null;
    }
    const trimmed = value.trim();
    if (trimmed === "") {
      return null;
    }
    return this._createText(worldPoint, trimmed);
  }

  async editText(text) {
    if (!text) {
      return;
    }
    const world = { x: text.x, y: text.y };
    const screen =
      this.viewport && typeof this.viewport.worldToScreen === "function"
        ? this.viewport.worldToScreen(world)
        : { x: 0, y: 0 };
    const item = text._drawItem || null;
    const value = await requestCanvasText({
      world: world,
      screen: screen,
      value: text.text,
      color: (item && item.color) || this.color,
    });
    if (value === null) {
      return;
    }
    const trimmed = value.trim();
    if (trimmed !== "") {
      text.text = trimmed;
      this._refreshTextBounds(text);
    }
  }

  /** Backwards-compatible alias: select and arm a text/shape drag. */
  tryStartDrag(worldPoint) {
    return this.beginItemDrag(worldPoint) !== null;
  }

  get draggingText() {
    return this.dragItem !== null && this.dragItem.kind === "text";
  }

  clear() {
    this.cancelPreview();
    this.endDrag();
    this.selectionItems = [];
    this.resizeState = null;
    this.clearSelection();
    for (const item of this.items) {
      item.object.destroy({ children: true });
    }
    this.items = [];
    this.drawings = [];
    this.texts = [];
    this.shapes.removeChildren();
    this.selection.clear();
  }
}
