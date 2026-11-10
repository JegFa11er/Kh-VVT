"use strict";

/**
 * Step 4.8.5: actor-linked scene tokens.
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
    "pf2e-token-" +
      name +
      "-" +
      Date.now() +
      "-" +
      Math.random().toString(36).slice(2, 8) +
      ".json",
  );
}

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
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

// --------------------------------------------------------------- direct tests

test("createToken stores an actor-linked token on the scene canvas", function () {
  const session = new EncounterSession({ id: "tokens-direct" });
  const scene = session.createDirectoryEntry("scenes", { name: "Арена" });
  const actor = session.createDirectoryEntry("actors", {
    name: "Вали",
    actorType: "character",
  });
  session.activateScene(scene.id);

  const events = [];
  session.subscribe(function (eventType, payload) {
    events.push({ type: eventType, payload: payload });
  });

  const token = session.createToken(
    { actorId: actor.id, sceneId: scene.id, x: 3, y: 4 },
    "gm-1",
  );

  assert.equal(token.id, "token-1");
  assert.equal(token.actorId, actor.id);
  assert.equal(token.sceneId, scene.id);
  assert.equal(token.gridX, 3);
  assert.equal(token.gridY, 4);

  const canvas = session.getSceneCanvas(scene.id);
  assert.equal(canvas.tokens.length, 1);
  assert.equal(canvas.tokens[0].actorId, actor.id);
  assert.equal(canvas.tokens[0].gridX, 3);

  const sceneEntry = session
    .getDirectories()
    .scenes.entries.find(function (entry) {
      return entry.id === scene.id;
    });
  assert.equal(sceneEntry.tokens.length, 1);
  assert.equal(sceneEntry.tokens[0].id, "token-1");

  const broadcast = events.find(function (event) {
    return event.type === "room:scene-canvas-update";
  });
  assert.ok(broadcast);
  assert.equal(broadcast.payload.reason, "token-created");
  assert.equal(broadcast.payload.createdBy, "gm-1");
  assert.equal(broadcast.payload.sourceMemberId, null);
  assert.equal(broadcast.payload.token.actorId, actor.id);
  assert.equal(broadcast.payload.canvas.tokens.length, 1);
  // Creating a presentation token is not a combat-log entry.
  assert.equal(session.combatLog.length, 0);
});

test("createToken snaps hostile coordinates and targets the base scene", function () {
  const session = new EncounterSession({ id: "tokens-base" });
  const actor = session.createDirectoryEntry("actors", { name: "Нпс", actorType: "npc" });

  const token = session.createToken({ actorId: actor.id, x: 1.9, y: -5 });
  assert.equal(token.sceneId, null);
  assert.equal(token.gridX, 1);
  assert.equal(token.gridY, 0);
  assert.equal(session.getSceneCanvas(null).tokens[0].id, token.id);
});

test("createToken rejects unknown actors and scenes", function () {
  const session = new EncounterSession({ id: "tokens-errors" });
  const actor = session.createDirectoryEntry("actors", { name: "Известный" });

  assert.throws(
    function () {
      session.createToken({ actorId: "missing-actor", x: 0, y: 0 });
    },
    /Unknown actor/,
  );

  assert.throws(
    function () {
      session.createToken({ actorId: actor.id, sceneId: "missing-scene", x: 0, y: 0 });
    },
    /Unknown scene/,
  );

  assert.throws(
    function () {
      session.createToken({ x: 0, y: 0 });
    },
    /actorId/,
  );
});

test("tokens survive persistence and the id sequence keeps growing", async function () {
  const file = tempFile("roundtrip");
  try {
    const session = new EncounterSession({ id: "tokens-persist", dataFile: file });
    const scene = session.createDirectoryEntry("scenes", { name: "Лес" });
    const actor = session.createDirectoryEntry("actors", { name: "Сора" });
    session.createToken({ actorId: actor.id, sceneId: scene.id, x: 2, y: 5 });
    await session.flushPersistence();

    const restored = new EncounterSession({ id: "tokens-persist", dataFile: file });
    const result = await restored.loadFromDisk();
    assert.equal(result.ok, true);
    const canvas = restored.getSceneCanvas(scene.id);
    assert.equal(canvas.tokens.length, 1);
    assert.equal(canvas.tokens[0].actorId, actor.id);
    assert.equal(canvas.tokens[0].gridY, 5);

    const next = restored.createToken({ actorId: actor.id, sceneId: scene.id, x: 6, y: 6 });
    assert.equal(next.id, "token-2");
  } finally {
    await fs.rm(file, { force: true });
  }
});

test("updateActor emits a focused room:update-actor payload", function () {
  const session = new EncounterSession({ id: "tokens-actor-update" });
  const actor = session.createDirectoryEntry("actors", { name: "Тэлин" });

  const events = [];
  session.subscribe(function (eventType, payload) {
    events.push({ type: eventType, payload: payload });
  });

  session.updateActor(
    actor.id,
    { system: { attributes: { hp: { value: 7, max: 20, temp: 0 } } } },
    "gm-1",
    "gm",
  );

  const update = events.find(function (event) {
    return event.type === "room:update-actor";
  });
  assert.ok(update);
  assert.equal(update.payload.actorId, actor.id);
  assert.equal(update.payload.actor.system.attributes.hp.value, 7);
  // Focused actor update is presentation metadata, not a combat event.
  assert.equal(session.combatLog.length, 0);
});

test("combatants keep the actor binding used by token HP bars", function () {
  const session = new EncounterSession({ id: "tokens-combatant" });
  const actor = session.createDirectoryEntry("actors", { name: "Рыцарь" });
  session.addCombatant({ id: "fighter", name: "Рыцарь", x: 0, y: 0, actorId: actor.id });

  const state = session.serializeState();
  const combatant = state.combatants.find(function (entry) {
    return entry.id === "fighter";
  });
  assert.equal(combatant.actorId, actor.id);
  assert.equal(session.snapshot().combatants[0].actorId, actor.id);
});

// ------------------------------------------------------------ WebSocket test

test("WebSocket room:create-token broadcasts the updated scene canvas", async function () {
  await serverModule.startServer(0, "127.0.0.1");
  const address = serverModule.server.address();
  const clients = [];

  try {
    const gm = await openClient(address.port);
    const player = await openClient(address.port);
    clients.push(gm, player);

    gm.send({
      type: "join",
      payload: { sessionId: "tokens-ws", memberId: "token-gm", role: "gm" },
    });
    player.send({
      type: "join",
      payload: { sessionId: "tokens-ws", memberId: "token-player", role: "player" },
    });
    await gm.waitFor(function (message) {
      return message.type === "joined";
    });
    await player.waitFor(function (message) {
      return message.type === "joined";
    });

    const actorCreated = gm.waitFor(function (message) {
      return (
        message.type === "room:directories-update" &&
        message.payload.directories.actors.entries.length === 1
      );
    });
    gm.send({ type: "room:create-actor", payload: { name: "Драг-актёр" } });
    const actorPayload = await actorCreated;
    const actorId = actorPayload.payload.directories.actors.entries[0].id;

    const sceneCreated = gm.waitFor(function (message) {
      return (
        message.type === "room:directories-update" &&
        message.payload.directories.scenes.entries.length === 1
      );
    });
    gm.send({ type: "room:create-scene", payload: { name: "Сцена" } });
    const scenePayload = await sceneCreated;
    const sceneId = scenePayload.payload.directories.scenes.entries[0].id;

    gm.send({ type: "room:activate-scene", payload: { sceneId: sceneId } });
    await player.waitFor(function (message) {
      return (
        message.type === "room:scene-activated" &&
        message.payload.activeSceneId === sceneId
      );
    });

    const canvasUpdate = player.waitFor(function (message) {
      return (
        message.type === "room:scene-canvas-update" &&
        message.payload.reason === "token-created" &&
        message.payload.sceneId === sceneId
      );
    });
    const tokenAck = player.waitFor(function (message) {
      return message.type === "room:token-created";
    });

    player.send({
      type: "room:create-token",
      payload: { actorId: actorId, sceneId: sceneId, x: 4, y: 2 },
    });

    const update = await canvasUpdate;
    assert.equal(update.payload.canvas.tokens.length, 1);
    assert.equal(update.payload.canvas.tokens[0].actorId, actorId);
    assert.equal(update.payload.canvas.tokens[0].gridX, 4);
    assert.equal(update.payload.canvas.tokens[0].gridY, 2);
    assert.equal(update.payload.createdBy, "token-player");

    const ack = await tokenAck;
    assert.equal(ack.token.actorId, actorId);
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
