import { useEffect, useMemo, useState } from "react";

import { useStore } from "../StoreContext.jsx";

function initiativeSummary(combatant) {
  if (combatant.initiative === null || combatant.initiative === undefined) {
    return "—";
  }
  return String(combatant.initiative);
}

/**
 * Combat Tracker tab (Step 4.5).
 *
 * The authoritative encounter clock comes from `room:state-update` snapshots:
 * `encounter.round`, `encounter.activeCombatantId`, `encounter.started` and
 * `encounter.order`. All controls are GM-only on the server; the buttons are
 * disabled for players so the UI mirrors the permission model.
 */
export default function CombatTracker() {
  const { networkClient, combatState, activeRole } = useStore();
  const [error, setError] = useState("");
  const isGM = activeRole === "gm";

  useEffect(() => {
    if (!networkClient || typeof networkClient.onActionError !== "function") {
      return undefined;
    }
    return networkClient.onActionError((payload) => {
      if (payload && payload.reason) {
        const messages = {
          "permission-denied": "Недостаточно прав.",
          "encounter-not-started": "Нет бойцов для броска инициативы.",
          "not-your-turn": "Сейчас не ваш ход.",
          "invalid-target": "Нужна корректная цель.",
        };
        setError(messages[payload.reason] || payload.reason);
      }
    });
  }, [networkClient]);

  const combatants = Array.isArray(combatState && combatState.combatants)
    ? combatState.combatants
    : [];

  // `joined`/`session:snapshot` use a flat shape (round/status/combatants)
  // before the first action pipeline snapshot. Normalise it so the tracker works
  // immediately after combatants are registered.
  const encounter = useMemo(() => {
    if (!combatState) {
      return null;
    }
    if (combatState.encounter) {
      return combatState.encounter;
    }
    if (combatants.length === 0) {
      return null;
    }
    const status = combatState.status;
    return {
      round: combatState.round || 0,
      activeCombatantId: combatState.activeCombatantId || null,
      started: status === "running" || status === "finished",
      over: status === "finished",
      order: combatants.map((combatant) => combatant.id),
    };
  }, [combatState, combatants]);

  const orderedCombatants = useMemo(() => {
    if (!encounter) {
      return combatants;
    }
    const byId = new Map(combatants.map((combatant) => [combatant.id, combatant]));
    const order = Array.isArray(encounter.order) ? encounter.order : [];
    const ordered = order
      .map((id) => byId.get(id))
      .filter((combatant) => Boolean(combatant));
    for (const combatant of combatants) {
      if (!ordered.some((entry) => entry.id === combatant.id)) {
        ordered.push(combatant);
      }
    }
    return ordered;
  }, [combatants, encounter]);

  const status = encounter
    ? encounter.started && !encounter.over
      ? "running"
      : "rolling"
    : null;

  const call = (method, ...args) => {
    if (!networkClient || typeof networkClient[method] !== "function") {
      setError("Нет соединения с сервером.");
      return;
    }
    setError("");
    const result = networkClient[method](...args);
    if (result && typeof result.catch === "function") {
      result.catch((callError) => {
        setError(callError.message || "Не удалось выполнить действие.");
      });
    }
  };

  const createEncounter = () => {
    if (!networkClient) {
      setError("Нет соединения с сервером.");
      return;
    }
    setError("");
    networkClient.sendIntent("roll-initiative").catch((callError) => {
      setError(callError.message || "Не удалось создать бой.");
    });
  };

  return (
    <div className="combat-tracker">
      <div className="directory-panel__header">
        <span className="directory-panel__title">
          <span aria-hidden="true">⚔️</span> Столкновения
        </span>
        {encounter && status === "running" ? (
          <span className="combat-tracker__round">Раунд {encounter.round || 1}</span>
        ) : null}
      </div>

      {error ? (
        <div className="directory-panel__error" role="alert">
          {error}
        </div>
      ) : null}

      {!encounter ? (
        <div className="combat-tracker__empty">
          <div className="combat-tracker__empty-icon" aria-hidden="true">
            🛡️
          </div>
          <p>
            Активного столкновения нет. Создайте бой, чтобы бросить инициативу
            и отслеживать ходы.
          </p>
          <button
            type="button"
            className="ui-button ui-button--primary"
            onClick={createEncounter}
          >
            + Создать бой
          </button>
        </div>
      ) : (
        <>
          <div className="combat-tracker__summary">
            <span>
              {status === "running"
                ? "Столкновение идёт"
                : encounter.over
                  ? "Столкновение завершено"
                  : "Инициатива не брошена"}
            </span>
            <span className="combat-tracker__count">
              {orderedCombatants.length} участн.
            </span>
          </div>

          <ol className="combat-tracker__list">
            {orderedCombatants.length === 0 ? (
              <li className="combat-tracker__empty-row">
                В столкновении пока нет бойцов.
              </li>
            ) : (
              orderedCombatants.map((combatant) => {
                const active =
                  status === "running" &&
                  encounter.activeCombatantId === combatant.id;
                return (
                  <li
                    key={combatant.id}
                    className={
                      "combat-tracker__row" +
                      (active ? " combat-tracker__row--active" : "")
                    }
                  >
                    <span className="combat-tracker__initiative">
                      {initiativeSummary(combatant)}
                    </span>
                    <span className="combat-tracker__body">
                      <span className="combat-tracker__name">
                        {combatant.name}
                      </span>
                      <span className="combat-tracker__meta">
                        {combatant.alliance === "party" ||
                        combatant.alliance === "player"
                          ? "Группа"
                          : "Противник"}
                        {" · "}
                        {combatant.currentHP}/{combatant.maxHP} HP
                      </span>
                    </span>
                    {active ? (
                      <span className="combat-tracker__active-badge">
                        Ход
                      </span>
                    ) : null}
                  </li>
                );
              })
            )}
          </ol>

          {status === "rolling" ? (
            <div className="combat-tracker__footer">
              <button
                type="button"
                className="ui-button ui-button--primary combat-tracker__start"
                disabled={!isGM}
                title={
                  isGM
                    ? "Начать столкновение"
                    : "Начать столкновение может только мастер"
                }
                onClick={() => call("startEncounter")}
              >
                ⚔️ Начать столкновение
              </button>
            </div>
          ) : (
            <div className="combat-tracker__controls">
              <button
                type="button"
                className="ui-button"
                disabled={!isGM}
                onClick={() => call("previousTurn")}
              >
                ◀ Предыдущий
              </button>
              <button
                type="button"
                className="ui-button combat-tracker__finish"
                disabled={!isGM}
                onClick={() => call("finishEncounter")}
              >
                ■ Завершить
              </button>
              <button
                type="button"
                className="ui-button"
                disabled={!isGM}
                onClick={() => call("nextTurn")}
              >
                Следующий ▶
              </button>
              <button
                type="button"
                className="ui-button ui-button--primary"
                disabled={!isGM}
                onClick={() => call("nextRound")}
              >
                Следующий раунд
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
