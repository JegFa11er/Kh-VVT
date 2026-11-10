import { useState } from "react";

import { VISIBILITIES } from "../ChatPanel.jsx";
import { useStore } from "../StoreContext.jsx";

const DEFAULT_DICE = "1d20";

/**
 * Compact chat composer shown while the right sidebar is collapsed.
 *
 * Step 4.8: players must be able to talk and roll dice without expanding the
 * whole sidebar. The server already resolves `/r` commands inline, so the
 * composer only needs to forward the same `room:chat-message` payload as the
 * full chat panel.
 */
export default function FloatingChatInput({ onExpand }) {
  const { networkClient } = useStore();
  const [text, setText] = useState("");
  const [visibilityIndex, setVisibilityIndex] = useState(0);
  const [error, setError] = useState("");
  const visibility = VISIBILITIES[visibilityIndex];

  const send = (value) => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed === "") {
      return;
    }
    if (!networkClient) {
      setError("Нет соединения с сервером.");
      return;
    }
    setError("");
    networkClient
      .sendChatMessage({ text: trimmed, visibility: visibility.id })
      .then(() => setText(""))
      .catch((sendError) => {
        setError(sendError.message || "Не удалось отправить сообщение.");
      });
  };

  const handleSubmit = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    send(text);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      send(text);
    }
  };

  const cycleVisibility = () => {
    setVisibilityIndex((current) => (current + 1) % VISIBILITIES.length);
  };

  const roll = () => {
    send("/r " + DEFAULT_DICE);
  };

  return (
    <form
      className="floating-chat"
      onSubmit={handleSubmit}
      aria-label="Быстрый ввод чата"
    >
      <button
        type="button"
        className="floating-chat__icon-button"
        title={visibility.title}
        aria-label={visibility.label}
        onClick={cycleVisibility}
      >
        {visibility.icon}
      </button>

      <textarea
        className="floating-chat__input"
        rows={1}
        value={text}
        placeholder="Сообщение… или /r 1d20"
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
      />

      <button
        type="button"
        className="floating-chat__icon-button floating-chat__dice"
        title={"Бросить " + DEFAULT_DICE}
        aria-label={"Бросить " + DEFAULT_DICE}
        onClick={roll}
      >
        🎲
      </button>

      <button
        type="submit"
        className="floating-chat__icon-button floating-chat__send"
        title="Отправить (Enter)"
        aria-label="Отправить сообщение"
        disabled={text.trim() === ""}
      >
        ➤
      </button>

      {onExpand ? (
        <button
          type="button"
          className="floating-chat__icon-button floating-chat__expand"
          title="Развернуть панель чата"
          aria-label="Развернуть панель чата"
          onClick={onExpand}
        >
          ⤢
        </button>
      ) : null}

      {error ? (
        <span className="floating-chat__error" role="alert">
          {error}
        </span>
      ) : null}
    </form>
  );
}
