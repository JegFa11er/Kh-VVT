import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const DEFAULT_GRID_SIZE = 100;
const DEFAULT_BACKGROUND = "#12151c";
const PLACEHOLDER_IMAGE = "/assets/ui/item-placeholder.svg";

function normalizeGridSize(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return DEFAULT_GRID_SIZE;
  }
  return Math.max(20, Math.min(400, Math.round(number)));
}

/**
 * Step 6.3: scene configuration dialog.
 *
 * The GM can set the background image (URL or `/api/upload`), the pixel size of
 * one 5-ft grid cell (100 by default) and the colour used outside the map.
 * Saving sends `room:update-scene`; the server persists the values on the scene
 * directory entry and broadcasts `room:directories-update`.
 */
export default function SceneConfigModal({
  scene,
  canEdit = false,
  onUpload,
  onSave,
  onClose,
}) {
  const [img, setImg] = useState(scene?.img || "");
  const [gridSize, setGridSize] = useState(
    String(normalizeGridSize(scene?.gridSize || DEFAULT_GRID_SIZE)),
  );
  const [backgroundColor, setBackgroundColor] = useState(
    /^#[0-9a-fA-F]{6}$/.test(scene?.backgroundColor || "")
      ? scene.backgroundColor
      : DEFAULT_BACKGROUND,
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setImg(scene?.img || "");
    setGridSize(
      String(normalizeGridSize(scene?.gridSize || DEFAULT_GRID_SIZE)),
    );
    setBackgroundColor(
      /^#[0-9a-fA-F]{6}$/.test(scene?.backgroundColor || "")
        ? scene.backgroundColor
        : DEFAULT_BACKGROUND,
    );
    setError("");
    // Reset only when the dialog switches to a different scene; directory
    // broadcasts must not erase the GM's in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id]);

  const handleFile = async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file || typeof onUpload !== "function") {
      return;
    }
    setUploading(true);
    setError("");
    try {
      const uploaded = await onUpload(file);
      if (uploaded && uploaded.url) {
        setImg(uploaded.url);
      }
    } catch (uploadError) {
      setError(uploadError.message || "Не удалось загрузить изображение.");
    } finally {
      setUploading(false);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    if (!canEdit || typeof onSave !== "function") {
      return;
    }
    const color = /^#[0-9a-fA-F]{6}$/.test(backgroundColor.trim())
      ? backgroundColor.trim().toLowerCase()
      : DEFAULT_BACKGROUND;
    onSave({
      img: img.trim() === "" ? null : img.trim(),
      gridSize: normalizeGridSize(gridSize),
      backgroundColor: color,
    });
  };

  const preview = img.trim() === "" ? PLACEHOLDER_IMAGE : img.trim();

  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal-window scene-config-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scene-config-title"
        onSubmit={submit}
      >
        <header className="modal-window__header">
          <h2 className="modal-window__title" id="scene-config-title">
            ⚙ Настройки сцены
          </h2>
        </header>

        <div className="modal-window__body">
          <p className="scene-config-modal__scene">
            Сцена: <strong>{scene?.name || "Без названия"}</strong>
          </p>

          <div className="scene-config-modal__preview">
            <img
              src={preview}
              alt=""
              onError={(event) => {
                event.currentTarget.src = PLACEHOLDER_IMAGE;
              }}
            />
          </div>

          <label className="modal-field">
            <span className="modal-field__label">Фоновое изображение (URL)</span>
            <input
              className="ui-input"
              value={img}
              placeholder="/uploads/map.png или https://…"
              disabled={!canEdit || uploading}
              onChange={(event) => setImg(event.target.value)}
            />
          </label>

          <label className="modal-field">
            <span className="modal-field__label">
              Загрузить файл изображения
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={!canEdit || uploading}
              onChange={handleFile}
            />
          </label>
          {uploading ? (
            <p className="pf2e-muted">Загрузка изображения…</p>
          ) : null}

          <label className="modal-field">
            <span className="modal-field__label">
              Размер сетки (пикселей на клетку)
            </span>
            <input
              className="ui-input"
              type="number"
              min="20"
              max="400"
              step="1"
              value={gridSize}
              disabled={!canEdit}
              onChange={(event) => setGridSize(event.target.value)}
            />
            <span className="scene-config-modal__hint">
              По умолчанию 100 px; одна клетка = 5 футов.
            </span>
          </label>

          <label className="modal-field">
            <span className="modal-field__label">Цвет фона вне карты (HEX)</span>
            <span className="modal-color-row">
              <input
                type="color"
                className="modal-color-picker"
                value={
                  /^#[0-9a-fA-F]{6}$/.test(backgroundColor)
                    ? backgroundColor
                    : DEFAULT_BACKGROUND
                }
                disabled={!canEdit}
                aria-label="Цвет фона вне карты"
                onChange={(event) => setBackgroundColor(event.target.value)}
              />
              <input
                className="ui-input modal-color-hex"
                value={backgroundColor}
                maxLength={7}
                disabled={!canEdit}
                onChange={(event) => setBackgroundColor(event.target.value)}
              />
            </span>
          </label>

          {error ? (
            <p className="directory-panel__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="modal-window__footer">
          <button type="button" className="ui-button" onClick={onClose}>
            Отмена
          </button>
          <button
            type="submit"
            className="ui-button ui-button--primary"
            disabled={!canEdit || uploading}
          >
            Сохранить
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
