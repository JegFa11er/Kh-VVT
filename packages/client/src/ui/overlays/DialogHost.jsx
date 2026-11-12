import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CONFIRM_EVENT, PROMPT_EVENT } from "./dialog-service.js";

function dialogTitle(entry) {
  return entry && entry.title ? entry.title : "Подтверждение";
}

/**
 * Step 5.8: game-styled confirmation dialog.
 *
 * Replaces every `window.confirm` call with a React modal rendered on top of
 * the canvas. The promise-based API lives in `dialog-service.js`, so canvas
 * layers and directory panels share exactly one implementation.
 */
export function ConfirmModal({ request, onResolve }) {
  if (!request) {
    return null;
  }
  return createPortal(
    <div className="modal-backdrop pf2e-dialog-backdrop" role="presentation">
      <div
        className={"modal-window pf2e-confirm" + (request.danger ? " pf2e-confirm--danger" : "")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={"pf2e-confirm-" + request.id}
      >
        <header className="modal-window__header">
          <h2 className="modal-window__title" id={"pf2e-confirm-" + request.id}>
            <span className="pf2e-confirm__icon" aria-hidden="true">
              {request.danger ? "⚠" : "❔"}
            </span>
            {dialogTitle(request)}
          </h2>
        </header>
        <div className="modal-window__body pf2e-confirm__body">
          {String(request.message || "")
            .split("\n")
            .map((line, index) => (
              <p className="pf2e-confirm__text" key={index}>
                {line}
              </p>
            ))}
        </div>
        <footer className="modal-window__footer">
          <button
            type="button"
            className="ui-button"
            onClick={() => onResolve(false)}
          >
            {request.cancelLabel || "Отмена"}
          </button>
          <button
            type="button"
            className={
              "ui-button " +
              (request.danger ? "ui-button--danger" : "ui-button--primary")
            }
            autoFocus
            onClick={() => onResolve(true)}
          >
            {request.confirmLabel || "ОК"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/**
 * In-game replacement for `window.prompt`.
 */
export function PromptModal({ request, onResolve }) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (!request) {
      return;
    }
    setDraft(request.defaultValue || "");
    const timer = window.setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [request]);

  if (!request) {
    return null;
  }

  const submit = (event) => {
    event.preventDefault();
    onResolve(draft);
  };

  return createPortal(
    <div className="modal-backdrop pf2e-dialog-backdrop" role="presentation">
      <form
        className="modal-window pf2e-confirm pf2e-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby={"pf2e-prompt-" + request.id}
        onSubmit={submit}
      >
        <header className="modal-window__header">
          <h2 className="modal-window__title" id={"pf2e-prompt-" + request.id}>
            <span className="pf2e-confirm__icon" aria-hidden="true">
              ✎
            </span>
            {request.title || "Ввод"}
          </h2>
        </header>
        <div className="modal-window__body pf2e-confirm__body">
          {request.message ? (
            <p className="pf2e-confirm__text">{request.message}</p>
          ) : null}
          <input
            ref={inputRef}
            className="ui-input"
            type={request.inputType || "text"}
            value={draft}
            placeholder={request.placeholder || ""}
            aria-label={request.title || "Ввод"}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <footer className="modal-window__footer">
          <button
            type="button"
            className="ui-button"
            onClick={() => onResolve(null)}
          >
            {request.cancelLabel || "Отмена"}
          </button>
          <button type="submit" className="ui-button ui-button--primary">
            {request.confirmLabel || "ОК"}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}

/**
 * Mounts both dialog queues. Requests are processed in arrival order so rapid
 * canvas gestures never swallow a confirmation.
 */
export default function DialogHost() {
  const [confirmQueue, setConfirmQueue] = useState([]);
  const [promptQueue, setPromptQueue] = useState([]);

  useEffect(() => {
    const handleConfirm = (event) => {
      if (event && event.detail) {
        setConfirmQueue((current) => [...current, event.detail]);
      }
    };
    const handlePrompt = (event) => {
      if (event && event.detail) {
        setPromptQueue((current) => [...current, event.detail]);
      }
    };
    window.addEventListener(CONFIRM_EVENT, handleConfirm);
    window.addEventListener(PROMPT_EVENT, handlePrompt);
    return () => {
      window.removeEventListener(CONFIRM_EVENT, handleConfirm);
      window.removeEventListener(PROMPT_EVENT, handlePrompt);
    };
  }, []);

  const confirmRequest = confirmQueue[0] || null;
  const promptRequest = promptQueue[0] || null;

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") {
        return;
      }
      if (confirmRequest) {
        confirmRequest.resolve(false);
        setConfirmQueue((current) => current.slice(1));
        event.preventDefault();
      } else if (promptRequest) {
        promptRequest.resolve(null);
        setPromptQueue((current) => current.slice(1));
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmRequest, promptRequest]);

  const settleConfirm = (answer) => {
    if (confirmRequest) {
      confirmRequest.resolve(answer);
    }
    setConfirmQueue((current) => current.slice(1));
  };

  const settlePrompt = (value) => {
    if (promptRequest) {
      promptRequest.resolve(value);
    }
    setPromptQueue((current) => current.slice(1));
  };

  return (
    <>
      <ConfirmModal request={confirmRequest} onResolve={settleConfirm} />
      <PromptModal request={promptRequest} onResolve={settlePrompt} />
    </>
  );
}
