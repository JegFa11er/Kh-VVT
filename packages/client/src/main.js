import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Application } from "pixi.js";

import { NetworkClient } from "./net/network-client.js";
import { Viewport } from "./canvas/viewport.js";
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
import {
  ACTOR_TOKEN_PAYLOAD_TYPE,
  readDragPayload,
} from "./ui/drag-payloads.js";
import "./ui/styles.css";

const params = new URLSearchParams(window.location.search);
const role = params.get("role") === "gm" ? "gm" : "player";
const name = params.get("name") || (role === "gm" ? "Game Master" : "Player");
const sessionId = params.get("session") || "default";
const playerId =
  params.get("player") ||
  (role === "gm" ? "gm-1" : "player-" + Math.random().toString(36).slice(2, 8));
const statusEl = document.getElementById("status");

async function bootstrap() {
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

  const cellSize = GRID_SIZE;
  const grid = createGrid({ gridSize: cellSize });
  const gridLayer = new GridLayer({ cols: 24, rows: 16, cellSize });
  const drawLayer = new DrawLayer(app, viewport, grid);
  const wallLayer = new WallLayer(app, viewport, grid);
  const tokenLayer = new TokenLayer({ cellSize });
  const lightLayer = new LightLayer(app, viewport, grid, {
    wallLayer: wallLayer,
  });
  const visionLayer = new VisionLayer(app, viewport, grid, {
    tokenLayer: tokenLayer,
    wallLayer: wallLayer,
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
    gridLayer,
    drawLayer,
    wallLayer,
    tokenLayer,
    lightLayer,
    visionLayer,
    fogLayer,
    rulerLayer,
  );

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

  // Step 5.3 persistence: the layer debounces Base64 extraction (2 s) and the
  // client forwards the result to `room:update-fog`; a reset broadcasts
  // `room:reset-fog`. Responses from other members replace/clear this texture.
  fogLayer.onFogChanged = (dataUrl, sceneId) => {
    if (!network.connected) {
      return;
    }
    network
      .updateFog(sceneId, dataUrl)
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
  let appliedSceneId;
  let lastCombatants = [];
  let lastActiveCombatantId = null;
  let sceneUpdateTimer = null;
  let sceneTokenPositions = [];
  let sceneActorTokens = [];
  let scenePositionsPending = false;

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

  const syncTokens = (combatants, activeCombatantId) => {
    lastCombatants = Array.isArray(combatants) ? combatants : [];
    lastActiveCombatantId =
      activeCombatantId === undefined ? null : activeCombatantId;
    // Tokens added while a scene was active belong to that scene; legacy
    // tokens without a binding remain visible everywhere.
    const visible = lastCombatants.filter((combatant) => {
      const boundScene =
        combatant && combatant.sceneId !== undefined
          ? combatant.sceneId
          : null;
      if (boundScene === null || boundScene === undefined) {
        return true;
      }
      return boundScene === activeSceneId;
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

  const applySceneState = (nextSceneId, canvas, fogExploration) => {
    activeSceneId = nextSceneId || null;
    appliedSceneId = activeSceneId;
    applySceneCanvas(canvas);
    // Step 5.3: switch the fog layer to the new scene and restore the encoded
    // exploration texture (one sprite draw into the persistent RenderTexture).
    fogLayer.setScene(activeSceneId);
    fogLayer.loadEncoded(fogExploration);
    syncTokens(lastCombatants, lastActiveCombatantId);
  };

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
        .updateSceneCanvas(activeSceneId, payload)
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
    if (payloadScene !== activeSceneId) {
      return;
    }
    applySceneCanvas(payload.canvas);
    syncTokens(lastCombatants, lastActiveCombatantId);
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
    if (payloadScene !== activeSceneId) {
      return;
    }
    fogLayer.loadEncoded(payload.fogExploration);
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
    if (payloadScene !== activeSceneId) {
      return;
    }
    fogLayer.clearLocal();
  });

  // ---------------------------------------------------- actor tokens (4.8.5)
  // Every directory broadcast carries the complete actor list; `room:update-actor`
  // is the focused HP change event. Both refresh the canvas HP bars.
  network.onDirectoriesUpdate((directories) => {
    if (directories && directories.actors) {
      applyActors(directories.actors.entries);
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
      sceneId: activeSceneId,
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
    if (payload && payload.session) {
      applySceneState(
        payload.session.activeSceneId,
        payload.session.sceneCanvas,
        payload.session.sceneFogExploration,
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
        );
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
    applySceneCanvas,
    sceneCanvasPayload,
    createActorTokenAt,
    syncActorDirectory: applyActors,
  };
}

bootstrap().catch((error) => {
  console.error("[pf2e] failed to start client", error);
  if (statusEl) {
    statusEl.textContent = "Startup failed: " + error.message;
  }
});
