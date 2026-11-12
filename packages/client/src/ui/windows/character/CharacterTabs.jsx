import { useEffect, useMemo, useState } from "react";

import {
  ABILITIES,
  CARRIED_STATUSES,
  CONDITIONS,
  FEAT_SECTIONS,
  RANKS,
  SAVES,
  SKILLS,
  SPELL_RANKS,
  SPELLCASTING_MODES,
  SPELLCASTING_TRADITIONS,
  SPELLCASTING_TYPES,
  TRADITIONS,
  ITEM_GROUPS,
  abilityMod,
  clampRank,
  encumbranceState,
  focusSpellPointCost,
  isFocusSpellcastingEntry,
  itemCanHoldHands,
  itemGroupId,
  iwrLabel,
  isPhysicalItemType,
  languageLabel,
  maxSpellRankForLevel,
  nextEntryId,
  normalizePhysicalItem,
  parseBulkValue,
  proficiencyBonus,
  signed,
  skillModifier,
  spellcastingStats,
  strikeMapLabel,
  totalBulk,
} from "./character-data.js";
import {
  EntryEditorModal,
  SpellcastingSetupModal,
} from "./CharacterModals.jsx";
import ItemSheetModal from "./ItemSheetModal.jsx";
import RichTextEditor from "../../RichTextEditor.jsx";
import SpellPreparationModal from "./SpellPreparationModal.jsx";
import {
  acceptsPreparedSpellDrag,
  readPreparedSpellDrag,
  setPreparedSpellDragData,
} from "./spell-drag.js";
import { useTranslation } from "../../i18n.js";
import { confirmAction } from "../../overlays/dialog-service.js";
import { setMacroDragData } from "../../hotbar-macros.js";

const PLACEHOLDER_IMAGE = "/assets/ui/item-placeholder.svg";

/**
 * Turn any sheet button into a hotbar macro source (Step 4.9). The payload is
 * the exact chat text the same button sends when clicked.
 */
function hotbarMacroProps(macro) {
  return {
    draggable: true,
    onDragStart: (event) => setMacroDragData(event, macro),
  };
}

