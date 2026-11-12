import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { formatMessage, useTranslation } from "../i18n.js";
import { useStore } from "../StoreContext.jsx";
import { ACTOR_TOKEN_PAYLOAD_TYPE, setDragPayload } from "../drag-payloads.js";
import { confirmAction } from "../overlays/dialog-service.js";
import { canEditActor, canViewActor } from "../permissions.js";
import { showToast } from "../toast.js";
import OwnershipModal from "./OwnershipModal.jsx";
import SceneConfigModal from "./SceneConfigModal.jsx";

const PLACEHOLDER_IMAGE = "/assets/ui/item-placeholder.svg";
const DEFAULT_FOLDER_COLOR = "#3a4356";

const DIRECTORY_CONFIG = {
  scenes: {
    icon: "🗺️",
    titleKey: "PF2E.Platform.Directory.Scenes",
    titleFallback: "Scenes",
    createLabelKey: "PF2E.Platform.Directory.CreateScene",
    createLabelFallback: "Create Scene",
    createTitleKey: "PF2E.Platform.Directory.CreateScene",
    createTitleFallback: "Create Scene",
    searchKey: "PF2E.Platform.Directory.SearchScenes",
    searchFallback: "Search scenes…",
    emptyKey: "PF2E.Platform.Directory.EmptyScenes",
    emptyFallback: "No scenes yet.",
  },
  actors: {
    icon: "👤",
    titleKey: "PF2E.Platform.Directory.Actors",
    titleFallback: "Actors",
    createLabelKey: "PF2E.Platform.Directory.CreateActor",
    createLabelFallback: "Create Actor",
    createTitleKey: "PF2E.Platform.Directory.CreateActor",
    createTitleFallback: "Create Actor",
    searchKey: "PF2E.Platform.Directory.SearchActors",
    searchFallback: "Search actors…",
    emptyKey: "PF2E.Platform.Directory.EmptyActors",
    emptyFallback: "No actors yet.",
  },
  items: {
    icon: "💼",
    titleKey: "PF2E.Platform.Directory.Items",
    titleFallback: "Items",
    createLabelKey: "PF2E.Platform.Directory.CreateItem",
    createLabelFallback: "Create Item",
    createTitleKey: "PF2E.Platform.Directory.CreateItem",
    createTitleFallback: "Create Item",
    searchKey: "PF2E.Platform.Directory.SearchItems",
    searchFallback: "Search items…",
    emptyKey: "PF2E.Platform.Directory.EmptyItems",
    emptyFallback: "No items yet.",
  },
  journals: {
    icon: "📖",
    titleKey: "PF2E.Platform.Directory.Journals",
    titleFallback: "Journals",
    createLabelKey: "PF2E.Platform.Directory.CreateJournal",
    createLabelFallback: "Create Journal Entry",
    createTitleKey: "PF2E.Platform.Directory.CreateJournal",
    createTitleFallback: "Create Journal Entry",
    searchKey: "PF2E.Platform.Directory.SearchJournals",
    searchFallback: "Search journals…",
    emptyKey: "PF2E.Platform.Directory.EmptyJournals",
    emptyFallback: "No journal entries yet.",
  },
};

function localizeDirectoryConfig(config, t) {
  return {
    ...config,
    title: t(config.titleKey, config.titleFallback),
    createLabel: t(config.createLabelKey, config.createLabelFallback),
    createTitle: t(config.createTitleKey, config.createTitleFallback),
    searchPlaceholder: t(config.searchKey, config.searchFallback),
    emptyLabel: t(config.emptyKey, config.emptyFallback),
  };
}

function sortByName(a, b) {
  return String(a.name || "").localeCompare(String(b.name || ""), "ru", {
    sensitivity: "base",
  });
}

/**
 * Read the actor level defensively. Older worlds store it at the directory
 * entry root, while imported Foundry data can only carry the nested
 * `system.details.level.value` path. A missing level must never break the
 * directory render.
 */
function actorLevel(entry) {
  const nestedLevel = entry?.system?.details?.level;
  const rawLevel =
    entry?.level !== undefined && entry?.level !== null
      ? entry.level
      : nestedLevel !== null && typeof nestedLevel === "object"
        ? nestedLevel.value
        : nestedLevel;
  const level = Number(rawLevel);
  return Number.isFinite(level) ? level : 1;
}

function actorSubtitle(entry, t) {
  const level = actorLevel(entry);
  if (entry?.actorType === "npc") {
    return formatMessage(
      t("PF2E.Platform.Directory.CreatureLevel", "Creature {level}"),
      { level },
    );
  }
  return formatMessage(
    t("PF2E.Platform.Directory.LevelSuffix", "Level {level}"),
    { level },
  );
}

function entrySubtitle(kind, entry, t) {
  if (kind === "actors") {
    return actorSubtitle(entry, t);
  }
  if (kind === "items") {
    return entry?.itemType || t("PF2E.Platform.Directory.Item", "Item");
  }
  if (kind === "scenes") {
    return t("PF2E.Platform.Directory.Scene", "Scene");
  }
  if (kind === "journals") {
    const count = Array.isArray(entry?.pages) ? entry.pages.length : 0;
    return count === 0
      ? t("PF2E.Platform.Directory.NoPages", "No pages")
      : count + " " + t("PF2E.Platform.Directory.Pages", "pages");
  }
  return "";
}

