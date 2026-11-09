import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useStore } from "./StoreContext.jsx";

/**
 * Right-hand chat sidebar (Step 4.4).
 *
 * Messages come from the viewer-filtered `room:chat-update` broadcast. The
 * composer supports Foundry-style visibility modes and drag-and-drop image
 * uploads; the server rolls inline `/r NdX` commands so every client sees the
 * same result.
 */

const VISIBILITIES = [
  {
    id: "public",
    icon: "🌐",
    label: "Public",
    title: "Публичное сообщение — видят все",
  },
  {
    id: "gm",
    icon: "🎭",
    label: "GM Only",
    title: "Только для мастера",
  },
  {
    id: "blind",
    icon: "👁️‍🗨️",
    label: "Blind GM",
    title: "Слепой бросок: результат видят мастер и автор",
  },
  {
    id: "self",
    icon: "👤",
    label: "Self",
    title: "Личное сообщение — видит только автор",
  },
];

const VISIBILITY_LABELS = {
  public: "🌐",
  gm: "🎭",
  blind: "👁️‍🗨️",
  self: "👤",
};

const IMAGE_TYPES = /^image\/(png|jpe?g)$/i;

function formatTime(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initials(name) {
  const value = typeof name === "string" && name.trim() !== "" ? name.trim() : "?";
  return value.slice(0, 2).toUpperCase();
}

function MessageAvatar({ author }) {
  const [failed, setFailed] = useState(false);
  const color = (author && author.color) || "#4caf70";
  const avatar = author && author.avatar;

  if (avatar && !failed) {
    return (
      <img
        className="chat-message__avatar"
        src={avatar}
        alt={author.name}
        style={{ borderColor: color }}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className="chat-message__avatar chat-message__avatar--initials"
      style={{ borderColor: color, color: color }}
      aria-hidden="true"
    >
      {initials(author && author.name)}
    </span>
  );
}

function DiceResult({ dice }) {
  if (!dice) {
    return null;
  }

  return (
    <div className={"chat-dice" + (dice.hidden ? " chat-dice--hidden" : "")}>
      <div className="chat-dice__formula">{dice.formula}</div>
      {dice.hidden ? (
        <div className="chat-dice__total" title="Результат скрыт">
          ?
        </div>
      ) : (
        <>
          <div className="chat-dice__rolls">
            {(dice.rolls || []).map((roll, index) => (
              <span
                key={index}
                className={
                  "chat-dice__die" +
                  (roll === dice.sides ? " chat-dice__die--max" : "") +
                  (roll === 1 ? " chat-dice__die--min" : "")
                }
                title={"d" + dice.sides + ": " + roll}
              >
                {roll}
              </span>
            ))}
          </div>
          <div className="chat-dice__total">
            = {dice.total}
            {dice.modifier ? (
              <span className="chat-dice__modifier">
                {" "}
                ({dice.modifier > 0 ? "+" : ""}
                {dice.modifier})
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

export default function ChatPanel({ embedded = false }) {
  const { networkClient, chatLog = [], activeRole } = useStore();
  const [collapsed, setCollapsed] = useState(false);
  // In the Step 4.5 sidebar the icon-bar owns collapse/expand; the chat panel
  // itself fills the tab body instead of being positioned on the right edge.
  const isCollapsed = embedded ? false : collapsed;
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [contextMenu, setContextMenu] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pinnedIds, setPinnedIds] = useState(() => new Set());

  const logRef = useRef(null);

  // Surface server-side rejections (e.g. a player trying to clear the chat).
  useEffect(() => {
    if (!networkClient || typeof networkClient.on !== "function") {
      return undefined;
    }
    return networkClient.on("error", (payload) => {
      if (payload && payload.message) {
        setError(payload.message);
      }
    });
  }, [networkClient]);

  const messages = useMemo(
    () => (Array.isArray(chatLog) ? chatLog : []),
    [chatLog],
  );

  // Auto-scroll to the newest message.
  useEffect(() => {
    if (isCollapsed) {
      return;
    }
    const log = logRef.current;
    if (log) {
      log.scrollTop = log.scrollHeight;
    }
  }, [messages, isCollapsed]);

  // Close the context menu on outside click / Escape.
  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }
    const close = () => setContextMenu(null);
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  const sendMessage = (data) => {
    if (!networkClient) {
      setError("Нет соединения с сервером.");
      return Promise.reject(new Error("NetworkClient is not connected."));
    }
    return networkClient.sendChatMessage(data).catch((sendError) => {
      setError(sendError.message || "Не удалось отправить сообщение.");
      throw sendError;
    });
  };

  const handleSubmit = (event) => {
    if (event) {
      event.preventDefault();
    }
    const value = text.trim();
    if (value === "") {
      return;
    }
    setError("");
    sendMessage({ text: value, visibility })
      .then(() => setText(""))
      .catch(() => {});
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const uploadImage = async (file) => {
    if (!file) {
      return;
    }
    if (!IMAGE_TYPES.test(file.type) && !/\.(png|jpe?g)$/i.test(file.name || "")) {
      setError("Можно перетаскивать только изображения PNG или JPEG.");
      return;
    }
    if (!networkClient) {
      setError("Нет соединения с сервером.");
      return;
    }

    setUploading(true);
    setError("");
    try {
      const uploaded = await networkClient.uploadChatImage(file);
      await sendMessage({
        text: text.trim(),
        image: uploaded.url,
        visibility,
      });
      setText("");
    } catch (uploadError) {
      setError(uploadError.message || "Не удалось загрузить изображение.");
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    const files = event.dataTransfer && event.dataTransfer.files;
    if (!files || files.length === 0) {
      return;
    }
    uploadImage(files[0]);
  };

  const handleDelete = (message) => {
    setContextMenu(null);
    if (!networkClient) {
      return;
    }
    networkClient.deleteChatMessage(message.id);
  };

  const handleMakePrivate = (message) => {
    setContextMenu(null);
    if (!networkClient) {
      return;
    }
    networkClient.setChatVisibility(message.id, "gm");
  };

  const handleTogglePin = (message) => {
    setContextMenu(null);
    setPinnedIds((current) => {
      const next = new Set(current);
      if (next.has(message.id)) {
        next.delete(message.id);
      } else {
        next.add(message.id);
      }
      return next;
    });
  };

  const handleClear = () => {
    setConfirmClear(false);
    if (!networkClient) {
      return;
    }
    networkClient.clearChat();
  };

  const handleContextMenu = (event, message) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 230),
      y: Math.min(event.clientY, window.innerHeight - 130),
      message,
    });
  };

  const menu = contextMenu
    ? createPortal(
        <div
          className="context-menu chat-context-menu"
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          onClick={(event) => event.stopPropagation()}
          role="menu"
        >
          <button
            type="button"
            className="context-menu__item"
            onClick={() => handleTogglePin(contextMenu.message)}
            role="menuitem"
          >
            <span className="context-menu__icon" aria-hidden="true">
              📌
            </span>
            Открепить сообщение
          </button>
          <button
            type="button"
            className="context-menu__item"
            onClick={() => handleMakePrivate(contextMenu.message)}
            role="menuitem"
          >
            <span className="context-menu__icon" aria-hidden="true">
              🔒
            </span>
            Сделать приватным
          </button>
          <button
            type="button"
            className="context-menu__item context-menu__item--danger"
            onClick={() => handleDelete(contextMenu.message)}
            role="menuitem"
          >
            <span className="context-menu__icon" aria-hidden="true">
              🗑️
            </span>
            Удалить
          </button>
        </div>,
        document.body,
      )
    : null;

  const clearDialog = confirmClear
    ? createPortal(
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-window chat-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-clear-title"
          >
            <div className="modal-window__header">
              <h2 className="modal-window__title" id="chat-clear-title">
                🗑️ Очистка чата
              </h2>
            </div>
            <div className="modal-window__body">
              <p className="chat-confirm__question">
                Вы уверены, что хотите очистить весь чат?
              </p>
            </div>
            <div className="modal-window__footer">
              <button
                type="button"
                className="ui-button"
                onClick={() => setConfirmClear(false)}
              >
                Нет
              </button>
              <button
                type="button"
                className="ui-button ui-button--primary"
                onClick={handleClear}
              >
                Да
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <aside
      className={
        "chat-panel" +
        (embedded ? " chat-panel--embedded" : "") +
        (isCollapsed ? " chat-panel--collapsed" : "")
      }
      aria-label="Чат"
    >
      {!isCollapsed ? (
        <>
          <div className="chat-panel__header">
            <span className="chat-panel__title">
              <span aria-hidden="true">💬</span> Чат
            </span>
            <span className="chat-panel__count" title="Сообщений в логе">
              {messages.length}
            </span>
          </div>

          <div className="chat-panel__log" ref={logRef}>
            {messages.length === 0 ? (
              <div className="chat-panel__empty">
                Сообщений пока нет. Введите текст или бросьте кубик из HUD.
              </div>
            ) : (
              messages.map((message) => {
                const author = message.author || {};
                const isPinned = pinnedIds.has(message.id);
                return (
                  <article
                    key={message.id}
                    className={
                      "chat-message" +
                      (isPinned ? " chat-message--pinned" : "") +
                      (message.hidden ? " chat-message--hidden" : "")
                    }
                    onContextMenu={(event) => handleContextMenu(event, message)}
                  >
                    <MessageAvatar author={author} />
                    <div className="chat-message__body">
                      <div className="chat-message__meta">
                        <span
                          className="chat-message__author"
                          style={{ color: author.color || "#f2d59b" }}
                          title={
                            author.characterName
                              ? "Персонаж: " + author.characterName
                              : author.name
                          }
                        >
                          {author.name || "Игрок"}
                        </span>
                        <span className="chat-message__time">
                          {formatTime(message.timestamp)}
                        </span>
                        {message.visibility &&
                        message.visibility !== "public" ? (
                          <span
                            className="chat-message__visibility"
                            title={
                              VISIBILITIES.find(
                                (entry) => entry.id === message.visibility,
                              )?.title || message.visibility
                            }
                          >
                            {VISIBILITY_LABELS[message.visibility] ||
                              message.visibility}
                          </span>
                        ) : null}
                        {isPinned ? (
                          <span className="chat-message__pin" title="Закреплено">
                            📌
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className="chat-message__delete"
                          title="Удалить сообщение"
                          aria-label="Удалить сообщение"
                          onClick={() => handleDelete(message)}
                        >
                          🗑️
                        </button>
                      </div>

                      {message.hidden ? (
                        <div
                          className="chat-message__hidden-text"
                          title="Содержимое скрыто настройками видимости"
                        >
                          ? <span>Скрытое сообщение</span>
                        </div>
                      ) : (
                        <>
                          {message.text ? (
                            <div className="chat-message__text">
                              {message.text}
                            </div>
                          ) : null}
                          <DiceResult dice={message.dice} />
                          {message.image ? (
                            <a
                              className="chat-message__image-link"
                              href={message.image}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <img
                                className="chat-message__image"
                                src={message.image}
                                alt="Изображение из чата"
                              />
                            </a>
                          ) : null}
                        </>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {error ? (
            <div className="chat-panel__error" role="alert">
              {error}
            </div>
          ) : null}

          <div
            className={
              "chat-panel__composer" +
              (dragging ? " chat-panel__composer--dragover" : "")
            }
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <textarea
              className="chat-panel__input"
              rows={2}
              value={text}
              placeholder="Сообщение…  /r 1d20  (Shift+Enter — новая строка)"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={handleKeyDown}
            />
            <div className="chat-panel__hint">
              {uploading
                ? "Загрузка изображения…"
                : "Перетащите сюда PNG или JPEG, чтобы прикрепить картинку."}
            </div>
          </div>

          <div className="chat-panel__controls">
            <div
              className="chat-panel__visibility"
              role="group"
              aria-label="Видимость сообщения"
            >
              {VISIBILITIES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={
                    "chat-panel__visibility-button" +
                    (visibility === entry.id
                      ? " chat-panel__visibility-button--active"
                      : "")
                  }
                  title={entry.title}
                  aria-label={entry.label}
                  aria-pressed={visibility === entry.id}
                  data-visibility={entry.id}
                  onClick={() => setVisibility(entry.id)}
                >
                  <span aria-hidden="true">{entry.icon}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              className="chat-panel__action chat-panel__action--clear"
              title={
                activeRole === "gm"
                  ? "Очистить весь чат"
                  : "Очистить весь чат (только мастер)"
              }
              aria-label="Очистить чат"
              onClick={() => setConfirmClear(true)}
            >
              🗑️
            </button>

            <button
              type="button"
              className="chat-panel__action chat-panel__action--send"
              title="Отправить сообщение (Enter)"
              aria-label="Отправить сообщение"
              onClick={handleSubmit}
              disabled={text.trim() === ""}
            >
              ➤
            </button>
          </div>
        </>
      ) : null}

      {!embedded ? (
        <button
          type="button"
          className="chat-panel__toggle"
          title={collapsed ? "Развернуть чат" : "Свернуть чат"}
          aria-label={collapsed ? "Развернуть чат" : "Свернуть чат"}
          onClick={() => setCollapsed((current) => !current)}
        >
          <span aria-hidden="true">{collapsed ? "▲" : "▼"}</span>
          {collapsed ? <span className="chat-panel__toggle-label">Чат</span> : null}
        </button>
      ) : null}

      {menu}
      {clearDialog}
    </aside>
  );
}
