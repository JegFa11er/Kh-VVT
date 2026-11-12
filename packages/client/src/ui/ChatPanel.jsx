import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { formatMessage, useTranslation } from "./i18n.js";
import { useStore } from "./StoreContext.jsx";
import {
  prepareActorData,
  saveModifier,
} from "./windows/character/character-data.js";

/**
 * Right-hand chat sidebar (Step 4.4).
 *
 * Messages come from the viewer-filtered `room:chat-update` broadcast. The
 * composer supports Foundry-style visibility modes and drag-and-drop image
 * uploads; the server rolls inline `/r NdX` commands so every client sees the
 * same result.
 */

export const VISIBILITIES = [
  {
    id: "public",
    icon: "🌐",
    labelKey: "PF2E.Platform.Chat.Visibility.Public",
    labelFallback: "Public",
    titleKey: "PF2E.Platform.Chat.Visibility.PublicTitle",
    titleFallback: "Public message — everyone can see it",
  },
  {
    id: "gm",
    icon: "🎭",
    labelKey: "PF2E.Platform.Chat.Visibility.Gm",
    labelFallback: "GM Only",
    titleKey: "PF2E.Platform.Chat.Visibility.GmTitle",
    titleFallback: "GM only — only the GM can see it",
  },
  {
    id: "blind",
    icon: "👁️‍🗨️",
    labelKey: "PF2E.Platform.Chat.Visibility.Blind",
    labelFallback: "Blind Roll",
    titleKey: "PF2E.Platform.Chat.Visibility.BlindTitle",
    titleFallback: "Blind roll: the GM and the author see the result",
  },
  {
    id: "self",
    icon: "👤",
    labelKey: "PF2E.Platform.Chat.Visibility.Self",
    labelFallback: "Self Only",
    titleKey: "PF2E.Platform.Chat.Visibility.SelfTitle",
    titleFallback: "Self only — only the author can see this message",
  },
];

export const VISIBILITY_LABELS = {
  public: "🌐",
  gm: "🎭",
  blind: "👁️‍🗨️",
  self: "👤",
};

const IMAGE_TYPES = /^image\/(png|jpe?g)$/i;

