import { Container, Graphics, Text } from "pixi.js";

const PLAYER_COLOR = 0x3f8cff;
const ENEMY_COLOR = 0xe05252;
const NEUTRAL_COLOR = 0x9aa4b2;
const ACTIVE_RING = 0xffd166;

/**
 * Renders combatant tokens on the grid.
 *
 * Tokens are positioned from combatant grid coordinates (x, y) and scaled to
 * the grid cell size, so the layer works with any map dimensions.
 */
export class TokenLayer extends Container {
  constructor(options = {}) {
    super();
    this.label = "tokens";

    this.cellSize = options.cellSize || 70;
    this.tokens = new Map();
  }

  setCellSize(cellSize) {
    this.cellSize = cellSize;
    for (const token of this.tokens.values()) {
      this._placeToken(token);
    }
  }

  _colorFor(combatant) {
    if (combatant.alliance === "player") {
      return PLAYER_COLOR;
    }
    if (combatant.alliance === "enemy") {
      return ENEMY_COLOR;
    }
    return NEUTRAL_COLOR;
  }

  _createToken(combatant) {
    const container = new Container();
    container.label = "token:" + combatant.id;

    const radius = this.cellSize * 0.38;
    const body = new Graphics();
    body.circle(0, 0, radius).fill({ color: this._colorFor(combatant), alpha: 0.92 });
    body.circle(0, 0, radius).stroke({ color: 0x0b0e14, width: 2, alpha: 0.9 });

    const label = new Text({
      text: this._initials(combatant.name),
      style: {
        fill: 0xffffff,
        fontSize: Math.max(12, Math.round(radius * 0.85)),
        fontWeight: "600",
        fontFamily: "system-ui, sans-serif",
      },
    });
    label.anchor.set(0.5);

    container.addChild(body, label);
    container.body = body;
    container.labelText = label;
    container.combatantId = combatant.id;

    this.addChild(container);
    this.tokens.set(combatant.id, container);
    return container;
  }

  _initials(name) {
    const text = typeof name === "string" && name.trim() !== "" ? name.trim() : "?";
    return text
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
  }

  // NOTE: do not name this `_position`: Pixi's Container owns an internal
  // `_position` ObservablePoint on the instance, which would shadow the method.
  _placeToken(token) {
    const half = this.cellSize / 2;
    token.x = (token.gridX === undefined ? 0 : token.gridX) * this.cellSize + half;
    token.y = (token.gridY === undefined ? 0 : token.gridY) * this.cellSize + half;
  }

  _updateAppearance(token, combatant, activeCombatantId) {
    token.gridX = combatant.x;
    token.gridY = combatant.y;
    this._placeToken(token);

    const radius = this.cellSize * 0.38;
    token.body.clear();
    token.body.circle(0, 0, radius).fill({
      color: this._colorFor(combatant),
      alpha: combatant.defeated ? 0.35 : 0.92,
    });
    token.body.circle(0, 0, radius).stroke({ color: 0x0b0e14, width: 2, alpha: 0.9 });

    if (combatant.id === activeCombatantId) {
      token.body.circle(0, 0, radius + 4).stroke({ color: ACTIVE_RING, width: 3, alpha: 1 });
    }

    token.alpha = combatant.defeated ? 0.55 : 1;
  }

  /** Reconcile the layer with a session snapshot's combatant list. */
  sync(combatants, activeCombatantId) {
    const seen = new Set();

    for (const combatant of combatants || []) {
      seen.add(combatant.id);
      const token = this.tokens.get(combatant.id) || this._createToken(combatant);
      this._updateAppearance(token, combatant, activeCombatantId);
    }

    for (const [id, token] of this.tokens) {
      if (!seen.has(id)) {
        token.destroy({ children: true });
        this.tokens.delete(id);
      }
    }
  }

  clear() {
    for (const token of this.tokens.values()) {
      token.destroy({ children: true });
    }
    this.tokens.clear();
  }
}
