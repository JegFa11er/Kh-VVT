import { Container, Graphics, Text } from "pixi.js";

const BUBBLE_TTL_MS = 6500;
const BUBBLE_FADE_MS = 900;
const MAX_TEXT_LENGTH = 180;
const MAX_WRAP_WIDTH = 220;

function now() {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

function parseColor(value, fallback = 0x8a7350) {
  if (typeof value !== "string") {
    return fallback;
  }
  const match = value.trim().match(/^#?([0-9a-f]{6})$/i);
  return match ? Number.parseInt(match[1], 16) : fallback;
}

function truncate(value, length) {
  const text = String(value || "").trim();
  if (text.length <= length) {
    return text;
  }
  return text.slice(0, Math.max(0, length - 1)).trimEnd() + "…";
}

function messageBody(message) {
  const lines = [];
  if (message && message.text) {
    lines.push(truncate(message.text, MAX_TEXT_LENGTH));
  }
  const dice = message && message.dice;
  if (dice) {
    const total = dice.hidden ? "?" : dice.total;
    lines.push("🎲 " + dice.formula + " = " + total);
  }
  if (lines.length === 0 && message && message.image) {
    lines.push("🖼 Изображение");
  }
  return lines.join("\n");
}

/**
 * Speech bubbles above combatant tokens (Step 4.8).
 *
 * The layer subscribes to `room:chat-update` and, for each new message, finds
 * the sender's token by the profile's `characterId` (falling back to the
 * author/combatant name). A bubble follows its token, fades out after ~6.5 s
 * and never blocks pointer input.
 */
export class ChatBubbleLayer extends Container {
  constructor(app, viewport, tokenLayer, networkClient) {
    super();
    this.label = "chat-bubbles";
    this.app = app;
    this.viewport = viewport;
    this.tokenLayer = tokenLayer || null;
    this.networkClient = null;

    /** @type {Map<string, {container:Container, token:Container, born:number}>} */
    this.bubbles = new Map();
    this._seenIds = new Set();
    this._primed = false;
    this._unsubscribeChat = null;
    this._tick = this._tick.bind(this);

    this.eventMode = "none";
    this.interactiveChildren = false;

    if (app && app.ticker) {
      app.ticker.add(this._tick);
    }
    if (networkClient) {
      this.setNetworkClient(networkClient);
    }
  }

  setNetworkClient(networkClient) {
    if (this._unsubscribeChat) {
      this._unsubscribeChat();
      this._unsubscribeChat = null;
    }
    this.networkClient = networkClient || null;
    if (
      this.networkClient &&
      typeof this.networkClient.onChatUpdate === "function"
    ) {
      this._unsubscribeChat = this.networkClient.onChatUpdate((chatLog) =>
        this._onChatUpdate(chatLog),
      );
    }
  }

  _onChatUpdate(chatLog) {
    if (!Array.isArray(chatLog)) {
      return;
    }

    // The first broadcast is the full viewer-filtered history. Remember it,
    // but do not paint a wall of bubbles for old messages.
    if (!this._primed) {
      this._primed = true;
      for (const message of chatLog) {
        if (message && message.id) {
          this._seenIds.add(message.id);
        }
      }
      return;
    }

    for (const message of chatLog) {
      if (!message || !message.id || this._seenIds.has(message.id)) {
        continue;
      }
      this._seenIds.add(message.id);
      this._showMessage(message);
    }

    if (this._seenIds.size > 500) {
      const keep = Array.from(this._seenIds).slice(-200);
      this._seenIds = new Set(keep);
    }
  }

  _findToken(author) {
    if (!this.tokenLayer || !author) {
      return null;
    }
    const characterId =
      typeof author.characterId === "string" ? author.characterId : null;
    const tokens = Array.from(this.tokenLayer.tokens.values());

    if (characterId) {
      for (const token of tokens) {
        const data = token.combatantData || {};
        if (
          token.combatantId === characterId ||
          data.characterId === characterId ||
          data.actorId === characterId ||
          data.id === characterId
        ) {
          return token;
        }
      }
    }

    // Older rooms may not link combatants to actor ids; the display name is a
    // stable enough fallback for the speech bubble.
    const name = String(author.name || author.characterName || "")
      .trim()
      .toLowerCase();
    if (name !== "") {
      for (const token of tokens) {
        const data = token.combatantData || {};
        if (String(data.name || "").trim().toLowerCase() === name) {
          return token;
        }
      }
    }
    return null;
  }

  _showMessage(message) {
    const body = messageBody(message);
    if (body === "") {
      return;
    }
    const token = this._findToken(message.author);
    if (!token) {
      return;
    }

    const key = token.combatantId;
    const previous = this.bubbles.get(key);
    if (previous) {
      previous.container.destroy({ children: true });
      this.bubbles.delete(key);
    }

    const color = parseColor(message.author && message.author.color);
    const container = new Container();
    container.label = "chat-bubble:" + key;
    container.eventMode = "none";

    const text = new Text({
      text: body,
      style: {
        fill: 0x231d14,
        fontSize: 13,
        fontWeight: "600",
        fontFamily: "system-ui, sans-serif",
        wordWrap: true,
        wordWrapWidth: MAX_WRAP_WIDTH,
        breakWords: true,
        lineHeight: 17,
      },
    });

    const width = Math.max(78, Math.min(MAX_WRAP_WIDTH + 22, text.width + 22));
    const height = text.height + 14;
    text.position.set(-width / 2 + 10, -height + 7);

    const background = new Graphics();
    background
      .roundRect(-width / 2, -height, width, height, 8)
      .fill({ color: 0xf4ecd9, alpha: 0.97 })
      .stroke({ color, width: 2, alpha: 0.95 });
    background
      .moveTo(-7, 0)
      .lineTo(7, 0)
      .lineTo(0, 10)
      .closePath()
      .fill({ color: 0xf4ecd9, alpha: 0.97 })
      .stroke({ color, width: 2, alpha: 0.95 });

    container.addChild(background, text);
    this.addChild(container);
    this.bubbles.set(key, { container, token, born: now() });
  }

  _tick() {
    if (this.bubbles.size === 0) {
      return;
    }
    const timestamp = now();
    const zoom = this.viewport && this.viewport.zoom ? this.viewport.zoom : 1;
    const radius = this.tokenLayer ? this.tokenLayer.cellSize * 0.38 : 24;

    for (const [key, bubble] of this.bubbles) {
      const token = bubble.token;
      const age = timestamp - bubble.born;
      if (age >= BUBBLE_TTL_MS || !token || token.destroyed) {
        bubble.container.destroy({ children: true });
        this.bubbles.delete(key);
        continue;
      }

      bubble.container.position.set(token.x, token.y - radius - 8);
      bubble.container.scale.set(1 / zoom);
      const fadeStart = BUBBLE_TTL_MS - BUBBLE_FADE_MS;
      bubble.container.alpha =
        age <= fadeStart ? 1 : Math.max(0, 1 - (age - fadeStart) / BUBBLE_FADE_MS);
    }
  }

  clear() {
    for (const bubble of this.bubbles.values()) {
      bubble.container.destroy({ children: true });
    }
    this.bubbles.clear();
  }

  destroy(options) {
    if (this.app && this.app.ticker) {
      this.app.ticker.remove(this._tick);
    }
    if (this._unsubscribeChat) {
      this._unsubscribeChat();
      this._unsubscribeChat = null;
    }
    this.clear();
    super.destroy(options);
  }
}
