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
const Initiative = core.Initiative;
const PrepareData = core.Actor.PrepareData;

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
// Step 6.3: scene configuration defaults. `gridSize` is the pixel size of one
// 5-ft cell; `backgroundColor` fills the renderer outside the map image.
const DEFAULT_SCENE_GRID_SIZE = 100;
const MIN_SCENE_GRID_SIZE = 20;
const MAX_SCENE_GRID_SIZE = 400;
const DEFAULT_SCENE_BACKGROUND = "#12151c";
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
// Step 5.4: reserved key that keeps a pre-5.4 flat scene texture available as
// a fallback while the world migrates to per-actor exploration.
const FOG_SCENE_FALLBACK_KEY = "__scene__";

// Phase 6.1: Foundry-compatible ownership matrix. Every actor stores
// `ownership = { default: 0, [userId]: 3 }`; the GM always resolves to 3.
const OWNERSHIP_LEVELS = Object.freeze({
  NONE: 0,
  LIMITED: 1,
  OBSERVER: 2,
  OWNER: 3,
});

function normalizeOwnershipLevel(value) {
  const level = Number(value);
  if (!Number.isInteger(level) || level < OWNERSHIP_LEVELS.NONE) {
    return OWNERSHIP_LEVELS.NONE;
  }
  return level > OWNERSHIP_LEVELS.OWNER ? OWNERSHIP_LEVELS.OWNER : level;
}

function normalizeOwnership(raw) {
  const source =
    raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const result = { default: normalizeOwnershipLevel(source.default) };
  for (const [key, value] of Object.entries(source)) {
    if (key === "default" || key === "") {
      continue;
    }
    result[key] = normalizeOwnershipLevel(value);
  }
  return result;
}

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

/** Step 6.3: one scene cell is 20..400 px; the Foundry default is 100. */
function normalizeSceneGridSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) {
    return DEFAULT_SCENE_GRID_SIZE;
  }
  return Math.max(
    MIN_SCENE_GRID_SIZE,
    Math.min(MAX_SCENE_GRID_SIZE, Math.round(size)),
  );
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
    return sanitizeFogCollection(value);
  } catch (error) {
    return null;
  }
}

/**
 * Step 5.4: a scene stores exploration per actor:
 * `scenes[id].fogExploration = { [actorId]: dataUrl }`. Older sessions stored
 * one flat PNG string; both shapes are accepted here and by the client.
 */
