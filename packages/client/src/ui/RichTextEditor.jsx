import { useEffect, useRef, useState } from "react";

import { useTranslation } from "./i18n.js";
import { promptText } from "./overlays/dialog-service.js";

const FORMAT_OPTIONS = [
  { value: "p", labelKey: "PF2E.Platform.Editor.NormalText", fallback: "Normal text" },
  { value: "h1", labelKey: "PF2E.Platform.Editor.Heading1", fallback: "Heading 1" },
  { value: "h2", labelKey: "PF2E.Platform.Editor.Heading2", fallback: "Heading 2" },
  { value: "h3", labelKey: "PF2E.Platform.Editor.Heading3", fallback: "Heading 3" },
  { value: "blockquote", labelKey: "PF2E.Platform.Editor.Quote", fallback: "Blockquote" },
  { value: "pre", labelKey: "PF2E.Platform.Editor.CodeBlock", fallback: "Code block" },
];

const INLINE_OPTIONS = [
  { value: "default", labelKey: "PF2E.Platform.Editor.Normal", fallback: "Normal" },
  { value: "code", labelKey: "PF2E.Platform.Editor.Code", fallback: "Code" },
];

/**
 * Step 6.8: reusable WYSIWYG surface extracted from `JournalSheet`.
 *
 * The component owns only the `document.execCommand` toolbar and the
 * `contenteditable` surface. Callers decide how to persist the HTML: pass an
 * external `editorRef` and read `editorRef.current.innerHTML`, or listen to
 * `onChange`. `initialValue` is written into the DOM when it changes (page
 * switches, entering edit mode), not on every keystroke, so the caret never
 * jumps while typing.
 */
