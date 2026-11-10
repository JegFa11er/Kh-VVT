"use strict";

/**
 * Step 4.8 (Part 1): character-sheet actor persistence.
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
    "pf2e-actor-" + name + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ".json",
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

test("updateActor replaces the sheet payload and updates the directory level", function () {
  const session = new EncounterSession({ id: "actor-direct" });
  session.addMember({ id: "gm-1", role: "gm" });
  const actor = session.createDirectoryEntry("actors", {
    name: "Амелия",
    actorType: "character",
  });

  const updated = session.updateActor(
    actor.id,
    {
      name: "Амелия Лорн",
      system: {
        details: { level: { value: 5 }, xp: { value: 120, max: 1000 } },
        attributes: {
          hp: { value: 54, max: 60, temp: 5 },
          immunities: [{ type: "fire", exceptions: "magical" }],
        },
      },
    },
    "gm-1",
    "gm",
  );

  assert.equal(updated.name, "Амелия Лорн");
  assert.equal(updated.level, 5);
  assert.equal(updated.system.attributes.hp.value, 54);
  assert.deepEqual(updated.system.attributes.immunities, [
    { type: "fire", exceptions: "magical" },
  ]);

  const stored = session.getDirectories().actors.entries.find(function (entry) {
    return entry.id === actor.id;
  });
  assert.equal(stored.name, "Амелия Лорн");
  assert.equal(stored.system.details.level.value, 5);
});

test("actor sheet ownership: owner edits own actor, other players are rejected", function () {
  const session = new EncounterSession({ id: "actor-permissions" });
  session.addMember({ id: "gm-1", role: "gm" });
  session.addMember({ id: "p-1", role: "player" });
  session.addMember({ id: "p-2", role: "player" });
  const actor = session.createDirectoryEntry("actors", { name: "Рыцарь" });

  session.updateProfile("p-1", { characterId: actor.id });

  assert.doesNotThrow(function () {
    session.updateActor(
      actor.id,
      { system: { attributes: { hp: { value: 20, max: 20, temp: 0 } } } },
      "p-1",
      "player",
    );
  });

  assert.throws(
    function () {
      session.updateActor(
        actor.id,
        { system: { attributes: { hp: { value: 1, max: 20, temp: 0 } } } },
        "p-2",
        "player",
      );
    },
    /Only the owner or the GM/,
  );

  assert.doesNotThrow(function () {
    session.updateActor(
      actor.id,
      { system: { attributes: { hp: { value: 0, max: 20, temp: 0 } } } },
      "gm-1",
      "gm",
    );
  });
});

test("chat identity resolves a directory actor linked from the player profile", function () {
  const session = new EncounterSession({ id: "actor-chat" });
  session.addMember({ id: "gm-1", role: "gm" });
  session.addMember({ id: "p-1", role: "player" });
  const actor = session.createDirectoryEntry("actors", { name: "Лиан" });
  session.updateProfile("p-1", { characterId: actor.id });
  const message = session.addChatMessage("p-1", { text: "Привет", visibility: "public" });
  assert.equal(message.author.name, "Лиан");
  assert.equal(message.author.characterName, "Лиан");
  assert.equal(message.author.characterId, actor.id);
});

test("actor sheets survive saveToDisk/loadFromDisk", async function () {
  const file = tempFile("roundtrip");
  try {
    const session = new EncounterSession({ id: "actor-persist", dataFile: file });
    session.addMember({ id: "gm-1", role: "gm" });
    const actor = session.createDirectoryEntry("actors", { name: "Сора" });
    session.updateActor(
      actor.id,
      {
        name: "Сора",
        system: {
          details: { level: { value: 3 } },
          attributes: {
            hp: { value: 31, max: 38, temp: 0 },
            ac: { value: 19 },
            immunities: [{ type: "poison" }],
            weaknesses: [{ type: "cold", value: 5 }],
            resistances: [{ type: "physical", value: 3, exceptions: "silver" }],
          },
          details_ext: { languages: { value: ["Всеобщий", "Драконий"] } },
        },
      },
      "gm-1",
      "gm",
    );
    await session.flushPersistence();

    const restored = new EncounterSession({ id: "actor-persist", dataFile: file });
    const result = await restored.loadFromDisk();
    assert.equal(result.ok, true);
    const stored = restored.getDirectories().actors.entries[0];
    assert.equal(stored.system.attributes.hp.max, 38);
    assert.equal(stored.system.attributes.immunities[0].type, "poison");
    assert.deepEqual(stored.system.details_ext.languages.value, [
      "Всеобщий",
      "Драконий",
    ]);
  } finally {
    await fs.rm(file, { force: true });
  }
});

test("WebSocket room:update-actor broadcasts the persisted sheet", async function () {
  await serverModule.startServer(0, "127.0.0.1");
  const address = serverModule.server.address();
  const clients = [];
  try {
    const gm = await openClient(address.port);
    clients.push(gm);
    gm.send({
      type: "join",
      payload: { sessionId: "actor-ws", memberId: "actor-gm", role: "gm" },
    });
    await gm.waitFor(function (message) {
      return message.type === "joined";
    });

    const created = gm.waitFor(function (message) {
      return (
        message.type === "room:directories-update" &&
        message.payload.directories.actors.entries.length === 1
      );
    });
    gm.send({ type: "room:create-actor", payload: { name: "Тэлин" } });
    const createdPayload = await created;
    const actorId =
      createdPayload.payload.directories.actors.entries[0].id;

    const updated = gm.waitFor(function (message) {
      return (
        message.type === "room:directories-update" &&
        message.payload.directories.actors.entries[0].system?.attributes?.hp?.value === 12
      );
    });
    gm.send({
      type: "room:update-actor",
      payload: {
        actorId: actorId,
        system: {
          attributes: { hp: { value: 12, max: 18, temp: 0 } },
          details: { level: { value: 2 } },
        },
      },
    });

    const updatedPayload = await updated;
    const actor = updatedPayload.payload.directories.actors.entries[0];
    assert.equal(actor.system.attributes.hp.value, 12);
    assert.equal(actor.level, 2);
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
