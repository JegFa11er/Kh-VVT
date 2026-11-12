import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Application } from "pixi.js";

import { NetworkClient } from "./net/network-client.js";
import { Viewport } from "./canvas/viewport.js";
import { BackgroundLayer, normalizeBackgroundColor } from "./canvas/background-layer.js";
import { GridLayer } from "./canvas/grid-layer.js";
import { TokenLayer } from "./canvas/token-layer.js";
import { InteractionLayer } from "./canvas/interaction.js";
import { RulerLayer } from "./canvas/ruler-layer.js";
import { DrawLayer } from "./canvas/draw-layer.js";
import { WallLayer } from "./canvas/wall-layer.js";
import { LightLayer } from "./canvas/light-layer.js";
import { VisionLayer } from "./canvas/vision-layer.js";
import { FogLayer } from "./canvas/fog-layer.js";
import { ChatBubbleLayer } from "./canvas/chat-bubble-layer.js";
import { GRID_SIZE, createGrid } from "./canvas/grid.js";
import { StoreProvider } from "./ui/StoreContext.jsx";
import App from "./ui/App.jsx";
import StartScreen from "./ui/StartScreen.jsx";
import {
  readStoredLanguage,
  setLanguage as setI18nLanguage,
} from "./ui/i18n.js";
import {
  ACTOR_TOKEN_PAYLOAD_TYPE,
  readDragPayload,
} from "./ui/drag-payloads.js";
import "./ui/styles.css";

const params = new URLSearchParams(window.location.search);
// The URL role is only a convenience hint for the lobby form. The authoritative
// identity comes from the chosen profile (`profile.role`), which the server
// validates again when the WebSocket joins.
const urlRole = params.get("role") === "gm" ? "gm" : "player";
const sessionId = params.get("session") || "default";
const preferredUserId = params.get("player") || null;
const statusEl = document.getElementById("status");

// Step 6.6: apply the persisted RU/EN choice before the lobby/React tree mounts.
// This keeps the global language (UI + Compendium Browser) stable across reloads
// and prevents the initial render from briefly using the default dictionary.
setI18nLanguage(readStoredLanguage());

/**
 * Phase 6.2: the PixiJS canvas and the main game socket are created only after
 * the player picks a lobby profile.
 */
