"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const core = require("@pf2e/core");
const roles = require("../auth/roles.js");

const Encounter = core.Encounter;
const Combatant = core.Combatant;
const GridMap = core.Grid.GridMap;
// `State.EventBus` is the event-bus namespace; it also exposes the
// CombatEventBus constructor directly for hosts that want the class.
const EventBusNamespace = core.State.EventBus;
const CombatEventBus =
  EventBusNamespace.CombatEventBus || EventBusNamespace.EventBus || EventBusNamespace;
const Serializer = core.State.Serializer;
const Actions = core.Actions;

const SESSION_STATUS = Object.freeze({
  LOBBY: "lobby",
  RUNNING: "running",
  FINISHED: "finished",
});

// Player-list colours. The GM always gets Foundry's gold accent so the
// facilitator is immediately recognisable in the roster.
const GM_COLOR = "#f2c94c";
const PLAYER_COLORS = [
  "#4caf70",
  "#3b9eff",
  "#e03131",
  "#a855f7",
  "#ff8a3d",
  "#20c4c4",
  "#e05fa8",
  "#8bc34a",
];

function randomPlayerColor() {
  return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
}

const CHAT_VISIBILITIES = Object.freeze(["public", "gm", "blind", "self"]);
const MAX_CHAT_TEXT_LENGTH = 4000;
const MAX_CHAT_IMAGE_LENGTH = 500;

// Character-sheet directories (Step 4.5). These are intentionally in-memory
// stubs for now: the UI can create folders and entries, and every room client
// re-renders from the broadcast snapshot.
const DIRECTORY_KINDS = Object.freeze(["scenes", "actors", "items", "journals"]);
const DIRECTORY_KIND_ALIASES = Object.freeze({
  scene: "scenes",
  scenes: "scenes",
  actor: "actors",
  actors: "actors",
  item: "items",
  items: "items",
  journal: "journals",
  journals: "journals",
});
const MAX_DIRECTORY_NAME_LENGTH = 120;
// Step 4.8: a character sheet may carry a large `system` payload. Cap it so a
// malicious/broken client cannot bloat session.json or the write queue.
const MAX_ACTOR_SYSTEM_BYTES = 256 * 1024;
const DEFAULT_FOLDER_COLOR = "#3a4356";
// Step 4.8: every scene owns a canvas payload. Arrays are capped so a broken
// client cannot exhaust the persistence queue with an unbounded object list.
const MAX_SCENE_OBJECTS = 4000;
// Step 5.3: fog of war is persisted as a Base64 PNG of the accumulated
// RenderTexture. Cap it so a broken client cannot bloat session.json.
const MAX_FOG_DATA_LENGTH = 8 * 1024 * 1024;
const FOG_DATA_URL_PATTERN = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

// Step 4.7: room data survives a server restart. The server passes an explicit
// `dataFile`; direct sessions (tests, embedders) stay purely in memory unless
// they opt in, and the public save/load methods still default to this path.
const DEFAULT_SESSION_FILE = path.join(
  __dirname,
  "..",
  "..",
  "data",
  "session.json",
);
const SESSION_FILE_VERSION = 1;

function normalizeDirectoryKind(kind) {
  if (typeof kind !== "string") {
    return null;
  }
  return DIRECTORY_KIND_ALIASES[kind.trim().toLowerCase()] || null;
}

function normalizeHexColor(value) {
  if (typeof value !== "string") {
    return null;
  }
  const color = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : null;
}

/**
 * Grid coordinates are non-negative integers. The client snaps the drop point
 * to the cell before sending it; the server still clamps hostile/broken input.
 */
function normalizeGridCoordinate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(0, Math.min(1000, Math.trunc(number)));
}

function clonePlainData(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEmptyDirectories() {
  const directories = {};
  for (const kind of DIRECTORY_KINDS) {
    directories[kind] = { folders: [], entries: [] };
  }
  return directories;
}

/** Shape of the canvas payload stored per scene (Step 4.8). */
function createEmptySceneCanvas() {
  return { walls: [], drawings: [], lights: [], tokens: [] };
}

function cloneSceneObjectList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .slice(0, MAX_SCENE_OBJECTS)
    .filter(function (item) {
      return item !== null && typeof item === "object" && !Array.isArray(item);
    })
    .map(clonePlainData);
}

/** Coerce arbitrary client data into the scene-canvas contract. */
function sanitizeSceneCanvas(raw) {
  const source =
    raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    walls: cloneSceneObjectList(source.walls),
    drawings: cloneSceneObjectList(source.drawings),
    lights: cloneSceneObjectList(source.lights),
    tokens: cloneSceneObjectList(source.tokens),
  };
}

/**
 * Step 5.3: validate an encoded fog-of-war texture.
 *
 * The client sends the output of `renderer.extract.base64(fogTexture)`, i.e. a
 * PNG data URL. `null`/empty is a valid "no exploration" value.
 */
function sanitizeFogExploration(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError("Fog exploration must be a PNG data URL string.");
  }
  const dataUrl = value.trim();
  if (dataUrl === "") {
    return null;
  }
  if (!FOG_DATA_URL_PATTERN.test(dataUrl)) {
    throw new TypeError("Fog exploration must be a PNG data URL.");
  }
  if (dataUrl.length > MAX_FOG_DATA_LENGTH) {
    throw new RangeError("Fog exploration payload is too large.");
  }
  return dataUrl;
}

/** Tolerant variant used for data coming from disk. */
function sanitizePersistedFog(value) {
  try {
    return sanitizeFogExploration(value);
  } catch (error) {
    return null;
  }
}

/** Validate and deep-copy a player character sheet payload (Step 4.8). */
function sanitizeActorSystem(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("Actor system must be an object.");
  }
  let serialized;
  try {
    serialized = JSON.stringify(raw);
  } catch (error) {
    throw new TypeError("Actor system must be JSON-serializable.");
  }
  if (typeof serialized !== "string") {
    throw new TypeError("Actor system must be JSON-serializable.");
  }
  if (serialized.length > MAX_ACTOR_SYSTEM_BYTES) {
    throw new RangeError("Actor system payload is too large.");
  }
  return JSON.parse(serialized);
}

/**
 * Step 4.8.1: the actor's embedded item collection (class features,
 * spellcasting entries, ...). Kept as a deep-copied, JSON-serializable array.
 */
function sanitizeActorItems(raw) {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new TypeError("Actor items must be an array.");
  }
  let serialized;
  try {
    serialized = JSON.stringify(raw);
  } catch (error) {
    throw new TypeError("Actor items must be JSON-serializable.");
  }
  if (typeof serialized !== "string") {
    throw new TypeError("Actor items must be JSON-serializable.");
  }
  if (serialized.length > MAX_ACTOR_SYSTEM_BYTES) {
    throw new RangeError("Actor items payload is too large.");
  }
  return JSON.parse(serialized);
}

/** Coerce a persisted directory tree back into the expected shape. */
function mergeDirectories(raw) {  const directories = createEmptyDirectories();
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return directories;
  }
  for (const kind of DIRECTORY_KINDS) {
    const source = raw[kind];
    if (source === null || typeof source !== "object") {
      continue;
    }
    if (Array.isArray(source.folders)) {
      directories[kind].folders = source.folders
        .filter(function (folder) {
          return folder !== null && typeof folder === "object";
        })
        .map(clonePlainData);
    }
    if (Array.isArray(source.entries)) {
      directories[kind].entries = source.entries
        .filter(function (entry) {
          return entry !== null && typeof entry === "object";
        })
        .map(function (entry) {
          const copy = clonePlainData(entry);
          if (kind === "journals" && !Array.isArray(copy.pages)) {
            copy.pages = [];
          }
          return copy;
        });
    }
  }
  return directories;
}

/** Highest numeric suffix in ids such as `chat-12` or `page-3`. */
function maxSequenceFrom(ids, pattern) {
  let max = 0;
  for (const id of ids) {
    const match = pattern.exec(String(id || ""));
    if (match) {
      const value = Number.parseInt(match[1], 10);
      if (Number.isInteger(value) && value > max) {
        max = value;
      }
    }
  }
  return max;
}

const GM_ONLY_ACTIONS = new Set(["roll-initiative"]);

const ACTORLESS_ACTIONS = new Set(["end-turn", "roll-initiative"]);

const TARGET_ACTIONS = new Set([
  "strike",
  "trip",
  "shove",
  "grapple",
]);

const SUPPORTED_ACTIONS = new Set([
  "stride",
  "step",
  "strike",
  "cast-spell",
  "raise-shield",
  "take-cover",
  "trip",
  "shove",
  "grapple",
  "stand",
  "escape",
  "end-turn",
  "roll-initiative",
]);

function asNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function resolveActorId(command, payload) {
  const candidates = [
    payload.combatantId,
    payload.actorId,
    payload.combatant && payload.combatant.id,
    payload.actor && payload.actor.id,
    command.combatantId,
    command.actorId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate !== "") {
      return candidate;
    }
  }
  return null;
}

