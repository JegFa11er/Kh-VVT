"use strict";

/**
 * Role model for the table.
 *
 * GM: full control over every combatant, hidden information and the
 *     encounter lifecycle.
 * Player: controls only the combatants assigned to them and sees only
 *     information broadcast publicly.
 */

const ROLES = Object.freeze({
  GM: "gm",
  PLAYER: "player",
});

const ROLE_VALUES = Object.freeze([ROLES.GM, ROLES.PLAYER]);

function isRole(value) {
  return ROLE_VALUES.indexOf(value) !== -1;
}

function normalizeRole(value) {
  if (value === ROLES.GM) {
    return ROLES.GM;
  }
  return ROLES.PLAYER;
}

function createMember(options) {
  const opts = options || {};
  if (typeof opts.id !== "string" || opts.id.trim() === "") {
    throw new TypeError("A member requires a non-empty string id.");
  }

  return {
    id: opts.id,
    name: typeof opts.name === "string" && opts.name.trim() !== "" ? opts.name : opts.id,
    role: normalizeRole(opts.role),
    /** Combatant ids this member is allowed to control. */
    controlledIds: Array.isArray(opts.controlledIds) ? opts.controlledIds.slice() : [],
  };
}

function isGM(member) {
  return Boolean(member) && member.role === ROLES.GM;
}

function canControlCombatant(member, combatantId) {
  if (!member) {
    return false;
  }
  if (isGM(member)) {
    return true;
  }
  return member.controlledIds.indexOf(combatantId) !== -1;
}

function canManageEncounter(member) {
  return isGM(member);
}

function canSeeHidden(member) {
  return isGM(member);
}

function canUseCompendium(member) {
  return Boolean(member) && isRole(member.role);
}

module.exports = {
  ROLES,
  ROLE_VALUES,
  isRole,
  normalizeRole,
  createMember,
  isGM,
  canControlCombatant,
  canManageEncounter,
  canSeeHidden,
  canUseCompendium,
};
