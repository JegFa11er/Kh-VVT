import { useEffect, useState } from "react";

import CompendiumBrowser from "./CompendiumBrowser.jsx";
import Hotbar from "./Hotbar.jsx";
import PlayerList from "./PlayerList.jsx";
import ToastHost from "./ToastHost.jsx";
import Toolbar from "./Toolbar.jsx";
import RightSidebar from "./sidebar/RightSidebar.jsx";
import { useStore } from "./StoreContext.jsx";

/**
 * Root UI component rendered on top of the PixiJS canvas.
 *
 * The surrounding `#ui-root` element is a pointer-events: none overlay; every
 * interactive surface (top bar, windows) opts back in through CSS. This keeps
 * the map fully usable while UI is visible.
 */
export default function App() {
  const { activeRole, connected, combatState } = useStore();
  const [windows, setWindows] = useState({ compendium: true });
  const [compendiumTab, setCompendiumTab] = useState("spells");

  const toggleWindow = (id) => {
    setWindows((current) => ({ ...current, [id]: !current[id] }));
  };

  const openCompendium = (tabId) => {
    if (typeof tabId === "string" && tabId !== "") {
      setCompendiumTab(tabId);
    }
    setWindows((current) => ({ ...current, compendium: true }));
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setWindows((current) =>
          current.compendium ? { ...current, compendium: false } : current,
        );
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const encounter = combatState && combatState.encounter;
  const round = encounter && encounter.round ? " · раунд " + encounter.round : "";
  const activeCombatant =
    encounter && encounter.activeCombatantId
      ? encounter.activeCombatantId
      : null;

  return (
    <div className="ui-layer">
      <Toolbar />
      <PlayerList />
      <Hotbar />
      <ToastHost />
      <RightSidebar onOpenCompendium={openCompendium} />

      <div className="ui-topbar">
        <div className="ui-topbar__brand">
          <span className="ui-topbar__logo" aria-hidden="true">
            ⚔
          </span>
          PF2e Web
        </div>

        <div className="ui-topbar__actions">
          <button
            type="button"
            className={
              "ui-button ui-button--toggle" +
              (windows.compendium ? " ui-button--active" : "")
            }
            onClick={() => toggleWindow("compendium")}
          >
            📖 Библиотека
          </button>
        </div>

        <div className="ui-topbar__status">
          <span
            className={
              "ui-status-dot" + (connected ? " ui-status-dot--online" : "")
            }
            title={connected ? "WebSocket подключён" : "Нет соединения"}
          />
          <span className="ui-role-badge">
            {activeRole === "gm" ? "GM" : "Player"}
          </span>
          <span className="ui-topbar__combat">
            {combatState
              ? "Бой" + round + (activeCombatant ? " · " + activeCombatant : "")
              : "Нет активного боя"}
          </span>
        </div>
      </div>

      {windows.compendium ? (
        <CompendiumBrowser
          initialTabId={compendiumTab}
          onClose={() =>
            setWindows((current) => ({ ...current, compendium: false }))
          }
        />
      ) : null}
    </div>
  );
}