function resolveCombatantRef(combatants, ref) {
  if (typeof ref === "string" && ref !== "") {
    return combatants.get(ref) || null;
  }
  if (ref !== null && typeof ref === "object") {
    return combatants.get(ref.id) || null;
  }
  return null;
}

function resolveTarget(combatants, payload) {
  return (
    resolveCombatantRef(combatants, payload.targetId) ||
    resolveCombatantRef(combatants, payload.target)
  );
}

function normalizeCell(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const parts = value.split(",");
    if (parts.length === 2) {
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      if (Number.isInteger(x) && Number.isInteger(y)) {
        return { x: x, y: y };
      }
    }
    return null;
  }
  if (typeof value === "object") {
    if (Number.isInteger(value.x) && Number.isInteger(value.y)) {
      return { x: value.x, y: value.y };
    }
  }
  return null;
}

/**
 * Turn live event payloads into JSON-safe log payloads. Core payloads can
 * contain Combatant instances (and their event buses), so cycles and
 * non-serializable values are replaced instead of being sent over the wire.
 */
function sanitizeLogPayload(value, seen, depth) {
  if (value === null || value === undefined) {
    return null;
  }
  const valueType = typeof value;
  if (
    valueType === "number" ||
    valueType === "string" ||
    valueType === "boolean"
  ) {
    return value;
  }
  if (valueType === "function" || valueType === "symbol" || valueType === "bigint") {
    return null;
  }
  if (depth >= 5) {
    return "[MaxDepth]";
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  let result;
  if (Array.isArray(value)) {
    result = value.map(function (entry) {
      return sanitizeLogPayload(entry, seen, depth + 1);
    });
  } else {
    result = {};
    for (const key of Object.keys(value)) {
      if (key === "eventBus" || key === "_bus") {
        continue;
      }
      const child = value[key];
      if (typeof child === "function") {
        continue;
      }
      result[key] = sanitizeLogPayload(child, seen, depth + 1);
    }
  }

  seen.delete(value);
  return result;
}

function payloadLabel(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  return (
    payload.activeName ||
    payload.combatantName ||
    payload.actorName ||
    payload.attackerName ||
    payload.targetName ||
    payload.name ||
    payload.combatantId ||
    payload.actorId ||
    payload.attackerId ||
    payload.targetId ||
    payload.activeId ||
    ""
  );
}

function formatLogMessage(type, payload) {
  const label = payloadLabel(payload);
  switch (type) {
    case "combatant:moved": {
      const distance =
        payload && Number.isFinite(payload.costFeet) ? payload.costFeet : 0;
      return (label || "Combatant") + " moved " + distance + " ft.";
    }
    case "combatant:damaged": {
      const amount =
        payload && Number.isFinite(payload.damageDealt)
          ? payload.damageDealt
          : payload && Number.isFinite(payload.amount)
            ? payload.amount
            : 0;
      return (label || "Combatant") + " took " + amount + " damage.";
    }
    case "condition:added":
      return (
        (label || (payload && payload.combatantId) || "Combatant") +
        " gained " +
        String((payload && (payload.condition || payload.conditionName)) || "a condition") +
        "."
      );
    case "condition:removed":
      return (
        (label || (payload && payload.combatantId) || "Combatant") +
        " lost " +
        String((payload && (payload.condition || payload.conditionName)) || "a condition") +
        "."
      );
    case "turn:changed":
      return payload && payload.activeName
        ? "Turn " +
            String(payload.round === undefined ? "" : payload.round) +
            ": " +
            payload.activeName +
            " acts."
        : "Turn advanced.";
    case "round:started":
      return "Round " + String(payload && payload.round) + " started.";
    case "reaction:triggered":
      return (
        (label || "A combatant") + " triggered a reaction."
      );
    case "hazard:triggered":
      return (label || "A hazard") + " triggered.";
    case "hazard:disabled":
      return (label || "A hazard") + " was disabled.";
    case "room:started":
      return "Encounter started.";
    case "room:finished":
      return "Encounter finished.";
    case "room:token-assigned":
      return (
        String((payload && payload.playerId) || "A player") +
        " was assigned " +
        String((payload && payload.combatantId) || "a combatant") +
        "."
      );
    default:
      return type + (label ? " (" + label + ")" : "");
  }
}

function normalizeChatVisibility(value) {
  return CHAT_VISIBILITIES.indexOf(value) === -1 ? "public" : value;
}

function normalizeChatImage(value) {
  if (typeof value !== "string") {
    return null;
  }
  const image = value.trim();
  if (image === "" || image.length > MAX_CHAT_IMAGE_LENGTH) {
    return null;
  }
  if (image.startsWith("/uploads/")) {
    return image;
  }
  if (/^https?:\/\//i.test(image)) {
    return image;
  }
  return null;
}

/**
 * Parse a Foundry-style inline dice command (`/r 4d6`, `/roll 1d20+3`).
 * The server owns the random source so every client sees the same result.
 */
function parseDiceCommand(text) {
  if (typeof text !== "string") {
    return null;
  }
  const match = text.match(
    /\/r(?:oll)?\s+(\d{1,3})\s*d\s*(\d{1,4})(?:\s*([+-])\s*(\d{1,4}))?/i,
  );
  if (!match) {
    return null;
  }

  const count = Number(match[1]);
  const sides = Number(match[2]);
  if (
    !Number.isInteger(count) ||
    !Number.isInteger(sides) ||
    count < 1 ||
    count > 100 ||
    sides < 2 ||
    sides > 1000
  ) {
    return null;
  }

  const modifier = match[3] ? Number(match[4]) * (match[3] === "-" ? -1 : 1) : 0;
  const rolls = [];
  let sum = 0;
  for (let index = 0; index < count; index += 1) {
    const roll = 1 + Math.floor(Math.random() * sides);
    rolls.push(roll);
    sum += roll;
  }

  return {
    command: match[0],
    formula:
      String(count) +
      "d" +
      String(sides) +
      (modifier === 0 ? "" : (modifier > 0 ? "+" : "") + String(modifier)),
    count: count,
    sides: sides,
    modifier: modifier,
    rolls: rolls,
    total: sum + modifier,
  };
}

function maskChatMessage(message) {
  return Object.assign({}, message, {
    text: "",
    image: null,
    hidden: true,
    dice: message.dice
      ? {
          formula: message.dice.formula,
          count: message.dice.count,
          sides: message.dice.sides,
          modifier: message.dice.modifier,
          rolls: [],
          total: null,
          hidden: true,
        }
      : null,
  });
}

function cloneChatMessage(message) {
  return Object.assign({}, message, {
    author: Object.assign({}, message.author),
    dice: message.dice ? Object.assign({}, message.dice, {
      rolls: message.dice.rolls.slice(),
    }) : null,
  });
}

/**
 * A single room: roster, connected members and the headless Encounter instance
 * from @pf2e/core. Networking stays in index.js; this class only owns state and
 * emits core/room events through the shared event bus.
 */
class EncounterSession {
  constructor(options) {
    const opts = options || {};

    if (typeof opts.id !== "string" || opts.id.trim() === "") {
      throw new TypeError("EncounterSession requires a non-empty string id.");
    }

    this.id = opts.id;
    this.name = typeof opts.name === "string" && opts.name.trim() !== "" ? opts.name : opts.id;
    this.catalogService = opts.catalogService || null;
    this.status = SESSION_STATUS.LOBBY;
    this.createdAt = new Date().toISOString();

    /** @type {Map<string, object>} memberId -> member */
    this.members = new Map();
    /**
     * Connected-client profiles shown in the player list (Step 4.3).
     * Keyed by member id so reconnects and token assignment share one id.
     *
     * @type {Map<string, {id:string,name:string,role:string,color:string,pronouns:string,characterId:string|null}>}
     */
    this.users = new Map();
    /** @type {Map<string, object>} combatantId -> Combatant */
    this.combatants = new Map();

    // GridMap and CombatEventBus are created with the room so every session
    // owns an isolated battlefield and presentation-free event stream.
    this.map =
      opts.map instanceof GridMap
        ? opts.map
        : new GridMap(opts.map || opts.grid || {});

    this.eventBus =
      typeof CombatEventBus.createEventBus === "function"
        ? CombatEventBus.createEventBus()
        : new CombatEventBus();

    /** @type {Array<{id:string,timestamp:string,type:string,payload:*,message:string}>} */
    this.combatLog = [];
    this._logSequence = 0;

    /**
     * Chat history (Step 4.4). Messages are filtered per viewer on the way out,
     * so the raw log can keep secret text and dice results for the GM/author.
     *
     * @type {Array<object>}
     */
    this.chatLog = [];
    this._chatSequence = 0;

    /**
     * In-memory entity directories (Step 4.5). Each kind owns its folders and
     * entries; journal entries additionally own ordered pages.
     *
     * @type {{
     *   scenes: {folders:object[],entries:object[]},
     *   actors: {folders:object[],entries:object[]},
     *   items: {folders:object[],entries:object[]},
     *   journals: {folders:object[],entries:object[]}
     * }}
     */
    this.directories = createEmptyDirectories();
    this._folderSequence = 0;
    this._directoryEntrySequence = 0;
    this._journalPageSequence = 0;

    /**
     * Active-scene manager (Step 4.8). Scene canvas arrays live directly on the
     * scene directory entries (`scenes[id].walls/drawings/lights`), so they are
     * persisted together with the directory tree. The `null` scene id maps to a
     * dedicated empty base scene.
     */
    this.activeSceneId = null;
    this.baseSceneCanvas = createEmptySceneCanvas();
    // Step 5.3: the base scene (activeSceneId === null) owns the same fog
    // texture contract as numbered scenes.
    this.baseSceneFogExploration = null;
    // Step 4.8.5: actor-linked scene tokens get their own id sequence so a
    // reload never reuses an id that is already in session.json.
    this._sceneTokenSequence = 0;

    /**
     * Persistence (Step 4.7). When a data file is configured every directory
     * and chat mutation is queued for a JSON write; `saveToDisk()` and
     * `loadFromDisk()` are always available for explicit snapshots.
     *
     * @type {string|null}
     */
    this.dataFile =
      typeof opts.dataFile === "string" && opts.dataFile.trim() !== ""
        ? path.resolve(opts.dataFile)
        : null;
    this._saveChain = Promise.resolve();

    this._listeners = new Set();

    this._busUnsubscribe = this.eventBus.on(
      "*",
      (payload, eventType) => {
        this._recordEvent(eventType, payload);
        for (const listener of this._listeners) {
          try {
            listener(eventType, payload);
          } catch (error) {
            // A broken presentation listener must not interrupt combat.
          }
        }
      },
    );

    /** @type {object|null} Encounter from @pf2e/core */
    this.encounter = null;

    if (Array.isArray(opts.combatants)) {
      for (const spec of opts.combatants) {
        const combatant = spec instanceof Combatant ? spec : new Combatant(spec);
        this._applyCombatantPresentation(combatant, spec);
        this.combatants.set(combatant.id, combatant);
      }
    }

    // Encounter requires at least one combatant, so a fresh empty lobby keeps
    // a null encounter until the first combatant is registered.
    this._ensureEncounter();
  }

  // ------------------------------------------------------------- membership

  addMember(memberOptions) {
    const member = roles.createMember(memberOptions);
    if (this.members.has(member.id)) {
      throw new RangeError("Member already joined this session: " + member.id + ".");
    }
    this.members.set(member.id, member);
    if (!this.users.has(member.id)) {
      this.users.set(member.id, this._createDefaultUser(member));
    }
    this._emit("room:member-joined", { sessionId: this.id, member: member });
    this._emitUsersUpdate();
    return member;
  }

  removeMember(memberId) {
    const member = this.members.get(memberId);
    if (!member) {
      return false;
    }
    this.members.delete(memberId);
    const hadUser = this.users.delete(memberId);
    this._emit("room:member-left", { sessionId: this.id, member: member });
    if (hadUser) {
      this._emitUsersUpdate();
    }
    return true;
  }

  getMember(memberId) {
    return this.members.get(memberId) || null;
  }

  /** Default display profile for a freshly connected client. */
  _createDefaultUser(member) {
    const isGM = roles.isGM(member);
    return {
      id: member.id,
      name: isGM ? "Ведущий" : "Игрок",
      role: member.role,
      color: isGM ? GM_COLOR : randomPlayerColor(),
      pronouns: "",
      characterId: null,
    };
  }

  /** Public, JSON-safe copy of the connected-client roster. */
  getUsers() {
    return Array.from(this.users.values()).map(function (user) {
      return Object.assign({}, user);
    });
  }

  /**
   * Update the sender's player profile and broadcast the roster change.
   *
   * @param {string} memberId
   * @param {{name?:string,color?:string,pronouns?:string,characterId?:string|null}} profileData
   * @returns {object} updated user profile
   */
  updateProfile(memberId, profileData) {
    const member = this.members.get(memberId);
    if (!member) {
      throw new RangeError("Unknown member: " + String(memberId) + ".");
    }

    let user = this.users.get(memberId);
    if (!user) {
      user = this._createDefaultUser(member);
    }

    const data =
      profileData !== null &&
      typeof profileData === "object" &&
      !Array.isArray(profileData)
        ? profileData
        : {};

    if (typeof data.name === "string") {
      const name = data.name.trim();
      if (name !== "") {
        user.name = name.slice(0, 80);
        member.name = user.name;
      }
    }

    if (typeof data.color === "string") {
      const color = data.color.trim();
      if (color !== "") {
        user.color = color.slice(0, 32);
      }
    }

    if (typeof data.pronouns === "string") {
      user.pronouns = data.pronouns.trim().slice(0, 60);
    }

    if (data.characterId === null || data.characterId === "") {
      user.characterId = null;
    } else if (typeof data.characterId === "string") {
      user.characterId = data.characterId.trim() || null;
    }

    user.role = member.role;
    this.users.set(memberId, user);
    this._emitUsersUpdate();
    return Object.assign({}, user);
  }

  /**
   * Notify room subscribers about a roster change without writing a combat-log
   * entry: profile edits are UI metadata, not encounter events.
   */
  _emitUsersUpdate() {
    const payload = { sessionId: this.id, users: this.getUsers() };
    for (const listener of this._listeners) {
      try {
        listener("room:users-update", payload);
      } catch (error) {
        // A broken broadcast listener must not interrupt the room.
      }
    }
  }

  // ------------------------------------------------------------- persistence

  /**
   * Queue a write of the persisted room data. No-op for purely in-memory
   * sessions (no `dataFile` was configured).
   */
  _scheduleSave() {
    if (!this.dataFile) {
      return;
    }
    const write = () =>
      this.saveToDisk().catch(function (error) {
        console.warn("Failed to persist session data: " + error.message);
      });
    // Serialize writes so two rapid mutations cannot interleave file content.
    this._saveChain = this._saveChain.then(write, write);
  }

  /** Resolve when every queued persistence write has finished. */
  flushPersistence() {
    return this._saveChain;
  }

  /**
   * Write `directories` and `chatLog` to disk as JSON.
   *
   * @param {string} [filePath] defaults to the configured file or
   *   `packages/server/data/session.json`
   * @returns {Promise<string>} absolute path written
   */
  async saveToDisk(filePath) {
    const target = filePath
      ? path.resolve(filePath)
      : this.dataFile || DEFAULT_SESSION_FILE;

    const payload = {
      version: SESSION_FILE_VERSION,
      sessionId: this.id,
      savedAt: new Date().toISOString(),
      directories: this.getDirectories(),
      chatLog: clonePlainData(this.chatLog),
      activeSceneId: this.activeSceneId,
      baseSceneCanvas: clonePlainData(this.baseSceneCanvas),
      baseSceneFogExploration: this.baseSceneFogExploration,
      sequences: {
        folder: this._folderSequence,
        directoryEntry: this._directoryEntrySequence,
        journalPage: this._journalPageSequence,
        chat: this._chatSequence,
        sceneToken: this._sceneTokenSequence,
      },
    };

    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = target + ".tmp";
    await fs.writeFile(temporary, JSON.stringify(payload, null, 2), "utf8");
    await fs.rename(temporary, target);
    return target;
  }

  /**
   * Restore `directories` and `chatLog` from disk.
   *
   * @param {string} [filePath] defaults to the configured file or
   *   `packages/server/data/session.json`
   * @returns {Promise<{ok:boolean,reason?:string,path:string}>}
   */
  async loadFromDisk(filePath) {
    const target = filePath
      ? path.resolve(filePath)
      : this.dataFile || DEFAULT_SESSION_FILE;

    let raw;
    try {
      raw = await fs.readFile(target, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return { ok: false, reason: "file-not-found", path: target };
      }
      throw error;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return { ok: false, reason: "invalid-json", path: target };
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "invalid-format", path: target };
    }

    this.directories = mergeDirectories(parsed.directories);
    this.baseSceneCanvas = sanitizeSceneCanvas(parsed.baseSceneCanvas);
    this.baseSceneFogExploration = sanitizePersistedFog(
      parsed.baseSceneFogExploration,
    );
    const requestedSceneId =
      typeof parsed.activeSceneId === "string" ? parsed.activeSceneId : null;
    this.activeSceneId =
      requestedSceneId &&
      this.directories.scenes.entries.some(function (entry) {
        return entry.id === requestedSceneId;
      })
        ? requestedSceneId
        : null;
    this.chatLog = Array.isArray(parsed.chatLog)
      ? parsed.chatLog
          .filter(function (message) {
            return message !== null && typeof message === "object";
          })
          .map(clonePlainData)
      : [];

    // Recover id counters so newly created entries never collide with loaded
    // ones, even if the file predates the `sequences` block.
    const folderIds = [];
    const entryIds = [];
    const pageIds = [];
    for (const kind of DIRECTORY_KINDS) {
      for (const folder of this.directories[kind].folders) {
        folderIds.push(folder.id);
      }
      for (const entry of this.directories[kind].entries) {
        entryIds.push(entry.id);
        if (Array.isArray(entry.pages)) {
          for (const page of entry.pages) {
            pageIds.push(page.id);
          }
        }
      }
    }
    const sequences =
      parsed.sequences !== null && typeof parsed.sequences === "object"
        ? parsed.sequences
        : {};
    this._folderSequence = Math.max(
      Number.isInteger(sequences.folder) ? sequences.folder : 0,
      maxSequenceFrom(folderIds, /-(\d+)$/),
    );
    this._directoryEntrySequence = Math.max(
      Number.isInteger(sequences.directoryEntry) ? sequences.directoryEntry : 0,
      maxSequenceFrom(entryIds, /-(\d+)$/),
    );
    this._journalPageSequence = Math.max(
      Number.isInteger(sequences.journalPage) ? sequences.journalPage : 0,
      maxSequenceFrom(pageIds, /-(\d+)$/),
    );
    this._chatSequence = Math.max(
      Number.isInteger(sequences.chat) ? sequences.chat : 0,
      maxSequenceFrom(
        this.chatLog.map(function (message) {
          return message.id;
        }),
        /-(\d+)$/,
      ),
    );
    // Recover the scene-token counter from every persisted canvas (scenes and
    // the base scene), so a newly dropped actor token never collides.
    const tokenIds = [];
    for (const token of Array.isArray(this.baseSceneCanvas.tokens)
      ? this.baseSceneCanvas.tokens
      : []) {
      tokenIds.push(token && token.id);
    }
    for (const scene of this.directories.scenes.entries) {
      for (const token of Array.isArray(scene.tokens) ? scene.tokens : []) {
        tokenIds.push(token && token.id);
      }
    }
    this._sceneTokenSequence = Math.max(
      Number.isInteger(sequences.sceneToken) ? sequences.sceneToken : 0,
      maxSequenceFrom(tokenIds, /^token-(\d+)$/),
    );

    return { ok: true, path: target };
  }

  // ----------------------------------------------------------- directories

  /**
   * Deep, JSON-safe copy of every directory tree.
   *
   * Fog textures are stored on scene entries (`scenes[id].fogExploration`) so
   * they persist with the world. They are huge Base64 strings, though, and are
   * only needed by the active scene, which receives them through the dedicated
   * `sceneFogExploration` field. Broadcasts therefore omit them by default.
   *
   * @param {{includeFog?:boolean}} [options]
   */
  getDirectories(options = {}) {
    const includeFog = !(options && options.includeFog === false);
    const copy = clonePlainData(this.directories);
    if (!includeFog) {
      for (const scene of copy.scenes.entries) {
        delete scene.fogExploration;
      }
    }
    return copy;
  }

  /**
   * Notify room subscribers about a directory change. Like profile edits this
   * is UI metadata, so it is not written to the combat log.
   */
  _emitDirectoriesUpdate() {
    const payload = {
      sessionId: this.id,
      directories: this.getDirectories({ includeFog: false }),
    };
    for (const listener of this._listeners) {
      try {
        listener("room:directories-update", payload);
      } catch (error) {
        // A broken broadcast listener must not interrupt the room.
      }
    }
  }

  _requireDirectory(kind) {
    const normalized = normalizeDirectoryKind(kind);
    if (!normalized) {
      throw new Error("Unknown directory kind: " + String(kind) + ".");
    }
    return normalized;
  }

  _resolveFolderId(kind, data) {
    const raw = data && typeof data.folderId === "string" ? data.folderId : null;
    if (!raw) {
      return null;
    }
    const folder = this.directories[kind].folders.find(function (entry) {
      return entry.id === raw;
    });
    return folder ? folder.id : null;
  }

  /**
   * Create a folder inside one directory kind.
   *
   * @param {"scenes"|"actors"|"items"|"journals"} kind
   * @param {{name?:string,color?:string,sortMode?:string}} data
   */
  createFolder(kind, data) {
    const normalized = this._requireDirectory(kind);
    const input =
      data !== null && typeof data === "object" && !Array.isArray(data) ? data : {};
    const name =
      asNonEmptyString(input.name) !== null
        ? asNonEmptyString(input.name).slice(0, MAX_DIRECTORY_NAME_LENGTH)
        : "Новая папка";
    const folder = {
      id: "folder-" + normalized + "-" + (this._folderSequence + 1),
      name: name,
      color: normalizeHexColor(input.color) || DEFAULT_FOLDER_COLOR,
      sortMode: input.sortMode === "manual" ? "manual" : "alpha",
      createdAt: new Date().toISOString(),
    };
    this._folderSequence += 1;
    this.directories[normalized].folders.push(folder);
    this._emitDirectoriesUpdate();
    this._scheduleSave();
    return clonePlainData(folder);
  }

  /**
   * Create a scene / actor / item / journal entry.
   *
   * @param {"scenes"|"actors"|"items"|"journals"} kind
   * @param {object} data
   */
  createDirectoryEntry(kind, data) {
    const normalized = this._requireDirectory(kind);
    const input =
      data !== null && typeof data === "object" && !Array.isArray(data) ? data : {};
    const name =
      asNonEmptyString(input.name) !== null
        ? asNonEmptyString(input.name).slice(0, MAX_DIRECTORY_NAME_LENGTH)
        : "Новая запись";

    this._directoryEntrySequence += 1;
    const entry = {
      id:
        normalized.slice(0, -1) +
        "-" +
        normalized.charAt(0) +
        this._directoryEntrySequence,
      name: name,
      folderId: this._resolveFolderId(normalized, input),
      createdAt: new Date().toISOString(),
    };

    if (normalized === "scenes") {
      entry.img =
        typeof input.img === "string" && input.img.trim() !== ""
          ? input.img.trim()
          : null;
      entry.walls = [];
      entry.drawings = [];
      entry.lights = [];
      entry.tokens = [];
    } else if (normalized === "actors") {
      entry.actorType =
        input.actorType === "npc" || input.type === "npc" ? "npc" : "character";
      entry.level = Number.isFinite(Number(input.level))
        ? Math.trunc(Number(input.level))
        : 1;
      entry.img =
        typeof input.img === "string" && input.img.trim() !== ""
          ? input.img.trim()
          : null;
      // Step 4.8: the sheet reads/writes this payload atomically.
      entry.system =
        input.system !== null &&
        typeof input.system === "object" &&
        !Array.isArray(input.system)
          ? sanitizeActorSystem(input.system)
          : {};
      // Step 4.8.1: embedded class features / spellcasting entries.
      entry.items = sanitizeActorItems(input.items);
    } else if (normalized === "items") {
      entry.itemType =
        asNonEmptyString(input.itemType) !== null
          ? asNonEmptyString(input.itemType).slice(0, 60)
          : "misc";
    } else if (normalized === "journals") {
      entry.pages = [];
    }

    this.directories[normalized].entries.push(entry);
    this._emitDirectoriesUpdate();
    this._scheduleSave();
    return clonePlainData(entry);
  }

  // -------------------------------------------------------- actor sheets (4.8)

  /**
   * Atomically replace a character actor's sheet payload.
   *
   * Permission mirrors the UI: the GM may edit any actor, a player only the
   * actor linked to their profile. An unclaimed actor is editable by anyone so
   * the GM can prepare sheets before handing them out.
   *
   * @param {string} actorId
   * @param {{name?:string,system?:object}} data
   * @param {string} [memberId]
   * @param {"gm"|"player"} [role]
   */
  updateActor(actorId, data, memberId, role) {
    const actor = this.directories.actors.entries.find(function (entry) {
      return entry.id === actorId;
    });
    if (!actor) {
      throw new RangeError("Unknown actor: " + String(actorId) + ".");
    }

    if (role !== "gm") {
      const users = Array.from(this.users.values());
      const claimedBy = users.find(function (user) {
        return user.characterId === actorId;
      });
      if (claimedBy && claimedBy.id !== memberId) {
        throw new Error("Only the owner or the GM can edit this actor.");
      }
    }

    const input =
      data !== null && typeof data === "object" && !Array.isArray(data) ? data : {};

    if (typeof input.name === "string") {
      const name = input.name.trim();
      if (name !== "") {
        actor.name = name.slice(0, MAX_DIRECTORY_NAME_LENGTH);
      }
    }

    if (input.system !== undefined) {
      actor.system = sanitizeActorSystem(input.system);
      const level = actor.system.details && actor.system.details.level;
      if (level && Number.isFinite(Number(level.value))) {
        actor.level = Math.trunc(Number(level.value));
      }
    }

    if (input.items !== undefined) {
      actor.items = sanitizeActorItems(input.items);
    }

    this._emitDirectoriesUpdate();
    // Step 4.8.5: the PixiJS token layer repaints HP bars from this focused
    // event without diffing the whole directory tree. Directories remain the
    // source of truth and carry the same actor payload.
    this._emitActorUpdate({
      sessionId: this.id,
      actorId: actor.id,
      actor: clonePlainData(actor),
    });
    this._scheduleSave();
    return clonePlainData(actor);
  }

  // -------------------------------------------------------- active scene (4.8)

  _findSceneEntry(sceneId) {
    if (typeof sceneId !== "string" || sceneId.trim() === "") {
      return null;
    }
    return (
      this.directories.scenes.entries.find(function (entry) {
        return entry.id === sceneId;
      }) || null
    );
  }

  /**
   * Canvas payload for one scene. `null` addresses the base scene, which is
   * always present even when no scene directory entry is active.
   */
  getSceneCanvas(sceneId) {
    const id =
      typeof sceneId === "string" && sceneId.trim() !== "" ? sceneId : null;
    if (id === null) {
      return Object.assign({ sceneId: null }, sanitizeSceneCanvas(this.baseSceneCanvas));
    }
    const scene = this._findSceneEntry(id);
    if (!scene) {
      return { sceneId: id, walls: [], drawings: [], lights: [], tokens: [] };
    }
    const canvas = sanitizeSceneCanvas(scene);
    return {
      sceneId: id,
      walls: canvas.walls,
      drawings: canvas.drawings,
      lights: canvas.lights,
      tokens: canvas.tokens,
    };
  }

  /**
   * Persisted fog-of-war texture for one scene (`null` = nothing explored).
   * The scene canvas itself stays a compact arrays-only contract; the encoded
   * texture travels next to it in activation/snapshot payloads.
   *
   * @param {string|null} sceneId
   * @returns {string|null}
   */
  getSceneFog(sceneId) {
    const id =
      typeof sceneId === "string" && sceneId.trim() !== "" ? sceneId : null;
    if (id === null) {
      return this.baseSceneFogExploration;
    }
    const scene = this._findSceneEntry(id);
    return scene ? sanitizePersistedFog(scene.fogExploration) : null;
  }

  /**
   * Activate a scene directory entry. Unknown ids fall back to the empty base
   * scene, which keeps a stale client from breaking the room.
   */
  activateScene(sceneId) {
    const id =
      typeof sceneId === "string" && sceneId.trim() !== "" ? sceneId : null;
    this.activeSceneId = id !== null && this._findSceneEntry(id) ? id : null;
    const canvas = this.getSceneCanvas(this.activeSceneId);
    this._emitSceneActivated({
      sessionId: this.id,
      activeSceneId: this.activeSceneId,
      canvas: canvas,
      fogExploration: this.getSceneFog(this.activeSceneId),
    });
    this._scheduleSave();
    return canvas;
  }

  /**
   * Replace the canvas arrays for a scene. The client sends complete arrays,
   * matching the "load this scene" contract on activation.
   */
  updateSceneCanvas(sceneId, canvasData, sourceMemberId) {
    const id =
      typeof sceneId === "string" && sceneId.trim() !== "" ? sceneId : null;
    const canvas = sanitizeSceneCanvas(canvasData);

    if (id === null) {
      this.baseSceneCanvas = canvas;
    } else {
      const scene = this._findSceneEntry(id);
      if (!scene) {
        throw new RangeError("Unknown scene: " + String(sceneId) + ".");
      }
      scene.walls = canvas.walls;
      scene.drawings = canvas.drawings;
      scene.lights = canvas.lights;
      scene.tokens = canvas.tokens;
    }

    this._scheduleSave();
    const payload = {
      sessionId: this.id,
      sceneId: id,
      canvas: this.getSceneCanvas(id),
      sourceMemberId: sourceMemberId || null,
    };
    this._emitSceneCanvasUpdate(payload);
    return payload.canvas;
  }

  /**
   * Step 5.3: persist the accumulated fog-of-war texture for a scene.
   *
   * The texture lives on `scenes[sceneId].fogExploration` (or the base-scene
   * counterpart) and is written to `session.json`. A dedicated broadcast keeps
   * every client's fog in sync without touching the scene-canvas contract.
   *
   * @param {string|null} sceneId
   * @param {string|null} fogExploration PNG data URL or null
   * @param {string} [sourceMemberId]
   * @returns {string|null} stored value
   */
  updateFog(sceneId, fogExploration, sourceMemberId) {
    const id =
      typeof sceneId === "string" && sceneId.trim() !== "" ? sceneId : null;
    const fog = sanitizeFogExploration(fogExploration);

    if (id === null) {
      this.baseSceneFogExploration = fog;
    } else {
      const scene = this._findSceneEntry(id);
      if (!scene) {
        throw new RangeError("Unknown scene: " + String(sceneId) + ".");
      }
      scene.fogExploration = fog;
    }

    this._scheduleSave();
    this._emitFogUpdate({
      sessionId: this.id,
      sceneId: id,
      fogExploration: fog,
      sourceMemberId: sourceMemberId || null,
    });
    return fog;
  }

  /**
   * Step 5.3: wipe one scene's fog texture and broadcast `room:fog-reset`.
   * Every client clears its local `RenderTexture`; no exploration survives.
   *
   * @param {string|null} sceneId
   * @param {string} [sourceMemberId]
   * @returns {null}
   */
  resetFog(sceneId, sourceMemberId) {
    const id =
      typeof sceneId === "string" && sceneId.trim() !== "" ? sceneId : null;
    if (id === null) {
      this.baseSceneFogExploration = null;
    } else {
      const scene = this._findSceneEntry(id);
      if (!scene) {
        throw new RangeError("Unknown scene: " + String(sceneId) + ".");
      }
      scene.fogExploration = null;
    }

    this._scheduleSave();
    this._emitFogReset({
      sessionId: this.id,
      sceneId: id,
      sourceMemberId: sourceMemberId || null,
    });
    return null;
  }

  /**
   * Step 4.8.5: create an actor-linked token on a scene canvas.
   *
   * The token references a directory actor (`actorId`) and a grid cell. It is
   * stored inside `scenes[sceneId].tokens` (or the base scene) together with
   * the wall/drawing/light arrays, so it persists in `session.json`.
   *
   * @param {{actorId?:string,sceneId?:string|null,x?:number,y?:number}} data
   * @param {string} [sourceMemberId]
   * @returns {object} the created token
   */
  createToken(data, sourceMemberId) {
    const input =
      data !== null && typeof data === "object" && !Array.isArray(data) ? data : {};
    const actorId = asNonEmptyString(input.actorId);
    if (actorId === null) {
      throw new TypeError("A token requires an actorId.");
    }

    const actor = this.directories.actors.entries.find(function (entry) {
      return entry.id === actorId;
    });
    if (!actor) {
      throw new RangeError("Unknown actor: " + actorId + ".");
    }

    // Empty/omitted scene ids target the always-present base scene.
    const sceneId =
      typeof input.sceneId === "string" && input.sceneId.trim() !== ""
        ? input.sceneId.trim()
        : null;
    if (sceneId !== null && !this._findSceneEntry(sceneId)) {
      throw new RangeError("Unknown scene: " + sceneId + ".");
    }

    this._sceneTokenSequence += 1;
    const actorImg =
      typeof actor.img === "string" && actor.img.trim() !== "" ? actor.img : null;
    const token = {
      id: "token-" + this._sceneTokenSequence,
      actorId: actor.id,
      sceneId: sceneId,
      name: actor.name,
      img: actorImg,
      gridX: normalizeGridCoordinate(input.x),
      gridY: normalizeGridCoordinate(input.y),
    };

    if (sceneId === null) {
      this.baseSceneCanvas.tokens.push(token);
    } else {
      const scene = this._findSceneEntry(sceneId);
      if (!Array.isArray(scene.tokens)) {
        scene.tokens = [];
      }
      scene.tokens.push(token);
    }

    this._scheduleSave();
    this._emitSceneCanvasUpdate({
      sessionId: this.id,
      sceneId: sceneId,
      canvas: this.getSceneCanvas(sceneId),
      sourceMemberId: null,
      reason: "token-created",
      createdBy: sourceMemberId || null,
      token: clonePlainData(token),
    });
    return clonePlainData(token);
  }

  /**
   * Scene broadcasts are UI metadata, not combat events: notify room listeners
   * directly so they never pollute the combat log.
   */
  _emitSceneActivated(payload) {
    for (const listener of this._listeners) {
      try {
        listener("room:scene-activated", payload);
      } catch (error) {
        // A broken broadcast listener must not interrupt the room.
      }
    }
  }

  _emitSceneCanvasUpdate(payload) {
    for (const listener of this._listeners) {
      try {
        listener("room:scene-canvas-update", payload);
      } catch (error) {
        // A broken broadcast listener must not interrupt the room.
      }
    }
  }

  _emitFogUpdate(payload) {
    for (const listener of this._listeners) {
      try {
        listener("room:fog-update", payload);
      } catch (error) {
        // A broken broadcast listener must not interrupt the room.
      }
    }
  }

  _emitFogReset(payload) {
    for (const listener of this._listeners) {
      try {
        listener("room:fog-reset", payload);
      } catch (error) {
        // A broken broadcast listener must not interrupt the room.
      }
    }
  }

  /**
   * Focused actor-sheet update (Step 4.8.5). Sent alongside the directory
   * broadcast so the canvas token layer can repaint HP bars immediately.
   */
  _emitActorUpdate(payload) {
    for (const listener of this._listeners) {
      try {
        listener("room:update-actor", payload);
      } catch (error) {
        // A broken broadcast listener must not interrupt the room.
      }
    }
  }

  /** Find a journal entry or throw a descriptive error. */
  _requireJournal(journalId) {
    const journal = this.directories.journals.entries.find(function (entry) {
      return entry.id === journalId;
    });
    if (!journal) {
      throw new RangeError("Unknown journal: " + String(journalId) + ".");
    }
    if (!Array.isArray(journal.pages)) {
      journal.pages = [];
    }
    return journal;
  }

  addJournalPage(journalId, data) {
    const journal = this._requireJournal(journalId);
    const input =
      data !== null && typeof data === "object" && !Array.isArray(data) ? data : {};
    this._journalPageSequence += 1;
    const page = {
      id: "page-" + this._journalPageSequence,
      name:
        asNonEmptyString(input.name) !== null
          ? asNonEmptyString(input.name).slice(0, MAX_DIRECTORY_NAME_LENGTH)
          : "Новая страница",
      content: typeof input.content === "string" ? input.content : "",
      createdAt: new Date().toISOString(),
    };
    journal.pages.push(page);
    this._emitDirectoriesUpdate();
    this._scheduleSave();
    return clonePlainData(page);
  }

  updateJournalPage(journalId, pageId, data) {
    const journal = this._requireJournal(journalId);
    const page = journal.pages.find(function (entry) {
      return entry.id === pageId;
    });
    if (!page) {
      throw new RangeError("Unknown journal page: " + String(pageId) + ".");
    }
    const input =
      data !== null && typeof data === "object" && !Array.isArray(data) ? data : {};
    if (typeof input.name === "string" && input.name.trim() !== "") {
      page.name = input.name.trim().slice(0, MAX_DIRECTORY_NAME_LENGTH);
    }
    if (typeof input.content === "string") {
      page.content = input.content;
    }
    this._emitDirectoriesUpdate();
    this._scheduleSave();
    return clonePlainData(page);
  }

  deleteJournalPage(journalId, pageId) {
    const journal = this._requireJournal(journalId);
    const index = journal.pages.findIndex(function (entry) {
      return entry.id === pageId;
    });
    if (index === -1) {
      return { ok: false, reason: "page-not-found" };
    }
    const removed = journal.pages.splice(index, 1)[0];
    this._emitDirectoriesUpdate();
    this._scheduleSave();
    return { ok: true, page: clonePlainData(removed) };
  }

  reorderJournalPages(journalId, pageIds) {
    const journal = this._requireJournal(journalId);
    const byId = new Map();
    for (const page of journal.pages) {
      byId.set(page.id, page);
    }
    const ordered = [];
    for (const id of Array.isArray(pageIds) ? pageIds : []) {
      const page = byId.get(id);
      if (page) {
        ordered.push(page);
        byId.delete(id);
      }
    }
    // Keep pages the client did not mention instead of silently dropping them.
    for (const page of byId.values()) {
      ordered.push(page);
    }
    journal.pages = ordered;
    this._emitDirectoriesUpdate();
    this._scheduleSave();
    return clonePlainData(journal.pages);
  }

  // ------------------------------------------------------------------ chat

  /**
   * Resolve the display identity for a chat message. A user bound to a
   * combatant speaks with the character's name and portrait; otherwise the
   * player profile name/colour is used.
   */
  _resolveChatAuthor(memberId) {
    const member = this.members.get(memberId) || null;
    const user =
      this.users.get(memberId) ||
      (member ? this._createDefaultUser(member) : null);

    const author = {
      id: memberId,
      name: user ? user.name : "Игрок",
      color: user ? user.color : "#4caf70",
      role: member ? member.role : user ? user.role : "player",
      characterId: user ? user.characterId : null,
      characterName: null,
      avatar: null,
    };

    if (user && user.characterId) {
      // Step 4.8: profiles can now point at a directory character sheet.
      const actorEntry = this.directories.actors.entries.find(function (entry) {
        return entry.id === user.characterId;
      });
      if (actorEntry) {
        author.name = actorEntry.name;
        author.characterName = actorEntry.name;
        author.avatar = actorEntry.img || null;
      } else {
        const combatant = this.combatants.get(user.characterId);
        if (combatant) {
          author.name = combatant.name;
          author.characterName = combatant.name;
          author.avatar =
            combatant.img ||
            combatant.avatar ||
            (combatant.data && (combatant.data.img || combatant.data.avatar)) ||
            null;
        }
      }
    }

    return author;
  }

  /**
   * Append a chat message and resolve an optional inline `/r NdX` command.
   *
   * @param {string} memberId sender
   * @param {{text?:string,image?:string|null,visibility?:string}} data
   * @returns {object} stored message
   */
  addChatMessage(memberId, data) {
    if (!this.members.has(memberId)) {
      throw new RangeError("Unknown member: " + String(memberId) + ".");
    }

    const input =
      data !== null && typeof data === "object" && !Array.isArray(data) ? data : {};
    let text = typeof input.text === "string" ? input.text : "";
    if (text.length > MAX_CHAT_TEXT_LENGTH) {
      text = text.slice(0, MAX_CHAT_TEXT_LENGTH);
    }

    const dice = parseDiceCommand(text);
    if (dice) {
      text = text.replace(dice.command, "").trim();
    }

    const message = {
      id: "chat-" + (this._chatSequence + 1),
      timestamp: new Date().toISOString(),
      author: this._resolveChatAuthor(memberId),
      text: text.trim(),
      image: normalizeChatImage(input.image),
      visibility: normalizeChatVisibility(input.visibility),
      dice: dice,
    };

    this._chatSequence += 1;
    this.chatLog.push(message);
    this._scheduleSave();
    return cloneChatMessage(message);
  }

  /**
   * Delete one message. The author or the GM may remove it.
   *
   * @returns {{ok:boolean,reason?:string,message?:object}}
   */
  deleteChatMessage(memberId, messageId) {
    const index = this.chatLog.findIndex(function (message) {
      return message.id === messageId;
    });
    if (index === -1) {
      return { ok: false, reason: "message-not-found" };
    }

    const member = this.members.get(memberId);
    const message = this.chatLog[index];
    if (!member) {
      return { ok: false, reason: "permission-denied" };
    }
    if (!roles.isGM(member) && message.author.id !== memberId) {
      return { ok: false, reason: "permission-denied" };
    }

    this.chatLog.splice(index, 1);
    this._scheduleSave();
    return { ok: true, message: cloneChatMessage(message) };
  }

  /** Remove every chat message. Permission is enforced by the network layer. */
  clearChat() {
    const removed = this.chatLog.length;
    this.chatLog.length = 0;
    if (removed > 0) {
      this._scheduleSave();
    }
    return removed;
  }

  /** Change visibility of an existing message (author or GM only). */
  setChatVisibility(memberId, messageId, visibility) {
    const message = this.chatLog.find(function (entry) {
      return entry.id === messageId;
    });
    if (!message) {
      return { ok: false, reason: "message-not-found" };
    }
    const member = this.members.get(memberId);
    if (!member || (!roles.isGM(member) && message.author.id !== memberId)) {
      return { ok: false, reason: "permission-denied" };
    }
    message.visibility = normalizeChatVisibility(visibility);
    this._scheduleSave();
    return { ok: true, message: cloneChatMessage(message) };
  }

  /**
   * Chat history as seen by one viewer. `blind` hides results from everyone
   * except the GM and the author; `self` is visible to the author only;
   * `gm` messages are omitted entirely for players.
   *
   * @param {object|string|null} viewer member object or role string
   * @returns {Array<object>}
   */
  getChatLogFor(viewer) {
    const viewerMember =
      viewer !== null && typeof viewer === "object" ? viewer : null;
    const viewerId = viewerMember ? viewerMember.id : null;
    const viewerRole =
      viewerMember && viewerMember.role
        ? viewerMember.role
        : typeof viewer === "string"
          ? viewer
          : "player";
    const isGM = viewerRole === roles.ROLES.GM;

    const result = [];
    for (const message of this.chatLog) {
      if (message.visibility === "gm") {
        if (isGM) {
          result.push(cloneChatMessage(message));
        }
        continue;
      }

      if (message.visibility === "blind") {
        if (isGM || message.author.id === viewerId) {
          result.push(cloneChatMessage(message));
        } else {
          result.push(maskChatMessage(message));
        }
        continue;
      }

      if (message.visibility === "self") {
        if (message.author.id === viewerId) {
          result.push(cloneChatMessage(message));
        } else {
          result.push(maskChatMessage(message));
        }
        continue;
      }

      result.push(cloneChatMessage(message));
    }

    return result;
  }

  /**
   * Grant a player control over a combatant. GM-only at the network layer.
   *
   * @param {string} playerId
   * @param {string} combatantId
   * @returns {{playerId:string,combatantId:string,controlledIds:string[]}}
   */
  assignToken(playerId, combatantId) {
    const member = this.members.get(playerId);
    if (!member) {
      throw new RangeError("Unknown member: " + String(playerId) + ".");
    }
    if (typeof combatantId !== "string" || combatantId.trim() === "") {
      throw new TypeError("assignToken requires a non-empty combatantId.");
    }
    if (!this.combatants.has(combatantId)) {
      throw new RangeError("Unknown combatant: " + combatantId + ".");
    }
    if (member.controlledIds.indexOf(combatantId) === -1) {
      member.controlledIds.push(combatantId);
    }
    const assignment = {
      playerId: playerId,
      combatantId: combatantId,
      controlledIds: member.controlledIds.slice(),
    };
    this._emit("room:token-assigned", Object.assign({ sessionId: this.id }, assignment));
    return assignment;
  }

  // ------------------------------------------------------------- combatants

  /**
   * The headless core intentionally has no presentation data. The room copies
   * optional portrait/token fields from authored combatant specs so the chat
   * can show a character avatar when the user is bound to that combatant.
   */
  _applyCombatantPresentation(combatant, spec) {
    if (!combatant || !spec || typeof spec !== "object") {
      return;
    }
    // Step 4.8: tokens belong to the scene that was active when they were added.
    if (typeof spec.sceneId === "string" && spec.sceneId.trim() !== "") {
      combatant.sceneId = spec.sceneId.trim();
    } else if (combatant.sceneId === undefined) {
      combatant.sceneId = this.activeSceneId;
    }
    if (!combatant.img && typeof spec.img === "string" && spec.img.trim() !== "") {
      combatant.img = spec.img.trim();
    }
    if (
      !combatant.avatar &&
      typeof spec.avatar === "string" &&
      spec.avatar.trim() !== ""
    ) {
      combatant.avatar = spec.avatar.trim();
    }
    // Step 4.8.5: keep the directory actor binding on the combatant so the
    // canvas can match an actor token to its combat tracker entry.
    if (
      typeof spec.actorId === "string" &&
      spec.actorId.trim() !== "" &&
      combatant.actorId === undefined
    ) {
      combatant.actorId = spec.actorId.trim();
    }
  }

  addCombatant(spec) {
    if (this.status === SESSION_STATUS.RUNNING) {
      throw new Error("Combatants cannot be added after the encounter has started.");
    }
    const combatant = spec instanceof Combatant ? spec : new Combatant(spec);
    this._applyCombatantPresentation(combatant, spec);
    if (this.combatants.has(combatant.id)) {
      throw new RangeError("Duplicate combatant id: " + combatant.id + ".");
    }
    this.combatants.set(combatant.id, combatant);
    this._ensureEncounter();
    this._emit("room:combatant-added", { sessionId: this.id, combatantId: combatant.id });
    return combatant;
  }

  removeCombatant(combatantId) {
    if (this.status === SESSION_STATUS.RUNNING) {
      throw new Error("Combatants cannot be removed while the encounter is running.");
    }
    const removed = this.combatants.delete(combatantId);
    if (removed) {
      this._ensureEncounter();
    }
    return removed;
  }

  getCombatant(combatantId) {
    return this.combatants.get(combatantId) || null;
  }

  // -------------------------------------------------------------- lifecycle

  start(initiativeOptions) {
    if (this.combatants.size === 0) {
      throw new Error("Cannot start an encounter without combatants.");
    }
    if (this.status === SESSION_STATUS.RUNNING) {
      throw new Error("The encounter is already running.");
    }

    const encounter = this._ensureEncounter();
    const active = encounter.rollInitiative(initiativeOptions || {});
    this.status = SESSION_STATUS.RUNNING;
    this.startedAt = new Date().toISOString();
    this._emit("room:started", { sessionId: this.id, order: this.getOrder() });
    return active;
  }

  nextTurn(options) {
    this._requireEncounter();
    const result = this.encounter.nextTurn(options || {});
    if (this.encounter.over) {
      this.status = SESSION_STATUS.FINISHED;
      this._emit("room:finished", { sessionId: this.id });
    }
    return result;
  }

  /**
   * Step one combatant backwards. The core only exposes `nextTurn`, so the
   * room adjusts the active index directly for the Combat Tracker's "previous"
   * control and re-emits the normal turn event.
   */
  previousTurn() {
    const encounter = this._requireEncounter();
    const roster = encounter.combatants || [];
    if (!encounter.started || roster.length === 0) {
      return { active: null, round: encounter.round, index: -1 };
    }

    let index = encounter.activeCombatantIndex - 1;
    if (index < 0) {
      index = roster.length - 1;
      encounter.round = Math.max(1, encounter.round - 1);
    }
    encounter.activeCombatantIndex = index;
    encounter.over = false;
    if (typeof encounter._syncRound === "function") {
      encounter._syncRound();
    }
    const active = encounter.activeCombatant;
    if (active && typeof active.resetTurn === "function") {
      active.resetTurn({ tickConditions: false, round: encounter.round });
    }
    this.status = SESSION_STATUS.RUNNING;
    this._syncEncounterRound(encounter);
    encounter._emit("turn:changed", {
      active: active,
      activeId: active ? active.id : null,
      previousId: null,
      round: encounter.round,
      index: index,
      turnIndex: index,
      order: encounter.getOrder(),
      kind: "previous",
    });
    return { active: active, round: encounter.round, index: index };
  }

  /** Advance until the round counter changes (or the encounter ends). */
  nextRound() {
    const encounter = this._requireEncounter();
    if (!encounter.started) {
      return { round: encounter.round, advanced: false };
    }
    const startRound = encounter.round;
    const rosterLength = Math.max(1, (encounter.combatants || []).length);
    let guard = 0;
    while (
      encounter.round === startRound &&
      !encounter.over &&
      guard < rosterLength + 1
    ) {
      encounter.nextTurn();
      guard += 1;
    }
    if (encounter.over) {
      this.status = SESSION_STATUS.FINISHED;
      this._emit("room:finished", { sessionId: this.id });
    }
    return { round: encounter.round, advanced: encounter.round !== startRound };
  }

  /** End the encounter without deleting the combatants. */
  finishEncounter() {
    const encounter = this.encounter;
    if (!encounter) {
      return { ok: false, reason: "encounter-not-started" };
    }
    encounter.over = true;
    encounter.started = true;
    encounter.activeCombatantIndex = -1;
    this.status = SESSION_STATUS.FINISHED;
    this._emit("room:finished", { sessionId: this.id });
    return { ok: true };
  }

  /** Mirror the encounter clock onto combatants after a manual index change. */
  _syncEncounterRound(encounter) {
    for (const combatant of encounter.combatants || []) {
      if (combatant && typeof combatant === "object") {
        combatant.encounterRound = encounter.round;
      }
    }
  }

  getOrder() {
    if (!this.encounter) {
      return Array.from(this.combatants.keys());
    }
    return this.encounter.combatants.map(function (combatant) {
      return combatant.id;
    });
  }

  _ensureEncounter() {
    const roster = Array.from(this.combatants.values());
    if (roster.length === 0) {
      this.encounter = null;
      return null;
    }

    if (this.encounter) {
      const known = new Set(
        this.encounter.combatants.map(function (combatant) {
          return combatant.id;
        }),
      );
      const sameRoster =
        known.size === roster.length &&
        roster.every(function (combatant) {
          return known.has(combatant.id);
        });
      if (sameRoster) {
        return this.encounter;
      }
      // The core does not support adding combatants to a running encounter,
      // and the room API forbids it before we ever get here.
      if (this.encounter.started) {
        return this.encounter;
      }
    }

    this.encounter = new Encounter({
      combatants: roster,
      eventBus: this.eventBus,
    });
    return this.encounter;
  }

  _requireEncounter() {
    if (!this.encounter) {
      throw new Error("The encounter has not been started yet.");
    }
    return this.encounter;
  }

  // ----------------------------------------------------------- action pipeline

  /**
   * Validate and execute one action intent on behalf of a connected client.
   *
   * @param {string} clientRole "gm" | "player"
   * @param {string} clientId member id
   * @param {{action:string,payload?:object}} intent
   * @returns {object}
   */
  dispatchAction(clientRole, clientId, intent) {
    const member = this.members.get(clientId) || {
      id: clientId,
      role: clientRole,
      controlledIds: [],
    };
    const role = clientRole || member.role;
    const command = intent !== null && typeof intent === "object" ? intent : {};
    const action = asNonEmptyString(command.action);
    if (action === null) {
      return { ok: false, reason: "invalid-intent", message: "Missing action." };
    }
    if (!SUPPORTED_ACTIONS.has(action)) {
      return {
        ok: false,
        reason: "unknown-action",
        message: "Unknown action: " + action,
      };
    }

    const payload =
      command.payload !== null &&
      typeof command.payload === "object" &&
      !Array.isArray(command.payload)
        ? command.payload
        : {};
    const encounter = this.encounter;
    if (!encounter) {
      return {
        ok: false,
        reason: "encounter-not-started",
        message: "The encounter has not been started yet.",
      };
    }

    const activeId = encounter.activeCombatant ? encounter.activeCombatant.id : null;
    const isGM = roles.isGM(member) || role === roles.ROLES.GM;

    if (GM_ONLY_ACTIONS.has(action) && !isGM) {
      return {
        ok: false,
        reason: "permission-denied",
        message: "Only the GM can perform this action.",
      };
    }

    let actorId = resolveActorId(command, payload);
    if (actorId === null && action === "end-turn") {
      actorId = activeId;
    }
    if (actorId === null && !isGM && member.controlledIds.length === 1) {
      actorId = member.controlledIds[0];
    }

    if (!isGM) {
      if (actorId === null) {
        return {
          ok: false,
          reason: "permission-denied",
          message: "A player must specify a combatant they control.",
        };
      }
      if (!roles.canControlCombatant(member, actorId)) {
        return {
          ok: false,
          reason: "permission-denied",
          message: "Players may only command their assigned combatant.",
        };
      }
      if (!encounter.started || activeId !== actorId) {
        return {
          ok: false,
          reason: "not-your-turn",
          message: "It is not this combatant's turn.",
        };
      }
    }

    let actor = null;
    if (actorId !== null) {
      actor = this.combatants.get(actorId) || null;
      if (!actor) {
        return {
          ok: false,
          reason: "combatant-not-found",
          message: "Unknown combatant: " + actorId,
        };
      }
    }
    if (!ACTORLESS_ACTIONS.has(action) && !actor) {
      return {
        ok: false,
        reason: "invalid-intent",
        message: "Action requires combatantId.",
      };
    }

    const target = resolveTarget(this.combatants, payload);
    if (TARGET_ACTIONS.has(action) && !target) {
      return {
        ok: false,
        reason: "invalid-target",
        message: "Action requires a valid targetId.",
      };
    }

    const logStart = this.combatLog.length;
    let result;
    try {
      result = this._performAction(action, {
        actor: actor,
        target: target,
        payload: payload,
        encounter: encounter,
      });
    } catch (error) {
      return {
        ok: false,
        reason: "invalid-action",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (result !== null && typeof result === "object" && result.ok === false) {
      return {
        ok: false,
        reason: result.reason || "action-rejected",
        message: result.reason || "action-rejected",
      };
    }

    if (action === "roll-initiative") {
      if (this.status !== SESSION_STATUS.RUNNING) {
        this.status = SESSION_STATUS.RUNNING;
        this.startedAt = new Date().toISOString();
      }
    } else if (this.status === SESSION_STATUS.LOBBY && encounter.started) {
      // `end-turn` auto-starts a prepared encounter in the core; mirror that
      // in the room lifecycle.
      this.status = SESSION_STATUS.RUNNING;
      this.startedAt = this.startedAt || new Date().toISOString();
    }

    return {
      ok: true,
      action: action,
      result: result,
      state: this.serializeState(),
      logEntries: this.combatLog.slice(logStart),
    };
  }

  _performAction(action, context) {
    const actor = context.actor;
    const target = context.target;
    const payload = context.payload;
    const encounter = context.encounter;
    const roster = encounter.getOrder();

    const options = Object.assign({}, payload.options || {}, payload);
    delete options.options;
    options.map = this.map;
    options.combatants = roster;
    options.allies = roster;

    switch (action) {
      case "stride":
        return Actions.Stride.performStride(
          Object.assign(options, {
            combatant: actor,
            destination: normalizeCell(payload.destination || payload.target),
          }),
        );
      case "step":
        return Actions.Step.performStep(
          Object.assign(options, {
            combatant: actor,
            destination: normalizeCell(payload.destination || payload.target),
          }),
        );
      case "strike":
        return Actions.Strike.performStrike(
          Object.assign(options, { attacker: actor, target: target }),
        );
      case "cast-spell":
        return Actions.CastSpell.performCastSpell(
          Object.assign(options, {
            caster: actor,
            target: target,
            spell: payload.spell,
          }),
        );
      case "raise-shield":
        return Actions.RaiseShield.performRaiseShield({ combatant: actor });
      case "take-cover":
        return Actions.TakeCover.performTakeCover(
          Object.assign(options, {
            combatant: actor,
            attacker: resolveCombatantRef(
              this.combatants,
              payload.attackerId || payload.attacker,
            ),
          }),
        );
      case "trip":
        return Actions.Trip.performTrip(
          Object.assign(options, { attacker: actor, target: target }),
        );
      case "shove":
        return Actions.Shove.performShove(
          Object.assign(options, { attacker: actor, target: target }),
        );
      case "grapple":
        return Actions.Grapple.performGrapple(
          Object.assign(options, { attacker: actor, target: target }),
        );
      case "stand":
        return Actions.Stand.performStand(
          Object.assign(options, { combatant: actor }),
        );
      case "escape":
        return Actions.Escape.performEscape(
          Object.assign(options, {
            actor: actor,
            source:
              resolveCombatantRef(
                this.combatants,
                payload.sourceId || payload.source,
              ) ||
              (payload.source && typeof payload.source === "object"
                ? payload.source
                : options.source),
          }),
        );
      case "end-turn": {
        const nextOptions = Object.assign({}, payload.options || {}, payload);
        delete nextOptions.combatantId;
        delete nextOptions.actorId;
        return this.nextTurn(nextOptions);
      }
      case "roll-initiative": {
        const initiativeOptions = Object.assign({}, payload.options || {}, payload);
        const active = encounter.rollInitiative(initiativeOptions);
        this.startedAt = this.startedAt || new Date().toISOString();
        return active;
      }
      default:
        throw new Error("Unknown action: " + String(action));
    }
  }

  // --------------------------------------------------------------- snapshots

  /** Full serializable combat state (map, encounter clock, combatants, hazards). */
  serializeState() {
    const encounter = this.encounter;
    if (!encounter) {
      return {
        version: Serializer.SERIALIZATION_VERSION,
        status: this.status,
        activeSceneId: this.activeSceneId,
        encounter: null,
        map: Serializer.serializeMap(this.map),
        combatants: [],
        hazards: [],
      };
    }
    const state = Serializer.serializeCombatState({
      encounter: encounter,
      map: this.map,
      combatants: encounter.getOrder(),
    });
    state.status = this.status;
    // The headless serializer does not know about presentation-scoped scenes,
    // so re-attach the room-level scene binding for the client token filter.
    state.activeSceneId = this.activeSceneId;
    state.combatants = state.combatants.map((combatant) => {
      const source = this.combatants.get(combatant.id);
      return Object.assign({}, combatant, {
        sceneId: source && source.sceneId !== undefined ? source.sceneId : null,
        actorId:
          source && source.actorId !== undefined ? source.actorId : null,
      });
    });
    return state;
  }

  // ------------------------------------------------------------- broadcasts

  /** Register a broadcast listener. Returns an unsubscribe function. */
  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("subscribe() expects a function.");
    }
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _recordEvent(eventType, payload) {
    let safePayload = null;
    try {
      safePayload = sanitizeLogPayload(payload, new Set(), 0);
    } catch (error) {
      safePayload = null;
    }
    const entry = {
      id: "log-" + (this._logSequence + 1),
      timestamp: new Date().toISOString(),
      type: eventType,
      payload: safePayload,
      message: formatLogMessage(eventType, payload),
    };
    this._logSequence += 1;
    this.combatLog.push(entry);
    return entry;
  }

  _emit(type, payload) {
    if (this.eventBus && typeof this.eventBus.emit === "function") {
      this.eventBus.emit(type, payload);
      return;
    }
    for (const listener of this._listeners) {
      try {
        listener(type, payload);
      } catch (error) {
        // Keep the remaining listeners alive when there is no event bus.
      }
    }
  }

  /** Public room state, safe to send to every connected member. */
  snapshot() {
    return {
      id: this.id,
      name: this.name,
      status: this.status,
      createdAt: this.createdAt,
      round: this.encounter ? this.encounter.round : 0,
      activeCombatantId: this.encounter && this.encounter.activeCombatant
        ? this.encounter.activeCombatant.id
        : null,
      combatants: Array.from(this.combatants.values()).map(function (combatant) {
        return {
          id: combatant.id,
          name: combatant.name,
          alliance: combatant.alliance,
          initiative: combatant.initiative,
          x: combatant.x,
          y: combatant.y,
          currentHP: combatant.currentHP,
          maxHP: combatant.maxHP,
          defeated: Boolean(combatant.isDefeated),
          sceneId: combatant.sceneId === undefined ? null : combatant.sceneId,
          actorId:
            combatant.actorId === undefined ? null : combatant.actorId,
        };
      }),
      members: Array.from(this.members.values()).map(function (member) {
        return { id: member.id, name: member.name, role: member.role };
      }),
      users: this.getUsers(),
      directories: this.getDirectories({ includeFog: false }),
      activeSceneId: this.activeSceneId,
      sceneCanvas: this.getSceneCanvas(this.activeSceneId),
      // Step 5.3: encoded fog texture of the active scene.
      sceneFogExploration: this.getSceneFog(this.activeSceneId),
    };
  }
}

module.exports = {
  EncounterSession,
  SESSION_STATUS,
};
