/**
 * Step 5.8: in-game dialog bridge.
 *
 * Canvas layers and plain JS modules cannot render React. Instead of browser
 * `window.confirm` / `window.prompt`, they dispatch a DOM event and await the
 * promise resolved by the mounted overlay host. Every dialog is therefore a
 * styled, in-game React surface anchored inside the PixiJS application.
 */

export const CONFIRM_EVENT = "pf2e:confirm-request";
export const PROMPT_EVENT = "pf2e:prompt-request";
export const CANVAS_TEXT_EVENT = "pf2e:canvas-text-request";
export const TOKEN_HUD_EVENT = "pf2e:token-hud-open";
export const OPEN_ACTOR_SHEET_EVENT = "pf2e:open-actor-sheet";

let sequence = 0;

function nextId(prefix) {
  sequence += 1;
  return prefix + "-" + sequence;
}

function canDispatch() {
  return (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function" &&
    typeof CustomEvent === "function"
  );
}

/**
 * In-game confirmation dialog.
 *
 * @param {string|{title?:string,message?:string,confirmLabel?:string,cancelLabel?:string,danger?:boolean}} options
 * @returns {Promise<boolean>}
 */
export function confirmAction(options = {}) {
  const normalized = typeof options === "string" ? { message: options } : options;
  if (!canDispatch()) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    window.dispatchEvent(
      new CustomEvent(CONFIRM_EVENT, {
        detail: {
          id: nextId("confirm"),
          title: normalized.title || "Подтверждение",
          message: normalized.message || "",
          confirmLabel: normalized.confirmLabel || "ОК",
          cancelLabel: normalized.cancelLabel || "Отмена",
          danger: Boolean(normalized.danger),
          resolve,
        },
      }),
    );
  });
}

/**
 * In-game single-line text prompt (journal page names, image URLs, light
 * radii). Resolves `null` when the dialog is cancelled.
 *
 * @param {{title?:string,message?:string,defaultValue?:string,placeholder?:string,inputType?:string}} options
 * @returns {Promise<string|null>}
 */
export function promptText(options = {}) {
  const normalized = typeof options === "string" ? { message: options } : options;
  if (!canDispatch()) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    window.dispatchEvent(
      new CustomEvent(PROMPT_EVENT, {
        detail: {
          id: nextId("prompt"),
          title: normalized.title || "Ввод",
          message: normalized.message || "",
          defaultValue:
            typeof normalized.defaultValue === "string"
              ? normalized.defaultValue
              : "",
          placeholder: normalized.placeholder || "",
          inputType: normalized.inputType === "number" ? "number" : "text",
          confirmLabel: normalized.confirmLabel || "ОК",
          cancelLabel: normalized.cancelLabel || "Отмена",
          resolve,
        },
      }),
    );
  });
}

/**
 * Inline canvas text editor. `screen` is canvas-relative (viewport.worldToScreen).
 * Resolves the entered string, or `null` when cancelled.
 *
 * @param {{screen?:{x:number,y:number},world?:{x:number,y:number},value?:string,color?:string}} options
 * @returns {Promise<string|null>}
 */
export function requestCanvasText(options = {}) {
  if (!canDispatch()) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    window.dispatchEvent(
      new CustomEvent(CANVAS_TEXT_EVENT, {
        detail: {
          id: nextId("canvas-text"),
          screen: options.screen || { x: 0, y: 0 },
          world: options.world || null,
          value: typeof options.value === "string" ? options.value : "",
          color: options.color || "#ff6400",
          resolve,
        },
      }),
    );
  });
}

/** Open the token HUD anchored to a token (Step 5.8). */
export function openTokenHud(payload = {}) {
  if (!canDispatch()) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(TOKEN_HUD_EVENT, {
      detail: payload,
    }),
  );
}

/** Ask the React sidebar to open a character sheet for an actor. */
export function openActorSheet(actorId) {
  if (!canDispatch() || typeof actorId !== "string" || actorId === "") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(OPEN_ACTOR_SHEET_EVENT, {
      detail: { actorId },
    }),
  );
}
