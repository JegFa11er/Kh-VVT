import { Container, Graphics, Text } from "pixi.js";

import { pointInPolygon } from "./math.js";

const PLAYER_COLOR = 0x3f8cff;
const ENEMY_COLOR = 0xe05252;
const NEUTRAL_COLOR = 0x9aa4b2;
const ACTIVE_RING = 0xffd166;

// Step 4.8.5: actor-linked token HP bar.
const HP_BAR_BACKGROUND = 0x161b24;
const HP_BAR_FRAME = 0x0b0e14;
const HP_BAR_GREEN = 0x4caf70;
const HP_BAR_YELLOW = 0xf2c94c;
const HP_BAR_RED = 0xe05252;

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function asFiniteCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

/**
 * Renders combatant tokens and actor-linked scene tokens on the grid.
 *
 * Two token kinds share one container:
 *  - `combatant` tokens come from the authoritative `combatState` snapshot;
 *  - `actor` tokens are scene tokens created by dropping an actor card on the
 *    canvas (`room:create-token`) and carry a live HP bar fed from the actor's
 *    sheet (`actor.system.derived.hp` / `actor.system.attributes.hp`).
 *
 * The layer reacts to `room:state-update` through `setCombatState()` and to
 * `room:update-actor` / directory broadcasts through `setActors()`, so HP bars
 * repaint in real time without rebuilding the scene.
 */
export class TokenLayer extends Container {
  constructor(options = {}) {
    super();
    this.label = "tokens";

    this.cellSize = options.cellSize || 70;
    /** @type {Map<string, Container>} token id (combatant id or scene token id) -> container */
    this.tokens = new Map();
    /** @type {Map<string, object>} actor id -> directory actor entry */
    this.actors = new Map();
    /** Latest serialized combat state (`room:state-update`). */
    this.combatState = null;
    this.activeCombatantId = null;
    this.selectedId = null;
    this.selectedIds = new Set();
    this.dragToken = null;
    this.dragOffset = { x: 0, y: 0 };
    /** Original world/grid position captured when a drag starts (Step 5.1). */
    this.dragOrigin = null;
    /** Latest line-of-sight state pushed by `VisionLayer` (Step 5.2). */
    this.visionState = null;
    /**
     * Step 5.3: while a fog-of-war layer is active a player may only see tokens
     * inside the current LOS polygon. There is no "restore everything" state
     * for players anymore — explored-but-out-of-sight tokens stay hidden.
     */
    this.fogEnabled = false;
    /** The GM always sees every token (dimmed outside the current LOS). */
    this.gmViewer = false;
    /** Called with the selected id whenever the selection changes. */
    this.onSelectionChange = null;
  }

  setCellSize(cellSize) {
    this.cellSize = cellSize;
    for (const token of this.tokens.values()) {
      this._placeToken(token);
      this._paintToken(token);
    }
  }

  // ------------------------------------------------------------- actor data

  /**
   * Replace the actor directory cache. Called after `joined`,
   * `session:snapshot`, `room:directories-update` and `room:update-actor`.
   */
  setActors(actors) {
    const next = new Map();
    if (Array.isArray(actors)) {
      for (const actor of actors) {
        if (actor && typeof actor.id === "string") {
          next.set(actor.id, actor);
        }
      }
    } else if (actors && typeof actors === "object") {
      for (const [id, actor] of Object.entries(actors)) {
        if (actor && typeof actor === "object") {
          next.set(id, actor);
        }
      }
    }
    this.actors = next;
    for (const token of this.tokens.values()) {
      if (token.kind === "actor") {
        this._paintActorToken(token);
      }
    }
  }

  /** Merge one actor payload (focused `room:update-actor` broadcast). */
  upsertActor(actor) {
    if (!actor || typeof actor !== "object" || typeof actor.id !== "string") {
      return;
    }
    this.actors.set(actor.id, actor);
    for (const token of this.tokens.values()) {
      if (token.kind === "actor" && token.actorId === actor.id) {
        this._paintActorToken(token);
      }
    }
  }

