import { useState } from "react";

import { useStore } from "./StoreContext.jsx";

/**
 * Left-hand scene controls, modelled after Foundry VTT's toolbar.
 *
 * Column 1 selects a tool category; column 2 lists the tools of that category.
 * The component only owns ephemeral UI toggles (palette, GM vision, darkness
 * level). The selected category/tool live in StoreContext so PixiJS layers can
 * read them later. Every click also emits a `pf2e:toolbar-action` DOM event,
 * which is the hand-off point for canvas-side drawing/wall/light handlers.
 */

const DRAW_COLORS = [
  "#ff6400",
  "#e03131",
  "#f2c94c",
  "#4caf70",
  "#3b9eff",
  "#a855f7",
  "#ffffff",
  "#111111",
];

const DARKNESS_LEVELS = [
  { id: "light", label: "светлая" },
  { id: "dim", label: "тусклая" },
  { id: "dark", label: "тьма" },
];

const DICE_TYPES = [2, 4, 6, 8, 10, 12, 20, 100];
const DICE_COUNTS = [2, 3, 4, 5, 6, 7, 8];

const CATEGORIES = [
  {
    id: "dice",
    icon: "🎲",
    title: "Кубики",
    description:
      "Матрица бросков: выберите тип кубика слева и количество справа.",
    tools: [
      {
        id: "roll",
        icon: "🎲",
        name: "Бросок кубиков",
        description:
          "Клик по типу бросает один кубик, клик по количеству — NdX (2–8).",
      },
    ],
  },
  {
    id: "token",
    icon: "👤",
    title: "Токены",
    description: "Управление токенами: выделение и линейка расстояния.",
    tools: [
      {
        id: "select",
        icon: "🔲",
        name: "Выбор токенов",
        description: "Выделение токена кликом или рамкой.",
      },
      {
        id: "ruler",
        icon: "📐",
        name: "Измерение расстояния",
        description:
          "Линейка замера дистанции по сетке PF2e (правило 5-10-5 футов).",
      },
    ],
  },
  {
    id: "draw",
    icon: "✏️",
    title: "Рисование",
    description: "Рисование на сцене: фигуры, полигоны, текст и палитра.",
    tools: [
      {
        id: "select",
        icon: "🔲",
        name: "Выбор рисунков",
        description: "Выбор готовых объектов рисования.",
      },
      {
        id: "rect",
        icon: "▭",
        name: "Прямоугольник",
        description: "Рисование прямоугольников.",
      },
      {
        id: "ellipse",
        icon: "⬭",
        name: "Окружность",
        description: "Рисование эллипсов и кругов.",
      },
      {
        id: "polygon",
        icon: "⬡",
        name: "Полигон",
        description:
          "ЛКМ+тянуть — начать полигон, клики добавляют вершины, двойной клик завершает.",
      },
      {
        id: "freehand",
        icon: "〰️",
        name: "Свободное рисование",
        description: "Рисование от руки с зажатой ЛКМ.",
      },
      {
        id: "text",
        icon: "🅰️",
        name: "Текст",
        description: "Создание текстовых блоков.",
      },
      {
        id: "color",
        icon: "🎨",
        name: "Палитра",
        description:
          "Выбор цвета обводки и заливки для новых рисунков. Клик открывает палитру.",
        kind: "color",
      },
      {
        id: "clear",
        icon: "🗑️",
        name: "Очистить рисунки",
        description: "Удаление всех рисунков текущей сцены.",
        kind: "action",
      },
    ],
  },
  {
    id: "wall",
    icon: "🧱",
    title: "Стены",
    description:
      "Стены и двери: блокировка движения, зрения и слуха; ландшафтные и секретные стены.",
    tools: [
      {
        id: "select",
        icon: "🔲",
        name: "Выбор стен",
        description: "Выделение и редактирование отрезков стен.",
      },
      {
        id: "normal",
        icon: "☰",
        name: "Обычная стена",
        description: "Блокирует: движение, зрение, слух.",
      },
      {
        id: "terrain",
        icon: "▲",
        name: "Ландшафтная стена",
        description:
          "Блокирует: Зрение после второй стены, движение, слух. Позволяет видеть то, что находится внутри первой стены.",
      },
      {
        id: "invisible",
        icon: "👁️‍🗨️",
        name: "Невидимая стена",
        description:
          "Блокирует только движение, пропускает зрение и слух.",
      },
      {
        id: "ethereal",
        icon: "🎭",
        name: "Бесплотная стена",
        description:
          "Блокирует зрение и слух, но пропускает сквозь себя движение.",
      },
      {
        id: "door",
        icon: "🚪",
        name: "Дверь",
        description:
          "ЛКМ — открыть/закрыть, ПКМ — запереть на замок (блокирует открытие игроками).",
      },
      {
        id: "secret",
        icon: "🕵️",
        name: "Скрытая дверь",
        description:
          "Невидима для игроков. Блокирует движение, зрение и слух; мастер может открыть.",
      },
      {
        id: "clear",
        icon: "🗑️",
        name: "Удалить все стены",
        description: "Полная очистка стен на текущем слое сцены.",
        kind: "action",
      },
    ],
  },
  {
    id: "light",
    icon: "💡",
    title: "Освещение",
    description:
      "Освещение: источники света, уровень тьмы сцены и зрение мастера.",
    tools: [
      {
        id: "select",
        icon: "🔲",
        name: "Выбор источников",
        description: "Выделение источников света.",
      },
      {
        id: "draw",
        icon: "💡",
        name: "Создать источник света",
        description:
          "Размещение источника света. Двойной клик открывает настройку радиусов тусклого и яркого света PF2e.",
      },
      {
        id: "darkness",
        icon: "🌓",
        name: "Темнота сцены",
        description:
          "Переключение глобального уровня освещения сцены: светлая / тусклая / тьма.",
        kind: "cycle",
      },
      {
        id: "gm-vision",
        icon: "💡",
        name: "Зрение мастера",
        description:
          "Переключатель: позволяет мастеру видеть сквозь тьму без источников света.",
        kind: "toggle",
      },
      {
        id: "reset-fog",
        icon: "☁️",
        name: "Сброс тумана войны",
        description: "Сброс исследованных областей тумана войны (заглушка).",
        kind: "action",
      },
      {
        id: "clear",
        icon: "🗑️",
        name: "Удалить свет",
        description: "Удаление всех источников света на сцене.",
        kind: "action",
      },
    ],
  },
];