function FolderModal({ kind, onCancel, onCreate, t }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_FOLDER_COLOR);
  const [sortMode, setSortMode] = useState("alpha");

  const submit = (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") {
      return;
    }
    onCreate({
      name: trimmed,
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_FOLDER_COLOR,
      sortMode,
    });
  };

  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal-window directory-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-modal-title"
        onSubmit={submit}
      >
        <header className="modal-window__header">
          <h2 className="modal-window__title" id="folder-modal-title">
            📁 {t("PF2E.Platform.Common.Folder", "Folder")}:{" "}
            {t("PF2E.Platform.Common.Folder", "Folder")}
          </h2>
        </header>
        <div className="modal-window__body">
          <label className="modal-field">
            <span className="modal-field__label">
              {t("PF2E.Platform.Common.Name", "Name")}
            </span>
            <input
              className="ui-input"
              value={name}
              autoFocus
              placeholder={t(
                "PF2E.Platform.Directory.FolderNamePlaceholder",
                "Folder name",
              )}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="modal-field">
            <span className="modal-field__label">
              {t("PF2E.Platform.Directory.ColorHex", "Color (HEX)")}
            </span>
            <span className="modal-color-row">
              <input
                type="color"
                className="modal-color-picker"
                value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_FOLDER_COLOR}
                onChange={(event) => setColor(event.target.value)}
                aria-label={t(
                  "PF2E.Platform.Directory.FolderColor",
                  "Folder color",
                )}
              />
              <input
                className="ui-input modal-color-hex"
                value={color}
                maxLength={7}
                onChange={(event) => setColor(event.target.value)}
              />
            </span>
          </label>

          <fieldset className="directory-radio-group">
            <legend className="modal-field__label">
              {t("PF2E.Platform.Directory.Sort", "Sorting")}
            </legend>
            <label className="directory-radio">
              <input
                type="radio"
                name="folder-sort"
                value="alpha"
                checked={sortMode === "alpha"}
                onChange={() => setSortMode("alpha")}
              />
              {t("PF2E.Platform.Directory.SortAlpha", "Alphabetical")}
            </label>
            <label className="directory-radio">
              <input
                type="radio"
                name="folder-sort"
                value="manual"
                checked={sortMode === "manual"}
                onChange={() => setSortMode("manual")}
              />
              {t("PF2E.Platform.Directory.SortManual", "Manual order")}
            </label>
          </fieldset>
        </div>
        <footer className="modal-window__footer">
          <button type="button" className="ui-button" onClick={onCancel}>
            {t("PF2E.Platform.Common.Cancel", "Cancel")}
          </button>
          <button
            type="submit"
            className="ui-button ui-button--primary"
            disabled={name.trim() === ""}
          >
            {t("PF2E.Platform.Directory.CreateFolder", "📁 Create Folder")}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}

function CreateEntryModal({ kind, folders, initialFolderId, onCancel, onCreate, t }) {
  const config = DIRECTORY_CONFIG[kind];
  const [name, setName] = useState("");
  const [folderId, setFolderId] = useState(initialFolderId || "");
  const [actorType, setActorType] = useState("character");
  const [itemType, setItemType] = useState("misc");

  const submit = (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") {
      return;
    }
    const data = {
      name: trimmed,
      folderId: folderId || null,
    };
    if (kind === "actors") {
      data.actorType = actorType;
      data.level = actorType === "npc" ? 1 : 1;
    }
    if (kind === "items") {
      data.itemType = itemType;
    }
    onCreate(data);
  };

  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal-window directory-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-entry-title"
        onSubmit={submit}
      >
        <header className="modal-window__header">
          <h2 className="modal-window__title" id="create-entry-title">
            {config.icon} {config.createTitle}
          </h2>
        </header>
        <div className="modal-window__body">
          <label className="modal-field">
            <span className="modal-field__label">
              {t("PF2E.Platform.Common.Name", "Name")}
            </span>
            <input
              className="ui-input"
              value={name}
              autoFocus
              placeholder={t("PF2E.Platform.Common.Name", "Name")}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          {kind === "actors" ? (
            <label className="modal-field">
              <span className="modal-field__label">
                {t("PF2E.Platform.Directory.Type", "Type")}
              </span>
              <select
                className="ui-input"
                value={actorType}
                onChange={(event) => setActorType(event.target.value)}
              >
                <option value="character">
                  {t(
                    "PF2E.Platform.Directory.PlayerCharacter",
                    "Player Character",
                  )}
                </option>
                <option value="npc">
                  {t("PF2E.Platform.Directory.GmCharacter", "GM Character")}
                </option>
              </select>
            </label>
          ) : null}

          {kind === "items" ? (
            <label className="modal-field">
              <span className="modal-field__label">
                {t("PF2E.Platform.Directory.ItemType", "Item type")}
              </span>
              <select
                className="ui-input"
                value={itemType}
                onChange={(event) => setItemType(event.target.value)}
              >
                <option value="weapon">
                  {t("PF2E.Platform.Option.ItemType.Weapon", "Weapon")}
                </option>
                <option value="armor">
                  {t("PF2E.Platform.Option.ItemType.Armor", "Armor")}
                </option>
                <option value="equipment">
                  {t("PF2E.Platform.Option.ItemType.Equipment", "Equipment")}
                </option>
                <option value="consumable">
                  {t("PF2E.Platform.Option.ItemType.Consumable", "Consumable")}
                </option>
                <option value="treasure">
                  {t("PF2E.Platform.Option.ItemType.Treasure", "Treasure")}
                </option>
                <option value="misc">
                  {t("PF2E.Platform.Directory.Misc", "Miscellaneous")}
                </option>
              </select>
            </label>
          ) : null}

          <label className="modal-field">
            <span className="modal-field__label">
              {t("PF2E.Platform.Common.Folder", "Folder")}
            </span>
            <select
              className="ui-input"
              value={folderId}
              onChange={(event) => setFolderId(event.target.value)}
            >
              <option value="">
                {t("PF2E.Platform.Common.NoFolder", "No folder")}
              </option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <footer className="modal-window__footer">
          <button type="button" className="ui-button" onClick={onCancel}>
            {t("PF2E.Platform.Common.Cancel", "Cancel")}
          </button>
          <button
            type="submit"
            className="ui-button ui-button--primary"
            disabled={name.trim() === ""}
          >
            {t("PF2E.Platform.Common.Create", "Create")}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}

