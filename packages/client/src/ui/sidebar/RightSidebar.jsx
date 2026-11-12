import { useEffect, useState } from "react";

import { useTranslation } from "../i18n.js";
import ChatPanel from "../ChatPanel.jsx";
import ErrorBoundary from "../ErrorBoundary.jsx";
import CharacterSheet from "../windows/CharacterSheet.jsx";
import JournalSheet from "../windows/JournalSheet.jsx";
import { OPEN_ACTOR_SHEET_EVENT } from "../overlays/dialog-service.js";
import { canViewActor } from "../permissions.js";
import { useStore } from "../StoreContext.jsx";
import { showToast } from "../toast.js";
import ChatToasts from "./ChatToasts.jsx";
import CombatTracker from "./CombatTracker.jsx";
import DirectoryPanel from "./DirectoryPanel.jsx";
import FloatingChatInput from "./FloatingChatInput.jsx";
import LibraryPanel from "./LibraryPanel.jsx";
import SettingsPanel from "./SettingsPanel.jsx";

const TABS = [
  {
    id: "chat",
    icon: "💬",
    label: "Chat",
    labelKey: "PF2E.Platform.Sidebar.TabChat",
  },
  {
    id: "combat",
    icon: "⚔️",
    label: "Combat",
    labelKey: "PF2E.Platform.Sidebar.TabCombat",
  },
  {
    id: "scenes",
    icon: "🗺️",
    label: "Scenes",
    labelKey: "PF2E.Platform.Sidebar.TabScenes",
  },
  {
    id: "actors",
    icon: "👤",
    label: "Actors",
    labelKey: "PF2E.Platform.Sidebar.TabActors",
  },
  {
    id: "items",
    icon: "💼",
    label: "Items",
    labelKey: "PF2E.Platform.Sidebar.TabItems",
  },
  {
    id: "journals",
    icon: "📖",
    label: "Journals",
    labelKey: "PF2E.Platform.Sidebar.TabJournals",
  },
  {
    id: "libraries",
    icon: "📚",
    label: "Libraries",
    labelKey: "PF2E.Platform.Sidebar.TabLibraries",
  },
  {
    id: "settings",
    icon: "⚙️",
    label: "Settings",
    labelKey: "PF2E.Platform.Sidebar.TabSettings",
  },
];

/**
 * Right-hand Foundry sidebar (Step 4.5).
 *
 * The narrow icon-bar stays visible when the panel is collapsed; the 320 px
 * tab body is hidden entirely. Chat toasts are anchored above the collapse
 * control and remain visible over every other window.
 */
export default function RightSidebar({ onOpenCompendium }) {
  const { myUserId, activeRole, directories } = useStore();
  const { t, language } = useTranslation();
  const [activeTab, setActiveTab] = useState("chat");
  const [collapsed, setCollapsed] = useState(false);
  const [openJournalId, setOpenJournalId] = useState(null);
  const [openActorId, setOpenActorId] = useState(null);

  /**
   * Phase 6.1: opening a sheet is governed by the Foundry ownership matrix.
   * Level 0/1 shows a toast, level 2 opens a read-only sheet and level 3 (or
   * the GM) gets the editable sheet. The server enforces the same contract on
   * every write, so this check is the UX half only.
   */
  const openActor = (actorId) => {
    const actor =
      (directories?.actors?.entries || []).find((entry) => entry.id === actorId) ||
      null;
    if (!actor) {
      showToast(
        t(
          "PF2E.Platform.Sidebar.ActorNotSynced",
          "Actor is not synchronized yet.",
        ),
        { kind: "error" },
      );
      return;
    }
    if (!canViewActor(actor, myUserId, activeRole)) {
      showToast(t("PF2E.Platform.Sidebar.AccessDenied", "Access denied"), {
        kind: "error",
      });
      return;
    }
    setOpenActorId(actorId);
  };

  /**
   * Step 5.8: double-clicking a canvas token opens the linked character sheet.
   * The token layer emits this event so the sheet opens with the same
   * ownership checks as the directory panel.
   */
  useEffect(() => {
    const handleOpenSheet = (event) => {
      const actorId = event && event.detail ? event.detail.actorId : null;
      if (typeof actorId === "string" && actorId !== "") {
        openActor(actorId);
      }
    };
    window.addEventListener(OPEN_ACTOR_SHEET_EVENT, handleOpenSheet);
    return () =>
      window.removeEventListener(OPEN_ACTOR_SHEET_EVENT, handleOpenSheet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directories, myUserId, activeRole, language]);

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
        return <DirectoryPanel kind="actors" onOpenActor={openActor} />;
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
        aria-label={t("PF2E.Platform.Sidebar.RightPanel", "Right panel")}
      >
        {!collapsed ? (
          <div className="right-sidebar__panel">
            {/* A render error in one tab must never unmount the left HUD,
                the player list or the chat. `key` also gives every tab a
                fresh boundary, so switching away and back clears the error. */}
            <ErrorBoundary
              key={activeTab}
              fallback={t(
                "PF2E.Platform.Common.RenderError",
                "Ошибка рендера",
              )}
              retryLabel={t("PF2E.Platform.Common.Retry", "Повторить")}
            >
              {renderPanel()}
            </ErrorBoundary>
          </div>
        ) : null}

        <nav
          className="right-sidebar__iconbar"
          aria-label={t("PF2E.Platform.Sidebar.Navigation", "Navigation")}
        >
          {TABS.map((tab) => {
            const tabLabel = t(tab.labelKey, tab.label);
            return (
              <button
                key={tab.id}
                type="button"
                className={
                  "right-sidebar__icon-button" +
                  (!collapsed && activeTab === tab.id
                    ? " right-sidebar__icon-button--active"
                    : "")
                }
                title={tabLabel}
                aria-label={tabLabel}
                aria-pressed={!collapsed && activeTab === tab.id}
                onClick={() => selectTab(tab.id)}
              >
                <span aria-hidden="true">{tab.icon}</span>
              </button>
            );
          })}

          <div className="right-sidebar__spacer" />

          <button
            type="button"
            className="right-sidebar__icon-button right-sidebar__collapse"
            title={
              collapsed
                ? t("PF2E.Platform.Sidebar.Expand", "Expand panel")
                : t("PF2E.Platform.Sidebar.Collapse", "Collapse panel")
            }
            aria-label={
              collapsed
                ? t("PF2E.Platform.Sidebar.Expand", "Expand panel")
                : t("PF2E.Platform.Sidebar.Collapse", "Collapse panel")
            }
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

      {collapsed ? (
        <FloatingChatInput onExpand={() => selectTab("chat")} />
      ) : null}

      {openJournalId ? (
        <JournalSheet
          journalId={openJournalId}
          onClose={() => setOpenJournalId(null)}
        />
      ) : null}

      {openActorId ? (
        <CharacterSheet
          actorId={openActorId}
          onClose={() => setOpenActorId(null)}
        />
      ) : null}
    </>
  );
}
