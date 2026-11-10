"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const { WebSocketServer, WebSocket } = require("ws");
const { formidable } = require("formidable");

const { CatalogService } = require("./compendium/catalog-service.js");
const { EncounterSession } = require("./room/encounter-session.js");
const roles = require("./auth/roles.js");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

// Production mode serves the compiled Vite client from one origin (and one
// port) so the GM can hand players a single http://IP:PORT address.
const CLIENT_DIST_DIR =
  process.env.CLIENT_DIST || path.join(__dirname, "..", "..", "client", "dist");

// Chat image uploads (Step 4.4). Files live outside the compendium data and are
// served back through the read-only /uploads/ route.
const UPLOADS_DIR =
  process.env.UPLOADS_DIR || path.join(__dirname, "..", "data", "uploads");
try {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch (error) {
  console.error("Failed to create uploads directory:", error.message);
}

// Step 4.7: directories and chat history are persisted to this file. Tests and
// embedders that `require` this module stay in memory; `npm run start:server`
// (the main module) enables persistence, and PF2E_PERSIST=1 forces it on.
const SESSION_FILE =
  process.env.SESSION_FILE || path.join(__dirname, "..", "data", "session.json");
const PERSISTENCE_ENABLED =
  process.env.PF2E_PERSIST === "1" ||
  (process.env.PF2E_PERSIST !== "0" && require.main === module);

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const UPLOAD_EXTENSIONS = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

const catalogService = new CatalogService({
  directory: process.env.COMPENDIUM_DIR || path.join(__dirname, "..", "data", "compendiums"),
});

/** @type {Map<string, EncounterSession>} */
const sessions = new Map();

function getSession(sessionId) {
  const id = typeof sessionId === "string" && sessionId.trim() !== "" ? sessionId : "default";
  let session = sessions.get(id);
  if (!session) {
    session = new EncounterSession({
      id: id,
      catalogService: catalogService,
      dataFile: PERSISTENCE_ENABLED ? SESSION_FILE : null,
    });
    sessions.set(id, session);
  }
  return session;
}

function sendJson(res, statusCode, body, extraHeaders) {
  const payload = JSON.stringify(body);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "X-Category, X-Total-Count, X-Filtered-Count",
  };
  if (extraHeaders) {
    Object.assign(headers, extraHeaders);
  }
  res.writeHead(statusCode, headers);
  res.end(payload);
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

function parseIndexFilters(searchParams) {
  const filters = {};

  const name = searchParams.get("name") || searchParams.get("search") || searchParams.get("q");
  if (name) {
    filters.name = name;
  }

  const level = searchParams.get("level");
  if (level !== null) {
    filters.level = level;
  }
  const minLevel = searchParams.get("minLevel");
  if (minLevel !== null) {
    filters.minLevel = minLevel;
  }
  const maxLevel = searchParams.get("maxLevel");
  if (maxLevel !== null) {
    filters.maxLevel = maxLevel;
  }

  const traits = [];
  for (const value of searchParams.getAll("traits")) {
    traits.push(value);
  }
  for (const value of searchParams.getAll("trait")) {
    traits.push(value);
  }
  if (traits.length > 0) {
    filters.traits = traits;
  }

  const traitMode = searchParams.get("traitMode") || searchParams.get("match");
  if (traitMode) {
    filters.traitMode = traitMode;
  }

  const type = searchParams.get("type");
  if (type) {
    filters.type = type;
  }

  const ancestry = searchParams.get("ancestry");
  if (ancestry) {
    filters.ancestry = ancestry;
  }
  const includeVersatile = searchParams.get("includeVersatile");
  if (includeVersatile !== null) {
    filters.includeVersatile = includeVersatile;
  }
  const versatile = searchParams.get("versatile");
  if (versatile !== null) {
    filters.versatile = versatile;
  }

  const limit = searchParams.get("limit");
  if (limit !== null) {
    filters.limit = limit;
  }
  const offset = searchParams.get("offset");
  if (offset !== null) {
    filters.offset = offset;
  }

  return filters;
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sendStaticFile(req, res, filePath) {
  return new Promise(function (resolve) {
    fs.stat(filePath, function (error, stats) {
      if (error || !stats.isFile()) {
        resolve(false);
        return;
      }

      const extension = path.extname(filePath).toLowerCase();
      const isHtml = extension === ".html";
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
        "Content-Length": stats.size,
        "Cache-Control": isHtml ? "no-cache" : "public, max-age=31536000, immutable",
      });

      if (req.method === "HEAD") {
        res.end();
        resolve(true);
        return;
      }

      const stream = fs.createReadStream(filePath);
      stream.on("error", function () {
        res.destroy();
        resolve(true);
      });
      stream.pipe(res);
      resolve(true);
    });
  });
}