function EntryRow({
  kind,
  entry,
  t,
  onOpenJournal,
  onOpenActor,
  onActorContextMenu,
  onSceneContextMenu,
  activeSceneId,
  viewedSceneId,
  onActivateScene,
  onConfigureScene,
  canConfigureScene = false,
  canDragActor = false,
  canViewActorEntry = true,
}) {
  if (kind === "scenes") {
    const isActive = entry.id === activeSceneId;
    const isViewed = entry.id === viewedSceneId;
    const activate = () => {
      if (typeof onActivateScene === "function") {
        onActivateScene(entry.id);
      }
    };
    return (
      <div
        className={
          "directory-scene-card" +
          (isActive ? " directory-scene-card--active" : "") +
          (isViewed ? " directory-scene-card--viewed" : "")
        }
        title={entry.name}
        role="button"
        tabIndex={0}
        aria-pressed={isActive}
        onClick={activate}
        onContextMenu={(event) => {
          if (typeof onSceneContextMenu === "function") {
            onSceneContextMenu(event, entry);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activate();
          }
        }}
      >
        <img
          className="directory-scene-card__image"
          src={entry.img || PLACEHOLDER_IMAGE}
          alt=""
          loading="lazy"
          onError={(event) => {
            event.currentTarget.src = PLACEHOLDER_IMAGE;
          }}
        />
        <span className="directory-scene-card__body">
          <span className="directory-scene-card__name">{entry.name}</span>
          <span className="directory-scene-card__meta">
            {isViewed
              ? t(
                  "PF2E.Platform.Scene.Viewing",
                  "Viewing scene (GM only)",
                )
              : isActive
                ? t("PF2E.Platform.Scene.Active", "Active scene")
                : entry.folderId
                  ? t("PF2E.Platform.Scene.InFolder", "In folder")
                  : t("PF2E.Platform.Scene.NoFolder", "No folder")}
          </span>
        </span>
        <button
          type="button"
          className="ui-button directory-scene-card__configure"
          title={formatMessage(
            t("PF2E.Platform.Scene.Configure", 'Configure scene "{name}"'),
            { name: entry.name },
          )}
          aria-label={formatMessage(
            t(
              "PF2E.Platform.Scene.ConfigureAria",
              "Configure scene {name}",
            ),
            { name: entry.name },
          )}
          hidden={!canConfigureScene}
          onClick={(event) => {
            event.stopPropagation();
            if (typeof onConfigureScene === "function") {
              onConfigureScene(entry);
            }
          }}
        >
          ⚙
        </button>
        <button
          type="button"
          className="ui-button directory-scene-card__activate"
          title={
            isActive
              ? formatMessage(
                  t(
                    "PF2E.Platform.Scene.AlreadyActive",
                    '"{name}" is already active',
                  ),
                  { name: entry.name },
                )
              : formatMessage(
                  t(
                    "PF2E.Platform.Scene.Activate",
                    'Activate scene "{name}"',
                  ),
                  { name: entry.name },
                )
          }
          aria-label={
            isActive
              ? formatMessage(
                  t(
                    "PF2E.Platform.Scene.AlreadyActiveAria",
                    "Scene {name} is already active",
                  ),
                  { name: entry.name },
                )
              : formatMessage(
                  t(
                    "PF2E.Platform.Scene.ActivateAria",
                    "Activate scene {name}",
                  ),
                  { name: entry.name },
                )
          }
          onClick={(event) => {
            event.stopPropagation();
            activate();
          }}
        >
          {isActive
            ? t("PF2E.Platform.Scene.ActiveBadge", "✓ Active")
            : t("PF2E.Platform.Scene.ActivateButton", "Activate")}
        </button>
      </div>
    );
  }

  const isJournal = kind === "journals";
  const isActor = kind === "actors";
  const entryId = entry?.id;
  const entryName = entry?.name || "";
  const openEntry = isJournal
    ? () => onOpenJournal(entryId)
    : isActor && typeof onOpenActor === "function"
      ? () => onOpenActor(entryId)
      : undefined;
  const actorDragProps = isActor && canDragActor
    ? {
        draggable: true,
        onDragStart: (event) =>
          setDragPayload(event, {
            type: ACTOR_TOKEN_PAYLOAD_TYPE,
            actorId: entryId,
            name: entryName,
            img: entry?.img || null,
          }),
      }
    : {};
  return (
    <button
      type="button"
      className={
        "directory-entry" +
        (isJournal ? " directory-entry--journal" : "") +
        (isActor ? " directory-entry--actor" : "") +
        (isActor && canDragActor ? " directory-entry--draggable" : "") +
        (isActor && !canViewActorEntry ? " directory-entry--locked" : "")
      }
      title={
        isActor
          ? entryName +
            (!canViewActorEntry
              ? " — " + t("PF2E.Platform.Sidebar.AccessDenied", "Access denied")
              : canDragActor
                ? " — " +
                  t(
                    "PF2E.Platform.Directory.DragActorHint",
                    "drag onto the canvas to create a token; right-click for the menu",
                  )
                : " — " +
                  t(
                    "PF2E.Platform.Directory.ReadOnlyHint",
                    "sheet is read-only",
                  ))
          : entryName
      }
      onClick={openEntry}
      onContextMenu={
        isActor && typeof onActorContextMenu === "function"
          ? (event) => onActorContextMenu(event, entry)
          : undefined
      }
      {...actorDragProps}
    >
      <span className="directory-entry__icon" aria-hidden="true">
        {kind === "actors"
          ? entry?.actorType === "npc"
            ? "👹"
            : "🧙"
          : kind === "items"
            ? "🎒"
            : "📖"}
      </span>
      <span className="directory-entry__body">
        <span className="directory-entry__name">{entryName}</span>
        <span className="directory-entry__meta">
          {entrySubtitle(kind, entry, t)}
        </span>
      </span>
      {isJournal || isActor ? (
        <span className="directory-entry__open" aria-hidden="true">
          ↗
        </span>
      ) : null}
    </button>
  );
}