  /** Store the latest authoritative combat state and repaint actor tokens. */
  setCombatState(state) {
    this.combatState = state || null;
    this.activeCombatantId =
      state && state.encounter && state.encounter.activeCombatantId
        ? state.encounter.activeCombatantId
        : null;
    for (const token of this.tokens.values()) {
      if (token.kind === "actor") {
        this._paintActorToken(token);
      }
    }
  }

  _combatantForActor(actorId) {
    if (!this.combatState || !Array.isArray(this.combatState.combatants)) {
      return null;
    }
    for (const combatant of this.combatState.combatants) {
      if (!combatant) {
        continue;
      }
      if (combatant.actorId === actorId || combatant.id === actorId) {
        return combatant;
      }
    }
    return null;
  }

  /**
   * Current/maximum HP from the linked actor. `system.derived.hp` is preferred
   * (it is always prepared by the sheet pipeline) with the raw
   * `system.attributes.hp` as a fallback for legacy payloads.
   */
  _resolveActorHp(actor) {
    const system = actor && actor.system ? actor.system : {};
    const derived = system.derived && system.derived.hp ? system.derived.hp : {};
    const attributes =
      system.attributes && system.attributes.hp ? system.attributes.hp : {};
    const rawValue =
      derived.value !== undefined && derived.value !== null
        ? derived.value
        : attributes.value;
    const rawMax =
      derived.max !== undefined && derived.max !== null
        ? derived.max
        : attributes.max;
    const value = Number(rawValue);
    const max = Number(rawMax);
    return {
      value: Number.isFinite(value) ? Math.max(0, value) : 0,
      max: Number.isFinite(max) ? Math.max(0, max) : 0,
    };
  }

  _colorForCombatant(combatant) {
    if (combatant.alliance === "player") {
      return PLAYER_COLOR;
    }
    if (combatant.alliance === "enemy") {
      return ENEMY_COLOR;
    }
    return NEUTRAL_COLOR;
  }

  _colorForActor(actor) {
    if (!actor) {
      return NEUTRAL_COLOR;
    }
    return actor.actorType === "npc" ? ENEMY_COLOR : PLAYER_COLOR;
  }

  _initials(name) {
    const text = typeof name === "string" && name.trim() !== "" ? name.trim() : "?";
    return text
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
  }

  _label(radius, text) {
    const label = new Text({
      text: this._initials(text),
      style: {
        fill: 0xffffff,
        fontSize: Math.max(12, Math.round(radius * 0.85)),
        fontWeight: "600",
        fontFamily: "system-ui, sans-serif",
      },
    });
    label.anchor.set(0.5);
    return label;
  }

  // --------------------------------------------------------------- creation

  _createCombatantToken(combatant) {
    const container = new Container();
    container.label = "token:" + combatant.id;

    const radius = this.cellSize * 0.38;
    const body = new Graphics();
    body.circle(0, 0, radius).fill({ color: this._colorForCombatant(combatant), alpha: 0.92 });
    body.circle(0, 0, radius).stroke({ color: 0x0b0e14, width: 2, alpha: 0.9 });

    const label = this._label(radius, combatant.name);

    container.addChild(body, label);
    container.body = body;
    container.labelText = label;
    container.kind = "combatant";
    container.combatantId = combatant.id;
    container.combatantData = combatant;

    this.addChild(container);
    this.tokens.set(combatant.id, container);
    return container;
  }

