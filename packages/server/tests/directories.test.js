"use strict";

/**
 * Integration tests for the Step 4.5 directory/combat-tracker state.
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

test("directories create folders, actors, items, journals and journal pages", function () {
  const session = new EncounterSession({ id: "directories-direct" });

  const folder = session.createFolder("actors", {
    name: "Бестиарий",
    color: "#FF0000",
    sortMode: "manual",
  });
  assert.equal(folder.color, "#ff0000");
  assert.equal(folder.sortMode, "manual");

  const actor = session.createDirectoryEntry("actors", {
    name: "Гоблин",
    folderId: folder.id,
    actorType: "npc",
    level: 3,
  });
  assert.equal(actor.folderId, folder.id);
  assert.equal(actor.actorType, "npc");
  assert.equal(actor.level, 3);

  const scene = session.createDirectoryEntry("scenes", { name: "Таверна" });
  assert.equal(scene.name, "Таверна");
  assert.equal(scene.folderId, null);

  const item = session.createDirectoryEntry("items", {
    name: "Меч",
    itemType: "weapon",
  });
  assert.equal(item.itemType, "weapon");

  const journal = session.createDirectoryEntry("journals", { name: "Заметки" });
  const pageA = session.addJournalPage(journal.id, { name: "Первая" });
  const pageB = session.addJournalPage(journal.id, { name: "Вторая" });
  session.updateJournalPage(journal.id, pageA.id, { content: "<b>текст</b>" });
  session.reorderJournalPages(journal.id, [pageB.id, pageA.id]);

  const stored = session.getDirectories().journals.entries[0];
  assert.equal(stored.pages[0].id, pageB.id);
  assert.equal(stored.pages[1].content, "<b>текст</b>");

  const snapshot = session.snapshot();
  assert.ok(snapshot.directories.actors.folders.length === 1);
  assert.ok(snapshot.directories.actors.entries.length === 1);
});

// ------------------------------------------------------------ WebSocket tests

test("WebSocket directory creation broadcasts updated trees", async function () {
  await serverModule.startServer(0, "127.0.0.1");
  const address = serverModule.server.address();
  const clients = [];

  try {
    const gm = await openClient(address.port);
    clients.push(gm);
    gm.send({
      type: "join",
      payload: { sessionId: "directories-ws", memberId: "dir-gm", role: "gm" },
    });
    await gm.waitFor(function (message) {
      return message.type === "joined";
    });

    const folderUpdate = gm.waitFor(function (message) {
      return (
        message.type === "room:directories-update" &&
        message.payload.directories.scenes.folders.length === 1
      );
    });
    gm.send({
      type: "room:create-folder",
      payload: {
        kind: "scenes",
        name: "Город",
        color: "#123456",
        sortMode: "alpha",
      },
    });
    const folderPayload = await folderUpdate;
    const folder = folderPayload.payload.directories.scenes.folders[0];
    assert.equal(folder.name, "Город");

    const actorUpdate = gm.waitFor(function (message) {
      return (
        message.type === "room:directories-update" &&
        message.payload.directories.actors.entries.length === 1
      );
    });
    gm.send({
      type: "room:create-actor",
      payload: { name: "Стражник", actorType: "npc", level: 4 },
    });
    const actorPayload = await actorUpdate;
    assert.equal(actorPayload.payload.directories.actors.entries[0].name, "Стражник");
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
