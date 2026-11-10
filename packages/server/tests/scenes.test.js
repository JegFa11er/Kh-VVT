"use strict";

/**
 * Integration tests for Step 4.8: the active-scene manager.
 *
 * Run with: npm run test --workspace=@pf2e/server
 */

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { WebSocket } = require("ws");

const { EncounterSession } = require("../src/room/encounter-session.js");
const serverModule = require("../src/index.js");

const tests = [];

function test(name, handler) {
  tests.push({ name: name, handler: handler });
}

function tempFile(name) {
  return path.join(
    os.tmpdir(),
    "pf2e-scene-" + name + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ".json",
  );
}

function openClient(port) {
  return new Promise(function (resolve, reject) {
    const ws = new WebSocket("ws://127.0.0.1:" + port + "/ws");
    const messages = [];
    const waiters = [];

    ws.on("message", function (raw) {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch (error) {
        return;
      }
      messages.push(message);
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        if (waiters[index].predicate(message)) {
          const waiter = waiters.splice(index, 1)[0];
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        }
      }
    });

    function waitFor(predicate, timeoutMs) {
      const existingIndex = messages.findIndex(predicate);
      if (existingIndex !== -1) {
        return Promise.resolve(messages.splice(existingIndex, 1)[0]);
      }
      return new Promise(function (resolveWait, rejectWait) {
        const timer = setTimeout(function () {
          const index = waiters.findIndex(function (waiter) {
            return waiter.timer === timer;
          });
          if (index !== -1) {
            waiters.splice(index, 1);
          }
          rejectWait(new Error("Timed out waiting for WebSocket message."));
        }, timeoutMs || 4000);
        waiters.push({ predicate: predicate, resolve: resolveWait, timer: timer });
      });
    }

    ws.once("open", function () {
      resolve({
        send: function (message) {
          ws.send(JSON.stringify(message));
        },
        waitFor: waitFor,
        close: function () {
          ws.close();
        },
      });
    });
    ws.once("error", reject);
  });
}

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

// --------------------------------------------------------------- direct tests

test("activateScene broadcasts the scene id and an empty canvas", function () {
  const session = new EncounterSession({ id: "scenes-direct" });
  const scene = session.createDirectoryEntry("scenes", { name: "Таверна" });

  const events = [];
  session.subscribe(function (eventType, payload) {
    events.push({ type: eventType, payload: payload });
  });

  assert.equal(session.activeSceneId, null);
  const canvas = session.activateScene(scene.id);

  assert.equal(session.activeSceneId, scene.id);
  assert.deepEqual(canvas, {
    sceneId: scene.id,
    walls: [],
    drawings: [],
    lights: [],
    tokens: [],
  });
  const activation = events.find(function (event) {
    return event.type === "room:scene-activated";
  });
  assert.ok(activation);
  assert.equal(activation.payload.activeSceneId, scene.id);
  assert.equal(session.snapshot().activeSceneId, scene.id);
  // Activating a scene is UI metadata, not a combat-log entry.
  assert.equal(session.combatLog.length, 0);
});

test("updateSceneCanvas stores walls/drawings/lights on the scene entry", function () {
  const session = new EncounterSession({ id: "scenes-canvas" });
  const scene = session.createDirectoryEntry("scenes", { name: "Подземелье" });

  session.activateScene(scene.id);
  const stored = session.updateSceneCanvas(scene.id, {
    walls: [{ id: "wall-1", type: "normal", x1: 0, y1: 0, x2: 100, y2: 0 }],
    drawings: [{ id: "drawing-1", kind: "rect", x: 0, y: 0, width: 100, height: 50 }],
    lights: [{ id: "light-1", x: 50, y: 50, brightFeet: 20, dimFeet: 40 }],
  });

  assert.equal(stored.walls.length, 1);
  assert.equal(stored.drawings[0].kind, "rect");
  assert.equal(stored.lights[0].brightFeet, 20);

  const entry = session
    .getDirectories()
    .scenes.entries.find(function (candidate) {
      return candidate.id === scene.id;
    });
  assert.equal(entry.walls.length, 1);
  assert.equal(entry.drawings.length, 1);
  assert.equal(entry.lights.length, 1);
});

