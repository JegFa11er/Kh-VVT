import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { promptText } from "../overlays/dialog-service.js";
import { useStore } from "../StoreContext.jsx";
import RichTextEditor from "../RichTextEditor.jsx";

/**
 * Standalone Journal window (Step 4.5).
 *
 * Pages live on the server (in-memory for now) and are sorted through HTML5
 * drag-and-drop in the left column. The right column delegates to the shared
 * `RichTextEditor` (Step 6.8), which owns the `contenteditable` surface and
 * the `document.execCommand` toolbar.
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

  // RichTextEditor writes `activePage.content` into the editable surface when
  // the selected page changes; no manual innerHTML writes are needed here.

  const filteredPages = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query === "") {
      return pages;
    }
    return pages.filter((page) =>
      String(page.name || "").toLowerCase().includes(query),
    );
  }, [pages, search]);

  const addPage = async () => {
    if (!networkClient) {
      setSaveState("Нет соединения с сервером.");
      return;
    }
    const name = await promptText({
      title: "Новая страница",
      message: "Название страницы:",
      defaultValue: "Новая страница",
      placeholder: "Название страницы",
    });
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
            {activePage ? (
              <RichTextEditor
                editorRef={editorRef}
                initialValue={activePage.content || ""}
                showSaveButton
                onSave={savePage}
                ariaLabel="Содержимое страницы"
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
