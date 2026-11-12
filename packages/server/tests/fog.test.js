"use strict";

/**
 * Integration tests for Step 5.3: persistent fog of war.
 *
 * The fog itself is a client-side RenderTexture; the server only owns the
 * encoded PNG. These tests cover storage on `scenes[id].fogExploration`,
 * the base-scene counterpart, disk round-trips and both WebSocket broadcasts.
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

const SAMPLE_FOG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

function tempFile(name) {
  return path.join(
    os.tmpdir(),
    "pf2e-fog-" + name + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ".json",
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

test("updateFog stores the PNG on the scene entry and resetFog clears it", function () {
  const session = new EncounterSession({ id: "fog-direct" });
  const scene = session.createDirectoryEntry("scenes", { name: "Пещера" });

  const events = [];
  session.subscribe(function (eventType, payload) {
    events.push({ type: eventType, payload: payload });
  });

  assert.equal(session.getSceneFog(scene.id), null);
  session.activateScene(scene.id);

  const stored = session.updateFog(scene.id, SAMPLE_FOG, "player-1");
  assert.equal(stored, SAMPLE_FOG);
  assert.equal(session.getSceneFog(scene.id), SAMPLE_FOG);

  const entry = session
    .getDirectories()
    .scenes.entries.find(function (candidate) {
      return candidate.id === scene.id;
    });
  assert.equal(entry.fogExploration, SAMPLE_FOG);
  assert.equal(session.snapshot().sceneFogExploration, SAMPLE_FOG);

  const update = events.find(function (event) {
    return event.type === "room:fog-update";
  });
  assert.ok(update);
  assert.equal(update.payload.sceneId, scene.id);
  assert.equal(update.payload.sourceMemberId, "player-1");

  session.resetFog(scene.id, "player-1");
  assert.equal(session.getSceneFog(scene.id), null);
  assert.equal(session.snapshot().sceneFogExploration, null);
  const reset = events.find(function (event) {
    return event.type === "room:fog-reset";
  });
  assert.ok(reset);
  assert.equal(reset.payload.sceneId, scene.id);
  // Fog is presentation metadata, never a combat-log event.
  assert.equal(session.combatLog.length, 0);
});

test("the base scene keeps its own fog texture", function () {
  const session = new EncounterSession({ id: "fog-base" });
  assert.equal(session.getSceneFog(null), null);

  session.updateFog(null, SAMPLE_FOG, "gm-1");
  assert.equal(session.getSceneFog(null), SAMPLE_FOG);
  assert.equal(session.baseSceneFogExploration, SAMPLE_FOG);

  session.resetFog(null, "gm-1");
  assert.equal(session.getSceneFog(null), null);
});

test("per-actor fog is stored under scenes[sceneId].fogExploration[actorId]", function () {
  const session = new EncounterSession({ id: "fog-per-actor" });
  const scene = session.createDirectoryEntry("scenes", { name: "Подземелье" });
  const secondFog =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYIJ=";

  const events = [];
  session.subscribe(function (eventType, payload) {
    events.push({ type: eventType, payload: payload });
  });

  session.updateFog(scene.id, SAMPLE_FOG, "gm-1", "actor-a");
  session.updateFog(scene.id, secondFog, "gm-1", "actor-b");
  assert.equal(session.getSceneFog(scene.id, "actor-a"), SAMPLE_FOG);
  assert.equal(session.getSceneFog(scene.id, "actor-b"), secondFog);
  assert.equal(session.getSceneFog(scene.id, "actor-c"), null);

  const entry = session
    .getDirectories()
    .scenes.entries.find(function (candidate) {
      return candidate.id === scene.id;
    });
  assert.equal(entry.fogExploration["actor-a"], SAMPLE_FOG);
  assert.equal(entry.fogExploration["actor-b"], secondFog);

  const update = events.find(function (event) {
    return event.type === "room:fog-update";
  });
  assert.ok(update);
  assert.equal(update.payload.actorId, "actor-a");

  // Clearing one actor removes only that key.
  session.updateFog(scene.id, null, "gm-1", "actor-a");
  assert.equal(session.getSceneFog(scene.id, "actor-a"), null);
  assert.equal(session.getSceneFog(scene.id, "actor-b"), secondFog);

  // A reset still wipes the complete per-scene collection.
  session.resetFog(scene.id, "gm-1");
  assert.equal(session.getSceneFogCollection(scene.id), null);
});

test("invalid fog payloads are rejected", function () {
  const session = new EncounterSession({ id: "fog-validate" });
  const scene = session.createDirectoryEntry("scenes", { name: "Сцена" });

  assert.throws(function () {
    session.updateFog(scene.id, "not-a-data-url", "player-1");
  }, /PNG data URL/);

  assert.throws(function () {
    session.updateFog(scene.id, { base64: "x" }, "player-1");
  }, /PNG data URL/);

  assert.throws(function () {
    session.updateFog("missing-scene", SAMPLE_FOG, "player-1");
  }, /Unknown scene/);
});

test("fog textures survive saveToDisk/loadFromDisk for scenes and the base scene", async function () {
  const file = tempFile("roundtrip");
  try {
    const session = new EncounterSession({ id: "fog-persist", dataFile: file });
    const scene = session.createDirectoryEntry("scenes", { name: "Лес" });
    session.updateFog(scene.id, SAMPLE_FOG, "gm-1");
    session.updateFog(null, SAMPLE_FOG, "gm-1");
    session.updateFog(scene.id, SAMPLE_FOG, "gm-1", "actor-persist");
    await session.flushPersistence();

    const restored = new EncounterSession({ id: "fog-persist", dataFile: file });
    const result = await restored.loadFromDisk();
    assert.equal(result.ok, true);
    assert.equal(restored.getSceneFog(scene.id), SAMPLE_FOG);
    assert.equal(restored.getSceneFog(null), SAMPLE_FOG);
    assert.equal(
      restored.getSceneFog(scene.id, "actor-persist"),
      SAMPLE_FOG,
    );

    // The huge texture is excluded from directory broadcasts/snapshots.
    const directories = restored.getDirectories({ includeFog: false });
    const broadcastScene = directories.scenes.entries.find(function (entry) {
      return entry.id === scene.id;
    });
    assert.equal(broadcastScene.fogExploration, undefined);
  } finally {
    await fs.rm(file, { force: true });
  }
});

// ------------------------------------------------------------ WebSocket tests

test("WebSocket update-fog and reset-fog broadcast to every member", async function () {
  await serverModule.startServer(0, "127.0.0.1");
  const address = serverModule.server.address();
  const clients = [];

  try {
    const gm = await openClient(address.port);
    const player = await openClient(address.port);
    clients.push(gm, player);

    gm.send({
      type: "join",
      payload: { sessionId: "fog-ws", memberId: "fog-gm", role: "gm" },
    });
    player.send({
      type: "join",
      payload: { sessionId: "fog-ws", memberId: "fog-player", role: "player" },
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
    gm.send({ type: "room:create-scene", payload: { name: "Руины" } });
    const directories = await directoryUpdate;
    const sceneId = directories.payload.directories.scenes.entries[0].id;

    gm.send({ type: "room:activate-scene", payload: { sceneId: sceneId } });
    await player.waitFor(function (message) {
      return (
        message.type === "room:scene-activated" &&
        message.payload.activeSceneId === sceneId
      );
    });

    const fogUpdate = gm.waitFor(function (message) {
      return (
        message.type === "room:fog-update" &&
        message.payload.sceneId === sceneId
      );
    });
    player.send({
      type: "room:update-fog",
      payload: { sceneId: sceneId, fogExploration: SAMPLE_FOG },
    });
    const updated = await fogUpdate;
    assert.equal(updated.payload.fogExploration, SAMPLE_FOG);
    assert.equal(updated.payload.sourceMemberId, "fog-player");

    const fogReset = gm.waitFor(function (message) {
      return (
        message.type === "room:fog-reset" &&
        message.payload.sceneId === sceneId
      );
    });
    player.send({
      type: "room:reset-fog",
      payload: { sceneId: sceneId },
    });
    const reset = await fogReset;
    assert.equal(reset.payload.sourceMemberId, "fog-player");
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
