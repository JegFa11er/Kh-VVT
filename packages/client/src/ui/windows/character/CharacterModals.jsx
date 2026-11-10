import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  ABILITIES,
  ACTION_COSTS,
  CARRIED_STATUSES,
  FEAT_SECTIONS,
  IWR_TYPE_LISTS,
  LANGUAGE_OPTIONS,
  LANGUAGE_SLUGS,
  normalizeLanguageValue,
  RANKS,
  SPEED_TYPES,
  SPELL_RANKS,
  SPELLCASTING_MODES,
  SPELLCASTING_TRADITIONS,
  SPELLCASTING_TYPES,
  TRADITIONS,
  iwrLabel,
  nextEntryId,
  signed,
} from "./character-data.js";

export function ModalShell({ title, icon, onClose, children, footer, wide = false }) {
  return createPortal(
    <div
      className="modal-backdrop pf2e-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className={"modal-window pf2e-modal" + (wide ? " pf2e-modal--wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-window__header">
          <h2 className="modal-window__title">
            {icon ? <span aria-hidden="true">{icon}</span> : null} {title}
          </h2>
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
        <div className="modal-window__body pf2e-modal__body">{children}</div>
        {footer ? <footer className="modal-window__footer">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}

const IWR_CATEGORY_META = {
  immunities: { title: "Иммунитеты", icon: "🛡️" },
  weaknesses: { title: "Слабости", icon: "💔" },
  resistances: { title: "Сопротивления", icon: "🧱" },
};

/** `templates/actors/iwr-editor.hbs` ported to React. */
export function IwrEditorModal({ category, entries, onSave, onClose }) {
  const meta = IWR_CATEGORY_META[category] || IWR_CATEGORY_META.immunities;
  const options = IWR_TYPE_LISTS[category] || [];
  const [rows, setRows] = useState(() =>
    (Array.isArray(entries) ? entries : []).map((entry) => ({
      type: entry.type || "",
      value: Number.isFinite(Number(entry.value)) ? Number(entry.value) : 1,
      exceptions: typeof entry.exceptions === "string" ? entry.exceptions : "",
      doubleVs: typeof entry.doubleVs === "string" ? entry.doubleVs : "",
    })),
  );
  const [draft, setDraft] = useState({ type: "", value: 1, exceptions: "", doubleVs: "" });

  const isImmunity = category === "immunities";
  const isResistance = category === "resistances";

  const addDraft = () => {
    if (!draft.type) {
      return;
    }
    setRows((current) => [
      ...current,
      {
        type: draft.type,
        value: isImmunity ? undefined : Math.max(1, Number(draft.value) || 1),
        exceptions: draft.exceptions,
        doubleVs: isResistance ? draft.doubleVs : undefined,
      },
    ]);
    setDraft({ type: "", value: 1, exceptions: "", doubleVs: "" });
  };

  const updateRow = (index, patch) => {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  };

  const removeRow = (index) => {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  };

  const commit = () => {
    onSave(
      rows
        .filter((row) => row.type)
        .map((row) => ({
          type: row.type,
          ...(isImmunity ? {} : { value: Math.max(1, Number(row.value) || 1) }),
          ...(row.exceptions ? { exceptions: row.exceptions } : {}),
          ...(isResistance && row.doubleVs ? { doubleVs: row.doubleVs } : {}),
        })),
    );
    onClose();
  };

  return (
    <ModalShell
      title={meta.title}
      icon={meta.icon}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="ui-button" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="ui-button ui-button--primary" onClick={commit}>
            Сохранить
          </button>
        </>
      }
    >
      <div className="pf2e-iwr-editor">
        <div className="pf2e-iwr-editor__new">
          <label className="pf2e-field">
            <span>Тип</span>
            <select
              className="ui-input"
              value={draft.type}
              onChange={(event) =>
                setDraft((current) => ({ ...current, type: event.target.value }))
              }
            >
              <option value="">— выберите тип —</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {!isImmunity ? (
            <label className="pf2e-field pf2e-field--narrow">
              <span>Значение</span>
              <input
                className="ui-input"
                type="number"
                min="1"
                value={draft.value}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    value: event.target.value,
                  }))
                }
              />
            </label>
          ) : null}
          <label className="pf2e-field">
            <span>Исключения</span>
            <input
              className="ui-input"
              value={draft.exceptions}
              placeholder="например: cold-iron"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  exceptions: event.target.value,
                }))
              }
            />
          </label>
          {isResistance ? (
            <label className="pf2e-field">
              <span>Двойное против</span>
              <input
                className="ui-input"
                value={draft.doubleVs}
                placeholder="например: fire"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    doubleVs: event.target.value,
                  }))
                }
              />
            </label>
          ) : null}
          <button
            type="button"
            className="ui-button ui-button--primary pf2e-iwr-editor__add"
            onClick={addDraft}
            disabled={!draft.type}
          >
            + Добавить
          </button>
        </div>

        {rows.length > 0 ? (
          <div className="pf2e-iwr-editor__entries">
            {rows.map((row, index) => (
              <div className="pf2e-iwr-editor__entry" key={index}>
                <label className="pf2e-field">
                  <span>Тип</span>
                  <select
                    className="ui-input"
                    value={row.type}
                    onChange={(event) => updateRow(index, { type: event.target.value })}
                  >
                    {options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {!isImmunity ? (
                  <label className="pf2e-field pf2e-field--narrow">
                    <span>Значение</span>
                    <input
                      className="ui-input"
                      type="number"
                      min="1"
                      value={row.value}
                      onChange={(event) =>
                        updateRow(index, { value: event.target.value })
                      }
                    />
                  </label>
                ) : null}
                <label className="pf2e-field">
                  <span>Исключения</span>
                  <input
                    className="ui-input"
                    value={row.exceptions || ""}
                    placeholder={`${iwrLabel(row.type)}…`}
                    onChange={(event) =>
                      updateRow(index, { exceptions: event.target.value })
                    }
                  />
                </label>
                {isResistance ? (
                  <label className="pf2e-field">
                    <span>Двойное против</span>
                    <input
                      className="ui-input"
                      value={row.doubleVs || ""}
                      onChange={(event) =>
                        updateRow(index, { doubleVs: event.target.value })
                      }
                    />
                  </label>
                ) : null}
                <button
                  type="button"
                  className="pf2e-icon-button pf2e-icon-button--danger"
                  title="Удалить"
                  aria-label="Удалить"
                  onClick={() => removeRow(index)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="pf2e-empty">Записей пока нет.</p>
        )}
      </div>
    </ModalShell>
  );
}

/**
 * `src/module/system/tag-selector/languages.ts` ported to React.
 *
 * The reference selector renders one checkbox per entry of
 * `CONFIG.PF2E.languages` (119 PF2e languages, grouped by rarity). Selected
 * languages are listed first so a long roster stays usable.
 */
export function LanguagesEditorModal({ languages, details, onSave, onClose }) {
  const [values, setValues] = useState(() => {
    const seen = new Set();
    for (const value of Array.isArray(languages) ? languages : []) {
      const slug = normalizeLanguageValue(value);
      if (slug !== "") {
        seen.add(slug);
      }
    }
    return LANGUAGE_SLUGS.filter((slug) => seen.has(slug)).concat(
      [...seen].filter((slug) => !LANGUAGE_SLUGS.includes(slug)),
    );
  });
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState(typeof details === "string" ? details : "");

  const selected = useMemo(() => new Set(values), [values]);
  const options = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = query === ""
      ? LANGUAGE_OPTIONS
      : LANGUAGE_OPTIONS.filter(
          (entry) =>
            entry.label.toLowerCase().includes(query) ||
            entry.value.includes(query),
        );
    return [...matches].sort((a, b) => {
      const selectedA = selected.has(a.value) ? 0 : 1;
      const selectedB = selected.has(b.value) ? 0 : 1;
      return selectedA - selectedB || a.label.localeCompare(b.label, "ru");
    });
  }, [search, selected]);

  const toggleLanguage = (slug) => {
    setValues((current) =>
      current.includes(slug)
        ? current.filter((entry) => entry !== slug)
        : [...current, slug],
    );
  };

  return (
    <ModalShell
      title="Языки"
      icon="🗣️"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="ui-button" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="ui-button ui-button--primary"
            onClick={() => {
              onSave({
                value: LANGUAGE_SLUGS.filter((slug) => selected.has(slug)).concat(
                  values.filter((slug) => !LANGUAGE_SLUGS.includes(slug)),
                ),
                details: notes,
              });
              onClose();
            }}
          >
            Сохранить
          </button>
        </>
      }
    >
      <div className="pf2e-language-editor">
        <div className="pf2e-row">
          <input
            className="ui-input"
            value={search}
            placeholder="Поиск языка…"
            aria-label="Поиск языка"
            onChange={(event) => setSearch(event.target.value)}
          />
          <span className="pf2e-muted">
            Выбрано: {values.length} / {LANGUAGE_OPTIONS.length}
          </span>
        </div>

        <ul className="pf2e-language-grid" aria-label="Доступные языки">
          {options.map((option) => (
            <li key={option.value}>
              <label
                className={
                  "pf2e-language-option" +
                  (selected.has(option.value) ? " pf2e-language-option--selected" : "")
                }
              >
                <input
                  type="checkbox"
                  checked={selected.has(option.value)}
                  onChange={() => toggleLanguage(option.value)}
                />
                <span>{option.label}</span>
                <span
                  className={
                    "pf2e-language-option__rarity pf2e-language-option__rarity--" +
                    option.rarity
                  }
                >
                  {option.rarity === "common"
                    ? "общий"
                    : option.rarity === "uncommon"
                      ? "необыч."
                      : option.rarity === "rare"
                        ? "редкий"
                        : "тайный"}
                </span>
              </label>
            </li>
          ))}
        </ul>

        <label className="pf2e-field">
          <span>Дополнительные сведения</span>
          <textarea
            className="ui-input"
            rows={3}
            value={notes}
            placeholder="Языки, полученные от предыстории, классовых способностей…"
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
      </div>
    </ModalShell>
  );
}

