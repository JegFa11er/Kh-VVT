/**
 * Foundry-compatible ownership matrix shared by the actor directory, the
 * character sheet and the ownership dialog.
 *
 * Levels:
 *   0 NONE       — the actor cannot be opened at all.
 *   1 LIMITED    — the entry is listed but the sheet stays closed.
 *   2 OBSERVER   — the sheet opens in read-only mode.
 *   3 OWNER      — full sheet editing.
 *
 * The GM always acts as OWNER regardless of the stored matrix. The server
 * enforces the same rule in `EncounterSession#updateActor`, so this module is
 * only the UI half of the permission contract.
 */

export const OWNERSHIP_LEVELS = Object.freeze({
  NONE: 0,
  LIMITED: 1,
  OBSERVER: 2,
  OWNER: 3,
});

export const OWNERSHIP_OPTIONS = Object.freeze([
  { value: OWNERSHIP_LEVELS.NONE, label: "Нет доступа" },
  { value: OWNERSHIP_LEVELS.LIMITED, label: "Ограниченный" },
  { value: OWNERSHIP_LEVELS.OBSERVER, label: "Наблюдатель" },
  { value: OWNERSHIP_LEVELS.OWNER, label: "Владелец" },
]);

export function normalizeOwnershipLevel(value) {
  const level = Number(value);
  if (!Number.isInteger(level) || level < 0) {
    return OWNERSHIP_LEVELS.NONE;
  }
  return level > OWNERSHIP_LEVELS.OWNER ? OWNERSHIP_LEVELS.OWNER : level;
}

/** Return the exact matrix stored on an actor (never a shared reference). */
export function normalizeOwnership(raw) {
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

/**
 * Effective permission of one user on an actor.
 *
 * @param {object|null} actor
 * @param {string|null} userId
 * @param {"gm"|"player"} [role]
 * @returns {number} 0..3
 */
export function getOwnershipLevel(actor, userId, role) {
  if (role === "gm") {
    return OWNERSHIP_LEVELS.OWNER;
  }
  if (!actor || typeof actor !== "object") {
    return OWNERSHIP_LEVELS.NONE;
  }
  const ownership = normalizeOwnership(actor.ownership);
  if (
    typeof userId === "string" &&
    userId !== "" &&
    Object.prototype.hasOwnProperty.call(ownership, userId)
  ) {
    return ownership[userId];
  }
  return ownership.default;
}

/** Observer (2) and Owner (3) may open the sheet. */
export function canViewActor(actor, userId, role) {
  return getOwnershipLevel(actor, userId, role) >= OWNERSHIP_LEVELS.OBSERVER;
}

/** Only Owner (3) and the GM may edit the sheet. */
export function canEditActor(actor, userId, role) {
  return getOwnershipLevel(actor, userId, role) >= OWNERSHIP_LEVELS.OWNER;
}
