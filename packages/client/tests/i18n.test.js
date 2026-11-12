import assert from "node:assert/strict";
import test from "node:test";

import {
  formatMessage,
  getLanguage,
  getLanguageRevision,
  loadTranslations,
  normalizeLanguage,
  persistLanguage,
  readStoredLanguage,
  setLanguage,
  subscribeLanguage,
  t,
  translate,
} from "../src/ui/i18n.js";

test("language normalization only accepts ru and en", function () {
  assert.equal(normalizeLanguage("ru"), "ru");
  assert.equal(normalizeLanguage("en"), "en");
  assert.equal(normalizeLanguage("de"), "ru");
  assert.equal(normalizeLanguage(null), "ru");
});

test("EN returns the English fallback or the key", function () {
  setLanguage("en");
  assert.equal(getLanguage(), "en");
  assert.equal(t("PF2E.ArmorClassLabel", "Armor Class"), "Armor Class");
  assert.equal(t("PF2E.ArmorClassLabel"), "PF2E.ArmorClassLabel");
});

test("platform strings translate without the Foundry dictionary", function () {
  setLanguage("ru");
  assert.equal(t("PF2E.Platform.Sidebar.TabScenes", "Scenes"), "Сцены");
  assert.equal(
    t("PF2E.Platform.Compendium.ClearAll", "Clear all filters"),
    "Очистить все фильтры",
  );
  assert.equal(
    t("PF2E.Platform.Scene.Menu.View", "View"),
    "Просмотр",
  );
  assert.equal(
    formatMessage(
      t("PF2E.Platform.Scene.Activate", 'Activate scene "{name}"'),
      { name: "Crypt" },
    ),
    'Активировать сцену "Crypt"',
  );

  setLanguage("en");
  assert.equal(t("PF2E.Platform.Sidebar.TabScenes", "Scenes"), "Scenes");
  assert.equal(
    t("PF2E.Platform.Compendium.ClearAll", "Clear all filters"),
    "Clear all filters",
  );
  assert.equal(t("PF2E.Platform.Scene.Menu.View", "View"), "View");
  setLanguage("ru");
});

test("chat visibility, composer and HUD strings switch RU/EN instantly", function () {
  setLanguage("ru");
  assert.equal(t("PF2E.Platform.Chat.Visibility.Public"), "Публичное");
  assert.equal(t("PF2E.Platform.Chat.Visibility.Gm"), "Только для мастера");
  assert.equal(t("PF2E.Platform.Chat.Visibility.Blind"), "Слепой бросок");
  assert.equal(t("PF2E.Platform.Chat.Visibility.Self"), "Только для себя");
  assert.equal(
    t("PF2E.Platform.Chat.Placeholder"),
    "Сообщение…  /r 1d20  (Shift+Enter — новая строка)",
  );
  assert.equal(
    t("PF2E.Platform.Chat.DropHint"),
    "Перетащите сюда PNG или JPEG, чтобы прикрепить картинку.",
  );
  assert.equal(
    t("PF2E.Platform.Toolbar.Tool.Ruler"),
    "Измерение расстояния",
  );
  assert.equal(
    t("PF2E.Platform.Players.ConfigureHint"),
    "Правый клик: настройка участника",
  );

  setLanguage("en");
  assert.equal(t("PF2E.Platform.Chat.Visibility.Public"), "Public");
  assert.equal(t("PF2E.Platform.Chat.Visibility.Gm"), "GM Only");
  assert.equal(t("PF2E.Platform.Chat.Visibility.Blind"), "Blind Roll");
  assert.equal(t("PF2E.Platform.Chat.Visibility.Self"), "Self Only");
  assert.equal(
    t("PF2E.Platform.Chat.Placeholder"),
    "Message…  /r 1d20  (Shift+Enter for a new line)",
  );
  assert.equal(
    t("PF2E.Platform.Chat.DropHint"),
    "Drop a PNG or JPEG here to attach an image.",
  );
  assert.equal(t("PF2E.Platform.Toolbar.Tool.Ruler"), "Measure Distance");
  assert.equal(
    t("PF2E.Platform.Players.ConfigureHint"),
    "Right-click: configure participant",
  );
  assert.equal(
    formatMessage(t("PF2E.Platform.Chat.RollDice"), { formula: "1d20" }),
    "Roll 1d20",
  );
  assert.equal(t("PF2E.Platform.Common.RenderError"), "Render error");
  setLanguage("ru");
});

test("language changes notify useTranslation subscribers immediately", function () {
  let notifications = 0;
  const unsubscribe = subscribeLanguage(() => {
    notifications += 1;
  });
  const before = getLanguageRevision();
  setLanguage("en");
  assert.equal(notifications, 1);
  assert.ok(getLanguageRevision() > before);
  setLanguage("ru");
  assert.equal(notifications, 2);
  unsubscribe();
  setLanguage("en");
  assert.equal(notifications, 2);
  setLanguage("ru");
});

test("the chosen language is persisted for the next launch", function () {
  const storage = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
    },
  };

  try {
    persistLanguage("en");
    assert.equal(readStoredLanguage(), "en");
    persistLanguage("ru");
    assert.equal(readStoredLanguage(), "ru");
    // Unknown values fall back to the default language.
    storage.set("pf2e.language", "de");
    assert.equal(readStoredLanguage(), "ru");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("RU loads the dotted dictionary and resolves nested keys", async function () {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async function () {
    return {
      ok: true,
      json: async function () {
        return {
          PF2E: {
            ArmorClassLabel: "Класс брони",
            Saves: { Reflex: "Рефлекс" },
          },
        };
      },
    };
  };

  try {
    await loadTranslations("ru");
    setLanguage("ru");
    assert.equal(t("PF2E.ArmorClassLabel", "Armor Class"), "Класс брони");
    assert.equal(translate("PF2E.Saves.Reflex", "Reflex"), "Рефлекс");
    assert.equal(t("PF2E.Missing", "Missing"), "Missing");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
