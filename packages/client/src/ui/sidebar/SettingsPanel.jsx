import { useRef, useState } from "react";

import { formatMessage, useTranslation } from "../i18n.js";
import { confirmAction } from "../overlays/dialog-service.js";
import { useStore } from "../StoreContext.jsx";
import { showToast } from "../toast.js";

/** Step 6.4: query string that identifies the calling GM for HTTP routes. */
function sessionQuery(networkClient) {
  return new URLSearchParams({
    sessionId: networkClient?.sessionId || "default",
    memberId: networkClient?.playerId || "",
  }).toString();
}

/**
 * Settings tab.
 *
 * Step 6.4 adds GM-only world management:
 *  - download `session.json` as `world-export.json`;
 *  - import a JSON world through a hidden file input, guarded by the in-game
 *    `ConfirmModal` (never `window.confirm`). The server broadcasts
 *    `room:reload`, which reloads every connected client.
 *
 * Step 6.5 adds the RU/EN interface + compendium language toggle.
 */
export default function SettingsPanel() {
  const { activeRole, language, setLanguage, networkClient } = useStore();
  const { t } = useTranslation();
  const isGm = activeRole === "gm";
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState("");

  const handleExport = async () => {
    if (!isGm || busy !== "") {
      return;
    }
    setBusy("export");
    try {
      const response = await fetch(
        "/api/lobby/export?" + sessionQuery(networkClient),
        { headers: { Accept: "application/json" } },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          (payload && (payload.message || payload.error)) ||
            "HTTP " + response.status + " " + response.statusText,
        );
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "world-export.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showToast(
        t(
          "PF2E.Platform.Settings.ExportDone",
          "The world was downloaded as world-export.json.",
        ),
        { kind: "info" },
      );
    } catch (error) {
      showToast(
        formatMessage(
          t(
            "PF2E.Platform.Settings.ExportError",
            "Failed to download the world: {error}",
          ),
          {
            error:
              error.message ||
              t("PF2E.Platform.Settings.UnknownError", "unknown error"),
          },
        ),
        { kind: "error" },
      );
    } finally {
      setBusy("");
    }
  };

  const handleFilePicked = async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file || !isGm || busy !== "") {
      return;
    }

    const confirmed = await confirmAction({
      title: t("PF2E.Platform.Settings.ImportTitle", "Import World"),
      message: t(
        "PF2E.Platform.Settings.ImportMessage",
        "Are you sure? The current world will be permanently deleted.",
      ),
      confirmLabel: t(
        "PF2E.Platform.Settings.ImportConfirm",
        "Upload World",
      ),
      cancelLabel: t("PF2E.Platform.Common.Cancel", "Cancel"),
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    setBusy("import");
    try {
      const formData = new FormData();
      formData.append("file", file, file.name || "world-export.json");
      formData.append("sessionId", networkClient?.sessionId || "default");
      formData.append("memberId", networkClient?.playerId || "");

      const response = await fetch(
        "/api/lobby/import?" + sessionQuery(networkClient),
        { method: "POST", body: formData },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          (payload && (payload.message || payload.error)) ||
            "HTTP " + response.status + " " + response.statusText,
        );
      }
      showToast(
        t(
          "PF2E.Platform.Settings.ImportDone",
          "World imported. Reloading clients…",
        ),
        { kind: "info" },
      );
    } catch (error) {
      showToast(
        formatMessage(
          t(
            "PF2E.Platform.Settings.ImportError",
            "Failed to import the world: {error}",
          ),
          {
            error:
              error.message ||
              t("PF2E.Platform.Settings.UnknownError", "unknown error"),
          },
        ),
        { kind: "error" },
      );
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="settings-panel">
      <div className="directory-panel__header">
        <span className="directory-panel__title">
          <span aria-hidden="true">⚙️</span>{" "}
          {t("PF2E.Platform.Settings.Title", "Settings")}
        </span>
      </div>

      <div className="settings-panel__body">
        <div className="settings-panel__version">
          <div className="settings-panel__version-title">PF2e Web Engine</div>
          <div className="settings-panel__version-row">
            <span>{t("PF2E.Platform.Settings.System", "System")}</span>
            <span>PF2e Remastered</span>
          </div>
          <div className="settings-panel__version-row">
            <span>{t("PF2E.Platform.Settings.Version", "Version")}</span>
            <span>1.0.0</span>
          </div>
        </div>

        {/* Step 6.5: local preference, applied to the Compendium Browser and
            every `t()` call in the character sheet. */}
        <section className="settings-panel__section">
          <div className="settings-panel__section-title">
            {t(
              "PF2E.Platform.Settings.LanguageSection",
              "Compendium and UI language",
            )}
          </div>
          <div
            className="settings-panel__language-toggle"
            role="group"
            aria-label={t(
              "PF2E.Platform.Settings.LanguageAria",
              "Compendium and interface language",
            )}
          >
            <button
              type="button"
              className={
                "settings-panel__language-button" +
                (language === "ru"
                  ? " settings-panel__language-button--active"
                  : "")
              }
              aria-pressed={language === "ru"}
              onClick={() => setLanguage("ru")}
            >
              RU
            </button>
            <button
              type="button"
              className={
                "settings-panel__language-button" +
                (language === "en"
                  ? " settings-panel__language-button--active"
                  : "")
              }
              aria-pressed={language === "en"}
              onClick={() => setLanguage("en")}
            >
              EN
            </button>
          </div>
          <p className="settings-panel__hint">
            {t(
              "PF2E.Platform.Settings.LanguageHint",
              "Compendium names and descriptions as well as the localized character-sheet elements switch immediately. The choice is stored in the browser and applied on the next launch or reload.",
            )}
          </p>
        </section>

        {isGm ? (
          <section className="settings-panel__section">
            <div className="settings-panel__section-title">
              {t(
                "PF2E.Platform.Settings.WorldManagement",
                "World Management",
              )}
            </div>
            <button
              type="button"
              className="ui-button settings-panel__button"
              onClick={handleExport}
              disabled={busy !== ""}
            >
              {busy === "export"
                ? t("PF2E.Platform.Settings.Downloading", "⏳ Downloading…")
                : t(
                    "PF2E.Platform.Settings.DownloadWorld",
                    "⬇ Download World",
                  )}
            </button>
            <button
              type="button"
              className="ui-button settings-panel__button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy !== ""}
            >
              {busy === "import"
                ? t("PF2E.Platform.Settings.Uploading", "⏳ Uploading…")
                : t(
                    "PF2E.Platform.Settings.UploadWorld",
                    "⬆ Upload World",
                  )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="settings-panel__file-input"
              aria-hidden="true"
              tabIndex={-1}
              onChange={handleFilePicked}
            />
            <p className="settings-panel__hint">
              {t(
                "PF2E.Platform.Settings.WorldHint",
                "Export returns the current session.json. Import overwrites the world and reloads every connected client.",
              )}
            </p>
          </section>
        ) : (
          <p className="settings-panel__hint">
            {t(
              "PF2E.Platform.Settings.WorldGmOnly",
              "World management is only available to the GM.",
            )}
          </p>
        )}

        <button type="button" className="ui-button settings-panel__button" disabled>
          {t("PF2E.Platform.Settings.GameSettings", "🎲 Game Settings")}
        </button>
        <button type="button" className="ui-button settings-panel__button" disabled>
          {t(
            "PF2E.Platform.Settings.ControlSettings",
            "🎮 Control Settings",
          )}
        </button>
      </div>
    </div>
  );
}