/**
 * Store a chat image and return its public URL.
 *
 * Formidable writes to a temporary file inside `data/uploads`; we then rename
 * it to a collision-free, extension-checked name. Only PNG/JPEG are accepted.
 */
function handleUpload(req, res) {
  const form = formidable({
    uploadDir: UPLOADS_DIR,
    keepExtensions: true,
    maxFileSize: MAX_UPLOAD_BYTES,
    maxFiles: 1,
    filter: function (part) {
      return Boolean(part && UPLOAD_EXTENSIONS[part.mimetype]);
    },
  });

  form.parse(req, function (error, fields, files) {
    if (error) {
      sendJson(res, error.httpCode === 413 ? 413 : 400, {
        error: "upload-failed",
        message: error.message,
      });
      return;
    }

    let file = files.file || files.image || files.upload;
    if (!file) {
      const keys = Object.keys(files || {});
      if (keys.length > 0) {
        file = files[keys[0]];
      }
    }
    if (Array.isArray(file)) {
      file = file[0];
    }
    if (!file || !file.filepath) {
      sendJson(res, 400, {
        error: "upload-failed",
        message: "No image file was provided (expected field name 'file').",
      });
      return;
    }

    const extension =
      UPLOAD_EXTENSIONS[file.mimetype] ||
      (path.extname(file.originalFilename || "").toLowerCase() === ".png"
        ? ".png"
        : ".jpg");
    const filename =
      "chat-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 10) +
      extension;
    const destination = path.join(UPLOADS_DIR, filename);

    try {
      fs.renameSync(file.filepath, destination);
    } catch (renameError) {
      sendJson(res, 500, {
        error: "upload-failed",
        message: renameError.message,
      });
      return;
    }

    sendJson(res, 200, {
      url: "/uploads/" + filename,
      filename: filename,
      size: file.size,
      mimetype: file.mimetype,
    });
  });
}

/** Serve a file from `data/uploads` for `/uploads/<filename>` URLs. */
async function serveUpload(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "method-not-allowed", path: url.pathname });
    return;
  }

  const root = path.resolve(UPLOADS_DIR);
  const relativePath = decodePathSegment(
    url.pathname.slice("/uploads/".length),
  ).replace(/^\/+/, "");
  const candidate = path.resolve(root, relativePath);

  if (!isPathInside(root, candidate)) {
    sendJson(res, 403, { error: "forbidden", path: url.pathname });
    return;
  }

  if (!(await sendStaticFile(req, res, candidate))) {
    sendJson(res, 404, { error: "not-found", path: url.pathname });
  }
}

/**
 * Serve the compiled Vite client (index.html + hashed assets) for any request
 * that is not part of the API or the WebSocket endpoint. Unknown extension-less
 * routes fall back to index.html so client-side routing works.
 */
async function serveClientApp(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 404, { error: "not-found", path: url.pathname });
    return;
  }

  const distRoot = path.resolve(CLIENT_DIST_DIR);
  const relativePath = decodePathSegment(url.pathname).replace(/^\/+/, "");
  const candidate =
    relativePath === ""
      ? path.join(distRoot, "index.html")
      : path.resolve(distRoot, relativePath);

  if (!isPathInside(distRoot, candidate)) {
    sendJson(res, 403, { error: "forbidden", path: url.pathname });
    return;
  }

  if (await sendStaticFile(req, res, candidate)) {
    return;
  }

  // SPA fallback for navigation routes, but keep missing assets as real 404s.
  if (path.extname(relativePath) === "") {
    if (await sendStaticFile(req, res, path.join(distRoot, "index.html"))) {
      return;
    }
  }

  sendJson(res, 404, {
    error: "not-found",
    path: url.pathname,
    hint: "Client build not found. Run `npm run build --workspace=@pf2e/client`.",
  });
}

