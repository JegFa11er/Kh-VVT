import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { useStore } from "../StoreContext.jsx";
import { ACTOR_TOKEN_PAYLOAD_TYPE, setDragPayload } from "../drag-payloads.js";

const PLACEHOLDER_IMAGE = "/assets/ui/item-placeholder.svg";
const DEFAULT_FOLDER_COLOR = "#3a4356";

const DIRECTORY_CONFIG = {
  scenes: {
    icon: "🗺️",
    title: "Сцены",
    createLabel: "Создать сцену",
    createTitle: "Создание: Сцена",
    searchPlaceholder: "Поиск в сценах…",
    emptyLabel: "Сцен пока нет.",
  },
  actors: {
    icon: "👤",
    title: "Актёры",
    createLabel: "Создать актёра",
    createTitle: "Создание: Актёр",
    searchPlaceholder: "Поиск в актёрах…",
    emptyLabel: "Актёров пока нет.",
  },
  items: {
    icon: "💼",
    title: "Предметы",
    createLabel: "Создать предмет",
    createTitle: "Создание: Предмет",
    searchPlaceholder: "Поиск в предметах…",
    emptyLabel: "Предметов пока нет.",
  },
  journals: {
    icon: "📖",
    title: "Журналы",
    createLabel: "Создать запись",
    createTitle: "Создание: Запись",
    searchPlaceholder: "Поиск в журналах…",
    emptyLabel: "Записей пока нет.",
  },
};

function sortByName(a, b) {
  return String(a.name || "").localeCompare(String(b.name || ""), "ru", {
    sensitivity: "base",
  });
}

function actorSubtitle(entry) {
  const level = Number.isFinite(Number(entry.level)) ? Number(entry.level) : 1;
  if (entry.actorType === "npc") {
    return "Существо " + level;
  }
  return level + "-й уровень";
}

function entrySubtitle(kind, entry) {
  if (kind === "actors") {
    return actorSubtitle(entry);
  }
  if (kind === "items") {
    return entry.itemType || "Предмет";
  }
  if (kind === "scenes") {
    return "Сцена";
  }
  if (kind === "journals") {
    const count = Array.isArray(entry.pages) ? entry.pages.length : 0;
    return count === 0 ? "Нет страниц" : count + " стр.";
  }
  return "";
}

function FolderModal({ kind, onCancel, onCreate }) {
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
            📁 Папка: Папка
          </h2>
        </header>
        <div className="modal-window__body">
          <label className="modal-field">
            <span className="modal-field__label">Название</span>
            <input
              className="ui-input"
              value={name}
              autoFocus
              placeholder="Название папки"
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="modal-field">
            <span className="modal-field__label">Цвет (HEX)</span>
            <span className="modal-color-row">
              <input
                type="color"
                className="modal-color-picker"
                value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_FOLDER_COLOR}
                onChange={(event) => setColor(event.target.value)}
                aria-label="Цвет папки"
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
            <legend className="modal-field__label">Сортировка</legend>
            <label className="directory-radio">
              <input
                type="radio"
                name="folder-sort"
                value="alpha"
                checked={sortMode === "alpha"}
                onChange={() => setSortMode("alpha")}
              />
              По алфавиту
            </label>
            <label className="directory-radio">
              <input
                type="radio"
                name="folder-sort"
                value="manual"
                checked={sortMode === "manual"}
                onChange={() => setSortMode("manual")}
              />
              Ручной порядок
            </label>
          </fieldset>
        </div>
        <footer className="modal-window__footer">
          <button type="button" className="ui-button" onClick={onCancel}>
            Отмена
          </button>
          <button
            type="submit"
            className="ui-button ui-button--primary"
            disabled={name.trim() === ""}
          >
            Создать папку
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}