  /** Create a scene token bound to a directory actor (Step 4.8.5). */
  _createActorToken(sceneToken) {
    const container = new Container();
    container.label = "token:" + sceneToken.id;

    const radius = this.cellSize * 0.38;
    const body = new Graphics();
    const label = this._label(radius, sceneToken.name || sceneToken.actorId);
    const hpBar = new Graphics();

    container.addChild(body, label, hpBar);
    container.body = body;
    container.labelText = label;
    container.hpBar = hpBar;
    container.kind = "actor";
    container.combatantId = sceneToken.id;
    container.actorTokenId = sceneToken.id;
    container.actorId = sceneToken.actorId;
    container.actorToken = sceneToken;
    container.sceneToken = sceneToken;
    container.gridX = asFiniteCoordinate(sceneToken.gridX);
    container.gridY = asFiniteCoordinate(sceneToken.gridY);

    this.addChild(container);
    this.tokens.set(sceneToken.id, container);
    return container;
  }

  // -------------------------------------------------------------- placement

  // NOTE: do not name this `_position`: Pixi's Container owns an internal
  // `_position` ObservablePoint on the instance, which would shadow the method.
  _placeToken(token) {
    const half = this.cellSize / 2;
    token.x = (token.gridX === undefined ? 0 : token.gridX) * this.cellSize + half;
    token.y = (token.gridY === undefined ? 0 : token.gridY) * this.cellSize + half;
  }

  // ---------------------------------------------------------------- painting

  _paintCombatantToken(token) {
    const combatant = token.combatantData;
    if (!combatant || !token.body) {
      return;
    }
    const radius = this.cellSize * 0.38;
    token.body.clear();
    token.body.circle(0, 0, radius).fill({
      color: this._colorForCombatant(combatant),
      alpha: combatant.defeated ? 0.35 : 0.92,
    });
    token.body.circle(0, 0, radius).stroke({ color: 0x0b0e14, width: 2, alpha: 0.9 });

    if (combatant.id === this.activeCombatantId) {
      token.body.circle(0, 0, radius + 4).stroke({ color: ACTIVE_RING, width: 3, alpha: 1 });
    }
    if (this.selectedIds.has(combatant.id)) {
      token.body.circle(0, 0, radius + 8).stroke({ color: 0xffffff, width: 3, alpha: 0.95 });
    }

    token.baseAlpha = combatant.defeated ? 0.55 : 1;
    this._applyVisionToToken(token.combatantId, token);
  }

  _paintActorToken(token) {
    if (!token.body) {
      return;
    }
    const actor = this.actors.get(token.actorId) || null;
    const combatant = this._combatantForActor(token.actorId);
    const hp = this._resolveActorHp(actor);
    const radius = this.cellSize * 0.38;
    const defeated =
      (combatant && combatant.defeated) || (hp.max > 0 && hp.value <= 0);

    token.actorData = actor;
    token.combatantData = {
      id: token.actorId || token.actorTokenId,
      actorId: token.actorId,
      name: (actor && actor.name) || token.sceneToken?.name || token.actorId,
      alliance: actor && actor.actorType === "npc" ? "enemy" : "player",
      defeated: defeated,
    };

    token.labelText.text = this._initials(token.combatantData.name);
    token.labelText.style.fontSize = Math.max(12, Math.round(radius * 0.85));

    token.body.clear();
    token.body.circle(0, 0, radius).fill({
      color: this._colorForActor(actor),
      alpha: defeated ? 0.35 : 0.92,
    });
    token.body.circle(0, 0, radius).stroke({ color: 0x0b0e14, width: 2, alpha: 0.9 });

    const isActive = Boolean(
      combatant
        ? combatant.id === this.activeCombatantId
        : this.activeCombatantId === token.actorId,
    );
    if (isActive) {
      token.body.circle(0, 0, radius + 4).stroke({ color: ACTIVE_RING, width: 3, alpha: 1 });
    }
    if (this.selectedIds.has(token.actorTokenId)) {
      token.body.circle(0, 0, radius + 8).stroke({ color: 0xffffff, width: 3, alpha: 0.95 });
    }

    this._paintHpBar(token, hp, radius);
    token.baseAlpha = defeated ? 0.55 : 1;
    this._applyVisionToToken(token.combatantId, token);
  }

