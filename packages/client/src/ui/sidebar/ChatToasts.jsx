import { useEffect, useRef, useState } from "react";

import { useStore } from "../StoreContext.jsx";

const TOAST_DURATION_MS = 7000;
const MAX_VISIBLE_TOASTS = 4;

function messageExcerpt(message) {
  if (!message || message.hidden) {
    return "Скрытое сообщение";
  }
  if (message.dice) {
    const formula = message.dice.formula || "d20";
    if (message.dice.hidden) {
      return formula + " · результат скрыт";
    }
    return formula + " = " + message.dice.total;
  }
  if (typeof message.text === "string" && message.text.trim() !== "") {
    return message.text.trim();
  }
  if (message.image) {
    return "🖼 Изображение";
  }
  return "Новое сообщение";
}

/**
 * Floating chat notifications (Step 4.5).
 *
 * The component subscribes to the same viewer-filtered `room:chat-update`
 * stream as the chat panel, tracks the set of already seen message ids and
 * raises a toast for genuinely new messages while the Chat tab is inactive or
 * the sidebar is collapsed. Every toast removes itself after exactly 7 s.
 */
export default function ChatToasts({ active, collapsed, onOpenChat }) {
  const { networkClient } = useStore();
  const [toasts, setToasts] = useState([]);
  const seenIdsRef = useRef(null);
  const activeRef = useRef(active);
  const collapsedRef = useRef(collapsed);
  const timersRef = useRef(new Map());
  const sequenceRef = useRef(0);

  activeRef.current = active;
  collapsedRef.current = collapsed;

  useEffect(() => {
    if (!networkClient || typeof networkClient.onChatUpdate !== "function") {
      return undefined;
    }

    const dismiss = (toastId) => {
      const timer = timersRef.current.get(toastId);
      if (timer) {
        clearTimeout(timer);
        timersRef.current.delete(toastId);
      }
      setToasts((current) => current.filter((toast) => toast.id !== toastId));
    };

    const unsubscribe = networkClient.onChatUpdate((nextChatLog) => {
      const log = Array.isArray(nextChatLog) ? nextChatLog : [];
      const currentIds = new Set(log.map((message) => message.id));

      // The first payload is the history replay on join; use it as a baseline
      // so old messages never produce a burst of toasts.
      if (seenIdsRef.current === null) {
        seenIdsRef.current = currentIds;
        return;
      }

      const seen = seenIdsRef.current;
      seenIdsRef.current = currentIds;

      if (activeRef.current && !collapsedRef.current) {
        return;
      }

      const fresh = log.filter((message) => !seen.has(message.id));
      if (fresh.length === 0) {
        return;
      }

      const created = fresh
        .slice(-MAX_VISIBLE_TOASTS)
        .map((message) => {
          sequenceRef.current += 1;
          return {
            id: "toast-" + sequenceRef.current,
            message,
            author: (message.author && message.author.name) || "Игрок",
            color: (message.author && message.author.color) || "#f2c94c",
            excerpt: messageExcerpt(message),
            avatar: message.author && message.author.avatar,
          };
        });

      if (created.length === 0) {
        return;
      }

      setToasts((current) => [...current, ...created].slice(-MAX_VISIBLE_TOASTS));
      for (const toast of created) {
        const timer = setTimeout(() => {
          timersRef.current.delete(toast.id);
          setToasts((current) =>
            current.filter((entry) => entry.id !== toast.id),
          );
        }, TOAST_DURATION_MS);
        timersRef.current.set(toast.id, timer);
      }
    });

    return () => {
      unsubscribe();
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer);
      }
      timersRef.current.clear();
    };
  }, [networkClient]);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="chat-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className="chat-toast"
          title="Открыть чат"
          onClick={() => {
            setToasts((current) =>
              current.filter((entry) => entry.id !== toast.id),
            );
            if (onOpenChat) {
              onOpenChat();
            }
          }}
        >
          <span
            className="chat-toast__avatar"
            style={{ borderColor: toast.color, color: toast.color }}
            aria-hidden="true"
          >
            {toast.avatar ? (
              <img src={toast.avatar} alt="" />
            ) : (
              toast.author.slice(0, 2).toUpperCase()
            )}
          </span>
          <span className="chat-toast__body">
            <span
              className="chat-toast__author"
              style={{ color: toast.color }}
            >
              {toast.author}
            </span>
            <span className="chat-toast__text">{toast.excerpt}</span>
          </span>
          <span className="chat-toast__close" aria-hidden="true">
            ×
          </span>
        </button>
      ))}
    </div>
  );
}
