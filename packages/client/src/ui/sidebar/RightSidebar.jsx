import { useState } from "react";

import ChatPanel from "../ChatPanel.jsx";
import JournalSheet from "../windows/JournalSheet.jsx";
import ChatToasts from "./ChatToasts.jsx";
import CombatTracker from "./CombatTracker.jsx";
import DirectoryPanel from "./DirectoryPanel.jsx";
import LibraryPanel from "./LibraryPanel.jsx";
import SettingsPanel from "./SettingsPanel.jsx";

const TABS = [
  { id: "chat", icon: "💬", label: "Чат" },
  { id: "combat", icon: "⚔️", label: "Столкновения" },
  { id: "scenes", icon: "🗺️", label: "Сцены" },
  { id: "actors", icon: "👤", label: "Актёры" },
  { id: "items", icon: "💼", label: "Предметы" },
  { id: "journals", icon: "📖", label: "Журналы" },
  { id: "libraries", icon: "📚", label: "Библиотеки" },
  { id: "settings", icon: "⚙️", label: "Настройки" },
];

/**
 * Right-hand Foundry sidebar (Step 4.5).
 *
 * The narrow icon-bar stays visible when the panel is collapsed; the 320 px
 * tab body is hidden entirely. Chat toasts are anchored above the collapse
 * control and remain visible over every other window.
 */
export default function RightSidebar({ onOpenCompendium }) {
  const [activeTab, setActiveTab] = useState("chat");
  const [collapsed, setCollapsed] = useState(false);
  const [openJournalId, setOpenJournalId] = useState(null);

  const selectTab = (tabId) => {
    setActiveTab(tabId);
    setCollapsed(false);
  };

  const renderPanel = () => {
    switch (activeTab) {
      case "chat":
        return <ChatPanel embedded />;
      case "combat":
        return <CombatTracker />;
      case "scenes":
        return <DirectoryPanel kind="scenes" />;
      case "actors":
        return <DirectoryPanel kind="actors" />;
      case "items":
        return <DirectoryPanel kind="items" />;
      case "journals":
        return (
          <DirectoryPanel kind="journals" onOpenJournal={setOpenJournalId} />
        );
      case "libraries":
        return <LibraryPanel onOpenCompendium={onOpenCompendium} />;
      case "settings":
        return <SettingsPanel />;
      default:
        return null;
    }
  };

  return (
    <>
      <aside
        className={
          "right-sidebar" + (collapsed ? " right-sidebar--collapsed" : "")
        }
        aria-label="Правая панель"
      >
        {!collapsed ? (
          <div className="right-sidebar__panel">{renderPanel()}</div>
        ) : null}

        <nav className="right-sidebar__iconbar" aria-label="Навигация">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={
                "right-sidebar__icon-button" +
                (!collapsed && activeTab === tab.id
                  ? " right-sidebar__icon-button--active"
                  : "")
              }
              title={tab.label}
              aria-label={tab.label}
              aria-pressed={!collapsed && activeTab === tab.id}
              onClick={() => selectTab(tab.id)}
            >
              <span aria-hidden="true">{tab.icon}</span>
            </button>
          ))}

          <div className="right-sidebar__spacer" />

          <button
            type="button"
            className="right-sidebar__icon-button right-sidebar__collapse"
            title={collapsed ? "Развернуть панель" : "Свернуть панель"}
            aria-label={collapsed ? "Развернуть панель" : "Свернуть панель"}
            onClick={() => setCollapsed((current) => !current)}
          >
            <span aria-hidden="true">{collapsed ? "◀" : "▶"}</span>
          </button>
        </nav>
      </aside>

      <ChatToasts
        active={!collapsed && activeTab === "chat"}
        collapsed={collapsed}
        onOpenChat={() => selectTab("chat")}
      />

      {openJournalId ? (
        <JournalSheet
          journalId={openJournalId}
          onClose={() => setOpenJournalId(null)}
        />
      ) : null}
    </>
  );
}