function emitToolbarAction(detail) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent("pf2e:toolbar-action", { detail }),
  );
}

function categoryById(categoryId) {
  return CATEGORIES.find((category) => category.id === categoryId) || null;
}

export default function Toolbar() {
  const {
    networkClient,
    activeTool,
    activeSubTool,
    setActiveTool,
    setActiveSubTool,
  } = useStore();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[0]);
  const [gmVision, setGmVision] = useState(false);
  const [darknessIndex, setDarknessIndex] = useState(0);
  const [doorLocked, setDoorLocked] = useState(false);
  const [status, setStatus] = useState("");

  const activeCategory = categoryById(activeTool) || CATEGORIES[0];
  const darkness = DARKNESS_LEVELS[darknessIndex];

  const handleCategoryClick = (category) => {
    if (activeTool !== category.id) {
      setActiveTool(category.id);
      setActiveSubTool(category.tools[0].id);
      setPaletteOpen(false);
    }
    setStatus(category.title + ": выберите инструмент справа");
  };

  const handleDiceRoll = (sides, count) => {
    const formula = String(count || 1) + "d" + String(sides);
    if (!networkClient) {
      setStatus("Нет соединения: бросок " + formula + " не отправлен");
      return;
    }
    networkClient
      .sendChatMessage({ text: "/r " + formula, visibility: "public" })
      .catch(() => setStatus("Не удалось отправить бросок " + formula));
    setStatus("Бросок " + formula + " отправлен в чат");
    emitToolbarAction({
      category: "dice",
      tool: "roll",
      formula: formula,
      count: count || 1,
      sides: sides,
    });
  };

  const handleToolClick = (category, tool) => {
    setActiveTool(category.id);
    setActiveSubTool(tool.id);
    setPaletteOpen(
      category.id === "draw" && tool.id === "color"
        ? (open) => !open
        : false,
    );

    let detail = {
      category: category.id,
      tool: tool.id,
    };

    if (category.id === "draw" && tool.id === "clear") {
      setStatus("Все рисунки сцены удалены (слой рисования подключается позже)");
    } else if (category.id === "wall" && tool.id === "clear") {
      setStatus("Все стены текущего слоя удалены (слой стен подключается позже)");
    } else if (category.id === "light" && tool.id === "clear") {
      setStatus("Все источники света удалены (слой света подключается позже)");
    } else if (category.id === "light" && tool.id === "reset-fog") {
      setStatus("Туман войны сброшен (заглушка)");
    } else if (category.id === "light" && tool.id === "gm-vision") {
      const next = !gmVision;
      setGmVision(next);
      detail = { ...detail, enabled: next };
      setStatus("Зрение мастера: " + (next ? "включено" : "выключено"));
    } else if (category.id === "light" && tool.id === "darkness") {
      const nextIndex = (darknessIndex + 1) % DARKNESS_LEVELS.length;
      const next = DARKNESS_LEVELS[nextIndex];
      setDarknessIndex(nextIndex);
      detail = { ...detail, level: next.id };
      setStatus("Освещение сцены: " + next.label);
    } else if (category.id === "draw" && tool.id === "color") {
      setStatus("Палитра: выбран цвет " + drawColor);
    } else if (category.id === "wall" && tool.id === "door") {
      setStatus(
        doorLocked
          ? "Дверь заперта: игроки не могут открыть её (ПКМ — снять замок)"
          : "Дверь: ЛКМ — открыть/закрыть, ПКМ — запереть на замок",
      );
    } else {
      setStatus(tool.name);
    }

    emitToolbarAction(detail);
  };

  const handleToolContextMenu = (event, category, tool) => {
    if (category.id !== "wall" || tool.id !== "door") {
      return;
    }
    event.preventDefault();
    const next = !doorLocked;
    setDoorLocked(next);
    setStatus(
      next
        ? "Дверь заперта на замок: игроки не смогут открыть её"
        : "Замок двери снят: игроки снова могут открывать дверь",
    );
    emitToolbarAction({
      category: category.id,
      tool: tool.id,
      locked: next,
    });
  };

  const handleSwatchClick = (color) => {
    setDrawColor(color);
    setStatus("Цвет рисунков: " + color);
    emitToolbarAction({ category: "draw", tool: "color", color });
  };

  const isToolActive = (category, tool) => {
    if (tool.kind === "toggle") {
      return gmVision;
    }
    if (tool.kind === "cycle") {
      return darkness.id !== "light";
    }
    if (tool.kind === "color") {
      return paletteOpen;
    }
    if (tool.kind === "action") {
      return false;
    }
    return activeTool === category.id && activeSubTool === tool.id;
  };

  const tooltipFor = (category, tool) => {
    if (category.id === "light" && tool.id === "gm-vision") {
      return (
        tool.name +
        " (" +
        (gmVision ? "включено" : "выключено") +
        ") — " +
        tool.description
      );
    }
    if (category.id === "light" && tool.id === "darkness") {
      return (
        tool.name +
        " — " +
        tool.description +
        " Сейчас: " +
        darkness.label +
        "."
      );
    }
    if (category.id === "wall" && tool.id === "door") {
      return tool.name + " — " + tool.description;
    }
    return tool.name + " — " + tool.description;
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="Панель инструментов">
      <div className="toolbar__columns">
        <div className="toolbar__column toolbar__column--categories">
          {CATEGORIES.map((category) => (
            <button
              key={category.id}
              type="button"
              className={
                "toolbar__button toolbar__button--category" +
                (category.id === activeTool ? " toolbar__button--active" : "")
              }
              title={category.title + " — " + category.description}
              aria-label={category.title}
              aria-pressed={category.id === activeTool}
              data-category={category.id}
              onClick={() => handleCategoryClick(category)}
            >
              <span aria-hidden="true">{category.icon}</span>
            </button>
          ))}
        </div>

        <div className="toolbar__column toolbar__column--tools">
          {activeCategory.id === "dice" ? (
            <div
              className="dice-matrix"
              role="group"
              aria-label="Матрица бросков кубиков"
            >
              <div className="dice-matrix__caption">
                <span>Тип</span>
                <span>Количество</span>
              </div>
              {DICE_TYPES.map((sides) => (
                <div className="dice-matrix__row" key={sides}>
                  <button
                    type="button"
                    className="dice-matrix__type"
                    title={"Бросить 1d" + sides}
                    aria-label={"Бросить 1d" + sides}
                    onClick={() => handleDiceRoll(sides, 1)}
                  >
                    d{sides}
                  </button>
                  <div className="dice-matrix__counts">
                    {DICE_COUNTS.map((count) => (
                      <button
                        key={count}
                        type="button"
                        className="dice-matrix__count"
                        title={"Бросить " + count + "d" + sides}
                        aria-label={"Бросить " + count + "d" + sides}
                        onClick={() => handleDiceRoll(sides, count)}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            activeCategory.tools.map((tool) => (
              <button
                key={tool.id}
                type="button"
                className={
                  "toolbar__button toolbar__button--tool" +
                  (isToolActive(activeCategory, tool)
                    ? " toolbar__button--active"
                    : "")
                }
                title={tooltipFor(activeCategory, tool)}
                aria-label={tool.name}
                aria-pressed={isToolActive(activeCategory, tool)}
                data-tool={tool.id}
                onClick={() => handleToolClick(activeCategory, tool)}
                onContextMenu={(event) =>
                  handleToolContextMenu(event, activeCategory, tool)
                }
              >
                <span aria-hidden="true">{tool.icon}</span>
                {activeCategory.id === "draw" && tool.id === "color" ? (
                  <span
                    className="toolbar__color-indicator"
                    style={{ backgroundColor: drawColor }}
                  />
                ) : null}
              </button>
            ))
          )}

          {activeCategory.id === "draw" && paletteOpen ? (
            <div className="toolbar__palette" role="group" aria-label="Цвет рисунков">
              {DRAW_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={
                    "toolbar__swatch" +
                    (color === drawColor ? " toolbar__swatch--active" : "")
                  }
                  style={{ backgroundColor: color }}
                  title={"Цвет обводки/заливки: " + color}
                  aria-label={"Выбрать цвет " + color}
                  onClick={() => handleSwatchClick(color)}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {status ? (
        <div className="toolbar__status" role="status" aria-live="polite">
          {status}
        </div>
      ) : null}
    </div>
  );
}