export function CommitInput({ value, onCommit, type = "text", ...props }) {
  const [draft, setDraft] = useState(value === undefined || value === null ? "" : String(value));
  useEffect(() => {
    setDraft(value === undefined || value === null ? "" : String(value));
  }, [value]);
  return (
    <input
      {...props}
      type={type}
      className={"pf2e-input " + (props.className || "")}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (String(value ?? "") !== draft) {
          const committed = onCommit(draft);
          // A commit handler may clamp/normalise the input (for example the
          // current-HP field caps at maximum HP). Mirror the resolved value so
          // the field never keeps showing an out-of-range draft.
          if (committed !== undefined && committed !== null) {
            setDraft(String(committed));
          }
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function CommitTextarea({ value, onCommit, rows = 3, ...props }) {
  const [draft, setDraft] = useState(value || "");
  useEffect(() => {
    setDraft(value || "");
  }, [value]);
  return (
    <textarea
      {...props}
      className={"pf2e-input " + (props.className || "")}
      rows={rows}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if ((value || "") !== draft) {
          onCommit(draft);
        }
      }}
    />
  );
}

export function RankBadge({ rank }) {
  const entry = RANKS[clampRank(rank)] || RANKS[0];
  return (
    <span className={"pf2e-rank pf2e-rank--" + entry.short.toLowerCase()} title={entry.title}>
      {entry.short}
    </span>
  );
}

function RankSelect({ rank, onChange, disabled, minRank = 0 }) {
  const floor = clampRank(minRank);
  const value = Math.max(clampRank(rank), floor);
  return (
    <select
      className={"pf2e-rank-select pf2e-rank-select--" + (RANKS[value]?.short || "u").toLowerCase()}
      value={value}
      disabled={disabled}
      title={
        floor > 0
          ? RANKS[value]?.title + " · минимум: " + RANKS[floor]?.label
          : RANKS[value]?.title
      }
      onChange={(event) => onChange(Math.max(Number(event.target.value), floor))}
    >
      {RANKS.map((entry) => (
        <option
          key={entry.value}
          value={entry.value}
          disabled={entry.value < floor}
        >
          {entry.short} — {entry.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Blind-roll button (crossed-out eye). Used next to every skill/save roll so a
 * GM-only secret check can be sent with `visibility: "blind"`.
 */
export function BlindRollButton({
  onClick,
  title = "Тайный бросок",
  small = true,
  dragMacro = null,
}) {
  return (
    <button
      type="button"
      className={
        "pf2e-roll-button pf2e-roll-button--blind" +
        (small ? " pf2e-roll-button--small" : "")
      }
      title={title}
      aria-label={title}
      onClick={onClick}
      {...(dragMacro ? hotbarMacroProps(dragMacro) : {})}
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
  );
}

function SectionHeader({ title, actions, hint }) {  return (
    <header className="pf2e-section-header">
      <span className="pf2e-section-header__title">{title}</span>
      {hint ? <span className="pf2e-section-header__hint">{hint}</span> : null}
      {actions ? <span className="pf2e-section-header__actions">{actions}</span> : null}
    </header>
  );
}

function TagList({ values, empty = "—", className = "" }) {
  if (!values || values.length === 0) {
    return <span className="pf2e-empty-inline">{empty}</span>;
  }
  return (
    <ul className={"pf2e-tag-list " + className}>
      {values.map((value) => (
        <li className="pf2e-tag" key={value}>
          {value}
        </li>
      ))}
    </ul>
  );
}

function splitTraits(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function costGlyph(cost) {
  if (cost === "reaction") {
    return "⟲";
  }
  if (cost === "free") {
    return "◇";
  }
  return String(cost || "1");
}

function rollLabel(modifier, label) {
  return "/r 1d20" + signed(modifier) + " " + label;
}

function blindRollLabel(modifier, label) {
  return "/r 1d20" + signed(modifier) + " " + label + " (тайно)";
}

function canAcceptCompendiumDrop(event) {
  return Boolean(
    event &&
      event.dataTransfer &&
      Array.from(event.dataTransfer.types || []).includes("application/json"),
  );
}

/** Read the Compendium Browser drag payload, or `null` for foreign drags. */
function readCompendiumDrop(event) {
  if (!event || !event.dataTransfer) {
    return null;
  }
  const serialized =
    event.dataTransfer.getData("application/json") ||
    event.dataTransfer.getData("text/plain");
  if (!serialized) {
    return null;
  }
  try {
    const payload = JSON.parse(serialized);
    return payload && payload.type === "compendium-item" && payload.entry
      ? payload
      : null;
  } catch (error) {
    return null;
  }
}

/** Foundry spell/feat descriptions are HTML; the chat renders plain text. */
function plainDescription(value, fallback = "") {
  const text = String(value || fallback || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
}

function featChatText(feat) {
  const description = plainDescription(feat.description);
  const traits = splitTraits(feat.traits).join(", ");
  return [
    "🏅 " + feat.name + (feat.level ? " (ур. " + feat.level + ")" : ""),
    traits ? "Черты: " + traits : "",
    description,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Inline description shown directly below a feat/item/spell row. */
function InlineDescription({ text, className = "" }) {
  const content = plainDescription(text);
  return (
    <p className={"pf2e-inline-description " + className}>
      {content || "Описание отсутствует."}
    </p>
  );
}

/**
 * Step 5.7: one shared feat row for class features, slots and loose feats.
 * Clicking the name expands the description; the pencil opens ItemSheetModal;
 * the speech bubble shares the feat in chat.
 */
function FeatCard({
  feat,
  expanded = false,
  onToggle,
  onShare,
  onOpenSheet,
  onRemove,
  editable = false,
}) {
  const traits = splitTraits(feat.traits);
  return (
    <li
      className={
        "pf2e-feat pf2e-feat--card" + (expanded ? " pf2e-feat--expanded" : "")
      }
    >
      <button
        type="button"
        className="pf2e-feat__img"
        title="Отправить описание черты в чат"
        onClick={onShare}
      >
        {feat.img ? (
          <img src={feat.img} alt="" loading="lazy" />
        ) : (
          <span aria-hidden="true">🏅</span>
        )}
      </button>
      <span className="pf2e-feat__level">ур. {feat.level || 1}</span>
      <button
        type="button"
        className="pf2e-feat__name pf2e-feat__name--button"
        title="Показать или скрыть описание"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        {feat.name}
      </button>
      {traits.length > 0 ? (
        <span className="pf2e-feat__traits">
          {traits.slice(0, 4).join(", ")}
        </span>
      ) : null}
      <div className="pf2e-item-controls">
        <button
          type="button"
          className="pf2e-icon-button"
          title="Поделиться описанием в чате"
          onClick={onShare}
        >
          💬
        </button>
        {typeof onOpenSheet === "function" ? (
          <button
            type="button"
            className="pf2e-icon-button"
            title="Изменить (карточка предмета)"
            onClick={() => onOpenSheet(feat)}
          >
            ✎
          </button>
        ) : null}
        {editable && typeof onRemove === "function" ? (
          <button
            type="button"
            className="pf2e-icon-button pf2e-icon-button--danger"
            title="Удалить"
            onClick={() => onRemove(feat)}
          >
            ✕
          </button>
        ) : null}
      </div>
      {expanded ? <InlineDescription text={feat.description} /> : null}
    </li>
  );
}

/** Step 5.7: the four player-selectable feat-slot groups, in sheet order. */
const FEAT_SLOT_SECTIONS = [
  { type: "ancestry", label: "Способности родословной", icon: "🧬" },
  { type: "class", label: "Способности класса", icon: "⚔️" },
  { type: "skill", label: "Способности навыков", icon: "✋" },
  { type: "general", label: "Общие способности", icon: "🌟" },
];

const EXTRA_FEAT_SECTIONS = [
  { id: "heritage", label: "Наследие", icon: "🌿" },
  { id: "bonus", label: "Бонусные способности", icon: "🎁" },
];


// --------------------------------------------------------------- Character

export function CharacterTab({
  system,
  actor,
  editable,
  updateSystem,
  openModal,
}) {
  const tags = useMemo(() => splitTraits(system.traits?.value?.join?.(",") || ""), [system.traits]);
  const [newTrait, setNewTrait] = useState("");

  const patchDetails = (key, value) =>
    updateSystem((current) => ({
      ...current,
      details: { ...current.details, [key]: { ...current.details[key], value } },
    }));

  const addTrait = () => {
    const trimmed = newTrait.trim();
    if (trimmed === "") {
      return;
    }
    updateSystem((current) => {
      const values = Array.isArray(current.traits.value) ? current.traits.value : [];
      if (values.includes(trimmed)) {
        return current;
      }
      return { ...current, traits: { ...current.traits, value: [...values, trimmed] } };
    });
    setNewTrait("");
  };

  return (
    <section className="pf2e-tab pf2e-tab--character">
      <div className="pf2e-identity">
        <div className="pf2e-portrait">
          <img
            src={(actor && actor.img) || PLACEHOLDER_IMAGE}
            alt={actor?.name || "Персонаж"}
            onError={(event) => {
              event.currentTarget.src = PLACEHOLDER_IMAGE;
            }}
          />
          <span className="pf2e-portrait__label">Портрет</span>
        </div>

        <div className="pf2e-identity__details">
          <div className="pf2e-tag-row">
            <span className="pf2e-tag pf2e-tag--size">
              {system.traits?.size?.value === "sm"
                ? "Маленький"
                : system.traits?.size?.value === "lg"
                  ? "Большой"
                  : "Средний"}
            </span>
            {tags.map((tag) => (
              <span className="pf2e-tag" key={tag}>
                {tag}
              </span>
            ))}
            {editable ? (
              <span className="pf2e-inline-add">
                <input
                  className="pf2e-input pf2e-input--tiny"
                  value={newTrait}
                  placeholder="Черта…"
                  onChange={(event) => setNewTrait(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTrait();
                    }
                  }}
                />
                <button type="button" className="pf2e-icon-button" onClick={addTrait}>
                  +
                </button>
              </span>
            ) : null}
          </div>

          <div className="pf2e-abc-grid">
            {[
              ["ancestry", "Родословная", "ancestries"],
              ["heritage", "Наследие", "heritages"],
              ["background", "Предыстория", "backgrounds"],
              ["class", "Класс", "classes"],
            ].map(([key, label, category]) => {
              const entry = system.details?.[key] || {};
              const selectedName = entry.name || entry.value || "";
              const ancestry = system.details?.ancestry || {};
              const filters =
                category === "heritages"
                  ? ancestry.slug || ancestry.name
                    ? {
                        ancestry: ancestry.slug || ancestry.name,
                        includeVersatile: true,
                      }
                    : { versatile: true }
                  : undefined;
              return (
                <div className="pf2e-abc" key={key}>
                  <span className="pf2e-abc__label">{label}</span>
                  <button
                    type="button"
                    className={
                      "pf2e-abc-picker" +
                      (selectedName ? "" : " pf2e-abc-picker--empty")
                    }
                    title={
                      selectedName
                        ? selectedName + " — нажмите, чтобы изменить"
                        : "Выбрать из компендиума"
                    }
                    disabled={!editable}
                    onClick={() =>
                      openModal({
                        type: "compendium",
                        category,
                        key,
                        label:
                          category === "heritages" && ancestry.name
                            ? "Наследие · " + ancestry.name
                            : label,
                        filters,
                      })
                    }
                  >
                    <span className="pf2e-abc-picker__value">
                      {selectedName || "—"}
                    </span>
                    <span className="pf2e-abc-picker__icon" aria-hidden="true">
                      🔍
                    </span>
                  </button>
                </div>
              );
            })}
            <label className="pf2e-abc">
              <span className="pf2e-abc__label">Божество</span>
              <CommitInput
                value={system.details?.deity?.value || ""}
                placeholder="—"
                disabled={!editable}
                onCommit={(value) => patchDetails("deity", value)}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="pf2e-two-column">
        <div className="pf2e-panel">
          <SectionHeader
            title="Языки"
            actions={
              editable ? (
                <button
                  type="button"
                  className="pf2e-small-button"
                  onClick={() => openModal("languages")}
                >
                  ✎ Редактировать
                </button>
              ) : null
            }
          />
          <TagList
            values={(system.details?.languages?.value || []).map(languageLabel)}
          />
          {system.details?.languages?.details ? (
            <p className="pf2e-muted">{system.details.languages.details}</p>
          ) : null}
        </div>

        <div className="pf2e-panel">
          <SectionHeader
            title="Скорости"
            actions={
              editable ? (
                <button
                  type="button"
                  className="pf2e-small-button"
                  onClick={() => openModal("speeds")}
                >
                  ✎ Редактировать
                </button>
              ) : null
            }
          />
          <div className="pf2e-speed-grid">
            {[
              ["land", "Скорость"],
              ["burrow", "Копание"],
              ["climb", "Лазание"],
              ["fly", "Полёт"],
              ["swim", "Плавание"],
            ].map(([key, label]) => {
              const value = system.speeds?.[key]?.value || 0;
              return (
                <div className={"pf2e-speed" + (value > 0 ? "" : " pf2e-speed--empty")} key={key}>
                  <span className="pf2e-speed__value">{value > 0 ? value : "—"}</span>
                  <span className="pf2e-speed__unit">фт.</span>
                  <span className="pf2e-speed__label">{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <SectionHeader
        title="Модификаторы атрибутов"
        actions={
          editable ? (
            <button
              type="button"
              className="pf2e-small-button"
              onClick={() => openModal("attributes")}
            >
              ✎ Редактировать
            </button>
          ) : null
        }
      />
      <ul className="pf2e-attribute-grid">
        {ABILITIES.map((ability) => {
          const mod = abilityMod(system, ability.key);
          const isKey = system.details?.keyability?.value === ability.key;
          return (
            <li
              className={"pf2e-attribute" + (isKey ? " pf2e-attribute--key" : "")}
              key={ability.key}
              data-attribute={ability.key}
              title={"Модификатор: " + signed(mod)}
            >
              <h2 className="pf2e-attribute__abbr">{ability.abbr}</h2>
              <h3 className="pf2e-attribute__modifier">{signed(mod)}</h3>
              <span className="pf2e-attribute__label">{ability.label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ Combat

const BASE_ACTION_NAMES = new Set(
  [
    "Trip",
    "Shove",
    "Grapple",
    "Disarm",
    "Reposition",
    "Escape",
    "Step",
    "Stride",
    "Stand",
    "Take Cover",
    "Seek",
    "Sense Motive",
    "Aid",
    "Delay",
    "Ready",
    "Raise a Shield",
    "Demoralize",
    "Create a Diversion",
    "Feint",
    "Hide",
    "Sneak",
    "Tumble Through",
    "Recall Knowledge",
    "Treat Wounds",
    "Опрокинуть",
    "Толкнуть",
    "Схватить",
    "Обезоружить",
    "Переместить",
    "Вырваться",
    "Шаг",
    "Шагнуть",
    "Встать",
    "Укрыться",
    "Искать",
    "Почувствовать мотив",
    "Помочь",
    "Отложить",
    "Приготовиться",
    "Поднять щит",
    "Деморализовать",
    "Создать отвлечение",
    "Финт",
    "Скрыться",
    "Красться",
    "Кувыркнуться",
    "Вспомнить знания",
    "Обработать раны",
  ].map((name) => name.toLowerCase()),
);

/**
 * Step 5.5: the former Actions tab is collapsed into Combat. Only actions that
 * come from feats/class features are listed; the generic base action library
 * (Trip, Shove, ...) is intentionally hidden for now.
 */
function isBaseAction(action) {
  if (!action) {
    return true;
  }
  if (action.base === true || action.source === "core") {
    return true;
  }
  if (String(action.id || "").startsWith("base-action-")) {
    return true;
  }
  return BASE_ACTION_NAMES.has(String(action.name || "").trim().toLowerCase());
}

function featureActions(system) {
  const result = [];
  for (const section of ["encounter", "exploration", "downtime"]) {
    for (const action of system.actions?.[section] || []) {
      if (!isBaseAction(action)) {
        result.push({ ...action, section });
      }
    }
  }
  return result;
}

/**
 * Foundry's strike row: one d20 attack button per multiple-attack-penalty step
 * plus a damage button. Agility changes the MAP to -4/-8, everything else uses
 * the standard -5/-10.
 */
export function CombatTab({
  system,
  actor,
  items,
  editable,
  updateSystem,
  onRoll,
  onItemsChange,
}) {
  const { t } = useTranslation();
  const [editor, setEditor] = useState(null);
  const [actionEditor, setActionEditor] = useState(null);
  const strikes = system.strikes || [];
  // Step 6.7: toggleable RollOptions collected during actor preparation.
  const toggles = Array.isArray(system.toggles) ? system.toggles : [];
  const actorId = actor && actor.id ? actor.id : null;
  const heldShield =
    (Array.isArray(items) ? items : []).find(
      (item) => item && item.type === "shield" && item.carried === "held",
    ) || null;
  const raiseShieldAction = heldShield
    ? {
        id: "base-action-raise-a-shield",
        name: "Поднять щит",
        cost: "1",
        traits: "манипуляция",
        base: true,
        description:
          (heldShield.raised
            ? "Щит поднят: " + (heldShield.name || "щит") + " даёт бонус к КБ."
            : "Поднимите " +
              (heldShield.name || "щит") +
              ", чтобы получить его бонус к КБ до начала вашего следующего хода."),
      }
    : null;
  const actions = raiseShieldAction
    ? [raiseShieldAction, ...featureActions(system)]
    : featureActions(system);

  const toggleShieldRaised = () => {
    if (!heldShield || typeof onItemsChange !== "function") {
      return;
    }
    onItemsChange(
      (Array.isArray(items) ? items : []).map((item) =>
        item.id === heldShield.id ? { ...item, raised: !item.raised } : item,
      ),
    );
  };

  /**
   * Persist the toggle state in `system.flags.pf2e.rollOptions` (Foundry's
   * `all` domain) and re-derive the actor immediately. The resulting
   * `room:update-actor` payload contains the recomputed AC, saves and strikes.
   */
  const setRollOption = (toggle, enabled) => {
    updateSystem((current) => {
      const flags =
        current.flags && typeof current.flags === "object" ? current.flags : {};
      const pf2e =
        flags.pf2e && typeof flags.pf2e === "object" ? flags.pf2e : {};
      const rollOptions =
        pf2e.rollOptions && typeof pf2e.rollOptions === "object"
          ? pf2e.rollOptions
          : {};
      const all =
        rollOptions.all && typeof rollOptions.all === "object"
          ? rollOptions.all
          : {};
      return {
        ...current,
        flags: {
          ...flags,
          pf2e: {
            ...pf2e,
            rollOptions: {
              ...rollOptions,
              all: { ...all, [toggle.option]: enabled },
            },
          },
        },
      };
    });
  };

  const toggleLabel = (toggle) => {
    const raw = String(toggle.label || toggle.itemName || toggle.option || "");
    if (raw.startsWith("PF2E.")) {
      return t(raw, toggle.itemName || toggle.option);
    }
    return raw || toggle.option;
  };

  const saveAction = (action) => {
    updateSystem((current) => {
      const next = {};
      for (const entry of ACTION_SECTIONS) {
        next[entry.id] = (current.actions?.[entry.id] || []).filter(
          (existing) => existing.id !== action.id,
        );
      }
      const target = next[action.section] ? action.section : "encounter";
      next[target] = [...next[target], action];
      return { ...current, actions: next };
    });
  };

  const removeAction = (action) => {
    updateSystem((current) => ({
      ...current,
      actions: Object.fromEntries(
        ACTION_SECTIONS.map((entry) => [
          entry.id,
          (current.actions?.[entry.id] || []).filter(
            (existing) => existing.id !== action.id,
          ),
        ]),
      ),
    }));
  };

  /** Step 4.9: the hotbar replays the same `/r` chat text as this button. */
  const strikeMacro = (strike, modifier, suffix) => ({
    type: "strike",
    actorId,
    actionId: strike.id + (suffix ? ":map" : ""),
    name: strike.name + (suffix ? " " + suffix.trim() : ""),
    icon: strike.img || null,
    text:
      "/r 1d20" +
      signed(modifier) +
      " " +
      strike.name +
      (suffix ? " " + suffix : "") +
      " — атака",
  });

  const damageMacro = (strike) => ({
    type: "strike",
    actorId,
    actionId: strike.id + ":damage",
    name: strike.name + " (урон)",
    icon: strike.img || null,
    text: "/r " + (strike.damage || "1d6") + " " + strike.name + " — урон",
  });

  const saveStrike = (strike) => {
    // A manually edited attack value becomes the new base: the preparation
    // pipeline re-applies active FlatModifier attack rules on top of it.
    const draft = { ...strike, baseAttack: undefined };
    updateSystem((current) => {
      const list = Array.isArray(current.strikes) ? current.strikes : [];
      const exists = list.some((entry) => entry.id === draft.id);
      return {
        ...current,
        strikes: exists
          ? list.map((entry) => (entry.id === draft.id ? draft : entry))
          : [...list, draft],
      };
    });
  };

  const removeStrike = (strike) => {
    updateSystem((current) => ({
      ...current,
      strikes: (current.strikes || []).filter((entry) => entry.id !== strike.id),
    }));
  };

  const rollAttack = (strike, modifier, suffix) =>
    onRoll(
      "/r 1d20" +
        signed(modifier) +
        " " +
        strike.name +
        (suffix ? " " + suffix : "") +
        " — атака",
    );

  return (
    <section className="pf2e-tab pf2e-tab--combat">
      <SectionHeader
        title="Атаки"
        hint="Оружие в руках и безоружные удары"
        actions={
          editable ? (
            <button type="button" className="pf2e-small-button" onClick={() => setEditor({})}>
              + Добавить атаку
            </button>
          ) : null
        }
      />
      <ol className="pf2e-strike-list">
        {strikes.length === 0 ? (
          <p className="pf2e-empty">
            Атак пока нет. Возьмите оружие в руки во вкладке «Инвентарь».
          </p>
        ) : (
          strikes.map((strike) => {
            const agile = strike.agile === true;
            const map = Number.isFinite(Number(strike.map))
              ? Number(strike.map)
              : agile
                ? -4
                : -5;
            const map2 = Number.isFinite(Number(strike.map2))
              ? Number(strike.map2)
              : agile
                ? -8
                : -10;
            const attackMap = Number.isFinite(Number(strike.attackMap))
              ? Number(strike.attackMap)
              : strike.attack + map;
            const attackMap2 = Number.isFinite(Number(strike.attackMap2))
              ? Number(strike.attackMap2)
              : strike.attack + map2;
            return (
              <li className="pf2e-strike" key={strike.id}>
                <span
                  className="pf2e-strike__icon"
                  aria-hidden="true"
                  title={"Перетащите атаку в хотбар: " + strike.name}
                  {...hotbarMacroProps(strikeMacro(strike, strike.attack, ""))}
                >
                  {strike.img ? <img src={strike.img} alt="" /> : "⚔"}
                </span>
                <div className="pf2e-strike__body">
                  <div className="pf2e-strike__name">{strike.name}</div>
                  <div className="pf2e-strike__formula">
                    <span className="pf2e-strike__attack">
                      {signed(strike.attack)}
                      {strike.attackAbility ? " (" + strike.attackAbility.toUpperCase() + ")" : ""}
                    </span>
                    <span className="pf2e-strike__damage">
                      {strike.damage || "—"}{" "}
                      {strike.damageType ? iwrLabel(strike.damageType) : ""}
                    </span>
                    {Number(strike.handsHeld) > 0 ? (
                      <span className="pf2e-strike__hands">
                        {strike.handsHeld} рук.
                      </span>
                    ) : null}
                  </div>
                  {strike.traits ? (
                    <div className="pf2e-strike__traits">
                      {splitTraits(strike.traits).map((trait) => (
                        <span className="pf2e-tag pf2e-tag--trait" key={trait}>
                          {trait}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="pf2e-strike__buttons">
                  <button
                    type="button"
                    className="pf2e-strike-button pf2e-strike-button--attack"
                    title={
                      "Атака: /r 1d20" + signed(strike.attack) + " · " + strike.name
                    }
                    onClick={() => rollAttack(strike, strike.attack, "")}
                    {...hotbarMacroProps(strikeMacro(strike, strike.attack, ""))}
                  >
                    <span className="pf2e-strike-button__value">
                      {signed(strike.attack)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="pf2e-strike-button pf2e-strike-button--map"
                    title={"Второй удар: " + strikeMapLabel(attackMap, map)}
                    onClick={() => rollAttack(strike, attackMap, "(2-й)")}
                    {...hotbarMacroProps(strikeMacro(strike, attackMap, "(2-й)"))}
                  >
                    <span className="pf2e-strike-button__value">
                      {strikeMapLabel(attackMap, map)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="pf2e-strike-button pf2e-strike-button--map"
                    title={"Третий удар: " + strikeMapLabel(attackMap2, map2)}
                    onClick={() => rollAttack(strike, attackMap2, "(3-й)")}
                    {...hotbarMacroProps(strikeMacro(strike, attackMap2, "(3-й)"))}
                  >
                    <span className="pf2e-strike-button__value">
                      {strikeMapLabel(attackMap2, map2)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="pf2e-strike-button pf2e-strike-button--damage"
                    title={"Урон: /r " + (strike.damage || "1d6")}
                    onClick={() =>
                      onRoll(
                        "/r " + (strike.damage || "1d6") + " " + strike.name + " — урон",
                        false,
                        "public",
                        {
                          type: "attack-card",
                          name: strike.name,
                          damageFormula: strike.damage || "1d6",
                          description: strike.name + " — урон",
                        },
                      )
                    }
                    {...hotbarMacroProps(damageMacro(strike))}
                  >
                    <span className="pf2e-strike-button__label">Урон</span>
                    <span className="pf2e-strike-button__value">{strike.damage || "—"}</span>
                  </button>
                </div>
                {editable && strike.source !== "weapon" ? (
                  <div className="pf2e-item-controls">
                    <button
                      type="button"
                      className="pf2e-icon-button"
                      title="Изменить"
                      onClick={() => setEditor(strike)}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="pf2e-icon-button pf2e-icon-button--danger"
                      title="Удалить"
                      onClick={() => removeStrike(strike)}
                    >
                      ✕
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })
        )}
      </ol>

      <SectionHeader
        title="Действия и особенности"
        hint="От черт и классовых особенностей"
        actions={
          editable ? (
            <button
              type="button"
              className="pf2e-small-button"
              onClick={() => setActionEditor({ section: "encounter" })}
            >
              + Добавить действие
            </button>
          ) : null
        }
      />
      <ol className="pf2e-actions-list">
        {actions.length === 0 ? (
          <p className="pf2e-empty">
            Действий от черт и особенностей пока нет.
          </p>
        ) : (
          actions.map((action) => (
            <li className="pf2e-action" key={action.section + ":" + action.id}>
              <span className="pf2e-action__glyph">{costGlyph(action.cost)}</span>
              <div className="pf2e-action__body">
                <div className="pf2e-action__name">
                  {action.name}
                  {action.id === "base-action-raise-a-shield" && heldShield?.raised ? (
                    <span className="pf2e-tag pf2e-tag--secondary">поднят</span>
                  ) : null}
                </div>
                {action.traits ? (
                  <div className="pf2e-action__traits">
                    {splitTraits(action.traits).map((trait) => (
                      <span className="pf2e-tag pf2e-tag--trait" key={trait}>
                        {trait}
                      </span>
                    ))}
                  </div>
                ) : null}
                {action.description ? (
                  <p className="pf2e-action__description">{action.description}</p>
                ) : null}
              </div>
              <div className="pf2e-item-controls">
                <button
                  type="button"
                  className="pf2e-icon-button"
                  title="Отправить в чат"
                  onClick={() => onRoll(action.name, true)}
                  {...hotbarMacroProps({
                    type: "action",
                    actorId,
                    actionId: action.id,
                    name: action.name,
                    icon: null,
                    text: action.name,
                    plain: true,
                  })}
                >
                  💬
                </button>
                {action.id === "base-action-raise-a-shield" ? (
                  <button
                    type="button"
                    className={
                      "pf2e-small-button" + (heldShield?.raised ? " is-active" : "")
                    }
                    title={
                      heldShield?.raised
                        ? "Опустить щит"
                        : "Поднять щит (бонус к КБ)"
                    }
                    disabled={!editable}
                    onClick={toggleShieldRaised}
                  >
                    {heldShield?.raised ? "Опустить" : "Поднять"}
                  </button>
                ) : editable ? (
                  <>
                    <button
                      type="button"
                      className="pf2e-icon-button"
                      title="Изменить"
                      onClick={() => setActionEditor(action)}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="pf2e-icon-button pf2e-icon-button--danger"
                      title="Удалить"
                      onClick={() => removeAction(action)}
                    >
                      ✕
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          ))
        )}
      </ol>

      <SectionHeader
        title="Переключатели"
        hint="Опции правил (RollOption)"
      />
      {toggles.length === 0 ? (
        <p className="pf2e-empty">
          У этого персонажа нет включаемых эффектов.
        </p>
      ) : (
        <ul className="pf2e-toggle-list">
          {toggles.map((toggle) => (
            <li className="pf2e-toggle" key={toggle.id}>
              <label className="pf2e-toggle__label">
                <input
                  type="checkbox"
                  checked={toggle.enabled === true}
                  disabled={!editable}
                  onChange={(event) =>
                    setRollOption(toggle, event.target.checked)
                  }
                />
                <span className="pf2e-toggle__name">{toggleLabel(toggle)}</span>
              </label>
              <span className="pf2e-toggle__source">
                {toggle.itemName || toggle.option}
              </span>
            </li>
          ))}
        </ul>
      )}

      <SectionHeader title="Оружие" hint="В руках / надето / в рюкзаке" />
      <ul className="pf2e-simple-list">
        {(system.inventory?.items || []).filter((item) => item.type === "weapon").length === 0
          ? <li className="pf2e-empty">Оружия нет.</li>
          : (system.inventory?.items || [])
              .filter((item) => item.type === "weapon")
              .map((item) => {
                const carried =
                  CARRIED_STATUSES.find((entry) => entry.value === item.carried) ||
                  CARRIED_STATUSES[2];
                return (
                  <li className="pf2e-simple-row" key={item.id}>
                    <span className="pf2e-simple-row__name">{item.name}</span>
                    <span className="pf2e-simple-row__meta">
                      {item.quantity} шт. · масса {item.bulk === "L" ? "L" : item.bulk}
                    </span>
                    <span
                      className={
                        "pf2e-carried-badge" +
                        (item.carried === "held" ? " pf2e-carried-badge--held" : "")
                      }
                    >
                      {carried.label}
                    </span>
                  </li>
                );
              })}
      </ul>

      {editor ? (
        <EntryEditorModal
          kind="strike"
          title={editor.id ? "Изменить атаку" : "Новая атака"}
          initial={editor}
          onSave={saveStrike}
          onClose={() => setEditor(null)}
        />
      ) : null}

      {actionEditor ? (
        <EntryEditorModal
          kind="action"
          title={actionEditor.id ? "Изменить действие" : "Новое действие"}
          initial={actionEditor}
          onSave={saveAction}
          onClose={() => setActionEditor(null)}
        />
      ) : null}
    </section>
  );
}

// --------------------------------------------------------------- Inventory

function bulkLabel(bulk) {
  if (bulk === "L") {
    return "L";
  }
  return Number(bulk) > 0 ? String(bulk) : "—";
}

function carriedBadge(item) {
  return (
    CARRIED_STATUSES.find((entry) => entry.value === item.carried) ||
    CARRIED_STATUSES[2]
  );
}

/**
 * Foundry-style grouped inventory. Physical items live in `actor.items`; the
 * tab edits that collection directly through `onItemsChange`.
 */
export function InventoryTab({
  system,
  items,
  editable,
  updateSystem,
  onItemsChange,
}) {
  const [editor, setEditor] = useState(null);
  const [expandedId, setExpandedId] = useState("");
  const [sheetItem, setSheetItem] = useState(null);
  const allItems = Array.isArray(items) ? items : [];
  const physicalItems = allItems.filter((item) => isPhysicalItemType(item.type));
  const coins = system.inventory?.coins || {};
  const encumbrance = encumbranceState(system);
  const bulk = totalBulk(system);

  const patchCoins = (key, value) =>
    updateSystem((current) => ({
      ...current,
      inventory: {
        ...current.inventory,
        coins: { ...current.inventory.coins, [key]: Math.max(0, Number(value) || 0) },
      },
    }));

  const commitItems = (nextItems) => {
    if (typeof onItemsChange === "function") {
      onItemsChange(nextItems);
    }
  };

  const saveItem = (draft) => {
    const existing = allItems.find((entry) => entry.id === draft.id) || {};
    const merged = normalizePhysicalItem(
      {
        ...existing,
        ...draft,
        id: draft.id || existing.id || nextEntryId("item"),
        bulk: parseBulkValue(draft.bulk),
        quantity: Math.max(1, Number(draft.quantity) || 1),
        acBonus: Math.max(0, Number(draft.acBonus) || 0),
        dexCap:
          draft.dexCap === "" || draft.dexCap === undefined || draft.dexCap === null
            ? null
            : Math.max(0, Number(draft.dexCap) || 0),
        category: draft.category || null,
        weaponCategory: draft.weaponCategory || "simple",
        damage: draft.damage || "",
        damageType: draft.damageType || "untyped",
        traits: draft.traits || "",
        system: existing.system || {},
      },
      0,
    );
    merged.equipped = merged.carried === "held" || merged.carried === "worn";
    merged.handsHeld =
      merged.carried === "held"
        ? Math.max(1, Math.trunc(Number(merged.handsHeld) || 1))
        : 0;
    const exists = allItems.some((entry) => entry.id === merged.id);
    commitItems(
      exists
        ? allItems.map((entry) => (entry.id === merged.id ? merged : entry))
        : [...allItems, merged],
    );
  };

  const removeItem = (item) => {
    commitItems(allItems.filter((entry) => entry.id !== item.id));
  };

  const patchItem = (item, patch) => {
    commitItems(
      allItems.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              ...patch,
              equipped:
                (patch.carried !== undefined ? patch.carried : entry.carried) === "held" ||
                (patch.carried !== undefined ? patch.carried : entry.carried) === "worn",
            }
          : entry,
      ),
    );
  };

  const setCarried = (item, carried) => {
    patchItem(item, {
      carried,
      // A held item needs at least one hand; stowed/worn items release them.
      handsHeld:
        carried === "held"
          ? Math.max(1, Math.trunc(Number(item.handsHeld) || 1))
          : 0,
      // A shield can only stay raised while it remains in hand.
      ...(item.type === "shield" && carried !== "held" ? { raised: false } : {}),
    });
  };

  const setHands = (item, hands) => {
    patchItem(item, { handsHeld: Math.max(1, Math.min(2, Number(hands) || 1)) });
  };

  const toggleItem = (item, key) => {
    patchItem(item, { [key]: !item[key] });
  };

  return (
    <section className="pf2e-tab pf2e-tab--inventory">
      <div className="pf2e-coinage">
        {[
          ["pp", "ПМ"],
          ["gp", "ЗМ"],
          ["sp", "СМ"],
          ["cp", "ММ"],
        ].map(([key, label]) => (
          <label className="pf2e-coin" key={key}>
            <span className="pf2e-coin__label">{label}</span>
            <CommitInput
              value={coins[key] || 0}
              type="number"
              min="0"
              disabled={!editable}
              onCommit={(value) => patchCoins(key, value)}
            />
          </label>
        ))}
      </div>

      <SectionHeader
        title="Экипировка"
        hint={physicalItems.length + " предмет(ов) · масса " + bulk}
        actions={
          editable ? (
            <button type="button" className="pf2e-small-button" onClick={() => setEditor({})}>
              + Добавить предмет
            </button>
          ) : null
        }
      />

      <p className="pf2e-muted pf2e-inventory-hint">
        Перетащите предмет из компендиума на лист персонажа. Оружие в руках
        автоматически появляется во вкладке «Бой».
      </p>

      <div className="pf2e-inventory-groups">
        {ITEM_GROUPS.map((group) => {
          const entries = physicalItems.filter(
            (item) => itemGroupId(item.type) === group.id,
          );
          return (
            <section className="pf2e-inventory-group" key={group.id}>
              <header className="pf2e-inventory-group__header">
                <span className="pf2e-inventory-group__icon" aria-hidden="true">
                  {group.icon}
                </span>
                <span>{group.label}</span>
                <span className="pf2e-section-header__count">{entries.length}</span>
              </header>
              {entries.length === 0 ? (
                <p className="pf2e-empty pf2e-empty--small">Пусто.</p>
              ) : (
                <ul className="pf2e-inventory-list">
                  {entries.map((item) => {
                    const carried = carriedBadge(item);
                    const showHands =
                      item.carried === "held" && itemCanHoldHands(item.type);
                    return (
                      <li
                        className={
                          "pf2e-inventory-item" +
                          (item.carried === "held" || item.carried === "worn"
                            ? " pf2e-inventory-item--equipped"
                            : "")
                        }
                        key={item.id}
                      >
                        <span className="pf2e-inventory-item__img" aria-hidden="true">
                          {item.img ? (
                            <img src={item.img} alt="" loading="lazy" />
                          ) : (
                            group.icon
                          )}
                        </span>
                        <div className="pf2e-inventory-item__body">
                          <button
                            type="button"
                            className="pf2e-inventory-item__name pf2e-item-name--button"
                            title="Показать или скрыть описание"
                            aria-expanded={expandedId === item.id}
                            onClick={() =>
                              setExpandedId((current) =>
                                current === item.id ? "" : item.id,
                              )
                            }
                          >
                            {item.name}
                            {Number(item.level) > 0 ? (
                              <span className="pf2e-inventory-item__level">
                                ур. {item.level}
                              </span>
                            ) : null}
                          </button>
                          <div className="pf2e-inventory-item__meta">
                            <span>{bulkLabel(item.bulk)} масса</span>
                            <span>×{item.quantity}</span>
                            {item.damage ? <span>{item.damage} {iwrLabel(item.damageType)}</span> : null}
                            <span className={"pf2e-carried-badge pf2e-carried-badge--" + carried.value}>
                              {carried.label}
                            </span>
                          </div>
                          {item.traits ? (
                            <div className="pf2e-inventory-item__traits">
                              {splitTraits(item.traits)
                                .slice(0, 5)
                                .map((trait) => (
                                  <span className="pf2e-tag pf2e-tag--trait" key={trait}>
                                    {trait}
                                  </span>
                                ))}
                            </div>
                          ) : null}
                          {expandedId === item.id ? (
                            <InlineDescription text={item.description} />
                          ) : null}
                        </div>
                        <div className="pf2e-inventory-item__controls">
                          <select
                            className="pf2e-input pf2e-carried-select"
                            value={item.carried || "stowed"}
                            disabled={!editable}
                            title="Статус ношения предмета"
                            aria-label={"Ношение: " + item.name}
                            onChange={(event) => setCarried(item, event.target.value)}
                          >
                            {CARRIED_STATUSES.map((status) => (
                              <option key={status.value} value={status.value}>
                                {status.label}
                              </option>
                            ))}
                          </select>
                          {item.type === "shield" && item.carried === "held" ? (
                            <label className="pf2e-raised-toggle" title="Поднят ли щит">
                              <input
                                type="checkbox"
                                checked={Boolean(item.raised)}
                                disabled={!editable}
                                onChange={() => toggleItem(item, "raised")}
                              />
                              <span>Поднят</span>
                            </label>
                          ) : null}
                          {showHands ? (
                            <select
                              className="pf2e-input pf2e-hands-select"
                              value={Math.max(1, Number(item.handsHeld) || 1)}
                              disabled={!editable}
                              title="Сколько рук занимает предмет"
                              aria-label={"Занятые руки: " + item.name}
                              onChange={(event) => setHands(item, event.target.value)}
                            >
                              <option value="1">1 рука</option>
                              <option value="2">2 руки</option>
                            </select>
                          ) : null}
                          {editable ? (
                            <span className="pf2e-item-controls">
                              <button
                                type="button"
                                className={"pf2e-check" + (item.invested ? " pf2e-check--on" : "")}
                                title={item.invested ? "Изъять инвеституру" : "Инвестировать"}
                                onClick={() => toggleItem(item, "invested")}
                              >
                                {item.invested ? "✓" : ""}
                              </button>
                              <button
                                type="button"
                                className="pf2e-icon-button"
                                title="Изменить (карточка предмета)"
                                onClick={() => setSheetItem(item)}
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                className="pf2e-icon-button pf2e-icon-button--danger"
                                title="Удалить"
                                onClick={() => removeItem(item)}
                              >
                                ✕
                              </button>
                            </span>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <div className="pf2e-encumbrance pf2e-encumbrance--bottom">
        <div className="pf2e-encumbrance__bar" title="Полоса нагрузки">
          <span
            className={"pf2e-encumbrance__fill pf2e-encumbrance__fill--" + encumbrance.state}
            style={{
              width:
                Math.min(
                  100,
                  Math.round((bulk / Math.max(1, encumbrance.max)) * 100),
                ) + "%",
            }}
          />
        </div>
        <span
          className={
            "pf2e-encumbrance__label pf2e-encumbrance__label--" + encumbrance.state
          }
        >
          {encumbrance.state === "overloaded" ? "Перегружен" : encumbrance.label}:{" "}
          {bulk} / {encumbrance.limit} (макс. {encumbrance.max})
        </span>
      </div>

      {sheetItem ? (
        <ItemSheetModal
          item={sheetItem}
          canEdit={editable}
          onEdit={(entry) => setEditor({ ...entry, bulk: String(entry.bulk) })}
          onClose={() => setSheetItem(null)}
        />
      ) : null}

      {editor ? (
        <EntryEditorModal
          kind="item"
          title={editor.id ? "Изменить предмет" : "Новый предмет"}
          initial={editor}
          onSave={saveItem}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </section>
  );
}

// ----------------------------------------------------------------- Actions

const ACTION_SECTIONS = [
  { id: "encounter", label: "Столкновение" },
  { id: "exploration", label: "Исследование" },
  { id: "downtime", label: "Свободное время" },
];

export function ActionsTab({ system, actor, editable, updateSystem, onRoll }) {
  const [section, setSection] = useState("encounter");
  const [editor, setEditor] = useState(null);

  const saveAction = (action) => {
    updateSystem((current) => {
      const actions = {};
      for (const entry of ACTION_SECTIONS) {
        actions[entry.id] = (current.actions?.[entry.id] || []).filter(
          (existing) => existing.id !== action.id,
        );
      }
      const target = actions[action.section] ? action.section : "encounter";
      actions[target] = [...actions[target], action];
      return { ...current, actions };
    });
  };

  const removeAction = (action) => {
    updateSystem((current) => ({
      ...current,
      actions: Object.fromEntries(
        ACTION_SECTIONS.map((entry) => [
          entry.id,
          (current.actions?.[entry.id] || []).filter((existing) => existing.id !== action.id),
        ]),
      ),
    }));
  };

  const entries = system.actions?.[section] || [];

  return (
    <section className="pf2e-tab pf2e-tab--actions">
      <nav className="pf2e-subnav" role="tablist" aria-label="Типы действий">
        {ACTION_SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={section === entry.id}
            className={"pf2e-subnav__tab" + (section === entry.id ? " pf2e-subnav__tab--active" : "")}
            onClick={() => setSection(entry.id)}
          >
            {entry.label}
            <span className="pf2e-subnav__count">
              {(system.actions?.[entry.id] || []).length}
            </span>
          </button>
        ))}
      </nav>

      <SectionHeader
        title={ACTION_SECTIONS.find((entry) => entry.id === section)?.label || "Действия"}
        actions={
          editable ? (
            <button
              type="button"
              className="pf2e-small-button"
              onClick={() => setEditor({ section })}
            >
              + Добавить действие
            </button>
          ) : null
        }
      />

      <ol className="pf2e-actions-list">
        {entries.length === 0 ? (
          <p className="pf2e-empty">Действий в этом разделе нет.</p>
        ) : (
          entries.map((action) => (
            <li className="pf2e-action" key={action.id}>
              <span className="pf2e-action__glyph">{costGlyph(action.cost)}</span>
              <div className="pf2e-action__body">
                <div className="pf2e-action__name">{action.name}</div>
                {action.traits ? (
                  <div className="pf2e-action__traits">
                    {splitTraits(action.traits).map((trait) => (
                      <span className="pf2e-tag pf2e-tag--trait" key={trait}>
                        {trait}
                      </span>
                    ))}
                  </div>
                ) : null}
                {action.description ? (
                  <p className="pf2e-action__description">{action.description}</p>
                ) : null}
              </div>
              <div className="pf2e-item-controls">
                <button
                  type="button"
                  className="pf2e-icon-button"
                  title="Отправить в чат"
                  onClick={() => onRoll(action.name, true)}
                  {...hotbarMacroProps({
                    type: "action",
                    actorId: actor && actor.id ? actor.id : null,
                    actionId: action.id,
                    name: action.name,
                    icon: null,
                    text: action.name,
                    plain: true,
                  })}
                >
                  💬
                </button>
                {editable ? (
                  <>
                    <button
                      type="button"
                      className="pf2e-icon-button"
                      title="Изменить"
                      onClick={() => setEditor({ ...action, section })}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="pf2e-icon-button pf2e-icon-button--danger"
                      title="Удалить"
                      onClick={() => removeAction(action)}
                    >
                      ✕
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          ))
        )}
      </ol>

      {editor ? (
        <EntryEditorModal
          kind="action"
          title={editor.id ? "Изменить действие" : "Новое действие"}
          initial={editor}
          onSave={saveAction}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------ Spells

function spellcastingTypeLabel(value) {
  return (
    SPELLCASTING_TYPES.find((entry) => entry.value === value)?.label ||
    value ||
    "Заклинания"
  );
}

function spellcastingTraditionLabel(value) {
  return (
    SPELLCASTING_TRADITIONS.find((entry) => entry.value === value)?.label ||
    value ||
    "—"
  );
}

function spellRankLabel(rank) {
  if (rank === "cantrip" || Number(rank) === 0) {
    return "Чары";
  }
  return SPELL_RANKS.find((entry) => entry.value === String(rank))?.label || rank + "-й круг";
}

function spellRankOf(spell) {
  const raw = spell && spell.rank !== undefined ? spell.rank : spell && spell.level;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(10, Math.trunc(value))) : 1;
}

function groupSpellsByRank(spells) {
  const map = new Map();
  for (const spell of Array.isArray(spells) ? spells : []) {
    const rank = spellRankOf(spell);
    if (!map.has(rank)) {
      map.set(rank, []);
    }
    map.get(rank).push(spell);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

function spellChatText(spell, stats) {
  const rank = spellRankOf(spell);
  const attack =
    spell.spellAttack !== null && spell.spellAttack !== undefined
      ? spell.spellAttack
      : stats.spellAttack;
  const dc =
    spell.spellDC !== null && spell.spellDC !== undefined
      ? spell.spellDC
      : stats.spellDC;
  const actions = spell.system?.time?.value || spell.actions || "";
  const traits = splitTraits(spell.traits).slice(0, 6).join(", ");
  const description = plainDescription(spell.description);
  return [
    "✦ " + spell.name + " · " + spellRankLabel(rank),
    [
      actions ? "Действия: " + actions : "",
      "DC " + dc,
      "Атака " + signed(attack),
    ]
      .filter(Boolean)
      .join(" · "),
    traits ? "Черты: " + traits : "",
    description,
  ]
    .filter(Boolean)
    .join("\n");
}

function numericSpellRank(rank) {
  if (rank === "cantrip") {
    return 0;
  }
  const value = Number(rank);
  return Number.isFinite(value) ? Math.max(0, Math.min(10, Math.trunc(value))) : 0;
}

/** Flat sheet traits plus the canonical Foundry `system.traits.value` list. */
function spellTraitSet(spell) {
  const traits = new Set(
    splitTraits(spell && spell.traits).map((trait) => trait.toLowerCase()),
  );
  const nested = spell && spell.system && spell.system.traits
    ? spell.system.traits.value
    : null;
  for (const trait of Array.isArray(nested) ? nested : []) {
    if (typeof trait === "string" && trait.trim() !== "") {
      traits.add(trait.trim().toLowerCase());
    }
  }
  return traits;
}

/**
 * Step 6.3: focus spells use the global Focus pool instead of spell slots.
 * Focus cantrips are castable at will and never spend a point.
 */
function isFocusSpell(spell) {
  if (!spell || spellRankOf(spell) === 0) {
    return false;
  }
  const traits = spellTraitSet(spell);
  return traits.has("focus") && !traits.has("cantrip");
}


function spellSlotKey(rank) {
  return "slot" + numericSpellRank(rank);
}

function normalizePreparedEntry(entry) {
  if (entry === null || entry === undefined) {
    return null;
  }
  if (typeof entry === "string") {
    return entry === "" ? null : { id: entry, expended: false };
  }
  if (typeof entry !== "object") {
    return null;
  }
  const id = typeof entry.id === "string" ? entry.id : "";
  return id === "" ? null : { id, expended: Boolean(entry.expended) };
}

function normalizeSpellSlot(rank, slot) {
  const source = slot && typeof slot === "object" ? slot : {};
  const preparedSource = Array.isArray(source.prepared) ? source.prepared : [];
  return {
    rank: numericSpellRank(rank),
    value: Math.max(0, Math.trunc(Number(source.value) || 0)),
    max: Math.max(0, Math.trunc(Number(source.max) || 0)),
    prepared: preparedSource.map(normalizePreparedEntry),
  };
}

/**
 * Step 5.6: read the canonical object form
 * `system.slots.slot<N>.prepared[index] = { id, expended }` and stay compatible
 * with the legacy array form (`[{ rank, value, max }]`).
 */
function readSpellSlots(entry) {
  const sc = entry && entry.system ? entry.system : {};
  const raw = sc.slots;
  const result = [];
  if (Array.isArray(raw)) {
    for (const slot of raw) {
      if (!slot || typeof slot !== "object") {
        continue;
      }
      const rank = numericSpellRank(
        slot.rank !== undefined ? slot.rank : 0,
      );
      // Step 6.3: cantrips (rank 0) never consume spell slots.
      if (rank === 0) {
        continue;
      }
      result.push(normalizeSpellSlot(rank, slot));
    }
  } else if (raw && typeof raw === "object") {
    for (const [key, slot] of Object.entries(raw)) {
      if (!slot || typeof slot !== "object") {
        continue;
      }
      const rank = numericSpellRank(
        slot.rank !== undefined ? slot.rank : String(key).replace(/^slot/i, ""),
      );
      if (rank === 0) {
        continue;
      }
      result.push(normalizeSpellSlot(rank, slot));
    }
  }
  return result.sort((a, b) => a.rank - b.rank);
}

/** Persist slots in the Foundry-style object form keyed by `slot<N>`. */
function writeSpellSlots(entry, slots) {
  const map = {};
  for (const slot of slots) {
    map[spellSlotKey(slot.rank)] = {
      rank: String(slot.rank),
      value: slot.value,
      max: slot.max,
      prepared: (slot.prepared || []).map((entry) =>
        entry ? { id: entry.id, expended: Boolean(entry.expended) } : null,
      ),
    };
  }
  return {
    ...entry,
    system: { ...(entry.system || {}), slots: map },
  };
}

/** Interactive chat payload for a spell card (Step 5.6). */
function spellCardPayload(spell, stats) {
  const system = spell && spell.system ? spell.system : {};
  const saveType = String(
    system.defense && system.defense.save ? system.defense.save.statistic : "",
  ).toLowerCase();
  const damageParts = Object.values(system.damage || {})
    .filter(
      (node) =>
        node && typeof node.formula === "string" && node.formula.trim() !== "",
    )
    .map((node) => node.formula.trim() + (node.type ? " " + iwrLabel(node.type) : ""));
  return {
    type: "spell-card",
    spellId: spell.id,
    name: spell.name,
    dc: Number(spell.spellDC ?? stats.spellDC) || 0,
    saveType: ["fortitude", "reflex", "will"].includes(saveType) ? saveType : null,
    damageFormula: damageParts.join(" + ") || null,
    description: plainDescription(spell.description).slice(0, 2000),
  };
}

function spellAttackFormula(spell, stats) {
  const attack =
    spell.spellAttack !== null && spell.spellAttack !== undefined
      ? spell.spellAttack
      : stats.spellAttack;
  return "/r 1d20" + signed(attack) + " " + spell.name + " — атака заклинанием";
}

function SpellcastingEntryCard({
  entry,
  system,
  spells = [],
  active = false,
  editable,
  actorId = null,
  onActivate,
  onUpdate,
  onDelete,
  onRoll,
  onDropSpell,
  onDeleteSpell,
  onFocusSpend,
}) {
  const stats = spellcastingStats(system, entry);
  // Step 6.3.1: Focus sets use a single flat list and the shared Focus pool.
  const isFocusEntry = isFocusSpellcastingEntry(entry);
  const [rankDraft, setRankDraft] = useState("1");
  const [expanded, setExpanded] = useState(() => ({}));
  const [sheetItem, setSheetItem] = useState(null);
  const [prepOpen, setPrepOpen] = useState(false);
  const slots = useMemo(() => readSpellSlots(entry), [entry]);
  const focus = system.resources?.focus || { value: 0, max: 0, cap: 3 };
  const focusAvailable = Math.max(0, Number(focus.value) || 0);
  const isPrepared = stats.type === "prepared";
  const isSpontaneous = stats.type === "spontaneous";
  // Step 5.9: a caster unlocks one new spell rank every two levels.
  const level = Math.max(
    1,
    Math.trunc(Number(system.details?.level?.value) || 1),
  );
  const maxRank = maxSpellRankForLevel(level);

  const spellsByRank = useMemo(() => groupSpellsByRank(spells), [spells]);
  const spellById = useMemo(
    () => new Map(spells.map((spell) => [spell.id, spell])),
    [spells],
  );
  const rankList = useMemo(() => {
    const ranks = new Set(slots.map((slot) => slot.rank));
    for (const [rank] of spellsByRank) {
      ranks.add(rank);
    }
    // Prepared casters see a header for every rank their level unlocks, so the
    // slot-count input is always available even before a spell is added.
    if (isPrepared) {
      for (let rank = 1; rank <= maxRank; rank += 1) {
        ranks.add(rank);
      }
    }
    return [...ranks].sort((a, b) => a - b);
  }, [slots, spellsByRank, isPrepared, maxRank]);

  const patchSlots = (nextSlots) => {
    if (typeof onUpdate === "function") {
      onUpdate(writeSpellSlots(entry, nextSlots));
    }
  };

  const patchSlot = (rank, patch) => {
    patchSlots(
      slots.map((slot) =>
        slot.rank === rank
          ? {
              ...slot,
              ...(typeof patch === "function" ? patch(slot) : patch),
            }
          : slot,
      ),
    );
  };

  /** Resize the `prepared[index]` array to exactly `count` empty slots. */
  const resizePrepared = (prepared, count) => {
    const next = (Array.isArray(prepared) ? prepared : []).slice(0, count);
    while (next.length < count) {
      next.push(null);
    }
    return next;
  };

  const addRank = () => {
    const rank = numericSpellRank(rankDraft);
    // Step 6.3: cantrips are free and never get a slot row.
    if (
      rank === 0 ||
      rank > maxRank ||
      slots.some((slot) => slot.rank === rank)
    ) {
      return;
    }
    patchSlots(
      [
        ...slots,
        {
          rank,
          value: 1,
          max: 1,
          prepared: isPrepared ? [null] : [],
        },
      ].sort((a, b) => a.rank - b.rank),
    );
  };

  /** Spontaneous current-slot input, clamped to the maximum. */
  const setSlotValue = (rank, raw) => {
    patchSlot(rank, (slot) => ({
      value: Math.max(
        0,
        Math.min(Math.trunc(Number(raw) || 0), slot.max),
      ),
    }));
  };

  /** Spontaneous maximum-slot input. */
  const setSlotMax = (rank, raw) => {
    patchSlot(rank, (slot) => {
      const max = Math.max(0, Math.min(99, Math.trunc(Number(raw) || 0)));
      return {
        max,
        value: Math.min(slot.value, max),
        prepared: isPrepared ? resizePrepared(slot.prepared, max) : slot.prepared,
      };
    });
  };

  /** Refresh arrow: refill every spent spontaneous slot. */
  const refreshSlot = (rank) => {
    patchSlot(rank, (slot) => ({ value: slot.max }));
  };

  /**
   * Prepared rank header input. Typing `2` creates exactly two empty slots,
   * `0` removes the rank from the entry.
   */
  const setRankSlotCount = (rank, raw) => {
    // Cantrips have no slot count at all.
    if (rank === 0) {
      return;
    }
    const count = Math.max(0, Math.min(99, Math.trunc(Number(raw) || 0)));
    if (count === 0) {
      removeRank(rank);
      return;
    }
    if (rank > maxRank) {
      return;
    }
    const existing = slots.find((slot) => slot.rank === rank);
    if (!existing) {
      patchSlots(
        [
          ...slots,
          {
            rank,
            value: count,
            max: count,
            prepared: resizePrepared([], count),
          },
        ].sort((a, b) => a.rank - b.rank),
      );
      return;
    }
    patchSlot(rank, {
      max: count,
      value: Math.min(existing.value, count),
      prepared: resizePrepared(existing.prepared, count),
    });
  };

  const removeRank = (rank) => {
    patchSlots(slots.filter((slot) => slot.rank !== rank));
  };

  const toggleExpanded = (key) => {
    setExpanded((current) => ({ ...current, [key]: !current[key] }));
  };

  const sendSpellCard = (spell) => {
    if (typeof onRoll !== "function" || !spell) {
      return;
    }
    onRoll(
      spellChatText(spell, stats),
      false,
      "public",
      spellCardPayload(spell, stats),
    );
  };

  /** Spontaneous casting spends one ranked slot, or one Focus Point. */
  const castSpontaneous = (spell) => {
    const rank = spellRankOf(spell);
    // Step 6.3: cantrips are infinite and focus spells use the global pool.
    if (rank === 0) {
      sendSpellCard(spell);
      return;
    }
    if (isFocusSpell(spell)) {
      if (focusAvailable <= 0) {
        return;
      }
      sendSpellCard(spell);
      if (typeof onFocusSpend === "function") {
        onFocusSpend(1);
      }
      return;
    }
    const slot = slots.find((entrySlot) => entrySlot.rank === rank);
    if (!slot || slot.value <= 0) {
      return;
    }
    sendSpellCard(spell);
    patchSlot(rank, { value: Math.max(0, slot.value - 1) });
  };

  /**
   * Step 6.3.1: every spell inside a Focus set casts against the shared pool.
   * Rank-0 cantrips stay free; a ranked spell needs (and spends) one point.
   */
  const castFocusEntrySpell = (spell) => {
    const rank = spellRankOf(spell);
    if (rank === 0) {
      sendSpellCard(spell);
      return;
    }
    if (focusAvailable <= 0) {
      return;
    }
    sendSpellCard(spell);
    if (typeof onFocusSpend === "function") {
      onFocusSpend(focusSpellPointCost(rank));
    }
  };

  /** Prepared casting marks the prepared slot as expended. */
  const castPrepared = (rank, index) => {
    const slot = slots.find((entrySlot) => entrySlot.rank === rank);
    const prepared = slot && slot.prepared[index];
    if (!prepared || prepared.expended) {
      return;
    }
    const spell = spellById.get(prepared.id);
    if (!spell) {
      return;
    }
    // Step 6.3: focus spells spend a Focus Point and keep their prepared slot;
    // cantrips never expend anything.
    if (isFocusSpell(spell)) {
      if (focusAvailable <= 0) {
        return;
      }
      sendSpellCard(spell);
      if (typeof onFocusSpend === "function") {
        onFocusSpend(1);
      }
      return;
    }
    if (spellRankOf(spell) === 0) {
      sendSpellCard(spell);
      return;
    }
    sendSpellCard(spell);
    patchSlot(rank, {
      prepared: slot.prepared.map((entrySlot, entryIndex) =>
        entryIndex === index ? { ...prepared, expended: true } : entrySlot,
      ),
    });
  };

  const unprepare = (rank, index) => {
    const slot = slots.find((entrySlot) => entrySlot.rank === rank);
    if (!slot) {
      return;
    }
    patchSlot(rank, {
      prepared: slot.prepared.map((entrySlot, entryIndex) =>
        entryIndex === index ? null : entrySlot,
      ),
    });
  };

  const handlePreparedDrop = (rank, index) => (event) => {
    const payload = readPreparedSpellDrag(event);
    if (!payload) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (payload.entryId !== entry.id) {
      return;
    }
    const spell = spellById.get(payload.spellId);
    const slot = slots.find((entrySlot) => entrySlot.rank === rank);
    if (!spell || !slot || spellRankOf(spell) !== rank) {
      return;
    }
    const prepared = resizePrepared(slot.prepared, slot.max);
    prepared[index] = { id: spell.id, expended: false };
    patchSlot(rank, { prepared });
  };

  const renderSpellRow = (spell, rank) => {
    const expandedKey = "book:" + spell.id;
    const isExpanded = Boolean(expanded[expandedKey]);
    const slot = slots.find((entrySlot) => entrySlot.rank === rank) || null;
    const focusSpell = isFocusSpell(spell);
    const cantrip = rank === 0;
    // Step 6.3.1: inside a Focus set the shared pool gates every ranked spell;
    // cantrips remain free and infinite.
    const canCast = isFocusEntry
      ? cantrip || focusAvailable > 0
      : cantrip
        ? true
        : focusSpell
          ? focusAvailable > 0
          : isSpontaneous
            ? Boolean(slot && slot.value > 0)
            : true;
    const showCastButton = isFocusEntry || cantrip || focusSpell || !isPrepared;
    const castTitle = isFocusEntry
      ? cantrip
        ? "Сотворить заговор (не тратит фокус)"
        : focusAvailable > 0
          ? "Сотворить (тратит 1 очко фокуса)"
          : "Нет очков фокуса"
      : cantrip
        ? "Сотворить заговор (не тратит ячейки)"
        : focusSpell
          ? focusAvailable > 0
            ? "Сотворить (тратит 1 очко фокуса)"
            : "Нет очков фокуса"
          : canCast
            ? "Сотворить заклинание"
            : "Нет свободных ячеек этого круга";
    const spellCardMacro = {
      type: "spell",
      actorId,
      actionId: spell.id,
      name: spell.name,
      icon: spell.img || null,
      text: spellChatText(spell, stats),
    };
    const spellAttackMacro = {
      type: "spell",
      actorId,
      actionId: spell.id + ":attack",
      name: spell.name + " (атака)",
      icon: spell.img || null,
      text: spellAttackFormula(spell, stats),
    };
    return (
      <li
        className={"pf2e-spell pf2e-spell--expandable" + (isPrepared && !isFocusEntry ? " pf2e-spell--draggable" : "")}
        key={spell.id}
        draggable={editable && isPrepared && !isFocusEntry}
        onDragStart={
          editable && isPrepared && !isFocusEntry
            ? (event) =>
                setPreparedSpellDragData(event, {
                  spellId: spell.id,
                  entryId: entry.id,
                  rank,
                  name: spell.name,
                })
            : undefined
        }
      >
        <button
          type="button"
          className="pf2e-spell__img"
          title="Отправить карточку заклинания в чат"
          onClick={() => sendSpellCard(spell)}
          {...hotbarMacroProps(spellCardMacro)}
        >
          {spell.img ? (
            <img src={spell.img} alt="" loading="lazy" />
          ) : (
            <span aria-hidden="true">✦</span>
          )}
        </button>
        <button
          type="button"
          className="pf2e-spell__name pf2e-spell__name--button"
          title="Показать или скрыть описание"
          onClick={() => toggleExpanded(expandedKey)}
        >
          {spell.name}
        </button>
        <span className="pf2e-spell__meta">
          DC {spell.spellDC ?? stats.spellDC}
        </span>
        <button
          type="button"
          className="pf2e-roll-button pf2e-roll-button--small"
          title="Бросок атаки заклинанием"
          onClick={() => onRoll && onRoll(spellAttackFormula(spell, stats))}
          {...hotbarMacroProps(spellAttackMacro)}
        >
          <span className="pf2e-d20">d20</span>
        </button>
        {showCastButton ? (
          <button
            type="button"
            className="pf2e-small-button pf2e-spell-cast-button"
            title={castTitle}
            disabled={!canCast}
            onClick={() =>
              isFocusEntry ? castFocusEntrySpell(spell) : castSpontaneous(spell)
            }
          >
            Сотворить
          </button>
        ) : (
          <span className="pf2e-spell__meta">
            {editable ? "→ в ячейку" : ""}
          </span>
        )}
        {editable ? (
          <>
            <button
              type="button"
              className="pf2e-icon-button"
              title="Изменить (карточка предмета)"
              onClick={() => setSheetItem(spell)}
            >
              ✎
            </button>
            <button
              type="button"
              className="pf2e-icon-button pf2e-icon-button--danger"
              title="Удалить заклинание"
              onClick={() => onDeleteSpell && onDeleteSpell(spell)}
            >
              ✕
            </button>
          </>
        ) : null}
        {isExpanded ? (
          <p className="pf2e-spell__description">
            {plainDescription(spell.description) || "Описание отсутствует."}
          </p>
        ) : null}
      </li>
    );
  };

  return (
    <article
      className={
        "pf2e-spellcasting-card" +
        (active ? " pf2e-spellcasting-card--active" : "") +
        " pf2e-spellcasting-card--drop"
      }
      onDragOver={(event) => {
        if (!canAcceptCompendiumDrop(event)) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        const payload = readCompendiumDrop(event);
        if (!payload) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (onDropSpell) {
          onDropSpell(payload, entry.id);
        }
      }}
    >
      <header
        className="pf2e-spellcasting-card__header"
        onClick={() => onActivate && onActivate(entry.id)}
        title="Сделать набор целевым для перетаскивания заклинаний"
      >
        <div className="pf2e-spellcasting-card__identity">
          <span className="pf2e-spellcasting-card__icon" aria-hidden="true">
            {entry.img ? <img src={entry.img} alt="" /> : "✦"}
          </span>
          <div>
            <h3>{entry.name}</h3>
            <span className="pf2e-spellcasting-card__meta">
              {spellcastingTypeLabel(stats.type)} ·{" "}
              {spellcastingTraditionLabel(stats.tradition)} ·{" "}
              {ABILITIES.find((ability) => ability.key === stats.ability)?.abbr ||
                stats.ability}{" "}
              ·{" "}
              {isFocusEntry
                ? "единый пул фокуса"
                : isPrepared
                  ? "по слотам"
                  : "ячейки"}
            </span>
          </div>
        </div>
        <div className="pf2e-spellcasting-card__stats">
          <span title="Модификатор атаки заклинаний">
            Атака {signed(stats.spellAttack)}
          </span>
          <span title="Класс сложности заклинаний">DC {stats.spellDC}</span>
          <span className="pf2e-spellcasting-card__mode">
            {isFocusEntry
              ? "Фокус"
              : SPELLCASTING_MODES.find((mode) => mode.value === stats.mode)?.label ||
                stats.mode}
          </span>
        </div>
        {isPrepared && !isFocusEntry ? (
          <button
            type="button"
            className="pf2e-small-button pf2e-spellcasting-card__prep-button"
            title="Книга подготовки: перетащите заклинание в пустую ячейку"
            onClick={(event) => {
              event.stopPropagation();
              setPrepOpen(true);
            }}
          >
            📖 Подгот.
          </button>
        ) : null}
        {editable ? (
          <button
            type="button"
            className="pf2e-icon-button pf2e-icon-button--danger"
            title="Удалить набор заклинаний"
            onClick={() => onDelete(entry)}
          >
            ✕
          </button>
        ) : null}
      </header>

      {isFocusEntry ? (
        <div
          className="pf2e-spellcasting-card__focus"
          title="Заклинания этого набора тратят общий пул фокуса"
        >
          <span
            className="pf2e-spellcasting-card__focus-icon"
            aria-hidden="true"
          >
            ✦
          </span>
          <strong>Фокус</strong>
          <span className="pf2e-spellcasting-card__focus-value">
            {focusAvailable} / {Math.max(0, Number(focus.max) || 0)}
          </span>
          <span className="pf2e-spellcasting-card__focus-hint">
            Заклинания набора используют общий пул фокуса
          </span>
        </div>
      ) : (
      <div className="pf2e-spellcasting-card__slots">
        {slots.map((slot) => {
          const overLevel = slot.rank > maxRank;
          return (
            <span
              className={
                "pf2e-spell-slot" + (overLevel ? " pf2e-spell-slot--locked" : "")
              }
              key={slot.rank}
              title={
                overLevel
                  ? "Ранг выше максимального для уровня " + level
                  : undefined
              }
            >
              <span className="pf2e-spell-slot__rank">
                {spellRankLabel(slot.rank)}
              </span>
              {isPrepared ? (
                <>
                  <span className="pf2e-spell-slot__value">
                    {(slot.prepared || []).filter(Boolean).length}/{slot.max}
                  </span>
                  {editable ? (
                    <button
                      type="button"
                      className="pf2e-icon-button pf2e-icon-button--danger"
                      title="Убрать ранг"
                      onClick={() => removeRank(slot.rank)}
                    >
                      ×
                    </button>
                  ) : null}
                </>
              ) : editable ? (
                <span className="pf2e-spell-slot__controls">
                  <input
                    className="pf2e-input pf2e-spell-slot__input"
                    type="number"
                    min="0"
                    max={slot.max}
                    value={slot.value}
                    disabled={overLevel}
                    title="Текущие ячейки"
                    aria-label={"Текущие ячейки " + spellRankLabel(slot.rank)}
                    onChange={(event) =>
                      setSlotValue(slot.rank, event.target.value)
                    }
                  />
                  <span className="pf2e-spell-slot__slash">/</span>
                  <input
                    className="pf2e-input pf2e-spell-slot__input"
                    type="number"
                    min="0"
                    max="99"
                    value={slot.max}
                    disabled={overLevel}
                    title="Максимум ячеек"
                    aria-label={"Максимум ячеек " + spellRankLabel(slot.rank)}
                    onChange={(event) =>
                      setSlotMax(slot.rank, event.target.value)
                    }
                  />
                  <button
                    type="button"
                    className="pf2e-icon-button pf2e-spell-slot__refresh"
                    title="Обновить: восстановить все ячейки"
                    aria-label="Обновить ячейки"
                    disabled={overLevel}
                    onClick={() => refreshSlot(slot.rank)}
                  >
                    ↻
                  </button>
                  <button
                    type="button"
                    className="pf2e-icon-button pf2e-icon-button--danger"
                    title="Убрать ранг"
                    onClick={() => removeRank(slot.rank)}
                  >
                    ×
                  </button>
                </span>
              ) : (
                <span className="pf2e-spell-slot__value">
                  {slot.value}/{slot.max}
                </span>
              )}
            </span>
          );
        })}
        {slots.length === 0 ? (
          <span className="pf2e-empty-inline">Ранги ячеек не добавлены.</span>
        ) : null}
        {editable ? (
          <span className="pf2e-spell-slot-add">
            <select
              className="pf2e-input"
              value={rankDraft}
              onChange={(event) => setRankDraft(event.target.value)}
            >
              {SPELL_RANKS.filter(
                (rank) => numericSpellRank(rank.value) !== 0,
              ).map((rank) => (
                <option
                  key={rank.value}
                  value={rank.value}
                  disabled={numericSpellRank(rank.value) > maxRank}
                >
                  {rank.label}
                  {numericSpellRank(rank.value) > maxRank
                    ? " · недоступен (ур. " + level + ")"
                    : ""}
                </option>
              ))}
            </select>
            <button type="button" className="pf2e-small-button" onClick={addRank}>
              + Ранг ячеек
            </button>
          </span>
        ) : null}
      </div>
      )}

      <div
        className={
          "pf2e-spellbook" + (isFocusEntry ? " pf2e-spellbook--focus" : "")
        }
      >
        {isFocusEntry ? (
          spells.length === 0 ? (
            <div className="pf2e-spellbook__dropzone">
              Перетащите заклинания из компендиума в этот набор.
            </div>
          ) : (
            <ol className="pf2e-spell-list pf2e-spell-list--flat">
              {spells.map((spell) =>
                renderSpellRow(spell, spellRankOf(spell)),
              )}
            </ol>
          )
        ) : rankList.length === 0 ? (
          <p className="pf2e-empty pf2e-empty--small">
            Перетащите заклинание из компендиума в этот набор.
          </p>
        ) : (
          rankList.map((rank) => {
            const slot = slots.find((entrySlot) => entrySlot.rank === rank) || null;
            const rankSpells =
              spellsByRank.find(([entryRank]) => entryRank === rank)?.[1] || [];
            return (
              <section className="pf2e-spell-rank" key={rank}>
                <header className="pf2e-spell-rank__header">
                  <span className="pf2e-spell-rank__label">
                    {spellRankLabel(rank)}
                  </span>
                  {rank === 0 ? (
                    <span className="pf2e-spell-rank__hint">
                      Заговоры · без ячеек, неограниченно
                    </span>
                  ) : isPrepared ? (
                    <label
                      className="pf2e-spell-rank__slot-count"
                      title={
                        rank > maxRank
                          ? "Ранг выше максимального для уровня " + level
                          : "Количество ячеек этого ранга"
                      }
                    >
                      <span>Слотов</span>
                      {editable ? (
                        <input
                          className="pf2e-input pf2e-spell-rank__slot-input"
                          type="number"
                          min="0"
                          max="99"
                          value={slot ? slot.max : 0}
                          disabled={rank > maxRank}
                          aria-label={
                            "Количество ячеек · " + spellRankLabel(rank)
                          }
                          onChange={(event) =>
                            setRankSlotCount(rank, event.target.value)
                          }
                        />
                      ) : (
                        <b>{slot ? slot.max : 0}</b>
                      )}
                    </label>
                  ) : (
                    <span className="pf2e-spell-rank__hint">
                      {slot
                        ? slot.value + " / " + slot.max + " ячеек"
                        : "ячейки не заданы"}
                    </span>
                  )}
                </header>
                {isPrepared && rank !== 0 && slot ? (
                  <ol className="pf2e-prepared-slots">
                    {Array.from({ length: slot.max }).map((_, index) => {
                      const prepared = slot.prepared[index] || null;
                      const spell = prepared ? spellById.get(prepared.id) : null;
                      const expandedKey =
                        "slot:" + rank + ":" + index + ":" + (prepared ? prepared.id : "");
                      const isExpanded = Boolean(expanded[expandedKey]);
                      return (
                        <li
                          className={
                            "pf2e-prepared-slot" +
                            (spell
                              ? " pf2e-prepared-slot--filled"
                              : " pf2e-prepared-slot--empty") +
                            (prepared && prepared.expended
                              ? " pf2e-prepared-slot--expended"
                              : "")
                          }
                          key={rank + ":" + index}
                          onDragOver={
                            editable
                              ? (event) => {
                                  if (acceptsPreparedSpellDrag(event)) {
                                    event.preventDefault();
                                    event.dataTransfer.dropEffect = "copy";
                                  }
                                }
                              : undefined
                          }
                          onDrop={editable ? handlePreparedDrop(rank, index) : undefined}
                        >
                          {spell ? (
                            <>
                              <button
                                type="button"
                                className="pf2e-spell__name pf2e-spell__name--button"
                                title="Показать или скрыть описание"
                                onClick={() => toggleExpanded(expandedKey)}
                              >
                                {spell.name}
                              </button>
                              <span className="pf2e-spell__meta">
                                {prepared.expended ? "истрачено" : "подготовлено"}
                              </span>
                              <button
                                type="button"
                                className="pf2e-spell__img"
                                title="Отправить карточку заклинания в чат"
                                onClick={() => sendSpellCard(spell)}
                              >
                                {spell.img ? (
                                  <img src={spell.img} alt="" loading="lazy" />
                                ) : (
                                  <span aria-hidden="true">✦</span>
                                )}
                              </button>
                              {!prepared.expended ? (
                                <button
                                  type="button"
                                  className="pf2e-small-button pf2e-spell-cast-button"
                                  title="Сотворить подготовленное заклинание"
                                  onClick={() => castPrepared(rank, index)}
                                >
                                  Сотворить
                                </button>
                              ) : null}
                              {editable ? (
                                <>
                                  <button
                                    type="button"
                                    className="pf2e-icon-button"
                                    title="Изменить (карточка предмета)"
                                    onClick={() => setSheetItem(spell)}
                                  >
                                    ✎
                                  </button>
                                  <button
                                    type="button"
                                    className="pf2e-icon-button pf2e-icon-button--danger"
                                    title="Очистить ячейку"
                                    aria-label="Очистить ячейку"
                                    onClick={() => unprepare(rank, index)}
                                  >
                                    🗑
                                  </button>
                                </>
                              ) : null}
                              {isExpanded ? (
                                <p className="pf2e-spell__description">
                                  {plainDescription(spell.description) ||
                                    "Описание отсутствует."}
                                </p>
                              ) : null}
                            </>
                          ) : (
                            <span className="pf2e-prepared-slot__hint">
                              Пустая ячейка — перетащите сюда заклинание{" "}
                              {spellRankLabel(rank).toLowerCase()}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                ) : null}
                {rankSpells.length > 0 ? (
                  <ol className="pf2e-spell-list">
                    {rankSpells.map((spell) => renderSpellRow(spell, rank))}
                  </ol>
                ) : isPrepared && slot ? null : (
                  <p className="pf2e-empty pf2e-empty--small">
                    Заклинаний этого круга нет.
                  </p>
                )}
              </section>
            );
          })
        )}
      </div>

      {prepOpen ? (
        <SpellPreparationModal
          entry={entry}
          spells={spells}
          maxRank={maxRank}
          level={level}
          editable={editable}
          onClose={() => setPrepOpen(false)}
        />
      ) : null}

      {sheetItem ? (
        <ItemSheetModal
          item={sheetItem}
          onClose={() => setSheetItem(null)}
        />
      ) : null}
    </article>
  );
}

export function SpellsTab({
  system,
  items,
  actor,
  editable,
  updateSystem,
  onRoll,
  onItemsChange,
  onCompendiumDrop,
  onCreateEntry,
  onUpdateEntry,
  onDeleteEntry,
}) {
  const [editor, setEditor] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [activeEntryId, setActiveEntryId] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [sheetItem, setSheetItem] = useState(null);
  const spells = system.spells || [];
  const allItems = Array.isArray(items) ? items : [];
  const spellcastingEntries = useMemo(
    () => allItems.filter((item) => item && item.type === "spellcastingEntry"),
    [allItems],
  );
  const spellItems = useMemo(
    () => allItems.filter((item) => item && item.type === "spell"),
    [allItems],
  );
  const spellsByEntry = useMemo(() => {
    const map = new Map();
    for (const spell of spellItems) {
      const entryId =
        spell.entryId ||
        (spell.system && spell.system.location
          ? spell.system.location.value
          : "");
      if (!map.has(entryId)) {
        map.set(entryId, []);
      }
      map.get(entryId).push(spell);
    }
    return map;
  }, [spellItems]);
  const effectiveActiveId = spellcastingEntries.some(
    (entry) => entry.id === activeEntryId,
  )
    ? activeEntryId
    : spellcastingEntries[0]?.id || "";
  const grouped = useMemo(() => {
    const map = new Map();
    for (const spell of spells) {
      const key = spell.rank || "1";
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(spell);
    }
    return [...map.entries()].sort((a, b) => {
      const rankA = a[0] === "cantrip" ? -1 : Number(a[0]);
      const rankB = b[0] === "cantrip" ? -1 : Number(b[0]);
      return rankA - rankB;
    });
  }, [spells]);

  // Step 6.3: global Focus pool. `prepareActorSystem` derives the maximum from
  // the known non-cantrip focus spells unless `override` is enabled.
  const focus = system.resources?.focus || {
    value: 0,
    max: 0,
    cap: 3,
    override: false,
    known: 0,
  };
  const focusMax = Math.max(0, Math.min(3, Number(focus.max) || 0));
  // Step 6.3.1: the purple Focus pool is only relevant for actors that actually
  // have a Focus set or a non-zero derived/overridden maximum. Clean sheets stay
  // free of the block entirely (no empty placeholder).
  const hasFocusEntry = useMemo(
    () => spellcastingEntries.some((entry) => isFocusSpellcastingEntry(entry)),
    [spellcastingEntries],
  );
  const showFocusPool = hasFocusEntry || focusMax > 0;
  const patchFocus = (patch) => {
    if (typeof updateSystem !== "function") {
      return;
    }
    updateSystem((current) => {
      const previous = current.resources?.focus || {};
      return {
        ...current,
        resources: {
          ...(current.resources || {}),
          focus: { ...previous, ...patch },
        },
      };
    });
  };
  const setFocusValue = (raw) => {
    const next = Math.max(
      0,
      Math.min(focusMax, Math.trunc(Number(raw) || 0)),
    );
    patchFocus({ value: next });
    return next;
  };
  const setFocusMax = (raw) => {
    const next = Math.max(0, Math.min(3, Math.trunc(Number(raw) || 0)));
    patchFocus({
      max: next,
      override: true,
      value: Math.min(Number(focus.value) || 0, next),
    });
    return next;
  };
  const useDerivedFocusMax = () => {
    patchFocus({ override: false });
  };
  const spendFocus = (amount = 1) => {
    if (typeof updateSystem !== "function") {
      return;
    }
    updateSystem((current) => {
      const previous = current.resources?.focus || {};
      const next = Math.max(
        0,
        (Number(previous.value) || 0) - (Number(amount) || 0),
      );
      return {
        ...current,
        resources: {
          ...(current.resources || {}),
          focus: { ...previous, value: next },
        },
      };
    });
  };


  const saveSpell = (spell) => {
    updateSystem((current) => {
      const list = Array.isArray(current.spells) ? current.spells : [];
      const exists = list.some((entry) => entry.id === spell.id);
      return {
        ...current,
        spells: exists
          ? list.map((entry) => (entry.id === spell.id ? spell : entry))
          : [...list, spell],
      };
    });
  };

  const removeSpell = (spell) => {
    updateSystem((current) => ({
      ...current,
      spells: (current.spells || []).filter((entry) => entry.id !== spell.id),
    }));
  };

  const togglePrepared = (spell) => {
    updateSystem((current) => ({
      ...current,
      spells: (current.spells || []).map((entry) =>
        entry.id === spell.id ? { ...entry, prepared: !entry.prepared } : entry,
      ),
    }));
  };

  const deleteSpellItem = (spell) => {
    if (typeof onItemsChange === "function") {
      onItemsChange(allItems.filter((entry) => entry.id !== spell.id));
    }
  };

  return (
    <section
      className="pf2e-tab pf2e-tab--spells"
      onDragOver={(event) => {
        if (!canAcceptCompendiumDrop(event)) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        const payload = readCompendiumDrop(event);
        if (!payload) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (typeof onCompendiumDrop === "function") {
          onCompendiumDrop(payload, { entryId: effectiveActiveId });
        }
      }}
    >
      <SectionHeader
        title="Наборы заклинаний"
        hint={spellcastingEntries.length + " набор(ов)"}
        actions={
          editable ? (
            <button type="button" className="pf2e-small-button" onClick={() => setSetupOpen(true)}>
              + Добавить набор заклинаний
            </button>
          ) : null
        }
      />

      <p className="pf2e-muted">
        Перетащите заклинание из компендиума на нужный набор (выделен рамкой) или
        на эту вкладку — оно привяжется к целевому набору.
      </p>

      {showFocusPool ? (
      <section className="pf2e-focus-pool" aria-label="Очки фокуса">
        <div className="pf2e-focus-pool__heading">
          <span className="pf2e-focus-pool__icon" aria-hidden="true">
            ✦
          </span>
          <div>
            <strong>Фокус-поинты</strong>
            <span className="pf2e-focus-pool__hint">
              {focus.override
                ? "Ручной максимум"
                : "Максимум = число изученных заклинаний фокусировки (не более 3)"}
              {Number.isFinite(Number(focus.known))
                ? " · изучено: " + Number(focus.known)
                : ""}
            </span>
          </div>
        </div>
        <label className="pf2e-focus-pool__field">
          <span>Текущие</span>
          <CommitInput
            type="number"
            min="0"
            max={focusMax}
            value={focus.value || 0}
            disabled={!editable}
            onCommit={setFocusValue}
          />
        </label>
        <span className="pf2e-focus-pool__slash">/</span>
        <label className="pf2e-focus-pool__field">
          <span>Максимум</span>
          <CommitInput
            type="number"
            min="0"
            max="3"
            value={focusMax}
            disabled={!editable}
            title="Изменение максимума включает ручной режим (не более 3)"
            onCommit={setFocusMax}
          />
        </label>
        {editable && focus.override ? (
          <button
            type="button"
            className="pf2e-small-button pf2e-focus-pool__auto"
            title="Вернуть автоматический расчёт по заклинаниям фокусировки"
            onClick={useDerivedFocusMax}
          >
            ↺ Авто
          </button>
        ) : null}
      </section>
      ) : null}

      {spellcastingEntries.length === 0 ? (
        <p className="pf2e-empty">
          Наборов заклинаний нет. Добавьте набор, чтобы рассчитать атаку и DC.
        </p>
      ) : (
        <div className="pf2e-spellcasting-list">
          {spellcastingEntries.map((entry) => (
            <SpellcastingEntryCard
              key={entry.id}
              entry={entry}
              system={system}
              spells={spellsByEntry.get(entry.id) || []}
              active={entry.id === effectiveActiveId}
              editable={editable}
              actorId={actor && actor.id ? actor.id : null}
              onActivate={setActiveEntryId}
              onUpdate={onUpdateEntry}
              onDelete={onDeleteEntry}
              onRoll={onRoll}
              onDropSpell={(payload, entryId) =>
                typeof onCompendiumDrop === "function" &&
                onCompendiumDrop(payload, { entryId })
              }
              onDeleteSpell={deleteSpellItem}
              onFocusSpend={spendFocus}
            />
          ))}
        </div>
      )}

      <SectionHeader
        title="Заклинания вне наборов"
        hint={spells.length + " шт."}
        actions={
          editable ? (
            <button type="button" className="pf2e-small-button" onClick={() => setEditor({})}>
              + Добавить заклинание вручную
            </button>
          ) : null
        }
      />

      {spells.length === 0 ? (
        <p className="pf2e-empty">Ручных заклинаний нет.</p>
      ) : (
        grouped.map(([rank, entries]) => (
          <section className="pf2e-spell-rank" key={rank}>
            <header>
              {spellRankLabel(rank)}
            </header>
            <ol className="pf2e-spell-list">
              {entries.map((spell) => (
                <li className="pf2e-spell" key={spell.id}>
                  <button
                    type="button"
                    className="pf2e-spell__cast"
                    title="Сотворить / отправить в чат"
                    onClick={() => onRoll(spell.name, true)}
                    {...hotbarMacroProps({
                      type: "spell",
                      actorId: actor && actor.id ? actor.id : null,
                      actionId: spell.id,
                      name: spell.name,
                      icon: spell.img || null,
                      text: spell.name,
                      plain: true,
                    })}
                  >
                    ✦
                  </button>
                  <button
                    type="button"
                    className="pf2e-spell__name pf2e-spell__name--button"
                    title="Показать или скрыть описание"
                    aria-expanded={expandedId === "manual:" + spell.id}
                    onClick={() =>
                      setExpandedId((current) =>
                        current === "manual:" + spell.id
                          ? ""
                          : "manual:" + spell.id,
                      )
                    }
                  >
                    {spell.name}
                  </button>
                  <span className="pf2e-spell__meta">
                    {TRADITIONS.find((entry) => entry.value === spell.tradition)?.label || spell.tradition}
                  </span>
                  <span className="pf2e-spell__meta">{costGlyph(spell.actions)}</span>
                  <button
                    type="button"
                    className={"pf2e-check" + (spell.prepared ? " pf2e-check--on" : "")}
                    disabled={!editable}
                    title={spell.prepared ? "Подготовлено" : "Не подготовлено"}
                    onClick={() => togglePrepared(spell)}
                  >
                    {spell.prepared ? "✓" : ""}
                  </button>
                  <div className="pf2e-item-controls">
                    {editable ? (
                      <>
                        <button
                          type="button"
                          className="pf2e-icon-button"
                          title="Изменить (карточка предмета)"
                          onClick={() => setSheetItem(spell)}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="pf2e-icon-button pf2e-icon-button--danger"
                          title="Удалить"
                          onClick={() => removeSpell(spell)}
                        >
                          ✕
                        </button>
                      </>
                    ) : null}
                  </div>
                  {expandedId === "manual:" + spell.id ? (
                    <InlineDescription text={spell.description} />
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ))
      )}

      {sheetItem ? (
        <ItemSheetModal
          item={sheetItem}
          canEdit={editable}
          onEdit={(spell) => setEditor(spell)}
          onClose={() => setSheetItem(null)}
        />
      ) : null}

      {editor ? (
        <EntryEditorModal
          kind="spell"
          title={editor.id ? "Изменить заклинание" : "Новое заклинание"}
          initial={editor}
          onSave={saveSpell}
          onClose={() => setEditor(null)}
        />
      ) : null}

      {setupOpen ? (
        <SpellcastingSetupModal
          onSave={onCreateEntry || (() => {})}
          onClose={() => setSetupOpen(false)}
        />
      ) : null}
    </section>
  );
}


// ------------------------------------------------------------------- Feats

export function FeatsTab({
  system,
  items,
  editable,
  updateSystem,
  onRoll,
  onCommitActor,
  onCompendiumDrop,
}) {
  const [editor, setEditor] = useState(null);
  const [slotEditor, setSlotEditor] = useState(null);
  const [expandedId, setExpandedId] = useState("");
  const [sheetItem, setSheetItem] = useState(null);
  const featSlots = system.featSlots || [];
  const allItems = Array.isArray(items) ? items : [];
  const featItems = allItems.filter((item) => item.type === "feat");
  const level = Math.max(1, Math.trunc(Number(system.details?.level?.value) || 1));

  const commit = (nextSystem, nextItems) => {
    if (typeof onCommitActor === "function") {
      onCommitActor(nextSystem, nextItems);
      return;
    }
    updateSystem(() => nextSystem);
  };

  const toggleExpanded = (key) =>
    setExpandedId((current) => (current === key ? "" : key));

  /**
   * Step 5.7: class features are granted automatically by the class pipeline
   * and are shown above the player-selectable slots. Activated features are
   * stored as `action` items, passive ones as `feat` items; both belong here.
   */
  const classFeatures = useMemo(() => {
    const list = [...(system.feats?.classfeature || [])];
    const seen = new Set(list.map((entry) => entry.id));
    for (const item of allItems) {
      if (!item || seen.has(item.id)) {
        continue;
      }
      const category = String(
        item.system?.category || item.category || "",
      ).toLowerCase();
      if (category !== "classfeature") {
        continue;
      }
      seen.add(item.id);
      list.push({
        id: item.id,
        name: item.name,
        type: item.type,
        img: item.img || null,
        level: item.level,
        traits: item.traits,
        description: item.description,
      });
    }
    return list.sort(
      (a, b) =>
        Number(a.level || 1) - Number(b.level || 1) ||
        String(a.name || "").localeCompare(String(b.name || "")),
    );
  }, [system.feats, allItems]);

  const findSlotFeat = (slot) => {
    if (!slot.featId) {
      return null;
    }
    for (const section of ["classfeature", ...FEAT_SECTIONS.map((entry) => entry.id)]) {
      const match = (system.feats?.[section] || []).find(
        (entry) => entry.id === slot.featId,
      );
      if (match) {
        return match;
      }
    }
    return featItems.find((entry) => entry.id === slot.featId) || null;
  };

  /** Persist manual feat edits as `actor.items` documents (Step 4.8.4). */
  const saveFeat = (feat) => {
    const existing = featItems.find((entry) => entry.id === feat.id) || null;
    const section =
      FEAT_SECTIONS.some((entry) => entry.id === feat.section)
        ? feat.section
        : "class";
    const id = feat.id || nextEntryId("feat");
    const levelValue = Math.max(1, Math.trunc(Number(feat.level) || 1));
    const item = {
      ...(existing || {}),
      id,
      name: feat.name,
      type: "feat",
      img: feat.img || existing?.img || null,
      level: levelValue,
      description: feat.description || "",
      traits: feat.traits || "",
      category: section,
      slotId: feat.slotId || existing?.slotId || "",
      uuid: feat.uuid || existing?.uuid || "",
      source: feat.source || existing?.source || "",
      system: {
        ...(existing?.system || {}),
        category: section,
        level: { value: levelValue },
        traits: {
          ...(existing?.system?.traits || {}),
          value: splitTraits(feat.traits).map((trait) => trait.toLowerCase()),
        },
        ...(feat.slotId ? { location: feat.slotId } : {}),
      },
    };
    const nextItems = existing
      ? allItems.map((entry) => (entry.id === id ? item : entry))
      : [...allItems, item];
    commit(system, nextItems);
  };

  const removeFeat = (feat) => {
    confirmAction({
      title: "Удалить черту",
      message:
        'Убрать "' + feat.name + '" из листа? Слот освободится, фит будет удалён.',
      danger: true,
    }).then((confirmed) => {
      if (!confirmed) {
        return;
      }
      const nextItems = allItems.filter((entry) => entry.id !== feat.id);
      const nextSystem = {
        ...system,
        feats: Object.fromEntries(
          ["classfeature", ...FEAT_SECTIONS.map((section) => section.id)].map(
            (section) => [
              section,
              (system.feats?.[section] || []).filter(
                (entry) => entry.id !== feat.id,
              ),
            ],
          ),
        ),
        featSlots: (system.featSlots || []).map((slot) =>
          slot.featId === feat.id ? { ...slot, featId: null } : slot,
        ),
      };
      commit(nextSystem, nextItems);
    });
  };

  const assignSlotFeat = (slot, feat) => {
    const target = ["ancestry", "class", "skill", "general"].includes(slot.type)
      ? slot.type
      : "class";
    const id = feat.id || nextEntryId("feat");
    const existing = featItems.find((entry) => entry.id === id) || null;
    const item = {
      ...(existing || {}),
      ...feat,
      id,
      type: "feat",
      level: slot.level,
      category: target,
      slotId: slot.id,
      system: {
        ...(existing?.system || {}),
        ...(feat.system || {}),
        category: target,
        level: { value: slot.level },
        location: slot.id,
      },
    };
    const nextItems = existing
      ? allItems.map((entry) => (entry.id === id ? item : entry))
      : [...allItems, item];
    const previousFeatId = (system.featSlots || []).find(
      (entry) => entry.id === slot.id,
    )?.featId;
    const cleaned =
      previousFeatId && previousFeatId !== id
        ? nextItems.filter((entry) => entry.id !== previousFeatId)
        : nextItems;
    const nextSystem = {
      ...system,
      featSlots: (system.featSlots || []).map((entry) =>
        entry.id === slot.id ? { ...entry, featId: id } : entry,
      ),
    };
    commit(nextSystem, cleaned);
  };

  const clearSlot = (slot) => {
    const feat = findSlotFeat(slot);
    if (feat) {
      removeFeat(feat);
      return;
    }
    updateSystem((current) => ({
      ...current,
      featSlots: (current.featSlots || []).map((entry) =>
        entry.id === slot.id ? { ...entry, featId: null } : entry,
      ),
    }));
  };

  const dropTargetFor = (target) => ({
    onDragOver: (event) => {
      if (!canAcceptCompendiumDrop(event)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDrop: (event) => {
      const payload = readCompendiumDrop(event);
      if (!payload) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (typeof onCompendiumDrop === "function") {
        onCompendiumDrop(payload, target);
      }
    },
  });

  const shareFeat = (feat) => {
    if (typeof onRoll === "function") {
      onRoll(featChatText(feat), false);
    }
  };

  const openSheet = (feat) => setSheetItem(feat);

  const renderFeatCard = (feat, keyPrefix, options = {}) => {
    const key = keyPrefix + ":" + feat.id;
    return (
      <FeatCard
        key={key}
        feat={feat}
        expanded={expandedId === key}
        onToggle={() => toggleExpanded(key)}
        onShare={() => shareFeat(feat)}
        onOpenSheet={options.canOpenSheet === false ? undefined : openSheet}
        onRemove={options.onRemove}
        editable={editable && typeof options.onRemove === "function"}
      />
    );
  };

  return (
    <section className="pf2e-tab pf2e-tab--feats">
      <SectionHeader
        title="Черты"
        hint={"Уровень " + level + " · перетащите черту из компендиума в слот"}
        actions={
          editable ? (
            <button type="button" className="pf2e-small-button" onClick={() => setEditor({})}>
              + Добавить черту
            </button>
          ) : null
        }
      />

      <section className="pf2e-feat-section pf2e-feat-section--classfeatures">
        <header>
          <span>✨ Особенности класса</span>
          <span className="pf2e-section-header__count">
            {classFeatures.length}
          </span>
        </header>
        {classFeatures.length === 0 ? (
          <p className="pf2e-empty pf2e-empty--small">
            Класс не выбран или у класса пока нет особенностей.
          </p>
        ) : (
          <ol className="pf2e-feat-list">
            {classFeatures.map((feat) =>
              renderFeatCard(feat, "classfeature", { canOpenSheet: true }),
            )}
          </ol>
        )}
      </section>

      {FEAT_SLOT_SECTIONS.map((section) => {
        const slots = featSlots.filter((slot) => slot.type === section.type);
        const filled = slots.filter((slot) => Boolean(slot.featId)).length;
        const slotIds = new Set(slots.map((slot) => slot.id));
        const loose = (system.feats?.[section.type] || []).filter(
          (feat) => !feat.slotId || !slotIds.has(feat.slotId),
        );
        return (
          <section
            className="pf2e-feat-section pf2e-feat-section--slots pf2e-feat-section--drop"
            key={section.type}
            {...(editable ? dropTargetFor({ section: section.type }) : {})}
          >
            <header>
              <span>
                <span aria-hidden="true">{section.icon}</span> {section.label}
              </span>
              <span className="pf2e-section-header__count">
                {slots.length === 0 ? "нет слотов" : filled + "/" + slots.length}
              </span>
            </header>

            {slots.length === 0 ? (
              <p className="pf2e-empty pf2e-empty--small">
                На {level} уровне слоты этой группы ещё не открыты.
              </p>
            ) : (
              <ol className="pf2e-feat-slot-list">
                {slots.map((slot) => {
                  const feat = findSlotFeat(slot);
                  const key = "slot:" + slot.id;
                  const expanded = expandedId === key;
                  return (
                    <li
                      className={
                        "pf2e-feat-slot" +
                        (feat
                          ? " pf2e-feat-slot--filled"
                          : " pf2e-feat-slot--drop")
                      }
                      key={slot.id}
                      {...(!feat && editable
                        ? dropTargetFor({
                            section: section.type,
                            slotType: slot.type,
                            slotId: slot.id,
                          })
                        : {})}
                    >
                      <span className="pf2e-feat__level">ур. {slot.level}</span>
                      <span className="pf2e-feat-slot__type">{section.label}</span>
                      {feat ? (
                        <button
                          type="button"
                          className="pf2e-feat-slot__name pf2e-feat__name--button"
                          title="Показать или скрыть описание"
                          aria-expanded={expanded}
                          onClick={() => toggleExpanded(key)}
                        >
                          {feat.name}
                        </button>
                      ) : (
                        <span className="pf2e-feat-slot__name">
                          Пустой слот · перетащите черту
                        </span>
                      )}
                      <span className="pf2e-item-controls">
                        {feat ? (
                          <>
                            <button
                              type="button"
                              className="pf2e-icon-button"
                              title="Поделиться описанием в чате"
                              onClick={() => shareFeat(feat)}
                            >
                              💬
                            </button>
                            <button
                              type="button"
                              className="pf2e-icon-button"
                              title="Изменить (карточка предмета)"
                              onClick={() => openSheet(feat)}
                            >
                              ✎
                            </button>
                            {editable ? (
                              <button
                                type="button"
                                className="pf2e-small-button"
                                title="Освободить слот"
                                onClick={() => clearSlot(slot)}
                              >
                                Освободить
                              </button>
                            ) : null}
                          </>
                        ) : editable ? (
                          <button
                            type="button"
                            className="pf2e-small-button"
                            onClick={() => setSlotEditor(slot)}
                          >
                            + Заполнить
                          </button>
                        ) : null}
                      </span>
                      {expanded && feat ? (
                        <InlineDescription text={feat.description} />
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}

            {loose.length > 0 ? (
              <ol className="pf2e-feat-list pf2e-feat-list--loose">
                {loose.map((feat) =>
                  renderFeatCard(feat, section.type + "-loose", {
                    onRemove: removeFeat,
                  }),
                )}
              </ol>
            ) : null}
          </section>
        );
      })}

      {EXTRA_FEAT_SECTIONS.map((section) => {
        const entries = system.feats?.[section.id] || [];
        return (
          <section
            className="pf2e-feat-section pf2e-feat-section--drop"
            key={section.id}
            {...(editable ? dropTargetFor({ section: section.id }) : {})}
          >
            <header>
              <span>
                <span aria-hidden="true">{section.icon}</span> {section.label}
              </span>
              <span className="pf2e-section-header__count">{entries.length}</span>
            </header>
            {entries.length === 0 ? (
              <p className="pf2e-empty pf2e-empty--small">
                Нет черт. Перетащите сюда из компендиума.
              </p>
            ) : (
              <ol className="pf2e-feat-list">
                {entries.map((feat) =>
                  renderFeatCard(feat, section.id, { onRemove: removeFeat }),
                )}
              </ol>
            )}
          </section>
        );
      })}

      {editor ? (
        <EntryEditorModal
          kind="feat"
          title={editor.id ? "Изменить черту" : "Новая черта"}
          initial={editor}
          onSave={saveFeat}
          onClose={() => setEditor(null)}
        />
      ) : null}

      {slotEditor ? (
        <EntryEditorModal
          kind="feat"
          title={
            FEAT_SLOT_SECTIONS.find((entry) => entry.type === slotEditor.type)
              ?.label +
            " · ур. " +
            slotEditor.level
          }
          initial={{
            section: slotEditor.type,
            level: slotEditor.level,
          }}
          onSave={(feat) => assignSlotFeat(slotEditor, feat)}
          onClose={() => setSlotEditor(null)}
        />
      ) : null}

      {sheetItem ? (
        <ItemSheetModal
          item={sheetItem}
          canEdit={editable && sheetItem.category !== "classfeature"}
          onEdit={(feat) =>
            setEditor({
              ...feat,
              section: FEAT_SECTIONS.some(
                (entry) => entry.id === feat.category,
              )
                ? feat.category
                : "class",
            })
          }
          onClose={() => setSheetItem(null)}
        />
      ) : null}
    </section>
  );
}




// -------------------------------------------------------------- Biography

function BiographyFieldShell({
  label,
  editable,
  editing,
  wide = false,
  onEdit,
  onCancel,
  onSave,
  children,
  readOnly,
  editLabel,
  saveLabel,
  cancelLabel,
}) {
  return (
    <div
      className={
        "pf2e-bio-field" + (wide ? " pf2e-bio-field--wide" : "")
      }
    >
      <div className="pf2e-bio-field__header">
        <span className="pf2e-bio-field__label">{label}</span>
        {editable && !editing ? (
          <button
            type="button"
            className="pf2e-bio-field__edit"
            title={editLabel}
            aria-label={label + " — " + editLabel}
            onClick={onEdit}
          >
            ✎
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="pf2e-bio-field__editor">
          {children}
          <div className="pf2e-bio-field__actions">
            <button
              type="button"
              className="pf2e-small-button"
              onClick={onSave}
            >
              {saveLabel}
            </button>
            <button type="button" className="pf2e-small-button" onClick={onCancel}>
              {cancelLabel}
            </button>
          </div>
        </div>
      ) : (
        <div className="pf2e-bio-field__value">{readOnly}</div>
      )}
    </div>
  );
}

function BiographyText({
  label,
  value,
  editable,
  onSave,
  labels,
  type = "text",
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <BiographyFieldShell
      label={label}
      editable={editable}
      editing={editing}
      onEdit={() => {
        setDraft(value);
        setEditing(true);
      }}
      onCancel={() => setEditing(false)}
      onSave={() => {
        onSave(draft);
        setEditing(false);
      }}
      editLabel={labels.edit}
      saveLabel={labels.save}
      cancelLabel={labels.cancel}
      readOnly={
        value ? (
          <span>{value}</span>
        ) : (
          <span className="pf2e-muted">{labels.empty}</span>
        )
      }
    >
      <input
        className="pf2e-input"
        type={type}
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
      />
    </BiographyFieldShell>
  );
}

function BiographyRich({
  label,
  value,
  editable,
  onSave,
  labels,
  wide = false,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  return (
    <BiographyFieldShell
      label={label}
      editable={editable}
      editing={editing}
      wide={wide}
      onEdit={() => {
        setDraft(value);
        setEditing(true);
      }}
      onCancel={() => setEditing(false)}
      onSave={() => {
        onSave(draft);
        setEditing(false);
      }}
      editLabel={labels.edit}
      saveLabel={labels.save}
      cancelLabel={labels.cancel}
      readOnly={
        value ? (
          <div
            className="pf2e-bio-field__rich"
            dangerouslySetInnerHTML={{ __html: value }}
          />
        ) : (
          <span className="pf2e-muted">{labels.empty}</span>
        )
      }
    >
      <RichTextEditor
        initialValue={value}
        onChange={setDraft}
        ariaLabel={label}
        placeholder={labels.empty}
      />
    </BiographyFieldShell>
  );
}

function BiographyList({ label, values, editable, onSave, labels }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(values);
  const [entry, setEntry] = useState("");

  useEffect(() => setDraft(values), [values]);

  const addEntry = () => {
    const trimmed = entry.trim();
    if (trimmed === "") {
      return;
    }
    setDraft((current) => [...current, trimmed]);
    setEntry("");
  };

  const removeEntry = (index) => {
    setDraft((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <BiographyFieldShell
      label={label}
      editable={editable}
      editing={editing}
      onEdit={() => {
        setDraft(values);
        setEntry("");
        setEditing(true);
      }}
      onCancel={() => setEditing(false)}
      onSave={() => {
        onSave(draft);
        setEditing(false);
      }}
      editLabel={labels.edit}
      saveLabel={labels.save}
      cancelLabel={labels.cancel}
      readOnly={
        values.length > 0 ? (
          <span className="pf2e-bio-field__tags">
            {values.map((value, index) => (
              <span className="pf2e-tag" key={value + ":" + index}>
                {value}
              </span>
            ))}
          </span>
        ) : (
          <span className="pf2e-muted">{labels.empty}</span>
        )
      }
    >
      <div className="pf2e-bio-field__tags">
        {draft.map((value, index) => (
          <span className="pf2e-tag" key={value + ":" + index}>
            {value}
            <button
              type="button"
              className="pf2e-bio-field__tag-remove"
              title={labels.remove}
              aria-label={labels.remove + ": " + value}
              onClick={() => removeEntry(index)}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="pf2e-bio-field__add">
        <input
          className="pf2e-input"
          value={entry}
          placeholder={labels.entryPlaceholder}
          onChange={(event) => setEntry(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addEntry();
            }
          }}
        />
        <button type="button" className="pf2e-small-button" onClick={addEntry}>
          {labels.add}
        </button>
      </div>
    </BiographyFieldShell>
  );
}

export function BiographyTab({ system, editable, updateSystem }) {
  const { t } = useTranslation();

  const biography = system.details?.biography || {};

  const text = (key) => {
    const value = biography[key];
    if (typeof value === "string") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.join("\n");
    }
    if (value && typeof value === "object") {
      return typeof value.value === "string" ? value.value : "";
    }
    return "";
  };

  const list = (key) => {
    const value = biography[key];
    if (Array.isArray(value)) {
      return value.filter((entry) => typeof entry === "string" && entry !== "");
    }
    if (typeof value === "string" && value.trim() !== "") {
      return value
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
    return [];
  };

  const patch = (key, value) =>
    updateSystem((current) => ({
      ...current,
      details: {
        ...current.details,
        biography: {
          ...(current.details?.biography || {}),
          [key]: value,
        },
      },
    }));

  const labels = {
    edit: t("PF2E.Platform.Biography.Edit", "Edit"),
    save: t("PF2E.Platform.Biography.Save", "Save"),
    cancel: t("PF2E.Platform.Biography.Cancel", "Cancel"),
    empty: t("PF2E.Platform.Biography.Empty", "Click the pencil to fill this in."),
    add: t("PF2E.Platform.Biography.AddEntry", "Add"),
    entryPlaceholder: t("PF2E.Platform.Biography.EntryPlaceholder", "New entry…"),
    remove: t("PF2E.Platform.Biography.RemoveEntry", "Remove entry"),
  };

  return (
    <section className="pf2e-tab pf2e-tab--biography">
      <SectionHeader
        title={t("PF2E.BiographyAppearance", "Appearance")}
      />
      <div className="pf2e-bio-grid">
        <BiographyText
          label={t("PF2E.Height", "Height")}
          value={text("height")}
          editable={editable}
          labels={labels}
          onSave={(value) => patch("height", value)}
        />
        <BiographyText
          label={t("PF2E.Weight", "Weight")}
          value={text("weight")}
          editable={editable}
          labels={labels}
          onSave={(value) => patch("weight", value)}
        />
      </div>

      <SectionHeader title={t("PF2E.BiographyBackStory", "Backstory")} />
      <BiographyRich
        label={t("PF2E.BiographyBackStory", "Backstory")}
        value={text("backstory")}
        editable={editable}
        labels={labels}
        wide
        onSave={(value) => patch("backstory", value)}
      />

      <SectionHeader
        title={t("PF2E.BiographyPersonalityHeader", "Personality")}
      />
      <div className="pf2e-bio-grid">
        <BiographyRich
          label={t("PF2E.Platform.Biography.Character", "Character")}
          value={text("personality")}
          editable={editable}
          labels={labels}
          onSave={(value) => patch("personality", value)}
        />
        <BiographyRich
          label={t("PF2E.BiographyBeliefs", "Beliefs")}
          value={text("beliefs")}
          editable={editable}
          labels={labels}
          onSave={(value) => patch("beliefs", value)}
        />
        <BiographyList
          label={t("PF2E.BiographyEdicts", "Edicts")}
          values={list("edicts")}
          editable={editable}
          labels={labels}
          onSave={(value) => patch("edicts", value)}
        />
        <BiographyList
          label={t("PF2E.BiographyAnathema", "Anathema")}
          values={list("anathema")}
          editable={editable}
          labels={labels}
          onSave={(value) => patch("anathema", value)}
        />
        <BiographyRich
          label={t("PF2E.BiographyLikes", "Likes")}
          value={text("likes")}
          editable={editable}
          labels={labels}
          onSave={(value) => patch("likes", value)}
        />
        <BiographyRich
          label={t("PF2E.BiographyDislikes", "Dislikes")}
          value={text("dislikes")}
          editable={editable}
          labels={labels}
          onSave={(value) => patch("dislikes", value)}
        />
        <BiographyRich
          label={t("PF2E.BiographyCatchphrases", "Catchphrases")}
          value={text("catchphrases")}
          editable={editable}
          labels={labels}
          onSave={(value) => patch("catchphrases", value)}
        />
      </div>

      <SectionHeader
        title={t("PF2E.BiographyCampaignNotesHeader", "Campaign")}
      />
      <div className="pf2e-bio-grid">
        <BiographyRich
          label={t("PF2E.BiographyCampaignNotes", "Notes")}
          value={text("campaignNotes")}
          editable={editable}
          labels={labels}
          wide
          onSave={(value) => patch("campaignNotes", value)}
        />
        <BiographyRich
          label={t("PF2E.BiographyAllies", "Allies")}
          value={text("allies")}
          editable={editable}
          labels={labels}
          onSave={(value) => patch("allies", value)}
        />
        <BiographyRich
          label={t("PF2E.BiographyEnemies", "Enemies")}
          value={text("enemies")}
          editable={editable}
          labels={labels}
          onSave={(value) => patch("enemies", value)}
        />
        <BiographyRich
          label={t("PF2E.BiographyOrganizations", "Organizations")}
          value={text("organizations")}
          editable={editable}
          labels={labels}
          onSave={(value) => patch("organizations", value)}
        />
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Skills

export function SkillsTab({ system, actor, editable, updateSystem, onRoll }) {
  const { t, language } = useTranslation();
  const [loreEditor, setLoreEditor] = useState(null);
  const level = system.details?.level?.value || 1;
  const lore = system.lore || [];
  const actorId = actor && actor.id ? actor.id : null;

  // Step 6.8: the 16 base skills are rendered in two CSS-grid columns and are
  // ordered by their *localised* names, so switching RU/EN re-sorts the list
  // (for example «Акробатика» stays first in RU, while EN starts with
  // «Acrobatics» and follows the English alphabet through «Thievery»).
  const localizedSkills = SKILLS.map((skill) => ({
    ...skill,
    displayLabel: t(skill.labelKey, skill.name || skill.label),
  })).sort((a, b) =>
    a.displayLabel.localeCompare(
      b.displayLabel,
      language === "en" ? "en" : "ru",
      { sensitivity: "base" },
    ),
  );

  const skillMacro = (actionId, name, text, blind = false) => ({
    type: "skill",
    actorId,
    actionId,
    name,
    icon: null,
    text,
    visibility: blind ? "blind" : "public",
  });

  const patchSkill = (key, rank) =>
    updateSystem((current) => {
      const floor = clampRank(current.skills?.[key]?.minRank);
      const nextRank = Math.max(clampRank(rank), floor);
      return {
        ...current,
        skills: {
          ...current.skills,
          [key]: { ...current.skills[key], rank: nextRank },
        },
      };
    });

  const patchSave = (key, rank) =>
    updateSystem((current) => {
      const floor = clampRank(current.saves?.[key]?.minRank);
      const nextRank = Math.max(clampRank(rank), floor);
      return {
        ...current,
        saves: {
          ...current.saves,
          [key]: { ...current.saves[key], rank: nextRank },
        },
      };
    });

  const patchPerception = (rank) =>
    updateSystem((current) => {
      const floor = clampRank(current.perception?.minRank);
      return {
        ...current,
        perception: {
          ...current.perception,
          rank: Math.max(clampRank(rank), floor),
        },
      };
    });

  const patchMartial = (group, key, rank) =>
    updateSystem((current) => {
      const floor = clampRank(current.proficiencies?.[group]?.[key]?.minRank);
      return {
        ...current,
        proficiencies: {
          ...current.proficiencies,
          [group]: {
            ...current.proficiencies[group],
            [key]: {
              ...(current.proficiencies[group]?.[key] || {}),
              rank: Math.max(clampRank(rank), floor),
            },
          },
        },
      };
    });

  const saveLore = (entry) => {
    const normalized = {
      id: entry.id,
      name: entry.name,
      rank: clampRank(entry.rank),
    };
    updateSystem((current) => {
      const list = Array.isArray(current.lore) ? current.lore : [];
      const exists = list.some((item) => item.id === normalized.id);
      return {
        ...current,
        lore: exists
          ? list.map((item) => (item.id === normalized.id ? normalized : item))
          : [...list, normalized],
      };
    });
  };

  const removeLore = (entry) => {
    updateSystem((current) => ({
      ...current,
      lore: (current.lore || []).filter((item) => item.id !== entry.id),
    }));
  };

  const perceptionTotal =
    abilityMod(system, "wis") + proficiencyBonus(level, system.perception?.rank);

  return (
    <section className="pf2e-tab pf2e-tab--skills">
      <SectionHeader
        title={t("PF2E.Platform.Sheet.Skills", "Skills")}
        hint={
          t("PF2E.Platform.Sheet.Level", "Level") + " " + level
        }
      />
      <ul className="pf2e-skill-list pf2e-skill-grid">
        {localizedSkills.map((skill) => {
          const modifier = skillModifier(system, skill.key, skill.ability);
          const rank = clampRank(system.skills?.[skill.key]?.rank);
          return (
            <li className="pf2e-skill" key={skill.key} data-statistic={skill.key}>
              <button
                type="button"
                className="pf2e-roll-button"
                title={
                  t("PF2E.Platform.Sheet.SkillCheck", "Check") +
                  ": " +
                  skill.displayLabel
                }
                onClick={() => onRoll(rollLabel(modifier, skill.displayLabel))}
                {...hotbarMacroProps(
                  skillMacro(
                    skill.key,
                    skill.displayLabel,
                    rollLabel(modifier, skill.displayLabel),
                  ),
                )}
              >
                <span className="pf2e-d20">d20</span>
              </button>
              <BlindRollButton
                title={
                  t("PF2E.Platform.Sheet.BlindCheck", "Secret check") +
                  ": " +
                  skill.displayLabel
                }
                onClick={() =>
                  onRoll(
                    blindRollLabel(modifier, skill.displayLabel),
                    false,
                    "blind",
                  )
                }
                dragMacro={skillMacro(
                  skill.key + ":blind",
                  skill.displayLabel +
                    " " +
                    t("PF2E.Platform.Sheet.SecretSuffix", "(secret)"),
                  blindRollLabel(modifier, skill.displayLabel),
                  true,
                )}
              />
              <span
                className="pf2e-skill__modifier"
                title={
                  Number(system.skills?.[skill.key]?.armorPenalty)
                    ? t("PF2E.Platform.Sheet.ArmorPenalty", "Armor penalty") +
                      ": " +
                      Number(system.skills[skill.key].armorPenalty)
                    : undefined
                }
              >
                {signed(modifier)}
              </span>
              <span className="pf2e-skill__name">{skill.displayLabel}</span>
              <span className="pf2e-skill__ability">
                {ABILITIES.find((ability) => ability.key === skill.ability)?.abbr}
              </span>
              {Number(system.skills?.[skill.key]?.armorPenalty) ? (
                <span
                  className="pf2e-skill__acp"
                  title={t(
                    "PF2E.Platform.Sheet.ArmorCheckPenalty",
                    "Armor check penalty",
                  )}
                >
                  ACP {signed(Number(system.skills[skill.key].armorPenalty))}
                </span>
              ) : null}
              <RankSelect
                rank={rank}
                minRank={system.skills?.[skill.key]?.minRank}
                disabled={!editable}
                onChange={(value) => patchSkill(skill.key, value)}
              />
            </li>
          );
        })}
      </ul>

      <SectionHeader
        title={t("PF2E.Platform.Sheet.Lore", "Lore")}
        actions={
          editable ? (
            <button
              type="button"
              className="pf2e-small-button"
              onClick={() => setLoreEditor({})}
            >
              {t("PF2E.Platform.Sheet.AddLore", "+ Add Lore")}
            </button>
          ) : null
        }
      />
      <ul className="pf2e-skill-list">
        {lore.length === 0 ? (
          <li className="pf2e-empty">
            {t("PF2E.Platform.Sheet.NoLore", "No lore yet.")}
          </li>
        ) : (
          lore.map((entry) => {
            const modifier = abilityMod(system, "int") + proficiencyBonus(level, entry.rank);
            return (
              <li className="pf2e-skill" key={entry.id}>
                <button
                  type="button"
                  className="pf2e-roll-button"
                  title={"Проверка: " + entry.name}
                  onClick={() => onRoll(rollLabel(modifier, entry.name))}
                  {...hotbarMacroProps(
                    skillMacro(
                      "lore:" + entry.id,
                      entry.name,
                      rollLabel(modifier, entry.name),
                    ),
                  )}
                >
                  <span className="pf2e-d20">d20</span>
                </button>
                <BlindRollButton
                  title={"Тайная проверка: " + entry.name}
                  onClick={() =>
                    onRoll(blindRollLabel(modifier, entry.name), false, "blind")
                  }
                  dragMacro={skillMacro(
                    "lore:" + entry.id + ":blind",
                    entry.name + " (тайно)",
                    blindRollLabel(modifier, entry.name),
                    true,
                  )}
                />
                <span className="pf2e-skill__modifier">{signed(modifier)}</span>
                <span className="pf2e-skill__name">{entry.name}</span>
                <RankBadge rank={entry.rank} />
                <div className="pf2e-item-controls">
                  {editable ? (
                    <>
                      <button
                        type="button"
                        className="pf2e-icon-button"
                        title="Изменить"
                        onClick={() => setLoreEditor({ ...entry, rank: String(entry.rank) })}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="pf2e-icon-button pf2e-icon-button--danger"
                        title="Удалить"
                        onClick={() => removeLore(entry)}
                      >
                        ✕
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })
        )}
      </ul>

      <SectionHeader title="Спасброски и восприятие" />
      <ul className="pf2e-skill-list">
        <li className="pf2e-skill">
          <button
            type="button"
            className="pf2e-roll-button"
            title="Проверка восприятия"
            onClick={() => onRoll(rollLabel(perceptionTotal, "Восприятие"))}
            {...hotbarMacroProps(
              skillMacro(
                "perception",
                "Восприятие",
                rollLabel(perceptionTotal, "Восприятие"),
              ),
            )}
          >
            <span className="pf2e-d20">d20</span>
          </button>
          <BlindRollButton
            title="Тайная проверка восприятия"
            onClick={() =>
              onRoll(blindRollLabel(perceptionTotal, "Восприятие"), false, "blind")
            }
            dragMacro={skillMacro(
              "perception:blind",
              "Восприятие (тайно)",
              blindRollLabel(perceptionTotal, "Восприятие"),
              true,
            )}
          />
          <span className="pf2e-skill__modifier">
            {signed(perceptionTotal)}
          </span>
          <span className="pf2e-skill__name">Восприятие</span>
          <RankSelect
            rank={system.perception?.rank}
            minRank={system.perception?.minRank}
            disabled={!editable}
            onChange={patchPerception}
          />
        </li>
        {SAVES.map((save) => {
          const modifier =
            abilityMod(system, save.ability) +
            proficiencyBonus(level, system.saves?.[save.key]?.rank);
          return (
            <li className="pf2e-skill" key={save.key}>
              <button
                type="button"
                className="pf2e-roll-button"
                title={"Спасбросок: " + save.label}
                onClick={() => onRoll(rollLabel(modifier, save.label))}
                {...hotbarMacroProps(
                  skillMacro(
                    "save:" + save.key,
                    save.label,
                    rollLabel(modifier, save.label),
                  ),
                )}
              >
                <span className="pf2e-d20">d20</span>
              </button>
              <span className="pf2e-skill__modifier">{signed(modifier)}</span>
              <span className="pf2e-skill__name">{save.label}</span>
              <RankSelect
                rank={system.saves?.[save.key]?.rank}
                minRank={system.saves?.[save.key]?.minRank}
                disabled={!editable}
                onChange={(value) => patchSave(save.key, value)}
              />
            </li>
          );
        })}
      </ul>

      <SectionHeader title="Атаки и защита" hint="Владение" />
      <div className="pf2e-proficiency-columns">
        <div>
          <h4>Атаки</h4>
          {(Object.entries(system.proficiencies?.attacks || {})).map(([key, entry]) => (
            <div className="pf2e-proficiency-row" key={key}>
              <span className="pf2e-proficiency-row__name">
                {key === "simple"
                  ? "Простое"
                  : key === "martial"
                    ? "Воинское"
                    : key === "advanced"
                      ? "Экзотическое"
                      : "Без оружия"}
              </span>
              <span className="pf2e-proficiency-row__modifier">
                {signed(proficiencyBonus(level, entry.rank))}
              </span>
              <RankSelect
                rank={entry.rank}
                minRank={entry.minRank}
                disabled={!editable}
                onChange={(value) => patchMartial("attacks", key, value)}
              />
            </div>
          ))}
        </div>
        <div>
          <h4>Защита</h4>
          {(Object.entries(system.proficiencies?.defenses || {})).map(([key, entry]) => (
            <div className="pf2e-proficiency-row" key={key}>
              <span className="pf2e-proficiency-row__name">
                {key === "unarmored"
                  ? "Без брони"
                  : key === "light"
                    ? "Лёгкая"
                    : key === "medium"
                      ? "Средняя"
                      : "Тяжёлая"}
              </span>
              <span className="pf2e-proficiency-row__modifier">
                {signed(proficiencyBonus(level, entry.rank))}
              </span>
              <RankSelect
                rank={entry.rank}
                minRank={entry.minRank}
                disabled={!editable}
                onChange={(value) => patchMartial("defenses", key, value)}
              />
            </div>
          ))}
        </div>
      </div>

      {loreEditor ? (
        <EntryEditorModal
          kind="lore"
          title={loreEditor.id ? "Изменить знание" : "Новое знание"}
          initial={loreEditor}
          onSave={saveLore}
          onClose={() => setLoreEditor(null)}
        />
      ) : null}
    </section>
  );
}

// ----------------------------------------------------------------- Effects

export function EffectsTab({ system, editable, updateSystem }) {
  const [editor, setEditor] = useState(null);
  const [conditionDraft, setConditionDraft] = useState("blinded");
  const conditions = system.conditions || [];
  const effects = system.effects || [];

  const addCondition = () => {
    if (!conditionDraft) {
      return;
    }
    updateSystem((current) => {
      const list = Array.isArray(current.conditions) ? current.conditions : [];
      if (list.some((entry) => entry.value === conditionDraft)) {
        return current;
      }
      const definition = CONDITIONS.find((entry) => entry.value === conditionDraft);
      return {
        ...current,
        conditions: [
          ...list,
          {
            id: nextEntryId("condition"),
            value: conditionDraft,
            label: definition?.label || iwrLabel(conditionDraft),
            value2: 0,
          },
        ],
      };
    });
  };

  const removeCondition = (condition) => {
    updateSystem((current) => ({
      ...current,
      conditions: (current.conditions || []).filter((entry) => entry.id !== condition.id),
    }));
  };

  const saveEffect = (effect) => {
    updateSystem((current) => {
      const list = Array.isArray(current.effects) ? current.effects : [];
      const exists = list.some((entry) => entry.id === effect.id);
      return {
        ...current,
        effects: exists
          ? list.map((entry) => (entry.id === effect.id ? effect : entry))
          : [...list, effect],
      };
    });
  };

  const removeEffect = (effect) => {
    updateSystem((current) => ({
      ...current,
      effects: (current.effects || []).filter((entry) => entry.id !== effect.id),
    }));
  };

  return (
    <section className="pf2e-tab pf2e-tab--effects">
      <SectionHeader
        title="Состояния"
        hint={conditions.length + " активно"}
        actions={
          editable ? (
            <span className="pf2e-inline-add">
              <select
                className="pf2e-input"
                value={conditionDraft}
                onChange={(event) => setConditionDraft(event.target.value)}
              >
                {CONDITIONS.map((condition) => (
                  <option key={condition.value} value={condition.value}>
                    {condition.label}
                  </option>
                ))}
              </select>
              <button type="button" className="pf2e-small-button" onClick={addCondition}>
                + Добавить
              </button>
            </span>
          ) : null
        }
      />
      <ol className="pf2e-effects-list">
        {conditions.length === 0 ? (
          <li className="pf2e-empty">Активных состояний нет.</li>
        ) : (
          conditions.map((condition) => (
            <li className="pf2e-effect pf2e-effect--condition" key={condition.id}>
              <span className="pf2e-effect__icon">⚠</span>
              <span className="pf2e-effect__name">{condition.label}</span>
              <span className="pf2e-effect__meta">Состояние</span>
              {editable ? (
                <div className="pf2e-item-controls">
                  <button
                    type="button"
                    className="pf2e-icon-button pf2e-icon-button--danger"
                    title="Снять состояние"
                    onClick={() => removeCondition(condition)}
                  >
                    ✕
                  </button>
                </div>
              ) : null}
            </li>
          ))
        )}
      </ol>

      <SectionHeader
        title="Эффекты"
        hint={effects.length + " шт."}
        actions={
          editable ? (
            <button type="button" className="pf2e-small-button" onClick={() => setEditor({})}>
              + Добавить эффект
            </button>
          ) : null
        }
      />
      <ol className="pf2e-effects-list">
        {effects.length === 0 ? (
          <li className="pf2e-empty">Эффектов нет.</li>
        ) : (
          effects.map((effect) => (
            <li className="pf2e-effect" key={effect.id}>
              <span className="pf2e-effect__icon">✦</span>
              <span className="pf2e-effect__name">{effect.name}</span>
              {effect.description ? (
                <span className="pf2e-effect__meta">{effect.description}</span>
              ) : null}
              {editable ? (
                <div className="pf2e-item-controls">
                  <button
                    type="button"
                    className="pf2e-icon-button"
                    title="Изменить"
                    onClick={() => setEditor(effect)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="pf2e-icon-button pf2e-icon-button--danger"
                    title="Удалить"
                    onClick={() => removeEffect(effect)}
                  >
                    ✕
                  </button>
                </div>
              ) : null}
            </li>
          ))
        )}
      </ol>

      {editor ? (
        <EntryEditorModal
          kind="effect"
          title={editor.id ? "Изменить эффект" : "Новый эффект"}
          initial={editor}
          onSave={saveEffect}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </section>
  );
}
