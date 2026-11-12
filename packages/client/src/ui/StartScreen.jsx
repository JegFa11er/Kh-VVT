import { useCallback, useEffect, useState } from "react";

const ROLE_OPTIONS = [
  { value: "player", label: "Игрок", hint: "Управляет своими персонажами" },
  { value: "gm", label: "Мастер (GM)", hint: "Полный доступ ко всем актёрам" },
];

function roleLabel(role) {
  return role === "gm" ? "Мастер" : "Игрок";
}

function initials(name) {
  const clean = String(name || "").trim();
  if (clean === "") {
    return "?";
  }
  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

/**
 * Pre-game lobby (Phase 6.2).
 *
 * The lobby is rendered before PixiJS and the main React UI mount, and it only
 * talks HTTP (`/api/lobby`). The WebSocket connection is deliberately opened
 * after the player chooses a profile, so `session.json` owns the account list
 * and an F5 reload returns to this screen.
 */
export default function StartScreen({
  sessionId = "default",
  onLogin,
  defaultRole = "player",
  preferredUserId = null,
}) {
  const [users, setUsers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState(defaultRole === "gm" ? "gm" : "player");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        "/api/lobby?sessionId=" + encodeURIComponent(sessionId),
        { headers: { Accept: "application/json" } },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          (payload && (payload.message || payload.error)) ||
            "HTTP " + response.status,
        );
      }
      const nextUsers = payload && Array.isArray(payload.users) ? payload.users : [];
      setUsers(nextUsers);
      setSelectedId((current) => {
        if (current && nextUsers.some((user) => user.id === current)) {
          return current;
        }
        if (
          preferredUserId &&
          nextUsers.some((user) => user.id === preferredUserId)
        ) {
          return preferredUserId;
        }
        return nextUsers[0]?.id || null;
      });
    } catch (loadError) {
      setError(
        "Не удалось загрузить профили комнаты: " +
          (loadError.message || "неизвестная ошибка"),
      );
    } finally {
      setLoading(false);
    }
  }, [sessionId, preferredUserId]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const createProfile = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "" || creating) {
      return;
    }
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/lobby/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ sessionId, name: trimmed, role }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          (payload && (payload.message || payload.error)) ||
            "HTTP " + response.status,
        );
      }
      const nextUsers =
        payload && Array.isArray(payload.users) ? payload.users : [];
      setUsers(nextUsers);
      const created = payload && payload.user ? payload.user : null;
      if (created && created.id) {
        setSelectedId(created.id);
      }
      setName("");
    } catch (createError) {
      setError(
        "Не удалось создать профиль: " +
          (createError.message || "неизвестная ошибка"),
      );
    } finally {
      setCreating(false);
    }
  };

  const selected = users.find((user) => user.id === selectedId) || null;

  const enterGame = () => {
    if (!selected || typeof onLogin !== "function") {
      return;
    }
    onLogin(selected);
  };

  return (
    <div className="start-screen">
      <div className="start-screen__backdrop" aria-hidden="true" />
      <div className="start-screen__frame">
        <header className="start-screen__header">
          <div className="start-screen__brand">
            <span className="start-screen__logo" aria-hidden="true">
              ⚔
            </span>
            <div>
              <h1 className="start-screen__title">PF2e Web Engine</h1>
              <p className="start-screen__subtitle">
                Тактический стол Pathfinder 2e Remastered · комната{" "}
                <strong>{sessionId}</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            className="ui-button start-screen__refresh"
            onClick={loadProfiles}
            disabled={loading}
            title="Перечитать профили из session.json"
          >
            ⟳ Обновить
          </button>
        </header>

        <div className="start-screen__grid">
          <section className="start-screen__panel" aria-label="Профили комнаты">
            <div className="start-screen__panel-head">
              <h2>Кто садится за стол?</h2>
              <span className="start-screen__count">{users.length}</span>
            </div>

            {loading ? (
              <div className="start-screen__empty">Загрузка профилей…</div>
            ) : users.length === 0 ? (
              <div className="start-screen__empty">
                В комнате пока нет профилей. Создайте первый аккаунт справа —
                он сохранится в <code>session.json</code>.
              </div>
            ) : (
              <ul className="start-screen__profiles">
                {users.map((user) => {
                  const isSelected = user.id === selectedId;
                  return (
                    <li key={user.id}>
                      <button
                        type="button"
                        className={
                          "start-screen__profile" +
                          (isSelected ? " start-screen__profile--selected" : "")
                        }
                        onClick={() => setSelectedId(user.id)}
                        onDoubleClick={() => {
                          setSelectedId(user.id);
                          if (typeof onLogin === "function") {
                            onLogin(user);
                          }
                        }}
                        aria-pressed={isSelected}
                      >
                        <span
                          className="start-screen__avatar"
                          style={{ backgroundColor: user.color || "#3b9eff" }}
                          aria-hidden="true"
                        >
                          {initials(user.name)}
                        </span>
                        <span className="start-screen__profile-body">
                          <span className="start-screen__profile-name">
                            {user.name}
                          </span>
                          <span className="start-screen__profile-meta">
                            <span
                              className={
                                "start-screen__role" +
                                (user.role === "gm"
                                  ? " start-screen__role--gm"
                                  : "")
                              }
                            >
                              {roleLabel(user.role)}
                            </span>
                            {user.characterId ? (
                              <span className="start-screen__claimed">
                                персонаж привязан
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <span className="start-screen__check" aria-hidden="true">
                          {isSelected ? "✓" : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="start-screen__panel" aria-label="Создать профиль">
            <div className="start-screen__panel-head">
              <h2>Новый профиль</h2>
            </div>
            <form className="start-screen__form" onSubmit={createProfile}>
              <label className="modal-field">
                <span className="modal-field__label">Имя игрока</span>
                <input
                  className="ui-input"
                  value={name}
                  maxLength={80}
                  autoFocus
                  placeholder="Например, Амелия"
                  onChange={(event) => setName(event.target.value)}
                />
              </label>

              <fieldset className="start-screen__roles">
                <legend className="modal-field__label">Роль</legend>
                {ROLE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={
                      "start-screen__role-option" +
                      (role === option.value
                        ? " start-screen__role-option--active"
                        : "")
                    }
                  >
                    <input
                      type="radio"
                      name="lobby-role"
                      value={option.value}
                      checked={role === option.value}
                      onChange={() => setRole(option.value)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <em>{option.hint}</em>
                    </span>
                  </label>
                ))}
              </fieldset>

              <button
                type="submit"
                className="ui-button ui-button--primary start-screen__create"
                disabled={name.trim() === "" || creating}
              >
                {creating ? "Создание…" : "＋ Создать профиль"}
              </button>
            </form>

            <div className="start-screen__enter">
              <div className="start-screen__enter-info">
                {selected ? (
                  <>
                    Выбран профиль <strong>{selected.name}</strong>{" "}
                    <span className="start-screen__muted">
                      ({roleLabel(selected.role)})
                    </span>
                  </>
                ) : (
                  <span className="start-screen__muted">
                    Выберите профиль из списка слева.
                  </span>
                )}
              </div>
              <button
                type="button"
                className="ui-button ui-button--primary start-screen__login"
                onClick={enterGame}
                disabled={!selected}
              >
                Войти →
              </button>
            </div>
          </section>
        </div>

        {error ? (
          <div className="start-screen__error" role="alert">
            {error}
          </div>
        ) : null}

        <footer className="start-screen__footer">
          <span>
            WebSocket откроется только после входа. Профили и владение актёрами
            хранятся на сервере.
          </span>
          <span className="start-screen__footer-rule">
            Владелец · Наблюдатель · Ограниченный · Нет доступа
          </span>
        </footer>
      </div>
    </div>
  );
}
