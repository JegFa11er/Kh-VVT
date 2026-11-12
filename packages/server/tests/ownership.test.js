"use strict";

/**
 * Phase 6.1/6.2: persistent lobby profiles and the actor ownership matrix.
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
    "pf2e-ownership-" +
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

function actorFromDirectories(payload) {
  return payload.payload.directories.actors.entries[0];
}

// --------------------------------------------------------------- direct tests

test("ownership matrix supports none/limited/observer/owner and GM override", function () {
  const session = new EncounterSession({ id: "ownership-direct" });
  const gm = session.createProfile({ name: "Мастер", role: "gm" });
  const alice = session.createProfile({ name: "Алиса", role: "player" });
  const bob = session.createProfile({ name: "Боб", role: "player" });

  session.addMember({ id: gm.id, role: "gm" });
  session.addMember({ id: alice.id, role: "player" });
  session.addMember({ id: bob.id, role: "player" });

  const actor = session.createDirectoryEntry("actors", { name: "Герой" });
  assert.deepEqual(actor.ownership, { default: 0 });
  assert.equal(session.getActorPermission(actor.id, alice.id, "player"), 0);
  assert.equal(session.getActorPermission(actor.id, gm.id, "gm"), 3);

  session.setActorOwnership(
    actor.id,
    {
      default: 0,
      [alice.id]: 3,
      [bob.id]: 2,
      "ghost-user": 3,
    },
    gm.id,
    "gm",
  );
  const stored = session.getDirectories().actors.entries[0];
  assert.equal(stored.ownership[alice.id], 3);
  assert.equal(stored.ownership[bob.id], 2);
  assert.equal(stored.ownership["ghost-user"], undefined, "unknown ids dropped");

  assert.equal(session.getActorPermission(actor.id, bob.id, "player"), 2);

  assert.doesNotThrow(function () {
    session.updateActor(
      actor.id,
      { system: { attributes: { hp: { value: 10, max: 20, temp: 0 } } } },
      alice.id,
      "player",
    );
  });

  assert.throws(
    function () {
      session.updateActor(actor.id, { name: "Hack" }, bob.id, "player");
    },
    /Only the owner or the GM/,
  );

  assert.throws(
    function () {
      session.updateActor(
        actor.id,
        { ownership: { default: 0, [bob.id]: 3 } },
        alice.id,
        "player",
      );
    },
    /Only the GM can change actor ownership/,
  );

  assert.doesNotThrow(function () {
    session.updateActor(actor.id, { ownership: { default: 2 } }, gm.id, "gm");
  });
  assert.equal(session.getActorPermission(actor.id, bob.id, "player"), 2);
});

test("default row grants observer access but never edit access", function () {
  const session = new EncounterSession({ id: "ownership-default" });
  session.addMember({ id: "gm-1", role: "gm" });
  session.addMember({ id: "p-1", role: "player" });
  const actor = session.createDirectoryEntry("actors", { name: "Общий" });
  session.updateActor(actor.id, { ownership: { default: 2 } }, "gm-1", "gm");

  assert.equal(session.getActorPermission(actor.id, "p-1", "player"), 2);
  assert.throws(
    function () {
      session.updateActor(actor.id, { name: "Nope" }, "p-1", "player");
    },
    /Only the owner or the GM/,
  );
});

test("linking characterId can never escalate ownership", function () {
  const session = new EncounterSession({ id: "ownership-escalation" });
  session.addMember({ id: "gm-1", role: "gm" });
  session.addMember({ id: "p-1", role: "player" });
  const actor = session.createDirectoryEntry("actors", { name: "Закрытый" });

  session.updateProfile("p-1", { characterId: actor.id });
  assert.equal(session.getActorPermission(actor.id, "p-1", "player"), 0);
  assert.throws(
    function () {
      session.updateActor(actor.id, { name: "Взлом" }, "p-1", "player");
    },
    /Only the owner or the GM/,
  );
});

test("profiles and ownership survive saveToDisk/loadFromDisk", async function () {
  const file = tempFile("roundtrip");
  try {
    const session = new EncounterSession({ id: "ownership-persist", dataFile: file });
    const gm = session.createProfile({ name: "Мастер", role: "gm" });
    const player = session.createProfile({ name: "Сора", role: "player" });
    session.addMember({ id: gm.id, role: "gm" });
    const actor = session.createDirectoryEntry("actors", { name: "Сора" });
    session.setActorOwnership(
      actor.id,
      { default: 0, [player.id]: 3, [gm.id]: 3 },
      gm.id,
      "gm",
    );
    await session.flushPersistence();

    const restored = new EncounterSession({ id: "ownership-persist", dataFile: file });
    const result = await restored.loadFromDisk();
    assert.equal(result.ok, true);
    assert.deepEqual(
      restored.getProfiles().map((profile) => [profile.id, profile.name, profile.role]),
      [
        [gm.id, "Мастер", "gm"],
        [player.id, "Сора", "player"],
      ],
    );
    const loadedActor = restored.getDirectories().actors.entries[0];
    assert.deepEqual(loadedActor.ownership, {
      default: 0,
      [player.id]: 3,
      [gm.id]: 3,
    });
    assert.equal(restored.getActorPermission(loadedActor.id, player.id, "player"), 3);
  } finally {
    await fs.rm(file, { force: true });
  }
});

test("lobby HTTP creates profiles and WS ownership updates are enforced", async function () {
  await serverModule.startServer(0, "127.0.0.1");
  const address = serverModule.server.address();
  const base = "http://127.0.0.1:" + address.port;
  const sessionId = "ownership-ws";
  const clients = [];

  async function createProfile(name, role) {
    const response = await fetch(base + "/api/lobby/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionId, name: name, role: role }),
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    return payload.user;
  }

  try {
    const gmProfile = await createProfile("Ведущий Тест", "gm");
    const playerProfile = await createProfile("Игрок Тест", "player");
    const outsiderProfile = await createProfile("Чужой", "player");

    const lobby = await fetch(
      base + "/api/lobby?sessionId=" + encodeURIComponent(sessionId),
    );
    assert.equal(lobby.status, 200);
    const lobbyPayload = await lobby.json();
    assert.equal(lobbyPayload.users.length, 3);

    const gm = await openClient(address.port);
    clients.push(gm);
    gm.send({
      type: "join",
      payload: { sessionId: sessionId, memberId: gmProfile.id, role: "player" },
    });
    const joined = await gm.waitFor(function (message) {
      return message.type === "joined";
    });
    // The persistent profile, not the spoofed payload role, is authoritative.
    assert.equal(joined.payload.member.role, "gm");

    const player = await openClient(address.port);
    clients.push(player);
    player.send({
      type: "join",
      payload: { sessionId: sessionId, memberId: playerProfile.id },
    });
    await player.waitFor(function (message) {
      return message.type === "joined";
    });

    const outsider = await openClient(address.port);
    clients.push(outsider);
    outsider.send({
      type: "join",
      payload: { sessionId: sessionId, memberId: outsiderProfile.id },
    });
    await outsider.waitFor(function (message) {
      return message.type === "joined";
    });

    const created = gm.waitFor(function (message) {
      return (
        message.type === "room:directories-update" &&
        message.payload.directories.actors.entries.length === 1
      );
    });
    gm.send({ type: "room:create-actor", payload: { name: "Носитель" } });
    const actorId = actorFromDirectories(await created).id;

    const ownershipBroadcast = player.waitFor(function (message) {
      const actors =
        message.type === "room:directories-update"
          ? message.payload.directories.actors.entries
          : [];
      return (
        actors.length === 1 &&
        actors[0].ownership &&
        actors[0].ownership[playerProfile.id] === 3
      );
    });
    gm.send({
      type: "room:update-actor",
      payload: {
        actorId: actorId,
        ownership: {
          default: 0,
          [gmProfile.id]: 3,
          [playerProfile.id]: 3,
        },
      },
    });
    const ownership = await ownershipBroadcast;
    assert.equal(actorFromDirectories(ownership).ownership[playerProfile.id], 3);

    const playerEdit = gm.waitFor(function (message) {
      return (
        message.type === "room:directories-update" &&
        message.payload.directories.actors.entries[0].system?.attributes?.hp
          ?.value === 9
      );
    });
    player.send({
      type: "room:update-actor",
      payload: {
        actorId: actorId,
        system: { attributes: { hp: { value: 9, max: 18, temp: 0 } } },
      },
    });
    await playerEdit;

    const denied = outsider.waitFor(function (message) {
      return message.type === "error";
    });
    outsider.send({
      type: "room:update-actor",
      payload: {
        actorId: actorId,
        system: { attributes: { hp: { value: 1, max: 18, temp: 0 } } },
      },
    });
    const denial = await denied;
    assert.match(denial.payload.message, /Only the owner or the GM/);
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