test("scene canvases and the active scene survive saveToDisk/loadFromDisk", async function () {
  const file = tempFile("roundtrip");
  try {
    const session = new EncounterSession({ id: "scenes-persist", dataFile: file });
    const scene = session.createDirectoryEntry("scenes", { name: "Лес" });
    session.activateScene(scene.id);
    session.updateSceneCanvas(scene.id, {
      walls: [{ id: "wall-7", type: "door", x1: 0, y1: 0, x2: 100, y2: 100 }],
      drawings: [{ id: "drawing-3", kind: "text", text: "Вход", tx: 10, ty: 20 }],
      lights: [],
    });
    session.updateSceneCanvas(null, {
      walls: [],
      drawings: [],
      lights: [{ id: "light-2", x: 5, y: 5, brightFeet: 10, dimFeet: 20 }],
    });
    await session.flushPersistence();

    const restored = new EncounterSession({ id: "scenes-persist", dataFile: file });
    const result = await restored.loadFromDisk();
    assert.equal(result.ok, true);
    assert.equal(restored.activeSceneId, scene.id);

    const canvas = restored.getSceneCanvas(scene.id);
    assert.equal(canvas.walls[0].type, "door");
    assert.equal(canvas.drawings[0].text, "Вход");
    assert.equal(restored.getSceneCanvas(null).lights[0].id, "light-2");
  } finally {
    await fs.rm(file, { force: true });
  }
});

test("combatants added while a scene is active are bound to that scene", function () {
  const session = new EncounterSession({ id: "scenes-tokens" });
  const scene = session.createDirectoryEntry("scenes", { name: "Арена" });

  const legacy = session.addCombatant({ id: "legacy", name: "Старый токен", x: 0, y: 0 });
  assert.equal(legacy.sceneId, null);

  session.activateScene(scene.id);
  const scoped = session.addCombatant({ id: "scoped", name: "Новый токен", x: 1, y: 1 });
  assert.equal(scoped.sceneId, scene.id);

  const state = session.serializeState();
  const byId = new Map(
    state.combatants.map(function (combatant) {
      return [combatant.id, combatant];
    }),
  );
  assert.equal(byId.get("legacy").sceneId, null);
  assert.equal(byId.get("scoped").sceneId, scene.id);

  const snapshot = session.snapshot();
  const snapshotById = new Map(
    snapshot.combatants.map(function (combatant) {
      return [combatant.id, combatant];
    }),
  );
  assert.equal(snapshotById.get("scoped").sceneId, scene.id);
});

// ------------------------------------------------------------ WebSocket tests

test("WebSocket scene activation and canvas updates broadcast to the room", async function () {
  await serverModule.startServer(0, "127.0.0.1");
  const address = serverModule.server.address();
  const clients = [];

  try {
    const gm = await openClient(address.port);
    const player = await openClient(address.port);
    clients.push(gm, player);

    gm.send({
      type: "join",
      payload: { sessionId: "scenes-ws", memberId: "scene-gm", role: "gm" },
    });
    player.send({
      type: "join",
      payload: { sessionId: "scenes-ws", memberId: "scene-player", role: "player" },
    });
    await gm.waitFor(function (message) {
      return message.type === "joined";
    });
    await player.waitFor(function (message) {
      return message.type === "joined";
    });

    const directoryUpdate = gm.waitFor(function (message) {
      return (
        message.type === "room:directories-update" &&
        message.payload.directories.scenes.entries.length === 1
      );
    });
    gm.send({
      type: "room:create-scene",
      payload: { name: "Город" },
    });
    const directories = await directoryUpdate;
    const sceneId = directories.payload.directories.scenes.entries[0].id;

    const activatedOnPlayer = player.waitFor(function (message) {
      return (
        message.type === "room:scene-activated" &&
        message.payload.activeSceneId === sceneId
      );
    });
    gm.send({ type: "room:activate-scene", payload: { sceneId: sceneId } });
    const activated = await activatedOnPlayer;
    assert.deepEqual(activated.payload.canvas, {
      sceneId: sceneId,
      walls: [],
      drawings: [],
      lights: [],
      tokens: [],
    });

    const canvasUpdate = gm.waitFor(function (message) {
      return (
        message.type === "room:scene-canvas-update" &&
        message.payload.sceneId === sceneId &&
        message.payload.canvas.walls.length === 1
      );
    });
    player.send({
      type: "room:scene-canvas-update",
      payload: {
        sceneId: sceneId,
        canvas: {
          walls: [
            { id: "wall-1", type: "normal", x1: 0, y1: 0, x2: 200, y2: 0 },
          ],
          drawings: [],
          lights: [],
        },
      },
    });
    const update = await canvasUpdate;
    assert.equal(update.payload.canvas.walls[0].x2, 200);
    assert.equal(update.payload.sourceMemberId, "scene-player");
  } finally {
    for (const client of clients) {
      client.close();
    }
    await delay(50);
    await serverModule.closeServer();
  }
});

async function main() {
  let failures = 0;
  for (const entry of tests) {
    try {
      await entry.handler();
      console.log("  ok   " + entry.name);
    } catch (error) {
      failures += 1;
      console.error("  FAIL " + entry.name);
      console.error(error && error.stack ? error.stack : String(error));
    }
  }

  console.log("");
  console.log(String(tests.length - failures) + " passed, " + String(failures) + " failed");
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main();
