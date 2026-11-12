import { useEffect, useMemo, useRef, useState } from "react";

import {
  ABILITIES,
  ABILITY_BUILDER_LEVELS,
  abilityBuildBreakdown,
  defaultAbilityBuild,
  matchSelectionsToSlots,
  normalizeAbilityBuild,
  readAbilitySource,
  sanitizeAbilityBuild,
  signed,
} from "./character-data.js";
import { ModalShell } from "./CharacterModals.jsx";

const BUILD_SOURCES = [
  {
    key: "ancestry",
    category: "ancestries",
    label: "Родословная",
    icon: "🧬",
  },
  {
    key: "background",
    category: "backgrounds",
    label: "Предыстория",
    icon: "📜",
  },
  {
    key: "class",
    category: "classes",
    label: "Класс",
    icon: "🛡️",
  },
];

const ABILITY_KEYS = ABILITIES.map((ability) => ability.key);

async function fetchCompendiumDocument(category, id) {
  if (!id) {
    return null;
  }
  const response = await fetch(
    "/api/compendiums/" + encodeURIComponent(category) + "/" + encodeURIComponent(id),
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) {
    throw new Error("HTTP " + response.status + " " + response.statusText);
  }
  return response.json();
}

/**
 * Turn the compact summary persisted on `system.details` into a document-like
 * object accepted by `readAbilitySource`.
 */
function sourceFromDetails(detail) {
  if (!detail || (detail.boosts === undefined && detail.keyAbility === undefined)) {
    return null;
  }
  return {
    system: {
      boosts: detail.boosts,
      flaws: detail.flaws,
      keyAbility: { value: Array.isArray(detail.keyAbility) ? detail.keyAbility : [] },
    },
  };
}

function hasUsableSource(detail) {
  const source = sourceFromDetails(detail);
  if (!source) {
    return false;
  }
  const parsed = readAbilitySource(source);
  return parsed.boosts.length > 0 || parsed.keyAbility.length > 0;
}

function sourceId(details, key) {
  return details?.[key]?.id || "";
}

function needsSourceFetch(details) {
  return BUILD_SOURCES.some((source) => {
    const id = sourceId(details, source.key);
    return Boolean(id) && !hasUsableSource(details[source.key]);
  });
}

function abilityModsFromSystem(system) {
  return Object.fromEntries(
    ABILITIES.map((ability) => {
      const mod = Number(system?.abilities?.[ability.key]?.mod);
      return [ability.key, Number.isFinite(mod) ? Math.trunc(mod) : 0];
    }),
  );
}

function countFreeSelections(source, selected, fixed) {
  const freeSlots = source.boosts.filter((slot) => slot.length > 1);
  return (Array.isArray(selected) ? selected : []).filter(
    (ability) => !fixed.includes(ability) && freeSlots.some((slot) => slot.includes(ability)),
  ).length;
}

