"use strict";

/**
 * Integration tests for the Step 4.4 chat, dice commands and upload endpoint.
 *
 * Run with: npm run test --workspace=@pf2e/server
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { WebSocket } = require("ws");

const { EncounterSession } = require("../src/room/encounter-session.js");
const serverModule = require("../src/index.js");

const tests = [];

function test(name, handler) {
  tests.push({ name: name, handler: handler });
}

function findMessage(chatLog, id) {
  return chatLog.find(function (message) {
    return message.id === id;
  });
}

// --------------------------------------------------------------- direct tests

test("chat messages use the bound character identity and roll /r commands", function () {
  const session = new EncounterSession({ id: "chat-direct" });
  session.addMember({ id: "gm-1", role: "gm" });
  session.addMember({ id: "player-1", role: "player" });
  session.addCombatant({
    id: "hero",
    name: "Ахах",
    x: 0,
    y: 0,
    alliance: "player",
  });
  session.updateProfile("player-1", {
    name: "Роман",
    color: "#3b9eff",
    characterId: "hero",
  });

  const message = session.addChatMessage("player-1", {
    text: "/r 1d4 удача",
    visibility: "public",
  });

  assert.equal(message.author.name, "Ахах");
  assert.equal(message.author.characterId, "hero");
  assert.equal(message.text, "удача");
  assert.equal(message.dice.formula, "1d4");
  assert.equal(message.dice.rolls.length, 1);
  assert.ok(message.dice.rolls[0] >= 1 && message.dice.rolls[0] <= 4);
  assert.equal(message.dice.total, message.dice.rolls[0]);

  const fallback = session.addChatMessage("player-1", { text: "без персонажа" });
  assert.equal(fallback.author.name, "Ахах");

  session.updateProfile("player-1", { characterId: null });
  const playerMessage = session.addChatMessage("player-1", { text: "привет" });
  assert.equal(playerMessage.author.name, "Роман");
  assert.equal(playerMessage.author.color, "#3b9eff");
});

test("chat visibility is filtered per viewer (gm / blind / self)", function () {
  const session = new EncounterSession({ id: "chat-visibility" });
  session.addMember({ id: "gm-1", role: "gm" });
  session.addMember({ id: "player-1", role: "player" });
  session.addMember({ id: "player-2", role: "player" });

  const publicMessage = session.addChatMessage("player-1", {
    text: "всем",
    visibility: "public",
  });
  const gmMessage = session.addChatMessage("player-1", {
    text: "только мастеру",
    visibility: "gm",
  });
  const blindMessage = session.addChatMessage("player-1", {
    text: "/r 1d20 скрытно",
    visibility: "blind",
  });
  const selfMessage = session.addChatMessage("player-1", {
    text: "себе",
    visibility: "self",
  });

  const gmView = session.getChatLogFor({ id: "gm-1", role: "gm" });
  assert.equal(gmView.length, 4);
  assert.equal(findMessage(gmView, gmMessage.id).text, "только мастеру");
  assert.equal(findMessage(gmView, blindMessage.id).dice.hidden, undefined);
  assert.equal(findMessage(gmView, selfMessage.id).hidden, true);

  const authorView = session.getChatLogFor({ id: "player-1", role: "player" });
  assert.equal(authorView.length, 3, "players must not receive GM-only messages");
  assert.equal(findMessage(authorView, blindMessage.id).dice.rolls.length, 1);
  assert.equal(findMessage(authorView, selfMessage.id).text, "себе");

  const otherView = session.getChatLogFor({ id: "player-2", role: "player" });
  assert.equal(otherView.length, 3);
  assert.equal(findMessage(otherView, publicMessage.id).text, "всем");
  assert.equal(findMessage(otherView, blindMessage.id).hidden, true);
  assert.equal(findMessage(otherView, blindMessage.id).dice.rolls.length, 0);
  assert.equal(findMessage(otherView, selfMessage.id).hidden, true);
});

test("delete and visibility changes respect author/GM permissions", function () {
  const session = new EncounterSession({ id: "chat-permissions" });
  session.addMember({ id: "gm-1", role: "gm" });
  session.addMember({ id: "player-1", role: "player" });
  session.addMember({ id: "player-2", role: "player" });

  const message = session.addChatMessage("player-1", { text: "тест" });

  assert.equal(session.deleteChatMessage("player-2", message.id).ok, false);
  assert.equal(session.setChatVisibility("player-2", message.id, "gm").ok, false);
  assert.equal(session.setChatVisibility("player-1", message.id, "gm").ok, true);
  assert.equal(session.getChatLogFor("player").length, 0);
  assert.equal(session.getChatLogFor("gm").length, 1);
  assert.equal(session.deleteChatMessage("gm-1", message.id).ok, true);
  assert.equal(session.getChatLogFor("gm").length, 0);

  session.addChatMessage("player-1", { text: "one" });
  session.addChatMessage("player-1", { text: "two" });
  assert.equal(session.clearChat(), 2);
  assert.equal(session.chatLog.length, 0);
});

// ------------------------------------------------------------- WebSocket test

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
          rejectWait(new Error("Timed out waiting for WebSocket message."));
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

test("WebSocket chat broadcasts filtered histories and supports clear", async function () {
  await serverModule.startServer(0, "127.0.0.1");
  const address = serverModule.server.address();
  const clients = [];

  try {
    const gm = await openClient(address.port);
    clients.push(gm);
    gm.send({
      type: "join",
      payload: { sessionId: "chat-ws", memberId: "chat-gm", role: "gm" },
    });
    await gm.waitFor(function (message) {
      return message.type === "joined";
    });
    await gm.waitFor(function (message) {
      return message.type === "room:chat-update";
    });

    const player = await openClient(address.port);
    clients.push(player);
    player.send({
      type: "join",
      payload: { sessionId: "chat-ws", memberId: "chat-player", role: "player" },
    });
    await player.waitFor(function (message) {
      return message.type === "joined";
    });
    await player.waitFor(function (message) {
      return message.type === "room:chat-update";
    });
    await gm.waitFor(function (message) {
      return (
        message.type === "room:users-update" &&
        Array.isArray(message.payload.users) &&
        message.payload.users.length === 2
      );
    });

    const gmSeesBlind = gm.waitFor(function (message) {
      return (
        message.type === "room:chat-update" &&
        message.chatLog.some(function (entry) {
          return entry.dice && entry.dice.rolls && entry.dice.rolls.length === 1;
        })
      );
    });
    const playerSeesBlind = player.waitFor(function (message) {
      return (
        message.type === "room:chat-update" &&
        message.chatLog.some(function (entry) {
          return entry.hidden === true;
        })
      );
    });

    // The author (GM) sees the real result; the other player gets the mask.
    gm.send({
      type: "room:chat-message",
      payload: { text: "/r 1d20 тайный бросок", visibility: "blind" },
    });

    const gmLog = (await gmSeesBlind).chatLog;
    assert.equal(gmLog[0].dice.rolls.length, 1);
    const playerLog = (await playerSeesBlind).chatLog;
    assert.equal(playerLog[0].hidden, true);

    const cleared = gm.waitFor(function (message) {
      return message.type === "room:chat-update" && message.chatLog.length === 0;
    });
    gm.send({ type: "room:chat-clear", payload: {} });
    await cleared;
  } finally {
    for (const client of clients) {
      client.close();
    }
    await delay(50);
    await serverModule.closeServer();
  }
});

// ---------------------------------------------------------------- HTTP upload

test("POST /api/upload stores PNG and serves it from /uploads/", async function () {
  await serverModule.startServer(0, "127.0.0.1");
  const address = serverModule.server.address();
  const base = "http://127.0.0.1:" + address.port;

  // 1x1 transparent PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );

  let uploadedFilename = null;
  try {
    const form = new FormData();
    form.append("file", new Blob([png], { type: "image/png" }), "pixel.png");
    const response = await fetch(base + "/api/upload", {
      method: "POST",
      body: form,
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.match(payload.url, /^\/uploads\/chat-.+\.png$/);
    uploadedFilename = payload.filename;

    const imageResponse = await fetch(base + payload.url);
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get("content-type"), "image/png");
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    assert.deepEqual(bytes, png);
  } finally {
    await serverModule.closeServer();
    if (uploadedFilename) {
      try {
        fs.unlinkSync(
          path.join(__dirname, "..", "data", "uploads", uploadedFilename),
        );
      } catch (error) {
        // The assertion path may fail before the file exists.
      }
    }
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
