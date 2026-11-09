import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useStore } from "../StoreContext.jsx";

const FORMAT_OPTIONS = [
  { value: "p", label: "Обычный текст" },
  { value: "h1", label: "Заголовок 1" },
  { value: "h2", label: "Заголовок 2" },
  { value: "h3", label: "Заголовок 3" },
  { value: "blockquote", label: "Цитата" },
  { value: "pre", label: "Блок кода" },
];

const INLINE_OPTIONS = [
  { value: "default", label: "Обычный" },
  { value: "code", label: "Код" },
];

/**
 * Standalone Journal window (Step 4.5).
 *
 * Pages live on the server (in-memory for now) and are sorted through HTML5
 * drag-and-drop in the left column. The right column is a `contenteditable`
 * WYSIWYG surface driven by `document.execCommand`, which keeps the basic
 * Foundry-style formatting controls functional without a rich-text dependency.
 */
export default function JournalSheet({ journalId, onClose }) {
  const { directories, networkClient } = useStore();
  const journal = useMemo(() => {
    const journals =
      directories && directories.journals ? directories.journals.entries : [];
    return journals.find((entry) => entry.id === journalId) || null;
  }, [directories, journalId]);

  const pages = useMemo(
    () =>
      journal && Array.isArray(journal.pages)
        ? [...journal.pages].sort((a, b) => {
            const indexA = journal.pages.indexOf(a);
            const indexB = journal.pages.indexOf(b);
            return indexA - indexB;
          })
        : [],
    [journal],
  );

  const [activePageId, setActivePageId] = useState(pages[0] ? pages[0].id : null);
  const [search, setSearch] = useState("");
  const [format, setFormat] = useState("p");
  const [inlineStyle, setInlineStyle] = useState("default");
  const [color, setColor] = useState("#e8ecf3");
  const [dragIndex, setDragIndex] = useState(null);
  const [saveState, setSaveState] = useState("");
  const [pendingNewPageCount, setPendingNewPageCount] = useState(null);
  const editorRef = useRef(null);

  const activePage =
    pages.find((page) => page.id === activePageId) ||
    (pages.length > 0 ? pages[0] : null);

  // Keep the selection valid when pages appear/disappear.
  useEffect(() => {
    if (!activePageId && pages.length > 0) {
      setActivePageId(pages[0].id);
      return;
    }
    if (activePageId && !pages.some((page) => page.id === activePageId)) {
      setActivePageId(pages.length > 0 ? pages[0].id : null);
    }
  }, [activePageId, pages]);

  // After the server broadcast returns a newly created page, select it.
  useEffect(() => {
    if (pendingNewPageCount !== null && pages.length > pendingNewPageCount) {
      setActivePageId(pages[pages.length - 1].id);
      setPendingNewPageCount(null);
    }
  }, [pendingNewPageCount, pages]);

  // Load page HTML into the editable surface only when the page changes.
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = activePage ? activePage.content || "" : "";
      setFormat("p");
      setInlineStyle("default");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage ? activePage.id : null]);

  const filteredPages = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query === "") {
      return pages;
    }
    return pages.filter((page) =>
      String(page.name || "").toLowerCase().includes(query),
    );
  }, [pages, search]);

  const exec = (command, value = null) => {
    if (!editorRef.current) {
      return;
    }
    editorRef.current.focus();
    try {
      document.execCommand(command, false, value);
    } catch (error) {
      setSaveState("Команда форматирования недоступна.");
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

  const addPage = () => {
    if (!networkClient) {
      setSaveState("Нет соединения с сервером.");
      return;
    }
    const name = window.prompt("Название страницы", "Новая страница");
    if (name === null) {
      return;
    }
    const trimmed = name.trim();
    if (trimmed === "") {
      return;
    }
    setPendingNewPageCount(pages.length);
    networkClient.addJournalPage(journalId, { name: trimmed }).catch((error) => {
      setPendingNewPageCount(null);
      setSaveState(error.message || "Не удалось добавить страницу.");
    });
  };

  const savePage = () => {
    if (!networkClient || !activePage) {
      setSaveState("Нет соединения с сервером.");
      return;
    }
    const content = editorRef.current ? editorRef.current.innerHTML : "";
    setSaveState("Сохранение…");
    networkClient
      .updateJournalPage(journalId, activePage.id, { content })
      .then(() => setSaveState("Сохранено"))
      .catch((error) =>
        setSaveState(error.message || "Не удалось сохранить страницу."),
      );
  };

  const handleDrop = (event, targetIndex) => {
    event.preventDefault();
    if (dragIndex === null || dragIndex === targetIndex || !networkClient) {
      setDragIndex(null);
      return;
    }
    const reordered = [...pages];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    setDragIndex(null);
    networkClient
      .reorderJournalPages(
        journalId,
        reordered.map((page) => page.id),
      )
      .catch((error) =>
        setSaveState(error.message || "Не удалось изменить порядок страниц."),
      );
  };

  const insertImage = () => {
    const url = window.prompt("URL изображения", "https://");
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

  if (!journal) {
    return createPortal(
      <div className="modal-backdrop" role="presentation">
        <div className="modal-window" role="dialog" aria-modal="true">
          <header className="modal-window__header">
            <h2 className="modal-window__title">📖 Журнал не найден</h2>
          </header>
          <div className="modal-window__body">
            Запись могла быть удалена или ещё не синхронизирована.
          </div>
          <footer className="modal-window__footer">
            <button type="button" className="ui-button" onClick={onClose}>
              Закрыть
            </button>
          </footer>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="modal-backdrop journal-backdrop" role="presentation">
      <section
        className="ui-window journal-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="journal-window-title"
      >
        <header className="ui-window__header">
          <div className="ui-window__title" id="journal-window-title">
            <span className="ui-window__icon" aria-hidden="true">
              📖
            </span>
            {journal.name}
          </div>
          <button
            type="button"
            className="ui-window__close"
            onClick={onClose}
            aria-label="Закрыть журнал"
            title="Закрыть"
          >
            ×
          </button>
        </header>

        <div className="journal-window__body">
          <aside className="journal-pages">
            <input
              type="search"
              className="ui-input journal-pages__search"
              placeholder="Поиск страниц…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Поиск страниц"
            />
            <div className="journal-pages__list">
              {filteredPages.length === 0 ? (
                <div className="journal-pages__empty">Страниц пока нет.</div>
              ) : (
                filteredPages.map((page) => {
                  const index = pages.indexOf(page);
                  return (
                    <div
                      key={page.id}
                      className={
                        "journal-page" +
                        (activePage && activePage.id === page.id
                          ? " journal-page--active"
                          : "")
                      }
                      draggable
                      onDragStart={() => setDragIndex(index)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleDrop(event, index)}
                    >
                      <button
                        type="button"
                        className="journal-page__button"
                        onClick={() => setActivePageId(page.id)}
                      >
                        <span className="journal-page__drag" aria-hidden="true">
                          ⋮⋮
                        </span>
                        <span className="journal-page__name">{page.name}</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <button
              type="button"
              className="ui-button journal-pages__add"
              onClick={addPage}
            >
              + Добавить страницу
            </button>
            {saveState ? (
              <div className="journal-pages__status">{saveState}</div>
            ) : null}
          </aside>

          <div className="journal-editor">
            <div className="journal-toolbar" role="toolbar" aria-label="Форматирование">
              <label className="journal-toolbar__group">
                <span className="journal-toolbar__label">Формат</span>
                <select
                  className="ui-input journal-toolbar__select"
                  value={format}
                  onChange={applyFormat}
                >
                  {FORMAT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="journal-toolbar__group">
                <span className="journal-toolbar__label">Стиль</span>
                <select
                  className="ui-input journal-toolbar__select"
                  value={inlineStyle}
                  onChange={applyInlineStyle}
                >
                  {INLINE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="journal-toolbar__divider" aria-hidden="true" />

              <button
                type="button"
                className="journal-toolbar__button journal-toolbar__button--bold"
                title="Жирный"
                onClick={() => exec("bold")}
                disabled={!activePage}
              >
                B
              </button>
              <button
                type="button"
                className="journal-toolbar__button journal-toolbar__button--italic"
                title="Курсив"
                onClick={() => exec("italic")}
                disabled={!activePage}
              >
                I
              </button>

              <label className="journal-toolbar__group journal-toolbar__color">
                <span className="journal-toolbar__label">Цвет</span>
                <input
                  type="color"
                  value={color}
                  aria-label="Цвет текста"
                  onChange={(event) => {
                    setColor(event.target.value);
                    exec("foreColor", event.target.value);
                  }}
                />
              </label>

              <button
                type="button"
                className="journal-toolbar__button"
                title="Маркированный список"
                onClick={() => exec("insertUnorderedList")}
                disabled={!activePage}
              >
                •≡
              </button>
              <button
                type="button"
                className="journal-toolbar__button"
                title="Нумерованный список"
                onClick={() => exec("insertOrderedList")}
                disabled={!activePage}
              >
                1≡
              </button>

              <div className="journal-toolbar__divider" aria-hidden="true" />

              <button
                type="button"
                className="journal-toolbar__button"
                title="Выровнять по левому краю"
                onClick={() => exec("justifyLeft")}
                disabled={!activePage}
              >
                ⬅
              </button>
              <button
                type="button"
                className="journal-toolbar__button"
                title="Выровнять по центру"
                onClick={() => exec("justifyCenter")}
                disabled={!activePage}
              >
                ↔
              </button>
              <button
                type="button"
                className="journal-toolbar__button"
                title="Выровнять по правому краю"
                onClick={() => exec("justifyRight")}
                disabled={!activePage}
              >
                ➡
              </button>
              <button
                type="button"
                className="journal-toolbar__button"
                title="По ширине"
                onClick={() => exec("justifyFull")}
                disabled={!activePage}
              >
                ⇔
              </button>

              <div className="journal-toolbar__divider" aria-hidden="true" />

              <button
                type="button"
                className="journal-toolbar__button"
                title="Вставить изображение"
                onClick={insertImage}
                disabled={!activePage}
              >
                🖼
              </button>
              <button
                type="button"
                className="journal-toolbar__button"
                title="Очистить форматирование"
                onClick={clearFormatting}
                disabled={!activePage}
              >
                🧹
              </button>
              <button
                type="button"
                className="ui-button ui-button--primary journal-toolbar__save"
                onClick={savePage}
                disabled={!activePage}
              >
                💾 Сохранить
              </button>
            </div>

            {activePage ? (
              <div
                ref={editorRef}
                className="journal-editor__surface"
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                aria-label="Содержимое страницы"
              />
            ) : (
              <div className="journal-editor__empty">
                Выберите страницу или добавьте новую.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
