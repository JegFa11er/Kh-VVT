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

function buildUrl(tab, search, limit, minLevel, maxLevel) {
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
  if (minLevel.trim() !== "") {
    params.set("minLevel", minLevel.trim());
  }
  if (maxLevel.trim() !== "") {
    params.set("maxLevel", maxLevel.trim());
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

function descriptionFor(entry) {
  if (!entry || typeof entry !== "object") {
    return "";
  }
  if (typeof entry.description === "string" && entry.description.trim() !== "") {
    return entry.description;
  }
  const systemDescription = entry.system && entry.system.description;
  if (
    systemDescription &&
    typeof systemDescription.value === "string" &&
    systemDescription.value.trim() !== ""
  ) {
    return systemDescription.value;
  }
  return "";
}

function imageFor(entry) {
  return entry && typeof entry.img === "string" && entry.img.trim() !== ""
    ? entry.img
    : PLACEHOLDER_IMAGE;
}

function CompendiumCard({ tab, entry, onOpen }) {
  const [imageFailed, setImageFailed] = useState(false);
  const pressRef = useRef(null);
  const draggedRef = useRef(false);

  const handleDragStart = (event) => {
    draggedRef.current = true;
    const payload = buildDragPayload(tab, entry);
    const serialized = JSON.stringify(payload);

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/json", serialized);
    event.dataTransfer.setData("text/plain", serialized);
  };

  const handleDragEnd = () => {
    // A trailing click can fire right after dragend; keep the guard for a
    // moment so dragging a card never opens the detail modal.
    setTimeout(() => {
      draggedRef.current = false;
    }, 150);
  };

  const handlePointerDown = (event) => {
    if (event.button !== 0) {
      return;
    }
    pressRef.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event) => {
    const start = pressRef.current;
    pressRef.current = null;
    if (!start || draggedRef.current) {
      return;
    }
    const distance = Math.hypot(
      event.clientX - start.x,
      event.clientY - start.y,
    );
    if (distance <= 5) {
      onOpen(entry);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(entry);
    }
  };

  const tags = Array.isArray(entry.traits) ? entry.traits : [];

  return (
    <article
      className="compendium-card"
      draggable
      role="button"
      tabIndex={0}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onKeyDown={handleKeyDown}
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
 * drop targets. A regular click opens a read-only detail modal instead.
 */
export default function CompendiumBrowser({ onClose, initialTabId }) {
  const [activeTabId, setActiveTabId] = useState(() =>
    TABS.some((tab) => tab.id === initialTabId) ? initialTabId : "spells",
  );
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [minLevel, setMinLevel] = useState("");
  const [maxLevel, setMaxLevel] = useState("");
  const [debouncedMinLevel, setDebouncedMinLevel] = useState("");
  const [debouncedMaxLevel, setDebouncedMaxLevel] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [position, setPosition] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const abortRef = useRef(null);
  const detailAbortRef = useRef(null);
  const dragRef = useRef(null);

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
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setDebouncedMinLevel(minLevel);
      setDebouncedMaxLevel(maxLevel);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, minLevel, maxLevel]);

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [activeTabId, debouncedSearch, debouncedMinLevel, debouncedMaxLevel]);

  useEffect(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(
      buildUrl(
        activeTab,
        debouncedSearch,
        limit,
        debouncedMinLevel,
        debouncedMaxLevel,
      ),
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      },
    )
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
  }, [
    activeTab,
    debouncedSearch,
    debouncedMinLevel,
    debouncedMaxLevel,
    limit,
  ]);

  // Close any open detail modal when the user switches catalogs.
  useEffect(() => {
    if (detailAbortRef.current) {
      detailAbortRef.current.abort();
      detailAbortRef.current = null;
    }
    setSelectedEntry(null);
    setDetail(null);
    setDetailLoading(false);
    setDetailError(null);
  }, [activeTabId]);

  const closeDetail = () => {
    if (detailAbortRef.current) {
      detailAbortRef.current.abort();
      detailAbortRef.current = null;
    }
    setSelectedEntry(null);
    setDetail(null);
    setDetailLoading(false);
    setDetailError(null);
  };

  const openDetail = (entry) => {
    if (detailAbortRef.current) {
      detailAbortRef.current.abort();
    }
    const controller = new AbortController();
    detailAbortRef.current = controller;

    setSelectedEntry(entry);
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);

    fetch(
      "/api/compendiums/" +
        activeTab.category +
        "/" +
        encodeURIComponent(entry.id),
      { signal: controller.signal, headers: { Accept: "application/json" } },
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error("HTTP " + response.status + " " + response.statusText);
        }
        return response.json();
      })
      .then((data) => {
        if (controller.signal.aborted) {
          return;
        }
        setDetail(data);
        setDetailLoading(false);
      })
      .catch((fetchError) => {
        if (controller.signal.aborted || fetchError.name === "AbortError") {
          return;
        }
        setDetailError(fetchError.message);
        setDetailLoading(false);
      });
  };

  // Drag the window by its header. Pointer capture keeps the window attached
  // to the cursor even when it leaves the header area.
  const handleHeaderPointerDown = (event) => {
    if (event.button !== 0 || event.target.closest("button")) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    if (event.currentTarget.setPointerCapture) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
  };

  const handleHeaderPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    const maxX = Math.max(0, window.innerWidth - 120);
    const maxY = Math.max(0, window.innerHeight - 48);
    setPosition({
      x: Math.min(maxX, Math.max(0, event.clientX - drag.offsetX)),
      y: Math.min(maxY, Math.max(0, event.clientY - drag.offsetY)),
    });
  };

  const handleHeaderPointerUp = (event) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    dragRef.current = null;
    if (event.currentTarget.releasePointerCapture) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const hasSearch = debouncedSearch.trim() !== "";
  const hasLevelFilter =
    debouncedMinLevel.trim() !== "" || debouncedMaxLevel.trim() !== "";
  const isFiltered = hasSearch || Boolean(activeTab.type) || hasLevelFilter;

  const detailEntry = detail || selectedEntry;
  const detailDescription = descriptionFor(detailEntry);
  const detailTraits = Array.isArray(detailEntry && detailEntry.traits)
    ? detailEntry.traits
    : [];

  return (
    <section
      className="ui-window compendium-browser"
      aria-label="Compendium Browser"
      style={position ? { left: position.x, top: position.y } : undefined}
    >
      <header
        className="ui-window__header compendium-browser__header"
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        onPointerCancel={handleHeaderPointerUp}
      >
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
        <div className="compendium-levels" role="group" aria-label="Фильтр по уровню">
          <label className="compendium-levels__field">
            <span>От</span>
            <input
              type="number"
              className="ui-input compendium-levels__input"
              min={-1}
              max={30}
              step={1}
              value={minLevel}
              onChange={(event) => setMinLevel(event.target.value)}
              aria-label="Минимальный уровень"
            />
          </label>
          <label className="compendium-levels__field">
            <span>До</span>
            <input
              type="number"
              className="ui-input compendium-levels__input"
              min={-1}
              max={30}
              step={1}
              value={maxLevel}
              onChange={(event) => setMaxLevel(event.target.value)}
              aria-label="Максимальный уровень"
            />
          </label>
        </div>
        <span className="compendium-browser__count">
          {loading
            ? "Загрузка…"
            : isFiltered
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
              onOpen={openDetail}
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
            {total !== null && !isFiltered ? " из " + total : ""})
          </button>
        ) : null}
      </div>

      <footer className="ui-window__footer">
        Перетащите карточку на лист персонажа — payload:{" "}
        <code>{'{ type: "compendium-item", category, entry }'}</code>
      </footer>

      {selectedEntry ? (
        <div
          className="compendium-detail__backdrop"
          role="presentation"
          onClick={closeDetail}
        >
          <div
            className="compendium-detail"
            role="dialog"
            aria-modal="true"
            aria-label={detailEntry ? detailEntry.name : "Описание"}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="compendium-detail__header">
              <img
                className="compendium-detail__image"
                src={imageFor(detailEntry)}
                alt=""
                onError={(event) => {
                  event.currentTarget.src = PLACEHOLDER_IMAGE;
                }}
              />
              <div className="compendium-detail__heading">
                <h2 className="compendium-detail__name">
                  {detailEntry ? detailEntry.name : selectedEntry.name}
                </h2>
                <div className="compendium-detail__meta">
                  <span className="compendium-detail__type">
                    {detailEntry ? detailEntry.type : selectedEntry.type}
                  </span>
                  {typeof selectedEntry.level === "number" ? (
                    <span className="compendium-detail__level">
                      Уровень {selectedEntry.level}
                    </span>
                  ) : null}
                </div>
                {detailTraits.length > 0 ? (
                  <div className="compendium-detail__traits">
                    {detailTraits.map((trait) => (
                      <span className="compendium-tag" key={trait}>
                        {trait}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="ui-window__close"
                onClick={closeDetail}
                aria-label="Закрыть описание"
              >
                ×
              </button>
            </header>
            <div className="compendium-detail__body">
              {detailLoading ? (
                <div className="compendium-detail__state">Загрузка описания…</div>
              ) : detailError ? (
                <div className="compendium-detail__state compendium-detail__state--error">
                  Не удалось загрузить описание: {detailError}
                </div>
              ) : detailDescription !== "" ? (
                <p>{detailDescription}</p>
              ) : (
                <div className="compendium-detail__state">
                  Описание отсутствует.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