export function SpeedsEditorModal({ speeds, onSave, onClose }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      SPEED_TYPES.map((type) => [
        type.key,
        Number.isFinite(Number(speeds?.[type.key]?.value))
          ? Number(speeds[type.key].value)
          : type.key === "land"
            ? 25
            : 0,
      ]),
    ),
  );

  return (
    <ModalShell
      title="Скорости"
      icon="👣"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ui-button" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="ui-button ui-button--primary"
            onClick={() => {
              onSave(
                Object.fromEntries(
                  SPEED_TYPES.map((type) => [
                    type.key,
                    { value: Math.max(0, Number(values[type.key]) || 0) },
                  ]),
                ),
              );
              onClose();
            }}
          >
            Сохранить
          </button>
        </>
      }
    >
      <div className="pf2e-speed-editor">
        {SPEED_TYPES.map((type) => (
          <label className="pf2e-field" key={type.key}>
            <span>{type.label}, фт.</span>
            <input
              className="ui-input"
              type="number"
              min="0"
              step="5"
              value={values[type.key]}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [type.key]: event.target.value,
                }))
              }
            />
          </label>
        ))}
      </div>
    </ModalShell>
  );
}

export function AttributesEditorModal({ abilities, onSave, onClose }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      ABILITIES.map((ability) => {
        const entry = abilities?.[ability.key] || {};
        const mod = Number(entry.mod);
        return [ability.key, Number.isFinite(mod) ? Math.trunc(mod) : 0];
      }),
    ),
  );

  return (
    <ModalShell
      title="Атрибуты персонажа"
      icon="💪"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ui-button" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="ui-button ui-button--primary"
            onClick={() => {
              onSave(
                Object.fromEntries(
                  ABILITIES.map((ability) => [
                    ability.key,
                    { mod: Math.trunc(Number(values[ability.key]) || 0) },
                  ]),
                ),
              );
              onClose();
            }}
          >
            Сохранить
          </button>
        </>
      }
    >
      <div className="pf2e-attribute-editor">
        {ABILITIES.map((ability) => (
          <label className="pf2e-field pf2e-attribute-editor__row" key={ability.key}>
            <span>
              {ability.abbr} · {ability.label}
            </span>
            <span className="pf2e-attribute-editor__controls">
              <input
                className="ui-input"
                type="number"
                min="-5"
                max="15"
                value={values[ability.key]}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [ability.key]: event.target.value,
                  }))
                }
              />
              <em title="Чистый модификатор характеристики (PF2e Remastered)">
                мод. {signed(values[ability.key])}
              </em>
            </span>
          </label>
        ))}
      </div>
    </ModalShell>
  );
}

