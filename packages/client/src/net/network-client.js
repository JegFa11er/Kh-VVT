/**
 * Thin WebSocket client for the @pf2e/server protocol.
 *
 * The socket always uses a same-origin URL (`/ws`) by default. In development
 * Vite proxies that path to the backend (see vite.config.js); in production the
 * Node server serves both the client build and the WebSocket endpoint on the
 * same port.
 *
 * Server messages come in two shapes:
 *  - envelope: `{ type, payload, requestId }` (session / compendium messages)
 *  - combat:   `{ type, state, logEntries, ... }` (room:* messages)
 * Both are normalised so listeners receive the message body directly.
 */
export class NetworkClient {
  constructor(options = {}) {
    this.url = options.url || NetworkClient.defaultUrl();
    this.sessionId = options.sessionId || NetworkClient.defaultSessionId();
    this.name = options.name || null;
    this.autoReconnect = options.autoReconnect !== false;
    this.reconnectDelay = options.reconnectDelay || 2000;

    /** @type {WebSocket|null} */
    this.socket = null;
    this.connected = false;
    this.role = options.role || "player";
    this.playerId = options.playerId || null;

    this._listeners = new Map();
    this._pending = new Map();
    this._requestCounter = 0;
    this._shouldReconnect = true;
  }

  static defaultSessionId() {
    if (typeof window === "undefined") {
      return "default";
    }
    return new URLSearchParams(window.location.search).get("session") || "default";
  }

  static defaultUrl() {
    if (typeof window === "undefined" || !window.location || !window.location.host) {
      return "ws://localhost:3000/ws";
    }

    // Escape hatch for advanced setups: ?server=ws://192.168.1.20:3000/ws
    const override = new URLSearchParams(window.location.search).get("server");
    if (override) {
      return override;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return protocol + "//" + window.location.host + "/ws";
  }

  /**
   * Open the WebSocket (idempotent) and join the session as `role`.
   *
   * @param {"gm"|"player"} role
   * @param {string} [playerId] stable member id, useful for reconnect + token control
   * @returns {WebSocket}
   */
  connect(role = "player", playerId) {
    this.role = role === "gm" ? "gm" : "player";
    if (playerId) {
      this.playerId = playerId;
    }

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return this.socket;
    }

    this._shouldReconnect = true;
    this.socket = new WebSocket(this.url);

    this.socket.addEventListener("open", () => {
      this.connected = true;
      this.emit("open", { url: this.url });

      const name =
        this.name || (this.role === "gm" ? "Game Master" : "Player");
      this.join({
        sessionId: this.sessionId,
        memberId: this.playerId,
        name,
        role: this.role,
      }).catch((error) => {
        this.emit("error", { message: error.message });
      });
    });

    this.socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        this.emit("error", { error: error, raw: event.data });
        return;
      }

      // Room messages carry their fields at the top level, envelopes do not.
      let body = message.payload;
      if (body === undefined || body === null) {
        body = {};
        for (const key of Object.keys(message)) {
          if (key === "type" || key === "payload" || key === "requestId") {
            continue;
          }
          body[key] = message[key];
        }
      }

      if (message.requestId && this._pending.has(message.requestId)) {
        const pending = this._pending.get(message.requestId);
        this._pending.delete(message.requestId);
        if (message.type === "error") {
          pending.reject(
            new Error(
              message.payload && message.payload.message
                ? message.payload.message
                : "Server error",
            ),
          );
        } else {
          pending.resolve(body);
        }
      }

