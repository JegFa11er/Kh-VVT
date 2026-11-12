import { useEffect, useMemo, useState } from "react";

import { formatMessage, useTranslation } from "./i18n.js";
import { useStore } from "./StoreContext.jsx";

/**
 * Left-hand scene controls, modelled after Foundry VTT's toolbar.
 *
 * Column 1 selects a tool category; column 2 lists the tools of that category.
 * The component only owns ephemeral UI toggles (palette, GM vision, darkness
 * level). The selected category/tool live in StoreContext so PixiJS layers can
 * read them later. Every click also emits a `pf2e:toolbar-action` DOM event,
 * which is the hand-off point for canvas-side drawing/wall/light handlers.
 *
 * Step 6.8: every visible label, tooltip, aria-label and status line goes
 * through `t()` and the local platform dictionary, so EN mode translates the
 * whole scene-controls chrome.
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
  {
    id: "light",
    labelKey: "PF2E.Platform.Toolbar.Darkness.Light",
    labelFallback: "bright",
  },
  {
    id: "dim",
    labelKey: "PF2E.Platform.Toolbar.Darkness.Dim",
    labelFallback: "dim",
  },
  {
    id: "dark",
    labelKey: "PF2E.Platform.Toolbar.Darkness.Dark",
    labelFallback: "dark",
  },
];

const DICE_TYPES = [2, 4, 6, 8, 10, 12, 20, 100];
const DICE_COUNTS = [2, 3, 4, 5, 6, 7, 8];

const CATEGORIES = [
  {
    id: "token",
    icon: "👤",
    titleKey: "PF2E.Platform.Toolbar.Category.Token",
    titleFallback: "Tokens",
    descriptionKey: "PF2E.Platform.Toolbar.Category.TokenDesc",
    descriptionFallback: "Token controls: selection and distance measurement.",
    tools: [
      {
        id: "select",
        icon: "🔲",
        nameKey: "PF2E.Platform.Toolbar.Tool.SelectTokens",
        nameFallback: "Select Tokens",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.SelectTokensDesc",
        descriptionFallback: "Select a token with a click or a selection box.",
      },
      {
        id: "ruler",
        icon: "📐",
        nameKey: "PF2E.Platform.Toolbar.Tool.Ruler",
        nameFallback: "Measure Distance",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.RulerDesc",
        descriptionFallback:
          "Measure distance on the PF2e grid (5-10-5 feet rule).",
      },
    ],
  },
  {
    id: "draw",
    icon: "✏️",
    titleKey: "PF2E.Platform.Toolbar.Category.Draw",
    titleFallback: "Drawing",
    descriptionKey: "PF2E.Platform.Toolbar.Category.DrawDesc",
    descriptionFallback:
      "Draw on the scene: shapes, polygons, text and palette.",
    tools: [
      {
        id: "select",
        icon: "🔲",
        nameKey: "PF2E.Platform.Toolbar.Tool.SelectDrawings",
        nameFallback: "Select Drawings",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.SelectDrawingsDesc",
        descriptionFallback: "Select existing drawing objects.",
      },
      {
        id: "rect",
        icon: "▭",
        nameKey: "PF2E.Platform.Toolbar.Tool.Rect",
        nameFallback: "Rectangle",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.RectDesc",
        descriptionFallback: "Draw rectangles.",
      },
      {
        id: "ellipse",
        icon: "⬭",
        nameKey: "PF2E.Platform.Toolbar.Tool.Ellipse",
        nameFallback: "Ellipse",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.EllipseDesc",
        descriptionFallback: "Draw ellipses and circles.",
      },
      {
        id: "polygon",
        icon: "⬡",
        nameKey: "PF2E.Platform.Toolbar.Tool.Polygon",
        nameFallback: "Polygon",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.PolygonDesc",
        descriptionFallback:
          "Drag with the left button to start a polygon, click to add vertices, double-click to finish.",
      },
      {
        id: "freehand",
        icon: "〰️",
        nameKey: "PF2E.Platform.Toolbar.Tool.Freehand",
        nameFallback: "Freehand",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.FreehandDesc",
        descriptionFallback:
          "Draw by hand while holding the left mouse button.",
      },
      {
        id: "text",
        icon: "🅰️",
        nameKey: "PF2E.Platform.Toolbar.Tool.Text",
        nameFallback: "Text",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.TextDesc",
        descriptionFallback: "Create text blocks.",
      },
      {
        id: "color",
        icon: "🎨",
        nameKey: "PF2E.Platform.Toolbar.Tool.Palette",
        nameFallback: "Palette",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.PaletteDesc",
        descriptionFallback:
          "Choose stroke and fill colors for new drawings. Click to open the palette.",
        kind: "color",
      },
      {
        id: "clear",
        icon: "🗑️",
        nameKey: "PF2E.Platform.Toolbar.Tool.ClearDrawings",
        nameFallback: "Clear Drawings",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.ClearDrawingsDesc",
        descriptionFallback: "Delete all drawings on the current scene.",
        kind: "action",
      },
    ],
  },
  {
    id: "wall",
    icon: "🧱",
    titleKey: "PF2E.Platform.Toolbar.Category.Wall",
    titleFallback: "Walls",
    descriptionKey: "PF2E.Platform.Toolbar.Category.WallDesc",
    descriptionFallback:
      "Walls and doors: block movement, sight and sound; terrain and secret walls.",
    tools: [
      {
        id: "select",
        icon: "🔲",
        nameKey: "PF2E.Platform.Toolbar.Tool.SelectWalls",
        nameFallback: "Select Walls",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.SelectWallsDesc",
        descriptionFallback: "Select and edit wall segments.",
      },
      {
        id: "normal",
        icon: "☰",
        nameKey: "PF2E.Platform.Toolbar.Tool.NormalWall",
        nameFallback: "Normal Wall",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.NormalWallDesc",
        descriptionFallback: "Blocks: movement, sight, sound.",
      },
      {
        id: "terrain",
        icon: "▲",
        nameKey: "PF2E.Platform.Toolbar.Tool.TerrainWall",
        nameFallback: "Terrain Wall",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.TerrainWallDesc",
        descriptionFallback:
          "Blocks: sight after the second wall, movement, sound. Lets you see what lies inside the first wall.",
      },
      {
        id: "invisible",
        icon: "👁️‍🗨️",
        nameKey: "PF2E.Platform.Toolbar.Tool.InvisibleWall",
        nameFallback: "Invisible Wall",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.InvisibleWallDesc",
        descriptionFallback:
          "Blocks movement only; sight and sound pass through.",
      },
      {
        id: "ethereal",
        icon: "🎭",
        nameKey: "PF2E.Platform.Toolbar.Tool.EtherealWall",
        nameFallback: "Ethereal Wall",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.EtherealWallDesc",
        descriptionFallback:
          "Blocks sight and sound but lets movement pass through.",
      },
      {
        id: "door",
        icon: "🚪",
        nameKey: "PF2E.Platform.Toolbar.Tool.Door",
        nameFallback: "Door",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.DoorDesc",
        descriptionFallback:
          "Left-click to open/close, right-click to lock (blocks players from opening).",
      },
      {
        id: "secret",
        icon: "🕵️",
        nameKey: "PF2E.Platform.Toolbar.Tool.SecretDoor",
        nameFallback: "Secret Door",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.SecretDoorDesc",
        descriptionFallback:
          "Invisible to players. Blocks movement, sight and sound; the GM can open it.",
      },
      {
        id: "clear",
        icon: "🗑️",
        nameKey: "PF2E.Platform.Toolbar.Tool.ClearWalls",
        nameFallback: "Delete All Walls",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.ClearWallsDesc",
        descriptionFallback: "Remove every wall on the current scene layer.",
        kind: "action",
      },
    ],
  },
  {
    id: "light",
    icon: "💡",
    titleKey: "PF2E.Platform.Toolbar.Category.Light",
    titleFallback: "Lighting",
    descriptionKey: "PF2E.Platform.Toolbar.Category.LightDesc",
    descriptionFallback:
      "Lighting: light sources, scene darkness and GM vision.",
    tools: [
      {
        id: "select",
        icon: "🔲",
        nameKey: "PF2E.Platform.Toolbar.Tool.SelectLights",
        nameFallback: "Select Lights",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.SelectLightsDesc",
        descriptionFallback: "Select light sources.",
      },
      {
        id: "draw",
        icon: "💡",
        nameKey: "PF2E.Platform.Toolbar.Tool.CreateLight",
        nameFallback: "Create Light",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.CreateLightDesc",
        descriptionFallback:
          "Place a light source. Double-click to configure PF2e dim and bright light radii.",
      },
      {
        id: "darkness",
        icon: "🌓",
        nameKey: "PF2E.Platform.Toolbar.Tool.SceneDarkness",
        nameFallback: "Scene Darkness",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.SceneDarknessDesc",
        descriptionFallback:
          "Cycle the scene's global lighting: bright / dim / dark.",
        kind: "cycle",
      },
      {
        id: "gm-vision",
        icon: "💡",
        nameKey: "PF2E.Platform.Toolbar.GmVision",
        nameFallback: "GM Vision",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.GmVisionDesc",
        descriptionFallback:
          "The GM without a selected token sees the whole map automatically. This toggle also reveals every token outside the selected character's line of sight.",
        kind: "toggle",
      },
      {
        id: "reset-fog",
        icon: "☁️",
        nameKey: "PF2E.Platform.Toolbar.Tool.ResetFog",
        nameFallback: "Reset Fog of War",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.ResetFogDesc",
        descriptionFallback:
          "Completely clears explored fog-of-war areas on the current scene and synchronizes the reset with every participant.",
        kind: "action",
      },
      {
        id: "clear",
        icon: "🗑️",
        nameKey: "PF2E.Platform.Toolbar.Tool.DeleteLights",
        nameFallback: "Delete Lights",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.DeleteLightsDesc",
        descriptionFallback: "Delete every light source on the scene.",
        kind: "action",
      },
    ],
  },
  {
    id: "dice",
    icon: "🎲",
    titleKey: "PF2E.Platform.Toolbar.Category.Dice",
    titleFallback: "Dice",
    descriptionKey: "PF2E.Platform.Toolbar.Category.DiceDesc",
    descriptionFallback:
      "Dice matrix: choose a die type on the left and a count on the right.",
    tools: [
      {
        id: "roll",
        icon: "🎲",
        nameKey: "PF2E.Platform.Toolbar.Tool.RollDice",
        nameFallback: "Roll Dice",
        descriptionKey: "PF2E.Platform.Toolbar.Tool.RollDiceDesc",
        descriptionFallback:
          "Click a die type to roll one die, click a count to roll NdX (2–8).",
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

/** Resolve every category/tool label through the active interface language. */
function localizeCategory(category, t) {
  return {
    ...category,
    title: t(category.titleKey, category.titleFallback),
    description: t(category.descriptionKey, category.descriptionFallback),
    tools: category.tools.map((tool) => ({
      ...tool,
      name: t(tool.nameKey, tool.nameFallback),
      description: t(tool.descriptionKey, tool.descriptionFallback),
    })),
  };
}