  _paintHpBar(token, hp, radius) {
    const bar = token.hpBar;
    if (!bar) {
      return;
    }
    bar.clear();
    if (!(hp.max > 0)) {
      return;
    }

    const width = Math.max(18, this.cellSize * 0.76);
    const height = Math.max(5, Math.round(this.cellSize * 0.085));
    const x = -width / 2;
    const y = radius + Math.max(3, this.cellSize * 0.05);
    const ratio = clamp01(hp.value / hp.max);
    const color =
      ratio > 0.5 ? HP_BAR_GREEN : ratio > 0.25 ? HP_BAR_YELLOW : HP_BAR_RED;

    bar
      .roundRect(x, y, width, height, 2)
      .fill({ color: HP_BAR_BACKGROUND, alpha: 0.96 });

    if (ratio > 0) {
      bar
        .roundRect(x + 1, y + 1, Math.max(1, (width - 2) * ratio), height - 2, 1)
        .fill({ color: color, alpha: 1 });
    }

    bar
      .roundRect(x, y, width, height, 2)
      .stroke({ color: HP_BAR_FRAME, width: 2, alpha: 0.95 });
  }

  _paintToken(token) {
    if (token.kind === "actor") {
      this._paintActorToken(token);
      return;
    }
    this._paintCombatantToken(token);
  }

  // ------------------------------------------------------------------ vision

  /** Enable/disable the fog-of-war token visibility rules (Step 5.3). */
  setFogEnabled(enabled) {
    this.fogEnabled = Boolean(enabled);
    if (this.visionState) {
      this.applyVisionState(this.visionState);
      return;
    }
    for (const [id, token] of this.tokens) {
      this._applyVisionToToken(id, token);
    }
  }

  /** Mark the current viewer as the GM (sees every token, dimmed off-LOS). */
  setGMViewer(isGM) {
    this.gmViewer = Boolean(isGM);
    if (this.visionState) {
      this.applyVisionState(this.visionState);
      return;
    }
    for (const [id, token] of this.tokens) {
      this._applyVisionToToken(id, token);
    }
  }

  /**
   * Apply the latest line-of-sight state (Step 5.2) together with the fog of
   * war rules (Step 5.3).
   *
   * `state = null` means "no token has an active LOS polygon". Without fog the
   * old behaviour is kept (everything visible). With fog enabled a player only
   * sees tokens that are inside the current polygon, therefore every other
   * token is hidden; the GM still sees the whole map, dimmed outside the
   * polygon.
   */
  applyVisionState(state) {
    const polygon =
      state && Array.isArray(state.polygon) && state.polygon.length >= 3
        ? state.polygon
        : null;
    this.visionState = polygon
      ? {
          origin: state.origin || null,
          polygon: polygon,
          gmVision: Boolean(state.gmVision),
        }
      : null;
    for (const [id, token] of this.tokens) {
      this._applyVisionToToken(id, token);
    }
    return this.visionState;
  }

  _applyVisionToToken(id, token) {
    const state = this.visionState;
    const isSelected = this.selectedId !== null && id === this.selectedId;
    const isGM = this.gmViewer || Boolean(state && state.gmVision);
    const inside =
      state && state.polygon
        ? pointInPolygon({ x: token.x, y: token.y }, state.polygon)
        : false;

    if (isSelected) {
      token.visionVisible = true;
      token.visionAlpha = 1;
    } else if (isGM) {
      // The GM sees everybody; off-LOS tokens are dimmed instead of hidden.
      token.visionVisible = true;
      token.visionAlpha = state && !inside ? 0.45 : 1;
    } else if (this.fogEnabled) {
      // Fog of war: explored history is not enough. A foreign token is visible
      // only while it stands inside the current active LOS polygon.
      token.visionVisible = Boolean(state) && inside;
      token.visionAlpha = 1;
    } else if (!state) {
      token.visionVisible = true;
      token.visionAlpha = 1;
    } else {
      token.visionVisible = inside;
      token.visionAlpha = 1;
    }
    this._applyTokenPresentation(token);
  }

