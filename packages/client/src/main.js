import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Application } from "pixi.js";

import { NetworkClient } from "./net/network-client.js";
import { Viewport } from "./canvas/viewport.js";
import { GridLayer } from "./canvas/grid-layer.js";
import { TokenLayer } from "./canvas/token-layer.js";
import { StoreProvider } from "./ui/StoreContext.jsx";
import App from "./ui/App.jsx";
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

  const cellSize = 70;
  const gridLayer = new GridLayer({ cols: 24, rows: 16, cellSize });
  const tokenLayer = new TokenLayer({ cellSize });

  viewport.world.addChild(gridLayer, tokenLayer);

  const network = new NetworkClient({ sessionId, name });

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
      tokenLayer.sync(payload.session.combatants, payload.session.activeCombatantId);
    }
  });

  network.on("session:snapshot", (snapshot) => {
    if (!snapshot) {
      return;
    }
    tokenLayer.sync(snapshot.combatants || [], snapshot.activeCombatantId);

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
      tokenLayer.sync(state.combatants, activeId);
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
  window.pf2e = { app, viewport, gridLayer, tokenLayer, network, uiRoot };
}

bootstrap().catch((error) => {
  console.error("[pf2e] failed to start client", error);
  if (statusEl) {
    statusEl.textContent = "Startup failed: " + error.message;
  }
});
