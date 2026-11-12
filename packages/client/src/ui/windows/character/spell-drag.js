/**
 * Step 5.9: prepared-spell drag contract shared by the spellcasting entry card
 * and the preparation book window.
 *
 * The payload identifies the spell, its parent spellcasting entry and the rank
 * it belongs to, so a drop on an empty slot of the same rank can be validated
 * before the slot is filled.
 */
export const PREPARED_DRAG_TYPE = "application/x-pf2e-prepared-spell";

export function setPreparedSpellDragData(event, payload) {
  if (!event || !event.dataTransfer || !payload) {
    return;
  }
  event.dataTransfer.setData(PREPARED_DRAG_TYPE, JSON.stringify(payload));
  event.dataTransfer.setData("text/plain", String(payload.name || "spell"));
  event.dataTransfer.effectAllowed = "copy";
}

export function readPreparedSpellDrag(event) {
  if (!event || !event.dataTransfer) {
    return null;
  }
  const raw = event.dataTransfer.getData(PREPARED_DRAG_TYPE);
  if (!raw) {
    return null;
  }
  try {
    const payload = JSON.parse(raw);
    return payload && payload.spellId ? payload : null;
  } catch (error) {
    return null;
  }
}

export function acceptsPreparedSpellDrag(event) {
  return Boolean(
    event &&
      event.dataTransfer &&
      Array.from(event.dataTransfer.types || []).includes(PREPARED_DRAG_TYPE),
  );
}