  /** Combine the paint alpha (defeated) with the vision alpha/visibility. */
  _applyTokenPresentation(token) {
    const baseAlpha = Number.isFinite(token.baseAlpha) ? token.baseAlpha : 1;
    const visionAlpha = Number.isFinite(token.visionAlpha)
      ? token.visionAlpha
      : 1;
    token.alpha = baseAlpha * visionAlpha;
    token.visible = token.visionVisible !== false;
  }

  _notifySelectionChange() {
    if (typeof this.onSelectionChange === "function") {
      this.onSelectionChange(this.selectedId);
    }
  }

  _updateAppearance(token, combatant) {
    token.combatantData = combatant;
    token.gridX = combatant.x;
    token.gridY = combatant.y;
    if (token === this.dragToken) {
      // Keep the pointer-held position while a drag is in progress.
      this._paintCombatantToken(token);
      return;
    }
    this._placeToken(token);
    this._paintCombatantToken(token);
  }

  // -------------------------------------------------------------- syncing

  /** Reconcile combatant tokens with a session snapshot's combatant list. */
  sync(combatants, activeCombatantId) {
    const seen = new Set();
    this.activeCombatantId = activeCombatantId === undefined ? null : activeCombatantId;

    for (const combatant of combatants || []) {
      seen.add(combatant.id);
      const token = this.tokens.get(combatant.id) || this._createCombatantToken(combatant);
      this._updateAppearance(token, combatant);
    }

    for (const [id, token] of this.tokens) {
      if (token.kind === "combatant" && !seen.has(id)) {
        token.destroy({ children: true });
        this.tokens.delete(id);
        this.selectedIds.delete(id);
      }
    }

    // An actor token may be linked to the new active combatant.
    for (const token of this.tokens.values()) {
      if (token.kind === "actor") {
        this._paintActorToken(token);
      }
    }
  }

  /**
   * Reconcile actor-linked scene tokens with `scenes[id].tokens`.
   *
   * Entries without an `actorId` are legacy combatant-position records and are
   * handled by `applyScenePositions()` instead.
   */
  syncActorTokens(list) {
    const seen = new Set();
    for (const entry of Array.isArray(list) ? list : []) {
      if (
        !entry ||
        typeof entry.id !== "string" ||
        typeof entry.actorId !== "string" ||
        entry.actorId === ""
      ) {
        continue;
      }
      seen.add(entry.id);
      let token = this.tokens.get(entry.id) || null;
      if (token && token.kind !== "actor") {
        continue;
      }
      if (!token) {
        token = this._createActorToken(entry);
      }
      token.sceneToken = entry;
      token.actorToken = entry;
      token.actorId = entry.actorId;
      token.gridX = asFiniteCoordinate(entry.gridX);
      token.gridY = asFiniteCoordinate(entry.gridY);
      if (token !== this.dragToken) {
        this._placeToken(token);
      }
      this._paintActorToken(token);
    }

    for (const [id, token] of this.tokens) {
      if (token.kind === "actor" && !seen.has(id)) {
        token.destroy({ children: true });
        this.tokens.delete(id);
        this.selectedIds.delete(id);
      }
    }
  }

  // ------------------------------------------------------------ hit testing

