import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const PLACEHOLDER_IMAGE = "/assets/ui/item-placeholder.svg";

function imageSrc(path) {
  return typeof path === "string" && path.trim() !== ""
    ? path
    : PLACEHOLDER_IMAGE;
}

function sourceLabel(entry) {
  const source = entry && entry.source;
  if (!source) {
    return entry && entry.type ? entry.type : "";
  }
  if (typeof source.publication === "string" && source.publication.trim() !== "") {
    return source.publication;
  }
  if (
    source.publication &&
    typeof source.publication.title === "string" &&
    source.publication.title.trim() !== ""
  ) {
    return source.publication.title;
  }
  return typeof source.pack === "string" ? source.pack : entry.type || "";
}

function normalizeFilterText(value) {
  if (value && typeof value === "object") {
    return normalizeFilterText(value.slug || value.name || "");
  }
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Step 5.5: heritage picks accept only universal heritages (`versatile`) or
 * heritages strictly bound to the selected ancestry. The server already filters
 * this way; the client repeats the predicate so a stale/loose API response can
 * never leak a foreign ancestry into the picker.
 */
function filterCompendiumEntries(category, entries, filters) {
  const list = Array.isArray(entries) ? entries : [];
  if (category !== "heritages") {
    return list;
  }
  const active = filters || {};
  const ancestry = normalizeFilterText(active.ancestry);
  if (ancestry !== "") {
    return list.filter((entry) => {
      if (!entry || typeof entry !== "object") {
        return false;
      }
      if (entry.versatile === true) {
        return true;
      }
      return (
        normalizeFilterText(entry.ancestry) === ancestry ||
        normalizeFilterText(entry.ancestryName) === ancestry
      );
    });
  }
  // Without an ancestry, only universal heritages are valid.
  return list.filter((entry) => entry && entry.versatile === true);
}

/**
 * Step 5.6: ancestry-bound heritages are listed first, universal (`versatile`)
 * heritages after them. Both groups are alphabetical. The server sorts the same
 * way; repeating it here keeps the picker correct for cached/loose payloads.
 */
function sortCompendiumEntries(category, entries, filters) {
  const list = Array.isArray(entries) ? [...entries] : [];
  if (category !== "heritages") {
    return list;
  }
  const ancestry = normalizeFilterText((filters || {}).ancestry);
  const groupOf = (entry) => {
    if (!entry) {
      return 1;
    }
    if (entry.versatile === true) {
      return 1;
    }
    if (ancestry === "") {
      return 0;
    }
    return normalizeFilterText(entry.ancestry) === ancestry ||
      normalizeFilterText(entry.ancestryName) === ancestry
      ? 0
      : 1;
  };
  return list.sort((a, b) => {
    const groupDelta = groupOf(a) - groupOf(b);
    if (groupDelta !== 0) {
      return groupDelta;
    }
    return String((a && a.name) || "").localeCompare(
      String((b && b.name) || ""),
      "ru",
      { numeric: true, sensitivity: "base" },
    );
  });
}

/**
 * Minimal compendium picker used by the character sheet's ABC fields
 * (ancestry, heritage, background, class). It reads the same
 * `/api/compendiums/:category` index as the full browser and returns the
 * selected entry so the sheet can persist its id + display name.
 */
export default function CompendiumSelectModal({
  category,
  title,
  filters,
  onSelect,
  onClose,
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const filterKey = useMemo(() => JSON.stringify(filters || {}), [filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 200);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (debouncedSearch.trim() !== "") {
      params.set("search", debouncedSearch.trim());
    }
    const activeFilters = JSON.parse(filterKey || "{}");
    for (const [key, value] of Object.entries(activeFilters)) {
      if (value === undefined || value === null || value === "" || value === false) {
        continue;
      }
      params.set(key, value === true ? "1" : String(value));
    }
    params.set("limit", "1000");

    setLoading(true);
    setError("");
    fetch(
      "/api/compendiums/" +
        encodeURIComponent(category) +
        (params.toString() ? "?" + params.toString() : ""),
      { signal: controller.signal, headers: { Accept: "application/json" } },
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error("HTTP " + response.status + " " + response.statusText);
        }
        return response.json();
      })
      .then((data) => {
        setEntries(
          sortCompendiumEntries(
            category,
            filterCompendiumEntries(category, Array.isArray(data) ? data : [], activeFilters),
            activeFilters,
          ),
        );
        setLoading(false);
      })
      .catch((fetchError) => {
        if (fetchError.name === "AbortError") {
          return;
        }
        setEntries([]);
        setError(fetchError.message);
        setLoading(false);
      });

    return () => controller.abort();
  }, [category, debouncedSearch, filterKey]);

  const heading = useMemo(
    () => (title ? title : category),
    [title, category],
  );

  return createPortal(
    <div
      className="modal-backdrop pf2e-select-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="modal-window pf2e-select-modal"
        role="dialog"
        aria-modal="true"
        aria-label={"Выбор: " + heading}
      >
        <header className="modal-window__header">
          <h2 className="modal-window__title">🔍 Выбор: {heading}</h2>
          <button
            type="button"
            className="ui-window__close"
            onClick={onClose}
            title="Закрыть"
            aria-label="Закрыть"
          >
            ×
          </button>
        </header>

        <div className="pf2e-select-modal__search">
          <input
            className="ui-input"
            type="search"
            autoFocus
            value={search}
            placeholder="Поиск по названию…"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="pf2e-select-modal__body">
          {loading ? (
            <div className="pf2e-select-modal__state">Загрузка…</div>
          ) : error ? (
            <div className="pf2e-select-modal__state pf2e-select-modal__state--error">
              {error}
            </div>
          ) : entries.length === 0 ? (
            <div className="pf2e-select-modal__state">
              Ничего не найдено.
            </div>
          ) : (
            <ul className="pf2e-select-list">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="pf2e-select-row"
                    onClick={() => {
                      onSelect(entry);
                      onClose();
                    }}
                  >
                    <img
                      className="pf2e-select-row__icon"
                      src={imageSrc(entry.img)}
                      alt=""
                      loading="lazy"
                      draggable={false}
                      onError={(event) => {
                        event.currentTarget.src = PLACEHOLDER_IMAGE;
                      }}
                    />
                    <span className="pf2e-select-row__body">
                      <span className="pf2e-select-row__name">{entry.name}</span>
                      <span className="pf2e-select-row__meta">
                        {sourceLabel(entry)}
                        {typeof entry.level === "number"
                          ? " · ур. " + entry.level
                          : ""}
                      </span>
                    </span>
                    <span className="pf2e-select-row__choose">Выбрать</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="modal-window__footer">
          <button type="button" className="ui-button" onClick={onClose}>
            Отмена
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
