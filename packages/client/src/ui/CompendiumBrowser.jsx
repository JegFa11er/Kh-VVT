import { useEffect, useMemo, useRef, useState } from "react";

import {
  ARMOR_CATEGORIES,
  CREATURE_SIZES,
  EQUIPMENT_ITEM_TYPES,
  EQUIPMENT_RARITIES,
  FEAT_CATEGORIES,
  FEAT_SKILLS,
  SPELL_CATEGORIES,
  SPELL_RANKS,
  SPELL_TRADITIONS,
  WEAPON_CATEGORIES,
  buildCompendiumUrl,
  createEmptyAdvancedFilters,
  createEmptyEquipmentFilters,
  cycleTraitFilter,
  hasAdvancedFilters,
  hasEquipmentFilters,
  toggleFilterValue,
  traitFilterState,
} from "./compendium-filters.js";
import { formatMessage, useTranslation } from "./i18n.js";

const PLACEHOLDER_IMAGE = "/assets/ui/item-placeholder.svg";
const PAGE_SIZE = 100;

/**
 * Compendium categories exposed by `/api/compendiums`.
 *
 * `category` is the catalog id on the server; `type` narrows the shared
 * catalog (the bestiary stores creatures as `npc`).
 *
 * Step 6.6: the standalone Weapons/Shields tabs were folded into the single
 * Equipment tab, where they are available as sidebar filters.
 */
const TABS = [
  {
    id: "spells",
    label: "Spells",
    labelKey: "PF2E.CompendiumBrowser.TabSpell",
    category: "spells",
  },
  {
    id: "bestiary",
    label: "Bestiary",
    labelKey: "PF2E.CompendiumBrowser.TabBestiary",
    category: "monsters",
    type: "npc",
  },
  {
    id: "feats",
    label: "Feats",
    labelKey: "PF2E.CompendiumBrowser.TabFeat",
    category: "feats",
  },
  {
    id: "actions",
    label: "Actions",
    labelKey: "PF2E.CompendiumBrowser.TabAbilities",
    category: "actions",
  },
  {
    id: "equipment",
    label: "Equipment",
    labelKey: "PF2E.CompendiumBrowser.TabEquipment",
    category: "equipment",
  },
];

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

/** Step 6.8: option labels follow the RU/EN switch. */
function localizeOptions(options, t) {
  return options.map((option) => ({
    ...option,
    label: t(option.labelKey, option.labelEn || option.label),
  }));
}

/** Step 6.6: collapsible sidebar section (details without DOM prop drift). */
function FilterAccordion({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className={
        "compendium-filter" + (open ? " compendium-filter--open" : "")
      }
    >
      <button
        type="button"
        className="compendium-filter__summary"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{title}</span>
        <span className="compendium-filter__chevron" aria-hidden="true">
          ▸
        </span>
      </button>
      {open ? <div className="compendium-filter__body">{children}</div> : null}
    </section>
  );
}