  /** Topmost token whose body contains a world-space point. */
  tokenAt(worldPoint) {
    const radius = this.cellSize * 0.38;
    const list = Array.from(this.tokens.values());
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const token = list[index];
      if (Math.hypot(worldPoint.x - token.x, worldPoint.y - token.y) <= radius) {
        return token;
      }
    }
    return null;
  }

  selectToken(combatantId) {
    this.selectTokens(combatantId ? [combatantId] : []);
    return this.selectedId ? this.tokens.get(this.selectedId) || null : null;
  }

  selectTokens(combatantIds) {
    const previous = Array.from(this.selectedIds);
    this.selectedIds = new Set(
      (combatantIds || []).filter((id) => this.tokens.has(id)),
    );
    this.selectedId = this.selectedIds.size
      ? Array.from(this.selectedIds)[this.selectedIds.size - 1]
      : null;
    const toRepaint = new Set([...previous, ...this.selectedIds]);
    for (const id of toRepaint) {
      const token = this.tokens.get(id);
      if (token && token !== this.dragToken) {
        this._paintToken(token);
      }
    }
    // Re-evaluate visibility for the new selection before the vision layer
    // rebuilds the polygon for this token.
    if (this.visionState) {
      this.applyVisionState(this.visionState);
    }
    this._notifySelectionChange();
    return this.selectedIds;
  }

  isSelected(combatantId) {
    return this.selectedIds.has(combatantId);
  }

  /** True when the selected id belongs to an actor-linked scene token. */
  isActorToken(id) {
    const token = this.tokens.get(id);
    return Boolean(token && token.kind === "actor");
  }

  /** Tokens whose circular body intersects the marquee rectangle. */
  tokensInRect(rect) {
    const radius = this.cellSize * 0.38;
    const result = [];
    for (const token of this.tokens.values()) {
      if (
        token.x - radius <= rect.x + rect.width &&
        token.x + radius >= rect.x &&
        token.y - radius <= rect.y + rect.height &&
        token.y + radius >= rect.y
      ) {
        result.push(token);
      }
    }
    return result;
  }

  selectInRect(rect) {
    const tokens = this.tokensInRect(rect);
    this.selectTokens(tokens.map((token) => token.combatantId));
    return tokens;
  }

  /** Remove the selected tokens from the local canvas. Returns their ids. */
  deleteSelected() {
    const ids = Array.from(this.selectedIds);
    if (ids.length === 0) {
      return [];
    }
    for (const id of ids) {
      const token = this.tokens.get(id);
      if (token) {
        token.destroy({ children: true });
        this.tokens.delete(id);
      }
    }
    this.selectedIds = new Set();
    this.selectedId = null;
    this.dragToken = null;
    this.dragOrigin = null;
    this._notifySelectionChange();
    return ids;
  }

  clearSelection() {
    return this.selectTokens([]);
  }

  /** JSON-safe token records for the active scene canvas. */
  serializeScene() {
    const result = [];
    for (const token of this.tokens.values()) {
      if (token.kind === "actor") {
        result.push({
          id: token.actorTokenId,
          actorId: token.actorId,
          gridX: Number.isFinite(token.gridX) ? token.gridX : 0,
          gridY: Number.isFinite(token.gridY) ? token.gridY : 0,
        });
        continue;
      }
      result.push({
        combatantId: token.combatantId,
        gridX: Number.isFinite(token.gridX) ? token.gridX : 0,
        gridY: Number.isFinite(token.gridY) ? token.gridY : 0,
      });
    }
    return result;
  }

  /** Restore scene-saved combatant positions after the combatant sync. */
  applyScenePositions(list) {
    if (!Array.isArray(list) || list.length === 0) {
      return;
    }
    const saved = new Map();
    for (const entry of list) {
      if (
        entry &&
        typeof entry.combatantId === "string" &&
        Number.isFinite(entry.gridX) &&
        Number.isFinite(entry.gridY)
      ) {
        saved.set(entry.combatantId, entry);
      }
    }
    for (const token of this.tokens.values()) {
      if (token.kind === "actor") {
        continue;
      }
      const position = saved.get(token.combatantId);
      if (!position) {
        continue;
      }
      token.gridX = position.gridX;
      token.gridY = position.gridY;
      if (token.combatantData) {
        token.combatantData.x = position.gridX;
        token.combatantData.y = position.gridY;
      }
      if (token !== this.dragToken) {
        this._placeToken(token);
      }
    }
  }

  // ------------------------------------------------------------------ drag

  /**
   * Start dragging the token under the cursor. Returns the token or null.
   * The interaction layer pauses the camera drag while this gesture runs.
   */
  beginDrag(worldPoint) {
    const token = this.tokenAt(worldPoint);
    if (!token) {
      return null;
    }
    this.selectToken(token.combatantId);
    this.dragToken = token;
    this.dragOffset = {
      x: worldPoint.x - token.x,
      y: worldPoint.y - token.y,
    };
    // Snapshot the starting cell so a blocked drop can snap back exactly.
    this.dragOrigin = {
      x: token.x,
      y: token.y,
      gridX: token.gridX,
      gridY: token.gridY,
    };
    return token;
  }

  updateDrag(worldPoint) {
    if (!this.dragToken) {
      return;
    }
    this.dragToken.x = worldPoint.x - this.dragOffset.x;
    this.dragToken.y = worldPoint.y - this.dragOffset.y;
  }

  /** World-space center where the token currently sits (start of the drag). */
  dragStartCenter() {
    if (!this.dragToken || !this.dragOrigin) {
      return null;
    }
    return { x: this.dragOrigin.x, y: this.dragOrigin.y };
  }

  /**
   * Center of the grid cell the token would land on for a drop at
   * `worldPoint`. Used by the collision check before coordinates are changed.
   */
  dragTargetCenter(worldPoint) {
    const cell = this._dropCell(worldPoint);
    if (!cell) {
      return null;
    }
    return {
      x: cell.col * this.cellSize + this.cellSize / 2,
      y: cell.row * this.cellSize + this.cellSize / 2,
      col: cell.col,
      row: cell.row,
    };
  }

  _dropCell(worldPoint) {
    const token = this.dragToken;
    if (!token) {
      return null;
    }
    const x = worldPoint ? worldPoint.x - this.dragOffset.x : token.x;
    const y = worldPoint ? worldPoint.y - this.dragOffset.y : token.y;
    return {
      col: Math.floor(x / this.cellSize),
      row: Math.floor(y / this.cellSize),
      x: x,
      y: y,
    };
  }

  /**
   * Abort the current drag and restore the token to its pre-drag cell
   * (Step 5.1 blocked movement). No scene data is mutated.
   */
  cancelDrag() {
    const token = this.dragToken;
    if (!token) {
      return null;
    }
    const origin = this.dragOrigin;
    if (origin) {
      token.x = origin.x;
      token.y = origin.y;
      token.gridX = origin.gridX;
      token.gridY = origin.gridY;
      this._placeToken(token);
      this._paintToken(token);
    }
    this.dragToken = null;
    this.dragOrigin = null;
    return token;
  }

  /** Drop the dragged token on the nearest cell. */
  endDrag(worldPoint) {
    const token = this.dragToken;
    if (!token) {
      return null;
    }
    const cell = this._dropCell(worldPoint);
    token.x = cell.x;
    token.y = cell.y;
    const col = cell.col;
    const row = cell.row;
    token.gridX = col;
    token.gridY = row;
    this.dragToken = null;
    this.dragOrigin = null;
    this._placeToken(token);
    if (token.kind === "actor") {
      if (token.sceneToken) {
        token.sceneToken.gridX = col;
        token.sceneToken.gridY = row;
      }
      this._paintActorToken(token);
    } else if (token.combatantData) {
      token.combatantData.x = col;
      token.combatantData.y = row;
    }
    return { token: token, col: col, row: row };
  }

  get draggingToken() {
    return this.dragToken !== null;
  }

  clear() {
    this.dragToken = null;
    this.dragOrigin = null;
    this.selectedId = null;
    this.selectedIds = new Set();
    this.visionState = null;
    for (const token of this.tokens.values()) {
      token.destroy({ children: true });
    }
    this.tokens.clear();
    this._notifySelectionChange();
  }
}
