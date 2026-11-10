import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useStore } from "../StoreContext.jsx";
import {
  SAVES,
  SKILLS,
  applyClassToActor,
  armorClassBreakdown,
  createActorFeatFromDocument,
  createActorItemFromDocument,
  createActorSpellFromDocument,
  initiativeModifier,
  isPhysicalItemType,
  iwrLabel,
  prepareActorData,
  prepareActorSystem,
  perceptionModifier,
  saveModifier,
  signed,
} from "./character/character-data.js";
import AttributeBuilderModal from "./character/AttributeBuilderModal.jsx";
import CompendiumSelectModal from "./character/CompendiumSelectModal.jsx";
import {
  IwrEditorModal,
  LanguagesEditorModal,
  SpeedsEditorModal,
} from "./character/CharacterModals.jsx";
import {
  ActionsTab,
  BlindRollButton,
  CharacterTab,
  CombatTab,
  CommitInput,
  EffectsTab,
  FeatsTab,
  InventoryTab,
  RankBadge,
  SkillsTab,
  SpellsTab,
} from "./character/CharacterTabs.jsx";

const SHEET_TABS = [
  { id: "character", icon: "🪪", label: "Основа" },
  { id: "combat", icon: "⚔️", label: "Бой" },
  { id: "inventory", icon: "🎒", label: "Инвентарь" },
  { id: "actions", icon: "①", label: "Действия" },
  { id: "spells", icon: "✦", label: "Заклинания" },
  { id: "feats", icon: "🏅", label: "Черты" },
  { id: "skills", icon: "✋", label: "Навыки" },
  { id: "effects", icon: "☀", label: "Эффекты" },
];

const IWR_SECTIONS = [
  { category: "immunities", label: "Иммунитеты", icon: "🛡️" },
  { category: "weaknesses", label: "Слабости", icon: "💔" },
  { category: "resistances", label: "Сопротивления", icon: "🧱" },
];

const VISION_LABELS = {
  "low-light-vision": "СУМЕРЕЧНОЕ ЗРЕНИЕ",
  lowlight: "СУМЕРЕЧНОЕ ЗРЕНИЕ",
  darkvision: "ТЕМНОЕ ЗРЕНИЕ",
  "greater-darkvision": "УЛУЧШЕННОЕ ТЁМНОЕ ЗРЕНИЕ",
};

const ARMOR_CATEGORY_LABELS = {
  unarmored: "Без брони",
  light: "Лёгкая броня",
  medium: "Средняя броня",
  heavy: "Тяжёлая броня",
};

const AC_MODIFIER_TYPES = [
  { value: "circumstance", label: "Обстоятельство" },
  { value: "status", label: "Статус" },
];

export function sensesFromSystem(system) {
  const senses = [];
  const push = (value) => {
    const key = String(value || "").toLowerCase();
    const label = VISION_LABELS[key];
    if (label && !senses.includes(label)) {
      senses.push(label);
    }
  };
  push(system?.details?.ancestry?.vision);
  for (const sense of system?.details?.heritage?.senses || []) {
    push(sense);
  }
  return senses;
}

/**
 * Persist only the mechanical parts of an ancestry/background/heritage/class
 * document. The full Foundry document is far too large for `details`.
 */
function compendiumSelectionDetails(category, document, fallback) {
  const doc = document || {};
  const system = doc.system || {};
  const source = {
    id: doc.id !== undefined ? doc.id : fallback?.id,
    name: doc.name || fallback?.name,
    img: doc.img || fallback?.img || null,
    value: doc.name || fallback?.name,
    slug: doc.slug || system.slug || fallback?.slug || null,
  };

  if (category === "ancestries") {
    const hp = Number(system.hp);
    return {
      ...source,
      ...(Number.isFinite(hp) && hp > 0 ? { hp } : {}),
      boosts: system.boosts,
      flaws: system.flaws,
      vision: system.vision || null,
      speed: system.speed,
      size: system.size,
      languages: system.languages,
      traits: doc.traits,
    };
  }
  if (category === "heritages") {
    const senses = Array.isArray(system.rules)
      ? system.rules
          .filter((rule) => rule && rule.key === "Sense" && typeof rule.selector === "string")
          .map((rule) => rule.selector)
      : [];
    return {
      ...source,
      ancestry: system.ancestry || null,
      senses,
      traits: doc.traits,
    };
  }
  if (category === "backgrounds") {
    return {
      ...source,
      boosts: system.boosts,
      trainedSkills: system.trainedSkills,
      traits: doc.traits,
    };
  }
  if (category === "classes") {
    const hp = Number(system.hp);
    return {
      ...source,
      ...(Number.isFinite(hp) && hp > 0 ? { hp } : {}),
      keyAbility: Array.isArray(system.keyAbility?.value)
        ? system.keyAbility.value
        : fallback?.keyAbility || [],
    };
  }
  return source;
}

/**
 * Full PF2e Remastered player-character sheet (Step 4.8, Part 1).
 *
 * Layout follows `static/templates/actors/character/sheet.hbs`: a left sidebar
 * with HP/AC/perception/initiative/saves/IWR, a character header, and the eight
 * sheet tabs. Every edit writes the complete `actor.system` back through
 * `room:update-actor`; the server persists the directory tree immediately.
 */
