import { useEffect, useState } from "react";

import CompendiumBrowser from "./CompendiumBrowser.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import Hotbar from "./Hotbar.jsx";
import PlayerList from "./PlayerList.jsx";
import ToastHost from "./ToastHost.jsx";
import Toolbar from "./Toolbar.jsx";
import { useTranslation } from "./i18n.js";
import OverlayHost from "./overlays/OverlayHost.jsx";
import RightSidebar from "./sidebar/RightSidebar.jsx";

/**
 * Root UI component rendered on top of the PixiJS canvas.
 *
 * The surrounding `#ui-root` element is a pointer-events: none overlay; every
 * interactive surface (sidebar, HUD widgets, windows) opts back in through CSS.
 * This keeps the map fully usable while UI is visible.
 *
 * The old top navigation bar was removed: the compendium is opened exclusively
 * from the "Libraries" tab of the right sidebar.
 */
export default function App() {
  const { t } = useTranslation();
  // The compendium starts closed and may only be opened from the Library tab.
  const [compendiumOpen, setCompendiumOpen] = useState(false);
  const [compendiumTab, setCompendiumTab] = useState("spells");

  // One failing HUD widget must never take down its neighbours.
  const boundaryProps = {
    fallback: t("PF2E.Platform.Common.RenderError", "Ошибка рендера"),
    retryLabel: t("PF2E.Platform.Common.Retry", "Повторить"),
  };

  const openCompendium = (tabId) => {
    if (typeof tabId === "string" && tabId !== "") {
      setCompendiumTab(tabId);
    }
    setCompendiumOpen(true);
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setCompendiumOpen((current) => (current ? false : current));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="ui-layer">
      <ErrorBoundary {...boundaryProps}>
        <Toolbar />
      </ErrorBoundary>
      <ErrorBoundary {...boundaryProps}>
        <PlayerList />
      </ErrorBoundary>
      <ErrorBoundary {...boundaryProps}>
        <Hotbar />
      </ErrorBoundary>
      <ToastHost />
      <OverlayHost />
      <ErrorBoundary {...boundaryProps}>
        <RightSidebar onOpenCompendium={openCompendium} />
      </ErrorBoundary>

      {compendiumOpen ? (
        <ErrorBoundary {...boundaryProps}>
          <CompendiumBrowser
            initialTabId={compendiumTab}
            onClose={() => setCompendiumOpen(false)}
          />
        </ErrorBoundary>
      ) : null}
    </div>
  );
}
