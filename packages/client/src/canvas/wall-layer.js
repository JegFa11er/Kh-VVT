import { Container, Graphics, Text } from "pixi.js";

import { segmentsIntersect } from "./math.js";

const WALL_STYLES = {
  normal: { color: 0xd6d9df, alpha: 1 },
  terrain: { color: 0x6fbf73, alpha: 1 },
  invisible: { color: 0x3b9eff, alpha: 0.45 },
  ethereal: { color: 0xa855f7, alpha: 1 },
  door: { color: 0xf2c94c, alpha: 1 },
  secret: { color: 0xff7aa2, alpha: 1 },
};

const WALL_TOOLS = new Set(Object.keys(WALL_STYLES));

/** Screen-space radius that glues a wall endpoint to an existing node. */
const NODE_MAGNET_PX = 15;

/** Marker hit radius in screen pixels (compensated by camera zoom). */
const HANDLE_HIT_PX = 10;

function wallColor(wall) {
  if (wall.type === "door" || wall.type === "secret") {
    if (wall.locked) {
      return 0xe03131;
    }
    if (wall.open) {
      return 0x6fbf73;
    }
    return wall.type === "secret" ? 0xff7aa2 : 0xf2c94c;
  }
  return WALL_STYLES[wall.type].color;
}

function wallMidpoint(wall) {
  return {
    x: (wall.x1 + wall.x2) / 2,
    y: (wall.y1 + wall.y2) / 2,
  };
}

/** Doors and secret doors share the open/locked interaction model. */
function isDoorLike(wall) {
  return wall.type === "door" || wall.type === "secret";
}

/**
 * Open state of a door/secret wall. `open` is the canonical serialized field;
 * `isOpen` is accepted for compatibility with external scene payloads.
 */
function isDoorOpen(wall) {
  return wall.open === true || wall.isOpen === true;
}

/**
 * Physics filter: does this wall block a segment of the given type?
 *
 * `movement` (Step 5.1):
 *  - `ethereal` walls never block, even though they block sight;
 *  - open doors and open secret doors let tokens through;
 *  - locked doors block even if a malformed payload marked them open;
 *  - `normal`, `terrain`, `invisible`, closed doors and closed secrets block.
 *
 * Other ray types keep the same solidity except that open doors stay opaque
 * (used later by line-of-sight) and ethereal walls remain transparent to
 * physical rays.
 *
 * @param {object} wall
 * @param {"movement"|string} type
 * @returns {boolean}
 */
export function wallBlocksCollision(wall, type = "movement") {
  if (!wall || typeof wall !== "object") {
    return false;
  }
  if (wall.type === "ethereal") {
    return false;
  }
  if (type === "movement" && isDoorLike(wall)) {
    if (wall.locked === true) {
      return true;
    }
    return !isDoorOpen(wall);
  }
  return true;
}

function distanceToSegment(point, wall) {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - wall.x1, point.y - wall.y1);
  }
  let t = ((point.x - wall.x1) * dx + (point.y - wall.y1) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(
    point.x - (wall.x1 + t * dx),
    point.y - (wall.y1 + t * dy),
  );
}

/**
 * Walls, doors and secret doors.
 *
 * Drag-created segments snap both endpoints to grid intersections. Door and
 * secret segments render a door icon at their midpoint; clicking toggles the
 * open state and right-clicking locks/unlocks it.
 */
export class WallLayer extends Container {
  constructor(app, viewport, grid) {
    super();
    this.label = "walls";
    this.app = app;
    this.viewport = viewport;
    this.grid = grid;

    this.storage = new Container();
    this.storage.label = "walls:committed";
    this.selection = new Graphics();
    this.selection.label = "walls:selection";
    this.preview = new Graphics();
    this.preview.label = "walls:preview";
    this.addChild(this.storage, this.selection, this.preview);

    /** @type {Array<{id:string,type:string,x1:number,y1:number,x2:number,y2:number,open:boolean,locked:boolean}>} */
    this.walls = [];
    this._sequence = 0;

    /** @type {Set<string>} multi-selection for the wall `select` tool */
    this.selectedIds = new Set();
    this.dragState = null;

    this.activeType = null;
    this.startCorner = null;
    this.currentCorner = null;
    /** Endpoint of the previous chained segment (Ctrl held on release). */
    this.chainFrom = null;
  }

  get _zoom() {
    return this.viewport && this.viewport.zoom ? this.viewport.zoom : 1;
  }