export default function CharacterSheet({ actorId, onClose }) {
  const {
    networkClient,
    directories,
    users,
    myUserId,
    activeRole,
  } = useStore();

  const actor = useMemo(() => {
    const entries = directories?.actors?.entries || [];
    return entries.find((entry) => entry.id === actorId) || null;
  }, [directories, actorId]);

  // Derived values are recalculated from raw scores/proficiencies whenever the
  // actor payload changes. The sheet edits the prepared system, so Strength /
  // Dexterity edits immediately flow into fists, AC, saves and perception.
  const preparedActor = useMemo(() => prepareActorData(actor), [actor]);
  const preparedSystem = preparedActor.system;

  const owner = useMemo(
    () => (users || []).find((user) => user.characterId === actorId) || null,
    [users, actorId],
  );
  const isGM = activeRole === "gm";
  const isOwner = Boolean(owner && myUserId && owner.id === myUserId);
  const canClose = isGM || isOwner || !owner;
  const editable = isGM || isOwner || !owner;

  const [system, setSystem] = useState(() => preparedSystem);
  // `prepareActorData` migrates legacy `system.inventory.items` rows into the
  // Foundry-style actor item collection, so the sheet always starts from the
  // merged list.
  const [items, setItems] = useState(() =>
    Array.isArray(preparedActor.items) ? preparedActor.items : [],
  );
  const [name, setName] = useState(actor ? actor.name : "");
  const [activeTab, setActiveTab] = useState("character");
  const [modal, setModal] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [position, setPosition] = useState(null);
  const [sheetSize, setSheetSize] = useState(null);
  const [compact, setCompact] = useState(false);
  const [acOpen, setAcOpen] = useState(false);
  const [acDraft, setAcDraft] = useState({
    name: "",
    value: 1,
    type: "circumstance",
  });
  const dragRef = useRef(null);
  const resizeRef = useRef(null);
  const sheetRef = useRef(null);

  // Reset the local draft when the window switches actors.
  useEffect(() => {
    const next = prepareActorData(actor);
    setSystem(next.system);
    setItems(Array.isArray(next.items) ? next.items : []);
    setName(actor ? actor.name : "");
    setActiveTab("character");
    setError("");
    setPosition(null);
    setSheetSize(null);
    setAcOpen(false);
  }, [actorId]);

  // The sheet is resizable independently from the viewport, so media queries
  // cannot decide when tab labels must collapse. Observe the window itself.
  useEffect(() => {
    const element = sheetRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width || element.clientWidth;
      setCompact(width < 960);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [actorId, actor ? 1 : 0]);

  // Accept external updates (another client / the server echo). JSON compare
  // keeps local edits from being reset by unrelated directory broadcasts.
  useEffect(() => {
    if (!actor) {
      return;
    }
    const normalized = preparedSystem;
    setSystem((current) =>
      JSON.stringify(current) === JSON.stringify(normalized) ? current : normalized,
    );
    const normalizedItems = Array.isArray(preparedActor.items)
      ? preparedActor.items
      : [];
    setItems((current) =>
      JSON.stringify(current) === JSON.stringify(normalizedItems)
        ? current
        : normalizedItems,
    );
    setName((current) => (current === actor.name ? current : actor.name || ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor ? actor.system : null, actor ? actor.name : null, actor ? actor.items : null]);

  const persist = (nextSystem, nextName, nextItems) => {
    if (!editable || !networkClient || !actor) {
      return;
    }
    setSaving(true);
    setError("");
    networkClient
      .updateActor(actor.id, {
        name: nextName === undefined ? name : nextName,
        system: nextSystem,
        items: nextItems === undefined ? items : nextItems,
      })
      .catch((saveError) => {
        setError(saveError.message || "Не удалось сохранить изменения.");
      })
      .finally(() => setSaving(false));
  };

  /**
   * Commit a system + actor.items pair through the derivation pipeline. Used by
   * the class/level automation and the spellcasting-entry editor, where both
   * the sheet system and the actor's item collection change together.
   */
  const commitActorState = (nextSystem, nextItems, nextName) => {
    if (!editable) {
      return;
    }
    const prepared = prepareActorSystem(nextSystem, nextItems);
    setSystem(prepared);
    setItems(nextItems);
    persist(prepared, nextName, nextItems);
  };

  /**
   * Commit a new `actor.items` collection (Step 4.8.3). Physical items are the
   * Foundry source of truth for Bulk, armor and generated strikes, so they are
   * re-derived together with `actor.system`.
   */
  const updateItems = (nextItems) => {
    if (!editable) {
      return;
    }
    commitActorState(system, nextItems);
  };

  const updateSystem = (mutator) => {
    if (!editable) {
      return;
    }
    const draft = typeof mutator === "function" ? mutator(system) : mutator;
    // Every mutation passes through the derivation pipeline so AC, fists,
    // saves and perception never drift from the raw attribute modifiers.
    const next = prepareActorSystem(draft, items);
    setSystem(next);
    persist(next, undefined, items);
  };

  const rename = (value) => {
    const trimmed = String(value || "").trim();
    if (trimmed === "") {
      return;
    }
    setName(trimmed);
    persist(system, trimmed);
  };

  const sendChat = (text, plain = false, visibility = "public") => {
    if (!networkClient || !text) {
      return;
    }
    const message = text.startsWith("/r ") || !plain ? text : "Использует: " + text;
    networkClient
      .sendChatMessage({ text: message, visibility })
      .catch((sendError) => {
        setError(sendError.message || "Не удалось отправить сообщение в чат.");
      });
  };

  const patchPath = (path, value) => {
    updateSystem((current) => {
      const next = { ...current };
      let cursor = next;
      for (let index = 0; index < path.length - 1; index += 1) {
        cursor[path[index]] = { ...cursor[path[index]] };
        cursor = cursor[path[index]];
      }
      cursor[path[path.length - 1]] = value;
      return next;
    });
  };

  const fetchCompendiumDocument = async (category, id) => {
    const response = await fetch(
      "/api/compendiums/" +
        encodeURIComponent(category) +
        "/" +
        encodeURIComponent(id),
      { headers: { Accept: "application/json" } },
    );
    if (!response.ok) {
      throw new Error("HTTP " + response.status + " " + response.statusText);
    }
    return response.json();
  };

  /**
   * ABC selection pipeline. Choosing a class loads the full class document and
   * applies its 1st-level (and current-level) features, base proficiencies and
   * feat slots to both `actor.system` and `actor.items`.
   */
  const applyCompendiumSelection = async (key, category, entry) => {
    if (!entry || !key) {
      return;
    }

    // ABC choices are index entries. Fetch the full document so the sheet can
    // persist the mechanical summary (HP, boosts, flaws, vision, key ability)
    // needed by the automatic HP and ability-builder pipelines.
    let document = entry.system ? entry : null;
    if (!document) {
      try {
        document = await fetchCompendiumDocument(category, entry.id);
      } catch (fetchError) {
        document = null;
      }
    }
    const selection = compendiumSelectionDetails(category, document, entry);
    const baseSystem = {
      ...system,
      details: {
        ...system.details,
        [key]: { ...(system.details?.[key] || {}), ...selection },
      },
    };

    if (category !== "classes") {
      updateSystem((current) => ({
        ...current,
        details: {
          ...current.details,
          [key]: { ...(current.details?.[key] || {}), ...selection },
        },
      }));
      return;
    }

    try {
      if (!document) {
        throw new Error(
          "Не удалось загрузить документ класса. Выбор сохранён без автоматизации.",
        );
      }
      const next = applyClassToActor(
        { ...actor, system: baseSystem, items },
        document,
      );
      commitActorState(next.system, next.items);
    } catch (fetchError) {
      setError(
        fetchError.message ||
          "Не удалось загрузить документ класса. Выбор сохранён без автоматизации.",
      );
      commitActorState(baseSystem, items);
    }
  };

  /** Level-up hook: re-runs the class pipeline so new features/slots appear. */
  const handleLevelChange = (value) => {
    const nextLevel = Math.max(1, Math.min(20, Number(value) || 1));
    const baseSystem = {
      ...system,
      details: {
        ...system.details,
        level: { value: nextLevel },
      },
    };
    const classId = system.details?.class?.id;
    if (!classId) {
      commitActorState(baseSystem, items);
      return;
    }
    fetchCompendiumDocument("classes", classId)
      .then((classDoc) => {
        const next = applyClassToActor(
          { ...actor, system: baseSystem, items },
          classDoc,
          { level: nextLevel },
        );
        commitActorState(next.system, next.items);
      })
      .catch((fetchError) => {
        setError(
          fetchError.message ||
            "Не удалось обновить классовые особенности при повышении уровня.",
        );
        commitActorState(baseSystem, items);
      });
  };

  const createSpellcastingEntry = (entry) => {
    if (!entry) {
      return;
    }
    const nextItems = [...items.filter((item) => item.id !== entry.id), entry];
    commitActorState(system, nextItems);
  };

  const updateSpellcastingEntry = (entry) => {
    if (!entry) {
      return;
    }
    const nextItems = items.map((item) =>
      item.id === entry.id ? entry : item,
    );
    commitActorState(system, nextItems);
  };

  const deleteSpellcastingEntry = (entry) => {
    if (!entry) {
      return;
    }
    const nextItems = items.filter((item) => {
      if (item.id === entry.id) {
        return false;
      }
      if (item.type !== "spell") {
        return true;
      }
      const location = item.system?.location;
      const entryId =
        item.entryId ||
        (location && typeof location === "object" ? location.value : location);
      return entryId !== entry.id;
    });
    commitActorState(system, nextItems);
  };

  const handleSheetDragOver = (event) => {
    if (event.dataTransfer?.types?.includes("application/json")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  };

  /**
   * Compendium → Inventory drop (Step 4.8.3). The drag payload only carries
   * the compact index entry, so the full document is fetched from
   * `GET /api/compendiums/:category/:id` before it is added to `actor.items`.
   */
  const createUniqueItemId = (base) => {
    const root = String(base || "item") || "item";
    let id = root;
    let suffix = 2;
    while (items.some((item) => item.id === id)) {
      id = root + "-" + suffix;
      suffix += 1;
    }
    return id;
  };

  /**
   * Compendium → Feats (Step 4.8.4). The feat's `system.category` decides the
   * sheet section; a drop on an empty class/general slot also binds the feat to
   * that slot id (`system.location` on the item, `featSlots[].featId` on the
   * actor), exactly like the ABC pipeline's slot model.
   */
  const addCompendiumFeat = async (category, entry, target) => {
    let document = entry && entry.system ? entry : null;
    if (!document) {
      document = await fetchCompendiumDocument(category, entry.id);
    }
    const feat = createActorFeatFromDocument(document, {
      slotId: target && target.slotId ? target.slotId : "",
    });
    feat.id = createUniqueItemId(feat.id);
    const previousFeatId =
      target && target.slotId
        ? (system.featSlots || []).find((slot) => slot.id === target.slotId)
            ?.featId || null
        : null;
    const nextItems = [
      ...items.filter((item) => !previousFeatId || item.id !== previousFeatId),
      feat,
    ];
    const nextSystem =
      target && target.slotId
        ? {
            ...system,
            featSlots: (system.featSlots || []).map((slot) =>
              slot.id === target.slotId ? { ...slot, featId: feat.id } : slot,
            ),
          }
        : system;
    commitActorState(nextSystem, nextItems);
  };

  /**
   * Compendium → Spell (Step 4.8.4). Every spell stores its parent
   * spellcasting entry in `system.location.value`.
   */
  const addCompendiumSpell = async (category, entry, entryId) => {
    let document = entry && entry.system ? entry : null;
    if (!document) {
      document = await fetchCompendiumDocument(category, entry.id);
    }
    const entries = items.filter((item) => item.type === "spellcastingEntry");
    const targetEntryId = entryId || (entries[0] ? entries[0].id : "");
    if (!targetEntryId) {
      setError(
        "Сначала создайте набор заклинаний: без него заклинание некуда привязать.",
      );
      return;
    }
    const spell = createActorSpellFromDocument(document, {
      entryId: targetEntryId,
    });
    spell.id = createUniqueItemId(spell.id);
    commitActorState(system, [...items, spell]);
  };

  /**
   * Shared drop router for the sheet and the tab-level drop zones.
   * @returns {boolean} true when the payload was consumed.
   */
  const handleCompendiumDrop = (payload, target) => {
    if (!payload || payload.type !== "compendium-item" || !payload.entry) {
      return false;
    }
    if (payload.category === "feats") {
      addCompendiumFeat(payload.category, payload.entry, target).catch(
        (fetchError) => {
          setError(fetchError.message || "Не удалось добавить черту.");
        },
      );
      return true;
    }
    if (payload.category === "spells") {
      addCompendiumSpell(
        payload.category,
        payload.entry,
        target && target.entryId,
      ).catch((fetchError) => {
        setError(fetchError.message || "Не удалось добавить заклинание.");
      });
      return true;
    }
    return false;
  };

  const addCompendiumItemToInventory = async (category, entry) => {
    let document = entry && entry.system ? entry : null;
    if (!document) {
      document = await fetchCompendiumDocument(category, entry.id);
    }
    if (!isPhysicalItemType(document.type || entry.type)) {
      setError(
        "Этот документ нельзя положить в инвентарь: тип «" +
          (document.type || entry.type || "?") +
          "».",
      );
      return;
    }
    const baseId = String(document.id || entry.id || "item");
    let id = baseId;
    let suffix = 2;
    while (items.some((item) => item.id === id)) {
      id = baseId + "-" + suffix;
      suffix += 1;
    }
    const item = createActorItemFromDocument(document, {
      id,
      carried: "stowed",
    });
    updateItems([...items, item]);
  };

  const handleSheetDrop = (event) => {
    const serialized =
      event.dataTransfer?.getData("application/json") ||
      event.dataTransfer?.getData("text/plain");
    if (!serialized) {
      return;
    }
    let payload;
    try {
      payload = JSON.parse(serialized);
    } catch (parseError) {
      return;
    }
    if (!payload || payload.type !== "compendium-item" || !payload.entry) {
      return;
    }
    event.preventDefault();
    // Feats and spells live in their own tabs; the tab-level drop zones pass an
    // explicit target (feat slot id / spellcasting entry id).
    if (handleCompendiumDrop(payload, null)) {
      return;
    }
    const keyByCategory = {
      ancestries: "ancestry",
      heritages: "heritage",
      backgrounds: "background",
      classes: "class",
    };
    const key = keyByCategory[payload.category];
    if (key) {
      applyCompendiumSelection(key, payload.category, payload.entry);
      return;
    }
    addCompendiumItemToInventory(payload.category, payload.entry).catch(
      (fetchError) => {
        setError(
          fetchError.message || "Не удалось добавить предмет в инвентарь.",
        );
      },
    );
  };

  const handleHeaderPointerDown = (event) => {
    if (
      event.button !== 0 ||
      (event.target.closest &&
        event.target.closest("button, input, select, textarea, a"))
    ) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    try {
      if (event.currentTarget.setPointerCapture) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    } catch (error) {
      // Synthetic pointer events have no active pointer id.
    }
    event.preventDefault();
  };

  const handleHeaderPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    const maxX = Math.max(0, window.innerWidth - 140);
    const maxY = Math.max(0, window.innerHeight - 60);
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
    try {
      if (event.currentTarget.releasePointerCapture) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch (error) {
      // Synthetic pointer events have no active pointer id.
    }
  };

  const handleResizePointerDown = (event) => {
    if (event.button !== 0) {
      return;
    }
    const element = sheetRef.current;
    if (!element) {
      return;
    }
    const rect = element.getBoundingClientRect();
    // Anchor the window before growing it so the top-left corner does not jump
    // while the sheet is still centred by the default transform.
    setPosition((current) =>
      current ? current : { x: rect.left, y: rect.top },
    );
    setSheetSize({ width: rect.width, height: rect.height });
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
    };
    try {
      if (event.currentTarget.setPointerCapture) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    } catch (error) {
      // Synthetic pointer events have no active pointer id.
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const handleResizePointerMove = (event) => {
    const drag = resizeRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    const maxWidth = Math.max(320, window.innerWidth - 16);
    const maxHeight = Math.max(320, window.innerHeight - 16);
    setSheetSize({
      width: Math.min(maxWidth, Math.max(520, drag.width + event.clientX - drag.startX)),
      height: Math.min(maxHeight, Math.max(420, drag.height + event.clientY - drag.startY)),
    });
  };

  const handleResizePointerUp = (event) => {
    const drag = resizeRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    resizeRef.current = null;
    try {
      if (event.currentTarget.releasePointerCapture) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch (error) {
      // Synthetic pointer events have no active pointer id.
    }
  };

  const addAcModifier = () => {
    const name = String(acDraft.name || "").trim();
    const value = Math.trunc(Number(acDraft.value) || 0);
    if (!name || value === 0) {
      return;
    }
    updateSystem((current) => ({
      ...current,
      attributes: {
        ...current.attributes,
        ac: {
          ...current.attributes?.ac,
          modifiers: [
            ...(current.attributes?.ac?.modifiers || []),
            {
              id: "ac-modifier-" + Date.now().toString(36),
              name,
              value,
              type: acDraft.type === "status" ? "status" : "circumstance",
            },
          ],
        },
      },
    }));
    setAcDraft({ name: "", value: 1, type: "circumstance" });
  };

  const removeAcModifier = (id) => {
    updateSystem((current) => ({
      ...current,
      attributes: {
        ...current.attributes,
        ac: {
          ...current.attributes?.ac,
          modifiers: (current.attributes?.ac?.modifiers || []).filter(
            (entry) => entry.id !== id,
          ),
        },
      },
    }));
  };

  if (!actor) {
    return createPortal(
      <div className="modal-backdrop pf2e-sheet-backdrop" role="presentation">
        <div className="modal-window">
          <header className="modal-window__header">
            <h2 className="modal-window__title">Лист персонажа не найден</h2>
          </header>
          <div className="modal-window__body">
            Актёр был удалён или ещё не синхронизирован.
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

  const level = system.details?.level?.value || 1;
  const hp = system.attributes?.hp || { value: 0, max: 0, temp: 0 };
  const shield = system.attributes?.shield || {};
  const perception = perceptionModifier(system);
  const initiative = initiativeModifier(system);
  const acDerived = system.derived?.armorClass || armorClassBreakdown(system);
  const senses = sensesFromSystem(system);
  const defenseRank =
    system.proficiencies?.defenses?.[acDerived.category]?.rank || 0;

  const commonTabProps = {
    system,
    items,
    actor,
    editable,
    updateSystem,
    onItemsChange: updateItems,
    onCommitActor: commitActorState,
    onCompendiumDrop: handleCompendiumDrop,
    onRoll: sendChat,
    openModal: setModal,
    onCreateEntry: createSpellcastingEntry,
    onUpdateEntry: updateSpellcastingEntry,
    onDeleteEntry: deleteSpellcastingEntry,
  };

  const renderTab = () => {
    switch (activeTab) {
      case "combat":
        return <CombatTab {...commonTabProps} />;
      case "inventory":
        return <InventoryTab {...commonTabProps} />;
      case "actions":
        return <ActionsTab {...commonTabProps} />;
      case "spells":
        return <SpellsTab {...commonTabProps} />;
      case "feats":
        return <FeatsTab {...commonTabProps} />;
      case "skills":
        return <SkillsTab {...commonTabProps} />;
      case "effects":
        return <EffectsTab {...commonTabProps} />;
      case "character":
      default:
        return <CharacterTab {...commonTabProps} />;
    }
  };

  const renderModal = () => {
    if (!modal) {
      return null;
    }
    if (modal === "languages") {
      return (
        <LanguagesEditorModal
          languages={system.details?.languages?.value || []}
          details={system.details?.languages?.details || ""}
          onSave={(next) =>
            updateSystem((current) => ({
              ...current,
              details: {
                ...current.details,
                languages: { value: next.value, details: next.details },
              },
            }))
          }
          onClose={() => setModal(null)}
        />
      );
    }
    if (modal === "speeds") {
      return (
        <SpeedsEditorModal
          speeds={system.speeds}
          onSave={(speeds) =>
            updateSystem((current) => ({ ...current, speeds }))
          }
          onClose={() => setModal(null)}
        />
      );
    }
    if (modal === "attributes") {
      return (
        <AttributeBuilderModal
          system={system}
          onSave={({ abilities, build }) =>
            updateSystem((current) => ({ ...current, abilities, build }))
          }
          onClose={() => setModal(null)}
        />
      );
    }
    if (typeof modal === "object" && modal.type === "compendium") {
      return (
        <CompendiumSelectModal
          category={modal.category}
          title={modal.label}
          filters={modal.filters}
          onSelect={(entry) => {
            if (!entry) {
              return;
            }
            applyCompendiumSelection(modal.key, modal.category, entry);
          }}
          onClose={() => setModal(null)}
        />
      );
    }
    if (typeof modal === "object" && modal.category) {
      return (
        <IwrEditorModal
          category={modal.category}
          entries={system.attributes?.[modal.category] || []}
          onSave={(entries) =>
            updateSystem((current) => ({
              ...current,
              attributes: { ...current.attributes, [modal.category]: entries },
            }))
          }
          onClose={() => setModal(null)}
        />
      );
    }
    return null;
  };

  const initiativeOptions = [
    { value: "perception", label: "Восприятие" },
    ...SAVES.map((save) => ({ value: save.key, label: save.label })),
    ...SKILLS.map((skill) => ({ value: skill.key, label: skill.label })),
  ];

  return createPortal(
    <div className="pf2e-sheet-backdrop" role="presentation">
      <section
        ref={sheetRef}
        className={"pf2e-sheet" + (compact ? " pf2e-sheet--compact" : "")}
        role="dialog"
        aria-label={"Лист персонажа: " + actor.name}
        onDragOver={handleSheetDragOver}
        onDrop={handleSheetDrop}
        style={{
          ...(position
            ? { left: position.x + "px", top: position.y + "px", transform: "none" }
            : {}),
          ...(sheetSize
            ? { width: sheetSize.width + "px", height: sheetSize.height + "px" }
            : {}),
        }}
      >
        <header
          className="pf2e-sheet__chrome"
          onPointerDown={handleHeaderPointerDown}
          onPointerMove={handleHeaderPointerMove}
          onPointerUp={handleHeaderPointerUp}
          onPointerCancel={handleHeaderPointerUp}
          title="Перетащите за заголовок, чтобы переместить лист"
        >
          <div className="pf2e-sheet__chrome-title">
            <span className="pf2e-sheet__chrome-icon" aria-hidden="true">
              🧙
            </span>
            <span>{actor.name}</span>
            <span className="pf2e-sheet__chrome-sub">
              {actor.actorType === "npc" ? "NPC" : "Персонаж игрока"} · уровень {level}
            </span>
          </div>
          <div className="pf2e-sheet__chrome-status">
            {saving ? <span className="pf2e-save-state">Сохранение…</span> : null}
            <span className="pf2e-owner-badge">
              {owner ? "Игрок: " + owner.name : "Без владельца"}
            </span>
            <button
              type="button"
              className="ui-window__close"
              onClick={onClose}
              disabled={!canClose}
              title={
                canClose
                  ? "Закрыть лист"
                  : "Закрыть лист может только мастер или владелец персонажа"
              }
              aria-label="Закрыть лист персонажа"
            >
              ×
            </button>
          </div>
        </header>

        {error ? (
          <div className="pf2e-sheet__error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="pf2e-sheet__body">
          <aside className="pf2e-sidebar" aria-label="Ключевые показатели">
            <section className="pf2e-sidebar__block">
              <header className="pf2e-sidebar__header">
                <h2>Хиты</h2>
                <span className="pf2e-sidebar__hint">HP</span>
              </header>
              <div className="pf2e-hp">
                <label className="pf2e-hp__stat pf2e-hp__stat--temp">
                  <span>Врем.</span>
                  <CommitInput
                    type="number"
                    min="0"
                    value={hp.temp || 0}
                    disabled={!editable}
                    onCommit={(value) =>
                      patchPath(["attributes", "hp", "temp"], Math.max(0, Number(value) || 0))
                    }
                  />
                </label>
                <label className="pf2e-hp__stat pf2e-hp__stat--current">
                  <span>Текущие</span>
                  <CommitInput
                    type="number"
                    min="0"
                    value={hp.value || 0}
                    disabled={!editable}
                    onCommit={(value) =>
                      patchPath(["attributes", "hp", "value"], Math.max(0, Number(value) || 0))
                    }
                  />
                </label>
                <div className="pf2e-hp__max">
                  <span>Макс.</span>
                  <CommitInput
                    type="number"
                    min="0"
                    value={hp.max || 0}
                    disabled={!editable}
                    onCommit={(value) =>
                      patchPath(["attributes", "hp", "max"], Math.max(1, Number(value) || 1))
                    }
                  />
                </div>
              </div>
            </section>

            <section className="pf2e-sidebar__block">
              <header className="pf2e-sidebar__header">
                <h2>Броня</h2>
                <span className="pf2e-sidebar__hint">AC</span>
              </header>
              <div className="pf2e-ac-row">
                <div className="pf2e-ac-wrap">
                  <div
                    className={"pf2e-ac" + (acOpen ? " pf2e-ac--open" : "")}
                    role="button"
                    tabIndex={0}
                    title="Нажмите, чтобы раскрыть расчёт КБ"
                    onClick={(event) => {
                      if (
                        event.target.closest &&
                        event.target.closest("input, button, textarea, select")
                      ) {
                        return;
                      }
                      setAcOpen((current) => !current);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setAcOpen((current) => !current);
                      }
                    }}
                  >
                    <CommitInput
                      type="number"
                      value={system.attributes?.ac?.value ?? 10}
                      disabled={!editable}
                      onCommit={(value) =>
                        patchPath(["attributes", "ac", "value"], Number(value) || 10)
                      }
                    />
                    <span>КБ</span>
                  </div>
                  <button
                    type="button"
                    className="pf2e-small-button pf2e-ac__mod-button"
                    title="Показать слагаемые КБ и временные модификаторы"
                    aria-expanded={acOpen}
                    onClick={() => setAcOpen((current) => !current)}
                  >
                    Мод.
                  </button>

                  {acOpen ? (
                    <div className="pf2e-ac-popover" role="dialog" aria-label="Расчёт КБ">
                      <header className="pf2e-ac-popover__header">
                        <strong>Расчёт КБ</strong>
                        <button
                          type="button"
                          className="pf2e-icon-button"
                          title="Закрыть"
                          aria-label="Закрыть расчёт КБ"
                          onClick={() => setAcOpen(false)}
                        >
                          ×
                        </button>
                      </header>
                      <ul className="pf2e-ac-popover__list">
                        <li>
                          <span>База</span>
                          <b>{signed(acDerived.base ?? 10)}</b>
                        </li>
                        <li>
                          <span>
                            Ловкость
                            {acDerived.dexCap !== null &&
                            acDerived.dexCap !== undefined &&
                            acDerived.dexMod > acDerived.dexCap
                              ? " (кап " + acDerived.dexCap + ")"
                              : ""}
                          </span>
                          <b>{signed(acDerived.appliedDex)}</b>
                        </li>
                        <li>
                          <span>
                            Обученность · {ARMOR_CATEGORY_LABELS[acDerived.category] || acDerived.category}
                          </span>
                          <b>{signed(acDerived.proficiency)}</b>
                          <RankBadge rank={defenseRank} />
                        </li>
                        <li>
                          <span>
                            Бонус брони
                            {acDerived.armorName ? " · " + acDerived.armorName : ""}
                          </span>
                          <b>{signed(acDerived.itemBonus)}</b>
                        </li>
                        {(acDerived.modifiers || []).map((entry) => (
                          <li className="pf2e-ac-popover__modifier" key={entry.id}>
                            <span>
                              {entry.name}
                              <em>
                                {entry.type === "status" ? "статус" : "обстоятельство"}
                              </em>
                            </span>
                            <b>{signed(entry.value)}</b>
                            {editable ? (
                              <button
                                type="button"
                                className="pf2e-icon-button pf2e-icon-button--danger"
                                title="Удалить модификатор"
                                aria-label="Удалить модификатор"
                                onClick={() => removeAcModifier(entry.id)}
                              >
                                ×
                              </button>
                            ) : null}
                          </li>
                        ))}
                        <li className="pf2e-ac-popover__total">
                          <span>Итого</span>
                          <b>{signed(acDerived.value)}</b>
                        </li>
                      </ul>

                      {editable ? (
                        <form
                          className="pf2e-ac-popover__form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            addAcModifier();
                          }}
                        >
                          <input
                            className="ui-input"
                            value={acDraft.name}
                            placeholder="Название"
                            aria-label="Название модификатора КБ"
                            onChange={(event) =>
                              setAcDraft((current) => ({
                                ...current,
                                name: event.target.value,
                              }))
                            }
                          />
                          <input
                            className="ui-input pf2e-ac-popover__value"
                            type="number"
                            value={acDraft.value}
                            aria-label="Значение модификатора КБ"
                            onChange={(event) =>
                              setAcDraft((current) => ({
                                ...current,
                                value: event.target.value,
                              }))
                            }
                          />
                          <select
                            className="ui-input"
                            value={acDraft.type}
                            aria-label="Тип модификатора КБ"
                            onChange={(event) =>
                              setAcDraft((current) => ({
                                ...current,
                                type: event.target.value,
                              }))
                            }
                          >
                            {AC_MODIFIER_TYPES.map((type) => (
                              <option key={type.value} value={type.value}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            className="ui-button ui-button--primary"
                            disabled={!String(acDraft.name).trim() || !Number(acDraft.value)}
                          >
                            + Добавить
                          </button>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <label className="pf2e-shield-hp">
                  <span>Щит</span>
                  <CommitInput
                    type="number"
                    min="0"
                    value={shield.hp?.value || 0}
                    disabled={!editable || !(shield.hp?.max > 0)}
                    onCommit={(value) =>
                      patchPath(["attributes", "shield", "hp", "value"], Math.max(0, Number(value) || 0))
                    }
                  />
                  <em>/ {shield.hp?.max || 0}</em>
                </label>
              </div>
            </section>

            <section className="pf2e-sidebar__block">
              <header className="pf2e-sidebar__header">
                <h2>Восприятие</h2>
                <span className="pf2e-sidebar__hint">МДР</span>
              </header>
              <div className="pf2e-roll-row">
                <button
                  type="button"
                  className="pf2e-roll-button"
                  title="Бросок восприятия"
                  onClick={() => sendChat("/r 1d20" + signed(perception) + " Восприятие")}
                >
                  <span className="pf2e-d20">d20</span>
                </button>
                <button
                  type="button"
                  className="pf2e-roll-button pf2e-roll-button--blind"
                  title="Тайная проверка (Blind Roll): результат видит только мастер"
                  aria-label="Тайная проверка восприятия"
                  onClick={() =>
                    sendChat(
                      "/r 1d20" + signed(perception) + " Восприятие (тайно)",
                      false,
                      "blind",
                    )
                  }
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path
                      d="M3 12s3.5-5 9-5 9 5 9 5-3.5 5-9 5-9-5-9-5Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    />
                    <circle cx="12" cy="12" r="2.6" fill="currentColor" />
                    <path
                      d="M4 4 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
                <span className="pf2e-roll-row__modifier">{signed(perception)}</span>
                <RankBadge rank={system.perception?.rank} />
              </div>
              {senses.length > 0 ? (
                <ul className="pf2e-sense-list" aria-label="Особые чувства">
                  {senses.map((sense) => (
                    <li className="pf2e-sense" key={sense}>
                      {sense}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section className="pf2e-sidebar__block">
              <header className="pf2e-sidebar__header">
                <h2>Инициатива</h2>
                <select
                  className="pf2e-initiative-select"
                  value={system.initiative?.statistic || "perception"}
                  disabled={!editable}
                  onChange={(event) =>
                    patchPath(["initiative", "statistic"], event.target.value)
                  }
                >
                  {initiativeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="pf2e-roll-button pf2e-roll-button--small pf2e-initiative-roll"
                  title="Мгновенный бросок инициативы"
                  aria-label="Мгновенный бросок инициативы"
                  onClick={() => sendChat("/r 1d20" + signed(initiative) + " Инициатива")}
                >
                  <span className="pf2e-d20">d20</span>
                </button>
              </header>
              <div className="pf2e-roll-row">
                <button
                  type="button"
                  className="pf2e-roll-button"
                  title="Бросок инициативы"
                  onClick={() => sendChat("/r 1d20" + signed(initiative) + " Инициатива")}
                >
                  <span className="pf2e-d20">d20</span>
                </button>
                <span className="pf2e-roll-row__modifier">{signed(initiative)}</span>
              </div>
            </section>

            <section className="pf2e-sidebar__block">
              <header className="pf2e-sidebar__header">
                <h2>Спасброски</h2>
              </header>
              <ul className="pf2e-save-list">
                {SAVES.map((save) => (
                  <li className="pf2e-save" key={save.key}>
                    <span className="pf2e-save__name">{save.label}</span>
                    <RankBadge rank={system.saves?.[save.key]?.rank} />
                    <button
                      type="button"
                      className="pf2e-roll-button pf2e-roll-button--small"
                      title={"Спасбросок: " + save.label}
                      onClick={() =>
                        sendChat(
                          "/r 1d20" + signed(saveModifier(system, save.key)) + " " + save.label,
                        )
                      }
                    >
                      <span className="pf2e-d20">d20</span>
                    </button>
                    <BlindRollButton
                      title={"Тайный спасбросок: " + save.label}
                      onClick={() =>
                        sendChat(
                          "/r 1d20" +
                            signed(saveModifier(system, save.key)) +
                            " " +
                            save.label +
                            " (тайно)",
                          false,
                          "blind",
                        )
                      }
                    />
                    <span className="pf2e-save__modifier">
                      {signed(saveModifier(system, save.key))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {IWR_SECTIONS.map((section) => {
              const entries = system.attributes?.[section.category] || [];
              return (
                <section className="pf2e-sidebar__block" key={section.category}>
                  <header className="pf2e-sidebar__header">
                    <h2>
                      <span aria-hidden="true">{section.icon}</span> {section.label}
                    </h2>
                    {editable ? (
                      <button
                        type="button"
                        className="pf2e-small-button"
                        title={"Редактировать: " + section.label}
                        onClick={() => setModal({ category: section.category })}
                      >
                        ✎ Редактировать
                      </button>
                    ) : null}
                  </header>
                  <ul className="pf2e-iwr-tags">
                    {entries.length === 0 ? (
                      <li className="pf2e-empty-inline">Нет</li>
                    ) : (
                      entries.map((entry, index) => (
                        <li
                          className="pf2e-tag pf2e-tag--secondary"
                          key={entry.type + "-" + index}
                          title={
                            [entry.exceptions, entry.doubleVs]
                              .filter(Boolean)
                              .join(" · ") || undefined
                          }
                        >
                          {iwrLabel(entry.type)}
                          {section.category !== "immunities" && entry.value
                            ? " " + entry.value
                            : ""}
                        </li>
                      ))
                    )}
                  </ul>
                </section>
              );
            })}
          </aside>

          <div className="pf2e-main">
            <header className="pf2e-char-header">
              <div className="pf2e-char-header__name">
                <CommitInput
                  className="pf2e-char-name"
                  value={name}
                  disabled={!editable}
                  placeholder="Имя персонажа"
                  onCommit={rename}
                />
                <div className="pf2e-char-header__sub">
                  {system.details?.ancestry?.value || "Родословная не выбрана"} ·{" "}
                  {system.details?.class?.value || "Класс не выбран"}
                </div>
              </div>
              <div className="pf2e-char-header__level">
                <label>
                  <span>Уровень</span>
                  <CommitInput
                    type="number"
                    min="1"
                    max="20"
                    value={level}
                    disabled={!editable}
                    onCommit={handleLevelChange}
                  />
                </label>
              </div>
              <div className="pf2e-char-header__xp">
                <label>
                  <span>Опыт</span>
                  <CommitInput
                    type="number"
                    min="0"
                    value={system.details?.xp?.value || 0}
                    disabled={!editable}
                    onCommit={(value) =>
                      patchPath(["details", "xp", "value"], Math.max(0, Number(value) || 0))
                    }
                  />
                  <em>/ {system.details?.xp?.max || 1000}</em>
                </label>
                <progress
                  value={system.details?.xp?.value || 0}
                  max={system.details?.xp?.max || 1000}
                />
              </div>
            </header>

            <nav className="pf2e-sheet-nav" role="tablist" aria-label="Вкладки листа">
              <span className="pf2e-sheet-nav__title">Лист персонажа</span>
              {SHEET_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={
                    "pf2e-sheet-nav__tab" +
                    (activeTab === tab.id ? " pf2e-sheet-nav__tab--active" : "")
                  }
                  title={tab.label}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span className="pf2e-sheet-nav__icon" aria-hidden="true">
                    {tab.icon}
                  </span>
                  <span className="pf2e-sheet-nav__label">{tab.label}</span>
                </button>
              ))}
            </nav>

            <div className="pf2e-sheet-content">{renderTab()}</div>
          </div>
        </div>
        <span
          className="pf2e-sheet__resizer"
          role="separator"
          aria-label="Изменить размер листа"
          title="Потяните, чтобы изменить размер листа"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerUp}
        />
      </section>
      {renderModal()}
    </div>,
    document.body,
  );
}
