import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CANVAS_TEXT_EVENT } from "./dialog-service.js";

function canvasRect() {
  const canvas =
    (typeof window !== "undefined" &&
      window.pf2e &&
      window.pf2e.app &&
      window.pf2e.app.canvas) ||
    (typeof document !== "undefined"
      ? document.querySelector("#app canvas")
      : null);
  if (canvas && typeof canvas.getBoundingClientRect === "function") {
    return canvas.getBoundingClientRect();
  }
  return { left: 0, top: 0, width: 0, height: 0 };
}

/**
 * Step 5.8: inline text entry for the canvas text tool.
 *
 * The input is a real HTML `<input type="text">` positioned exactly where the
 * user clicked. Enter or blur commits the label into a `PIXI.Text`; Escape
 * cancels. It replaces the old `window.prompt`.
 */
export default function CanvasTextInputHost() {
  const [request, setRequest] = useState(null);
  const [value, setValue] = useState("");
  const [rect, setRect] = useState(canvasRect);
  const inputRef = useRef(null);
  const settledRef = useRef(false);

  useEffect(() => {
    const handleRequest = (event) => {
      if (!event || !event.detail) {
        return;
      }
      settledRef.current = false;
      setRect(canvasRect());
      setValue(event.detail.value || "");
      setRequest(event.detail);
    };
    window.addEventListener(CANVAS_TEXT_EVENT, handleRequest);
    return () => window.removeEventListener(CANVAS_TEXT_EVENT, handleRequest);
  }, []);

  useEffect(() => {
    if (!request) {
      return undefined;
    }
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

  const finish = (commit) => {
    if (settledRef.current) {
      return;
    }
    settledRef.current = true;
    request.resolve(commit ? value : null);
    setRequest(null);
  };

  const left = rect.left + (request.screen?.x || 0);
  const top = rect.top + (request.screen?.y || 0);

  return createPortal(
    <input
      ref={inputRef}
      type="text"
      className="pf2e-canvas-text-input"
      value={value}
      spellCheck={false}
      autoComplete="off"
      aria-label="Текст на холсте"
      style={{
        left: left + "px",
        top: top + "px",
        color: request.color || "#ff6400",
        borderColor: request.color || "#ff6400",
      }}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
    />,
    document.body,
  );
}
