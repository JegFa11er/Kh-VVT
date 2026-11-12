import { useEffect, useRef, useState } from "react";

import { useTranslation } from "./i18n.js";
import PlayerConfigModal from "./PlayerConfigModal.jsx";
import { useStore } from "./StoreContext.jsx";

const ROLE_LABEL_KEYS = {
  gm: ["PF2E.Platform.Players.RoleGm", "Game Master"],
  player: ["PF2E.Platform.Players.RolePlayer", "Player"],
};

function roleLabel(role, t) {
  const entry = ROLE_LABEL_KEYS[role] || ROLE_LABEL_KEYS.player;
  return t(entry[0], entry[1]);
}

/**
 * Bottom-left connected-player panel (Step 4.3).
 *
 * Right-clicking a player opens a small Foundry-style context menu; the menu
 * entry opens the profile dialog for that participant. The panel is a fixed
 * overlay so it stays above the PixiJS canvas without affecting map input.
 */
export default function PlayerList() {
  const { users, myUserId } = useStore();
  const { t } = useTranslation();
  const [menu, setMenu] = useState(null);
  const [configUserId, setConfigUserId] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menu) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (menuRef.current && menuRef.current.contains(event.target)) {
        return;
      }
      setMenu(null);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menu]);

  const openContextMenu = (event, user) => {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 220;
    const menuHeight = 46;
    const x = Math.max(
      8,
      Math.min(event.clientX, window.innerWidth - menuWidth - 8),
    );
    const y = Math.max(
      8,
      Math.min(event.clientY, window.innerHeight - menuHeight - 8),
    );
    setMenu({ x, y, userId: user.id });
  };

  const handleConfigure = () => {
    if (!menu) {
      return;
    }
    setConfigUserId(menu.userId);
    setMenu(null);
  };

  const editingUser =
    configUserId === null
      ? null
      : users.find((user) => user.id === configUserId) || null;

  return (
    <>
      <aside
        className="player-list"
        aria-label={t("PF2E.Platform.Players.Aria", "Connected players")}
      >
        <div className="player-list__header">
          {t("PF2E.Platform.Players.Title", "Players")}
        </div>

        {users.length === 0 ? (
          <div className="player-list__empty">
            {t("PF2E.Platform.Players.Waiting", "Waiting for players…")}
          </div>
        ) : (
          <ul className="player-list__items">
            {users.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  className={
                    "player-list__item" +
                    (user.id === myUserId ? " player-list__item--self" : "")
                  }
                  title={
                    user.name +
                    " — " +
                    roleLabel(user.role, t) +
                    ". " +
                    t(
                      "PF2E.Platform.Players.ConfigureHint",
                      "Right-click: configure participant",
                    )
                  }
                  onContextMenu={(event) => openContextMenu(event, user)}
                >
                  <span
                    className="player-list__dot"
                    style={{ backgroundColor: user.color || "#8c96a8" }}
                    aria-hidden="true"
                  />
                  <span className="player-list__name">{user.name}</span>
                  <span className="player-list__role">
                    [{roleLabel(user.role, t)}]
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {menu ? (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="context-menu__item"
            role="menuitem"
            onClick={handleConfigure}
          >
            <span className="context-menu__icon" aria-hidden="true">
              👤
            </span>
            {t("PF2E.Platform.Players.Configure", "Configure participant")}
          </button>
        </div>
      ) : null}

      {editingUser ? (
        <PlayerConfigModal
          key={editingUser.id}
          user={editingUser}
          onClose={() => setConfigUserId(null)}
        />
      ) : null}
    </>
  );
}
