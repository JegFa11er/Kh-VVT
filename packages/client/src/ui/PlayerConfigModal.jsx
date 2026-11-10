import { useEffect, useState } from "react";

import { useStore } from "./StoreContext.jsx";

const FALLBACK_COLOR = "#f2c94c";
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeColor(value) {
  const color = typeof value === "string" ? value.trim() : "";
  return HEX_COLOR.test(color) ? color : FALLBACK_COLOR;
}

/**
 * "Настройка участника" dialog (Step 4.3).
 *
 * Edits the profile the server keeps for the local client. The character list
 * is temporarily sourced from the live combat snapshot so a player can link an
 * actor that is already on the scene.
 */
export default function PlayerConfigModal({ user, onClose }) {
  const { networkClient, combatState, directories } = useStore();
  const [name, setName] = useState(user.name || "");
  const [color, setColor] = useState(normalizeColor(user.color));
  const [pronouns, setPronouns] = useState(user.pronouns || "");
  const [characterId, setCharacterId] = useState(user.characterId || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const combatants =
    combatState && Array.isArray(combatState.combatants)
      ? combatState.combatants
      : [];
  // Step 4.8: player-character sheets are owned by linking a directory actor.
  // Combatants remain selectable for battle-token identity binding.
  const actorEntries = (
    directories && directories.actors && Array.isArray(directories.actors.entries)
      ? directories.actors.entries
      : []
  ).filter((entry) => entry.actorType !== "npc");
  const actorIds = new Set(actorEntries.map((entry) => entry.id));
  // `input[type=color]` only accepts a full hex value; keep the text field
  // free-form so the user can type a hex code directly.
  const pickerColor = HEX_COLOR.test(color) ? color : FALLBACK_COLOR;

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!networkClient) {
      setError("Нет соединения с сервером.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await networkClient.updateProfile({
        name: name.trim() || user.name || "Игрок",
        color: normalizeColor(color),
        pronouns: pronouns.trim(),
        characterId: characterId || null,
      });
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : String(submitError),
      );
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="modal-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-config-title"
      >
        <header className="modal-window__header">
          <h2 className="modal-window__title" id="player-config-title">
            <span aria-hidden="true">👤</span> Настройка участника
          </h2>
          <button
            type="button"
            className="ui-window__close"
            onClick={onClose}
            title="Закрыть (Esc)"
            aria-label="Закрыть настройку участника"
          >
            ×
          </button>
        </header>

        <form className="modal-window__body" onSubmit={handleSubmit}>
          <label className="modal-field">
            <span className="modal-field__label">Имя игрока</span>
            <input
              className="ui-input"
              type="text"
              value={name}
              maxLength={80}
              placeholder="Игрок"
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <div className="modal-field">
            <span className="modal-field__label">Цвет игрока</span>
            <div className="modal-color-row">
              <input
                className="modal-color-picker"
                type="color"
                value={pickerColor}
                aria-label="Выбрать цвет игрока"
                onChange={(event) => setColor(event.target.value)}
              />
              <input
                className="ui-input modal-color-hex"
                type="text"
                value={color}
                maxLength={7}
                spellCheck={false}
                placeholder="#f2c94c"
                aria-label="Цвет игрока в формате HEX"
                onChange={(event) => setColor(event.target.value)}
                onBlur={() => setColor((current) => normalizeColor(current))}
              />
            </div>
          </div>

          <label className="modal-field">
            <span className="modal-field__label">Местоимения игрока</span>
            <input
              className="ui-input"
              type="text"
              value={pronouns}
              maxLength={60}
              placeholder="она/её, он/его…"
              onChange={(event) => setPronouns(event.target.value)}
            />
          </label>

          <label className="modal-field">
            <span className="modal-field__label">Персонаж игрока</span>
            <select
              className="ui-input"
              value={characterId}
              onChange={(event) => setCharacterId(event.target.value)}
            >
              <option value="">— Без персонажа —</option>
              {actorEntries.length > 0 ? (
                <optgroup label="Листы персонажей">
                  {actorEntries.map((actor) => (
                    <option key={actor.id} value={actor.id}>
                      {actor.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {combatants.filter((combatant) => !actorIds.has(combatant.id)).length > 0 ? (
                <optgroup label="Токены боя">
                  {combatants
                    .filter((combatant) => !actorIds.has(combatant.id))
                    .map((combatant) => (
                      <option key={combatant.id} value={combatant.id}>
                        {combatant.name || combatant.id}
                      </option>
                    ))}
                </optgroup>
              ) : null}
            </select>
          </label>

          {error ? (
            <div className="modal-error" role="alert">
              {error}
            </div>
          ) : null}

          <footer className="modal-window__footer">
            <button type="button" className="ui-button" onClick={onClose}>
              Отмена
            </button>
            <button
              type="submit"
              className="ui-button ui-button--primary"
              disabled={saving}
            >
              {saving ? "Сохранение…" : "Сохранить настройки"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