/** Foundry-style spellcasting entry setup ("Add spellcasting"). */
export function SpellcastingSetupModal({ onSave, onClose }) {
  const [values, setValues] = useState({
    name: "",
    prepared: "prepared",
    mode: "attack",
    tradition: "arcane",
    ability: "int",
  });

  const derivedName =
    values.name.trim() !== ""
      ? values.name.trim()
      : (SPELLCASTING_TYPES.find((entry) => entry.value === values.prepared)?.label ||
          "Заклинания") +
        " · " +
        (SPELLCASTING_TRADITIONS.find((entry) => entry.value === values.tradition)?.label ||
          values.tradition);

  return (
    <ModalShell
      title="Новый набор заклинаний"
      icon="✦"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ui-button" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="ui-button ui-button--primary"
            onClick={() => {
              onSave({
                id: nextEntryId("spellcastingEntry"),
                name: derivedName,
                type: "spellcastingEntry",
                img: null,
                system: {
                  prepared: values.prepared,
                  mode: values.mode,
                  tradition: values.tradition,
                  ability: values.ability,
                  proficiency: { value: 1 },
                  slots: [],
                },
              });
              onClose();
            }}
          >
            Создать
          </button>
        </>
      }
    >
      <form
        className="pf2e-entry-editor"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="pf2e-field">
          <span>Название (необязательно)</span>
          <input
            className="ui-input"
            value={values.name}
            placeholder={derivedName}
            onChange={(event) =>
              setValues((current) => ({ ...current, name: event.target.value }))
            }
          />
        </label>
        <label className="pf2e-field">
          <span>Тип</span>
          <select
            className="ui-input"
            value={values.prepared}
            onChange={(event) =>
              setValues((current) => ({ ...current, prepared: event.target.value }))
            }
          >
            {SPELLCASTING_TYPES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="pf2e-field">
          <span>Мастерство</span>
          <select
            className="ui-input"
            value={values.mode}
            onChange={(event) =>
              setValues((current) => ({ ...current, mode: event.target.value }))
            }
          >
            {SPELLCASTING_MODES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="pf2e-field">
          <span>Магический обычай (традиция)</span>
          <select
            className="ui-input"
            value={values.tradition}
            onChange={(event) =>
              setValues((current) => ({ ...current, tradition: event.target.value }))
            }
          >
            {SPELLCASTING_TRADITIONS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="pf2e-field">
          <span>Ключевой атрибут</span>
          <select
            className="ui-input"
            value={values.ability}
            onChange={(event) =>
              setValues((current) => ({ ...current, ability: event.target.value }))
            }
          >
            {ABILITIES.map((ability) => (
              <option key={ability.key} value={ability.key}>
                {ability.label}
              </option>
            ))}
          </select>
        </label>
      </form>
    </ModalShell>
  );
}

const DEFAULT_FIELDS = {
  item: [
    { key: "name", label: "Название", type: "text", required: true },
    {
      key: "type",
      label: "Тип",
      type: "select",
      options: [
        { value: "weapon", label: "Оружие" },
        { value: "armor", label: "Броня" },
        { value: "equipment", label: "Снаряжение" },
        { value: "consumable", label: "Расходник" },
        { value: "treasure", label: "Сокровище" },
        { value: "misc", label: "Прочее" },
      ],
    },
    {
      key: "carried",
      label: "Ношение",
      type: "select",
      options: CARRIED_STATUSES,
      defaultValue: "stowed",
    },
    { key: "quantity", label: "Количество", type: "number", min: 0, defaultValue: 1 },
    { key: "bulk", label: "Масса (L / число)", type: "text", defaultValue: "1" },
    {
      key: "category",
      label: "Категория брони",
      type: "select",
      options: [
        { value: "", label: "—" },
        { value: "unarmored", label: "Без брони" },
        { value: "light", label: "Лёгкая" },
        { value: "medium", label: "Средняя" },
        { value: "heavy", label: "Тяжёлая" },
      ],
      defaultValue: "",
    },
    { key: "acBonus", label: "Бонус КБ брони", type: "number", min: 0, defaultValue: 0 },
    { key: "dexCap", label: "Лимит ЛВК (пусто = нет)", type: "text", defaultValue: "" },
    {
      key: "weaponCategory",
      label: "Категория оружия",
      type: "select",
      options: [
        { value: "simple", label: "Простое" },
        { value: "martial", label: "Воинское" },
        { value: "advanced", label: "Экзотическое" },
        { value: "unarmed", label: "Без оружия" },
      ],
      defaultValue: "simple",
    },
    { key: "damage", label: "Урон оружия", type: "text", defaultValue: "1d6" },
    { key: "damageType", label: "Тип урона", type: "text", defaultValue: "slashing" },
    { key: "traits", label: "Черты", type: "text" },
  ],
  strike: [
    { key: "name", label: "Название атаки", type: "text", required: true },
    { key: "attack", label: "Бонус атаки", type: "number", defaultValue: 0 },
    { key: "damage", label: "Урон", type: "text", defaultValue: "1d6" },
    { key: "damageType", label: "Тип урона", type: "text", defaultValue: "slashing" },
    { key: "traits", label: "Черты", type: "text" },
  ],
  action: [
    { key: "name", label: "Название", type: "text", required: true },
    {
      key: "section",
      label: "Раздел",
      type: "select",
      options: [
        { value: "encounter", label: "Столкновение" },
        { value: "exploration", label: "Исследование" },
        { value: "downtime", label: "Свободное время" },
      ],
      defaultValue: "encounter",
    },
    {
      key: "cost",
      label: "Стоимость",
      type: "select",
      options: ACTION_COSTS,
      defaultValue: "1",
    },
    { key: "traits", label: "Черты", type: "text" },
    { key: "description", label: "Описание", type: "textarea" },
  ],
  spell: [
    { key: "name", label: "Название", type: "text", required: true },
    {
      key: "rank",
      label: "Круг",
      type: "select",
      options: SPELL_RANKS,
      defaultValue: "1",
    },
    {
      key: "tradition",
      label: "Традиция",
      type: "select",
      options: TRADITIONS,
      defaultValue: "arcane",
    },
    { key: "actions", label: "Стоимость", type: "text", defaultValue: "2" },
    { key: "description", label: "Описание", type: "textarea" },
  ],
  feat: [
    { key: "name", label: "Название", type: "text", required: true },
    {
      key: "section",
      label: "Раздел",
      type: "select",
      options: FEAT_SECTIONS.map((section) => ({
        value: section.id,
        label: section.label,
      })),
      defaultValue: "class",
    },
    { key: "level", label: "Уровень", type: "number", min: 1, defaultValue: 1 },
    { key: "traits", label: "Черты", type: "text" },
  ],
  effect: [
    { key: "name", label: "Название", type: "text", required: true },
    { key: "description", label: "Описание", type: "textarea" },
  ],
  lore: [
    { key: "name", label: "Название знания", type: "text", required: true },
    {
      key: "rank",
      label: "Владение",
      type: "select",
      options: RANKS.map((rank) => ({ value: String(rank.value), label: rank.label })),
      defaultValue: "1",
    },
  ],
};

/** Generic add/edit dialog reused by the nine sheet tabs. */
export function EntryEditorModal({ kind, title, initial, onSave, onClose }) {
  const fields = DEFAULT_FIELDS[kind] || DEFAULT_FIELDS.item;
  const [values, setValues] = useState(() => {
    const next = {};
    for (const field of fields) {
      const initialValue = initial?.[field.key];
      next[field.key] =
        initialValue === undefined || initialValue === null
          ? field.defaultValue ?? ""
          : String(initialValue);
    }
    return next;
  });
  const [error, setError] = useState("");

  const submit = (event) => {
    if (event) {
      event.preventDefault();
    }
    for (const field of fields) {
      if (field.required && String(values[field.key] || "").trim() === "") {
        setError("Заполните поле «" + field.label + "».");
        return;
      }
    }
    const result = {};
    for (const field of fields) {
      const raw = values[field.key];
      if (field.type === "number") {
        result[field.key] = Math.max(
          field.min ?? -999,
          Number(raw) || 0,
        );
      } else {
        result[field.key] = String(raw ?? "").trim();
      }
    }
    onSave({ ...result, id: initial?.id || nextEntryId(kind) });
    onClose();
  };

  return (
    <ModalShell
      title={title || "Новая запись"}
      icon="✚"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ui-button" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="ui-button ui-button--primary" onClick={submit}>
            Сохранить
          </button>
        </>
      }
    >
      <form className="pf2e-entry-editor" onSubmit={submit}>
        {fields.map((field) => (
          <label className="pf2e-field" key={field.key}>
            <span>{field.label}</span>
            {field.type === "select" ? (
              <select
                className="ui-input"
                value={values[field.key]}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
              >
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === "textarea" ? (
              <textarea
                className="ui-input"
                rows={3}
                value={values[field.key]}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
              />
            ) : (
              <input
                className="ui-input"
                type={field.type === "number" ? "number" : "text"}
                min={field.min}
                value={values[field.key]}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
              />
            )}
          </label>
        ))}
        {error ? (
          <div className="modal-error" role="alert">
            {error}
          </div>
        ) : null}
        <button type="submit" hidden aria-hidden="true" />
      </form>
    </ModalShell>
  );
}
