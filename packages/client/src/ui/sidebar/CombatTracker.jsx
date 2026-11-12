import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "../i18n.js";
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
 *
 * Step 6.8: every label, empty state and error message is translated through
 * `t()`, so the tracker switches to English together with the rest of the UI.
 */
export default function CombatTracker() {
  const { networkClient, combatState, activeRole } = useStore();
  const { t, language } = useTranslation();
  const [error, setError] = useState("");
  const isGM = activeRole === "gm";

  useEffect(() => {
    if (!networkClient || typeof networkClient.onActionError !== "function") {
      return undefined;
    }
    return networkClient.onActionError((payload) => {
      if (payload && payload.reason) {
        const messages = {
          "permission-denied": t(
            "PF2E.Platform.Combat.ErrorPermission",
            "Insufficient permissions.",
          ),
          "encounter-not-started": t(
            "PF2E.Platform.Combat.ErrorNoCombatants",
            "No combatants to roll initiative for.",
          ),
          "not-your-turn": t(
            "PF2E.Platform.Combat.ErrorNotYourTurn",
            "It is not your turn.",
          ),
          "invalid-target": t(
            "PF2E.Platform.Combat.ErrorInvalidTarget",
            "A valid target is required.",
          ),
        };
        setError(messages[payload.reason] || payload.reason);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkClient, language]);

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
      setError(
        t("PF2E.Platform.Combat.ErrorNoConnection", "No connection to the server."),
      );
      return;
    }
    setError("");
    const result = networkClient[method](...args);
    if (result && typeof result.catch === "function") {
      result.catch((callError) => {
        setError(
          callError.message ||
            t("PF2E.Platform.Combat.ErrorAction", "Failed to perform the action."),
        );
      });
    }
  };

  const createEncounter = () => {
    if (!networkClient) {
      setError(
        t("PF2E.Platform.Combat.ErrorNoConnection", "No connection to the server."),
      );
      return;
    }
    setError("");
    networkClient.sendIntent("roll-initiative").catch((callError) => {
      setError(
        callError.message ||
          t("PF2E.Platform.Combat.ErrorCreate", "Failed to create the encounter."),
      );
    });
  };

  return (
    <div className="combat-tracker">
      <div className="directory-panel__header">
        <span className="directory-panel__title">
          <span aria-hidden="true">⚔️</span>{" "}
          {t("PF2E.Platform.Combat.Title", "Combat")}
        </span>
        {encounter && status === "running" ? (
          <span className="combat-tracker__round">
            {t("PF2E.Platform.Combat.Round", "Round")} {encounter.round || 1}
          </span>
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
            {t(
              "PF2E.Platform.Combat.NoEncounter",
              "There is no active encounter. Create one to roll initiative and track turns.",
            )}
          </p>
          <button
            type="button"
            className="ui-button ui-button--primary"
            onClick={createEncounter}
          >
            {t("PF2E.Platform.Combat.Create", "+ Create Encounter")}
          </button>
        </div>
      ) : (
        <>
          <div className="combat-tracker__summary">
            <span>
              {status === "running"
                ? t("PF2E.Platform.Combat.Running", "Encounter in progress")
                : encounter.over
                  ? t("PF2E.Platform.Combat.Finished", "Encounter finished")
                  : t("PF2E.Platform.Combat.Rolling", "Initiative not rolled")}
            </span>
            <span className="combat-tracker__count">
              {orderedCombatants.length}{" "}
              {t("PF2E.Platform.Combat.Participants", "combatants")}
            </span>
          </div>

          <ol className="combat-tracker__list">
            {orderedCombatants.length === 0 ? (
              <li className="combat-tracker__empty-row">
                {t(
                  "PF2E.Platform.Combat.Empty",
                  "No combatants in this encounter yet.",
                )}
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
                          ? t("PF2E.Platform.Combat.Party", "Party")
                          : t("PF2E.Platform.Combat.Enemy", "Enemy")}
                        {" · "}
                        {combatant.currentHP}/{combatant.maxHP} HP
                      </span>
                    </span>
                    {active ? (
                      <span className="combat-tracker__active-badge">
                        {t("PF2E.Platform.Combat.Turn", "Turn")}
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
                    ? t("PF2E.Platform.Combat.Start", "Start Encounter")
                    : t(
                        "PF2E.Platform.Combat.StartGmOnly",
                        "Only the GM can start the encounter",
                      )
                }
                onClick={() => call("startEncounter")}
              >
                ⚔️ {t("PF2E.Platform.Combat.Start", "Start Encounter")}
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
                {t("PF2E.Platform.Combat.Previous", "◀ Previous")}
              </button>
              <button
                type="button"
                className="ui-button combat-tracker__finish"
                disabled={!isGM}
                onClick={() => call("finishEncounter")}
              >
                {t("PF2E.Platform.Combat.Finish", "■ Finish")}
              </button>
              <button
                type="button"
                className="ui-button"
                disabled={!isGM}
                onClick={() => call("nextTurn")}
              >
                {t("PF2E.Platform.Combat.Next", "Next ▶")}
              </button>
              <button
                type="button"
                className="ui-button ui-button--primary"
                disabled={!isGM}
                onClick={() => call("nextRound")}
              >
                {t("PF2E.Platform.Combat.NextRound", "Next Round")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
