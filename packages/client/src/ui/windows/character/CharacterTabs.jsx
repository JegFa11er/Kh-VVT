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
  itemCanHoldHands,
  itemGroupId,
  iwrLabel,
  isPhysicalItemType,
  languageLabel,
  nextEntryId,
  normalizePhysicalItem,
  parseBulkValue,
  proficiencyBonus,
  signed,
  skillModifier,
  spellcastingStats,
  totalBulk,
} from "./character-data.js";
import {
  EntryEditorModal,
  SpellcastingSetupModal,
} from "./CharacterModals.jsx";
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
          onCommit(draft);
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

function RankSelect({ rank, onChange, disabled }) {
  const value = clampRank(rank);
  return (
    <select
      className={"pf2e-rank-select pf2e-rank-select--" + (RANKS[value]?.short || "u").toLowerCase()}
      value={value}
      disabled={disabled}
      title={RANKS[value]?.title}
      onChange={(event) => onChange(Number(event.target.value))}
    >
      {RANKS.map((entry) => (
        <option key={entry.value} value={entry.value}>
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

      <SectionHeader title="Сведения" />
      <div className="pf2e-detail-grid">
        {[
          ["gender", "Пол / местоимения"],
          ["age", "Возраст"],
          ["ethnicity", "Этническая принадлежность"],
          ["nationality", "Национальность"],
        ].map(([key, label]) => (
          <label className="pf2e-field" key={key}>
            <span>{label}</span>
            <CommitInput
              value={system.details?.[key]?.value || ""}
              disabled={!editable}
              onCommit={(value) => patchDetails(key, value)}
            />
          </label>
        ))}
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

/**
 * Foundry's strike row: one d20 attack button per multiple-attack-penalty step
 * plus a damage button. Agility changes the MAP to -4/-8, everything else uses
 * the standard -5/-10.
 */
export function CombatTab({ system, actor, editable, updateSystem, onRoll }) {
  const [editor, setEditor] = useState(null);
  const strikes = system.strikes || [];
  const actorId = actor && actor.id ? actor.id : null;

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
    updateSystem((current) => {
      const list = Array.isArray(current.strikes) ? current.strikes : [];
      const exists = list.some((entry) => entry.id === strike.id);
      return {
        ...current,
        strikes: exists
          ? list.map((entry) => (entry.id === strike.id ? strike : entry))
          : [...list, strike],
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
                    <span className="pf2e-strike-button__label">Атака</span>
                    <span className="pf2e-strike-button__value">{signed(strike.attack)}</span>
                  </button>
                  <button
                    type="button"
                    className="pf2e-strike-button"
                    title={"Второй удар: " + signed(attackMap)}
                    onClick={() => rollAttack(strike, attackMap, "(2-й)")}
                    {...hotbarMacroProps(strikeMacro(strike, attackMap, "(2-й)"))}
                  >
                    <span className="pf2e-strike-button__label">{map}</span>
                    <span className="pf2e-strike-button__value">{signed(attackMap)}</span>
                  </button>
                  <button
                    type="button"
                    className="pf2e-strike-button"
                    title={"Третий удар: " + signed(attackMap2)}
                    onClick={() => rollAttack(strike, attackMap2, "(3-й)")}
                    {...hotbarMacroProps(strikeMacro(strike, attackMap2, "(3-й)"))}
                  >
                    <span className="pf2e-strike-button__label">{map2}</span>
                    <span className="pf2e-strike-button__value">{signed(attackMap2)}</span>
                  </button>
                  <button
                    type="button"
                    className="pf2e-strike-button pf2e-strike-button--damage"
                    title={"Урон: /r " + (strike.damage || "1d6")}
                    onClick={() =>
                      onRoll(
                        "/r " + (strike.damage || "1d6") + " " + strike.name + " — урон",
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
                          <div className="pf2e-inventory-item__name">
                            {item.name}
                            {Number(item.level) > 0 ? (
                              <span className="pf2e-inventory-item__level">
                                ур. {item.level}
                              </span>
                            ) : null}
                          </div>
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
                                title="Изменить"
                                onClick={() => setEditor({ ...item, bulk: String(item.bulk) })}
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
}) {
  const stats = spellcastingStats(system, entry);
  const sc = entry.system || {};
  const slots = Array.isArray(sc.slots) ? sc.slots : [];
  const [rankDraft, setRankDraft] = useState("1");

  const patchSlots = (nextSlots) => {
    onUpdate({
      ...entry,
      system: { ...sc, slots: nextSlots },
    });
  };

  const addRank = () => {
    if (slots.some((slot) => String(slot.rank) === String(rankDraft))) {
      return;
    }
    patchSlots([
      ...slots,
      { rank: String(rankDraft), value: 1, max: 1 },
    ]);
  };

  const changeSlot = (rank, key, delta) => {
    patchSlots(
      slots.map((slot) =>
        String(slot.rank) === String(rank)
          ? {
              ...slot,
              [key]: Math.max(0, Number(slot[key] || 0) + delta),
            }
          : slot,
      ),
    );
  };

  const removeRank = (rank) => {
    patchSlots(slots.filter((slot) => String(slot.rank) !== String(rank)));
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
              {ABILITIES.find((ability) => ability.key === stats.ability)?.abbr || stats.ability}
            </span>
          </div>
        </div>
        <div className="pf2e-spellcasting-card__stats">
          <span title="Модификатор атаки заклинаний">
            Атака {signed(stats.spellAttack)}
          </span>
          <span title="Класс сложности заклинаний">DC {stats.spellDC}</span>
          <span className="pf2e-spellcasting-card__mode">
            {SPELLCASTING_MODES.find((mode) => mode.value === stats.mode)?.label || stats.mode}
          </span>
        </div>
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

      <div className="pf2e-spellcasting-card__slots">
        {slots.length === 0 ? (
          <span className="pf2e-empty-inline">Ранги ячеек не добавлены.</span>
        ) : (
          slots
            .slice()
            .sort((a, b) => {
              const rankA = a.rank === "cantrip" ? -1 : Number(a.rank);
              const rankB = b.rank === "cantrip" ? -1 : Number(b.rank);
              return rankA - rankB;
            })
            .map((slot) => (
              <span className="pf2e-spell-slot" key={slot.rank}>
                <span className="pf2e-spell-slot__rank">{spellRankLabel(slot.rank)}</span>
                <span className="pf2e-spell-slot__value">
                  {slot.value}/{slot.max}
                </span>
                {editable ? (
                  <span className="pf2e-spell-slot__controls">
                    <button
                      type="button"
                      className="pf2e-icon-button"
                      title="Использовать ячейку"
                      onClick={() => changeSlot(slot.rank, "value", -1)}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className="pf2e-icon-button"
                      title="Восстановить ячейку"
                      onClick={() => changeSlot(slot.rank, "value", 1)}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="pf2e-icon-button"
                      title="Добавить ячейку"
                      onClick={() => changeSlot(slot.rank, "max", 1)}
                    >
                      ＋
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
                ) : null}
              </span>
            ))
        )}
        {editable ? (
          <span className="pf2e-spell-slot-add">
            <select
              className="pf2e-input"
              value={rankDraft}
              onChange={(event) => setRankDraft(event.target.value)}
            >
              {SPELL_RANKS.map((rank) => (
                <option key={rank.value} value={rank.value}>
                  {rank.label}
                </option>
              ))}
            </select>
            <button type="button" className="pf2e-small-button" onClick={addRank}>
              + Ранг ячеек
            </button>
          </span>
        ) : null}
      </div>

      <div className="pf2e-spellbook">
        {spells.length === 0 ? (
          <p className="pf2e-empty pf2e-empty--small">
            Перетащите заклинание из компендиума в этот набор.
          </p>
        ) : (
          groupSpellsByRank(spells).map(([rank, rankSpells]) => (
            <section className="pf2e-spell-rank" key={rank}>
              <header>{spellRankLabel(rank)}</header>
              <ol className="pf2e-spell-list">
                {rankSpells.map((spell) => {
                  const attack =
                    spell.spellAttack !== null && spell.spellAttack !== undefined
                      ? spell.spellAttack
                      : stats.spellAttack;
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
                    text:
                      "/r 1d20" +
                      signed(attack) +
                      " " +
                      spell.name +
                      " — атака заклинанием",
                  };
                  return (
                    <li className="pf2e-spell" key={spell.id}>
                      <button
                        type="button"
                        className="pf2e-spell__img"
                        title="Отправить карточку заклинания в чат"
                        onClick={() => onRoll && onRoll(spellChatText(spell, stats), false)}
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
                        title="Отправить карточку заклинания в чат"
                        onClick={() => onRoll && onRoll(spellChatText(spell, stats), false)}
                        {...hotbarMacroProps(spellCardMacro)}
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
                        onClick={() =>
                          onRoll &&
                          onRoll(
                            "/r 1d20" +
                              signed(attack) +
                              " " +
                              spell.name +
                              " — атака заклинанием",
                          )
                        }
                        {...hotbarMacroProps(spellAttackMacro)}
                      >
                        <span className="pf2e-d20">d20</span>
                      </button>
                      {editable ? (
                        <button
                          type="button"
                          className="pf2e-icon-button pf2e-icon-button--danger"
                          title="Удалить заклинание"
                          onClick={() => onDeleteSpell && onDeleteSpell(spell)}
                        >
                          ✕
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))
        )}
      </div>
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
                  <span className="pf2e-spell__name">{spell.name}</span>
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
                          title="Изменить"
                          onClick={() => setEditor(spell)}
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
                </li>
              ))}
            </ol>
          </section>
        ))
      )}

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
  const featSlots = system.featSlots || [];
  const allItems = Array.isArray(items) ? items : [];
  const featItems = allItems.filter((item) => item.type === "feat");

  const commit = (nextSystem, nextItems) => {
    if (typeof onCommitActor === "function") {
      onCommitActor(nextSystem, nextItems);
      return;
    }
    updateSystem(() => nextSystem);
  };

  const findSlotFeat = (slot) => {
    if (!slot.featId) {
      return null;
    }
    for (const section of FEAT_SECTIONS) {
      const match = (system.feats?.[section.id] || []).find(
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
    const level = Math.max(1, Math.trunc(Number(feat.level) || 1));
    const item = {
      ...(existing || {}),
      id,
      name: feat.name,
      type: "feat",
      img: feat.img || existing?.img || null,
      level,
      description: feat.description || "",
      traits: feat.traits || "",
      category: section,
      slotId: feat.slotId || existing?.slotId || "",
      uuid: feat.uuid || existing?.uuid || "",
      source: feat.source || existing?.source || "",
      system: {
        ...(existing?.system || {}),
        category: section,
        level: { value: level },
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
    const nextItems = allItems.filter((entry) => entry.id !== feat.id);
    const nextSystem = {
      ...system,
      feats: Object.fromEntries(
        FEAT_SECTIONS.map((section) => [
          section.id,
          (system.feats?.[section.id] || []).filter(
            (entry) => entry.id !== feat.id,
          ),
        ]),
      ),
      featSlots: (system.featSlots || []).map((slot) =>
        slot.featId === feat.id ? { ...slot, featId: null } : slot,
      ),
    };
    commit(nextSystem, nextItems);
  };

  const assignSlotFeat = (slot, feat) => {
    const target = slot.type === "general" ? "general" : "class";
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
    const cleaned = previousFeatId && previousFeatId !== id
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

  return (
    <section className="pf2e-tab pf2e-tab--feats">
      <SectionHeader
        title="Черты"
        hint="Перетащите черту из компендиума"
        actions={
          editable ? (
            <button type="button" className="pf2e-small-button" onClick={() => setEditor({})}>
              + Добавить черту
            </button>
          ) : null
        }
      />

      {featSlots.length > 0 ? (
        <section className="pf2e-feat-slots">
          <header>
            <span>Слоты черт класса и общие</span>
            <span className="pf2e-section-header__count">{featSlots.length}</span>
          </header>
          <ol className="pf2e-feat-slot-list">
            {featSlots.map((slot) => {
              const feat = findSlotFeat(slot);
              return (
                <li
                  className={
                    "pf2e-feat-slot" +
                    (feat ? " pf2e-feat-slot--filled" : " pf2e-feat-slot--drop")
                  }
                  key={slot.id}
                  {...(feat ? {} : dropTargetFor({ section: slot.type, slotId: slot.id }))}
                >
                  <span className="pf2e-feat__level">ур. {slot.level}</span>
                  <span className="pf2e-feat-slot__type">
                    {slot.type === "general" ? "Общая" : "Классовая"}
                  </span>
                  <span className="pf2e-feat-slot__name">
                    {feat ? feat.name : "Пустой слот · перетащите черту"}
                  </span>
                  {editable ? (
                    feat ? (
                      <button
                        type="button"
                        className="pf2e-small-button"
                        title="Освободить слот"
                        onClick={() => clearSlot(slot)}
                      >
                        Освободить
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="pf2e-small-button"
                        onClick={() => setSlotEditor(slot)}
                      >
                        + Заполнить
                      </button>
                    )
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {FEAT_SECTIONS.map((section) => {
        const entries = system.feats?.[section.id] || [];
        return (
          <section
            className="pf2e-feat-section pf2e-feat-section--drop"
            key={section.id}
            {...(editable ? dropTargetFor({ section: section.id }) : {})}
          >
            <header>
              <span>{section.label}</span>
              <span className="pf2e-section-header__count">{entries.length}</span>
            </header>
            <ol className="pf2e-feat-list">
              {entries.length === 0 ? (
                <li className="pf2e-empty">Нет черт. Перетащите сюда из компендиума.</li>
              ) : (
                entries.map((feat) => (
                  <li className="pf2e-feat pf2e-feat--card" key={feat.id}>
                    <button
                      type="button"
                      className="pf2e-feat__img"
                      title="Отправить описание черты в чат"
                      onClick={() => onRoll && onRoll(featChatText(feat), false)}
                    >
                      {feat.img ? (
                        <img src={feat.img} alt="" loading="lazy" />
                      ) : (
                        <span aria-hidden="true">🏅</span>
                      )}
                    </button>
                    <span className="pf2e-feat__level">ур. {feat.level || 1}</span>
                    <span className="pf2e-feat__name">{feat.name}</span>
                    {feat.traits ? (
                      <span className="pf2e-feat__traits">
                        {splitTraits(feat.traits).slice(0, 4).join(", ")}
                      </span>
                    ) : null}
                    <div className="pf2e-item-controls">
                      <button
                        type="button"
                        className="pf2e-icon-button"
                        title="Поделиться описанием в чате"
                        onClick={() => onRoll && onRoll(featChatText(feat), false)}
                      >
                        💬
                      </button>
                      {editable ? (
                        <>
                          <button
                            type="button"
                            className="pf2e-icon-button"
                            title="Изменить"
                            onClick={() => setEditor({ ...feat, section: section.id })}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="pf2e-icon-button pf2e-icon-button--danger"
                            title="Удалить"
                            onClick={() => removeFeat(feat)}
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
            slotEditor.type === "general"
              ? "Общая черта · ур. " + slotEditor.level
              : "Классовая черта · ур. " + slotEditor.level
          }
          initial={{
            section: slotEditor.type === "general" ? "general" : "class",
            level: slotEditor.level,
          }}
          onSave={(feat) => assignSlotFeat(slotEditor, feat)}
          onClose={() => setSlotEditor(null)}
        />
      ) : null}
    </section>
  );
}


// ------------------------------------------------------------------ Skills

export function SkillsTab({ system, actor, editable, updateSystem, onRoll }) {
  const [loreEditor, setLoreEditor] = useState(null);
  const level = system.details?.level?.value || 1;
  const lore = system.lore || [];
  const actorId = actor && actor.id ? actor.id : null;

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
    updateSystem((current) => ({
      ...current,
      skills: { ...current.skills, [key]: { ...current.skills[key], rank } },
    }));

  const patchSave = (key, rank) =>
    updateSystem((current) => ({
      ...current,
      saves: { ...current.saves, [key]: { ...current.saves[key], rank } },
    }));

  const patchPerception = (rank) =>
    updateSystem((current) => ({
      ...current,
      perception: { ...current.perception, rank },
    }));

  const patchMartial = (group, key, rank) =>
    updateSystem((current) => ({
      ...current,
      proficiencies: {
        ...current.proficiencies,
        [group]: {
          ...current.proficiencies[group],
          [key]: { ...(current.proficiencies[group]?.[key] || {}), rank },
        },
      },
    }));

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

  return (
    <section className="pf2e-tab pf2e-tab--skills">
      <SectionHeader title="Навыки" hint={"Уровень " + level} />
      <ul className="pf2e-skill-list">
        {SKILLS.map((skill) => {
          const modifier = skillModifier(system, skill.key, skill.ability);
          const rank = clampRank(system.skills?.[skill.key]?.rank);
          return (
            <li className="pf2e-skill" key={skill.key} data-statistic={skill.key}>
              <button
                type="button"
                className="pf2e-roll-button"
                title={"Проверка: " + skill.label}
                onClick={() => onRoll(rollLabel(modifier, skill.label))}
                {...hotbarMacroProps(
                  skillMacro(
                    skill.key,
                    skill.label,
                    rollLabel(modifier, skill.label),
                  ),
                )}
              >
                <span className="pf2e-d20">d20</span>
              </button>
              <BlindRollButton
                title={"Тайная проверка: " + skill.label}
                onClick={() =>
                  onRoll(blindRollLabel(modifier, skill.label), false, "blind")
                }
                dragMacro={skillMacro(
                  skill.key + ":blind",
                  skill.label + " (тайно)",
                  blindRollLabel(modifier, skill.label),
                  true,
                )}
              />
              <span
                className="pf2e-skill__modifier"
                title={
                  Number(system.skills?.[skill.key]?.armorPenalty)
                    ? "Штраф брони: " + Number(system.skills[skill.key].armorPenalty)
                    : undefined
                }
              >
                {signed(modifier)}
              </span>
              <span className="pf2e-skill__name">{skill.label}</span>
              <span className="pf2e-skill__ability">
                {ABILITIES.find((ability) => ability.key === skill.ability)?.abbr}
              </span>
              {Number(system.skills?.[skill.key]?.armorPenalty) ? (
                <span className="pf2e-skill__acp" title="Штраф проверок от брони">
                  ACP {signed(Number(system.skills[skill.key].armorPenalty))}
                </span>
              ) : null}
              <RankSelect
                rank={rank}
                disabled={!editable}
                onChange={(value) => patchSkill(skill.key, value)}
              />
            </li>
          );
        })}
      </ul>

      <SectionHeader
        title="Знания"
        actions={
          editable ? (
            <button
              type="button"
              className="pf2e-small-button"
              onClick={() => setLoreEditor({})}
            >
              + Добавить знание
            </button>
          ) : null
        }
      />
      <ul className="pf2e-skill-list">
        {lore.length === 0 ? (
          <li className="pf2e-empty">Знаний пока нет.</li>
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
            onClick={() =>
              onRoll(
                rollLabel(
                  abilityMod(system, "wis") + proficiencyBonus(level, system.perception?.rank),
                  "Восприятие",
                ),
              )
            }
            {...hotbarMacroProps(
              skillMacro(
                "perception",
                "Восприятие",
                rollLabel(
                  abilityMod(system, "wis") + proficiencyBonus(level, system.perception?.rank),
                  "Восприятие",
                ),
              ),
            )}
          >
            <span className="pf2e-d20">d20</span>
          </button>
          <span className="pf2e-skill__modifier">
            {signed(
              abilityMod(system, "wis") + proficiencyBonus(level, system.perception?.rank),
            )}
          </span>
          <span className="pf2e-skill__name">Восприятие</span>
          <RankSelect
            rank={system.perception?.rank}
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
              <BlindRollButton
                title={"Тайный спасбросок: " + save.label}
                onClick={() =>
                  onRoll(blindRollLabel(modifier, save.label), false, "blind")
                }
                dragMacro={skillMacro(
                  "save:" + save.key + ":blind",
                  save.label + " (тайно)",
                  blindRollLabel(modifier, save.label),
                  true,
                )}
              />
              <span className="pf2e-skill__modifier">{signed(modifier)}</span>
              <span className="pf2e-skill__name">{save.label}</span>
              <RankSelect
                rank={system.saves?.[save.key]?.rank}
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