function sanitizeFogCollection(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "string") {
    return sanitizeFogExploration(value);
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Fog exploration must be a PNG or an actor map.");
  }
  const result = {};
  for (const [actorId, dataUrl] of Object.entries(value)) {
    if (typeof actorId !== "string" || actorId === "") {
      continue;
    }
    const fog = sanitizeFogExploration(dataUrl);
    if (fog !== null) {
      result[actorId] = fog;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
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
          if (kind === "actors") {
            copy.ownership = normalizeOwnership(copy.ownership);
          }
          if (kind === "scenes") {
            // Step 6.3: pre-6.3 scenes get the Foundry defaults on load.
            copy.gridSize = normalizeSceneGridSize(copy.gridSize);
            copy.backgroundColor =
              normalizeHexColor(copy.backgroundColor) || DEFAULT_SCENE_BACKGROUND;
            copy.img =
              typeof copy.img === "string" && copy.img.trim() !== ""
                ? copy.img.trim()
                : null;
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

function finiteInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

/**
 * Step 5.6: sheet initiative intent.
 *
 * Read the modifier for the actor's chosen initiative statistic. The sheet
 * stores pure modifiers (`system.perception.mod`, `system.saves.reflex.mod`,
 * `system.skills.stealth.mod`), and `prepareActorData` guarantees they exist.
 */
function initiativeModifierForSystem(system, statistic) {
  const key = String(statistic || "perception").trim().toLowerCase();
  if (key === "perception") {
    return finiteInteger(system && system.perception && system.perception.mod, 0);
  }
  const save = system && system.saves ? system.saves[key] : null;
  if (save && typeof save === "object") {
    return finiteInteger(save.mod, 0);
  }
  const skill = system && system.skills ? system.skills[key] : null;
  if (skill && typeof skill === "object") {
    return finiteInteger(skill.mod, 0);
  }
  return finiteInteger(system && system.perception && system.perception.mod, 0);
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

const CHAT_CARD_TYPES = Object.freeze([
  "spell-card",
  "attack-card",
  "damage-card",
]);
const CHAT_CARD_SAVE_TYPES = Object.freeze(["fortitude", "reflex", "will"]);

function trimChatCardText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/**
 * Step 5.6: interactive chat cards.
 *
 * A spell/attack card is stored next to the text so every client can render the
 * save-DC and damage buttons. The server validates the shape (the payload comes
 * from a client) and drops anything it does not recognise.
 */
function normalizeChatCard(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const type = trimChatCardText(value.type, 32).toLowerCase();
  if (CHAT_CARD_TYPES.indexOf(type) === -1) {
    return null;
  }
  const dc = Number(value.dc);
  const saveType = trimChatCardText(value.saveType, 32).toLowerCase();
  return {
    type: type,
    spellId: trimChatCardText(value.spellId, 200) || null,
    name: trimChatCardText(value.name, 200) || null,
    dc: Number.isFinite(dc) && dc > 0 ? Math.trunc(dc) : null,
    saveType:
      CHAT_CARD_SAVE_TYPES.indexOf(saveType) === -1 ? null : saveType,
    damageFormula: trimChatCardText(value.damageFormula, 120) || null,
    description: trimChatCardText(value.description, 2000) || "",
  };
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
    card: null,
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
    card: message.card ? Object.assign({}, message.card) : null,
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
    /**
     * Persistent lobby accounts (Phase 6.1/6.2). These survive disconnects and
     * are written to `session.json` as the `users` array. The connected roster
     * above is derived from them on join.
     *
     * @type {Map<string, {id:string,name:string,role:string,color:string,pronouns:string,characterId:string|null,createdAt:string}>}
     */
    this.profiles = new Map();
    this._profileSequence = 0;
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

    // Phase 6.1: profiles are the persistent accounts; the connected `users`
    // roster is seeded from the profile so a lobby login keeps its name/colour.
    const profile = this._ensureProfileForMember(member);
    member.role = profile.role;
    member.name = profile.name || member.name;
    if (!this.users.has(member.id)) {
      this.users.set(member.id, this._createUserFromProfile(profile, member));
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
    // The persistent profile stays in `profiles`; only the live roster entry
    // disappears. This is what lets the lobby list accounts after F5.
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

  // --------------------------------------------------------------- profiles

  /** Public, JSON-safe copy of the persistent lobby accounts. */
  getProfiles() {
    return Array.from(this.profiles.values())
      .map(function (profile) {
        return Object.assign({}, profile);
      })
      .sort(function (a, b) {
        const byDate = String(a.createdAt || "").localeCompare(
          String(b.createdAt || ""),
        );
        return byDate !== 0
          ? byDate
          : String(a.id).localeCompare(String(b.id));
      });
  }

  getProfile(profileId) {
    const profile = this.profiles.get(profileId);
    return profile ? Object.assign({}, profile) : null;
  }

  /**
   * Create a persistent account from the lobby. The display name is unique so
   * the GM can tell players apart in the ownership matrix.
   */
  createProfile(options) {
    const input =
      options !== null && typeof options === "object" ? options : {};
    const name = asNonEmptyString(input.name);
    if (!name) {
      throw new TypeError("Profile name is required.");
    }
    const displayName = name.slice(0, 80);
    const duplicate = Array.from(this.profiles.values()).some(function (profile) {
      return (
        String(profile.name || "").toLowerCase() === displayName.toLowerCase()
      );
    });
    if (duplicate) {
      throw new Error("A profile named \"" + displayName + "\" already exists.");
    }

    let id = asNonEmptyString(input.id);
    if (id) {
      if (this.profiles.has(id)) {
        throw new RangeError("Profile already exists: " + id + ".");
      }
    } else {
      do {
        this._profileSequence += 1;
        id = "user-" + this._profileSequence;
      } while (this.profiles.has(id));
    }

    const profile = {
      id: id,
      name: displayName,
      role: roles.normalizeRole(input.role),
      color:
        normalizeHexColor(input.color) ||
        (roles.normalizeRole(input.role) === roles.ROLES.GM
          ? GM_COLOR
          : randomPlayerColor()),
      pronouns: "",
      characterId: null,
      createdAt: new Date().toISOString(),
    };
    this.profiles.set(profile.id, profile);
    this._emitProfilesUpdate();
    this._scheduleSave();
    return Object.assign({}, profile);
  }

  /** Create or refresh the persistent account backing a connected member. */
  _ensureProfileForMember(member) {
    let profile = this.profiles.get(member.id);
    if (!profile) {
      const name =
        typeof member.name === "string" &&
        member.name.trim() !== "" &&
        member.name !== member.id
          ? member.name.trim().slice(0, 80)
          : roles.isGM(member)
            ? "Ведущий"
            : "Игрок";
      profile = {
        id: member.id,
        name: name,
        role: member.role,
        color: roles.isGM(member) ? GM_COLOR : randomPlayerColor(),
        pronouns: "",
        characterId: null,
        createdAt: new Date().toISOString(),
      };
      this.profiles.set(member.id, profile);
      this._emitProfilesUpdate();
      this._scheduleSave();
    }
    return profile;
  }

  /** Default live-roster entry derived from a persistent profile. */
  _createUserFromProfile(profile, member) {
    return {
      id: profile.id,
      name: profile.name || (roles.isGM(member) ? "Ведущий" : "Игрок"),
      role: profile.role || member.role,
      color: profile.color || (roles.isGM(member) ? GM_COLOR : randomPlayerColor()),
      pronouns: profile.pronouns || "",
      characterId: profile.characterId || null,
    };
  }

  /** Default display profile for a freshly connected client (legacy helper). */
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

    // Mirror the edit into the persistent account so the lobby and the
    // ownership matrix see the same identity after a reconnect.
    const profile = this._ensureProfileForMember(member);
    profile.name = user.name;
    profile.role = user.role;
    profile.color = user.color;
    profile.pronouns = user.pronouns;
    profile.characterId = user.characterId;
    this._emitProfilesUpdate();
    this._emitUsersUpdate();
    this._scheduleSave();
    return Object.assign({}, user);
  }

  /**
   * Phase 6.1: normalize every loaded actor matrix. Ownership is only granted
   * through the GM's matrix (`setActorOwnership`) — linking `characterId` is a
   * chat-identity concern and must never be able to escalate permissions.
   */
  _ensureActorOwnershipClaims() {
    for (const actor of this.directories.actors.entries) {
      actor.ownership = normalizeOwnership(actor.ownership);
    }
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

  /** Broadcast persistent accounts (lobby/profile changes, Phase 6.1). */
  _emitProfilesUpdate() {
    const payload = { sessionId: this.id, users: this.getProfiles() };
    for (const listener of this._listeners) {
      try {
        listener("room:profiles-update", payload);
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
   * Step 6.4: build the complete world payload used by `session.json` and the
   * `GET /api/lobby/export` download. The object is JSON-safe and contains the
   * same root keys as the persisted file.
   */
  exportWorld() {
    return {
      version: SESSION_FILE_VERSION,
      sessionId: this.id,
      savedAt: new Date().toISOString(),
      // Phase 6.1: persistent lobby accounts. Connected members live in
      // `this.users` and are intentionally not persisted.
      users: this.getProfiles(),
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
        profile: this._profileSequence,
      },
    };
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

    const payload = this.exportWorld();

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

    this._applyPersistedWorld(parsed);
    return { ok: true, path: target };
  }

  /**
   * Step 6.4: validate an imported world document. The import API and the
   * persistence loader share the exact same validation and restore pipeline,
   * so a file accepted from the UI can never take a different code path.
   *
   * @param {object} world
   * @returns {{ok:boolean, reason?:string}}
   */
  importWorld(world) {
    if (world === null || typeof world !== "object" || Array.isArray(world)) {
      return { ok: false, reason: "invalid-format" };
    }
    if (
      !Object.prototype.hasOwnProperty.call(world, "directories") ||
      !Object.prototype.hasOwnProperty.call(world, "users")
    ) {
      return { ok: false, reason: "missing-root-keys" };
    }
    if (
      world.directories === null ||
      typeof world.directories !== "object" ||
      Array.isArray(world.directories)
    ) {
      return { ok: false, reason: "invalid-directories" };
    }
    if (!Array.isArray(world.users)) {
      return { ok: false, reason: "invalid-users" };
    }

    this._applyPersistedWorld(world);

    // A world import replaces the campaign, so any in-memory encounter that
    // refers to the previous actors must not survive. Clients reload through
    // `room:reload` and reconnect to the imported world.
    this.combatants.clear();
    this.encounter = null;
    this.combatLog = [];
    this._logSequence = 0;
    this.status = SESSION_STATUS.LOBBY;
    this._ensureEncounter();

    this._emitDirectoriesUpdate();
    this._emitProfilesUpdate();
    this._scheduleSave();
    return { ok: true };
  }

  /**
   * Replace the persisted portion of the room state from a parsed
   * `session.json` document (shared by loadFromDisk and importWorld).
   *
   * @param {object} parsed
   */
  _applyPersistedWorld(parsed) {
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

    // Phase 6.1: restore persistent accounts from the `users` array.
    this.profiles = new Map();
    if (Array.isArray(parsed.users)) {
      for (const raw of parsed.users) {
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
          continue;
        }
        const id = asNonEmptyString(raw.id);
        const name = asNonEmptyString(raw.name);
        if (!id || !name) {
          continue;
        }
        this.profiles.set(id, {
          id: id,
          name: name.slice(0, 80),
          role: roles.normalizeRole(raw.role),
          color:
            normalizeHexColor(raw.color) ||
            (roles.normalizeRole(raw.role) === roles.ROLES.GM
              ? GM_COLOR
              : randomPlayerColor()),
          pronouns:
            typeof raw.pronouns === "string"
              ? raw.pronouns.trim().slice(0, 60)
              : "",
          characterId:
            typeof raw.characterId === "string" && raw.characterId !== ""
              ? raw.characterId
              : null,
          createdAt:
            typeof raw.createdAt === "string" && raw.createdAt !== ""
              ? raw.createdAt
              : new Date().toISOString(),
        });
      }
    }

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
    this._profileSequence = Math.max(
      Number.isInteger(sequences.profile) ? sequences.profile : 0,
      maxSequenceFrom(
        Array.from(this.profiles.keys()),
        /^user-(\d+)$/,
      ),
    );

    // Phase 6.1: normalize every actor matrix and re-apply character claims so
    // a reload never loses the owner's editing permission.
    this._ensureActorOwnershipClaims();
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
      // Step 6.3: persisted scene configuration.
      entry.gridSize = normalizeSceneGridSize(
        input.gridSize === undefined ? DEFAULT_SCENE_GRID_SIZE : input.gridSize,
      );
      entry.backgroundColor =
        normalizeHexColor(input.backgroundColor) || DEFAULT_SCENE_BACKGROUND;
      // Step 6.8: duplicating/importing a scene carries its canvas arrays.
      // Empty input keeps the previous behaviour (a fresh scene).
      const canvas = sanitizeSceneCanvas(input);
      entry.walls = canvas.walls;
      entry.drawings = canvas.drawings;
      entry.lights = canvas.lights;
      entry.tokens = canvas.tokens;
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
      // Phase 6.1: Foundry-compatible ownership matrix. The GM may seed the
      // matrix; the WS handler only passes a trusted `ownerId` for players.
      entry.ownership = normalizeOwnership(input.ownership);
      const ownerId = asNonEmptyString(input.ownerId);
      if (ownerId) {
        entry.ownership[ownerId] = OWNERSHIP_LEVELS.OWNER;
      }
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

  /**
   * Remove a scene / actor / item / journal entry (Step 5.5).
   *
   * Directory management is shared, but deleting a claimed actor is restricted
   * to that actor's owner or the GM, mirroring `updateActor`.
   *
   * @param {"scenes"|"actors"|"items"|"journals"} kind
   * @param {string} entryId
   * @param {string} [memberId]
   * @param {"gm"|"player"} [role]
   */
  deleteDirectoryEntry(kind, entryId, memberId, role) {
    const normalized = this._requireDirectory(kind);
    const entries = this.directories[normalized].entries;
    const index = entries.findIndex(function (entry) {
      return entry.id === entryId;
    });
    if (index === -1) {
      throw new RangeError("Unknown " + normalized + " entry: " + String(entryId) + ".");
    }

    if (
      normalized === "actors" &&
      role !== "gm" &&
      this.getActorPermission(entryId, memberId, role) < OWNERSHIP_LEVELS.OWNER
    ) {
      throw new Error("Only the owner or the GM can delete this actor.");
    }

    const [removed] = entries.splice(index, 1);
    // Step 6.8: deleting the active scene must not leave the room pointing at
    // a missing directory entry. Fall back to the base scene and notify every
    // client with a normal activation payload.
    const wasActiveScene =
      normalized === "scenes" && this.activeSceneId === entryId;
    this._emitDirectoriesUpdate();
    this._scheduleSave();
    if (wasActiveScene) {
      this.activateScene(null);
    }
    return clonePlainData(removed);
  }

  // -------------------------------------------------------- actor sheets (4.8)

  /**
   * Phase 6.1: effective Foundry permission level for one member.
   * The GM always resolves to OWNER. Explicit per-user entries override the
   * `default` row, exactly like Foundry's ownership matrix.
   *
   * @param {string} actorId
   * @param {string} [memberId]
   * @param {"gm"|"player"} [role]
   * @returns {number} 0..3
   */
  getActorPermission(actorId, memberId, role) {
    const actor = this.directories.actors.entries.find(function (entry) {
      return entry.id === actorId;
    });
    if (!actor) {
      return OWNERSHIP_LEVELS.NONE;
    }
    const member = this.members.get(memberId);
    if (role === "gm" || roles.isGM(member)) {
      return OWNERSHIP_LEVELS.OWNER;
    }
    const ownership = normalizeOwnership(actor.ownership);
    if (
      typeof memberId === "string" &&
      memberId !== "" &&
      Object.prototype.hasOwnProperty.call(ownership, memberId)
    ) {
      return ownership[memberId];
    }
    return ownership.default;
  }

  /**
   * Replace an actor's ownership matrix. Only the GM may call this; players
   * can never grant themselves access.
   *
   * @param {string} actorId
   * @param {object} ownership
   * @param {string} [memberId]
   * @param {"gm"|"player"} [role]
   */
  setActorOwnership(actorId, ownership, memberId, role) {
    if (role !== "gm" && !roles.isGM(this.members.get(memberId))) {
      throw new Error("Only the GM can change actor ownership.");
    }
    const actor = this.directories.actors.entries.find(function (entry) {
      return entry.id === actorId;
    });
    if (!actor) {
      throw new RangeError("Unknown actor: " + String(actorId) + ".");
    }

    // Keep only `default` and known profile/member ids so a malicious client
    // cannot grow session.json with thousands of dead keys.
    const normalized = normalizeOwnership(ownership);
    const allowed = new Set(["default"]);
    for (const id of this.profiles.keys()) {
      allowed.add(id);
    }
    for (const id of this.users.keys()) {
      allowed.add(id);
    }
    for (const key of Object.keys(normalized)) {
      if (!allowed.has(key)) {
        delete normalized[key];
      }
    }

    actor.ownership = normalized;
    this._emitDirectoriesUpdate();
    this._emitActorUpdate({
      sessionId: this.id,
      actorId: actor.id,
      actor: clonePlainData(actor),
    });
    this._scheduleSave();
    return clonePlainData(actor);
  }

  /**
   * Atomically replace a character actor's sheet payload.
   *
   * Permission mirrors Foundry: the GM may edit any actor, a player only an
   * actor whose ownership level is Owner (3). The GM alone may change the
   * ownership matrix itself. An unclaimed actor is editable by the GM so the
   * world can be prepared before handing ownership out.
   *
   * @param {string} actorId
   * @param {{name?:string,system?:object,items?:array,ownership?:object}} data
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

    const input =
      data !== null && typeof data === "object" && !Array.isArray(data) ? data : {};

    const permission = this.getActorPermission(actorId, memberId, role);
    if (permission < OWNERSHIP_LEVELS.OWNER) {
      throw new Error("Only the owner or the GM can edit this actor.");
    }
    if (input.ownership !== undefined) {
      if (role !== "gm" && !roles.isGM(this.members.get(memberId))) {
        throw new Error("Only the GM can change actor ownership.");
      }
      this.setActorOwnership(actorId, input.ownership, memberId, role);
    }

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
   * Step 6.3: public scene configuration used by the canvas. The base scene
   * (`null`) has no directory entry and reports the defaults.
   *
   * @param {string|null} sceneId
   * @returns {{id:string|null,name:string,img:string|null,gridSize:number,backgroundColor:string}}
   */
  getSceneSettings(sceneId) {
    const id =
      typeof sceneId === "string" && sceneId.trim() !== "" ? sceneId : null;
    const scene = id === null ? null : this._findSceneEntry(id);
    if (!scene) {
      return {
        id: id,
        name: id === null ? "Базовая сцена" : "Сцена",
        img: null,
        gridSize: DEFAULT_SCENE_GRID_SIZE,
        backgroundColor: DEFAULT_SCENE_BACKGROUND,
      };
    }
    return {
      id: id,
      name: scene.name,
      img:
        typeof scene.img === "string" && scene.img.trim() !== ""
          ? scene.img.trim()
          : null,
      gridSize: normalizeSceneGridSize(scene.gridSize),
      backgroundColor:
        normalizeHexColor(scene.backgroundColor) || DEFAULT_SCENE_BACKGROUND,
    };
  }

  /**
   * Step 6.3: update the editable properties of a scene. Only configuration is
   * touched; walls/drawings/lights/tokens keep their own update path.
   *
   * @param {string|null} sceneId
   * @param {{img?:string|null,gridSize?:number,backgroundColor?:string}} data
   * @param {string} [sourceMemberId]
   * @returns {object} the normalized scene settings
   */
  updateSceneSettings(sceneId, data, sourceMemberId) {
    const id =
      typeof sceneId === "string" && sceneId.trim() !== "" ? sceneId : null;
    if (id === null) {
      throw new RangeError("The base scene has no editable settings.");
    }
    const scene = this._findSceneEntry(id);
    if (!scene) {
      throw new RangeError("Unknown scene: " + String(sceneId) + ".");
    }
    const input =
      data !== null && typeof data === "object" && !Array.isArray(data) ? data : {};

    if (input.img !== undefined) {
      const image =
        typeof input.img === "string" && input.img.trim() !== ""
          ? input.img.trim().slice(0, 2048)
          : null;
      scene.img = image;
    }
    if (input.gridSize !== undefined) {
      scene.gridSize = normalizeSceneGridSize(input.gridSize);
    }
    if (input.backgroundColor !== undefined) {
      scene.backgroundColor =
        normalizeHexColor(input.backgroundColor) || DEFAULT_SCENE_BACKGROUND;
    }

    this._emitDirectoriesUpdate();
    this._scheduleSave();
    const settings = this.getSceneSettings(id);
    settings.sourceMemberId = sourceMemberId || null;
    return settings;
  }

  /**
   * Persisted fog-of-war texture for one scene/actor (`null` = nothing
   * explored). The scene canvas itself stays a compact arrays-only contract;
   * the encoded texture travels next to it in activation/snapshot payloads.
   *
   * `fogExploration` may be a legacy flat PNG string (pre-5.4 sessions) or an
   * `{ [actorId]: dataUrl }` map. A legacy string is returned as a fallback
   * for every actor so old saves keep working.
   *
   * @param {string|null} sceneId
   * @param {string|null} [actorId]
   * @returns {string|null}
   */
  getSceneFog(sceneId, actorId = null) {
    const stored = this.getSceneFogCollection(sceneId);
    if (typeof stored === "string") {
      // Legacy flat texture: shared fallback for every actor.
      return stored;
    }
    if (!stored || typeof stored !== "object") {
      return null;
    }
    const key =
      typeof actorId === "string" && actorId !== "" ? actorId : null;
    if (key && stored[key]) {
      return stored[key];
    }
    return stored[FOG_SCENE_FALLBACK_KEY] || null;
  }

  /**
   * Raw persisted fog payload for one scene: a legacy PNG string or a
   * per-actor map. Used by snapshot/activation payloads so the client can
   * restore every actor's exploration at once.
   *
   * @param {string|null} sceneId
   * @returns {string|Record<string,string>|null}
   */
  getSceneFogCollection(sceneId) {
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
      scene: this.getSceneSettings(this.activeSceneId),
      fogExploration: this.getSceneFogCollection(this.activeSceneId),
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
   * Step 5.3/5.4: persist the accumulated fog-of-war texture for a scene.
   *
   * With an `actorId` the texture is stored per owner:
   * `scenes[sceneId].fogExploration[actorId]`. Without one the legacy flat
   * scene-wide PNG is written (used by older clients and pre-5.4 saves).
   * A dedicated broadcast keeps every client's fog in sync without touching
   * the scene-canvas contract.
   *
   * @param {string|null} sceneId
   * @param {string|null} fogExploration PNG data URL or null
   * @param {string} [sourceMemberId]
   * @param {string|null} [actorId]
   * @returns {string|null} stored texture for the written slot
   */
  updateFog(sceneId, fogExploration, sourceMemberId, actorId = null) {
    const id =
      typeof sceneId === "string" && sceneId.trim() !== "" ? sceneId : null;
    const fog = sanitizeFogExploration(fogExploration);
    const actorKey =
      typeof actorId === "string" && actorId.trim() !== "" ? actorId : null;

    if (actorKey === null) {
      if (id === null) {
        this.baseSceneFogExploration = fog;
      } else {
        const scene = this._findSceneEntry(id);
        if (!scene) {
          throw new RangeError("Unknown scene: " + String(sceneId) + ".");
        }
        scene.fogExploration = fog;
      }
    } else {
      let current;
      if (id === null) {
        current = this.baseSceneFogExploration;
      } else {
        const scene = this._findSceneEntry(id);
        if (!scene) {
          throw new RangeError("Unknown scene: " + String(sceneId) + ".");
        }
        current = scene.fogExploration;
      }
      const map =
        current !== null && typeof current === "object" && !Array.isArray(current)
          ? Object.assign({}, current)
          : typeof current === "string" && current !== ""
            ? { [FOG_SCENE_FALLBACK_KEY]: current }
            : {};
      map[actorKey] = fog;
      const collection = sanitizeFogCollection(map);
      if (id === null) {
        this.baseSceneFogExploration = collection;
      } else {
        this._findSceneEntry(id).fogExploration = collection;
      }
    }

    this._scheduleSave();
    this._emitFogUpdate({
      sessionId: this.id,
      sceneId: id,
      actorId: actorKey,
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
      card: normalizeChatCard(input.card),
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

  /** True when a player owns the given directory actor (profile or assignment). */
  _memberControlsActor(member, actorId) {
    if (!member) {
      return false;
    }
    if (roles.isGM(member)) {
      return true;
    }
    if (Array.isArray(member.controlledIds) && member.controlledIds.indexOf(actorId) !== -1) {
      return true;
    }
    const user = this.users ? this.users.get(member.id) : null;
    return Boolean(user && user.characterId === actorId);
  }

  /**
   * Step 5.6: roll initiative for one directory actor from the character sheet.
   *
   * Foundry behaviour:
   *   - the actor becomes a combatant (the encounter is created on demand),
   *   - only that combatant's initiative is rolled,
   *   - the combat tracker order is refreshed immediately.
   *
   * @param {object} actorEntry directory actor
   * @param {object} [options] `{ statistic, secret }`
   * @returns {{active:object|null, initiative:object, order:object[]}}
   */
  rollActorInitiative(actorEntry, options) {
    const opts = options !== null && typeof options === "object" ? options : {};
    const prepared = PrepareData.prepareActorData(actorEntry);
    const system = prepared.system || {};
    const actorId = actorEntry.id;
    const requested =
      typeof opts.statistic === "string" && opts.statistic.trim() !== ""
        ? opts.statistic
        : system.initiative && system.initiative.statistic;
    const statistic = String(requested || "perception").trim().toLowerCase();
    const modifier = initiativeModifierForSystem(system, statistic);

    const scene = this.getSceneCanvas(this.activeSceneId);
    const sceneToken = Array.isArray(scene.tokens)
      ? scene.tokens.find(function (token) {
          return token && token.actorId === actorId;
        })
      : null;

    const skills = {};
    for (const [key, value] of Object.entries(system.skills || {})) {
      skills[key] = finiteInteger(value && typeof value === "object" ? value.mod : value, 0);
    }
    const saves = {};
    for (const key of ["fortitude", "reflex", "will"]) {
      const save = system.saves ? system.saves[key] : null;
      saves[key] = finiteInteger(save && typeof save === "object" ? save.mod : save, 0);
    }
    // Initiative reads the chosen statistic from `skills` (see core Initiative).
    skills.perception = finiteInteger(system.perception && system.perception.mod, 0);
    for (const key of Object.keys(saves)) {
      skills[key] = saves[key];
    }

    const maxHP = Math.max(
      1,
      finiteInteger(
        system.derived && system.derived.hp
          ? system.derived.hp.max
          : system.attributes && system.attributes.hp
            ? system.attributes.hp.max
            : 1,
        1,
      ),
    );
    const rawCurrent = finiteInteger(
      system.attributes && system.attributes.hp ? system.attributes.hp.value : maxHP,
      maxHP,
    );

    const spec = {
      id: actorId,
      actorId: actorId,
      name: actorEntry.name || actorId,
      img: actorEntry.img || null,
      alliance: actorEntry.actorType === "npc" ? "enemy" : "player",
      x: sceneToken ? finiteInteger(sceneToken.gridX, 0) : 0,
      y: sceneToken ? finiteInteger(sceneToken.gridY, 0) : 0,
      maxHP: maxHP,
      currentHP: Math.max(1, Math.min(maxHP, rawCurrent)),
      ac: Math.max(
        1,
        finiteInteger(
          system.attributes && system.attributes.ac
            ? system.attributes.ac.value
            : system.derived && system.derived.armorClass
              ? system.derived.armorClass.value
              : 10,
          10,
        ),
      ),
      saves: saves,
      skills: skills,
    };

    let encounter = this.encounter;
    let combatant =
      this.combatants.get(actorId) ||
      Array.from(this.combatants.values()).find(function (entry) {
        return entry && entry.actorId === actorId;
      }) ||
      null;

    if (!combatant) {
      const liveEncounter = this.encounter;
      if (liveEncounter && liveEncounter.started) {
        // A started (or finished) encounter cannot accept `addCombatant`, so
        // append directly to the live roster and register it for tie-breaking.
        combatant = new Combatant(spec);
        this._applyCombatantPresentation(combatant, spec);
        this.combatants.set(combatant.id, combatant);
        liveEncounter.combatants.push(combatant);
        if (typeof liveEncounter._register === "function") {
          liveEncounter._register(combatant);
        }
      } else {
        combatant = this.addCombatant(spec);
        encounter = this.encounter;
      }
    } else {
      // Refresh sheet-derived numbers without disturbing the current HP pool.
      combatant.name = spec.name;
      combatant.ac = spec.ac;
      combatant.saves = Object.assign({}, combatant.saves, saves);
      combatant.maxHP = spec.maxHP;
      combatant.currentHP = Math.max(
        1,
        Math.min(
          spec.maxHP,
          Number.isInteger(combatant.currentHP) ? combatant.currentHP : spec.currentHP,
        ),
      );
    }

    if (!encounter) {
      encounter = this._ensureEncounter();
    }
    if (!encounter) {
      throw new Error("Could not create an encounter for " + actorId + ".");
    }

    const d20 = 1 + Math.floor(Math.random() * 20);
    combatant.initiativeRoll = d20;
    combatant.initiativeStatistic = statistic;
    combatant.initiativeModifier = modifier;
    combatant.initiative = d20 + modifier;
    combatant.skills = Object.assign({}, combatant.skills, { [statistic]: modifier });

    let active;
    if (!encounter.started) {
      active = encounter.startEncounter();
      this.status = SESSION_STATUS.RUNNING;
      this.startedAt = this.startedAt || new Date().toISOString();
      this._emit("room:started", { sessionId: this.id, order: this.getOrder() });
    } else {
      const activeId = encounter.activeCombatant ? encounter.activeCombatant.id : null;
      encounter.combatants = Initiative.sortInitiative(
        encounter.combatants,
        encounter.registration,
      );
      if (activeId) {
        const index = encounter.combatants.findIndex(function (entry) {
          return entry.id === activeId;
        });
        if (index !== -1) {
          encounter.activeCombatantIndex = index;
        }
      }
      this._syncEncounterRound(encounter);
      active = encounter.activeCombatant;
    }

    return {
      active: active,
      initiative: {
        combatantId: combatant.id,
        d20: d20,
        modifier: modifier,
        statistic: statistic,
        total: d20 + modifier,
      },
      order: this.getOrder(),
    };
  }

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
    const isGM = roles.isGM(member) || role === roles.ROLES.GM;

    // Step 5.6: rolling initiative from a character sheet. The target is a
    // directory actor, not a pre-registered combatant, so this path runs before
    // the encounter/turn checks and creates the encounter on demand.
    const sheetActorId =
      action === "roll-initiative" ? asNonEmptyString(payload.actorId) : null;
    if (sheetActorId !== null) {
      const actorEntry = this.directories.actors.entries.find(function (entry) {
        return entry && entry.id === sheetActorId;
      });
      if (actorEntry) {
        if (!this._memberControlsActor(member, sheetActorId)) {
          return {
            ok: false,
            reason: "permission-denied",
            message: "Players may only roll initiative for their own character.",
          };
        }
        // Remember ownership so the player's subsequent turn actions resolve.
        if (
          Array.isArray(member.controlledIds) &&
          member.controlledIds.indexOf(sheetActorId) === -1
        ) {
          member.controlledIds.push(sheetActorId);
        }
        const logStart = this.combatLog.length;
        let outcome;
        try {
          outcome = this.rollActorInitiative(actorEntry, payload);
        } catch (error) {
          return {
            ok: false,
            reason: "invalid-action",
            message: error instanceof Error ? error.message : String(error),
          };
        }
        return {
          ok: true,
          action: action,
          result: outcome,
          state: this.serializeState(),
          logEntries: this.combatLog.slice(logStart),
        };
      }
    }

    const encounter = this.encounter;
    if (!encounter) {
      return {
        ok: false,
        reason: "encounter-not-started",
        message: "The encounter has not been started yet.",
      };
    }

    const activeId = encounter.activeCombatant ? encounter.activeCombatant.id : null;

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
      profiles: this.getProfiles(),
      directories: this.getDirectories({ includeFog: false }),
      activeSceneId: this.activeSceneId,
      sceneCanvas: this.getSceneCanvas(this.activeSceneId),
      scene: this.getSceneSettings(this.activeSceneId),
      // Step 5.3/5.4: encoded per-actor fog textures of the active scene.
      sceneFogExploration: this.getSceneFogCollection(this.activeSceneId),
    };
  }
}

module.exports = {
  EncounterSession,
  SESSION_STATUS,
};