function handleRequest(req, res) {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/upload") {
    handleUpload(req, res);
    return;
  }

  if (url.pathname.startsWith("/uploads/")) {
    serveUpload(req, res, url).catch(function (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, 500, {
        error: "upload-serving-failed",
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "@pf2e/server",
      sessions: sessions.size,
      uptimeSeconds: Math.round(process.uptime()),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/sessions") {
    sendJson(res, 200, {
      sessions: Array.from(sessions.values()).map(function (session) {
        return session.snapshot();
      }),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/compendiums") {
    const categories = catalogService.listCategories();
    sendJson(res, 200, {
      categories: categories,
      catalogs: catalogService.listCatalogs(),
    });
    return;
  }

  const itemMatch = url.pathname.match(/^\/api\/compendiums\/([^/]+)\/([^/]+)$/);
  if (req.method === "GET" && itemMatch) {
    const categoryId = decodePathSegment(itemMatch[1]);
    const itemId = decodePathSegment(itemMatch[2]);

    if (!catalogService.hasCategory(categoryId)) {
      sendJson(res, 404, { error: "category-not-found", category: categoryId });
      return;
    }

    const item = catalogService.getItem(categoryId, itemId);
    if (!item) {
      sendJson(res, 404, {
        error: "item-not-found",
        category: categoryId,
        id: itemId,
      });
      return;
    }

    sendJson(res, 200, item);
    return;
  }

  const categoryMatch = url.pathname.match(/^\/api\/compendiums\/([^/]+)$/);
  if (req.method === "GET" && categoryMatch) {
    const categoryId = decodePathSegment(categoryMatch[1]);
    const catalog = catalogService.getCategory(categoryId);

    if (!catalog) {
      sendJson(res, 404, { error: "category-not-found", category: categoryId });
      return;
    }

    const filters = parseIndexFilters(url.searchParams);
    const entries = catalogService.getIndex(categoryId, filters);

    sendJson(res, 200, entries, {
      "X-Category": catalog.id,
      "X-Total-Count": String(catalog.entries.length),
      "X-Filtered-Count": String(entries.length),
    });
    return;
  }

  // API and WebSocket paths never fall through to the static client build.
  if (
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/ws" ||
    url.pathname.startsWith("/ws/")
  ) {
    sendJson(res, 404, { error: "not-found", path: url.pathname });
    return;
  }

  serveClientApp(req, res, url).catch(function (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendJson(res, 500, {
      error: "static-serving-failed",
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

const server = http.createServer(handleRequest);
const wss = new WebSocketServer({ server, path: "/ws" });

/** @type {Map<object, {session: EncounterSession, member: object|null, unsubscribe: Function|null}>} */
const clients = new Map();

function send(ws, type, payload, requestId) {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify({ type: type, payload: payload, requestId: requestId || null }));
}

/** Send a message whose domain fields live at the top level (combat protocol). */
function sendRaw(ws, message) {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify(message));
}

function broadcast(session, type, payload) {
  for (const [ws, state] of clients) {
    if (state.session === session) {
      send(ws, type, payload);
    }
  }
}

function broadcastMessage(session, message) {
  for (const [ws, state] of clients) {
    if (state.session === session) {
      sendRaw(ws, message);
    }
  }
}

/** Send the viewer-specific chat log to one socket. */
function sendChatUpdate(ws, session, member) {
  sendRaw(ws, {
    type: "room:chat-update",
    chatLog: session.getChatLogFor(member),
  });
}

/**
 * Chat visibility is per viewer (`gm`, `blind`, `self`), so unlike combat
 * broadcasts every socket receives its own filtered history.
 */
function broadcastChatUpdate(session) {
  for (const [ws, state] of clients) {
    if (state.session === session && state.member) {
      sendChatUpdate(ws, session, state.member);
    }
  }
}

function sendActionError(ws, reason, intent, message, requestId) {
  const response = {
    type: "room:action-error",
    reason: reason,
    intent: intent,
    requestId: requestId || null,
  };
  if (message) {
    response.message = message;
  }
  sendRaw(ws, response);
}

function broadcastStateUpdate(session, result) {
  broadcastMessage(session, {
    type: "room:state-update",
    state: result.state,
    logEntries: result.logEntries || [],
  });
}

function attachSession(ws, session) {
  const state = clients.get(ws);
  if (!state) {
    return;
  }
  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }
  state.session = session;
  state.unsubscribe = session.subscribe(function (eventType, payload) {
    broadcast(session, eventType, payload);
    broadcast(session, "session:snapshot", session.snapshot());
  });
}

function requireMember(ws) {
  const state = clients.get(ws);
  if (!state || !state.member) {
    throw new Error("Join the session first.");
  }
  return state;
}

wss.on("connection", function (ws) {
  clients.set(ws, { session: getSession("default"), member: null, unsubscribe: null });

  send(ws, "session:snapshot", clients.get(ws).session.snapshot());

  ws.on("message", function (raw) {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch (error) {
      send(ws, "error", { message: "Invalid JSON." });
      return;
    }

    const state = clients.get(ws);
    const type = message && message.type;
    const payload = (message && message.payload) || {};
    const requestId = message && message.requestId;

    try {
      if (type === "join") {
        const session = getSession(payload.sessionId);
        // Subscribe before adding the member so the joining client also gets
        // the initial room:users-update broadcast.
        attachSession(ws, session);
        const memberId =
          payload.memberId || "member-" + Math.random().toString(36).slice(2, 8);
        // A page reload reconnects with the same stable id. Drop the stale
        // roster entry (if any) so reconnecting never fails with a duplicate.
        if (session.getMember(memberId)) {
          session.removeMember(memberId);
        }
        const member = session.addMember({
          id: memberId,
          name: payload.name,
          role: payload.role,
          controlledIds: payload.controlledIds,
        });
        state.member = member;
        send(ws, "joined", { member: member, session: session.snapshot() }, requestId);
        // Chat is filtered per viewer, so send the initial history only to the
        // joining socket instead of relying on the shared snapshot broadcast.
        sendChatUpdate(ws, session, member);
        broadcast(session, "session:snapshot", session.snapshot());
        return;
      }

      if (type === "leave") {
        if (state.member) {
          state.session.removeMember(state.member.id);
          broadcast(state.session, "session:snapshot", state.session.snapshot());
        }
        state.member = null;
        send(ws, "left", {}, requestId);
        return;
      }

      const active = requireMember(ws);
      const session = active.session;
      const member = active.member;

      if (type === "request:snapshot") {
        send(ws, "session:snapshot", session.snapshot(), requestId);
        sendChatUpdate(ws, session, member);
        return;
      }

      if (type === "room:update-profile") {
        const user = session.updateProfile(member.id, payload);
        sendRaw(ws, {
          type: "room:profile-updated",
          user: user,
          requestId: requestId || null,
        });
        return;
      }

      if (type === "room:chat-message") {
        session.addChatMessage(member.id, {
          text: payload.text,
          image: payload.image,
          visibility: payload.visibility,
        });
        broadcastChatUpdate(session);
        return;
      }

      if (type === "room:chat-delete") {
        const result = session.deleteChatMessage(member.id, payload.id);
        if (!result.ok) {
          send(
            ws,
            "error",
            { message: "Cannot delete chat message: " + result.reason + "." },
            requestId,
          );
          return;
        }
        broadcastChatUpdate(session);
        return;
      }

      if (type === "room:chat-visibility") {
        const result = session.setChatVisibility(
          member.id,
          payload.id,
          payload.visibility,
        );
        if (!result.ok) {
          send(
            ws,
            "error",
            { message: "Cannot change chat visibility: " + result.reason + "." },
            requestId,
          );
          return;
        }
        broadcastChatUpdate(session);
        return;
      }

      if (type === "room:chat-clear") {
        if (!roles.canManageEncounter(member)) {
          throw new Error("Only the GM can clear the chat.");
        }
        session.clearChat();
        broadcastChatUpdate(session);
        return;
      }

      // ------------------------------------------------------- directories
      // Step 4.5: folder/entity creation is broadcast to the whole room. These
      // handlers are intentionally permissive (all members) because directory
      // management is a shared world-building surface in this stub.
      if (type === "room:create-folder") {
        session.createFolder(payload.kind, payload);
        return;
      }

      if (type === "room:create-scene") {
        session.createDirectoryEntry("scenes", payload);
        return;
      }

      // Step 4.8: active-scene manager. Activation broadcasts the scene id and
      // its canvas arrays; canvas updates replace the complete arrays for the
      // scene so every client renders the same walls/drawings/lights.
      if (type === "room:activate-scene") {
        session.activateScene(payload.sceneId);
        return;
      }

      if (type === "room:scene-canvas-update") {
        session.updateSceneCanvas(
          payload.sceneId,
          payload.canvas || {},
          member.id,
        );
        return;
      }

      // Step 5.3: fog-of-war persistence. The client debounces the accumulated
      // RenderTexture to a Base64 PNG and both events are broadcast to the
      // whole room, so exploration and resets stay in sync.
      if (type === "room:update-fog") {
        session.updateFog(
          payload.sceneId,
          payload.fogExploration,
          member.id,
        );
        return;
      }

      if (type === "room:reset-fog") {
        session.resetFog(payload.sceneId, member.id);
        return;
      }

      if (type === "room:create-actor") {
        session.createDirectoryEntry("actors", payload);
        return;
      }

      // Step 4.8.5: an actor card dropped on the canvas becomes a scene token
      // bound to that actor. The server stores it in `scenes[id].tokens` and
      // rebroadcasts the scene canvas so every client renders it immediately.
      if (type === "room:create-token") {
        const token = session.createToken(
          {
            actorId: payload.actorId,
            sceneId: payload.sceneId,
            x: payload.x,
            y: payload.y,
          },
          member.id,
        );
        sendRaw(ws, {
          type: "room:token-created",
          token: token,
          requestId: requestId || null,
        });
        return;
      }

      if (type === "room:update-actor") {
        session.updateActor(
          payload.actorId,
          { name: payload.name, system: payload.system, items: payload.items },
          member.id,
          member.role,
        );
        return;
      }

      if (type === "room:create-item") {
        session.createDirectoryEntry("items", payload);
        return;
      }

      if (type === "room:create-journal") {
        session.createDirectoryEntry("journals", payload);
        return;
      }

      if (type === "room:journal-page-add") {
        session.addJournalPage(payload.journalId, payload);
        return;
      }

      if (type === "room:journal-page-update") {
        session.updateJournalPage(payload.journalId, payload.pageId, payload);
        return;
      }

      if (type === "room:journal-page-delete") {
        const result = session.deleteJournalPage(payload.journalId, payload.pageId);
        if (!result.ok) {
          send(ws, "error", { message: "Cannot delete page: " + result.reason + "." }, requestId);
        }
        return;
      }

      if (type === "room:journal-page-reorder") {
        session.reorderJournalPages(payload.journalId, payload.pageIds);
        return;
      }

      if (type === "room:add-combatant") {
        if (!roles.canManageEncounter(member)) {
          throw new Error("Only the GM can add combatants.");
        }
        const combatant = session.addCombatant(payload.combatant || payload);
        send(ws, "room:combatant-added", { combatantId: combatant.id }, requestId);
        return;
      }

      if (type === "room:remove-combatant") {
        if (!roles.canManageEncounter(member)) {
          throw new Error("Only the GM can remove combatants.");
        }
        session.removeCombatant(payload.combatantId);
        return;
      }

      if (type === "room:start") {
        if (!roles.canManageEncounter(member)) {
          throw new Error("Only the GM can start the encounter.");
        }
        session.start(payload.initiative || {});
        broadcastStateUpdate(session, {
          state: session.serializeState(),
          logEntries: session.combatLog.slice(),
        });
        return;
      }

      if (type === "room:next-turn") {
        if (!roles.canManageEncounter(member)) {
          throw new Error("Only the GM can advance the turn.");
        }
        session.nextTurn(payload);
        broadcastStateUpdate(session, {
          state: session.serializeState(),
          logEntries: session.combatLog.slice(),
        });
        return;
      }

      if (type === "room:previous-turn") {
        if (!roles.canManageEncounter(member)) {
          throw new Error("Only the GM can rewind the turn.");
        }
        session.previousTurn();
        broadcastStateUpdate(session, {
          state: session.serializeState(),
          logEntries: session.combatLog.slice(),
        });
        return;
      }

      if (type === "room:next-round") {
        if (!roles.canManageEncounter(member)) {
          throw new Error("Only the GM can advance the round.");
        }
        session.nextRound();
        broadcastStateUpdate(session, {
          state: session.serializeState(),
          logEntries: session.combatLog.slice(),
        });
        return;
      }

      if (type === "room:finish-encounter") {
        if (!roles.canManageEncounter(member)) {
          throw new Error("Only the GM can finish the encounter.");
        }
        session.finishEncounter();
        broadcastStateUpdate(session, {
          state: session.serializeState(),
          logEntries: session.combatLog.slice(),
        });
        return;
      }

      if (type === "room:action") {
        const intent = message.intent || payload.intent || payload;
        const result = session.dispatchAction(member.role, member.id, intent);
        if (!result.ok) {
          sendActionError(ws, result.reason, intent, result.message, requestId);
          return;
        }
        broadcastStateUpdate(session, result);
        return;
      }

      if (type === "room:assign-token") {
        if (!roles.canManageEncounter(member)) {
          throw new Error("Only the GM can assign tokens.");
        }
        const assignment = session.assignToken(payload.playerId, payload.combatantId);
        sendRaw(ws, {
          type: "room:token-assigned",
          assignment: assignment,
          requestId: requestId || null,
        });
        broadcastStateUpdate(session, {
          state: session.serializeState(),
          logEntries: [],
        });
        return;
      }

      if (type === "room:sync") {
        sendRaw(ws, {
          type: "room:state-update",
          state: session.serializeState(),
          logEntries: session.combatLog.slice(),
          requestId: requestId || null,
        });
        return;
      }

      if (type === "compendium:list") {
        send(
          ws,
          "compendium:list",
          {
            categories: catalogService.listCategories(),
            catalogs: catalogService.listCatalogs(),
          },
          requestId,
        );
        return;
      }

      if (type === "compendium:get") {
        const categoryId = payload.categoryId || payload.catalogId;
        if (!catalogService.hasCategory(categoryId)) {
          throw new Error("Unknown compendium category: " + String(categoryId));
        }

        const itemId = payload.itemId || payload.id;
        if (itemId) {
          const item = catalogService.getItem(categoryId, itemId);
          send(ws, "compendium:get", { categoryId: categoryId, item: item }, requestId);
          return;
        }

        const entries = catalogService.getIndex(categoryId, payload.filters || {});
        send(
          ws,
          "compendium:get",
          { categoryId: categoryId, count: entries.length, entries: entries },
          requestId,
        );
        return;
      }

      send(ws, "error", { message: "Unknown message type: " + String(type) }, requestId);
    } catch (error) {
      send(ws, "error", { message: error.message }, requestId);
    }
  });

  ws.on("close", function () {
    const state = clients.get(ws);
    if (state) {
      if (state.unsubscribe) {
        state.unsubscribe();
      }
      if (state.member) {
        // Only remove the roster entry if it still belongs to this socket. A
        // fast reconnect can replace the member object under the same id.
        if (state.session.getMember(state.member.id) === state.member) {
          state.session.removeMember(state.member.id);
          broadcast(state.session, "session:snapshot", state.session.snapshot());
        }
      }
      clients.delete(ws);
    }
  });
});

function startServer(port, host) {
  return loadPersistedSession()
    .catch(function (error) {
      console.warn("Failed to load persisted session: " + error.message);
    })
    .then(function () {
      return new Promise(function (resolve, reject) {
        if (server.listening) {
          resolve(server);
          return;
        }
        function onError(error) {
          server.removeListener("listening", onListening);
          reject(error);
        }
        function onListening() {
          server.removeListener("error", onError);
          resolve(server);
        }
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(
          port === undefined ? PORT : port,
          host === undefined ? HOST : host,
        );
      });
    });
}

/** Restore directories/chat from `data/session.json` before accepting clients. */
function loadPersistedSession() {
  if (!PERSISTENCE_ENABLED) {
    return Promise.resolve(null);
  }
  return getSession("default").loadFromDisk();
}

function closeServer() {
  return Promise.all(
    Array.from(sessions.values()).map(function (session) {
      return session.flushPersistence();
    }),
  ).then(function () {
    return new Promise(function (resolve) {
      for (const ws of clients.keys()) {
        try {
          ws.close();
        } catch (error) {
          // The socket may already be closed.
        }
      }
      wss.close(function () {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(function () {
          resolve();
        });
      });
    });
  });
}

if (require.main === module) {
  startServer().then(function () {
    console.log("@pf2e/server listening on http://" + HOST + ":" + PORT);
    console.log("WebSocket endpoint: ws://" + HOST + ":" + PORT + "/ws");
    if (fs.existsSync(path.join(CLIENT_DIST_DIR, "index.html"))) {
      console.log("Serving client build from " + CLIENT_DIST_DIR);
    } else {
      console.log(
        "Client build not found at " +
          CLIENT_DIST_DIR +
          " (run `npm run build --workspace=@pf2e/client` for production mode).",
      );
    }
  });

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function shutdown() {
  closeServer().then(function () {
    process.exit(0);
  });
}

module.exports = {
  server,
  wss,
  sessions,
  catalogService,
  clientDistDir: CLIENT_DIST_DIR,
  sessionFile: SESSION_FILE,
  persistenceEnabled: PERSISTENCE_ENABLED,
  getSession,
  startServer,
  closeServer,
};
