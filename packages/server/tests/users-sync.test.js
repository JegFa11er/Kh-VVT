"use strict";

/**
 * Integration tests for the Step 4.3 player roster sync.
 *
 * Run with: npm run test --workspace=@pf2e/server
 */

const assert = require("node:assert/strict");

const { WebSocket } = require("ws");

const { EncounterSession } = require("../src/room/encounter-session.js");
const serverModule = require("../src/index.js");

const tests = [];

function test(name, handler) {
  tests.push({ name: name, handler: handler });
}

function findUser(users, id) {
  return users.find(function (user) {
    return user.id === id;
  });
}

test("session creates default profiles and broadcasts roster changes", function () {
  const session = new EncounterSession({ id: "users-direct" });
  const events = [];
  const unsubscribe = session.subscribe(function (type, payload) {
    if (type === "room:users-update") {
      events.push(payload.users);
    }
  });

  session.addMember({ id: "gm-1", role: "gm" });
  session.addMember({ id: "player-1", role: "player" });

  let users = session.getUsers();
  assert.equal(users.length, 2);
  assert.equal(findUser(users, "gm-1").name, "Ведущий");
  assert.equal(findUser(users, "gm-1").color, "#f2c94c");
  assert.equal(findUser(users, "player-1").name, "Игрок");
  assert.match(findUser(users, "player-1").color, /^#[0-9a-f]{6}$/i);
  assert.equal(events.length, 2, "each join should broadcast the roster");

  const updated = session.updateProfile("player-1", {
    name: "Ахах",
    color: "#3b9eff",
    pronouns: "она/её",
    characterId: "hero",
  });
  assert.equal(updated.name, "Ахах");
  assert.equal(updated.color, "#3b9eff");
  assert.equal(updated.pronouns, "она/её");
  assert.equal(updated.characterId, "hero");
  assert.equal(events.length, 3, "profile updates should broadcast the roster");
  assert.equal(findUser(events[2], "player-1").name, "Ахах");

  assert.equal(session.snapshot().users.length, 2);
  assert.equal(session.removeMember("player-1"), true);
  assert.equal(session.getUsers().length, 1);
  assert.equal(events.length, 4, "leaving should broadcast the roster");

  unsubscribe();
});

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
      const waiterIndex = waiters.findIndex(function (waiter) {
        return waiter.predicate(message);
      });
      if (waiterIndex !== -1) {
        const waiter = waiters.splice(waiterIndex, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(message);
        return;
      }
      messages.push(message);
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
          rejectWait(
            new Error(
              "Timed out waiting for WebSocket message. Seen: " +
                messages
                  .map(function (message) {
                    return message.type;
                  })
                  .join(", "),
            ),
          );
        }, timeoutMs || 4000);
        waiters.push({ predicate: predicate, resolve: resolveWait, timer: timer });
      });
    }

    ws.once("open", function () {
      resolve({
        ws: ws,
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

test("WebSocket clients receive room:users-update on join, profile edit and leave", async function () {
  await serverModule.startServer(0, "127.0.0.1");
  const address = serverModule.server.address();
  const clients = [];

  try {
    const gm = await openClient(address.port);
    clients.push(gm);
    gm.send({
      type: "join",
      payload: { sessionId: "users-ws", memberId: "users-gm", role: "gm" },
    });
    await gm.waitFor(function (message) {
      return message.type === "joined";
    });
    // Consume the roster update caused by the GM's own join so the later
    // "length === 1" waiter can only match the player leaving.
    await gm.waitFor(function (message) {
      return message.type === "room:users-update" &&
        Array.isArray(message.payload.users) &&
        message.payload.users.length === 1;
    });

    const player = await openClient(address.port);
    clients.push(player);
    player.send({
      type: "join",
      payload: { sessionId: "users-ws", memberId: "users-player", role: "player" },
    });
    const playerJoined = await player.waitFor(function (message) {
      return message.type === "joined";
    });
    assert.equal(playerJoined.payload.session.users.length, 2);

    const joinedRoster = await gm.waitFor(function (message) {
      return message.type === "room:users-update" &&
        Array.isArray(message.payload.users) &&
        message.payload.users.length === 2;
    });
    assert.ok(findUser(joinedRoster.payload.users, "users-gm"));
    assert.ok(findUser(joinedRoster.payload.users, "users-player"));

    const gmUpdate = gm.waitFor(function (message) {
      return message.type === "room:users-update" &&
        findUser(message.payload.users || [], "users-player") &&
        findUser(message.payload.users, "users-player").name === "Ахах";
    });
    player.send({
      type: "room:update-profile",
      payload: {
        name: "Ахах",
        color: "#3b9eff",
        pronouns: "она/её",
        characterId: "hero",
      },
    });

    const playerUpdate = await player.waitFor(function (message) {
      return message.type === "room:users-update" &&
        findUser(message.payload.users || [], "users-player") &&
        findUser(message.payload.users, "users-player").name === "Ахах";
    });
    assert.equal(
      findUser(playerUpdate.payload.users, "users-player").color,
      "#3b9eff",
    );
    const broadcast = await gmUpdate;
    assert.equal(findUser(broadcast.payload.users, "users-player").pronouns, "она/её");

    const leaveUpdate = gm.waitFor(function (message) {
      return message.type === "room:users-update" &&
        Array.isArray(message.payload.users) &&
        message.payload.users.length === 1;
    });
    player.close();
    const left = await leaveUpdate;
    assert.equal(left.payload.users[0].id, "users-gm");
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
