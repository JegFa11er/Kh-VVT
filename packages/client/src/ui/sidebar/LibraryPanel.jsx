import { useEffect, useMemo, useState } from "react";

const LIBRARY_LABELS = {
  equipment: "Снаряжение",
  spells: "Заклинания",
  feats: "Черты",
  actions: "Действия",
  monsters: "Бестиарий",
};

/**
 * Compendium categories map onto tabs in the existing Compendium Browser.
 * The sidebar itself only lists the catalogs; opening one focuses the shared
 * browser window.
 */
const CATEGORY_TABS = {
  equipment: "weapons",
  spells: "spells",
  feats: "feats",
  actions: "actions",
  monsters: "bestiary",
};

const BUILTIN_FOLDERS = [
  {
    id: "builtin-character-creation",
    name: "Создание персонажа",
    color: "#3b5f8a",
    categories: ["actions", "spells", "feats", "equipment"],
  },
  {
    id: "builtin-gm-tools",
    name: "Инструменты мастера",
    color: "#6b3f8a",
    categories: ["monsters", "equipment"],
  },
];

export default function LibraryPanel({ onOpenCompendium }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/compendiums", { headers: { Accept: "application/json" } })
      .then((response) => {
        if (!response.ok) {
          throw new Error("HTTP " + response.status + " " + response.statusText);
        }
        return response.json();
      })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setCategories(Array.isArray(payload && payload.categories) ? payload.categories : []);
        setLoading(false);
      })
      .catch((fetchError) => {
        if (cancelled) {
          return;
        }
        setError(fetchError.message || "Не удалось загрузить библиотеки.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => {
    const map = new Map();
    for (const category of categories) {
      map.set(category.id, category);
    }
    return map;
  }, [categories]);

  return (
    <div className="directory-panel library-panel">
      <div className="directory-panel__header">
        <span className="directory-panel__title">
          <span aria-hidden="true">📚</span> Библиотеки
        </span>
        <span className="directory-panel__count">{categories.length}</span>
      </div>

      {loading ? (
        <div className="directory-panel__empty">Загрузка библиотек…</div>
      ) : null}

      {error ? (
        <div className="directory-panel__error" role="alert">
          Ошибка загрузки: {error}
        </div>
      ) : null}

      {!loading && !error
        ? BUILTIN_FOLDERS.map((folder) => (
            <section className="directory-folder" key={folder.id}>
              <div
                className="directory-folder__header"
                style={{ backgroundColor: folder.color }}
              >
                <span className="directory-folder__icon" aria-hidden="true">
                  📁
                </span>
                <span className="directory-folder__name">{folder.name}</span>
                <span className="directory-folder__count">
                  {folder.categories.length}
                </span>
              </div>
              <div className="directory-folder__body">
                {folder.categories.map((categoryId) => {
                  const category = byId.get(categoryId);
                  return (
                    <button
                      key={folder.id + "-" + categoryId}
                      type="button"
                      className="library-entry"
                      onClick={() =>
                        onOpenCompendium(CATEGORY_TABS[categoryId] || "spells")
                      }
                      title="Открыть каталог"
                    >
                      <span className="library-entry__icon" aria-hidden="true">
                        📚
                      </span>
                      <span className="library-entry__body">
                        <span className="library-entry__name">
                          {LIBRARY_LABELS[categoryId] || categoryId}
                        </span>
                        <span className="library-entry__meta">
                          {category
                            ? category.count + " записей"
                            : "Каталог недоступен"}
                        </span>
                      </span>
                      <span className="library-entry__open" aria-hidden="true">
                        ↗
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        : null}
    </div>
  );
}