export default function RichTextEditor({
  initialValue = "",
  editorRef,
  onChange,
  onSave,
  disabled = false,
  className = "",
  minHeight,
  placeholder = "",
  ariaLabel,
  saveLabel,
  showSaveButton = false,
}) {
  const { t } = useTranslation();
  const internalRef = useRef(null);
  const surfaceRef = editorRef || internalRef;
  const [format, setFormat] = useState("p");
  const [inlineStyle, setInlineStyle] = useState("default");
  const [color, setColor] = useState("#e8ecf3");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (surfaceRef.current) {
      surfaceRef.current.innerHTML = initialValue || "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue]);

  const exec = (command, value = null) => {
    if (!surfaceRef.current) {
      return;
    }
    surfaceRef.current.focus();
    try {
      document.execCommand(command, false, value);
      if (typeof onChange === "function") {
        onChange(surfaceRef.current.innerHTML);
      }
    } catch (error) {
      setStatus(
        t(
          "PF2E.Platform.Editor.Unavailable",
          "The formatting command is unavailable.",
        ),
      );
    }
  };

  const applyFormat = (event) => {
    const value = event.target.value;
    setFormat(value);
    exec("formatBlock", "<" + value + ">");
  };

  const applyInlineStyle = (event) => {
    const value = event.target.value;
    setInlineStyle(value);
    if (value === "code") {
      exec("fontName", "monospace");
    } else {
      exec("fontName", "Signika");
    }
  };

  const insertImage = async () => {
    const url = await promptText({
      title: t("PF2E.Platform.Editor.InsertImage", "Insert image"),
      message: t("PF2E.Platform.Editor.InsertImage", "Insert image") + ":",
      defaultValue: "https://",
      placeholder: "https://",
    });
    if (url && url.trim() !== "" && url.trim() !== "https://") {
      exec("insertImage", url.trim());
    }
  };

  const clearFormatting = () => {
    exec("removeFormat");
    exec("formatBlock", "<p>");
    setFormat("p");
    setInlineStyle("default");
  };

  const surfaceClassName =
    "rich-text-editor__surface journal-editor__surface" +
    (className ? " " + className : "");

  return (
    <div className="rich-text-editor journal-editor">
      <div
        className="journal-toolbar rich-text-editor__toolbar"
        role="toolbar"
        aria-label={t("PF2E.Platform.Editor.Toolbar", "Formatting")}
      >
        <label className="journal-toolbar__group">
          <span className="journal-toolbar__label">
            {t("PF2E.Platform.Editor.Format", "Format")}
          </span>
          <select
            className="ui-input journal-toolbar__select"
            value={format}
            onChange={applyFormat}
            disabled={disabled}
          >
            {FORMAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey, option.fallback)}
              </option>
            ))}
          </select>
        </label>

        <label className="journal-toolbar__group">
          <span className="journal-toolbar__label">
            {t("PF2E.Platform.Editor.Style", "Style")}
          </span>
          <select
            className="ui-input journal-toolbar__select"
            value={inlineStyle}
            onChange={applyInlineStyle}
            disabled={disabled}
          >
            {INLINE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey, option.fallback)}
              </option>
            ))}
          </select>
        </label>

        <div className="journal-toolbar__divider" aria-hidden="true" />

        <button
          type="button"
          className="journal-toolbar__button journal-toolbar__button--bold"
          title={t("PF2E.Platform.Editor.Bold", "Bold")}
          onClick={() => exec("bold")}
          disabled={disabled}
        >
          B
        </button>
        <button
          type="button"
          className="journal-toolbar__button journal-toolbar__button--italic"
          title={t("PF2E.Platform.Editor.Italic", "Italic")}
          onClick={() => exec("italic")}
          disabled={disabled}
        >
          I
        </button>

        <label className="journal-toolbar__group journal-toolbar__color">
          <span className="journal-toolbar__label">
            {t("PF2E.Platform.Editor.Color", "Color")}
          </span>
          <input
            type="color"
            value={color}
            aria-label={t("PF2E.Platform.Editor.TextColor", "Text color")}
            disabled={disabled}
            onChange={(event) => {
              setColor(event.target.value);
              exec("foreColor", event.target.value);
            }}
          />
        </label>

        <button
          type="button"
          className="journal-toolbar__button"
          title={t("PF2E.Platform.Editor.BulletedList", "Bulleted list")}
          onClick={() => exec("insertUnorderedList")}
          disabled={disabled}
        >
          •≡
        </button>
        <button
          type="button"
          className="journal-toolbar__button"
          title={t("PF2E.Platform.Editor.NumberedList", "Numbered list")}
          onClick={() => exec("insertOrderedList")}
          disabled={disabled}
        >
          1≡
        </button>

        <div className="journal-toolbar__divider" aria-hidden="true" />

        <button
          type="button"
          className="journal-toolbar__button"
          title={t("PF2E.Platform.Editor.AlignLeft", "Align left")}
          onClick={() => exec("justifyLeft")}
          disabled={disabled}
        >
          ⬅
        </button>
        <button
          type="button"
          className="journal-toolbar__button"
          title={t("PF2E.Platform.Editor.AlignCenter", "Align center")}
          onClick={() => exec("justifyCenter")}
          disabled={disabled}
        >
          ↔
        </button>
        <button
          type="button"
          className="journal-toolbar__button"
          title={t("PF2E.Platform.Editor.AlignRight", "Align right")}
          onClick={() => exec("justifyRight")}
          disabled={disabled}
        >
          ➡
        </button>
        <button
          type="button"
          className="journal-toolbar__button"
          title={t("PF2E.Platform.Editor.AlignJustify", "Justify")}
          onClick={() => exec("justifyFull")}
          disabled={disabled}
        >
          ⇔
        </button>

        <div className="journal-toolbar__divider" aria-hidden="true" />

        <button
          type="button"
          className="journal-toolbar__button"
          title={t("PF2E.Platform.Editor.InsertImage", "Insert image")}
          onClick={insertImage}
          disabled={disabled}
        >
          🖼
        </button>
        <button
          type="button"
          className="journal-toolbar__button"
          title={t(
            "PF2E.Platform.Editor.ClearFormatting",
            "Clear formatting",
          )}
          onClick={clearFormatting}
          disabled={disabled}
        >
          🧹
        </button>

        {showSaveButton ? (
          <button
            type="button"
            className="ui-button ui-button--primary journal-toolbar__save"
            onClick={() => {
              if (typeof onSave === "function") {
                onSave(surfaceRef.current ? surfaceRef.current.innerHTML : "");
              }
            }}
            disabled={disabled}
          >
            {saveLabel || t("PF2E.Platform.Editor.Save", "💾 Save")}
          </button>
        ) : null}
      </div>

      <div
        ref={surfaceRef}
        className={surfaceClassName}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={
          ariaLabel || t("PF2E.Platform.Editor.Toolbar", "Formatting")
        }
        data-placeholder={placeholder}
        style={minHeight ? { minHeight } : undefined}
        onInput={(event) => {
          if (typeof onChange === "function") {
            onChange(event.currentTarget.innerHTML);
          }
        }}
      />

      {status ? (
        <div className="rich-text-editor__status" role="status">
          {status}
        </div>
      ) : null}
    </div>
  );
}
