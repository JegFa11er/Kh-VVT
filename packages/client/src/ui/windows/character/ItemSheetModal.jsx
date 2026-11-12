import { useEffect, useState } from "react";

import { ModalShell } from "./CharacterModals.jsx";

const PLACEHOLDER_IMAGE = "/assets/ui/item-placeholder.svg";

/**
 * Step 5.7: read-only item sheet.
 *
 * Every list in the character sheet (feats, inventory, spells) opens this
 * floating window from its pencil button. It renders the complete description,
 * the trait tags and the item's embedded rule elements, mirroring Foundry's
 * item sheet instead of the compact row editor.
 */

const RULE_LABELS = {
  ActiveEffectLike: "Изменение эффекта",
  AdjustModifier: "Корректировка модификатора",
  AdjustStrike: "Корректировка удара",
  ChoiceSet: "Набор выбора",
  DamageDice: "Кости урона",
  FlatModifier: "Плоский модификатор",
  GrantItem: "Выдаёт предмет",
  ItemAlteration: "Изменение предмета",
  Note: "Примечание",
  RollOption: "Опция проверки",
  Sense: "Чувство",
  SubstituteRoll: "Замена броска",
  TokenLight: "Свет токена",
  TokenEffectIcon: "Иконка эффекта",
};

const RULE_IGNORED_FIELDS = new Set([
  "key",
  "priority",
  "label",
  "predicate",
  "ignored",
  "requiresEquipped",
]);

function normalizeDescription(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function itemDescription(item) {
  if (!item) {
    return "";
  }
  const system = item.system && typeof item.system === "object" ? item.system : {};
  const raw =
    item.description !== undefined && item.description !== null
      ? item.description
      : system.description !== undefined
        ? system.description
        : "";
  if (raw && typeof raw === "object") {
    return normalizeDescription(raw.value);
  }
  return normalizeDescription(raw);
}

export function itemTraits(item) {
  if (!item) {
    return [];
  }
  const source =
    item.traits !== undefined && item.traits !== null
      ? item.traits
      : item.system && typeof item.system === "object"
        ? item.system.traits
        : null;
  const values = Array.isArray(source)
    ? source
    : source && typeof source === "object"
      ? Array.isArray(source.value)
        ? source.value
        : []
      : String(source || "").split(",");
  return values
    .map((trait) => String(trait || "").trim())
    .filter((trait) => trait !== "");
}

export function itemRules(item) {
  if (!item) {
    return [];
  }
  const system = item.system && typeof item.system === "object" ? item.system : {};
  const sources = [item.rules, system.rules, item.system?.rules].filter(Array.isArray);
  const seen = new Set();
  const rules = [];
  for (const list of sources) {
    for (const rule of list) {
      if (!rule || typeof rule !== "object") {
        continue;
      }
      const signature = JSON.stringify(rule);
      if (seen.has(signature)) {
        continue;
      }
      seen.add(signature);
      rules.push(rule);
    }
  }
  return rules;
}

function ruleDetail(rule) {
  return Object.entries(rule)
    .filter(([key, value]) => {
      if (RULE_IGNORED_FIELDS.has(key)) {
        return false;
      }
      if (value === undefined || value === null || value === "") {
        return false;
      }
      return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
    })
    .map(([key, value]) => {
      const label = key
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (letter) => letter.toUpperCase());
      return label + ": " + String(value);
    })
    .join(" · ");
}

function ruleLabel(rule) {
  if (rule.label) {
    return String(rule.label);
  }
  return RULE_LABELS[rule.key] || String(rule.key || "Правило");
}

export default function ItemSheetModal({
  item,
  title,
  onClose,
  onEdit,
  canEdit = false,
}) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [item && item.img]);
  if (!item) {
    return null;
  }
  const imageSrc = imageFailed
    ? PLACEHOLDER_IMAGE
    : typeof item.img === "string" && item.img.trim() !== ""
      ? item.img
      : PLACEHOLDER_IMAGE;
  const traits = itemTraits(item);
  const rules = itemRules(item);
  const description = itemDescription(item);
  const system = item.system && typeof item.system === "object" ? item.system : {};
  const levelNode = system.level !== undefined ? system.level : item.level;
  const level =
    levelNode !== null && typeof levelNode === "object"
      ? levelNode.value
      : levelNode;
  const rarity = system.traits?.rarity || item.rarity || "";
  const bulkNode = item.bulk !== undefined ? item.bulk : system.bulk;
  const bulk =
    bulkNode !== null && typeof bulkNode === "object" ? bulkNode.value : bulkNode;
  const meta = [
    { label: "Тип", value: item.type || "—" },
    { label: "Уровень", value: level === undefined || level === null ? "—" : String(level) },
    { label: "Редкость", value: rarity || "—" },
    { label: "Масса", value: bulk === undefined || bulk === null || bulk === "" ? "—" : String(bulk) },
    { label: "Количество", value: item.quantity === undefined ? "—" : String(item.quantity) },
    { label: "Источник", value: item.source || system.source?.value || "—" },
  ];

  return (
    <ModalShell
      title={title || item.name || "Предмет"}
      icon={null}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="ui-button" onClick={onClose}>
            Закрыть
          </button>
          {canEdit && typeof onEdit === "function" ? (
            <button
              type="button"
              className="ui-button ui-button--primary"
              onClick={() => {
                onClose();
                onEdit(item);
              }}
            >
              ✎ Изменить данные
            </button>
          ) : null}
        </>
      }
    >
      <article className="pf2e-item-sheet">
        <header className="pf2e-item-sheet__head">
          <span className="pf2e-item-sheet__icon" aria-hidden="true">
            <img
              src={imageSrc}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
          </span>
          <div className="pf2e-item-sheet__title">
            <h3>{item.name || "Без названия"}</h3>
            <span className="pf2e-item-sheet__subtitle">
              {item.type || "предмет"}
              {level !== undefined && level !== null ? " · уровень " + level : ""}
            </span>
          </div>
        </header>

        <dl className="pf2e-item-sheet__meta">
          {meta.map((entry) => (
            <div key={entry.label}>
              <dt>{entry.label}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>

        <section className="pf2e-item-sheet__section">
          <h4>Теги</h4>
          {traits.length === 0 ? (
            <p className="pf2e-empty-inline">Теги не заданы.</p>
          ) : (
            <ul className="pf2e-tag-list pf2e-item-sheet__traits">
              {traits.map((trait, index) => (
                <li className="pf2e-tag" key={trait + ":" + index}>
                  {trait}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pf2e-item-sheet__section">
          <h4>Описание</h4>
          {description ? (
            <p className="pf2e-item-sheet__description">{description}</p>
          ) : (
            <p className="pf2e-empty-inline">Описание отсутствует.</p>
          )}
        </section>

        <section className="pf2e-item-sheet__section">
          <h4>Правила предмета</h4>
          {rules.length === 0 ? (
            <p className="pf2e-empty-inline">Правила не заданы.</p>
          ) : (
            <ol className="pf2e-item-sheet__rules">
              {rules.map((rule, index) => {
                const detail = ruleDetail(rule);
                return (
                  <li key={String(rule.key || "rule") + ":" + index}>
                    <strong>{ruleLabel(rule)}</strong>
                    {detail ? <span>{detail}</span> : null}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </article>
    </ModalShell>
  );
}