/**
 * Shared Foundry-style directory tree used by Scenes, Actors, Items and
 * Journals. Folders carry their own colour and sort mode; each folder header
 * has a "+" shortcut that pre-selects that folder in the creation modal.
 */
export default function DirectoryPanel({ kind, onOpenJournal, onOpenActor }) {
  const {
    directories,
    networkClient,
    activeSceneId,
    viewedSceneId,
    setViewedSceneId,
    myUserId,
    activeRole,
  } = useStore();
  const { t, language } = useTranslation();
  const config = useMemo(
    () => localizeDirectoryConfig(DIRECTORY_CONFIG[kind], t),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, language],
  );
  const directory = useMemo(() => {
    const source = directories?.[kind];
    return {
      folders: Array.isArray(source?.folders) ? source.folders : [],
      entries: Array.isArray(source?.entries) ? source.entries : [],
    };
  }, [directories, kind]);
  const [search, setSearch] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState(() => new Set());
  const [createState, setCreateState] = useState(null);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [actorMenu, setActorMenu] = useState(null);
  const [sceneMenu, setSceneMenu] = useState(null);
  const [ownershipActor, setOwnershipActor] = useState(null);
  const [sceneConfig, setSceneConfig] = useState(null);
  const menuRef = useRef(null);
  const sceneMenuRef = useRef(null);
  const fileInputRef = useRef(null);
  const sceneImportRef = useRef(null);
  const importTargetRef = useRef(null);
  const sceneImportTargetRef = useRef(null);

  useEffect(() => {
    if (!actorMenu && !sceneMenu) {
      return undefined;
    }
    const handlePointerDown = (event) => {
      if (menuRef.current && menuRef.current.contains(event.target)) {
        return;
      }
      if (sceneMenuRef.current && sceneMenuRef.current.contains(event.target)) {
        return;
      }
      setActorMenu(null);
      setSceneMenu(null);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setActorMenu(null);
        setSceneMenu(null);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [actorMenu, sceneMenu]);

  const query = search.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    if (query === "") {
      return directory.entries;
    }
    return directory.entries.filter((entry) =>
      String(entry.name || "").toLowerCase().includes(query),
    );
  }, [directory.entries, query]);

  const folders = useMemo(() => {
    const list = [...directory.folders];
    if (query !== "") {
      return list.filter(
        (folder) =>
          String(folder.name || "").toLowerCase().includes(query) ||
          filteredEntries.some((entry) => entry.folderId === folder.id),
      );
    }
    return list;
  }, [directory.folders, filteredEntries, query]);

  const unfiled = useMemo(() => {
    const list = filteredEntries.filter((entry) => !entry.folderId);
    return [...list].sort(sortByName);
  }, [filteredEntries]);

  const entriesForFolder = (folder) => {
    const list = filteredEntries.filter((entry) => entry.folderId === folder.id);
    if (folder.sortMode === "manual") {
      return list;
    }
    return [...list].sort(sortByName);
  };

  const toggleFolder = (folderId) => {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const requireClient = () => {
    if (!networkClient) {
      setError(t("PF2E.Platform.Directory.NoConnection", "No connection to the server."));
      return false;
    }
    return true;
  };

  const createFolder = (data) => {
    setFolderModalOpen(false);
    if (!requireClient()) {
      return;
    }
    networkClient.createFolder(kind, data).catch((createError) => {
      setError(
        createError.message ||
          t(
            "PF2E.Platform.Directory.ErrorCreateFolder",
            "Failed to create the folder.",
          ),
      );
    });
  };

  const createEntry = (data) => {
    setCreateState(null);
    if (!requireClient()) {
      return;
    }
    networkClient.createDirectoryEntry(kind, data).catch((createError) => {
      setError(
        createError.message ||
          t(
            "PF2E.Platform.Directory.ErrorCreateEntry",
            "Failed to create the entry.",
          ),
      );
    });
  };

  // ------------------------------------------------ actor permissions (6.1)

  const actorAccess = (entry) =>
    kind === "actors" ? canViewActor(entry, myUserId, activeRole) : true;

  const actorEdit = (entry) =>
    kind === "actors" ? canEditActor(entry, myUserId, activeRole) : false;

  const requestOpenActor = (actorId) => {
    const entry = (directory.entries || []).find((item) => item.id === actorId);
    if (!entry) {
      showToast(
        t(
          "PF2E.Platform.Sidebar.ActorNotSynced",
          "Actor is not synchronized yet.",
        ),
        { kind: "error" },
      );
      return;
    }
    if (!actorAccess(entry)) {
      showToast(t("PF2E.Platform.Sidebar.AccessDenied", "Access denied"), {
        kind: "error",
      });
      return;
    }
    if (typeof onOpenActor === "function") {
      onOpenActor(actorId);
    }
  };

  // ------------------------------------------------ actor context menu (5.5)

  const openActorContextMenu = (event, entry) => {
    if (kind !== "actors") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 232;
    const menuHeight = 5 * 38 + 12;
    setActorMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
      actorId: entry.id,
    });
  };

  const activeMenuActor = actorMenu
    ? (directory.entries || []).find((entry) => entry.id === actorMenu.actorId) ||
      null
    : null;

  // ---------------------------------------------------- scene context menu (6.8)

  const openSceneContextMenu = (event, entry) => {
    if (kind !== "scenes") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 236;
    const menuHeight = 7 * 34 + 12;
    setSceneMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
      sceneId: entry.id,
    });
  };

  const activeMenuScene = sceneMenu
    ? (directory.entries || []).find((entry) => entry.id === sceneMenu.sceneId) ||
      null
    : null;

  const viewScene = (entry) => {
    setSceneMenu(null);
    if (!entry || activeRole !== "gm") {
      return;
    }
    setViewedSceneId(entry.id);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("pf2e:view-scene", {
          detail: { sceneId: entry.id, scene: entry },
        }),
      );
    }
  };

  const preloadScene = (entry) => {
    setSceneMenu(null);
    if (!entry || !requireClient()) {
      return;
    }
    networkClient.preloadScene(entry.id);
    showToast(
      formatMessage(
        t(
          "PF2E.Platform.Scene.Preloaded",
          'Scene "{name}" is preloading for all participants.',
        ),
        { name: entry.name },
      ),
    );
  };

  const sceneFilePayload = (entry) => ({
    name: entry.name,
    img: entry.img || null,
    gridSize: entry.gridSize,
    backgroundColor: entry.backgroundColor,
    folderId: entry.folderId || null,
    walls: Array.isArray(entry.walls) ? entry.walls : [],
    drawings: Array.isArray(entry.drawings) ? entry.drawings : [],
    lights: Array.isArray(entry.lights) ? entry.lights : [],
    tokens: Array.isArray(entry.tokens) ? entry.tokens : [],
  });

  const exportSceneData = (entry) => {
    setSceneMenu(null);
    if (!entry) {
      return;
    }
    const blob = new Blob([JSON.stringify(sceneFilePayload(entry), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeName =
      String(entry.name || "scene")
        .trim()
        .replace(/[^\w\u0400-\u04FF-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "scene";
    anchor.href = url;
    anchor.download = safeName + ".scene.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const requestSceneImport = (entry) => {
    setSceneMenu(null);
    sceneImportTargetRef.current = entry || null;
    if (sceneImportRef.current) {
      sceneImportRef.current.value = "";
      sceneImportRef.current.click();
    }
  };

  const handleSceneImport = (event) => {
    const file = event.target.files && event.target.files[0];
    const entry = sceneImportTargetRef.current;
    event.target.value = "";
    sceneImportTargetRef.current = null;
    if (!file || !entry || !requireClient()) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        if (
          !parsed ||
          typeof parsed !== "object" ||
          Array.isArray(parsed)
        ) {
          throw new Error(
            t(
              "PF2E.Platform.Scene.ExportEmpty",
              "The file does not contain valid scene data.",
            ),
          );
        }
        const canvas = {
          walls: Array.isArray(parsed.walls) ? parsed.walls : [],
          drawings: Array.isArray(parsed.drawings) ? parsed.drawings : [],
          lights: Array.isArray(parsed.lights) ? parsed.lights : [],
          tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
        };
        networkClient
          .updateSceneCanvas(entry.id, canvas)
          .then(() =>
            networkClient.updateScene(entry.id, {
              img: typeof parsed.img === "string" ? parsed.img : undefined,
              gridSize:
                parsed.gridSize === undefined ? undefined : parsed.gridSize,
              backgroundColor:
                typeof parsed.backgroundColor === "string"
                  ? parsed.backgroundColor
                  : undefined,
            }),
          )
          .then(() => {
            // Importing into the scene currently being previewed must refresh
            // the local Pixi canvas as well.
            if (viewedSceneId === entry.id && typeof window !== "undefined") {
              window.dispatchEvent(
                new CustomEvent("pf2e:view-scene", {
                  detail: {
                    sceneId: entry.id,
                    scene: Object.assign({}, entry, canvas, parsed),
                  },
                }),
              );
            }
          })
          .catch((importError) => {
            setError(
              importError.message ||
                t(
                  "PF2E.Platform.Scene.ImportFailed",
                  "Failed to import the scene.",
                ),
            );
          });
      } catch (importError) {
        setError(
          importError.message ||
            t(
              "PF2E.Platform.Scene.ImportFailed",
              "Failed to import the scene.",
            ),
        );
      }
    };
    reader.onerror = () => {
      setError(
        t("PF2E.Platform.Scene.ImportFailed", "Failed to import the scene."),
      );
    };
    reader.readAsText(file);
  };

  const copyScene = (entry) => {
    setSceneMenu(null);
    if (!entry || !requireClient()) {
      return;
    }
    const payload = sceneFilePayload(entry);
    payload.name =
      entry.name + t("PF2E.Platform.Scene.CopySuffix", " (Copy)");
    networkClient
      .createDirectoryEntry("scenes", payload)
      .then(() =>
        showToast(t("PF2E.Platform.Scene.Copied", "Scene duplicated.")),
      )
      .catch((copyError) => {
        setError(
          copyError.message ||
            t("PF2E.Platform.Scene.ImportFailed", "Failed to import the scene."),
        );
      });
  };

  const deleteScene = (entry) => {
    setSceneMenu(null);
    if (!entry || !requireClient()) {
      return;
    }
    confirmAction({
      title: t("PF2E.Platform.Scene.DeleteTitle", "Delete Scene"),
      message: formatMessage(
        t(
          "PF2E.Platform.Scene.DeleteMessage",
          'Delete scene "{name}"? All walls, drawings, lights and tokens on this scene will be lost.',
        ),
        { name: entry.name },
      ),
      confirmLabel: t("PF2E.Platform.Common.Delete", "Delete"),
      cancelLabel: t("PF2E.Platform.Common.Cancel", "Cancel"),
      danger: true,
    }).then((confirmed) => {
      if (!confirmed) {
        return;
      }
      networkClient
        .deleteDirectoryEntry("scenes", entry.id)
        .then(() => {
          if (viewedSceneId === entry.id) {
            setViewedSceneId(null);
            if (typeof window !== "undefined") {
              window.dispatchEvent(
                new CustomEvent("pf2e:view-scene", {
                  detail: { sceneId: null },
                }),
              );
            }
          }
          showToast(t("PF2E.Platform.Scene.Deleted", "Scene deleted."));
        })
        .catch((deleteError) => {
          setError(
            deleteError.message ||
              t(
                "PF2E.Platform.Scene.ImportFailed",
                "Failed to import the scene.",
              ),
          );
        });
    });
  };

  const exportActorData = (entry) => {
    setActorMenu(null);
    if (!entry) {
      return;
    }
    const payload = {
      system:
        entry.system !== null &&
        typeof entry.system === "object" &&
        !Array.isArray(entry.system)
          ? entry.system
          : {},
      items: Array.isArray(entry.items) ? entry.items : [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeName =
      String(entry.name || "actor")
        .trim()
        .replace(/[^\w\u0400-\u04FF-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "actor";
    anchor.href = url;
    anchor.download = safeName + ".json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const requestActorImport = (entry) => {
    setActorMenu(null);
    importTargetRef.current = entry || null;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleActorImport = (event) => {
    const file = event.target.files && event.target.files[0];
    const entry = importTargetRef.current;
    event.target.value = "";
    importTargetRef.current = null;
    if (!file || !entry || !requireClient()) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        const data =
          parsed && parsed.actor && typeof parsed.actor === "object"
            ? parsed.actor
            : parsed;
        const system =
          data && typeof data === "object" && data.system !== undefined
            ? data.system
            : data;
        const items = Array.isArray(data?.items) ? data.items : [];
        if (
          system === null ||
          typeof system !== "object" ||
          Array.isArray(system)
        ) {
          throw new Error(
            t(
              "PF2E.Platform.Scene.ImportInvalid",
              "The file does not contain a valid actor.system object.",
            ),
          );
        }
        networkClient
          .updateActor(entry.id, { system, items })
          .catch((importError) => {
            setError(
              importError.message ||
                t(
                  "PF2E.Platform.Directory.ErrorImportActor",
                  "Failed to import the actor data.",
                ),
            );
          });
      } catch (importError) {
        setError(
          importError.message ||
            t(
              "PF2E.Platform.Directory.ErrorReadActor",
              "Failed to read the actor JSON file.",
            ),
        );
      }
    };
    reader.onerror = () => {
      setError(
        t("PF2E.Platform.Directory.ErrorReadFile", "Failed to read the file."),
      );
    };
    reader.readAsText(file);
  };

  const copyActor = (entry) => {
    setActorMenu(null);
    if (!entry || !requireClient()) {
      return;
    }
    networkClient
      .createDirectoryEntry("actors", {
        name:
          entry.name + t("PF2E.Platform.Directory.CopySuffix", " (Copy)"),
        actorType: entry.actorType,
        level: entry.level,
        img: entry.img,
        folderId: entry.folderId,
        system: entry.system || {},
        items: Array.isArray(entry.items) ? entry.items : [],
      })
      .catch((copyError) => {
        setError(
          copyError.message ||
            t(
              "PF2E.Platform.Directory.ErrorCopyActor",
              "Failed to duplicate the actor.",
            ),
        );
      });
  };

  const deleteActor = (entry) => {
    setActorMenu(null);
    if (!entry || !requireClient()) {
      return;
    }
    confirmAction({
      title: t(
        "PF2E.Platform.Directory.DeleteActorTitle",
        "Delete Actor",
      ),
      message: formatMessage(
        t(
          "PF2E.Platform.Directory.DeleteActorMessage",
          'Delete actor "{name}"? The character sheet and all of its data will be lost.',
        ),
        { name: entry.name },
      ),
      confirmLabel: t("PF2E.Platform.Common.Delete", "Delete"),
      cancelLabel: t("PF2E.Platform.Common.Cancel", "Cancel"),
      danger: true,
    }).then((confirmed) => {
      if (!confirmed) {
        return;
      }
      networkClient
        .deleteDirectoryEntry("actors", entry.id)
        .catch((deleteError) => {
          setError(
            deleteError.message ||
              t(
                "PF2E.Platform.Directory.ErrorDeleteActor",
                "Failed to delete the actor.",
              ),
          );
        });
    });
  };

  const openOwnership = (entry) => {
    setActorMenu(null);
    if (activeRole !== "gm") {
      showToast(
        t(
          "PF2E.Platform.Scene.OwnershipGmOnly",
          "Only the GM can configure ownership.",
        ),
        { kind: "error" },
      );
      return;
    }
    setOwnershipActor(entry || null);
  };

  const activateScene = (sceneId) => {
    if (!requireClient()) {
      return;
    }
    // Activation is authoritative for everyone; drop any local GM preview.
    setViewedSceneId(null);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("pf2e:view-scene", { detail: { sceneId: null } }),
      );
    }
    networkClient.activateScene(sceneId).catch((activateError) => {
      setError(
        activateError.message ||
          t(
            "PF2E.Platform.Scene.ActivateFailed",
            "Failed to activate the scene.",
          ),
      );
    });
  };

  const openSceneConfig = (entry) => {
    if (activeRole !== "gm") {
      showToast(
        t(
          "PF2E.Platform.Scene.ConfigGmOnly",
          "Only the GM can configure scenes.",
        ),
        { kind: "error" },
      );
      return;
    }
    setSceneConfig(entry || null);
  };

  const saveSceneConfig = (settings) => {
    if (!sceneConfig || !requireClient()) {
      return;
    }
    networkClient
      .updateScene(sceneConfig.id, settings)
      .then(() => setSceneConfig(null))
      .catch((saveError) => {
        setError(
          saveError.message ||
            t(
              "PF2E.Platform.Scene.ConfigFailed",
              "Failed to save the scene settings.",
            ),
        );
      });
  };

  const openCreate = (folderId = null) => {
    setCreateState({ folderId });
  };

  const renderFolder = (folder) => {
    const folderEntries = entriesForFolder(folder);
    const collapsed = collapsedFolders.has(folder.id);
    return (
      <section className="directory-folder" key={folder.id}>
        <div
          className="directory-folder__header"
          style={{ backgroundColor: folder.color || DEFAULT_FOLDER_COLOR }}
        >
          <button
            type="button"
            className="directory-folder__toggle"
            aria-label={
              collapsed
                ? t("PF2E.Platform.Directory.ExpandFolder", "Expand folder")
                : t(
                    "PF2E.Platform.Directory.CollapseFolder",
                    "Collapse folder",
                  )
            }
            onClick={() => toggleFolder(folder.id)}
          >
            {collapsed ? "▸" : "▾"}
          </button>
          <span className="directory-folder__icon" aria-hidden="true">
            📁
          </span>
          <span className="directory-folder__name">{folder.name}</span>
          <span className="directory-folder__count">{folderEntries.length}</span>
          <button
            type="button"
            className="directory-folder__add"
            title={formatMessage(
              t(
                "PF2E.Platform.Directory.CreateInFolder",
                'Create in folder "{name}"',
              ),
              { name: folder.name },
            )}
            aria-label={formatMessage(
              t(
                "PF2E.Platform.Directory.CreateInFolder",
                'Create in folder "{name}"',
              ),
              { name: folder.name },
            )}
            onClick={() => openCreate(folder.id)}
          >
            +
          </button>
        </div>
        {!collapsed ? (
          <div className="directory-folder__body">
            {folderEntries.length === 0 ? (
              <div className="directory-folder__empty">
                {t("PF2E.Platform.Directory.FolderEmpty", "Folder is empty")}
              </div>
            ) : (
              folderEntries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  kind={kind}
                  entry={entry}
                  t={t}
                  onOpenJournal={onOpenJournal}
                  onOpenActor={requestOpenActor}
                  onActorContextMenu={openActorContextMenu}
                  onSceneContextMenu={openSceneContextMenu}
                  activeSceneId={activeSceneId}
                  viewedSceneId={viewedSceneId}
                  onActivateScene={activateScene}
                  onConfigureScene={openSceneConfig}
                  canConfigureScene={kind === "scenes" && activeRole === "gm"}
                  canDragActor={actorEdit(entry)}
                  canViewActorEntry={actorAccess(entry)}
                />
              ))
            )}
          </div>
        ) : null}
      </section>
    );
  };

  const visibleCount = filteredEntries.length;

  return (
    <div className="directory-panel">
      <div className="directory-panel__header">
        <span className="directory-panel__title">
          <span aria-hidden="true">{config.icon}</span> {config.title}
        </span>
        <span className="directory-panel__count">{visibleCount}</span>
      </div>

      <div className="directory-panel__actions">
        <button
          type="button"
          className="ui-button ui-button--primary directory-panel__create"
          onClick={() => openCreate(null)}
        >
          {config.createLabel}
        </button>
        <button
          type="button"
          className="ui-button"
          onClick={() => setFolderModalOpen(true)}
        >
          {t("PF2E.Platform.Directory.CreateFolder", "📁 Create Folder")}
        </button>
      </div>

      <input
        type="search"
        className="ui-input directory-panel__search"
        placeholder={config.searchPlaceholder}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        aria-label={config.searchPlaceholder}
      />

      {error ? (
        <div className="directory-panel__error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="directory-panel__tree">
        {folders.map(renderFolder)}

        {unfiled.length > 0 || (folders.length === 0 && query === "") ? (
          <section className="directory-folder directory-folder--unfiled">
            <div className="directory-folder__header directory-folder__header--unfiled">
              <span className="directory-folder__icon" aria-hidden="true">
                🗂️
              </span>
              <span className="directory-folder__name">
                {t("PF2E.Platform.Directory.Unfiled", "Unfiled")}
              </span>
              <span className="directory-folder__count">{unfiled.length}</span>
              <button
                type="button"
                className="directory-folder__add"
                title={t(
                  "PF2E.Platform.Directory.CreateUnfiled",
                  "Create unfiled",
                )}
                aria-label={t(
                  "PF2E.Platform.Directory.CreateUnfiled",
                  "Create unfiled",
                )}
                onClick={() => openCreate(null)}
              >
                +
              </button>
            </div>
            <div className="directory-folder__body">
              {unfiled.length === 0 ? (
                <div className="directory-folder__empty">
                  {config.emptyLabel}
                </div>
              ) : (
                unfiled.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    kind={kind}
                    entry={entry}
                    t={t}
                    onOpenJournal={onOpenJournal}
                    onOpenActor={requestOpenActor}
                    onActorContextMenu={openActorContextMenu}
                    onSceneContextMenu={openSceneContextMenu}
                    activeSceneId={activeSceneId}
                    viewedSceneId={viewedSceneId}
                    onActivateScene={activateScene}
                    onConfigureScene={openSceneConfig}
                    canConfigureScene={kind === "scenes" && activeRole === "gm"}
                    canDragActor={actorEdit(entry)}
                    canViewActorEntry={actorAccess(entry)}
                  />
                ))
              )}
            </div>
          </section>
        ) : null}

        {query !== "" && visibleCount === 0 && folders.length === 0 ? (
          <div className="directory-panel__empty">
            {t("PF2E.Platform.Common.NothingFound", "Nothing found.")}
          </div>
        ) : null}
      </div>

      {folderModalOpen ? (
        <FolderModal
          kind={kind}
          t={t}
          onCancel={() => setFolderModalOpen(false)}
          onCreate={createFolder}
        />
      ) : null}

      {createState ? (
        <CreateEntryModal
          kind={kind}
          folders={directory.folders}
          t={t}
          initialFolderId={createState.folderId}
          onCancel={() => setCreateState(null)}
          onCreate={createEntry}
        />
      ) : null}

      {sceneConfig && kind === "scenes" && activeRole === "gm" ? (
        <SceneConfigModal
          scene={sceneConfig}
          canEdit={activeRole === "gm"}
          onUpload={
            networkClient
              ? (file) => networkClient.uploadChatImage(file)
              : undefined
          }
          onSave={saveSceneConfig}
          onClose={() => setSceneConfig(null)}
        />
      ) : null}

      {kind === "actors" ? (
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={handleActorImport}
        />
      ) : null}

      {kind === "actors" && actorMenu && activeMenuActor
        ? createPortal(
            <div
              ref={menuRef}
              className="context-menu directory-actor-menu"
              style={{
                position: "fixed",
                left: actorMenu.x,
                top: actorMenu.y,
              }}
              role="menu"
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                type="button"
                className="context-menu__item"
                role="menuitem"
                onClick={() => openOwnership(activeMenuActor)}
                hidden={activeRole !== "gm"}
              >
                <span className="context-menu__icon" aria-hidden="true">
                  🔐
                </span>
                {t(
                  "PF2E.Platform.Directory.Ownership",
                  "Ownership Configuration",
                )}
              </button>
              <button
                type="button"
                className="context-menu__item"
                role="menuitem"
                onClick={() => exportActorData(activeMenuActor)}
              >
                <span className="context-menu__icon" aria-hidden="true">
                  ⬇️
                </span>
                {t("PF2E.Platform.Scene.Menu.Export", "Export Data")}
              </button>
              <button
                type="button"
                className="context-menu__item"
                role="menuitem"
                onClick={() => requestActorImport(activeMenuActor)}
              >
                <span className="context-menu__icon" aria-hidden="true">
                  ⬆️
                </span>
                {t("PF2E.Platform.Scene.Menu.Import", "Import Data")}
              </button>
              <button
                type="button"
                className="context-menu__item"
                role="menuitem"
                onClick={() => copyActor(activeMenuActor)}
              >
                <span className="context-menu__icon" aria-hidden="true">
                  📄
                </span>
                {t("PF2E.Platform.Scene.Menu.Copy", "Duplicate")}
              </button>
              <button
                type="button"
                className="context-menu__item context-menu__item--danger"
                role="menuitem"
                onClick={() => deleteActor(activeMenuActor)}
              >
                <span className="context-menu__icon" aria-hidden="true">
                  🗑
                </span>
                {t("PF2E.Platform.Scene.Menu.Delete", "Delete")}
              </button>
            </div>,
            document.body,
          )
        : null}

      {kind === "scenes" ? (
        <input
          ref={sceneImportRef}
          type="file"
          accept=".json,.scene.json,application/json"
          style={{ display: "none" }}
          onChange={handleSceneImport}
        />
      ) : null}

      {kind === "scenes" && sceneMenu && activeMenuScene
        ? createPortal(
            <div
              ref={sceneMenuRef}
              className="context-menu directory-scene-menu"
              style={{
                position: "fixed",
                left: sceneMenu.x,
                top: sceneMenu.y,
              }}
              role="menu"
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                type="button"
                className="context-menu__item"
                role="menuitem"
                onClick={() => viewScene(activeMenuScene)}
                hidden={activeRole !== "gm"}
              >
                <span className="context-menu__icon" aria-hidden="true">
                  👁
                </span>
                {t("PF2E.Platform.Scene.Menu.View", "View")}
              </button>
              <button
                type="button"
                className="context-menu__item"
                role="menuitem"
                onClick={() => {
                  setSceneMenu(null);
                  activateScene(activeMenuScene.id);
                }}
              >
                <span className="context-menu__icon" aria-hidden="true">
                  ▶
                </span>
                {t("PF2E.Platform.Scene.Menu.Activate", "Activate")}
              </button>
              <button
                type="button"
                className="context-menu__item"
                role="menuitem"
                onClick={() => preloadScene(activeMenuScene)}
              >
                <span className="context-menu__icon" aria-hidden="true">
                  ☁️
                </span>
                {t("PF2E.Platform.Scene.Menu.Preload", "Preload")}
              </button>
              <button
                type="button"
                className="context-menu__item"
                role="menuitem"
                onClick={() => exportSceneData(activeMenuScene)}
                hidden={activeRole !== "gm"}
              >
                <span className="context-menu__icon" aria-hidden="true">
                  ⬇️
                </span>
                {t("PF2E.Platform.Scene.Menu.Export", "Export Data")}
              </button>
              <button
                type="button"
                className="context-menu__item"
                role="menuitem"
                onClick={() => requestSceneImport(activeMenuScene)}
                hidden={activeRole !== "gm"}
              >
                <span className="context-menu__icon" aria-hidden="true">
                  ⬆️
                </span>
                {t("PF2E.Platform.Scene.Menu.Import", "Import Data")}
              </button>
              <button
                type="button"
                className="context-menu__item"
                role="menuitem"
                onClick={() => copyScene(activeMenuScene)}
                hidden={activeRole !== "gm"}
              >
                <span className="context-menu__icon" aria-hidden="true">
                  📄
                </span>
                {t("PF2E.Platform.Scene.Menu.Copy", "Duplicate")}
              </button>
              <button
                type="button"
                className="context-menu__item context-menu__item--danger"
                role="menuitem"
                onClick={() => deleteScene(activeMenuScene)}
                hidden={activeRole !== "gm"}
              >
                <span className="context-menu__icon" aria-hidden="true">
                  🗑
                </span>
                {t("PF2E.Platform.Scene.Menu.Delete", "Delete")}
              </button>
            </div>,
            document.body,
          )
        : null}

      {ownershipActor ? (
        <OwnershipModal
          key={ownershipActor.id}
          actor={ownershipActor}
          onClose={() => setOwnershipActor(null)}
        />
      ) : null}
    </div>
  );
}
