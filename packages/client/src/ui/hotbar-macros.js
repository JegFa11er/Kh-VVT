import {
  HOTBAR_MACRO_PAYLOAD_TYPE,
  readDragPayload,
  setDragPayload,
} from "./drag-payloads.js";

/** Slots are numbered 1..9 then 0, matching Foundry's hotbar. */
export const HOTBAR_SLOT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

export const HOTBAR_STORAGE_VERSION = "v1";

export const MACRO_TYPES = Object.freeze({
  STRIKE: "strike",
  SPELL: "spell",
  SKILL: "skill",
  ACTION: "action",
});

const MACRO_GLYPHS = {
  strike: "⚔",
  spell: "✦",
  skill: "🎲",
  action: "💬",
};

export function macroGlyph(type) {
  return MACRO_GLYPHS[type] || "★";
}

/**
 * Each player owns a separate hotbar. The connected member id is the natural
 * key; the role is a fallback for clients that have not joined yet.
 */
export function hotbarStorageKey(userId, role) {
  const owner =
    typeof userId === "string" && userId.trim() !== ""
      ? userId.trim()
      : role === "gm"
        ? "gm"
        : "player";
  return "pf2e.hotbar." + HOTBAR_STORAGE_VERSION + ":" + owner;
}

function storage() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage || null;
  } catch (error) {
    // Private browsing may throw on access.
    return null;
  }
}

export function loadHotbar(storageKey) {
  const store = storage();
  if (!store || !storageKey) {
    return {};
  }
  try {
    const raw = store.getItem(storageKey);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const hotbar = {};
    for (const key of HOTBAR_SLOT_KEYS) {
      const macro = normalizeMacro(parsed[key]);
      if (macro) {
        hotbar[key] = macro;
      }
    }
    return hotbar;
  } catch (error) {
    return {};
  }
}

export function saveHotbar(storageKey, hotbar) {
  const store = storage();
  if (!store || !storageKey) {
    return false;
  }
  try {
    const payload = {};
    for (const key of HOTBAR_SLOT_KEYS) {
      const macro = normalizeMacro(hotbar ? hotbar[key] : null);
      if (macro) {
        payload[key] = macro;
      }
    }
    store.setItem(storageKey, JSON.stringify(payload));
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Coerce a macro into the persisted contract:
 * `{ type, actorId, actionId, name, icon, text, plain, visibility }`.
 */
export function normalizeMacro(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const text = typeof raw.text === "string" ? raw.text : "";
  if (name === "" && text.trim() === "") {
    return null;
  }
  return {
    type:
      typeof raw.type === "string" && raw.type.trim() !== ""
        ? raw.type.trim()
        : MACRO_TYPES.ACTION,
    actorId:
      typeof raw.actorId === "string" && raw.actorId.trim() !== ""
        ? raw.actorId.trim()
        : null,
    actionId:
      typeof raw.actionId === "string" && raw.actionId.trim() !== ""
        ? raw.actionId.trim()
        : null,
    name: name || text.trim().slice(0, 120),
    icon:
      typeof raw.icon === "string" && raw.icon.trim() !== ""
        ? raw.icon.trim()
        : null,
    text: text.trim() === "" ? name : text.trim(),
    plain: raw.plain === true,
    visibility: raw.visibility === "blind" ? "blind" : "public",
    meta:
      raw.meta && typeof raw.meta === "object" && !Array.isArray(raw.meta)
        ? raw.meta
        : null,
  };
}

export function createMacro(data) {
  const macro = normalizeMacro(data);
  if (!macro) {
    throw new Error("A macro needs a name or chat text.");
  }
  return macro;
}

/** Serialize a macro for an HTML5 drag. */
export function setMacroDragData(event, macro) {
  const normalized = normalizeMacro(macro);
  if (!normalized) {
    return;
  }
  const serialized = setDragPayload(event, {
    type: HOTBAR_MACRO_PAYLOAD_TYPE,
    macro: normalized,
  });
  if (serialized) {
    beginMacroDragSession();
  }
}

/**
 * The character sheet is a body-level portal (z-index 3000) and can cover the
 * bottom hotbar. While a macro drag is in flight we temporarily lift the UI
 * overlay above it, so the hotbar is visible and can receive the drop.
 */
function beginMacroDragSession() {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }
  const body = document.body;
  if (!body) {
    return;
  }
  body.classList.add("pf2e-macro-dragging");
  const clear = () => {
    body.classList.remove("pf2e-macro-dragging");
    window.removeEventListener("dragend", clear);
    window.removeEventListener("drop", clear);
  };
  window.addEventListener("dragend", clear);
  window.addEventListener("drop", clear);
}

/** Read a hotbar macro from a drop event's DataTransfer. */
export function readMacroFromTransfer(dataTransfer) {
  const payload = readDragPayload(dataTransfer);
  if (!payload || payload.type !== HOTBAR_MACRO_PAYLOAD_TYPE) {
    return null;
  }
  return normalizeMacro(payload.macro || payload);
}

/**
 * Reproduce the character sheet's chat routing exactly:
 * `/r …` commands are always sent verbatim, while plain labels are prefixed
 * with «Использует:» when the caller did not opt into the plain form.
 */
export function buildMacroChatMessage(macro) {
  const normalized = normalizeMacro(macro);
  if (!normalized) {
    return null;
  }
  const base = normalized.text || normalized.name;
  const message =
    base.startsWith("/r ") || !normalized.plain ? base : "Использует: " + base;
  return {
    text: message,
    visibility: normalized.visibility,
  };
}

/** Send a stored macro to chat through the network client. */
export function executeMacro(networkClient, macro) {
  if (!networkClient || typeof networkClient.sendChatMessage !== "function") {
    return Promise.reject(new Error("Нет соединения с сервером."));
  }
  const message = buildMacroChatMessage(macro);
  if (!message || message.text === "") {
    return Promise.resolve(null);
  }
  return networkClient.sendChatMessage(message);
}

/** Hotkey → slot for keydown handlers ("1".."9", "0"). */
export function slotFromKeyboardEvent(event) {
  if (!event || event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }
  const key = typeof event.key === "string" ? event.key : "";
  if (key === " ") {
    return null;
  }
  return HOTBAR_SLOT_KEYS.includes(key) ? key : null;
}

/** Never hijack a digit typed into a form field. */
export function isTypingTarget(target) {
  if (!target) {
    return false;
  }
  const tagName = String(target.tagName || "").toUpperCase();
  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    target.isContentEditable === true
  );
}