export default function Toolbar() {
  const {
    networkClient,
    activeTool,
    activeSubTool,
    setActiveTool,
    setActiveSubTool,
  } = useStore();
  const { t, language } = useTranslation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[0]);
  const [gmVision, setGmVision] = useState(false);
  const [darknessIndex, setDarknessIndex] = useState(0);
  const [doorLocked, setDoorLocked] = useState(false);
  const [status, setStatus] = useState("");

  // Step 6.8: rebuild the labels when RU/EN changes. `t` reads the global
  // language at call time, so `language` is the only changing dependency.
  const categories = useMemo(
    () => CATEGORIES.map((category) => localizeCategory(category, t)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language],
  );

  const activeCategory =
    categories.find((category) => category.id === activeTool) || null;
  const darkness = {
    ...DARKNESS_LEVELS[darknessIndex],
    label: t(
      DARKNESS_LEVELS[darknessIndex].labelKey,
      DARKNESS_LEVELS[darknessIndex].labelFallback,
    ),
  };

  const tr = (key, fallback, values) =>
    formatMessage(t(key, fallback), values);

  // Let the PixiJS camera/interaction layers react to scene-control changes.
  // This is a global DOM event so canvas modules do not need React context.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.dispatchEvent(
      new CustomEvent("pf2e:tool-change", {
        detail: { category: activeTool, tool: activeSubTool },
      }),
    );
  }, [activeTool, activeSubTool]);

  const handleCategoryClick = (category) => {
    // Clicking the already-active category collapses the second column so it
    // stops covering the map. Clicking it again re-opens the tool list.
    if (activeTool === category.id) {
      setActiveTool(null);
      setActiveSubTool(null);
      setPaletteOpen(false);
      setStatus(
        category.title +
          ": " +
          t("PF2E.Platform.Toolbar.Collapsed", "toolbar collapsed"),
      );
      return;
    }

    setActiveTool(category.id);
    setActiveSubTool(category.tools[0].id);
    setPaletteOpen(false);
    setStatus(
      category.title +
        ": " +
        t("PF2E.Platform.Toolbar.ChooseTool", "choose a tool on the right"),
    );
  };

  const handleDiceRoll = (sides, count) => {
    const formula = String(count || 1) + "d" + String(sides);
    if (!networkClient) {
      setStatus(
        tr(
          "PF2E.Platform.Toolbar.NoConnectionRoll",
          "No connection: roll {formula} was not sent",
          { formula },
        ),
      );
      return;
    }
    networkClient
      .sendChatMessage({ text: "/r " + formula, visibility: "public" })
      .catch(() =>
        setStatus(
          tr(
            "PF2E.Platform.Toolbar.RollFailed",
            "Failed to send roll {formula}",
            { formula },
          ),
        ),
      );
    setStatus(
      tr("PF2E.Platform.Toolbar.RollSent", "Roll {formula} sent to chat", {
        formula,
      }),
    );
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
      setStatus(
        t(
          "PF2E.Platform.Toolbar.ClearDrawingsConfirm",
          "Clear drawings: confirm the action in the dialog",
        ),
      );
    } else if (category.id === "wall" && tool.id === "clear") {
      setStatus(
        t(
          "PF2E.Platform.Toolbar.ClearWallsConfirm",
          "Clear walls: confirm the action in the dialog",
        ),
      );
    } else if (category.id === "light" && tool.id === "clear") {
      setStatus(
        t(
          "PF2E.Platform.Toolbar.ClearLightsConfirm",
          "Clear lights: confirm the action in the dialog",
        ),
      );
    } else if (category.id === "light" && tool.id === "reset-fog") {
      setStatus(
        t(
          "PF2E.Platform.Toolbar.FogReset",
          "Fog of war reset: the map is fully black again",
        ),
      );
    } else if (category.id === "light" && tool.id === "gm-vision") {
      const next = !gmVision;
      setGmVision(next);
      detail = { ...detail, enabled: next };
      setStatus(
        t("PF2E.Platform.Toolbar.GmVision", "GM Vision") +
          ": " +
          t(
            next
              ? "PF2E.Platform.Toolbar.Enabled"
              : "PF2E.Platform.Toolbar.Disabled",
            next ? "enabled" : "disabled",
          ),
      );
    } else if (category.id === "light" && tool.id === "darkness") {
      const nextIndex = (darknessIndex + 1) % DARKNESS_LEVELS.length;
      const next = DARKNESS_LEVELS[nextIndex];
      const nextLabel = t(next.labelKey, next.labelFallback);
      setDarknessIndex(nextIndex);
      detail = { ...detail, level: next.id };
      setStatus(
        tr(
          "PF2E.Platform.Toolbar.SceneLighting",
          "Scene lighting: {label}",
          { label: nextLabel },
        ),
      );
    } else if (category.id === "draw" && tool.id === "color") {
      setStatus(
        tr(
          "PF2E.Platform.Toolbar.PaletteColor",
          "Palette: selected color {color}",
          { color: drawColor },
        ),
      );
    } else if (category.id === "wall" && tool.id === "door") {
      setStatus(
        doorLocked
          ? t(
              "PF2E.Platform.Toolbar.DoorLockedHint",
              "Door locked: players cannot open it (right-click to unlock)",
            )
          : t(
              "PF2E.Platform.Toolbar.DoorHint",
              "Door: left-click to open/close, right-click to lock",
            ),
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
        ? t(
            "PF2E.Platform.Toolbar.DoorLocked",
            "Door locked: players cannot open it",
          )
        : t(
            "PF2E.Platform.Toolbar.DoorUnlocked",
            "Door unlocked: players can open it again",
          ),
    );
    emitToolbarAction({
      category: category.id,
      tool: tool.id,
      locked: next,
    });
  };

  const handleSwatchClick = (color) => {
    setDrawColor(color);
    setStatus(
      tr("PF2E.Platform.Toolbar.DrawingColor", "Drawing color: {color}", {
        color,
      }),
    );
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
        t(
          gmVision
            ? "PF2E.Platform.Toolbar.Enabled"
            : "PF2E.Platform.Toolbar.Disabled",
          gmVision ? "enabled" : "disabled",
        ) +
        ") — " +
        tool.description
      );
    }
    if (category.id === "light" && tool.id === "darkness") {
      return (
        tool.name +
        " — " +
        tool.description +
        " " +
        t("PF2E.Platform.Toolbar.Currently", "Currently") +
        ": " +
        darkness.label +
        "."
      );
    }
    return tool.name + " — " + tool.description;
  };

  return (
    <div
      className="toolbar"
      role="toolbar"
      aria-label={t("PF2E.Platform.Toolbar.Aria", "Toolbar")}
    >
      <div className="toolbar__columns">
        <div className="toolbar__column toolbar__column--categories">
          {categories.map((category) => (
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

        {activeCategory ? (
          <div className="toolbar__column toolbar__column--tools">
            {activeCategory.id === "dice" ? (
              <div
                className="dice-matrix"
                role="group"
                aria-label={t(
                  "PF2E.Platform.Toolbar.DiceMatrix",
                  "Dice roll matrix",
                )}
              >
                <div className="dice-matrix__caption">
                  <span>{t("PF2E.Platform.Toolbar.Type", "Type")}</span>
                  <span>{t("PF2E.Platform.Toolbar.Count", "Count")}</span>
                </div>
                {DICE_TYPES.map((sides) => (
                  <div className="dice-matrix__row" key={sides}>
                    <button
                      type="button"
                      className="dice-matrix__type"
                      title={tr(
                        "PF2E.Platform.Toolbar.RollOne",
                        "Roll 1d{sides}",
                        { sides },
                      )}
                      aria-label={tr(
                        "PF2E.Platform.Toolbar.RollOne",
                        "Roll 1d{sides}",
                        { sides },
                      )}
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
                          title={tr(
                            "PF2E.Platform.Toolbar.RollMany",
                            "Roll {count}d{sides}",
                            { count, sides },
                          )}
                          aria-label={tr(
                            "PF2E.Platform.Toolbar.RollMany",
                            "Roll {count}d{sides}",
                            { count, sides },
                          )}
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
              <div
                className="toolbar__palette"
                role="group"
                aria-label={t(
                  "PF2E.Platform.Toolbar.DrawingColors",
                  "Drawing colors",
                )}
              >
                {DRAW_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={
                      "toolbar__swatch" +
                      (color === drawColor ? " toolbar__swatch--active" : "")
                    }
                    style={{ backgroundColor: color }}
                    title={tr(
                      "PF2E.Platform.Toolbar.SwatchTitle",
                      "Stroke/fill color: {color}",
                      { color },
                    )}
                    aria-label={tr(
                      "PF2E.Platform.Toolbar.ChooseColor",
                      "Choose color {color}",
                      { color },
                    )}
                    onClick={() => handleSwatchClick(color)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {status ? (
        <div className="toolbar__status" role="status" aria-live="polite">
          {status}
        </div>
      ) : null}
    </div>
  );
}