export default function AttributeBuilderModal({
  system,
  onSave,
  onClose,
}) {
  const details = system?.details || {};
  const level = Math.max(1, Number(details.level?.value) || 1);
  const [sources, setSources] = useState(() => {
    const initial = {};
    for (const source of BUILD_SOURCES) {
      initial[source.key] = sourceFromDetails(details[source.key]);
    }
    return initial;
  });
  const [loading, setLoading] = useState(() => needsSourceFetch(details));
  const [build, setBuild] = useState(() => normalizeAbilityBuild(system?.build));
  const [manual, setManual] = useState(Boolean(system?.build?.manual));
  const [manualValues, setManualValues] = useState(() => abilityModsFromSystem(system));
  const initializedRef = useRef(false);

  const ancestryId = details.ancestry?.id || "";
  const backgroundId = details.background?.id || "";
  const classId = details.class?.id || "";

  // Full compendium documents carry the boost/flaw slots. Legacy actors only
  // have id/name on `system.details`, so fetch the missing documents once.
  useEffect(() => {
    let cancelled = false;
    const missing = BUILD_SOURCES.filter((source) => {
      const id =
        source.key === "ancestry" ? ancestryId : source.key === "background" ? backgroundId : classId;
      if (!id) {
        return false;
      }
      const current = sources[source.key];
      if (!current) {
        return true;
      }
      const parsed = readAbilitySource(current);
      return parsed.boosts.length === 0 && parsed.keyAbility.length === 0;
    });

    if (missing.length === 0) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    Promise.all(
      missing.map(async (source) => {
        const id =
          source.key === "ancestry"
            ? ancestryId
            : source.key === "background"
              ? backgroundId
              : classId;
        try {
          const document = await fetchCompendiumDocument(source.category, id);
          return [source.key, document];
        } catch (error) {
          return [source.key, null];
        }
      }),
    ).then((entries) => {
      if (cancelled) {
        return;
      }
      setSources((current) => {
        const next = { ...current };
        for (const [key, document] of entries) {
          if (document) {
            next[key] = document;
          }
        }
        return next;
      });
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // The ids are the only inputs that should trigger a new network lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ancestryId, backgroundId, classId]);

  // First usable render: reuse the saved grid when present, otherwise
  // reconstruct a plausible distribution from the current modifiers.
  useEffect(() => {
    if (loading || initializedRef.current) {
      return;
    }
    initializedRef.current = true;
    const saved = normalizeAbilityBuild(system?.build);
    // Step 5.6: builds saved by the old auto-distributing builder have no
    // `version` marker. Re-open them on the empty grid instead of reviving the
    // pre-spent free boosts; builds applied by this version (version >= 2) keep
    // the player's explicit choices.
    const savedIsAuthoritative = saved.version >= 2;
    const hasSavedGrid =
      Boolean(system?.build?.manual) ||
      (savedIsAuthoritative &&
        (saved.boosts.ancestry.length > 0 ||
          saved.boosts.background.length > 0 ||
          Boolean(saved.boosts.class) ||
          ABILITY_BUILDER_LEVELS.some(
            (rowLevel) => saved.boosts.levels[rowLevel].length > 0,
          )));
    const next = hasSavedGrid
      ? sanitizeAbilityBuild(saved, sources, level)
      : defaultAbilityBuild(sources, level);
    setBuild(next);
    setManual(Boolean(system?.build?.manual));
    setManualValues(abilityModsFromSystem(system));
  }, [loading, sources, system, level]);

  const computed = useMemo(
    () => abilityBuildBreakdown(sources, build, level),
    [sources, build, level],
  );

  const displayMods = manual
    ? manualValues
    : Object.fromEntries(
        ABILITY_KEYS.map((ability) => [ability, computed.mods[ability] || 0]),
      );

  const applyBuild = (mutator) => {
    setBuild((current) => {
      const normalized = sanitizeAbilityBuild(current, sources, level);
      const next = mutator(normalized);
      return sanitizeAbilityBuild(next, sources, level);
    });
  };

  const toggleBoost = (sourceKey, ability) => {
    if (manual) {
      return;
    }
    applyBuild((current) => {
      const source = readAbilitySource(sources[sourceKey]);
      const fixed = source.boosts
        .filter((slot) => slot.length === 1)
        .map((slot) => slot[0]);
      const selected = Array.isArray(current.boosts[sourceKey])
        ? current.boosts[sourceKey]
        : [];
      if (fixed.includes(ability)) {
        return current;
      }
      if (selected.includes(ability)) {
        return {
          ...current,
          boosts: {
            ...current.boosts,
            [sourceKey]: selected.filter((entry) => entry !== ability),
          },
        };
      }
      const freeSlots = source.boosts.filter((slot) => slot.length > 1);
      const nextSelection = [
        ...selected.filter((entry) => !fixed.includes(entry)),
        ability,
      ];
      if (!matchSelectionsToSlots(freeSlots, nextSelection).includes(ability)) {
        return current;
      }
      return {
        ...current,
        boosts: {
          ...current.boosts,
          [sourceKey]: [...selected, ability],
        },
      };
    });
  };

  const toggleFlaw = (ability) => {
    if (manual) {
      return;
    }
    applyBuild((current) => {
      const source = readAbilitySource(sources.ancestry);
      const fixedFlaws = source.flaws
        .filter((slot) => slot.length === 1)
        .map((slot) => slot[0]);
      if (fixedFlaws.includes(ability)) {
        return current;
      }
      const selected = Array.isArray(current.flaws.ancestry)
        ? current.flaws.ancestry
        : [];
      if (selected.includes(ability)) {
        return {
          ...current,
          flaws: {
            ...current.flaws,
            ancestry: selected.filter((entry) => entry !== ability),
          },
        };
      }
      const freeSlots = source.flaws.filter((slot) => slot.length > 1);
      const nextSelection = [
        ...selected.filter((entry) => !fixedFlaws.includes(entry)),
        ability,
      ];
      if (!matchSelectionsToSlots(freeSlots, nextSelection).includes(ability)) {
        return current;
      }
      return {
        ...current,
        flaws: { ...current.flaws, ancestry: [...selected, ability] },
      };
    });
  };

  const toggleClassAbility = (ability) => {
    if (manual) {
      return;
    }
    applyBuild((current) => {
      const keyOptions = readAbilitySource(sources.class).keyAbility;
      if (!keyOptions.includes(ability)) {
        return current;
      }
      return {
        ...current,
        boosts: {
          ...current.boosts,
          class: current.boosts.class === ability ? null : ability,
        },
      };
    });
  };

  const toggleLevelBoost = (rowLevel, ability) => {
    if (manual || rowLevel > level) {
      return;
    }
    applyBuild((current) => {
      const row = Array.isArray(current.boosts.levels[rowLevel])
        ? current.boosts.levels[rowLevel]
        : [];
      const nextRow = row.includes(ability)
        ? row.filter((entry) => entry !== ability)
        : row.length >= 4
          ? row
          : [...row, ability];
      return {
        ...current,
        boosts: {
          ...current.boosts,
          levels: { ...current.boosts.levels, [rowLevel]: nextRow },
        },
      };
    });
  };

  const toggleManual = (checked) => {
    setManual(checked);
    if (checked) {
      setManualValues(
        Object.fromEntries(
          ABILITY_KEYS.map((ability) => [ability, computed.mods[ability] || 0]),
        ),
      );
    }
  };

  const commit = () => {
    const normalized = sanitizeAbilityBuild(build, sources, level);
    const abilities = manual
      ? Object.fromEntries(
          ABILITIES.map((ability) => [
            ability.key,
            {
              mod: Math.trunc(
                Math.max(-5, Math.min(15, Number(manualValues[ability.key]) || 0)),
              ),
            },
          ]),
        )
      : abilityBuildBreakdown(sources, normalized, level).abilities;
    onSave({ abilities, build: { ...normalized, manual, version: 2 } });
    onClose();
  };

  const renderSourceRow = (sourceMeta) => {
    const source = readAbilitySource(sources[sourceMeta.key]);
    const selected = Array.isArray(build.boosts[sourceMeta.key])
      ? build.boosts[sourceMeta.key]
      : [];
    const fixed = source.boosts
      .filter((slot) => slot.length === 1)
      .map((slot) => slot[0]);
    const freeSlots = source.boosts.filter((slot) => slot.length > 1);
    const freeSelected = countFreeSelections(source, selected, fixed);
    const selectedFlaws = build.flaws.ancestry || [];
    const fixedFlaws = source.flaws
      .filter((slot) => slot.length === 1)
      .map((slot) => slot[0]);
    const detail = details[sourceMeta.key];
    const sourceName = detail?.name || detail?.value || "не выбрано";
    const hasData =
      source.boosts.length > 0 ||
      source.flaws.length > 0 ||
      source.keyAbility.length > 0;

    if (sourceMeta.key === "class") {
      return (
        <div className="pf2e-builder__row" key={sourceMeta.key}>
          <div className="pf2e-builder__row-label">
            <span className="pf2e-builder__row-icon" aria-hidden="true">
              {sourceMeta.icon}
            </span>
            <span>
              <strong>{sourceMeta.label}</strong>
              <em>{sourceName}</em>
            </span>
            <span className="pf2e-builder__remaining">
              {source.keyAbility.length > 0 ? "ключевой" : "—"}
            </span>
          </div>
          {ABILITIES.map((ability) => {
            const offered = source.keyAbility.includes(ability.key);
            const isSelected = build.boosts.class === ability.key;
            return (
              <div className="pf2e-builder__cell" key={ability.key}>
                {offered ? (
                  <button
                    type="button"
                    className={
                      "pf2e-builder__boost pf2e-builder__boost--key" +
                      (isSelected ? " is-selected" : "")
                    }
                    title={"Ключевой атрибут: " + ability.label}
                    aria-label={"Ключевой атрибут: " + ability.label}
                    aria-pressed={isSelected}
                    disabled={manual}
                    onClick={() => toggleClassAbility(ability.key)}
                  >
                    ◆
                  </button>
                ) : null}
              </div>
            );
          })}
          {!hasData ? (
            <p className="pf2e-builder__missing">Документ класса не загружен.</p>
          ) : null}
        </div>
      );
    }

    return (
      <div className="pf2e-builder__row pf2e-builder__row--double" key={sourceMeta.key}>
        <div className="pf2e-builder__row-label">
          <span className="pf2e-builder__row-icon" aria-hidden="true">
            {sourceMeta.icon}
          </span>
          <span>
            <strong>{sourceMeta.label}</strong>
            <em>{sourceName}</em>
          </span>
          <span className="pf2e-builder__remaining" title="Свободные повышения">
            {freeSlots.length > 0 ? freeSlots.length - freeSelected + "↑" : "—"}
          </span>
        </div>
        {ABILITIES.map((ability) => {
          const offeredBoost = source.boosts.some((slot) => slot.includes(ability.key));
          const isFixed = fixed.includes(ability.key);
          const isBoostSelected = selected.includes(ability.key);
          const offeredFlaw = source.flaws.some((slot) => slot.includes(ability.key));
          const isFixedFlaw = fixedFlaws.includes(ability.key);
          const isFlawSelected = selectedFlaws.includes(ability.key);
          const selectedFree = selected.filter((entry) => !fixed.includes(entry));
          const selectedFreeFlaws = selectedFlaws.filter(
            (entry) => !fixedFlaws.includes(entry),
          );
          const canAddBoost =
            !isBoostSelected &&
            matchSelectionsToSlots(freeSlots, [...selectedFree, ability.key]).includes(
              ability.key,
            );
          const canAddFlaw = matchSelectionsToSlots(
            source.flaws.filter((slot) => slot.length > 1),
            [...selectedFreeFlaws, ability.key],
          ).includes(ability.key);
          const canBoost =
            !manual && offeredBoost && (isFixed || isBoostSelected || canAddBoost);
          const canFlaw =
            !manual && offeredFlaw && (isFixedFlaw || isFlawSelected || canAddFlaw);
          return (
            <div className="pf2e-builder__cell" key={ability.key}>
              {offeredFlaw ? (
                <button
                  type="button"
                  className={
                    "pf2e-builder__flaw" +
                    (isFlawSelected ? " is-selected" : "") +
                    (isFixedFlaw ? " is-fixed" : "")
                  }
                  title={
                    "Недостаток: " + ability.label + (isFixedFlaw ? " (фиксированный)" : "")
                  }
                  aria-label={"Недостаток: " + ability.label}
                  aria-pressed={isFlawSelected}
                  disabled={!canFlaw || isFixedFlaw}
                  onClick={() => toggleFlaw(ability.key)}
                >
                  −
                </button>
              ) : null}
              {offeredBoost ? (
                <button
                  type="button"
                  className={
                    "pf2e-builder__boost" +
                    (isBoostSelected ? " is-selected" : "") +
                    (isFixed ? " is-fixed" : "")
                  }
                  title={
                    "Повышение: " + ability.label + (isFixed ? " (фиксированное)" : "")
                  }
                  aria-label={"Повышение: " + ability.label}
                  aria-pressed={isBoostSelected}
                  disabled={!canBoost || isFixed}
                  onClick={() => toggleBoost(sourceMeta.key, ability.key)}
                >
                  ◆
                </button>
              ) : null}
            </div>
          );
        })}
        {!hasData ? (
          <p className="pf2e-builder__missing">
            Выберите источник на вкладке «Основа» или дождитесь загрузки документа.
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <ModalShell
      title="Построение характеристик"
      icon="💪"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="ui-button" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="ui-button ui-button--primary" onClick={commit}>
            Применить
          </button>
        </>
      }
    >
      <div className={"pf2e-builder" + (manual ? " pf2e-builder--manual" : "")}>
        <div className="pf2e-builder__toolbar">
          <div>
            <strong>Повышения и недостатки</strong>
            <p>
              Сетка повышений основана на выбранных родословной, предыстории и
              классе. На 1, 5, 10, 15 и 20 уровнях доступны четыре свободных
              повышения.
            </p>
          </div>
          <label className="pf2e-builder__manual-toggle">
            <input
              type="checkbox"
              checked={manual}
              onChange={(event) => toggleManual(event.target.checked)}
            />
            Ручной ввод
          </label>
        </div>

        {loading ? (
          <div className="pf2e-builder__loading">Загрузка документов источников…</div>
        ) : null}

        <div className="pf2e-builder__grid">
          <div className="pf2e-builder__head">
            <span className="pf2e-builder__head-label">Источник</span>
            {ABILITIES.map((ability) => (
              <span key={ability.key} title={ability.label}>
                {ability.abbr}
              </span>
            ))}
          </div>

          {BUILD_SOURCES.map((source) => renderSourceRow(source))}

          {ABILITY_BUILDER_LEVELS.map((rowLevel) => {
            const row = build.boosts.levels[rowLevel] || [];
            const locked = rowLevel > level;
            return (
              <div
                className={
                  "pf2e-builder__row" +
                  (locked ? " pf2e-builder__row--locked" : "") +
                  (manual ? " pf2e-builder__row--disabled" : "")
                }
                key={"level-" + rowLevel}
              >
                <div className="pf2e-builder__row-label">
                  <span className="pf2e-builder__row-icon" aria-hidden="true">
                    {locked ? "🔒" : "★"}
                  </span>
                  <span>
                    <strong>{rowLevel} уровень</strong>
                    <em>свободные повышения</em>
                  </span>
                  <span className="pf2e-builder__remaining" title="Осталось повышений">
                    {locked ? "—" : 4 - row.length + "↑"}
                  </span>
                </div>
                {ABILITIES.map((ability) => {
                  const isSelected = row.includes(ability.key);
                  return (
                    <div className="pf2e-builder__cell" key={ability.key}>
                      <button
                        type="button"
                        className={
                          "pf2e-builder__boost" + (isSelected ? " is-selected" : "")
                        }
                        title={
                          locked
                            ? "Доступно с " + rowLevel + " уровня"
                            : "Повышение на " + rowLevel + " уровне: " + ability.label
                        }
                        aria-label={"Повышение на " + rowLevel + " уровне: " + ability.label}
                        aria-pressed={isSelected}
                        disabled={locked || manual || (!isSelected && row.length >= 4)}
                        onClick={() => toggleLevelBoost(rowLevel, ability.key)}
                      >
                        ◆
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}

          <div className="pf2e-builder__summary">
            <div className="pf2e-builder__row-label">
              <span className="pf2e-builder__row-icon" aria-hidden="true">
                Σ
              </span>
              <span>
                <strong>Итоговые модификаторы</strong>
                <em>{manual ? "ручной ввод" : "из сетки повышений"}</em>
              </span>
            </div>
            {ABILITIES.map((ability) => (
              <div className="pf2e-builder__cell" key={ability.key}>
                {manual ? (
                  <input
                    className="pf2e-input pf2e-builder__manual-input"
                    type="number"
                    min="-5"
                    max="15"
                    value={manualValues[ability.key] ?? 0}
                    aria-label={"Модификатор " + ability.label}
                    onChange={(event) =>
                      setManualValues((current) => ({
                        ...current,
                        [ability.key]: event.target.value,
                      }))
                    }
                  />
                ) : (
                  <span className="pf2e-builder__total">
                    {signed(displayMods[ability.key] || 0)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
