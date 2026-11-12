import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { SPELL_RANKS, iwrLabel, signed } from "./character-data.js";
import { setPreparedSpellDragData } from "./spell-drag.js";

function spellRankValue(spell) {
  const raw = spell && spell.rank !== undefined ? spell.rank : spell && spell.level;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(10, Math.trunc(value))) : 1;
}

export function spellRankLabel(rank) {
  if (rank === 0 || rank === "cantrip") {
    return "Чары";
  }
  return (
    SPELL_RANKS.find((entry) => entry.value === String(rank))?.label ||
    rank + "-й круг"
  );
}

function plainDescription(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function groupSpells(spells) {
  const map = new Map();
  for (const spell of Array.isArray(spells) ? spells : []) {
    const rank = spellRankValue(spell);
    if (!map.has(rank)) {
      map.set(rank, []);
    }
    map.get(rank).push(spell);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * Step 5.9: a Foundry-style preparation book window.
 *
 * Unlike a modal dialog it has no full-screen backdrop: the character sheet
 * stays interactive behind it, so the player can drag a spell straight from the
 * book onto an empty rank slot. The window itself is the only pointer target.
 */
export default function SpellPreparationModal({
  entry,
  spells = [],
  maxRank = 10,
  level = 1,
  editable = false,
  onClose,
}) {
  const [expandedId, setExpandedId] = useState("");
  const groups = useMemo(() => groupSpells(spells), [spells]);
  const entryName = (entry && entry.name) || "Набор заклинаний";

  return createPortal(
    <section
      className="pf2e-prep-window"
      role="dialog"
      aria-label={"Книга подготовки: " + entryName}
    >
      <header className="pf2e-prep-window__header">
        <span className="pf2e-prep-window__icon" aria-hidden="true">
          📖
        </span>
        <div className="pf2e-prep-window__title">
          <h2>Книга подготовки</h2>
          <span>{entryName}</span>
        </div>
        <button
          type="button"
          className="ui-window__close"
          title="Закрыть книгу подготовки"
          aria-label="Закрыть книгу подготовки"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <p className="pf2e-prep-window__hint">
        {editable
          ? "Перетащите заклинание в пустую ячейку соответствующего ранга на листе персонажа."
          : "Только просмотр: редактирование недоступно."}{" "}
        Максимальный ранг для уровня {level}: {maxRank}.
      </p>

      <div className="pf2e-prep-window__body">
        {groups.length === 0 ? (
          <p className="pf2e-empty pf2e-empty--small">
            В этот набор ещё не добавлено ни одного заклинания. Перетащите
            заклинание из компендиума на набор.
          </p>
        ) : (
          groups.map(([rank, rankSpells]) => (
            <section className="pf2e-prep-rank" key={rank}>
              <header className="pf2e-prep-rank__header">
                <span>{spellRankLabel(rank)}</span>
                <span className="pf2e-prep-rank__count">
                  {rankSpells.length} шт.
                </span>
              </header>
              <ol className="pf2e-prep-list">
                {rankSpells.map((spell) => {
                  const expanded = expandedId === spell.id;
                  const attack =
                    spell.spellAttack !== null && spell.spellAttack !== undefined
                      ? spell.spellAttack
                      : null;
                  return (
                    <li
                      className={
                        "pf2e-prep-spell" +
                        (editable ? " pf2e-prep-spell--draggable" : "")
                      }
                      key={spell.id}
                      draggable={editable}
                      onDragStart={
                        editable
                          ? (event) =>
                              setPreparedSpellDragData(event, {
                                spellId: spell.id,
                                entryId: entry?.id || "",
                                rank,
                                name: spell.name,
                              })
                          : undefined
                      }
                    >
                      <span className="pf2e-prep-spell__img" aria-hidden="true">
                        {spell.img ? (
                          <img src={spell.img} alt="" loading="lazy" />
                        ) : (
                          "✦"
                        )}
                      </span>
                      <button
                        type="button"
                        className="pf2e-prep-spell__name"
                        title="Показать или скрыть описание"
                        aria-expanded={expanded}
                        onClick={() =>
                          setExpandedId((current) =>
                            current === spell.id ? "" : spell.id,
                          )
                        }
                      >
                        {spell.name}
                      </button>
                      <span className="pf2e-prep-spell__meta">
                        {spell.damageType
                          ? iwrLabel(spell.damageType)
                          : attack !== null
                            ? "атака " + signed(attack)
                            : "ранг " + rank}
                      </span>
                      <span className="pf2e-prep-spell__grip" aria-hidden="true">
                        ⠿
                      </span>
                      {expanded ? (
                        <p className="pf2e-prep-spell__description">
                          {plainDescription(spell.description) ||
                            "Описание отсутствует."}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))
        )}
      </div>
    </section>,
    document.body,
  );
}
