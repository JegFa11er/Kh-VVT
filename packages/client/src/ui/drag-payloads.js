/**
 * Shared drag-and-drop payload contract.
 *
 * The directory panel, character-sheet tabs, hotbar and PixiJS canvas all use
 * `application/json` so a drag can be routed by its `type` field:
 *  - `pf2e-actor-token` - an actor card dragged from the Actors directory;
 *  - `pf2e-hotbar-macro` - a strike/spell/skill macro dragged to the hotbar;
 *  - `compendium-item` - the existing Compendium Browser payload.
 */

export const ACTOR_TOKEN_PAYLOAD_TYPE = "pf2e-actor-token";
export const HOTBAR_MACRO_PAYLOAD_TYPE = "pf2e-hotbar-macro";
export const COMPENDIUM_PAYLOAD_TYPE = "compendium-item";

/** Serialize a payload into the DataTransfer. */
export function setDragPayload(event, payload, effect = "copy") {
  if (!event || !event.dataTransfer || !payload) {
    return false;
  }
  let serialized;
  try {
    serialized = JSON.stringify(payload);
  } catch (error) {
    return false;
  }
  event.dataTransfer.effectAllowed = effect;
  event.dataTransfer.setData("application/json", serialized);
  event.dataTransfer.setData("text/plain", serialized);
  return true;
}

/** Read and parse any JSON drag payload, or `null` for foreign drags. */
export function readDragPayload(dataTransfer) {
  if (!dataTransfer) {
    return null;
  }
  const serialized =
    dataTransfer.getData("application/json") ||
    dataTransfer.getData("text/plain");
  if (!serialized) {
    return null;
  }
  try {
    const payload = JSON.parse(serialized);
    return payload && typeof payload === "object" ? payload : null;
  } catch (error) {
    return null;
  }
}

/** True while a JSON payload is being dragged over a drop target. */
export function canAcceptDrag(event) {
  return Boolean(
    event &&
      event.dataTransfer &&
      Array.from(event.dataTransfer.types || []).includes("application/json"),
  );
}
