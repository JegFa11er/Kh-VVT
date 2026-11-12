"use strict";

/**
 * Step 6.4/6.5: GM world export/import and bilingual catalog HTTP endpoints.
 *
 * Run with: npm run test --workspace=@pf2e/server
 */

const assert = require("node:assert/strict");

const { WebSocket } = require("ws");

const serverModule = require("../src/index.js");

const tests = [];

function test(name, handler) {
  tests.push({ name: name, handler: handler });
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

test("GM can export/import a world and everyone receives room:reload", async function () {
  await serverModule.startServer(0, "127.0.0.1");
  const address = serverModule.server.address();
  const base = "http://127.0.0.1:" + address.port;
  const sessionId = "world-transfer";
  const clients = [];

  async function createProfile(name, role) {
    const response = await fetch(base + "/api/lobby/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionId, name: name, role: role }),
    });
    assert.equal(response.status, 201);
    return (await response.json()).user;
  }

  try {
    const gmProfile = await createProfile("World GM", "gm");
    const playerProfile = await createProfile("World Player", "player");

    const gm = await openClient(address.port);
    clients.push(gm);
    gm.send({
      type: "join",
      payload: { sessionId: sessionId, memberId: gmProfile.id },
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
    gm.send({ type: "room:create-actor", payload: { name: "Original Hero" } });
    await created;

    const gmExport = await fetch(
      base +
        "/api/lobby/export?sessionId=" +
        encodeURIComponent(sessionId) +
        "&memberId=" +
        encodeURIComponent(gmProfile.id),
    );
    assert.equal(gmExport.status, 200);
    assert.match(
      gmExport.headers.get("content-disposition") || "",
      /world-export\.json/,
    );
    const world = await gmExport.json();
    assert.ok(Array.isArray(world.users));
    assert.ok(world.directories && world.directories.actors);

    const playerExport = await fetch(
      base +
        "/api/lobby/export?sessionId=" +
        encodeURIComponent(sessionId) +
        "&memberId=" +
        encodeURIComponent(playerProfile.id),
    );
    assert.equal(playerExport.status, 403);

    world.directories.actors.entries[0].name = "Imported Hero";
    const reload = gm.waitFor(function (message) {
      return message.type === "room:reload";
    });
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([JSON.stringify(world)], { type: "application/json" }),
      "world-export.json",
    );
    formData.append("sessionId", sessionId);
    formData.append("memberId", gmProfile.id);
    const imported = await fetch(
      base + "/api/lobby/import?sessionId=" + encodeURIComponent(sessionId),
      { method: "POST", body: formData },
    );
    assert.equal(imported.status, 200);
    await reload;

    const session = serverModule.getSession(sessionId);
    assert.equal(
      session.getDirectories().actors.entries[0].name,
      "Imported Hero",
    );
  } finally {
    for (const client of clients) {
      client.close();
    }
    await delay(50);
    await serverModule.closeServer();
  }
});

test("compendium and UI endpoints honor ?lang=ru|en", async function () {
  await serverModule.startServer(0, "127.0.0.1");
  const address = serverModule.server.address();
  const base = "http://127.0.0.1:" + address.port;

  try {
    const english = await fetch(
      base + "/api/compendiums/spells?lang=en&search=Fireball&limit=5",
    );
    assert.equal(english.status, 200);
    const englishEntries = await english.json();
    assert.ok(englishEntries.some(function (entry) {
      return entry.name === "Fireball";
    }));

    const russian = await fetch(
      base +
        "/api/compendiums/spells?lang=ru&search=" +
        encodeURIComponent("Огненный шар") +
        "&limit=5",
    );
    assert.equal(russian.status, 200);
    const russianEntries = await russian.json();
    assert.ok(russianEntries.some(function (entry) {
      return entry.name === "Огненный шар";
    }));

    const detail = await fetch(
      base + "/api/compendiums/spells/" + encodeURIComponent("fireball") + "?lang=ru",
    );
    assert.equal(detail.status, 200);
    const detailPayload = await detail.json();
    assert.equal(detailPayload.name, "Огненный шар");

    const i18n = await fetch(base + "/api/i18n?lang=ru");
    assert.equal(i18n.status, 200);
    const dictionary = await i18n.json();
    assert.equal(dictionary.PF2E.ArmorClassLabel, "Класс брони");
  } finally {
    await serverModule.closeServer();
  }
});

test("equipment API combines rarity/type/category/price filters with AND", async function () {
  await serverModule.startServer(0, "127.0.0.1");
  const address = serverModule.server.address();
  const base = "http://127.0.0.1:" + address.port;

  try {
    const response = await fetch(
      base +
        "/api/compendiums/equipment?lang=en" +
        "&rarity=rare&itemTypes=armor&armorCategories=light" +
        "&priceMin=" +
        encodeURIComponent("0 мм") +
        "&priceMax=" +
        encodeURIComponent("10 зм") +
        "&limit=20",
    );
    assert.equal(response.status, 200);
    const entries = await response.json();
    assert.ok(entries.length > 0, "expected at least one rare light armor");
    for (const entry of entries) {
      assert.equal(entry.type, "armor");
      assert.equal(entry.rarity, "rare");
      assert.equal(entry.category, "light");
    }
    assert.equal(
      response.headers.get("X-Filtered-Count"),
      String(entries.length),
    );

    // A weapon-only category must not leak armor into the result.
    const weaponResponse = await fetch(
      base +
        "/api/compendiums/equipment?lang=en&itemTypes=armor" +
        "&weaponCategories=simple&limit=20",
    );
    assert.equal(weaponResponse.status, 200);
    assert.deepEqual(await weaponResponse.json(), []);
  } finally {
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
