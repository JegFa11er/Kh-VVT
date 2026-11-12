import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  OWNERSHIP_LEVELS,
  OWNERSHIP_OPTIONS,
  normalizeOwnership,
} from "../permissions.js";
import { useStore } from "../StoreContext.jsx";
import { showToast } from "../toast.js";

function uniqueProfiles(profiles, users) {
  const byId = new Map();
  for (const profile of profiles || []) {
    if (profile && typeof profile.id === "string" && profile.id !== "") {
      byId.set(profile.id, profile);
    }
  }
  // Active members are always present in `profiles`, but keep this fallback so
  // the matrix never loses a real player during a reconnect race.
  for (const user of users || []) {
    if (user && typeof user.id === "string" && !byId.has(user.id)) {
      byId.set(user.id, user);
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    String(a.name || a.id).localeCompare(String(b.name || b.id), "ru", {
      sensitivity: "base",
    }),
  );
}

/**
 * Foundry-style ownership matrix (Phase 6.1).
 *
 * The dialog is only reachable for the GM. Every level is stored on the actor
 * as `actor.ownership = { default: 0, [userId]: 3 }` and saved through the
 * regular `room:update-actor` channel, whose server handler authoritatively
 * rejects permission changes from players.
 */
export default function OwnershipModal({ actor, onClose }) {
  const { networkClient, users, profiles, activeRole } = useStore();
  const baseOwnership = useMemo(
    () => normalizeOwnership(actor ? actor.ownership : null),
    [actor],
  );
  const [draft, setDraft] = useState(baseOwnership);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const players = useMemo(
    () => uniqueProfiles(profiles, users),
    [profiles, users],
  );

  if (!actor) {
    return null;
  }

  const setLevel = (userId, value) => {
    setDraft((current) => ({
      ...current,
      [userId]: Number(value),
    }));
  };

  const save = () => {
    if (activeRole !== "gm") {
      setError("Только Мастер может настраивать владение.");
      return;
    }
    if (!networkClient) {
      setError("Нет соединения с сервером.");
      return;
    }
    setSaving(true);
    setError("");
    networkClient
      .updateActor(actor.id, { ownership: draft })
      .then(() => {
        showToast("Права владения сохранены.", { kind: "info" });
        onClose();
      })
      .catch((saveError) => {
        setError(saveError.message || "Не удалось сохранить права.");
        setSaving(false);
      });
  };

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="modal-window ownership-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ownership-modal-title"
      >
        <header className="modal-window__header">
          <h2 className="modal-window__title" id="ownership-modal-title">
            🔐 Настройка владения
          </h2>
          <button
            type="button"
            className="ui-window__close"
            title="Закрыть"
            aria-label="Закрыть"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="modal-window__body ownership-modal__body">
          <p className="pf2e-muted ownership-modal__actor">
            Актёр: <strong>{actor.name}</strong>
          </p>

          <div className="ownership-modal__table" role="table" aria-label="Матрица владения">
            <div className="ownership-modal__row ownership-modal__row--head" role="row">
              <span role="columnheader">Профиль</span>
              <span role="columnheader">Уровень доступа</span>
            </div>

            <div className="ownership-modal__row ownership-modal__row--default" role="row">
              <span className="ownership-modal__who" role="cell">
                <span className="ownership-modal__icon" aria-hidden="true">
                  👥
                </span>
                <span>
                  <strong>Все игроки</strong>
                  <em>Значение по умолчанию для новых профилей</em>
                </span>
              </span>
              <select
                className="ui-input ownership-modal__select"
                value={draft.default}
                aria-label="Доступ по умолчанию"
                onChange={(event) =>
                  setLevel("default", event.target.value)
                }
              >
                {OWNERSHIP_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {players.length === 0 ? (
              <div className="ownership-modal__empty">
                В комнате ещё нет профилей игроков.
              </div>
            ) : (
              players.map((player) => (
                <div className="ownership-modal__row" role="row" key={player.id}>
                  <span className="ownership-modal__who" role="cell">
                    <span
                      className="ownership-modal__dot"
                      style={{ backgroundColor: player.color || "#3b9eff" }}
                      aria-hidden="true"
                    />
                    <span>
                      <strong>{player.name || player.id}</strong>
                      <em>
                        {player.role === "gm" ? "Мастер · всегда Владелец" : player.id}
                      </em>
                    </span>
                  </span>
                  <select
                    className="ui-input ownership-modal__select"
                    value={
                      player.role === "gm"
                        ? OWNERSHIP_LEVELS.OWNER
                        : draft[player.id] === undefined
                          ? draft.default
                          : draft[player.id]
                    }
                    aria-label={"Доступ для " + (player.name || player.id)}
                    disabled={player.role === "gm"}
                    title={
                      player.role === "gm"
                        ? "Мастер всегда имеет полный доступ"
                        : undefined
                    }
                    onChange={(event) => setLevel(player.id, event.target.value)}
                  >
                    {OWNERSHIP_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))
            )}
          </div>

          <p className="ownership-modal__hint">
            <span aria-hidden="true">ℹ️</span> Уровни:{" "}
            {OWNERSHIP_OPTIONS.map((option) => option.label).join(" · ")}.
            Наблюдатель открывает лист только для чтения, Владелец может
            редактировать. Мастер всегда имеет уровень{" "}
            {OWNERSHIP_LEVELS.OWNER} (Владелец).
          </p>

          {error ? (
            <div className="ownership-modal__error" role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="modal-window__footer">
          <button type="button" className="ui-button" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="ui-button ui-button--primary"
            onClick={save}
            disabled={saving || activeRole !== "gm"}
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