function formatTime(timestamp, language) {
  const date = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString(language === "en" ? "en-US" : "ru-RU", {
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
  const { t } = useTranslation();
  if (!dice) {
    return null;
  }

  return (
    <div className={"chat-dice" + (dice.hidden ? " chat-dice--hidden" : "")}>
      <div className="chat-dice__formula">{dice.formula}</div>
      {dice.hidden ? (
        <div
          className="chat-dice__total"
          title={t("PF2E.Platform.Chat.HiddenResult", "Result hidden")}
        >
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

const CHAT_SAVE_KEYS = {
  fortitude: ["PF2E.Platform.Chat.Save.Fortitude", "Fortitude"],
  reflex: ["PF2E.Platform.Chat.Save.Reflex", "Reflex"],
  will: ["PF2E.Platform.Chat.Save.Will", "Will"],
};

function chatSaveLabel(saveType, t) {
  const entry = CHAT_SAVE_KEYS[saveType];
  if (!entry) {
    return t("PF2E.Platform.Chat.Save.Default", "Saving Throw");
  }
  return t(entry[0], entry[1]);
}

/**
 * Step 5.6: interactive spell/attack card. The stored JSON is validated by the
 * server; the buttons act on the tokens currently selected on the canvas.
 */
function ChatCard({ card, onSave, onDamage, t }) {
  if (!card) {
    return null;
  }
  const saveLabel = chatSaveLabel(card.saveType, t);
  const hasSave = Boolean(card.saveType && card.dc);
  const hasDamage = Boolean(card.damageFormula);
  if (!hasSave && !hasDamage) {
    return null;
  }
  return (
    <div className="chat-card">
      {card.name ? <div className="chat-card__title">✦ {card.name}</div> : null}
      <div className="chat-card__actions">
        {hasSave ? (
          <button
            type="button"
            className="chat-card__button chat-card__button--save"
            title={formatMessage(
              t(
                "PF2E.Platform.Chat.SaveTitle",
                'Roll a {save} save for each selected token against DC {dc}',
              ),
              { save: saveLabel, dc: card.dc },
            )}
            onClick={onSave}
          >
            DC {card.dc} · {saveLabel}
          </button>
        ) : null}
        {hasDamage ? (
          <button
            type="button"
            className="chat-card__button chat-card__button--damage"
            title={formatMessage(
              t(
                "PF2E.Platform.Chat.DamageTitle",
                "Roll damage: {formula}",
              ),
              { formula: card.damageFormula },
            )}
            onClick={onDamage}
          >
            {formatMessage(
              t(
                "PF2E.Platform.Chat.DamageButton",
                "Roll damage: {formula}",
              ),
              { formula: card.damageFormula },
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function ChatPanel({ embedded = false }) {
  const { networkClient, chatLog = [], activeRole, directories, combatState } = useStore();
  const { t, language } = useTranslation();
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
      setError(
        t("PF2E.Platform.Chat.NoConnection", "No connection to the server."),
      );
      return Promise.reject(new Error("NetworkClient is not connected."));
    }
    return networkClient.sendChatMessage(data).catch((sendError) => {
      setError(
        sendError.message ||
          t("PF2E.Platform.Chat.SendFailed", "Failed to send the message."),
      );
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
      setError(
        t(
          "PF2E.Platform.Chat.ImageOnly",
          "Only PNG or JPEG images can be dropped here.",
        ),
      );
      return;
    }
    if (!networkClient) {
      setError(
        t("PF2E.Platform.Chat.NoConnection", "No connection to the server."),
      );
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
      setError(
        uploadError.message ||
          t("PF2E.Platform.Chat.UploadFailed", "Failed to upload the image."),
      );
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

  /**
   * Step 5.6: card actions operate on `tokenLayer.selectedIds`. Each selected
   * token is resolved to its directory actor (when linked) so the roll uses the
   * character's real save modifier.
   */
  const selectedTokens = () => {
    const layer =
      typeof window !== "undefined" && window.pf2e ? window.pf2e.tokenLayer : null;
    if (!layer || !layer.selectedIds) {
      return [];
    }
    const ids =
      layer.selectedIds instanceof Set
        ? Array.from(layer.selectedIds)
        : Array.isArray(layer.selectedIds)
          ? layer.selectedIds
          : [];
    return ids.map((id) => {
      const token =
        layer.tokens && typeof layer.tokens.get === "function"
          ? layer.tokens.get(id) || null
          : null;
      const actor = token && token.actorData ? token.actorData : null;
      const actorId =
        (token && token.actorId) ||
        (token && token.combatantData && token.combatantData.actorId) ||
        null;
      return { id, token, actor, actorId };
    });
  };

  const rollCardSave = (card) => {
    if (!card || !card.saveType || !card.dc) {
      return;
    }
    const targets = selectedTokens();
    if (targets.length === 0) {
      setError(
        t(
          "PF2E.Platform.Chat.SelectToken",
          "Select at least one token on the scene to roll a save.",
        ),
      );
      return;
    }
    setError("");
    const actors = directories?.actors?.entries || [];
    const combatants = Array.isArray(combatState?.combatants)
      ? combatState.combatants
      : [];
    const label = chatSaveLabel(card.saveType, t);
    const rolls = targets.map((target) => {
      const actor =
        target.actor ||
        (target.actorId ? actors.find((entry) => entry.id === target.actorId) : null);
      let name = target.token?.combatantData?.name || target.id;
      let modifier = 0;
      if (actor) {
        name = actor.name || name;
        const prepared = prepareActorData(actor);
        modifier = saveModifier(prepared.system, card.saveType);
      } else {
        const combatant = combatants.find(
          (entry) =>
            entry &&
            (entry.id === target.id ||
              (target.actorId && entry.actorId === target.actorId)),
        );
        if (combatant) {
          name = combatant.name || name;
          modifier = Number(combatant.saves?.[card.saveType]) || 0;
        }
      }
      const bonus = modifier >= 0 ? "+" + modifier : String(modifier);
      const dcLabel = t("PF2E.Platform.Chat.DCShort", "DC");
      return {
        text:
          "/r 1d20" +
          bonus +
          " " +
          name +
          " — " +
          label +
          " (" +
          dcLabel +
          " " +
          card.dc +
          ")",
      };
    });
    Promise.allSettled(
      rolls.map((roll) => sendMessage({ text: roll.text, visibility: "public" })),
    ).catch(() => {});
  };

  const rollCardDamage = (card) => {
    if (!card || !card.damageFormula) {
      return;
    }
    const match = String(card.damageFormula).match(
      /\d{1,3}\s*d\s*\d{1,4}(?:\s*[+-]\s*\d{1,4})?/i,
    );
    const formula = match ? match[0] : String(card.damageFormula);
    const damageLabel = t("PF2E.Platform.Chat.DamageLabel", "damage");
    setError("");
    sendMessage({
      text:
        "/r " +
        formula +
        " " +
        (card.name || t("PF2E.Platform.Chat.DamageName", "Damage")) +
        " — " +
        damageLabel,
      visibility: "public",
    }).catch(() => {});
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

  const visibilityTitle = (visibilityId) => {
    const entry = VISIBILITIES.find((item) => item.id === visibilityId);
    return entry ? t(entry.titleKey, entry.titleFallback) : visibilityId;
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
            {t("PF2E.Platform.Chat.Unpin", "Unpin message")}
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
            {t("PF2E.Platform.Chat.MakePrivate", "Make private")}
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
            {t("PF2E.Platform.Chat.DeleteMessage", "Delete message")}
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
                🗑️ {t("PF2E.Platform.Chat.ClearTitle", "Clear Chat")}
              </h2>
            </div>
            <div className="modal-window__body">
              <p className="chat-confirm__question">
                {t(
                  "PF2E.Platform.Chat.ClearQuestion",
                  "Are you sure you want to clear the entire chat?",
                )}
              </p>
            </div>
            <div className="modal-window__footer">
              <button
                type="button"
                className="ui-button"
                onClick={() => setConfirmClear(false)}
              >
                {t("PF2E.Platform.Common.No", "No")}
              </button>
              <button
                type="button"
                className="ui-button ui-button--primary"
                onClick={handleClear}
              >
                {t("PF2E.Platform.Common.Yes", "Yes")}
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
      aria-label={t("PF2E.Platform.Chat.Title", "Chat")}
    >
      {!isCollapsed ? (
        <>
          <div className="chat-panel__header">
            <span className="chat-panel__title">
              <span aria-hidden="true">💬</span>{" "}
              {t("PF2E.Platform.Chat.Title", "Chat")}
            </span>
            <span
              className="chat-panel__count"
              title={t("PF2E.Platform.Chat.MessagesTitle", "Messages in the log")}
            >
              {messages.length}
            </span>
          </div>

          <div className="chat-panel__log" ref={logRef}>
            {messages.length === 0 ? (
              <div className="chat-panel__empty">
                {t(
                  "PF2E.Platform.Chat.Empty",
                  "No messages yet. Type a message or roll dice from the HUD.",
                )}
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
                              ? t("PF2E.Platform.Chat.CharacterPrefix", "Character") +
                                ": " +
                                author.characterName
                              : author.name
                          }
                        >
                          {author.name ||
                            t("PF2E.Platform.Players.RolePlayer", "Player")}
                        </span>
                        <span className="chat-message__time">
                          {formatTime(message.timestamp, language)}
                        </span>
                        {message.visibility &&
                        message.visibility !== "public" ? (
                          <span
                            className="chat-message__visibility"
                            title={visibilityTitle(message.visibility)}
                          >
                            {VISIBILITY_LABELS[message.visibility] ||
                              message.visibility}
                          </span>
                        ) : null}
                        {isPinned ? (
                          <span
                            className="chat-message__pin"
                            title={t("PF2E.Platform.Chat.Pinned", "Pinned")}
                          >
                            📌
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className="chat-message__delete"
                          title={t(
                            "PF2E.Platform.Chat.DeleteMessage",
                            "Delete message",
                          )}
                          aria-label={t(
                            "PF2E.Platform.Chat.DeleteMessage",
                            "Delete message",
                          )}
                          onClick={() => handleDelete(message)}
                        >
                          🗑️
                        </button>
                      </div>

                      {message.hidden ? (
                        <div
                          className="chat-message__hidden-text"
                          title={t(
                            "PF2E.Platform.Chat.HiddenContent",
                            "Content hidden by the visibility settings",
                          )}
                        >
                          ?{" "}
                          <span>
                            {t(
                              "PF2E.Platform.Chat.HiddenMessage",
                              "Hidden message",
                            )}
                          </span>
                        </div>
                      ) : (
                        <>
                          {message.text ? (
                            <div className="chat-message__text">
                              {message.text}
                            </div>
                          ) : null}
                          <DiceResult dice={message.dice} />
                          {message.card ? (
                            <ChatCard
                              card={message.card}
                              t={t}
                              onSave={() => rollCardSave(message.card)}
                              onDamage={() => rollCardDamage(message.card)}
                            />
                          ) : null}
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
                                alt={t(
                                  "PF2E.Platform.Chat.ImageAlt",
                                  "Chat image",
                                )}
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
              placeholder={t(
                "PF2E.Platform.Chat.Placeholder",
                "Message…  /r 1d20  (Shift+Enter for a new line)",
              )}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={handleKeyDown}
            />
            <div className="chat-panel__hint">
              {uploading
                ? t("PF2E.Platform.Chat.Uploading", "Uploading image…")
                : t(
                    "PF2E.Platform.Chat.DropHint",
                    "Drop a PNG or JPEG here to attach an image.",
                  )}
            </div>
          </div>

          <div className="chat-panel__controls">
            <div
              className="chat-panel__visibility"
              role="group"
              aria-label={t(
                "PF2E.Platform.Chat.VisibilityAria",
                "Message visibility",
              )}
            >
              {VISIBILITIES.map((entry) => {
                const label = t(entry.labelKey, entry.labelFallback);
                const title = t(entry.titleKey, entry.titleFallback);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={
                      "chat-panel__visibility-button" +
                      (visibility === entry.id
                        ? " chat-panel__visibility-button--active"
                        : "")
                    }
                    title={title}
                    aria-label={label}
                    aria-pressed={visibility === entry.id}
                    data-visibility={entry.id}
                    onClick={() => setVisibility(entry.id)}
                  >
                    <span aria-hidden="true">{entry.icon}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className="chat-panel__action chat-panel__action--clear"
              title={
                activeRole === "gm"
                  ? t("PF2E.Platform.Chat.Clear", "Clear chat")
                  : t(
                      "PF2E.Platform.Chat.ClearGmOnly",
                      "Clear the entire chat (GM only)",
                    )
              }
              aria-label={t("PF2E.Platform.Chat.Clear", "Clear chat")}
              onClick={() => setConfirmClear(true)}
            >
              🗑️
            </button>

            <button
              type="button"
              className="chat-panel__action chat-panel__action--send"
              title={t(
                "PF2E.Platform.Chat.SendTitle",
                "Send message (Enter)",
              )}
              aria-label={t("PF2E.Platform.Chat.Send", "Send message")}
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
          title={
            collapsed
              ? t("PF2E.Platform.Chat.Expand", "Expand chat")
              : t("PF2E.Platform.Chat.Collapse", "Collapse chat")
          }
          aria-label={
            collapsed
              ? t("PF2E.Platform.Chat.Expand", "Expand chat")
              : t("PF2E.Platform.Chat.Collapse", "Collapse chat")
          }
          onClick={() => setCollapsed((current) => !current)}
        >
          <span aria-hidden="true">{collapsed ? "▲" : "▼"}</span>
          {collapsed ? (
            <span className="chat-panel__toggle-label">
              {t("PF2E.Platform.Chat.Title", "Chat")}
            </span>
          ) : null}
        </button>
      ) : null}

      {menu}
      {clearDialog}
    </aside>
  );
}