async function startGame(profile) {
  const role =
    profile && profile.role === "gm"
      ? "gm"
      : profile && profile.role === "player"
        ? "player"
        : urlRole;
  const name =
    profile && typeof profile.name === "string" && profile.name.trim() !== ""
      ? profile.name.trim()
      : role === "gm"
        ? "Game Master"
        : "Player";
  const playerId =
    profile && typeof profile.id === "string" && profile.id !== ""
      ? profile.id
      : role === "gm"
        ? "gm-1"
        : "player-" + Math.random().toString(36).slice(2, 8);

  const app = new Application();

  await app.init({
    background: "#12151c",
    antialias: true,
    resizeTo: window,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });

  document.getElementById("app").appendChild(app.canvas);

  const viewport = new Viewport(app).mount();

  let cellSize = GRID_SIZE;
  let gridCols = 24;
  let gridRows = 16;
  let grid = createGrid({ gridSize: cellSize });
  const backgroundLayer = new BackgroundLayer({
    gridSize: cellSize,
    cols: gridCols,
    rows: gridRows,
    backgroundColor: "#12151c",
  });
  const gridLayer = new GridLayer({ cols: gridCols, rows: gridRows, cellSize });
  const drawLayer = new DrawLayer(app, viewport, grid);
  const wallLayer = new WallLayer(app, viewport, grid);
  const tokenLayer = new TokenLayer({ cellSize });
  const lightLayer = new LightLayer(app, viewport, grid, {
    wallLayer: wallLayer,
  });
  const visionLayer = new VisionLayer(app, viewport, grid, {
    tokenLayer: tokenLayer,
    wallLayer: wallLayer,
    lightLayer: lightLayer,
    viewerRole: role,
  });
  const fogLayer = new FogLayer(app, viewport, grid, {
    width: gridLayer.cols * cellSize,
    height: gridLayer.rows * cellSize,
  });
  const rulerLayer = new RulerLayer(app, viewport, grid);

  // Scene stacking: map < drawings < walls < tokens < light/darkness < vision
  // < fog of war < ruler. Fog sits above tokens so explored ground stays dim
  // even while a foreign token is hidden by `TokenLayer.applyVisionState`.
  viewport.world.addChild(
    backgroundLayer,
    gridLayer,
    drawLayer,
    wallLayer,
    tokenLayer,
    lightLayer,
    visionLayer,
    fogLayer,
    rulerLayer,
  );
  // Step 5.8.1: floating HP numbers must never be hidden by fog/light, so the
  // token layer's detached text overlay is reparented above the scene stack.
  viewport.world.addChild(tokenLayer.floatingTextLayer);

  // Step 5.3: the vision raycast feeds both the persistent exploration texture
  // and the "currently visible" fog mask.
  visionLayer.setFogLayer(fogLayer);
  tokenLayer.setFogEnabled(true);
  tokenLayer.setGMViewer(role === "gm");

  // Rebuild the selected token's line-of-sight whenever the selection changes.
  tokenLayer.onSelectionChange = () => visionLayer.refresh();

  // Routes pointer gestures to the active tool layer; owns no visuals.
  const interactionLayer = new InteractionLayer(app, viewport, {
    grid,
    tokenLayer,
    rulerLayer,
    drawLayer,
    wallLayer,
    lightLayer,
    visionLayer,
    fogLayer,
  }).mount();

  const network = new NetworkClient({ sessionId, name });
  interactionLayer.networkClient = network;
  // Circular condition badges optimistically repaint and persist through the
  // same actor-update channel as the token HUD.
  tokenLayer.networkClient = network;

  // Step 5.3 persistence: the layer debounces Base64 extraction (2 s) and the
  // client forwards the result to `room:update-fog`; a reset broadcasts
  // `room:reset-fog`. Responses from other members replace/clear this texture.
  fogLayer.onFogChanged = (dataUrl, sceneId, actorId) => {
    if (!network.connected) {
      return;
    }
    network
      .updateFog(sceneId, dataUrl, actorId)
      .catch((error) => console.warn("[pf2e] fog save failed", error));
  };
  fogLayer.onFogReset = (sceneId) => {
    if (!network.connected) {
      return;
    }
    network
      .resetFog(sceneId)
      .catch((error) => console.warn("[pf2e] fog reset failed", error));
  };

  // Chat speech bubbles live above every scene layer and follow their token.
  const chatBubbleLayer = new ChatBubbleLayer(app, viewport, tokenLayer, network);
  viewport.world.addChild(chatBubbleLayer);

  // ------------------------------------------------------- active scene (4.8)
  // Scene canvas arrays are loaded from `room:scene-activated` (or the join
  // snapshot) and saved back after every canvas mutation with a short debounce.
  let activeSceneId = null;
  let viewedSceneId = null;
  let lastActiveSceneState = null;
  let appliedSceneId;
  let lastCombatants = [];
  let lastActiveCombatantId = null;
  let sceneUpdateTimer = null;
  let sceneTokenPositions = [];
  let sceneActorTokens = [];
  let scenePositionsPending = false;
  let appliedSceneSettingsKey = "";

  /**
   * Step 6.3: apply scene configuration (background image, cell size, outside
   * colour). The grid object is recreated because every canvas layer closes
   * over it; token data is stored in grid cells, so changing the cell size only
   * changes world pixels and never the saved coordinates.
   */
  const applySceneSettings = (settings) => {
    const source = settings && typeof settings === "object" ? settings : {};
    const nextGridSize = Math.max(
      20,
      Math.min(400, Math.round(Number(source.gridSize) || GRID_SIZE)),
    );
    const nextBackground = normalizeBackgroundColor(source.backgroundColor);
    const nextImage =
      typeof source.img === "string" && source.img.trim() !== ""
        ? source.img.trim()
        : "";
    const key = nextGridSize + "|" + nextBackground + "|" + nextImage;
    if (key === appliedSceneSettingsKey) {
      return;
    }
    appliedSceneSettingsKey = key;

    if (nextGridSize !== cellSize) {
      cellSize = nextGridSize;
      grid = createGrid({ gridSize: cellSize });
      for (const layer of [
        drawLayer,
        wallLayer,
        lightLayer,
        visionLayer,
        rulerLayer,
        fogLayer,
        interactionLayer,
      ]) {
        if (layer) {
          layer.grid = grid;
        }
      }
      tokenLayer.setCellSize(cellSize);
      tokenLayer.applyScenePositions(sceneTokenPositions);
      syncTokens(lastCombatants, lastActiveCombatantId);
    }

    if (!nextImage && (gridCols !== 24 || gridRows !== 16)) {
      gridCols = 24;
      gridRows = 16;
    }
    gridLayer.resize(gridCols, gridRows, cellSize);
    backgroundLayer.setGrid(cellSize, gridCols, gridRows);
    backgroundLayer.setBackgroundColor(nextBackground);
    app.renderer.background.color = nextBackground;
    gridLayer.setFillAlpha(nextImage ? 0.08 : 0.55);

    if (!nextImage) {
      backgroundLayer.setImage("");
      return;
    }

    backgroundLayer.setImage(nextImage).then((size) => {
      if (!size) {
        return;
      }
      // Size the grid to the intrinsic image dimensions when possible.
      const cols = Math.max(1, Math.ceil(size.width / cellSize));
      const rows = Math.max(1, Math.ceil(size.height / cellSize));
      if (cols !== gridCols || rows !== gridRows) {
        gridCols = cols;
        gridRows = rows;
        gridLayer.resize(gridCols, gridRows, cellSize);
        backgroundLayer.setGrid(cellSize, gridCols, gridRows);
      }
      gridLayer.setFillAlpha(0.08);
      tokenLayer.applyScenePositions(sceneTokenPositions);
      syncTokens(lastCombatants, lastActiveCombatantId);
      visionLayer.refresh();
    });
  };

  const sceneCanvasPayload = () => ({
    walls: wallLayer.serialize(),
    drawings: drawLayer.serialize(),
    lights: lightLayer.serialize(),
    tokens: tokenLayer.serializeScene(),
  });

  const applySceneCanvas = (canvas) => {
    const data = canvas && typeof canvas === "object" ? canvas : {};
    drawLayer.loadState(data.drawings);
    wallLayer.loadState(data.walls);
    lightLayer.loadState(data.lights);
    const tokens = Array.isArray(data.tokens) ? data.tokens : [];
    // Step 4.8.5: actor-linked tokens live next to the legacy combatant
    // position records in `scenes[id].tokens`.
    sceneActorTokens = tokens.filter(
      (token) =>
        token &&
        typeof token.id === "string" &&
        typeof token.actorId === "string" &&
        token.actorId !== "",
    );
    sceneTokenPositions = tokens.filter(
      (token) => token && typeof token.combatantId === "string",
    );
    tokenLayer.syncActorTokens(sceneActorTokens);
    scenePositionsPending = true;
    // Walls may have changed: re-clip lights and re-run line of sight.
    lightLayer.renderAll();
    visionLayer.refresh();
  };

  /** Sync the actor cache used by token HP bars. */
  const applyActors = (actors) => {
    tokenLayer.setActors(Array.isArray(actors) ? actors : []);
  };

  /** The scene currently painted by the canvas (GM preview wins locally). */
  const canvasSceneId = () => viewedSceneId || activeSceneId;

  const syncTokens = (combatants, activeCombatantId) => {
    lastCombatants = Array.isArray(combatants) ? combatants : [];
    lastActiveCombatantId =
      activeCombatantId === undefined ? null : activeCombatantId;
    // Tokens added while a scene was active belong to that scene; legacy
    // tokens without a binding remain visible everywhere.
    const displayedSceneId = canvasSceneId();
    const visible = lastCombatants.filter((combatant) => {
      const boundScene =
        combatant && combatant.sceneId !== undefined
          ? combatant.sceneId
          : null;
      if (boundScene === null || boundScene === undefined) {
        return true;
      }
      return boundScene === displayedSceneId;
    });
    tokenLayer.sync(visible, lastActiveCombatantId);
    if (
      scenePositionsPending &&
      (lastCombatants.length > 0 || sceneTokenPositions.length === 0)
    ) {
      scenePositionsPending = false;
      tokenLayer.applyScenePositions(sceneTokenPositions);
    }
    visionLayer.refresh();
  };

  const applySceneState = (nextSceneId, canvas, fogExploration, sceneSettings) => {
    activeSceneId = nextSceneId || null;
    viewedSceneId = null;
    lastActiveSceneState = {
      activeSceneId,
      canvas,
      fogExploration,
      sceneSettings,
    };
    appliedSceneId = activeSceneId;
    // Step 6.3: image/grid/colour must be ready before tokens are placed.
    applySceneSettings(sceneSettings);
    applySceneCanvas(canvas);
    // Step 5.3/5.4: switch the fog layer to the new scene and restore the
    // per-actor exploration textures. The selected token's own texture is
    // drawn when `syncTokens()` refreshes the vision layer below.
    fogLayer.setScene(activeSceneId);
    fogLayer.loadSceneFog(fogExploration);
    syncTokens(lastCombatants, lastActiveCombatantId);
  };

  /**
   * Step 6.8: GM-only local scene preview.
   *
   * The scene directory entry already contains the same canvas arrays
   * (`walls/drawings/lights/tokens`), background and grid settings as the
   * activation payload, so the preview never asks the server for anything.
   * `activeSceneId` is intentionally untouched: players stay on the
   * authoritative scene while the GM sees another one locally.
   */
  const applyViewedScene = (entry) => {
    if (!entry || typeof entry.id !== "string" || entry.id === "") {
      return;
    }
    viewedSceneId = entry.id;
    applySceneSettings(entry);
    applySceneCanvas(entry);
    fogLayer.setScene(entry.id);
    fogLayer.loadSceneFog(entry.fogExploration || null);
    syncTokens(lastCombatants, lastActiveCombatantId);
  };

  const restoreActiveScene = () => {
    if (!viewedSceneId) {
      return;
    }
    if (lastActiveSceneState) {
      applySceneState(
        lastActiveSceneState.activeSceneId,
        lastActiveSceneState.canvas,
        lastActiveSceneState.fogExploration,
        lastActiveSceneState.sceneSettings,
      );
      return;
    }
    viewedSceneId = null;
    syncTokens(lastCombatants, lastActiveCombatantId);
  };

  if (typeof window !== "undefined") {
    // DirectoryPanel dispatches this event after the GM clicks "View" /
    // "Activate". `sceneId: null` restores the active scene.
    window.addEventListener("pf2e:view-scene", (event) => {
      const detail = event && event.detail ? event.detail : {};
      if (!detail.sceneId) {
        restoreActiveScene();
        return;
      }
      applyViewedScene(detail.scene || null);
    });
  }

  const scheduleSceneSave = () => {
    if (sceneUpdateTimer !== null) {
      clearTimeout(sceneUpdateTimer);
    }
    sceneUpdateTimer = setTimeout(() => {
      sceneUpdateTimer = null;
      if (!network.connected) {
        return;
      }
      const payload = sceneCanvasPayload();
      // Keep the local scene caches in sync with what was just persisted. The
      // source client ignores its own canvas echo, so a locally deleted actor
      // token must disappear from `sceneActorTokens` here as well.
      sceneActorTokens = payload.tokens.filter(
        (token) => token && typeof token.actorId === "string" && token.actorId !== "",
      );
      sceneTokenPositions = payload.tokens.filter(
        (token) => token && typeof token.combatantId === "string",
      );
      network
        .updateSceneCanvas(canvasSceneId(), payload)
        .catch((error) => console.warn("[pf2e] scene save failed", error));
    }, 250);
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pf2e:scene-canvas-changed", scheduleSceneSave);
    // Any committed canvas edit can change occluders (walls) or light/token
    // positions, so re-run the shadow caster before the next frame is saved.
    window.addEventListener("pf2e:scene-canvas-changed", () => {
      lightLayer.renderAll();
      visionLayer.refresh();
    });
  }

  network.onSceneActivated((payload) => {
    if (!payload) {
      return;
    }
    applySceneState(
      payload.activeSceneId,
      payload.canvas,
      payload.fogExploration,
      payload.scene,
    );
  });

  network.onSceneCanvasUpdate((payload) => {
    if (!payload) {
      return;
    }
    if (payload.sourceMemberId && payload.sourceMemberId === network.playerId) {
      return;
    }
    const payloadScene = payload.sceneId || null;
    if (payloadScene !== canvasSceneId()) {
      return;
    }
    applySceneCanvas(payload.canvas);
    syncTokens(lastCombatants, lastActiveCombatantId);
  });

  // Step 6.8: background image preloading. Every client receives the scene
  // image URL and decodes it into the browser cache without switching scenes.
  network.onPreloadScene((payload) => {
    if (!payload || typeof payload.img !== "string" || payload.img === "") {
      return;
    }
    const image = new Image();
    image.decoding = "async";
    image.src = payload.img;
  });

  // Step 5.3: another member stamped new exploration into their texture. The
  // server relays the encoded PNG; decoding it here replaces our local history
  // so every table sees the same fog.
  network.onFogUpdate((payload) => {
    if (!payload) {
      return;
    }
    if (payload.sourceMemberId && payload.sourceMemberId === network.playerId) {
      return;
    }
    const payloadScene =
      typeof payload.sceneId === "string" && payload.sceneId !== ""
        ? payload.sceneId
        : null;
    if (payloadScene !== canvasSceneId()) {
      return;
    }
    fogLayer.applyRemoteFog(payload.actorId || null, payload.fogExploration);
  });

  // Fog reset is authoritative for the whole room: clear the local texture
  // without re-broadcasting, otherwise the two clients would loop.
  network.onFogReset((payload) => {
    if (!payload) {
      return;
    }
    if (payload.sourceMemberId && payload.sourceMemberId === network.playerId) {
      return;
    }
    const payloadScene =
      typeof payload.sceneId === "string" && payload.sceneId !== ""
        ? payload.sceneId
        : null;
    if (payloadScene !== canvasSceneId()) {
      return;
    }
    fogLayer.clearSceneFog();
    // Current LOS is always visible, even after exploration is wiped.
    visionLayer.refresh();
  });

  // ---------------------------------------------------- actor tokens (4.8.5)
  // Every directory broadcast carries the complete actor list; `room:update-actor`
  // is the focused HP change event. Both refresh the canvas HP bars.
  network.onDirectoriesUpdate((directories) => {
    if (directories && directories.actors) {
      applyActors(directories.actors.entries);
    }
    // Step 6.3: saving Scene Settings broadcasts the directory tree, so the
    // active scene's background/grid updates immediately for every client.
    const directorySceneId = canvasSceneId();
    if (
      directories &&
      directories.scenes &&
      directorySceneId &&
      Array.isArray(directories.scenes.entries)
    ) {
      const activeScene = directories.scenes.entries.find(
        (entry) => entry.id === directorySceneId,
      );
      if (activeScene) {
        applySceneSettings(activeScene);
      }
    }
  });

  network.onActorUpdate((actor) => {
    tokenLayer.upsertActor(actor);
    // Re-sync the scene tokens so a newly created actor card is painted with
    // its portrait/HP on actor tokens that were waiting for directory data.
    if (sceneActorTokens.length > 0) {
      tokenLayer.syncActorTokens(sceneActorTokens);
    }
  });

  /**
   * Directory → canvas drag-and-drop (Step 4.8.5). The drop point is converted
   * to world space, snapped to the grid cell, and sent as `room:create-token`.
   * The server stores it in `scenes[sceneId].tokens` and rebroadcasts the canvas.
   */
  const createActorTokenAt = (actorId, clientX, clientY) => {
    if (!actorId || !network.connected) {
      return Promise.reject(new Error("Нет соединения с сервером."));
    }
    const rect = app.canvas.getBoundingClientRect();
    const world = viewport.toWorld({
      x: clientX - rect.left,
      y: clientY - rect.top,
    });
    const col = Math.max(0, Math.floor(world.x / cellSize));
    const row = Math.max(0, Math.floor(world.y / cellSize));
    return network.createToken({
      actorId: actorId,
      sceneId: canvasSceneId(),
      x: col,
      y: row,
    });
  };

  const handleCanvasDragOver = (event) => {
    const types = event.dataTransfer ? Array.from(event.dataTransfer.types || []) : [];
    if (!types.includes("application/json")) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleCanvasDrop = (event) => {
    const payload = readDragPayload(event.dataTransfer);
    if (!payload || payload.type !== ACTOR_TOKEN_PAYLOAD_TYPE || !payload.actorId) {
      return;
    }
    event.preventDefault();
    createActorTokenAt(payload.actorId, event.clientX, event.clientY).catch(
      (error) => console.warn("[pf2e] token creation failed", error),
    );
  };

  app.canvas.addEventListener("dragover", handleCanvasDragOver);
  app.canvas.addEventListener("drop", handleCanvasDrop);

  // Mount the React UI overlay after NetworkClient exists so the store
  // provider can subscribe to room:state-update before the socket connects.
  const uiRootElement = document.getElementById("ui-root");
  const uiRoot = uiRootElement ? createRoot(uiRootElement) : null;
  if (uiRoot) {
    uiRoot.render(
      createElement(
        StoreProvider,
        { networkClient: network, initialRole: role },
        createElement(App),
      ),
    );
  }

  network.on("open", () => {
    if (statusEl) {
      statusEl.textContent = "Connected — joining " + sessionId + "…";
    }
  });

  network.on("joined", (payload) => {
    if (statusEl) {
      statusEl.textContent = "Joined " + sessionId + " as " + role;
    }
    // The server is authoritative for the joined member's role; keep the
    // canvas vision rules in sync with it (GM vs player).
    const joinedRole =
      payload && payload.member && payload.member.role
        ? payload.member.role
        : network.role;
    tokenLayer.setGMViewer(joinedRole === "gm");
    visionLayer.setViewerRole(joinedRole);
    if (payload && payload.session) {
      applySceneState(
        payload.session.activeSceneId,
        payload.session.sceneCanvas,
        payload.session.sceneFogExploration,
        payload.session.scene,
      );
      syncTokens(
        payload.session.combatants,
        payload.session.activeCombatantId,
      );
      if (payload.session.directories) {
        applyActors(payload.session.directories.actors?.entries || []);
      }
    }
  });

  network.on("session:snapshot", (snapshot) => {
    if (!snapshot) {
      return;
    }

    if (snapshot.activeSceneId !== undefined) {
      const nextSceneId = snapshot.activeSceneId || null;
      if (nextSceneId !== appliedSceneId) {
        applySceneState(
          nextSceneId,
          snapshot.sceneCanvas,
          snapshot.sceneFogExploration,
          snapshot.scene,
        );
      } else {
        // Same scene: a snapshot may still carry freshly saved settings.
        applySceneSettings(snapshot.scene);
      }
    }
    syncTokens(snapshot.combatants || [], snapshot.activeCombatantId);
    if (snapshot.directories) {
      applyActors(snapshot.directories.actors?.entries || []);
    }

    if (statusEl && snapshot.status) {
      const round = snapshot.round ? " · round " + snapshot.round : "";
      statusEl.textContent = "Session " + snapshot.id + " · " + snapshot.status + round;
    }
  });

  // Authoritative combat state from the Step 2 action pipeline.
  network.onStateUpdate((update) => {
    console.log("[pf2e] room:state-update", update);

    const state = update && update.state;
    if (state && Array.isArray(state.combatants)) {
      const activeId = state.encounter ? state.encounter.activeCombatantId : null;
      // Keep the token layer's combat cache in sync so actor tokens can show
      // the active-turn ring and defeated state in real time.
      tokenLayer.setCombatState(state);
      syncTokens(state.combatants, activeId);
    }
  });

  network.onActionError((error) => {
    console.warn("[pf2e] action rejected", error);
    if (statusEl) {
      statusEl.textContent = "Action rejected: " + (error.reason || "unknown");
    }
  });

  network.on("error", (payload) => {
    console.error("[pf2e] server error", payload);
  });

  network.on("close", () => {
    if (statusEl) {
      statusEl.textContent = "Disconnected — retrying…";
    }
  });

  // Test connection on page load: same-origin /ws is proxied by Vite in dev
  // and served directly by the Node process in production.
  network.connect(role, playerId);

  // Expose the renderer pieces for debugging in the browser console.
  window.pf2e = {
    app,
    viewport,
    grid,
    backgroundLayer,
    gridLayer,
    drawLayer,
    wallLayer,
    tokenLayer,
    lightLayer,
    visionLayer,
    fogLayer,
    rulerLayer,
    chatBubbleLayer,
    interactionLayer,
    network,
    uiRoot,
    getActiveSceneId: () => activeSceneId,
    getGrid: () => grid,
    applySceneCanvas,
    applySceneSettings,
    sceneCanvasPayload,
    createActorTokenAt,
    syncActorDirectory: applyActors,
  };
}

/**
 * Render the lobby first. Only a successful profile login unmounts it and
 * starts the PixiJS runtime + WebSocket connection.
 */
function bootstrap() {
  const uiRootElement = document.getElementById("ui-root");
  if (!uiRootElement) {
    throw new Error("Missing #ui-root element.");
  }
  if (statusEl) {
    statusEl.textContent = "Лобби — выберите профиль";
  }

  const lobbyRoot = createRoot(uiRootElement);
  lobbyRoot.render(
    createElement(StartScreen, {
      sessionId,
      defaultRole: urlRole,
      preferredUserId,
      onLogin: (profile) => {
        // Defer the unmount until the click handler finishes so React does not
        // unmount the root while it is still rendering the event.
        window.setTimeout(() => {
          lobbyRoot.unmount();
          startGame(profile).catch((error) => {
            console.error("[pf2e] failed to start client", error);
            if (statusEl) {
              statusEl.textContent = "Startup failed: " + error.message;
            }
          });
        }, 0);
      },
    }),
  );
}

bootstrap();