  /**
   * Every committed wall endpoint is a snap node for the next segment.
   * `excludeWall` skips the wall whose node is being dragged so it cannot
   * magnet to itself.
   */
  _wallNodes(excludeWall = null) {
    const nodes = [];
    for (const wall of this.walls) {
      if (wall === excludeWall) {
        continue;
      }
      nodes.push({ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 });
    }
    return nodes;
  }

  /** Closest existing wall node within a screen-space radius, or null. */
  nearestNode(worldPoint, radius = NODE_MAGNET_PX / this._zoom, excludeWall = null) {
    let best = null;
    let bestDistance = radius;
    for (const node of this._wallNodes(excludeWall)) {
      const distance = Math.hypot(node.x - worldPoint.x, node.y - worldPoint.y);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = node;
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  /**
   * Resolve a wall endpoint. Default: magnetise to a nearby existing node,
   * otherwise snap to the grid intersection. `free` (Shift) keeps the raw
   * pointer position and disables both behaviours.
   */
  resolvePoint(worldPoint, options = {}) {
    const point = {
      x: Number(worldPoint && worldPoint.x) || 0,
      y: Number(worldPoint && worldPoint.y) || 0,
    };
    if (options.free) {
      return point;
    }
    const magnet = this.nearestNode(
      point,
      NODE_MAGNET_PX / this._zoom,
      options.excludeWall || null,
    );
    if (magnet) {
      return magnet;
    }
    return this.grid.snapToCorner(point);
  }

  begin(worldPoint, type, options = {}) {
    if (!WALL_TOOLS.has(type)) {
      return;
    }
    this.activeType = type;
    // A Ctrl-chained release keeps the previous endpoint as the anchor, so
    // the next segment starts exactly where the last one ended.
    if (this.chainFrom) {
      this.startCorner = { x: this.chainFrom.x, y: this.chainFrom.y };
    } else {
      this.startCorner = this.resolvePoint(worldPoint, {
        free: Boolean(options.free),
      });
    }
    this.currentCorner = this.resolvePoint(worldPoint, {
      free: Boolean(options.free),
    });
    this.preview.clear();
    this._renderPreview();
  }

  update(worldPoint, options = {}) {
    if (!this.activeType || !this.startCorner) {
      return;
    }
    this.currentCorner = this.resolvePoint(worldPoint, {
      free: Boolean(options.free),
    });
    this._renderPreview();
  }

  /**
   * Commit the drawn segment.
   *
   * `options.free` (Shift) disables grid snapping and node magnetism.
   * `options.chain` (Ctrl) keeps the tool armed and anchors the next segment
   * at the just-saved endpoint. Returns true when chaining continues.
   */
  end(worldPoint, options = {}) {
    if (!this.activeType || !this.startCorner) {
      return false;
    }
    if (worldPoint) {
      this.currentCorner = this.resolvePoint(worldPoint, {
        free: Boolean(options.free),
      });
    }
    const start = this.startCorner;
    const end = this.currentCorner;
    let committed = false;
    if (start && end && (start.x !== end.x || start.y !== end.y)) {
      this._sequence += 1;
      this.walls.push({
        id: "wall-" + this._sequence,
        type: this.activeType,
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        open: false,
        locked: false,
      });
      this.renderAll();
      committed = true;
    }
    if (options.chain && committed) {
      this.chainFrom = { x: end.x, y: end.y };
      this.startCorner = { x: end.x, y: end.y };
      this.currentCorner = { x: end.x, y: end.y };
      this.preview.clear();
      return true;
    }
    this.chainFrom = null;
    this.activeType = null;
    this.startCorner = null;
    this.currentCorner = null;
    this.preview.clear();
    return false;
  }

  cancelPreview() {
    this.activeType = null;
    this.startCorner = null;
    this.currentCorner = null;
    this.chainFrom = null;
    this.preview.clear();
  }

  _renderPreview() {
    const g = this.preview;
    g.clear();
    if (!this.startCorner || !this.currentCorner) {
      return;
    }
    const style = WALL_STYLES[this.activeType] || WALL_STYLES.normal;
    const width = Math.max(2, 4 / this._zoom);
    g.moveTo(this.startCorner.x, this.startCorner.y)
      .lineTo(this.currentCorner.x, this.currentCorner.y)
      .stroke({ color: style.color, width, alpha: 1 });
    // Live endpoint handle: turns bright when it is glued to a wall node.
    const radius = Math.max(3, 5 / this._zoom);
    const magnet = this.nearestNode(
      this.currentCorner,
      NODE_MAGNET_PX / this._zoom,
    );
    g.circle(
      this.currentCorner.x,
      this.currentCorner.y,
      magnet ? radius * 1.3 : radius,
    ).fill({ color: magnet ? 0x66d9ff : style.color, alpha: 1 });
  }

  renderAll() {
    const removed = this.storage.removeChildren();
    for (const child of removed) {
      child.destroy({ children: true });
    }

    for (const wall of this.walls) {
      const g = new Graphics();
      g.moveTo(wall.x1, wall.y1).lineTo(wall.x2, wall.y2).stroke({
        color: wallColor(wall),
        width: 5,
        alpha: WALL_STYLES[wall.type] ? WALL_STYLES[wall.type].alpha : 1,
      });
      this.storage.addChild(g);

      if (wall.type === "door" || wall.type === "secret") {
        const midpoint = wallMidpoint(wall);
        if (wall.type === "secret") {
          // Secret doors use a distinct arch glyph instead of the normal door
          // icon so the GM can tell them apart at a glance.
          this.storage.addChild(
            this._createSecretDoorIcon(midpoint, wallColor(wall)),
          );
        } else {
          const icon = wall.locked ? "🔒" : "🚪";
          const iconText = new Text({
            text: icon,
            style: {
              fontSize: 24,
              fontFamily: "system-ui, sans-serif",
              fill: wallColor(wall),
            },
          });
          iconText.anchor.set(0.5);
          iconText.position.set(midpoint.x, midpoint.y);
          iconText.eventMode = "none";
          this.storage.addChild(iconText);
        }
      }
    }

    this._renderSelection();
  }

  /** Arched gateway glyph used for secret doors. */
  _createSecretDoorIcon(point, color) {
    const radius = 8;
    const baseY = 7;
    const g = new Graphics();
    // Semicircular arch top (canvas angles: PI → 2PI walks over the top).
    g.arc(0, 0, radius, Math.PI, Math.PI * 2, false);
    g.moveTo(-radius, 0).lineTo(-radius, baseY);
    g.moveTo(radius, 0).lineTo(radius, baseY);
    g.stroke({ color, width: 2.5, alpha: 1 });
    g.position.set(point.x, point.y - 2);
    g.eventMode = "none";
    return g;
  }

  // ----------------------------------------------------- selection / drag

  _renderSelection() {
    const g = this.selection;
    g.clear();
    if (this.selectedIds.size === 0) {
      return;
    }
    const width = Math.max(3, 7 / this._zoom);
    const handle = Math.max(2, 5 / this._zoom);
    const handleWidth = Math.max(1, 1.5 / this._zoom);
    for (const wall of this.walls) {
      if (!this.selectedIds.has(wall.id)) {
        continue;
      }
      g.moveTo(wall.x1, wall.y1)
        .lineTo(wall.x2, wall.y2)
        .stroke({ color: 0x66d9ff, width, alpha: 0.95 });

      // Both draggable endpoints plus the body handle in the middle.
      g.rect(wall.x1 - handle, wall.y1 - handle, handle * 2, handle * 2)
        .fill({ color: 0xffffff, alpha: 1 })
        .stroke({ color: 0x10141c, width: handleWidth, alpha: 0.85 });
      g.rect(wall.x2 - handle, wall.y2 - handle, handle * 2, handle * 2)
        .fill({ color: 0xffffff, alpha: 1 })
        .stroke({ color: 0x10141c, width: handleWidth, alpha: 0.85 });

      const midpoint = wallMidpoint(wall);
      g.circle(midpoint.x, midpoint.y, handle)
        .fill({ color: 0x66d9ff, alpha: 1 })
        .stroke({ color: 0x10141c, width: handleWidth, alpha: 0.85 });
    }
  }

  /** Endpoint handle (0 = start, 1 = end) of a selected wall under a point. */
  handleAt(worldPoint) {
    const threshold = Math.max(8, HANDLE_HIT_PX / this._zoom);
    for (const wall of this.walls) {
      if (!this.selectedIds.has(wall.id)) {
        continue;
      }
      if (
        Math.hypot(worldPoint.x - wall.x1, worldPoint.y - wall.y1) <= threshold
      ) {
        return { wall, end: 0 };
      }
      if (
        Math.hypot(worldPoint.x - wall.x2, worldPoint.y - wall.y2) <= threshold
      ) {
        return { wall, end: 1 };
      }
    }
    return null;
  }

  /** Wall segment under a world point (within a zoom-compensated tolerance). */
  wallAt(worldPoint) {
    const tolerance = Math.max(8, 12 / this._zoom);
    for (let index = this.walls.length - 1; index >= 0; index -= 1) {
      const wall = this.walls[index];
      if (distanceToSegment(worldPoint, wall) <= tolerance) {
        return wall;
      }
    }
    return null;
  }

  // ------------------------------------------------------------- collisions

  /**
   * Test the straight segment `origin → destination` against every wall that
   * blocks the requested ray type (Step 5.1).
   *
   * @param {{x:number,y:number}} origin world-space start (token cell center)
   * @param {{x:number,y:number}} destination world-space end (cell center)
   * @param {"movement"|string} type collision filter (default `movement`)
   * @returns {{point:{x:number,y:number}, wall:object, wallId:string,
   *   type:string, distance:number}|null} nearest collision or null
   */
  checkCollision(origin, destination, type = "movement") {
    if (
      !origin ||
      typeof origin !== "object" ||
      !destination ||
      typeof destination !== "object"
    ) {
      return null;
    }
    const start = {
      x: Number(origin.x),
      y: Number(origin.y),
    };
    const end = {
      x: Number(destination.x),
      y: Number(destination.y),
    };
    if (
      !Number.isFinite(start.x) ||
      !Number.isFinite(start.y) ||
      !Number.isFinite(end.x) ||
      !Number.isFinite(end.y)
    ) {
      return null;
    }
    // A token dropped on its own cell has no movement to block.
    if (start.x === end.x && start.y === end.y) {
      return null;
    }

    let nearest = null;
    let nearestDistanceSquared = Infinity;
    const walls = Array.isArray(this.walls) ? this.walls : [];
    for (const wall of walls) {
      if (!wallBlocksCollision(wall, type)) {
        continue;
      }
      const point = segmentsIntersect(
        start,
        end,
        { x: Number(wall.x1), y: Number(wall.y1) },
        { x: Number(wall.x2), y: Number(wall.y2) },
      );
      if (!point) {
        continue;
      }
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < nearestDistanceSquared) {
        nearestDistanceSquared = distanceSquared;
        nearest = {
          point,
          wall,
          wallId: wall.id,
          type: wall.type,
          distance: Math.sqrt(distanceSquared),
        };
      }
    }
    return nearest;
  }


  selectWall(id) {
    this.selectWalls(id ? [id] : []);
    return this.walls.find((wall) => wall.id === id) || null;
  }

  selectWalls(ids) {
    const known = new Set(
      this.walls.map(function (wall) {
        return wall.id;
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
    this.dragState = null;
    this._renderSelection();
  }

  /** Walls whose segment bounding box intersects the marquee rectangle. */
  wallsInRect(rect) {
    return this.walls.filter((wall) => {
      const minX = Math.min(wall.x1, wall.x2);
      const maxX = Math.max(wall.x1, wall.x2);
      const minY = Math.min(wall.y1, wall.y2);
      const maxY = Math.max(wall.y1, wall.y2);
      return (
        minX <= rect.x + rect.width &&
        maxX >= rect.x &&
        minY <= rect.y + rect.height &&
        maxY >= rect.y
      );
    });
  }

  selectInRect(rect) {
    const walls = this.wallsInRect(rect);
    this.selectWalls(
      walls.map(function (wall) {
        return wall.id;
      }),
    );
    return walls;
  }

  /**
   * Click a wall to select it and arm a drag.
   *
   * Clicking one of the endpoint handles of an already-selected wall arms a
   * node drag (length/angle edit); clicking the body moves every selected
   * segment.
   */
  beginDrag(worldPoint) {
    const handle = this.handleAt(worldPoint);
    if (handle) {
      this.dragState = {
        mode: "node",
        wall: handle.wall,
        end: handle.end,
      };
      return handle.wall;
    }

    const wall = this.wallAt(worldPoint);
    if (!wall) {
      return null;
    }
    if (!this.selectedIds.has(wall.id)) {
      this.selectWall(wall.id);
    }
    this.dragState = {
      mode: "segment",
      x: worldPoint.x,
      y: worldPoint.y,
      walls: this.walls
        .filter((entry) => this.selectedIds.has(entry.id))
        .map((entry) => ({
          wall: entry,
          x1: entry.x1,
          y1: entry.y1,
          x2: entry.x2,
          y2: entry.y2,
        })),
    };
    return wall;
  }

  updateDrag(worldPoint, options = {}) {
    if (!this.dragState) {
      return;
    }
    if (this.dragState.mode === "node") {
      const wall = this.dragState.wall;
      const point = this.resolvePoint(worldPoint, {
        free: Boolean(options.free),
        excludeWall: wall,
      });
      if (this.dragState.end === 0) {
        wall.x1 = point.x;
        wall.y1 = point.y;
      } else {
        wall.x2 = point.x;
        wall.y2 = point.y;
      }
      this.renderAll();
      return;
    }
    const dx = worldPoint.x - this.dragState.x;
    const dy = worldPoint.y - this.dragState.y;
    for (const entry of this.dragState.walls) {
      entry.wall.x1 = entry.x1 + dx;
      entry.wall.y1 = entry.y1 + dy;
      entry.wall.x2 = entry.x2 + dx;
      entry.wall.y2 = entry.y2 + dy;
    }
    this.renderAll();
  }

  endDrag() {
    if (!this.dragState) {
      return false;
    }
    this.dragState = null;
    this.renderAll();
    return true;
  }

  get draggingWall() {
    return this.dragState !== null;
  }

  deleteSelected() {
    if (this.selectedIds.size === 0) {
      return 0;
    }
    const before = this.walls.length;
    this.walls = this.walls.filter(
      (wall) => !this.selectedIds.has(wall.id),
    );
    const removed = before - this.walls.length;
    this.selectedIds = new Set();
    this.dragState = null;
    this.renderAll();
    return removed;
  }

  /** JSON-safe wall list for the active scene. */
  serialize() {
    return this.walls.map((wall) => ({
      id: wall.id,
      type: wall.type,
      x1: wall.x1,
      y1: wall.y1,
      x2: wall.x2,
      y2: wall.y2,
      open: Boolean(wall.open),
      locked: Boolean(wall.locked),
    }));
  }

  /** Replace the layer contents with a scene's serialized wall array. */
  loadState(list) {
    this.cancelPreview();
    this.clearSelection();
    this.walls = [];
    this._sequence = 0;
    for (const raw of Array.isArray(list) ? list : []) {
      if (!raw || typeof raw !== "object") {
        continue;
      }
      if (!WALL_STYLES[raw.type]) {
        continue;
      }
      const x1 = Number(raw.x1);
      const y1 = Number(raw.y1);
      const x2 = Number(raw.x2);
      const y2 = Number(raw.y2);
      if (![x1, y1, x2, y2].every(Number.isFinite)) {
        continue;
      }
      this._sequence += 1;
      this.walls.push({
        id:
          typeof raw.id === "string" && raw.id.trim() !== ""
            ? raw.id
            : "wall-" + this._sequence,
        type: raw.type,
        x1: x1,
        y1: y1,
        x2: x2,
        y2: y2,
        open: Boolean(raw.open),
        locked: Boolean(raw.locked),
      });
      const match = /-(\d+)$/.exec(this.walls[this.walls.length - 1].id);
      if (match) {
        this._sequence = Math.max(this._sequence, Number.parseInt(match[1], 10));
      }
    }
    this.renderAll();
  }

  clear() {
    this.cancelPreview();
    this.clearSelection();
    this.walls = [];
    this._sequence = 0;
    this.renderAll();
  }

  /** Find a door/secret wall under a world point (icon hit area). */
  doorAt(worldPoint) {
    const radius = Math.max(20, this.grid.gridSize * 0.45);
    for (let index = this.walls.length - 1; index >= 0; index -= 1) {
      const wall = this.walls[index];
      if (wall.type !== "door" && wall.type !== "secret") {
        continue;
      }
      const midpoint = wallMidpoint(wall);
      if (
        Math.hypot(worldPoint.x - midpoint.x, worldPoint.y - midpoint.y) <=
        radius
      ) {
        return wall;
      }
    }
    return null;
  }

  /**
   * Door interaction: LMB toggles open/closed, RMB toggles the lock.
   * Returns true when a door consumed the click.
   */
  handleDoorAction(worldPoint, button) {
    const wall = this.doorAt(worldPoint);
    if (!wall) {
      return false;
    }
    if (button === 2) {
      wall.locked = !wall.locked;
      if (wall.locked) {
        wall.open = false;
      }
    } else if (!wall.locked) {
      wall.open = !wall.open;
    }
    this.renderAll();
    return true;
  }
}