      this.emit(message.type, body);
    });

    this.socket.addEventListener("close", (event) => {
      this.connected = false;
      this.emit("close", { code: event.code, reason: event.reason });
      if (this.autoReconnect && this._shouldReconnect) {
        setTimeout(() => this.connect(this.role, this.playerId), this.reconnectDelay);
      }
    });

    this.socket.addEventListener("error", (event) => {
      this.emit("socket-error", event);
    });

    return this.socket;
  }

  /** Send an action intent to the server (Step 2 action pipeline). */
  sendIntent(action, payload = {}) {
    return this.send(
      "room:action",
      { intent: { action, payload } },
      { expectReply: false },
    );
  }

  /** Subscribe to authoritative combat state broadcasts. */
  onStateUpdate(callback) {
    return this.on("room:state-update", callback);
  }

  /** Subscribe to per-client action rejections (permission / turn errors). */
  onActionError(callback) {
    return this.on("room:action-error", callback);
  }

  /**
   * Subscribe to the room roster (Step 4.3). The callback always receives the
   * array of user profiles, regardless of whether the server sent a bare array
   * or a `{ sessionId, users }` payload.
   */
  onUsersUpdate(callback) {
    return this.on("room:users-update", (payload) => {
      if (Array.isArray(payload)) {
        callback(payload);
        return;
      }
      callback(payload && Array.isArray(payload.users) ? payload.users : []);
    });
  }

  /**
   * Chat (Step 4.4). Messages are sent to the room and the server broadcasts a
   * viewer-filtered `room:chat-update` to every connected client.
   */
  sendChatMessage(data = {}) {
    return this.send(
      "room:chat-message",
      {
        text: typeof data.text === "string" ? data.text : "",
        image: data.image || null,
        visibility: data.visibility || "public",
      },
      { expectReply: false },
    );
  }

  deleteChatMessage(id) {
    return this.send("room:chat-delete", { id: id }, { expectReply: false });
  }

  clearChat() {
    return this.send("room:chat-clear", {}, { expectReply: false });
  }

  /** Change the visibility of an existing message (author or GM). */
  setChatVisibility(id, visibility) {
    return this.send(
      "room:chat-visibility",
      { id: id, visibility: visibility },
      { expectReply: false },
    );
  }

  /**
   * Upload a PNG/JPEG for the chat. Returns `{ url, filename, size, mimetype }`.
   * The upload endpoint is same-origin, so Vite's `/api` proxy handles dev.
   */
  async uploadChatImage(file) {
    const formData = new FormData();
    formData.append("file", file, file.name || "chat-image.png");

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok) {
      throw new Error(
        (payload && (payload.message || payload.error)) || "Image upload failed.",
      );
    }
    if (!payload || !payload.url) {
      throw new Error("Image upload did not return a URL.");
    }
    return payload;
  }

  /** Subscribe to the viewer-specific chat history. */
  onChatUpdate(callback) {
    return this.on("room:chat-update", (payload) => {
      if (Array.isArray(payload)) {
        callback(payload);
        return;
      }
      callback(payload && Array.isArray(payload.chatLog) ? payload.chatLog : []);
    });
  }

  /**
   * Directory state (Step 4.5). The server broadcasts the complete tree after
   * every create/reorder call, so the UI never needs to merge deltas.
   */
  onDirectoriesUpdate(callback) {
    return this.on("room:directories-update", (payload) => {
      if (payload && payload.directories) {
        callback(payload.directories);
        return;
      }
      callback(payload || null);
    });
  }

  createFolder(kind, data = {}) {
    return this.send(
      "room:create-folder",
      {
        kind,
        name: data.name,
        color: data.color,
        sortMode: data.sortMode,
      },
      { expectReply: false },
    );
  }

  createDirectoryEntry(kind, data = {}) {
    const events = {
      scenes: "room:create-scene",
      actors: "room:create-actor",
      items: "room:create-item",
      journals: "room:create-journal",
    };
    const type = events[kind];
    if (!type) {
      return Promise.reject(new Error("Unknown directory kind: " + kind));
    }
    return this.send(type, data, { expectReply: false });
  }

  addJournalPage(journalId, data = {}) {
    return this.send(
      "room:journal-page-add",
      { journalId, name: data.name, content: data.content },
      { expectReply: false },
    );
  }

  updateJournalPage(journalId, pageId, data = {}) {
    return this.send(
      "room:journal-page-update",
      { journalId, pageId, name: data.name, content: data.content },
      { expectReply: false },
    );
  }

  deleteJournalPage(journalId, pageId) {
    return this.send(
      "room:journal-page-delete",
      { journalId, pageId },
      { expectReply: false },
    );
  }

  reorderJournalPages(journalId, pageIds) {
    return this.send(
      "room:journal-page-reorder",
      { journalId, pageIds },
      { expectReply: false },
    );
  }

  /** Combat Tracker controls (Step 4.5). */
  startEncounter(initiative = {}) {
    return this.send("room:start", { initiative }, { expectReply: false });
  }

  nextTurn(options = {}) {
    return this.send("room:next-turn", options, { expectReply: false });
  }

  previousTurn() {
    return this.send("room:previous-turn", {}, { expectReply: false });
  }

  nextRound() {
    return this.send("room:next-round", {}, { expectReply: false });
  }

  finishEncounter() {
    return this.send("room:finish-encounter", {}, { expectReply: false });
  }

  /** Update the local player's profile; the server broadcasts the roster. */
  updateProfile(profileData = {}) {
    return this.send(
      "room:update-profile",
      {
        name: profileData.name,
        color: profileData.color,
        pronouns: profileData.pronouns,
        characterId: profileData.characterId ?? null,
      },
      { expectReply: false },
    );
  }

  /**
   * Send a message. When `expectReply` is true, returns a promise resolved by
   * the matching response envelope.
   */
  send(type, payload = {}, options = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("NetworkClient is not connected."));
    }

    const requestId = options.requestId || "req-" + ++this._requestCounter;
    const envelope = { type, payload, requestId };

    return new Promise((resolve, reject) => {
      if (options.expectReply !== false) {
        this._pending.set(requestId, { resolve, reject });
      } else {
        resolve(null);
      }
      this.socket.send(JSON.stringify(envelope));
    });
  }

  join(options = {}) {
    return this.send("join", {
      sessionId: options.sessionId || this.sessionId || "default",
      memberId: options.memberId,
      name: options.name || this.name || "Player",
      role: options.role || this.role || "player",
      controlledIds: options.controlledIds || [],
    });
  }

  /** Subscribe to a message type ("open", "close" and "error" also work). */
  on(type, handler) {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set());
    }
    this._listeners.get(type).add(handler);
    return () => this.off(type, handler);
  }

  off(type, handler) {
    const set = this._listeners.get(type);
    if (set) {
      set.delete(handler);
    }
  }

  emit(type, payload) {
    const set = this._listeners.get(type);
    if (set) {
      for (const handler of set) {
        handler(payload);
      }
    }
  }

  close() {
    this._shouldReconnect = false;
    if (this.socket) {
      this.socket.close();
    }
  }
}
