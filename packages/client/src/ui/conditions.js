/**
 * Step 5.8.1: shared condition presentation data.
 *
 * The token HUD, the circular token-effect badges and the sheet all need the
 * same glyphs and the same notion of a "valued" condition. Keeping the table
 * here avoids the canvas layer importing a React component.
 */

/** Compact glyphs for the condition grid and the circular token badges. */
export const CONDITION_ICONS = Object.freeze({
  blinded: "🙈",
  clumsy: "🤕",
  confused: "😵",
  controlled: "🪆",
  dazzled: "✨",
  deafened: "🙉",
  doomed: "💀",
  drained: "🩸",
  dying: "💔",
  encumbered: "🎒",
  enfeebled: "😩",
  fascinated: "😍",
  fatigued: "😪",
  fleeing: "🏃",
  frightened: "😱",
  grabbed: "✊",
  immobilized: "⛓️",
  "off-guard": "🫣",
  paralyzed: "🧊",
  "persistent-damage": "🔥",
  petrified: "🗿",
  prone: "🛌",
  quickened: "⚡",
  restrained: "🪢",
  sickened: "🤢",
  slowed: "🐌",
  stunned: "💫",
  stupefied: "🌀",
  unconscious: "😴",
  wounded: "🩹",
});

/**
 * PF2e Remastered valued conditions. `dying`/`wounded`/`doomed` cap at their
 * book maximum; the other valued conditions in the sheet's 30-condition list
 * use the common 1..4 practice from the Remastered condition entries.
 * Conditions not present in this map are boolean: LMB does nothing, RMB
 * removes them from the token.
 */
export const CONDITION_MAX_STAGES = Object.freeze({
  clumsy: 4,
  doomed: 3,
  drained: 4,
  dying: 4,
  enfeebled: 4,
  frightened: 4,
  sickened: 4,
  slowed: 3,
  stupefied: 4,
  wounded: 3,
});

export function conditionIcon(value) {
  return CONDITION_ICONS[value] || "◉";
}

/** Highest stage supported by a condition, or 0 for boolean conditions. */
export function conditionMaxStage(value) {
  const stage = CONDITION_MAX_STAGES[value];
  return Number.isFinite(stage) ? stage : 0;
}

export function isStagedCondition(value) {
  return conditionMaxStage(value) > 0;
}

/**
 * Normalize one persisted condition row. The sheet stores the numeric value in
 * `value2` (Foundry's actor system uses `value.value`); both shapes are read so
 * imported actors and hand-authored conditions behave identically.
 */
export function conditionStage(entry) {
  if (!entry || typeof entry !== "object") {
    return 0;
  }
  const raw =
    entry.value2 !== undefined
      ? entry.value2
      : entry.value !== null && typeof entry.value === "object"
        ? entry.value.value2 !== undefined
          ? entry.value.value2
          : entry.value.value
        : 0;
  const value = Math.trunc(Number(raw));
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Value used when a condition is first applied from the HUD. */
export function initialConditionStage(value) {
  return isStagedCondition(value) ? 1 : 0;
}
