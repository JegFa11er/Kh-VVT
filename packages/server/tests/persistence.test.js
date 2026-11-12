"use strict";

/**
 * Integration tests for Step 4.7: on-disk session persistence and the
 * level-first compendium sort.
 *
 * Run with: npm run test --workspace=@pf2e/server
 */

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { EncounterSession } = require("../src/room/encounter-session.js");
const { CatalogService } = require("../src/compendium/catalog-service.js");

const tests = [];

function test(name, handler) {
  tests.push({ name: name, handler: handler });
}

function tempFile(name) {
  return path.join(
    os.tmpdir(),
    "pf2e-" + name + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ".json",
  );
}

// --------------------------------------------------------------- persistence

test("saveToDisk/loadFromDisk round-trips directories and chatLog", async function () {
  const file = tempFile("session");
  try {
    const session = new EncounterSession({ id: "persisted", dataFile: file });
    session.addMember({ id: "gm-1", role: "gm" });
    session.addMember({ id: "player-1", role: "player" });

    const folder = session.createFolder("actors", { name: "NPC" });
    session.createDirectoryEntry("actors", {
      name: "Гоблин",
      folderId: folder.id,
      actorType: "npc",
      level: 3,
    });
    const scene = session.createDirectoryEntry("scenes", { name: "Таверна" });
    const journal = session.createDirectoryEntry("journals", { name: "Заметки" });
    const page = session.addJournalPage(journal.id, { name: "Первая" });
    session.updateJournalPage(journal.id, page.id, { content: "<b>тайна</b>" });
    session.addChatMessage("player-1", { text: "Привет", visibility: "public" });

    // Mutations schedule writes; make sure the queue is empty before reading.
    await session.flushPersistence();

    const restored = new EncounterSession({ id: "persisted", dataFile: file });
    const result = await restored.loadFromDisk();
    assert.equal(result.ok, true);

    assert.equal(restored.getDirectories().actors.folders[0].name, "NPC");
    assert.equal(restored.getDirectories().actors.entries[0].name, "Гоблин");
    assert.equal(restored.getDirectories().scenes.entries[0].name, "Таверна");
    assert.equal(restored.chatLog.length, 1);
    assert.equal(restored.chatLog[0].text, "Привет");
    assert.equal(
      restored.getDirectories().journals.entries[0].pages[0].content,
      "<b>тайна</b>",
    );
    assert.ok(scene.id);

    // Sequence counters must advance, otherwise the next entry reuses an id.
    const nextActor = restored.createDirectoryEntry("actors", { name: "Орк" });
    assert.notEqual(nextActor.id, restored.getDirectories().actors.entries[0].id);
  } finally {
    await fs.rm(file, { force: true });
  }
});

test("loadFromDisk reports a missing file instead of throwing", async function () {
  const file = tempFile("missing");
  const session = new EncounterSession({ id: "missing", dataFile: file });
  const result = await session.loadFromDisk();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "file-not-found");
});

test("mutations without a configured dataFile do not touch the disk", async function () {
  const session = new EncounterSession({ id: "memory-only" });
  session.addMember({ id: "gm-1", role: "gm" });
  session.createDirectoryEntry("scenes", { name: "В памяти" });
  session.addChatMessage("gm-1", { text: "hi" });
  // flushPersistence resolves immediately because no write was scheduled.
  await session.flushPersistence();
  assert.equal(session.getDirectories().scenes.entries.length, 1);
});

// ---------------------------------------------------------- world export/import

test("exportWorld/importWorld replaces the campaign and validates root keys", function () {
  const source = new EncounterSession({ id: "export-source" });
  source.createProfile({ name: "GM Source", role: "gm" });
  source.createDirectoryEntry("actors", { name: "Imported Hero" });
  source.createDirectoryEntry("scenes", { name: "Imported Scene" });

  const world = source.exportWorld();
  assert.ok(Array.isArray(world.users));
  assert.ok(world.directories && world.directories.actors);

  const target = new EncounterSession({ id: "import-target" });
  target.createDirectoryEntry("actors", { name: "Old Hero" });

  const result = target.importWorld(world);
  assert.equal(result.ok, true);
  assert.equal(target.getDirectories().actors.entries.length, 1);
  assert.equal(target.getDirectories().actors.entries[0].name, "Imported Hero");
  assert.equal(target.getDirectories().scenes.entries[0].name, "Imported Scene");
  assert.equal(target.getProfiles()[0].name, "GM Source");

  assert.equal(target.importWorld({ directories: {} }).reason, "missing-root-keys");
  assert.equal(
    target.importWorld({ users: [], directories: [] }).reason,
    "invalid-directories",
  );
});

test("catalog service reads en/ru indexes and full files by lang", async function () {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pf2e-catalog-"));
  try {
    const english = [
      { id: "fireball", name: "Fireball", type: "spell", level: 3 },
    ];
    const russian = [
      { id: "fireball", name: "Огненный шар", type: "spell", level: 3 },
    ];
    await fs.writeFile(
      path.join(directory, "spells.en.index.json"),
      JSON.stringify(english),
      "utf8",
    );
    await fs.writeFile(
      path.join(directory, "spells.ru.index.json"),
      JSON.stringify(russian),
      "utf8",
    );
    await fs.writeFile(
      path.join(directory, "spells.en.json"),
      JSON.stringify([{ ...english[0], description: "English text" }]),
      "utf8",
    );
    await fs.writeFile(
      path.join(directory, "spells.ru.json"),
      JSON.stringify([{ ...russian[0], description: "Русский текст" }]),
      "utf8",
    );

    const service = new CatalogService({ directory: directory });
    assert.equal(service.getIndex("spells", {}, "en")[0].name, "Fireball");
    assert.equal(service.getIndex("spells", {}, "ru")[0].name, "Огненный шар");
    assert.equal(service.getItem("spells", "fireball", "ru").description, "Русский текст");
    assert.equal(service.getCategory("spells", "ru").lang, "ru");
    assert.equal(service.listCategories("en")[0].file, "spells.en.json");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ sorting

test("compendium results sort by level first, then alphabetically", function () {
  const entries = [
    { id: "1", name: "Zeta", level: 2 },
    { id: "2", name: "Beta", level: 1 },
    { id: "3", name: "Alpha", level: 2 },
    { id: "4", name: "No Level" },
    { id: "5", name: "Abacus", level: 1 },
  ];

  const sorted = CatalogService.filterIndex(entries, {});
  assert.deepEqual(
    sorted.map(function (entry) {
      return entry.name;
    }),
    ["Abacus", "Beta", "Alpha", "Zeta", "No Level"],
  );
});

test("real spell index is sorted by level then name", function () {
  const service = new CatalogService();
  const entries = service.getIndex("spells", { limit: 250 });
  assert.ok(entries.length > 0);

  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    assert.ok(
      previous.level < current.level ||
        (previous.level === current.level &&
          previous.name.localeCompare(current.name, undefined, {
            numeric: true,
            sensitivity: "base",
          }) <= 0),
      "Unsorted pair: " + previous.name + " (" + previous.level + ") / " +
        current.name + " (" + current.level + ")",
    );
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
