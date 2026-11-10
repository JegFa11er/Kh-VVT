import { useEffect, useRef, useState } from "react";

import { TOAST_EVENT } from "./toast.js";

const MAX_VISIBLE_TOASTS = 4;
const DEFAULT_DURATION_MS = 3200;
let sequence = 0;

/**
 * Renders transient canvas notifications emitted through `showToast()`.
 * Mounted once by `<App />`; toasts stack above the hotbar and disappear on
 * their own.
 */
export default function ToastHost() {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  useEffect(() => {
    const dismiss = (id) => {
      const timer = timersRef.current.get(id);
      if (timer) {
        clearTimeout(timer);
        timersRef.current.delete(id);
      }
      setToasts((current) => current.filter((toast) => toast.id !== id));
    };

    const handleToast = (event) => {
      const detail = (event && event.detail) || {};
      const message =
        typeof detail.message === "string" ? detail.message.trim() : "";
      if (message === "") {
        return;
      }
      sequence += 1;
      const id = "toast-" + sequence;
      const duration = Number.isFinite(detail.duration)
        ? Math.max(800, detail.duration)
        : DEFAULT_DURATION_MS;
      setToasts((current) =>
        [
          ...current,
          { id, message, kind: detail.kind || "warning" },
        ].slice(-MAX_VISIBLE_TOASTS),
      );
      const timer = setTimeout(() => dismiss(id), duration);
      timersRef.current.set(id, timer);
    };

    window.addEventListener(TOAST_EVENT, handleToast);
    const timers = timersRef.current;
    return () => {
      window.removeEventListener(TOAST_EVENT, handleToast);
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="pf2e-toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={"pf2e-toast pf2e-toast--" + toast.kind}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