function CreateEntryModal({ kind, folders, initialFolderId, onCancel, onCreate }) {
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
            <span className="modal-field__label">Название</span>
            <input
              className="ui-input"
              value={name}
              autoFocus
              placeholder="Название"
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          {kind === "actors" ? (
            <label className="modal-field">
              <span className="modal-field__label">Тип</span>
              <select
                className="ui-input"
                value={actorType}
                onChange={(event) => setActorType(event.target.value)}
              >
                <option value="character">Персонаж игрока</option>
                <option value="npc">Персонаж мастера</option>
              </select>
            </label>
          ) : null}

          {kind === "items" ? (
            <label className="modal-field">
              <span className="modal-field__label">Тип предмета</span>
              <select
                className="ui-input"
                value={itemType}
                onChange={(event) => setItemType(event.target.value)}
              >
                <option value="weapon">Оружие</option>
                <option value="armor">Броня</option>
                <option value="equipment">Снаряжение</option>
                <option value="consumable">Расходник</option>
                <option value="treasure">Сокровище</option>
                <option value="misc">Прочее</option>
              </select>
            </label>
          ) : null}

          <label className="modal-field">
            <span className="modal-field__label">Папка</span>
            <select
              className="ui-input"
              value={folderId}
              onChange={(event) => setFolderId(event.target.value)}
            >
              <option value="">Без папки</option>
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
            Отмена
          </button>
          <button
            type="submit"
            className="ui-button ui-button--primary"
            disabled={name.trim() === ""}
          >
            Создать
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
  onOpenJournal,
  onOpenActor,
  activeSceneId,
  onActivateScene,
}) {
  if (kind === "scenes") {
    const isActive = entry.id === activeSceneId;
    const activate = () => {
      if (typeof onActivateScene === "function") {
        onActivateScene(entry.id);
      }
    };
    return (
      <div
        className={
          "directory-scene-card" +
          (isActive ? " directory-scene-card--active" : "")
        }
        title={entry.name}
        role="button"
        tabIndex={0}
        aria-pressed={isActive}
        onClick={activate}
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
            {isActive ? "Активная сцена" : entry.folderId ? "В папке" : "Без папки"}
          </span>
        </span>
        <button
          type="button"
          className="ui-button directory-scene-card__activate"
          title={
            isActive
              ? '"' + entry.name + '" уже активна'
              : 'Активировать сцену "' + entry.name + '"'
          }
          aria-label={
            isActive
              ? "Сцена " + entry.name + " уже активна"
              : "Активировать сцену " + entry.name
          }
          onClick={(event) => {
            event.stopPropagation();
            activate();
          }}
        >
          {isActive ? "✓ Активна" : "Активировать"}
        </button>
      </div>
    );
  }

  const isJournal = kind === "journals";
  const isActor = kind === "actors";
  const openEntry = isJournal
    ? () => onOpenJournal(entry.id)
    : isActor && typeof onOpenActor === "function"
      ? () => onOpenActor(entry.id)
      : undefined;
  const actorDragProps = isActor
    ? {
        draggable: true,
        onDragStart: (event) =>
          setDragPayload(event, {
            type: ACTOR_TOKEN_PAYLOAD_TYPE,
            actorId: entry.id,
            name: entry.name,
            img: entry.img || null,
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
        (isActor ? " directory-entry--draggable" : "")
      }
      title={
        isActor
          ? entry.name + " — перетащите на холст, чтобы создать токен"
          : entry.name
      }
      onClick={openEntry}
      {...actorDragProps}
    >
      <span className="directory-entry__icon" aria-hidden="true">
        {kind === "actors"
          ? entry.actorType === "npc"
            ? "👹"
            : "🧙"
          : kind === "items"
            ? "🎒"
            : "📖"}
      </span>
      <span className="directory-entry__body">
        <span className="directory-entry__name">{entry.name}</span>
        <span className="directory-entry__meta">
          {entrySubtitle(kind, entry)}
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
  const { directories, networkClient, activeSceneId } = useStore();
  const config = DIRECTORY_CONFIG[kind];
  const directory = (directories && directories[kind]) || {
    folders: [],
    entries: [],
  };
  const [search, setSearch] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState(() => new Set());
  const [createState, setCreateState] = useState(null);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [error, setError] = useState("");

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
      setError("Нет соединения с сервером.");
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
      setError(createError.message || "Не удалось создать папку.");
    });
  };

  const createEntry = (data) => {
    setCreateState(null);
    if (!requireClient()) {
      return;
    }
    networkClient.createDirectoryEntry(kind, data).catch((createError) => {
      setError(createError.message || "Не удалось создать запись.");
    });
  };

  const activateScene = (sceneId) => {
    if (!requireClient()) {
      return;
    }
    networkClient.activateScene(sceneId).catch((activateError) => {
      setError(activateError.message || "Не удалось активировать сцену.");
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
            aria-label={collapsed ? "Развернуть папку" : "Свернуть папку"}
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
            title={'Создать в папке "' + folder.name + '"'}
            aria-label={'Создать в папке "' + folder.name + '"'}
            onClick={() => openCreate(folder.id)}
          >
            +
          </button>
        </div>
        {!collapsed ? (
          <div className="directory-folder__body">
            {folderEntries.length === 0 ? (
              <div className="directory-folder__empty">Папка пуста</div>
            ) : (
              folderEntries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  kind={kind}
                  entry={entry}
                  onOpenJournal={onOpenJournal}
                  onOpenActor={onOpenActor}
                  activeSceneId={activeSceneId}
                  onActivateScene={activateScene}
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
          📁 Создать папку
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
              <span className="directory-folder__name">Без папки</span>
              <span className="directory-folder__count">{unfiled.length}</span>
              <button
                type="button"
                className="directory-folder__add"
                title="Создать без папки"
                aria-label="Создать без папки"
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
                    onOpenJournal={onOpenJournal}
                    onOpenActor={onOpenActor}
                    activeSceneId={activeSceneId}
                    onActivateScene={activateScene}
                  />
                ))
              )}
            </div>
          </section>
        ) : null}

        {query !== "" && visibleCount === 0 && folders.length === 0 ? (
          <div className="directory-panel__empty">Ничего не найдено.</div>
        ) : null}
      </div>

      {folderModalOpen ? (
        <FolderModal
          kind={kind}
          onCancel={() => setFolderModalOpen(false)}
          onCreate={createFolder}
        />
      ) : null}

      {createState ? (
        <CreateEntryModal
          kind={kind}
          folders={directory.folders}
          initialFolderId={createState.folderId}
          onCancel={() => setCreateState(null)}
          onCreate={createEntry}
        />
      ) : null}
    </div>
  );
}