function FilterCheckboxGroup({ label, options, selected, onToggle }) {
  const values = Array.isArray(selected) ? selected : [];
  return (
    <div className="compendium-filter__options" role="group" aria-label={label}>
      {options.map((option) => (
        <label className="compendium-filter__option" key={option.value}>
          <input
            type="checkbox"
            checked={values.includes(option.value)}
            onChange={() => onToggle(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

function CompendiumCard({ tab, entry, onOpen, levelLabel }) {
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
            <span className="compendium-card__level">
              {levelLabel || "lvl"} {entry.level}
            </span>
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
  // Step 6.7: the hook re-renders the browser on RU/EN changes and provides the
  // language for both `/api/compendiums` and the localised tab labels.
  const { language, t } = useTranslation();
  const [activeTabId, setActiveTabId] = useState(() =>
    TABS.some((tab) => tab.id === initialTabId) ? initialTabId : "spells",
  );
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [minLevel, setMinLevel] = useState("");
  const [maxLevel, setMaxLevel] = useState("");
  const [debouncedMinLevel, setDebouncedMinLevel] = useState("");
  const [debouncedMaxLevel, setDebouncedMaxLevel] = useState("");
  // Step 6.6: equipment sidebar filters. Checkboxes update immediately; the
  // free-text price fields are debounced with search/level.
  const [equipmentFilters, setEquipmentFilters] = useState(
    createEmptyEquipmentFilters,
  );
  // Step 6.7: advanced accordion groups (spells/bestiary/feats) plus the
  // shared include/exclude trait filter. Checkboxes apply immediately.
  const [advancedFilters, setAdvancedFilters] = useState(
    createEmptyAdvancedFilters,
  );
  // Full trait palette for the active catalogue, returned by
  // `/api/compendiums/:category/facets` so tags on pages beyond the current
  // 100 cards are still selectable (e.g. `android` in the bestiary).
  const [catalogTraits, setCatalogTraits] = useState([]);
  const [traitSearch, setTraitSearch] = useState("");
  const [debouncedPriceMin, setDebouncedPriceMin] = useState("");
  const [debouncedPriceMax, setDebouncedPriceMax] = useState("");
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

  // Step 6.8: translated filter options for the sidebar accordions.
  const rarityOptions = localizeOptions(EQUIPMENT_RARITIES, t);
  const itemTypeOptions = localizeOptions(EQUIPMENT_ITEM_TYPES, t);
  const armorOptions = localizeOptions(ARMOR_CATEGORIES, t);
  const weaponOptions = localizeOptions(WEAPON_CATEGORIES, t);
  const spellCategoryOptions = localizeOptions(SPELL_CATEGORIES, t);
  const traditionOptions = localizeOptions(SPELL_TRADITIONS, t);
  const rankOptions = localizeOptions(SPELL_RANKS, t);
  const sizeOptions = localizeOptions(CREATURE_SIZES, t);
  const featCategoryOptions = localizeOptions(FEAT_CATEGORIES, t);
  const featSkillOptions = localizeOptions(FEAT_SKILLS, t);
  const tr = (key, fallback, values) =>
    formatMessage(t(key, fallback), values);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      lang: language === "en" ? "en" : "ru",
    });
    if (activeTab.type) {
      params.set("type", activeTab.type);
    }
    setCatalogTraits([]);
    fetch(
      "/api/compendiums/" +
        activeTab.category +
        "/facets?" +
        params.toString(),
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
        setCatalogTraits(
          Array.isArray(data && data.traits)
            ? data.traits
                .map((tag) => String(tag || "").trim().toLowerCase())
                .filter(Boolean)
            : [],
        );
      })
      .catch((fetchError) => {
        if (fetchError.name === "AbortError") {
          return;
        }
        setCatalogTraits([]);
      });
    return () => controller.abort();
  }, [activeTab.category, activeTab.type, language]);

  // Step 6.7: the tag palette is built from the catalogue facets, the loaded
  // cards and every selected tag, so an excluded tag stays visible for a
  // second click even when it no longer appears in the filtered results.
  const availableTraits = useMemo(() => {
    const tags = new Set([
      ...(advancedFilters.traitsIn || []),
      ...(advancedFilters.traitsOut || []),
      ...catalogTraits,
    ]);
    for (const entry of entries) {
      for (const tag of Array.isArray(entry.traits) ? entry.traits : []) {
        if (typeof tag === "string" && tag.trim() !== "") {
          tags.add(tag.trim().toLowerCase());
        }
      }
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b, "ru"));
  }, [
    entries,
    catalogTraits,
    advancedFilters.traitsIn,
    advancedFilters.traitsOut,
  ]);

  const visibleTraits = useMemo(() => {
    const query = traitSearch.trim().toLowerCase();
    const matches =
      query === ""
        ? availableTraits
        : availableTraits.filter((tag) => tag.includes(query));
    return matches.slice(0, 200);
  }, [availableTraits, traitSearch]);

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
      setDebouncedPriceMin(equipmentFilters.priceMin);
      setDebouncedPriceMax(equipmentFilters.priceMax);
    }, 250);
    return () => clearTimeout(timer);
  }, [
    search,
    minLevel,
    maxLevel,
    equipmentFilters.priceMin,
    equipmentFilters.priceMax,
  ]);

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [
    activeTabId,
    debouncedSearch,
    debouncedMinLevel,
    debouncedMaxLevel,
    debouncedPriceMin,
    debouncedPriceMax,
    equipmentFilters.rarity,
    equipmentFilters.itemTypes,
    equipmentFilters.armorCategories,
    equipmentFilters.weaponCategories,
    advancedFilters,
  ]);

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
      buildCompendiumUrl(activeTab, {
        language,
        search: debouncedSearch,
        limit,
        minLevel: debouncedMinLevel,
        maxLevel: debouncedMaxLevel,
        rarity: equipmentFilters.rarity,
        itemTypes: equipmentFilters.itemTypes,
        armorCategories: equipmentFilters.armorCategories,
        weaponCategories: equipmentFilters.weaponCategories,
        priceMin: debouncedPriceMin,
        priceMax: debouncedPriceMax,
        rarities: advancedFilters.rarity,
        spellCategories: advancedFilters.spellCategories,
        traditions: advancedFilters.traditions,
        ranks: advancedFilters.ranks,
        sizes: advancedFilters.sizes,
        featCategories: advancedFilters.featCategories,
        skills: advancedFilters.skills,
        traitsIn: advancedFilters.traitsIn,
        traitsOut: advancedFilters.traitsOut,
      }),
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
    debouncedPriceMin,
    debouncedPriceMax,
    equipmentFilters.rarity,
    equipmentFilters.itemTypes,
    equipmentFilters.armorCategories,
    equipmentFilters.weaponCategories,
    advancedFilters,
    limit,
    language,
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
  }, [activeTabId, language]);

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
        encodeURIComponent(entry.id) +
        "?lang=" +
        encodeURIComponent(language === "en" ? "en" : "ru"),
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

  const isEquipmentTab = activeTab.id === "equipment";
  const isSpellsTab = activeTab.id === "spells";
  const isBestiaryTab = activeTab.id === "bestiary";
  const isFeatsTab = activeTab.id === "feats";
  const hasSearch = debouncedSearch.trim() !== "";
  const hasLevelFilter =
    debouncedMinLevel.trim() !== "" || debouncedMaxLevel.trim() !== "";
  const isFiltered =
    hasSearch ||
    Boolean(activeTab.type) ||
    hasLevelFilter ||
    (isEquipmentTab && hasEquipmentFilters(equipmentFilters)) ||
    hasAdvancedFilters(advancedFilters);

  const selectTab = (tabId) => {
    if (tabId === activeTabId) {
      return;
    }
    setActiveTabId(tabId);
    // Filter checkbox state belongs to the current catalog; reset it when the
    // user switches tabs so stale selections cannot leak between catalogs.
    setEquipmentFilters(createEmptyEquipmentFilters());
    setAdvancedFilters(createEmptyAdvancedFilters());
    setTraitSearch("");
    setMinLevel("");
    setMaxLevel("");
    setDebouncedMinLevel("");
    setDebouncedMaxLevel("");
    setDebouncedPriceMin("");
    setDebouncedPriceMax("");
  };

  const toggleEquipmentFilter = (key, value) => {
    setEquipmentFilters((current) => ({
      ...current,
      [key]: toggleFilterValue(current[key], value),
    }));
  };

  const toggleAdvancedFilter = (key, value) => {
    setAdvancedFilters((current) => ({
      ...current,
      [key]: toggleFilterValue(current[key], value),
    }));
  };

  const cycleTrait = (tag) => {
    setAdvancedFilters((current) => cycleTraitFilter(current, tag));
  };

  const setEquipmentPrice = (key, value) => {
    setEquipmentFilters((current) => ({ ...current, [key]: value }));
  };

  const clearAllFilters = () => {
    setSearch("");
    setMinLevel("");
    setMaxLevel("");
    setDebouncedSearch("");
    setDebouncedMinLevel("");
    setDebouncedMaxLevel("");
    setDebouncedPriceMin("");
    setDebouncedPriceMax("");
    setEquipmentFilters(createEmptyEquipmentFilters());
    setAdvancedFilters(createEmptyAdvancedFilters());
    setTraitSearch("");
  };

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
          {t("PF2E.Platform.Compendium.WindowTitle", "Compendium Browser")}
        </div>
        <button
          type="button"
          className="ui-window__close"
          onClick={onClose}
          title={t("PF2E.Platform.Compendium.CloseEsc", "Close (Esc)")}
          aria-label={t(
            "PF2E.Platform.Compendium.CloseBrowser",
            "Close Compendium Browser",
          )}
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
            onClick={() => selectTab(tab.id)}
          >
            {t(tab.labelKey, tab.label)}
          </button>
        ))}
      </nav>

      <div className="compendium-browser__main">
        <aside
          className="pf2e-compendium-sidebar"
          aria-label={t(
            "PF2E.Platform.Compendium.FiltersAria",
            "Compendium filters",
          )}
        >
          <label className="compendium-field">
            <span className="compendium-field__label">
              {t("PF2E.Platform.Compendium.Search", "Search")}
            </span>
            <input
              type="search"
              className="ui-input compendium-search"
              placeholder={t(
                "PF2E.Platform.Compendium.SearchPlaceholder",
                "Search…",
              )}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={t(
                "PF2E.Platform.Compendium.SearchAria",
                "Search the compendium",
              )}
            />
          </label>

          {!isSpellsTab ? (
            <div className="compendium-sidebar__section">
              <div className="compendium-sidebar__title">
                {t("PF2E.Platform.Compendium.Levels", "Levels")}
              </div>
              <div
                className="compendium-levels"
                role="group"
                aria-label={t(
                  "PF2E.Platform.Compendium.LevelFilter",
                  "Level filter",
                )}
              >
                <label className="compendium-levels__field">
                  <span>{t("PF2E.Platform.Compendium.From", "From")}</span>
                  <input
                    type="number"
                    className="ui-input compendium-levels__input"
                    min={-1}
                    max={30}
                    step={1}
                    value={minLevel}
                    onChange={(event) => setMinLevel(event.target.value)}
                    aria-label={t(
                      "PF2E.Platform.Compendium.MinLevel",
                      "Minimum level",
                    )}
                  />
                </label>
                <label className="compendium-levels__field">
                  <span>{t("PF2E.Platform.Compendium.To", "To")}</span>
                  <input
                    type="number"
                    className="ui-input compendium-levels__input"
                    min={-1}
                    max={30}
                    step={1}
                    value={maxLevel}
                    onChange={(event) => setMaxLevel(event.target.value)}
                    aria-label={t(
                      "PF2E.Platform.Compendium.MaxLevel",
                      "Maximum level",
                    )}
                  />
                </label>
              </div>
            </div>
          ) : null}

          {isEquipmentTab ? (
            <div className="compendium-sidebar__filters">
              <FilterAccordion
                title={t(
                  "PF2E.Platform.Compendium.Accordion.Rarity",
                  "Rarity",
                )}
                defaultOpen
              >
                <FilterCheckboxGroup
                  label={t(
                    "PF2E.Platform.Compendium.Accordion.Rarity",
                    "Rarity",
                  )}
                  options={rarityOptions}
                  selected={equipmentFilters.rarity}
                  onToggle={(value) => toggleEquipmentFilter("rarity", value)}
                />
              </FilterAccordion>

              <FilterAccordion
                title={t(
                  "PF2E.Platform.Compendium.Accordion.ItemTypes",
                  "Item types",
                )}
                defaultOpen
              >
                <FilterCheckboxGroup
                  label={t(
                    "PF2E.Platform.Compendium.Accordion.ItemTypes",
                    "Item types",
                  )}
                  options={itemTypeOptions}
                  selected={equipmentFilters.itemTypes}
                  onToggle={(value) =>
                    toggleEquipmentFilter("itemTypes", value)
                  }
                />
              </FilterAccordion>

              <FilterAccordion
                title={t(
                  "PF2E.Platform.Compendium.Accordion.ArmorFilters",
                  "Armor filters",
                )}
              >
                <FilterCheckboxGroup
                  label={t(
                    "PF2E.Platform.Compendium.Accordion.ArmorFilters",
                    "Armor filters",
                  )}
                  options={armorOptions}
                  selected={equipmentFilters.armorCategories}
                  onToggle={(value) =>
                    toggleEquipmentFilter("armorCategories", value)
                  }
                />
              </FilterAccordion>

              <FilterAccordion
                title={t(
                  "PF2E.Platform.Compendium.Accordion.WeaponFilters",
                  "Weapon filters",
                )}
              >
                <FilterCheckboxGroup
                  label={t(
                    "PF2E.Platform.Compendium.Accordion.WeaponFilters",
                    "Weapon filters",
                  )}
                  options={weaponOptions}
                  selected={equipmentFilters.weaponCategories}
                  onToggle={(value) =>
                    toggleEquipmentFilter("weaponCategories", value)
                  }
                />
              </FilterAccordion>

              <FilterAccordion
                title={t("PF2E.Platform.Compendium.Accordion.Price", "Price")}
              >
                <div className="compendium-price">
                  <label className="compendium-price__field">
                    <span>{t("PF2E.Platform.Compendium.From", "From")}</span>
                    <input
                      type="text"
                      className="ui-input compendium-price__input"
                      placeholder={t(
                        "PF2E.Platform.Compendium.PriceMinPlaceholder",
                        "e.g. 0 cp",
                      )}
                      value={equipmentFilters.priceMin}
                      onChange={(event) =>
                        setEquipmentPrice("priceMin", event.target.value)
                      }
                      aria-label={t(
                        "PF2E.Platform.Compendium.MinPrice",
                        "Minimum price",
                      )}
                    />
                  </label>
                  <label className="compendium-price__field">
                    <span>{t("PF2E.Platform.Compendium.To", "To")}</span>
                    <input
                      type="text"
                      className="ui-input compendium-price__input"
                      placeholder={t(
                        "PF2E.Platform.Compendium.PriceMaxPlaceholder",
                        "e.g. 10 gp",
                      )}
                      value={equipmentFilters.priceMax}
                      onChange={(event) =>
                        setEquipmentPrice("priceMax", event.target.value)
                      }
                      aria-label={t(
                        "PF2E.Platform.Compendium.MaxPrice",
                        "Maximum price",
                      )}
                    />
                  </label>
                </div>
                <p className="compendium-filter__hint">
                  {t(
                    "PF2E.Platform.Compendium.PriceHint",
                    "Formats: “5 gp”, “10 sp”, “4 cp”. 1 gp = 10 sp = 100 cp.",
                  )}
                </p>
              </FilterAccordion>
            </div>
          ) : null}

          {isSpellsTab ? (
            <div className="compendium-sidebar__filters">
              <FilterAccordion
                title={t(
                  "PF2E.Platform.Compendium.Accordion.Categories",
                  "Categories",
                )}
                defaultOpen
              >
                <FilterCheckboxGroup
                  label={t(
                    "PF2E.Platform.Compendium.Filter.SpellCategories",
                    "Spell categories",
                  )}
                  options={spellCategoryOptions}
                  selected={advancedFilters.spellCategories}
                  onToggle={(value) =>
                    toggleAdvancedFilter("spellCategories", value)
                  }
                />
              </FilterAccordion>
              <FilterAccordion
                title={t(
                  "PF2E.Platform.Compendium.Accordion.Traditions",
                  "Traditions",
                )}
                defaultOpen
              >
                <FilterCheckboxGroup
                  label={t(
                    "PF2E.Platform.Compendium.Filter.MagicTraditions",
                    "Magical traditions",
                  )}
                  options={traditionOptions}
                  selected={advancedFilters.traditions}
                  onToggle={(value) =>
                    toggleAdvancedFilter("traditions", value)
                  }
                />
              </FilterAccordion>
              <FilterAccordion
                title={t("PF2E.Platform.Compendium.Accordion.Ranks", "Ranks")}
                defaultOpen
              >
                <FilterCheckboxGroup
                  label={t(
                    "PF2E.Platform.Compendium.Filter.SpellRanks",
                    "Spell ranks",
                  )}
                  options={rankOptions}
                  selected={advancedFilters.ranks}
                  onToggle={(value) => toggleAdvancedFilter("ranks", value)}
                />
              </FilterAccordion>
              <FilterAccordion
                title={t(
                  "PF2E.Platform.Compendium.Accordion.Rarity",
                  "Rarity",
                )}
                defaultOpen
              >
                <FilterCheckboxGroup
                  label={t(
                    "PF2E.Platform.Compendium.Accordion.Rarity",
                    "Rarity",
                  )}
                  options={rarityOptions}
                  selected={advancedFilters.rarity}
                  onToggle={(value) => toggleAdvancedFilter("rarity", value)}
                />
              </FilterAccordion>
            </div>
          ) : null}

          {isBestiaryTab ? (
            <div className="compendium-sidebar__filters">
              <FilterAccordion
                title={t("PF2E.Platform.Compendium.Accordion.Sizes", "Sizes")}
                defaultOpen
              >
                <FilterCheckboxGroup
                  label={t(
                    "PF2E.Platform.Compendium.Filter.CreatureSizes",
                    "Creature sizes",
                  )}
                  options={sizeOptions}
                  selected={advancedFilters.sizes}
                  onToggle={(value) => toggleAdvancedFilter("sizes", value)}
                />
              </FilterAccordion>
              <FilterAccordion
                title={t(
                  "PF2E.Platform.Compendium.Accordion.Rarity",
                  "Rarity",
                )}
                defaultOpen
              >
                <FilterCheckboxGroup
                  label={t(
                    "PF2E.Platform.Compendium.Accordion.Rarity",
                    "Rarity",
                  )}
                  options={rarityOptions}
                  selected={advancedFilters.rarity}
                  onToggle={(value) => toggleAdvancedFilter("rarity", value)}
                />
              </FilterAccordion>
            </div>
          ) : null}

          {isFeatsTab ? (
            <div className="compendium-sidebar__filters">
              <FilterAccordion
                title={t(
                  "PF2E.Platform.Compendium.Accordion.Categories",
                  "Categories",
                )}
                defaultOpen
              >
                <FilterCheckboxGroup
                  label={t(
                    "PF2E.Platform.Compendium.Filter.FeatCategories",
                    "Feat categories",
                  )}
                  options={featCategoryOptions}
                  selected={advancedFilters.featCategories}
                  onToggle={(value) =>
                    toggleAdvancedFilter("featCategories", value)
                  }
                />
              </FilterAccordion>
              <FilterAccordion
                title={t(
                  "PF2E.Platform.Compendium.Accordion.Skills",
                  "Skills",
                )}
                defaultOpen
              >
                <FilterCheckboxGroup
                  label={t(
                    "PF2E.Platform.Compendium.Filter.Skills",
                    "Skills",
                  )}
                  options={featSkillOptions}
                  selected={advancedFilters.skills}
                  onToggle={(value) => toggleAdvancedFilter("skills", value)}
                />
              </FilterAccordion>
              <FilterAccordion
                title={t(
                  "PF2E.Platform.Compendium.Accordion.Rarity",
                  "Rarity",
                )}
                defaultOpen
              >
                <FilterCheckboxGroup
                  label={t(
                    "PF2E.Platform.Compendium.Accordion.Rarity",
                    "Rarity",
                  )}
                  options={rarityOptions}
                  selected={advancedFilters.rarity}
                  onToggle={(value) => toggleAdvancedFilter("rarity", value)}
                />
              </FilterAccordion>
            </div>
          ) : null}

          <div className="compendium-sidebar__filters">
            <FilterAccordion
              title={t(
                "PF2E.Platform.Compendium.Accordion.Traits",
                "Traits",
              )}
              defaultOpen
            >
              <input
                type="search"
                className="ui-input compendium-trait-search"
                placeholder={t(
                  "PF2E.Platform.Compendium.TraitSearchPlaceholder",
                  "Search traits…",
                )}
                value={traitSearch}
                onChange={(event) => setTraitSearch(event.target.value)}
                aria-label={t(
                  "PF2E.Platform.Compendium.TraitSearchAria",
                  "Search traits",
                )}
              />
              <div
                className="compendium-trait-filter"
                role="group"
                aria-label={t(
                  "PF2E.Platform.Compendium.TraitsAria",
                  "Traits",
                )}
              >
                {visibleTraits.length === 0 ? (
                  <span className="compendium-filter__hint">
                    {t(
                      "PF2E.Platform.Compendium.NoTraits",
                      "No traits found.",
                    )}
                  </span>
                ) : (
                  visibleTraits.map((tag) => {
                    const state = traitFilterState(advancedFilters, tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        className={
                          "compendium-trait-chip" +
                          (state === "in"
                            ? " compendium-trait-chip--in"
                            : state === "out"
                              ? " compendium-trait-chip--out"
                              : "")
                        }
                        aria-pressed={state !== "none"}
                        title={
                          state === "in"
                            ? t(
                                "PF2E.Platform.Compendium.TraitIn",
                                "Included: only entries with this trait are shown. Click to exclude.",
                              )
                            : state === "out"
                              ? t(
                                  "PF2E.Platform.Compendium.TraitOut",
                                  "Excluded: entries with this trait are hidden. Click to reset.",
                                )
                              : t(
                                  "PF2E.Platform.Compendium.TraitNone",
                                  "Click to include this trait.",
                                )
                        }
                        onClick={() => cycleTrait(tag)}
                      >
                        {state === "in" ? "✓ " : state === "out" ? "✕ " : ""}
                        {tag}
                      </button>
                    );
                  })
                )}
              </div>
              <p className="compendium-filter__hint">
                {t(
                  "PF2E.Platform.Compendium.TraitHint",
                  "✓ includes the tag (AND), ✕ excludes it, clicking ✕ again resets.",
                )}
              </p>
            </FilterAccordion>
          </div>

          <button
            type="button"
            className="ui-button compendium-sidebar__clear"
            onClick={clearAllFilters}
          >
            {t(
              "PF2E.Platform.Compendium.ClearAll",
              "Clear all filters",
            )}
          </button>
        </aside>

        <div className="compendium-browser__results">
          <div className="compendium-browser__count">
            {loading
              ? t("PF2E.Platform.Compendium.ResultsLoading", "Loading…")
              : isFiltered
                ? tr(
                    "PF2E.Platform.Compendium.ResultsShown",
                    "Showing: {count}",
                    { count: entries.length },
                  )
                : total !== null
                  ? tr(
                      "PF2E.Platform.Compendium.ResultsShownOf",
                      "Showing: {count} of {total}",
                      { count: entries.length, total },
                    )
                  : tr(
                      "PF2E.Platform.Compendium.ResultsTotal",
                      "Entries: {count}",
                      { count: entries.length },
                    )}
          </div>

          <div className="compendium-browser__content">
            {error ? (
              <div className="compendium-browser__state compendium-browser__state--error">
                {tr(
                  "PF2E.Platform.Compendium.CatalogError",
                  "Failed to load the catalogue: {error}",
                  { error },
                )}
              </div>
            ) : null}

            {!error && !loading && entries.length === 0 ? (
              <div className="compendium-browser__state">
                {t("PF2E.Platform.Common.NothingFound", "Nothing found.")}
              </div>
            ) : null}

            <div className="compendium-grid">
              {entries.map((entry) => (
                <CompendiumCard
                  key={String(entry.id)}
                  tab={activeTab}
                  entry={entry}
                  levelLabel={t(
                    "PF2E.Platform.Compendium.CardLevel",
                    "lvl",
                  )}
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
                {t("PF2E.Platform.Compendium.ShowMore", "Show more")} (
                {entries.length}
                {total !== null && !isFiltered ? " / " + total : ""})
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <footer className="ui-window__footer">
        {t(
          "PF2E.Platform.Compendium.DragHint",
          "Drag a card onto a character sheet — payload:",
        )}{" "}
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
            aria-label={detailEntry ? detailEntry.name : t("PF2E.Platform.Compendium.WindowTitle", "Compendium Browser")}
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
                      {t("PF2E.Platform.Compendium.DetailLevel", "Level")}{" "}
                      {selectedEntry.level}
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
                aria-label={t(
                  "PF2E.Platform.Compendium.DetailClose",
                  "Close description",
                )}
              >
                ×
              </button>
            </header>
            <div className="compendium-detail__body">
              {detailLoading ? (
                <div className="compendium-detail__state">
                  {t(
                    "PF2E.Platform.Compendium.DetailLoading",
                    "Loading description…",
                  )}
                </div>
              ) : detailError ? (
                <div className="compendium-detail__state compendium-detail__state--error">
                  {tr(
                    "PF2E.Platform.Compendium.DetailError",
                    "Failed to load the description: {error}",
                    { error: detailError },
                  )}
                </div>
              ) : detailDescription !== "" ? (
                <p>{detailDescription}</p>
              ) : (
                <div className="compendium-detail__state">
                  {t(
                    "PF2E.Platform.Compendium.DetailEmpty",
                    "No description.",
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
