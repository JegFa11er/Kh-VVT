import assert from "node:assert/strict";
import test from "node:test";

import {
  HOTBAR_SLOT_KEYS,
  buildMacroChatMessage,
  createMacro,
  hotbarStorageKey,
  isTypingTarget,
  loadHotbar,
  normalizeMacro,
  readMacroFromTransfer,
  saveHotbar,
  slotFromKeyboardEvent,
  setMacroDragData,
} from "../src/ui/hotbar-macros.js";

function dragTransfer(payload) {
  return {
    getData(type) {
      return type === "application/json" ? JSON.stringify(payload) : "";
    },
  };
}

test("hotbar slots are numbered 1..9 then 0", function () {
  assert.deepEqual(HOTBAR_SLOT_KEYS, [
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "0",
  ]);
});

test("hotbar storage is scoped per connected player", function () {
  const gm = hotbarStorageKey("gm-1", "gm");
  const player = hotbarStorageKey("player-7", "player");
  assert.notEqual(gm, player);
  assert.match(gm, /gm-1/);
  assert.match(player, /player-7/);
  // Without a member id the role is the fallback owner.
  assert.match(hotbarStorageKey(null, "gm"), /:gm$/);
});

test("createMacro normalizes the persisted contract", function () {
  const macro = createMacro({
    type: "strike",
    actorId: " actor-a1 ",
    actionId: "longsword",
    name: "  Длинный меч ",
    icon: "/icons/sword.png",
    text: "  /r 1d20+9 Длинный меч — атака ",
  });

  assert.deepEqual(macro, {
    type: "strike",
    actorId: "actor-a1",
    actionId: "longsword",
    name: "Длинный меч",
    icon: "/icons/sword.png",
    text: "/r 1d20+9 Длинный меч — атака",
    plain: false,
    visibility: "public",
    meta: null,
  });
  assert.equal(normalizeMacro(null), null);
  assert.throws(function () {
    createMacro({});
  }, /name or chat text/);
});

test("buildMacroChatMessage mirrors the sheet chat routing", function () {
  const roll = buildMacroChatMessage({
    type: "skill",
    name: "Атлетика",
    text: "/r 1d20+6 Атлетика",
  });
  assert.deepEqual(roll, {
    text: "/r 1d20+6 Атлетика",
    visibility: "public",
  });

  const plain = buildMacroChatMessage({
    type: "action",
    name: "Отдых",
    text: "Отдых",
    plain: true,
  });
  assert.deepEqual(plain, {
    text: "Использует: Отдых",
    visibility: "public",
  });

  const blind = buildMacroChatMessage({
    type: "skill",
    name: "Скрытность (тайно)",
    text: "/r 1d20+3 Скрытность (тайно)",
    visibility: "blind",
  });
  assert.equal(blind.visibility, "blind");
});

test("readMacroFromTransfer accepts hotbar payloads and ignores others", function () {
  const macro = {
    type: "spell",
    actorId: "actor-a1",
    actionId: "fireball",
    name: "Огненный шар",
    text: "/r 6d6 Огненный шар — урон",
  };

  const parsed = readMacroFromTransfer(
    dragTransfer({ type: "pf2e-hotbar-macro", macro: macro }),
  );
  assert.equal(parsed.name, "Огненный шар");
  assert.equal(parsed.actionId, "fireball");

  assert.equal(
    readMacroFromTransfer(
      dragTransfer({ type: "compendium-item", category: "spells", entry: {} }),
    ),
    null,
  );
  assert.equal(readMacroFromTransfer(dragTransfer({ type: "pf2e-hotbar-macro" })), null);
});

test("hotkey mapping ignores modifiers and typing targets", function () {
  assert.equal(slotFromKeyboardEvent({ key: "1" }), "1");
  assert.equal(slotFromKeyboardEvent({ key: "0" }), "0");
  assert.equal(slotFromKeyboardEvent({ key: "5", ctrlKey: true }), null);
  assert.equal(slotFromKeyboardEvent({ key: "a" }), null);

  assert.equal(isTypingTarget({ tagName: "INPUT" }), true);
  assert.equal(isTypingTarget({ tagName: "textarea" }), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: "BUTTON" }), false);
});

test("setMacroDragData writes the payload and lifts the UI over the sheet", function () {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const classes = new Set();
  const data = new Map();
  const dataTransfer = {
    effectAllowed: "",
    setData(key, value) {
      data.set(key, value);
    },
    getData(key) {
      return data.get(key) || "";
    },
  };

  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = {
    body: {
      classList: {
        add(name) {
          classes.add(name);
        },
        remove(name) {
          classes.delete(name);
        },
      },
    },
  };

  try {
    setMacroDragData(
      { dataTransfer },
      {
        type: "skill",
        actorId: "actor-a1",
        actionId: "athletics",
        name: "Атлетика",
        text: "/r 1d20+6 Атлетика",
      },
    );
    assert.equal(classes.has("pf2e-macro-dragging"), true);
    const payload = JSON.parse(data.get("application/json"));
    assert.equal(payload.type, "pf2e-hotbar-macro");
    assert.equal(payload.macro.name, "Атлетика");
    assert.equal(readMacroFromTransfer(dataTransfer).actionId, "athletics");
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test("localStorage helpers degrade gracefully without a browser", function () {
  // Node has no `window`; both calls must be safe no-ops.
  assert.deepEqual(loadHotbar("pf2e.hotbar.v1:test"), {});
  assert.equal(saveHotbar("pf2e.hotbar.v1:test", { 1: { name: "Тест" } }), false);
});
