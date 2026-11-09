import { useEffect, useMemo, useRef, useState } from "react";

const PLACEHOLDER_IMAGE = "/assets/ui/item-placeholder.svg";
const PAGE_SIZE = 100;

/**
 * Compendium categories exposed by `/api/compendiums`.
 *
 * `category` is the catalog id on the server; `type` narrows the shared
 * equipment catalog down to weapons or shields.
 */
const TABS = [
  { id: "spells", label: "Заклинания", category: "spells" },
  { id: "weapons", label: "Оружие", category: "equipment", type: "weapon" },
  { id: "shields", label: "Щиты", category: "equipment", type: "shield" },
  { id: "bestiary", label: "Бестиарий", category: "monsters" },
  { id: "feats", label: "Черты", category: "feats" },
  { id: "actions", label: "Действия", category: "actions" },
  { id: "equipment", label: "Снаряжение", category: "equipment" },
];

function buildUrl(tab, search, limit) {
  const params = new URLSearchParams();
  if (search.trim() !== "") {
    params.set("search", search.trim());
  }
  if (tab.type) {
    params.set("type", tab.type);
  }
  if (tab.id === "bestiary") {
    // The server's filter contract only understands `type`, while the bestiary
    // catalog stores creatures with `type: "npc"`.
    params.set("type", "npc");
  }
  params.set("limit", String(limit));
  const query = params.toString();
  return "/api/compendiums/" + tab.category + (query ? "?" + query : "");
}

function imageSrc(path) {
  return typeof path === "string" && path.trim() !== ""
    ? path
    : PLACEHOLDER_IMAGE;
}

function buildDragPayload(tab, entry) {
  return {
    type: "compendium-item",
    category: tab.category,
    entry,
  };
}

function CompendiumCard({ tab, entry }) {
  const [imageFailed, setImageFailed] = useState(false);

  const handleDragStart = (event) => {
    const payload = buildDragPayload(tab, entry);
    const serialized = JSON.stringify(payload);

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/json", serialized);
    event.dataTransfer.setData("text/plain", serialized);
  };

  const tags = Array.isArray(entry.traits) ? entry.traits : [];

  return (
    <article
      className="compendium-card"
      draggable
      onDragStart={handleDragStart}
      title={entry.name}
    >
      <img
        className="compendium-card__image"
        src={imageFailed ? PLACEHOLDER_IMAGE : imageSrc(entry.img)}
        alt=""
        draggable={false}
        loading="lazy"
        onError={() => setImageFailed(true)}
      />
      <div className="compendium-card__body">
        <div className="compendium-card__header">
          <span className="compendium-card__name">{entry.name}</span>
          {typeof entry.level === "number" ? (
            <span className="compendium-card__level">ур. {entry.level}</span>
          ) : null}
        </div>
        <div className="compendium-card__meta">
          <span className="compendium-card__type">{entry.type}</span>
          <span className="compendium-card__id">{entry.id}</span>
        </div>
        {tags.length > 0 ? (
          <div className="compendium-card__tags">
            {tags.slice(0, 5).map((trait) => (
              <span className="compendium-tag" key={trait}>
                {trait}
              </span>
            ))}
            {tags.length > 5 ? (
              <span className="compendium-tag compendium-tag--more">
                +{tags.length - 5}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Foundry-style compendium browser window.
 *
 * Search requests are debounced and cancelled through AbortController, so
 * typing quickly only hits the backend with the latest query. Cards are
 * HTML5-draggable: the drag payload is
 * `{ type: "compendium-item", category, entry }` for future character-sheet
 * drop targets.
 */
export default function CompendiumBrowser({ onClose, initialTabId }) {
  const [activeTabId, setActiveTabId] = useState(() =>
    TABS.some((tab) => tab.id === initialTabId) ? initialTabId : "spells",
  );
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const activeTab = useMemo(
    () => TABS.find((tab) => tab.id === activeTabId) || TABS[0],
    [activeTabId],
  );

  // The right-sidebar Library tab can focus a specific catalog.
  useEffect(() => {
    if (TABS.some((tab) => tab.id === initialTabId)) {
      setActiveTabId(initialTabId);
    }
  }, [initialTabId]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [activeTabId, debouncedSearch]);

  useEffect(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(buildUrl(activeTab, debouncedSearch, limit), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("HTTP " + response.status + " " + response.statusText);
        }
        const catalogCount = Number(response.headers.get("X-Total-Count"));
        return response.json().then((data) => ({ data, catalogCount }));
      })
      .then(({ data, catalogCount }) => {
        if (cancelled) {
          return;
        }
        setEntries(Array.isArray(data) ? data : []);
        setTotal(Number.isFinite(catalogCount) ? catalogCount : null);
        setLoading(false);
      })
      .catch((fetchError) => {
        if (cancelled || fetchError.name === "AbortError") {
          return;
        }
        setEntries([]);
        setTotal(null);
        setError(fetchError.message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeTab, debouncedSearch, limit]);

  return (
    <section className="ui-window compendium-browser" aria-label="Compendium Browser">
      <header className="ui-window__header">
        <div className="ui-window__title">
          <span className="ui-window__icon" aria-hidden="true">
            📖
          </span>
          Compendium Browser
        </div>
        <button
          type="button"
          className="ui-window__close"
          onClick={onClose}
          title="Закрыть (Esc)"
          aria-label="Закрыть Compendium Browser"
        >
          ×
        </button>
      </header>

      <nav className="compendium-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === activeTabId}
            className={
              "compendium-tab" +
              (tab.id === activeTabId ? " compendium-tab--active" : "")
            }
            onClick={() => setActiveTabId(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="compendium-browser__toolbar">
        <input
          type="search"
          className="ui-input compendium-search"
          placeholder="Поиск по названию…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Поиск в компендиуме"
        />
        <span className="compendium-browser__count">
          {loading
            ? "Загрузка…"
            : debouncedSearch.trim() !== "" || activeTab.type
              ? "Показано: " + entries.length
              : total !== null
                ? "Показано: " + entries.length + " из " + total
                : "Записей: " + entries.length}
        </span>
      </div>

      <div className="compendium-browser__content">
        {error ? (
          <div className="compendium-browser__state compendium-browser__state--error">
            Не удалось загрузить каталог: {error}
          </div>
        ) : null}

        {!error && !loading && entries.length === 0 ? (
          <div className="compendium-browser__state">Ничего не найдено.</div>
        ) : null}

        <div className="compendium-grid">
          {entries.map((entry) => (
            <CompendiumCard
              key={String(entry.id)}
              tab={activeTab}
              entry={entry}
            />
          ))}
        </div>

        {!error && !loading && entries.length === limit ? (
          <button
            type="button"
            className="ui-button compendium-browser__more"
            onClick={() => setLimit((current) => current + PAGE_SIZE)}
          >
            Показать ещё ({entries.length}
            {total !== null &&
            debouncedSearch.trim() === "" &&
            !activeTab.type
              ? " из " + total
              : ""})
          </button>
        ) : null}
      </div>

      <footer className="ui-window__footer">
        Перетащите карточку на лист персонажа — payload:{" "}
        <code>{'{ type: "compendium-item", category, entry }'}</code>
      </footer>
    </section>
  );
}
