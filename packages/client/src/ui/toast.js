/**
 * Minimal DOM toast bus shared by the PixiJS canvas layers and the React
 * overlay. Canvas code calls `showToast()`; `<ToastHost />` listens and renders
 * the notification, so the canvas never imports React.
 */

export const TOAST_EVENT = "pf2e:toast";

/**
 * Show a transient UI notification.
 *
 * @param {string} message
 * @param {{kind?: "warning"|"info"|"error", duration?: number}} [options]
 */
export function showToast(message, options = {}) {
  if (typeof window === "undefined" || typeof message !== "string") {
    return false;
  }
  const text = message.trim();
  if (text === "") {
    return false;
  }
  window.dispatchEvent(
    new CustomEvent(TOAST_EVENT, {
      detail: {
        message: text,
        kind: options.kind || "warning",
        duration: options.duration,
      },
    }),
  );
  return true;
}
