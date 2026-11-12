/**
 * Step 6.5: minimal interface localisation helper.
 *
 * The server exposes the Foundry-compatible `pf2e.json` dictionary through
 * `GET /api/i18n?lang=ru`. Keys use the familiar dotted path:
 *
 *   t("PF2E.ArmorClassLabel") -> "Класс брони"
 *
 * English returns the optional English fallback (or the key itself), because
 * the compendium build only ships a Russian interface dictionary. The module
 * keeps one global language so plain JS modules can call `t()` without React.
 *
 * Step 6.7: `useTranslation()` is the React-facing wrapper. It subscribes to
 * the global language revision (published by StoreContext whenever the user
 * changes the Settings language) so every component that calls `t()` re-renders
 * immediately, without a page reload.
 */

import { useSyncExternalStore } from "react";

export const SUPPORTED_LANGUAGES = Object.freeze(["ru", "en"]);
export const DEFAULT_LANGUAGE = "ru";
export const LANGUAGE_STORAGE_KEY = "pf2e.language";

/**
 * Step 6.8: platform strings that do not exist in the official Foundry
 * `pf2e.json` dictionary (Scenes, Combat, Journals, Settings, compendium
 * filter captions, scene context-menu items, ...).
 *
 * Values are `[ru, en]`. `translate()` consults this table before the loaded
 * Foundry dictionary, so the VTT chrome follows the RU/EN switch even when no
 * `/api/i18n` response is available (for example before the first fetch or in
 * unit tests).
 */
export const PLATFORM_TRANSLATIONS = Object.freeze({
  // ----------------------------------------------------------- common chrome
  "PF2E.Platform.Common.Close": ["Закрыть", "Close"],
  "PF2E.Platform.Common.Cancel": ["Отмена", "Cancel"],
  "PF2E.Platform.Common.Create": ["Создать", "Create"],
  "PF2E.Platform.Common.Delete": ["Удалить", "Delete"],
  "PF2E.Platform.Common.Name": ["Название", "Name"],
  "PF2E.Platform.Common.Folder": ["Папка", "Folder"],
  "PF2E.Platform.Common.NoFolder": ["Без папки", "No folder"],
  "PF2E.Platform.Common.Search": ["Поиск", "Search"],
  "PF2E.Platform.Common.Loading": ["Загрузка…", "Loading…"],
  "PF2E.Platform.Common.NothingFound": ["Ничего не найдено.", "Nothing found."],
  "PF2E.Platform.Common.None": ["Нет", "None"],
  "PF2E.Platform.Common.Yes": ["Да", "Yes"],
  "PF2E.Platform.Common.No": ["Нет", "No"],
  "PF2E.Platform.Common.GMOnly": ["Только Мастер", "GM only"],
  "PF2E.Platform.Common.RenderError": ["Ошибка рендера", "Render error"],
  "PF2E.Platform.Common.Retry": ["Повторить", "Retry"],

  // ---------------------------------------------------------------- chat
  "PF2E.Platform.Chat.Title": ["Чат", "Chat"],
  "PF2E.Platform.Chat.MessagesTitle": ["Сообщений в логе", "Messages in the log"],
  "PF2E.Platform.Chat.Empty": [
    "Сообщений пока нет. Введите текст или бросьте кубик из HUD.",
    "No messages yet. Type a message or roll dice from the HUD.",
  ],
  "PF2E.Platform.Chat.Placeholder": [
    "Сообщение…  /r 1d20  (Shift+Enter — новая строка)",
    "Message…  /r 1d20  (Shift+Enter for a new line)",
  ],
  "PF2E.Platform.Chat.DropHint": [
    "Перетащите сюда PNG или JPEG, чтобы прикрепить картинку.",
    "Drop a PNG or JPEG here to attach an image.",
  ],
  "PF2E.Platform.Chat.Uploading": [
    "Загрузка изображения…",
    "Uploading image…",
  ],
  "PF2E.Platform.Chat.VisibilityAria": [
    "Видимость сообщения",
    "Message visibility",
  ],
  "PF2E.Platform.Chat.Visibility.Public": ["Публичное", "Public"],
  "PF2E.Platform.Chat.Visibility.Gm": [
    "Только для мастера",
    "GM Only",
  ],
  "PF2E.Platform.Chat.Visibility.Blind": [
    "Слепой бросок",
    "Blind Roll",
  ],
  "PF2E.Platform.Chat.Visibility.Self": [
    "Только для себя",
    "Self Only",
  ],
  "PF2E.Platform.Chat.Visibility.PublicTitle": [
    "Публичное сообщение — видят все",
    "Public message — everyone can see it",
  ],
  "PF2E.Platform.Chat.Visibility.GmTitle": [
    "Только для мастера — видят только мастера",
    "GM only — only the GM can see it",
  ],
  "PF2E.Platform.Chat.Visibility.BlindTitle": [
    "Слепой бросок: результат видят мастер и автор",
    "Blind roll: the GM and the author see the result",
  ],
  "PF2E.Platform.Chat.Visibility.SelfTitle": [
    "Только для себя — сообщение видит только автор",
    "Self only — only the author can see this message",
  ],
  "PF2E.Platform.Chat.Clear": ["Очистить чат", "Clear chat"],
  "PF2E.Platform.Chat.ClearTitle": ["Очистка чата", "Clear Chat"],
  "PF2E.Platform.Chat.ClearQuestion": [
    "Вы уверены, что хотите очистить весь чат?",
    "Are you sure you want to clear the entire chat?",
  ],
  "PF2E.Platform.Chat.ClearGmOnly": [
    "Очистить весь чат (только мастер)",
    "Clear the entire chat (GM only)",
  ],
  "PF2E.Platform.Chat.Send": ["Отправить сообщение", "Send message"],
  "PF2E.Platform.Chat.SendTitle": [
    "Отправить сообщение (Enter)",
    "Send message (Enter)",
  ],
  "PF2E.Platform.Chat.DeleteMessage": [
    "Удалить сообщение",
    "Delete message",
  ],
  "PF2E.Platform.Chat.Pinned": ["Закреплено", "Pinned"],
  "PF2E.Platform.Chat.Unpin": ["Открепить сообщение", "Unpin message"],
  "PF2E.Platform.Chat.MakePrivate": [
    "Сделать приватным",
    "Make private",
  ],
  "PF2E.Platform.Chat.HiddenContent": [
    "Содержимое скрыто настройками видимости",
    "Content hidden by the visibility settings",
  ],
  "PF2E.Platform.Chat.HiddenMessage": [
    "Скрытое сообщение",
    "Hidden message",
  ],
  "PF2E.Platform.Chat.ImageAlt": [
    "Изображение из чата",
    "Chat image",
  ],
  "PF2E.Platform.Chat.CharacterPrefix": ["Персонаж", "Character"],
  "PF2E.Platform.Chat.HiddenResult": [
    "Результат скрыт",
    "Result hidden",
  ],
  "PF2E.Platform.Chat.Expand": ["Развернуть чат", "Expand chat"],
  "PF2E.Platform.Chat.Collapse": ["Свернуть чат", "Collapse chat"],
  "PF2E.Platform.Chat.QuickInput": [
    "Быстрый ввод чата",
    "Quick chat input",
  ],
  "PF2E.Platform.Chat.QuickPlaceholder": [
    "Сообщение… или /r 1d20",
    "Message… or /r 1d20",
  ],
  "PF2E.Platform.Chat.QuickExpand": [
    "Развернуть панель чата",
    "Expand the chat panel",
  ],
  "PF2E.Platform.Chat.RollDice": ["Бросить {formula}", "Roll {formula}"],
  "PF2E.Platform.Chat.Save.Fortitude": ["Стойкость", "Fortitude"],
  "PF2E.Platform.Chat.Save.Reflex": ["Реакция", "Reflex"],
  "PF2E.Platform.Chat.Save.Will": ["Воля", "Will"],
  "PF2E.Platform.Chat.Save.Default": ["Спасбросок", "Saving Throw"],
  "PF2E.Platform.Chat.SaveTitle": [
    'Бросить спасбросок "{save}" для каждого выделенного токена против КС {dc}',
    'Roll a {save} save for each selected token against DC {dc}',
  ],
  "PF2E.Platform.Chat.DamageTitle": [
    "Бросить урон: {formula}",
    "Roll damage: {formula}",
  ],
  "PF2E.Platform.Chat.DamageButton": [
    "Бросить урон: {formula}",
    "Roll damage: {formula}",
  ],
  "PF2E.Platform.Chat.SelectToken": [
    "Выделите хотя бы один токен на сцене, чтобы бросить спасбросок.",
    "Select at least one token on the scene to roll a save.",
  ],
  "PF2E.Platform.Chat.DamageLabel": ["урон", "damage"],
  "PF2E.Platform.Chat.DamageName": ["Урон", "Damage"],
  "PF2E.Platform.Chat.DCShort": ["КС", "DC"],
  "PF2E.Platform.Chat.NoConnection": [
    "Нет соединения с сервером.",
    "No connection to the server.",
  ],
  "PF2E.Platform.Chat.SendFailed": [
    "Не удалось отправить сообщение.",
    "Failed to send the message.",
  ],
  "PF2E.Platform.Chat.ImageOnly": [
    "Можно перетаскивать только изображения PNG или JPEG.",
    "Only PNG or JPEG images can be dropped here.",
  ],
  "PF2E.Platform.Chat.UploadFailed": [
    "Не удалось загрузить изображение.",
    "Failed to upload the image.",
  ],

  // ------------------------------------------------------- players / HUD
  "PF2E.Platform.Players.Title": ["Игроки", "Players"],
  "PF2E.Platform.Players.Aria": [
    "Подключённые игроки",
    "Connected players",
  ],
  "PF2E.Platform.Players.Waiting": [
    "Ожидание подключения…",
    "Waiting for players…",
  ],
  "PF2E.Platform.Players.RoleGm": ["Ведущий", "Game Master"],
  "PF2E.Platform.Players.RolePlayer": ["Игрок", "Player"],
  "PF2E.Platform.Players.ConfigureHint": [
    "Правый клик: настройка участника",
    "Right-click: configure participant",
  ],
  "PF2E.Platform.Players.Configure": [
    "Настройка участника",
    "Configure participant",
  ],

  // --------------------------------------------------------------- sidebar
  "PF2E.Platform.Sidebar.RightPanel": ["Правая панель", "Right panel"],
  "PF2E.Platform.Sidebar.Navigation": ["Навигация", "Navigation"],
  "PF2E.Platform.Sidebar.Collapse": ["Свернуть панель", "Collapse panel"],
  "PF2E.Platform.Sidebar.Expand": ["Развернуть панель", "Expand panel"],
  "PF2E.Platform.Sidebar.TabChat": ["Чат", "Chat"],
  "PF2E.Platform.Sidebar.TabCombat": ["Столкновения", "Combat"],
  "PF2E.Platform.Sidebar.TabScenes": ["Сцены", "Scenes"],
  "PF2E.Platform.Sidebar.TabActors": ["Актёры", "Actors"],
  "PF2E.Platform.Sidebar.TabItems": ["Предметы", "Items"],
  "PF2E.Platform.Sidebar.TabJournals": ["Журналы", "Journals"],
  "PF2E.Platform.Sidebar.TabLibraries": ["Библиотеки", "Libraries"],
  "PF2E.Platform.Sidebar.TabSettings": ["Настройки", "Settings"],
  "PF2E.Platform.Sidebar.ActorNotSynced": [
    "Актёр ещё не синхронизирован.",
    "Actor is not synchronized yet.",
  ],
  "PF2E.Platform.Sidebar.AccessDenied": ["Нет доступа", "Access denied"],

  // --------------------------------------------------------------- toolbar
  "PF2E.Platform.Toolbar.Aria": ["Панель инструментов", "Toolbar"],
  "PF2E.Platform.Toolbar.Collapsed": [
    "панель инструментов свёрнута",
    "toolbar collapsed",
  ],
  "PF2E.Platform.Toolbar.ChooseTool": [
    "выберите инструмент справа",
    "choose a tool on the right",
  ],
  "PF2E.Platform.Toolbar.NoConnectionRoll": [
    "Нет соединения: бросок {formula} не отправлен",
    "No connection: roll {formula} was not sent",
  ],
  "PF2E.Platform.Toolbar.RollFailed": [
    "Не удалось отправить бросок {formula}",
    "Failed to send roll {formula}",
  ],
  "PF2E.Platform.Toolbar.RollSent": [
    "Бросок {formula} отправлен в чат",
    "Roll {formula} sent to chat",
  ],
  "PF2E.Platform.Toolbar.ClearDrawingsConfirm": [
    "Очистка рисунков: подтвердите действие в диалоге",
    "Clear drawings: confirm the action in the dialog",
  ],
  "PF2E.Platform.Toolbar.ClearWallsConfirm": [
    "Очистка стен: подтвердите действие в диалоге",
    "Clear walls: confirm the action in the dialog",
  ],
  "PF2E.Platform.Toolbar.ClearLightsConfirm": [
    "Очистка света: подтвердите действие в диалоге",
    "Clear lights: confirm the action in the dialog",
  ],
  "PF2E.Platform.Toolbar.FogReset": [
    "Туман войны сброшен: карта снова полностью чёрная",
    "Fog of war reset: the map is fully black again",
  ],
  "PF2E.Platform.Toolbar.GmVision": ["Зрение мастера", "GM Vision"],
  "PF2E.Platform.Toolbar.Enabled": ["включено", "enabled"],
  "PF2E.Platform.Toolbar.Disabled": ["выключено", "disabled"],
  "PF2E.Platform.Toolbar.SceneLighting": [
    "Освещение сцены: {label}",
    "Scene lighting: {label}",
  ],
  "PF2E.Platform.Toolbar.PaletteColor": [
    "Палитра: выбран цвет {color}",
    "Palette: selected color {color}",
  ],
  "PF2E.Platform.Toolbar.DoorLockedHint": [
    "Дверь заперта: игроки не могут открыть её (ПКМ — снять замок)",
    "Door locked: players cannot open it (right-click to unlock)",
  ],
  "PF2E.Platform.Toolbar.DoorHint": [
    "Дверь: ЛКМ — открыть/закрыть, ПКМ — запереть на замок",
    "Door: left-click to open/close, right-click to lock",
  ],
  "PF2E.Platform.Toolbar.DoorLocked": [
    "Дверь заперта на замок: игроки не смогут открыть её",
    "Door locked: players cannot open it",
  ],
  "PF2E.Platform.Toolbar.DoorUnlocked": [
    "Замок двери снят: игроки снова могут открывать дверь",
    "Door unlocked: players can open it again",
  ],
  "PF2E.Platform.Toolbar.DrawingColor": [
    "Цвет рисунков: {color}",
    "Drawing color: {color}",
  ],
  "PF2E.Platform.Toolbar.Currently": ["Сейчас", "Currently"],
  "PF2E.Platform.Toolbar.DiceMatrix": [
    "Матрица бросков кубиков",
    "Dice roll matrix",
  ],
  "PF2E.Platform.Toolbar.Type": ["Тип", "Type"],
  "PF2E.Platform.Toolbar.Count": ["Количество", "Count"],
  "PF2E.Platform.Toolbar.RollOne": ["Бросить 1d{sides}", "Roll 1d{sides}"],
  "PF2E.Platform.Toolbar.RollMany": [
    "Бросить {count}d{sides}",
    "Roll {count}d{sides}",
  ],
  "PF2E.Platform.Toolbar.DrawingColors": ["Цвет рисунков", "Drawing colors"],
  "PF2E.Platform.Toolbar.SwatchTitle": [
    "Цвет обводки/заливки: {color}",
    "Stroke/fill color: {color}",
  ],
  "PF2E.Platform.Toolbar.ChooseColor": [
    "Выбрать цвет {color}",
    "Choose color {color}",
  ],

  // Toolbar categories.
  "PF2E.Platform.Toolbar.Category.Token": ["Токены", "Tokens"],
  "PF2E.Platform.Toolbar.Category.TokenDesc": [
    "Управление токенами: выделение и линейка расстояния.",
    "Token controls: selection and distance measurement.",
  ],
  "PF2E.Platform.Toolbar.Category.Draw": ["Рисование", "Drawing"],
  "PF2E.Platform.Toolbar.Category.DrawDesc": [
    "Рисование на сцене: фигуры, полигоны, текст и палитра.",
    "Draw on the scene: shapes, polygons, text and palette.",
  ],
  "PF2E.Platform.Toolbar.Category.Wall": ["Стены", "Walls"],
  "PF2E.Platform.Toolbar.Category.WallDesc": [
    "Стены и двери: блокировка движения, зрения и слуха; ландшафтные и секретные стены.",
    "Walls and doors: block movement, sight and sound; terrain and secret walls.",
  ],
  "PF2E.Platform.Toolbar.Category.Light": ["Освещение", "Lighting"],
  "PF2E.Platform.Toolbar.Category.LightDesc": [
    "Освещение: источники света, уровень тьмы сцены и зрение мастера.",
    "Lighting: light sources, scene darkness and GM vision.",
  ],
  "PF2E.Platform.Toolbar.Category.Dice": ["Кубики", "Dice"],
  "PF2E.Platform.Toolbar.Category.DiceDesc": [
    "Матрица бросков: выберите тип кубика слева и количество справа.",
    "Dice matrix: choose a die type on the left and a count on the right.",
  ],

  // Toolbar tools.
  "PF2E.Platform.Toolbar.Tool.SelectTokens": ["Выбор токенов", "Select Tokens"],
  "PF2E.Platform.Toolbar.Tool.SelectTokensDesc": [
    "Выделение токена кликом или рамкой.",
    "Select a token with a click or a selection box.",
  ],
  "PF2E.Platform.Toolbar.Tool.Ruler": [
    "Измерение расстояния",
    "Measure Distance",
  ],
  "PF2E.Platform.Toolbar.Tool.RulerDesc": [
    "Линейка замера дистанции по сетке PF2e (правило 5-10-5 футов).",
    "Measure distance on the PF2e grid (5-10-5 feet rule).",
  ],
  "PF2E.Platform.Toolbar.Tool.SelectDrawings": [
    "Выбор рисунков",
    "Select Drawings",
  ],
  "PF2E.Platform.Toolbar.Tool.SelectDrawingsDesc": [
    "Выбор готовых объектов рисования.",
    "Select existing drawing objects.",
  ],
  "PF2E.Platform.Toolbar.Tool.Rect": ["Прямоугольник", "Rectangle"],
  "PF2E.Platform.Toolbar.Tool.RectDesc": [
    "Рисование прямоугольников.",
    "Draw rectangles.",
  ],
  "PF2E.Platform.Toolbar.Tool.Ellipse": ["Окружность", "Ellipse"],
  "PF2E.Platform.Toolbar.Tool.EllipseDesc": [
    "Рисование эллипсов и кругов.",
    "Draw ellipses and circles.",
  ],
  "PF2E.Platform.Toolbar.Tool.Polygon": ["Полигон", "Polygon"],
  "PF2E.Platform.Toolbar.Tool.PolygonDesc": [
    "ЛКМ+тянуть — начать полигон, клики добавляют вершины, двойной клик завершает.",
    "Drag with the left button to start a polygon, click to add vertices, double-click to finish.",
  ],
  "PF2E.Platform.Toolbar.Tool.Freehand": [
    "Свободное рисование",
    "Freehand",
  ],
  "PF2E.Platform.Toolbar.Tool.FreehandDesc": [
    "Рисование от руки с зажатой ЛКМ.",
    "Draw by hand while holding the left mouse button.",
  ],
  "PF2E.Platform.Toolbar.Tool.Text": ["Текст", "Text"],
  "PF2E.Platform.Toolbar.Tool.TextDesc": [
    "Создание текстовых блоков.",
    "Create text blocks.",
  ],
  "PF2E.Platform.Toolbar.Tool.Palette": ["Палитра", "Palette"],
  "PF2E.Platform.Toolbar.Tool.PaletteDesc": [
    "Выбор цвета обводки и заливки для новых рисунков. Клик открывает палитру.",
    "Choose stroke and fill colors for new drawings. Click to open the palette.",
  ],
  "PF2E.Platform.Toolbar.Tool.ClearDrawings": [
    "Очистить рисунки",
    "Clear Drawings",
  ],
  "PF2E.Platform.Toolbar.Tool.ClearDrawingsDesc": [
    "Удаление всех рисунков текущей сцены.",
    "Delete all drawings on the current scene.",
  ],
  "PF2E.Platform.Toolbar.Tool.SelectWalls": ["Выбор стен", "Select Walls"],
  "PF2E.Platform.Toolbar.Tool.SelectWallsDesc": [
    "Выделение и редактирование отрезков стен.",
    "Select and edit wall segments.",
  ],
  "PF2E.Platform.Toolbar.Tool.NormalWall": ["Обычная стена", "Normal Wall"],
  "PF2E.Platform.Toolbar.Tool.NormalWallDesc": [
    "Блокирует: движение, зрение, слух.",
    "Blocks: movement, sight, sound.",
  ],
  "PF2E.Platform.Toolbar.Tool.TerrainWall": [
    "Ландшафтная стена",
    "Terrain Wall",
  ],
  "PF2E.Platform.Toolbar.Tool.TerrainWallDesc": [
    "Блокирует: Зрение после второй стены, движение, слух. Позволяет видеть то, что находится внутри первой стены.",
    "Blocks: sight after the second wall, movement, sound. Lets you see what lies inside the first wall.",
  ],
  "PF2E.Platform.Toolbar.Tool.InvisibleWall": [
    "Невидимая стена",
    "Invisible Wall",
  ],
  "PF2E.Platform.Toolbar.Tool.InvisibleWallDesc": [
    "Блокирует только движение, пропускает зрение и слух.",
    "Blocks movement only; sight and sound pass through.",
  ],
  "PF2E.Platform.Toolbar.Tool.EtherealWall": [
    "Бесплотная стена",
    "Ethereal Wall",
  ],
  "PF2E.Platform.Toolbar.Tool.EtherealWallDesc": [
    "Блокирует зрение и слух, но пропускает сквозь себя движение.",
    "Blocks sight and sound but lets movement pass through.",
  ],
  "PF2E.Platform.Toolbar.Tool.Door": ["Дверь", "Door"],
  "PF2E.Platform.Toolbar.Tool.DoorDesc": [
    "ЛКМ — открыть/закрыть, ПКМ — запереть на замок (блокирует открытие игроками).",
    "Left-click to open/close, right-click to lock (blocks players from opening).",
  ],
  "PF2E.Platform.Toolbar.Tool.SecretDoor": ["Скрытая дверь", "Secret Door"],
  "PF2E.Platform.Toolbar.Tool.SecretDoorDesc": [
    "Невидима для игроков. Блокирует движение, зрение и слух; мастер может открыть.",
    "Invisible to players. Blocks movement, sight and sound; the GM can open it.",
  ],
  "PF2E.Platform.Toolbar.Tool.ClearWalls": [
    "Удалить все стены",
    "Delete All Walls",
  ],
  "PF2E.Platform.Toolbar.Tool.ClearWallsDesc": [
    "Полная очистка стен на текущем слое сцены.",
    "Remove every wall on the current scene layer.",
  ],
  "PF2E.Platform.Toolbar.Tool.SelectLights": [
    "Выбор источников",
    "Select Lights",
  ],
  "PF2E.Platform.Toolbar.Tool.SelectLightsDesc": [
    "Выделение источников света.",
    "Select light sources.",
  ],
  "PF2E.Platform.Toolbar.Tool.CreateLight": [
    "Создать источник света",
    "Create Light",
  ],
  "PF2E.Platform.Toolbar.Tool.CreateLightDesc": [
    "Размещение источника света. Двойной клик открывает настройку радиусов тусклого и яркого света PF2e.",
    "Place a light source. Double-click to configure PF2e dim and bright light radii.",
  ],
  "PF2E.Platform.Toolbar.Tool.SceneDarkness": [
    "Темнота сцены",
    "Scene Darkness",
  ],
  "PF2E.Platform.Toolbar.Tool.SceneDarknessDesc": [
    "Переключение глобального уровня освещения сцены: светлая / тусклая / тьма.",
    "Cycle the scene's global lighting: bright / dim / dark.",
  ],
  "PF2E.Platform.Toolbar.Tool.GmVisionDesc": [
    "Мастер без выделенного токена видит карту целиком автоматически. Тумблер дополнительно раскрывает всех токенов вне LOS выбранного персонажа.",
    "The GM without a selected token sees the whole map automatically. This toggle also reveals every token outside the selected character's line of sight.",
  ],
  "PF2E.Platform.Toolbar.Tool.ResetFog": [
    "Сброс тумана войны",
    "Reset Fog of War",
  ],
  "PF2E.Platform.Toolbar.Tool.ResetFogDesc": [
    "Полностью очищает исследованные области тумана войны на текущей сцене и синхронизирует сброс со всеми участниками.",
    "Completely clears explored fog-of-war areas on the current scene and synchronizes the reset with every participant.",
  ],
  "PF2E.Platform.Toolbar.Tool.DeleteLights": [
    "Удалить свет",
    "Delete Lights",
  ],
  "PF2E.Platform.Toolbar.Tool.DeleteLightsDesc": [
    "Удаление всех источников света на сцене.",
    "Delete every light source on the scene.",
  ],
  "PF2E.Platform.Toolbar.Tool.RollDice": ["Бросок кубиков", "Roll Dice"],
  "PF2E.Platform.Toolbar.Tool.RollDiceDesc": [
    "Клик по типу бросает один кубик, клик по количеству — NdX (2–8).",
    "Click a die type to roll one die, click a count to roll NdX (2–8).",
  ],
  "PF2E.Platform.Toolbar.Darkness.Light": ["светлая", "bright"],
  "PF2E.Platform.Toolbar.Darkness.Dim": ["тусклая", "dim"],
  "PF2E.Platform.Toolbar.Darkness.Dark": ["тьма", "dark"],

  // ------------------------------------------------------------- combat
  "PF2E.Platform.Combat.Title": ["Столкновения", "Combat"],
  "PF2E.Platform.Combat.Round": ["Раунд", "Round"],
  "PF2E.Platform.Combat.NoEncounter": [
    "Активного столкновения нет. Создайте бой, чтобы бросить инициативу и отслеживать ходы.",
    "There is no active encounter. Create one to roll initiative and track turns.",
  ],
  "PF2E.Platform.Combat.Create": ["+ Создать бой", "+ Create Encounter"],
  "PF2E.Platform.Combat.Running": [
    "Столкновение идёт",
    "Encounter in progress",
  ],
  "PF2E.Platform.Combat.Finished": [
    "Столкновение завершено",
    "Encounter finished",
  ],
  "PF2E.Platform.Combat.Rolling": [
    "Инициатива не брошена",
    "Initiative not rolled",
  ],
  "PF2E.Platform.Combat.Participants": ["участн.", "combatants"],
  "PF2E.Platform.Combat.Empty": [
    "В столкновении пока нет бойцов.",
    "No combatants in this encounter yet.",
  ],
  "PF2E.Platform.Combat.Party": ["Группа", "Party"],
  "PF2E.Platform.Combat.Enemy": ["Противник", "Enemy"],
  "PF2E.Platform.Combat.Turn": ["Ход", "Turn"],
  "PF2E.Platform.Combat.Start": [
    "Начать столкновение",
    "Start Encounter",
  ],
  "PF2E.Platform.Combat.StartGmOnly": [
    "Начать столкновение может только мастер",
    "Only the GM can start the encounter",
  ],
  "PF2E.Platform.Combat.Previous": ["◀ Предыдущий", "◀ Previous"],
  "PF2E.Platform.Combat.Finish": ["■ Завершить", "■ Finish"],
  "PF2E.Platform.Combat.Next": ["Следующий ▶", "Next ▶"],
  "PF2E.Platform.Combat.NextRound": ["Следующий раунд", "Next Round"],
  "PF2E.Platform.Combat.ErrorNoConnection": [
    "Нет соединения с сервером.",
    "No connection to the server.",
  ],
  "PF2E.Platform.Combat.ErrorAction": [
    "Не удалось выполнить действие.",
    "Failed to perform the action.",
  ],
  "PF2E.Platform.Combat.ErrorCreate": [
    "Не удалось создать бой.",
    "Failed to create the encounter.",
  ],
  "PF2E.Platform.Combat.ErrorPermission": [
    "Недостаточно прав.",
    "Insufficient permissions.",
  ],
  "PF2E.Platform.Combat.ErrorNoCombatants": [
    "Нет бойцов для броска инициативы.",
    "No combatants to roll initiative for.",
  ],
  "PF2E.Platform.Combat.ErrorNotYourTurn": [
    "Сейчас не ваш ход.",
    "It is not your turn.",
  ],
  "PF2E.Platform.Combat.ErrorInvalidTarget": [
    "Нужна корректная цель.",
    "A valid target is required.",
  ],

  // ----------------------------------------------------------- compendium
  "PF2E.Platform.Compendium.WindowTitle": [
    "Compendium Browser",
    "Compendium Browser",
  ],
  "PF2E.Platform.Compendium.CloseEsc": ["Закрыть (Esc)", "Close (Esc)"],
  "PF2E.Platform.Compendium.CloseBrowser": [
    "Закрыть Compendium Browser",
    "Close Compendium Browser",
  ],
  "PF2E.Platform.Compendium.FiltersAria": [
    "Фильтры компендиума",
    "Compendium filters",
  ],
  "PF2E.Platform.Compendium.Search": ["Поиск", "Search"],
  "PF2E.Platform.Compendium.SearchPlaceholder": ["Искать…", "Search…"],
  "PF2E.Platform.Compendium.SearchAria": [
    "Поиск в компендиуме",
    "Search the compendium",
  ],
  "PF2E.Platform.Compendium.Levels": ["Уровни", "Levels"],
  "PF2E.Platform.Compendium.From": ["От", "From"],
  "PF2E.Platform.Compendium.To": ["До", "To"],
  "PF2E.Platform.Compendium.LevelFilter": [
    "Фильтр по уровню",
    "Level filter",
  ],
  "PF2E.Platform.Compendium.MinLevel": [
    "Минимальный уровень",
    "Minimum level",
  ],
  "PF2E.Platform.Compendium.MaxLevel": [
    "Максимальный уровень",
    "Maximum level",
  ],
  "PF2E.Platform.Compendium.PriceMinPlaceholder": [
    "напр. 0 мм",
    "e.g. 0 cp",
  ],
  "PF2E.Platform.Compendium.PriceMaxPlaceholder": [
    "напр. 10 зм",
    "e.g. 10 gp",
  ],
  "PF2E.Platform.Compendium.MinPrice": [
    "Минимальная цена",
    "Minimum price",
  ],
  "PF2E.Platform.Compendium.MaxPrice": [
    "Максимальная цена",
    "Maximum price",
  ],
  "PF2E.Platform.Compendium.PriceHint": [
    "Форматы: «5 зм», «10 см», «4 gp». 1 зм = 10 см = 100 мм.",
    "Formats: “5 gp”, “10 sp”, “4 cp”. 1 gp = 10 sp = 100 cp.",
  ],
  "PF2E.Platform.Compendium.ClearAll": [
    "Очистить все фильтры",
    "Clear all filters",
  ],
  "PF2E.Platform.Compendium.TraitSearchPlaceholder": [
    "Поиск признака…",
    "Search traits…",
  ],
  "PF2E.Platform.Compendium.TraitSearchAria": [
    "Поиск признака",
    "Search traits",
  ],
  "PF2E.Platform.Compendium.TraitsAria": ["Признаки", "Traits"],
  "PF2E.Platform.Compendium.NoTraits": [
    "Признаки не найдены.",
    "No traits found.",
  ],
  "PF2E.Platform.Compendium.TraitHint": [
    "✓ включает тег (AND), ✕ исключает его, повторный ✕ сбрасывает.",
    "✓ includes the tag (AND), ✕ excludes it, clicking ✕ again resets.",
  ],
  "PF2E.Platform.Compendium.TraitIn": [
    "Включён: показаны только предметы с этим признаком. Нажмите, чтобы исключить.",
    "Included: only entries with this trait are shown. Click to exclude.",
  ],
  "PF2E.Platform.Compendium.TraitOut": [
    "Исключён: предметы с этим признаком скрыты. Нажмите, чтобы сбросить.",
    "Excluded: entries with this trait are hidden. Click to reset.",
  ],
  "PF2E.Platform.Compendium.TraitNone": [
    "Нажмите, чтобы включить признак.",
    "Click to include this trait.",
  ],
  "PF2E.Platform.Compendium.ResultsLoading": ["Загрузка…", "Loading…"],
  "PF2E.Platform.Compendium.ResultsShown": [
    "Показано: {count}",
    "Showing: {count}",
  ],
  "PF2E.Platform.Compendium.ResultsShownOf": [
    "Показано: {count} из {total}",
    "Showing: {count} of {total}",
  ],
  "PF2E.Platform.Compendium.ResultsTotal": [
    "Записей: {count}",
    "Entries: {count}",
  ],
  "PF2E.Platform.Compendium.CatalogError": [
    "Не удалось загрузить каталог: {error}",
    "Failed to load the catalogue: {error}",
  ],
  "PF2E.Platform.Compendium.ShowMore": [
    "Показать ещё",
    "Show more",
  ],
  "PF2E.Platform.Compendium.DragHint": [
    "Перетащите карточку на лист персонажа — payload:",
    "Drag a card onto a character sheet — payload:",
  ],
  "PF2E.Platform.Compendium.DetailLevel": ["Уровень", "Level"],
  "PF2E.Platform.Compendium.DetailLoading": [
    "Загрузка описания…",
    "Loading description…",
  ],
  "PF2E.Platform.Compendium.DetailError": [
    "Не удалось загрузить описание: {error}",
    "Failed to load the description: {error}",
  ],
  "PF2E.Platform.Compendium.DetailEmpty": [
    "Описание отсутствует.",
    "No description.",
  ],
  "PF2E.Platform.Compendium.DetailClose": [
    "Закрыть описание",
    "Close description",
  ],
  "PF2E.Platform.Compendium.CardLevel": ["ур.", "lvl"],

  // Compendium accordions.
  "PF2E.Platform.Compendium.Accordion.Rarity": ["Редкость", "Rarity"],
  "PF2E.Platform.Compendium.Accordion.ItemTypes": [
    "Типы инвентаря",
    "Item types",
  ],
  "PF2E.Platform.Compendium.Accordion.ArmorFilters": [
    "Фильтры доспехов",
    "Armor filters",
  ],
  "PF2E.Platform.Compendium.Accordion.WeaponFilters": [
    "Фильтры оружия",
    "Weapon filters",
  ],
  "PF2E.Platform.Compendium.Accordion.Price": ["Цена", "Price"],
  "PF2E.Platform.Compendium.Accordion.Categories": [
    "Категории",
    "Categories",
  ],
  "PF2E.Platform.Compendium.Accordion.Traditions": ["Обычаи", "Traditions"],
  "PF2E.Platform.Compendium.Accordion.Ranks": ["Ранги", "Ranks"],
  "PF2E.Platform.Compendium.Accordion.Sizes": ["Размеры", "Sizes"],
  "PF2E.Platform.Compendium.Accordion.Skills": ["Навыки", "Skills"],
  "PF2E.Platform.Compendium.Accordion.Traits": ["Признаки", "Traits"],
  "PF2E.Platform.Compendium.Filter.SpellCategories": [
    "Категории заклинаний",
    "Spell categories",
  ],
  "PF2E.Platform.Compendium.Filter.MagicTraditions": [
    "Магические обычаи",
    "Magical traditions",
  ],
  "PF2E.Platform.Compendium.Filter.SpellRanks": [
    "Ранги заклинаний",
    "Spell ranks",
  ],
  "PF2E.Platform.Compendium.Filter.CreatureSizes": [
    "Размеры существ",
    "Creature sizes",
  ],
  "PF2E.Platform.Compendium.Filter.FeatCategories": [
    "Категории черт",
    "Feat categories",
  ],
  "PF2E.Platform.Compendium.Filter.Skills": ["Навыки", "Skills"],

  // ------------------------------------------------------------- settings
  "PF2E.Platform.Settings.Title": ["Настройки", "Settings"],
  "PF2E.Platform.Settings.System": ["Система", "System"],
  "PF2E.Platform.Settings.Version": ["Версия", "Version"],
  "PF2E.Platform.Settings.LanguageSection": [
    "Язык компендиумов и UI",
    "Compendium and UI language",
  ],
  "PF2E.Platform.Settings.LanguageAria": [
    "Язык компендиумов и интерфейса",
    "Compendium and interface language",
  ],
  "PF2E.Platform.Settings.LanguageHint": [
    "Названия и описания компендиума, а также локализованные элементы листа персонажа переключаются сразу. Выбор сохраняется в браузере и применяется при следующем запуске или перезагрузке.",
    "Compendium names and descriptions as well as the localized character-sheet elements switch immediately. The choice is stored in the browser and applied on the next launch or reload.",
  ],
  "PF2E.Platform.Settings.WorldManagement": [
    "Управление миром",
    "World Management",
  ],
  "PF2E.Platform.Settings.DownloadWorld": [
    "⬇ Скачать мир",
    "⬇ Download World",
  ],
  "PF2E.Platform.Settings.Downloading": ["⏳ Скачивание…", "⏳ Downloading…"],
  "PF2E.Platform.Settings.UploadWorld": [
    "⬆ Загрузить мир",
    "⬆ Upload World",
  ],
  "PF2E.Platform.Settings.Uploading": ["⏳ Загрузка…", "⏳ Uploading…"],
  "PF2E.Platform.Settings.WorldHint": [
    "Экспорт отдаёт текущий session.json. Импорт перезаписывает мир и перезагружает всех подключённых клиентов.",
    "Export returns the current session.json. Import overwrites the world and reloads every connected client.",
  ],
  "PF2E.Platform.Settings.WorldGmOnly": [
    "Управление миром доступно только мастеру.",
    "World management is only available to the GM.",
  ],
  "PF2E.Platform.Settings.GameSettings": [
    "🎲 Настройки игры",
    "🎲 Game Settings",
  ],
  "PF2E.Platform.Settings.ControlSettings": [
    "🎮 Настройки управления",
    "🎮 Control Settings",
  ],
  "PF2E.Platform.Settings.ExportDone": [
    "Мир скачан как world-export.json.",
    "The world was downloaded as world-export.json.",
  ],
  "PF2E.Platform.Settings.ExportError": [
    "Не удалось скачать мир: {error}",
    "Failed to download the world: {error}",
  ],
  "PF2E.Platform.Settings.ImportTitle": ["Импорт мира", "Import World"],
  "PF2E.Platform.Settings.ImportMessage": [
    "Вы уверены? Текущий мир будет безвозвратно удалён.",
    "Are you sure? The current world will be permanently deleted.",
  ],
  "PF2E.Platform.Settings.ImportConfirm": [
    "Загрузить мир",
    "Upload World",
  ],
  "PF2E.Platform.Settings.ImportDone": [
    "Мир импортирован. Перезагрузка клиентов…",
    "World imported. Reloading clients…",
  ],
  "PF2E.Platform.Settings.ImportError": [
    "Не удалось импортировать мир: {error}",
    "Failed to import the world: {error}",
  ],
  "PF2E.Platform.Settings.UnknownError": [
    "неизвестная ошибка",
    "unknown error",
  ],

  // ------------------------------------------------------------- directory
  "PF2E.Platform.Directory.Scenes": ["Сцены", "Scenes"],
  "PF2E.Platform.Directory.Actors": ["Актёры", "Actors"],
  "PF2E.Platform.Directory.Items": ["Предметы", "Items"],
  "PF2E.Platform.Directory.Journals": ["Журналы", "Journals"],
  "PF2E.Platform.Directory.CreateScene": ["Создать сцену", "Create Scene"],
  "PF2E.Platform.Directory.CreateActor": ["Создать актёра", "Create Actor"],
  "PF2E.Platform.Directory.CreateItem": ["Создать предмет", "Create Item"],
  "PF2E.Platform.Directory.CreateJournal": [
    "Создать запись",
    "Create Journal Entry",
  ],
  "PF2E.Platform.Directory.SearchScenes": [
    "Поиск в сценах…",
    "Search scenes…",
  ],
  "PF2E.Platform.Directory.SearchActors": [
    "Поиск в актёрах…",
    "Search actors…",
  ],
  "PF2E.Platform.Directory.SearchItems": [
    "Поиск в предметах…",
    "Search items…",
  ],
  "PF2E.Platform.Directory.SearchJournals": [
    "Поиск в журналах…",
    "Search journals…",
  ],
  "PF2E.Platform.Directory.EmptyScenes": [
    "Сцен пока нет.",
    "No scenes yet.",
  ],
  "PF2E.Platform.Directory.EmptyActors": [
    "Актёров пока нет.",
    "No actors yet.",
  ],
  "PF2E.Platform.Directory.EmptyItems": [
    "Предметов пока нет.",
    "No items yet.",
  ],
  "PF2E.Platform.Directory.EmptyJournals": [
    "Записей пока нет.",
    "No journal entries yet.",
  ],
  "PF2E.Platform.Directory.CreateFolder": [
    "📁 Создать папку",
    "📁 Create Folder",
  ],
  "PF2E.Platform.Directory.NewRecord": ["Новая запись", "New entry"],
  "PF2E.Platform.Directory.Sort": ["Сортировка", "Sorting"],
  "PF2E.Platform.Directory.SortAlpha": ["По алфавиту", "Alphabetical"],
  "PF2E.Platform.Directory.SortManual": ["Ручной порядок", "Manual order"],
  "PF2E.Platform.Directory.FolderNamePlaceholder": [
    "Название папки",
    "Folder name",
  ],
  "PF2E.Platform.Directory.ColorHex": ["Цвет (HEX)", "Color (HEX)"],
  "PF2E.Platform.Directory.FolderColor": ["Цвет папки", "Folder color"],
  "PF2E.Platform.Directory.FolderEmpty": ["Папка пуста", "Folder is empty"],
  "PF2E.Platform.Directory.Unfiled": ["Без папки", "Unfiled"],
  "PF2E.Platform.Directory.CreateUnfiled": [
    "Создать без папки",
    "Create unfiled",
  ],
  "PF2E.Platform.Directory.ExpandFolder": [
    "Развернуть папку",
    "Expand folder",
  ],
  "PF2E.Platform.Directory.CollapseFolder": [
    "Свернуть папку",
    "Collapse folder",
  ],
  "PF2E.Platform.Directory.CreateInFolder": [
    'Создать в папке "{name}"',
    'Create in folder "{name}"',
  ],
  "PF2E.Platform.Directory.Type": ["Тип", "Type"],
  "PF2E.Platform.Directory.ItemType": ["Тип предмета", "Item type"],
  "PF2E.Platform.Directory.PlayerCharacter": [
    "Персонаж игрока",
    "Player Character",
  ],
  "PF2E.Platform.Directory.GmCharacter": [
    "Персонаж мастера",
    "GM Character",
  ],
  "PF2E.Platform.Directory.NoPages": ["Нет страниц", "No pages"],
  "PF2E.Platform.Directory.Pages": ["стр.", "pages"],
  "PF2E.Platform.Directory.Scene": ["Сцена", "Scene"],
  "PF2E.Platform.Directory.Item": ["Предмет", "Item"],
  "PF2E.Platform.Directory.CreatureLevel": [
    "Существо {level}",
    "Creature {level}",
  ],
  "PF2E.Platform.Directory.LevelSuffix": [
    "{level}-й уровень",
    "Level {level}",
  ],
  "PF2E.Platform.Directory.NoConnection": [
    "Нет соединения с сервером.",
    "No connection to the server.",
  ],
  "PF2E.Platform.Directory.ErrorCreateFolder": [
    "Не удалось создать папку.",
    "Failed to create the folder.",
  ],
  "PF2E.Platform.Directory.ErrorCreateEntry": [
    "Не удалось создать запись.",
    "Failed to create the entry.",
  ],
  "PF2E.Platform.Directory.ErrorImportActor": [
    "Не удалось импортировать данные.",
    "Failed to import the actor data.",
  ],
  "PF2E.Platform.Directory.ErrorReadActor": [
    "Не удалось прочитать JSON-файл актёра.",
    "Failed to read the actor JSON file.",
  ],
  "PF2E.Platform.Directory.ErrorReadFile": [
    "Не удалось прочитать файл.",
    "Failed to read the file.",
  ],
  "PF2E.Platform.Directory.ErrorCopyActor": [
    "Не удалось создать копию актёра.",
    "Failed to duplicate the actor.",
  ],
  "PF2E.Platform.Directory.ErrorDeleteActor": [
    "Не удалось удалить актёра.",
    "Failed to delete the actor.",
  ],
  "PF2E.Platform.Directory.DeleteActorTitle": [
    "Удалить актёра",
    "Delete Actor",
  ],
  "PF2E.Platform.Directory.DeleteActorMessage": [
    'Удалить актёра "{name}"? Лист персонажа и все его данные будут потеряны.',
    'Delete actor "{name}"? The character sheet and all of its data will be lost.',
  ],
  "PF2E.Platform.Directory.CopySuffix": [" (Копия)", " (Copy)"],
  "PF2E.Platform.Directory.ActorNotSynced": [
    "Актёр ещё не синхронизирован.",
    "Actor is not synchronized yet.",
  ],
  "PF2E.Platform.Directory.AccessDenied": ["Нет доступа", "Access denied"],
  "PF2E.Platform.Directory.Misc": ["Прочее", "Miscellaneous"],
  "PF2E.Platform.Directory.Ownership": [
    "Настройка владения",
    "Ownership Configuration",
  ],
  "PF2E.Platform.Directory.DragActorHint": [
    "перетащите на холст, чтобы создать токен; ПКМ — меню",
    "drag onto the canvas to create a token; right-click for the menu",
  ],
  "PF2E.Platform.Directory.ReadOnlyHint": [
    "лист доступен только для чтения",
    "sheet is read-only",
  ],

  // Scene cards and context menu.
  "PF2E.Platform.Scene.Active": ["Активная сцена", "Active scene"],
  "PF2E.Platform.Scene.InFolder": ["В папке", "In folder"],
  "PF2E.Platform.Scene.NoFolder": ["Без папки", "No folder"],
  "PF2E.Platform.Scene.Configure": [
    'Настроить сцену "{name}"',
    'Configure scene "{name}"',
  ],
  "PF2E.Platform.Scene.ConfigureAria": [
    "Настроить сцену {name}",
    "Configure scene {name}",
  ],
  "PF2E.Platform.Scene.AlreadyActive": [
    '"{name}" уже активна',
    '"{name}" is already active',
  ],
  "PF2E.Platform.Scene.Activate": [
    'Активировать сцену "{name}"',
    'Activate scene "{name}"',
  ],
  "PF2E.Platform.Scene.AlreadyActiveAria": [
    "Сцена {name} уже активна",
    "Scene {name} is already active",
  ],
  "PF2E.Platform.Scene.ActivateAria": [
    "Активировать сцену {name}",
    "Activate scene {name}",
  ],
  "PF2E.Platform.Scene.ActiveBadge": ["✓ Активна", "✓ Active"],
  "PF2E.Platform.Scene.ActivateButton": ["Активировать", "Activate"],
  "PF2E.Platform.Scene.Menu.View": ["Просмотр", "View"],
  "PF2E.Platform.Scene.Menu.Activate": ["Активация", "Activate"],
  "PF2E.Platform.Scene.Menu.Preload": ["Предзагрузить", "Preload"],
  "PF2E.Platform.Scene.Menu.Export": ["Экспорт данных", "Export Data"],
  "PF2E.Platform.Scene.Menu.Import": ["Импорт данных", "Import Data"],
  "PF2E.Platform.Scene.Menu.Copy": ["Создать копию", "Duplicate"],
  "PF2E.Platform.Scene.Menu.Delete": ["Удалить", "Delete"],
  "PF2E.Platform.Scene.Viewing": [
    "Просмотр сцены (только мастер)",
    "Viewing scene (GM only)",
  ],
  "PF2E.Platform.Scene.Preloaded": [
    "Сцена «{name}» предзагружается у всех участников.",
    'Scene "{name}" is preloading for all participants.',
  ],
  "PF2E.Platform.Scene.ExportEmpty": [
    "В файле нет корректных данных сцены.",
    "The file does not contain valid scene data.",
  ],
  "PF2E.Platform.Scene.CopySuffix": [" (Копия)", " (Copy)"],
  "PF2E.Platform.Scene.DeleteTitle": ["Удалить сцену", "Delete Scene"],
  "PF2E.Platform.Scene.DeleteMessage": [
    'Удалить сцену "{name}"? Все стены, рисунки, свет и токены этой сцены будут потеряны.',
    'Delete scene "{name}"? All walls, drawings, lights and tokens on this scene will be lost.',
  ],
  "PF2E.Platform.Scene.Deleted": ["Сцена удалена.", "Scene deleted."],
  "PF2E.Platform.Scene.Copied": ["Сцена скопирована.", "Scene duplicated."],
  "PF2E.Platform.Scene.ExportFailed": [
    "Не удалось экспортировать сцену.",
    "Failed to export the scene.",
  ],
  "PF2E.Platform.Scene.ImportFailed": [
    "Не удалось импортировать сцену.",
    "Failed to import the scene.",
  ],
  "PF2E.Platform.Scene.ActivateFailed": [
    "Не удалось активировать сцену.",
    "Failed to activate the scene.",
  ],
  "PF2E.Platform.Scene.ConfigFailed": [
    "Не удалось сохранить настройки сцены.",
    "Failed to save the scene settings.",
  ],
  "PF2E.Platform.Scene.ConfigGmOnly": [
    "Только Мастер может настраивать сцены.",
    "Only the GM can configure scenes.",
  ],
  "PF2E.Platform.Scene.OwnershipGmOnly": [
    "Только Мастер может настраивать владение.",
    "Only the GM can configure ownership.",
  ],
  "PF2E.Platform.Scene.ImportInvalid": [
    "В файле нет корректного объекта actor.system.",
    "The file does not contain a valid actor.system object.",
  ],

  // ------------------------------------------------------------ biography
  "PF2E.Platform.Sheet.Skills": ["Навыки", "Skills"],
  "PF2E.Platform.Sheet.Level": ["Уровень", "Level"],
  "PF2E.Platform.Sheet.SkillCheck": ["Проверка", "Check"],
  "PF2E.Platform.Sheet.BlindCheck": ["Тайная проверка", "Secret check"],
  "PF2E.Platform.Sheet.SecretSuffix": ["(тайно)", "(secret)"],
  "PF2E.Platform.Sheet.ArmorPenalty": ["Штраф брони", "Armor penalty"],
  "PF2E.Platform.Sheet.ArmorCheckPenalty": [
    "Штраф проверок от брони",
    "Armor check penalty",
  ],
  "PF2E.Platform.Sheet.Lore": ["Знания", "Lore"],
  "PF2E.Platform.Sheet.AddLore": ["+ Добавить знание", "+ Add Lore"],
  "PF2E.Platform.Sheet.NoLore": ["Знаний пока нет.", "No lore yet."],
  "PF2E.Platform.Biography.Tab": ["Биография", "Biography"],
  "PF2E.Platform.Biography.Character": ["Характер", "Character"],
  "PF2E.Platform.Biography.Edit": ["Редактировать", "Edit"],
  "PF2E.Platform.Biography.Save": ["Сохранить", "Save"],
  "PF2E.Platform.Biography.Cancel": ["Отмена", "Cancel"],
  "PF2E.Platform.Biography.Empty": [
    "Нажмите на карандаш, чтобы заполнить.",
    "Click the pencil to fill this in.",
  ],
  "PF2E.Platform.Biography.AddEntry": ["Добавить", "Add"],
  "PF2E.Platform.Biography.EntryPlaceholder": [
    "Новая запись…",
    "New entry…",
  ],
  "PF2E.Platform.Biography.RemoveEntry": [
    "Удалить запись",
    "Remove entry",
  ],

  // ---------------------------------------------------------- text editor
  "PF2E.Platform.Editor.Toolbar": ["Форматирование", "Formatting"],
  "PF2E.Platform.Editor.Format": ["Формат", "Format"],
  "PF2E.Platform.Editor.Style": ["Стиль", "Style"],
  "PF2E.Platform.Editor.NormalText": ["Обычный текст", "Normal text"],
  "PF2E.Platform.Editor.Heading1": ["Заголовок 1", "Heading 1"],
  "PF2E.Platform.Editor.Heading2": ["Заголовок 2", "Heading 2"],
  "PF2E.Platform.Editor.Heading3": ["Заголовок 3", "Heading 3"],
  "PF2E.Platform.Editor.Quote": ["Цитата", "Blockquote"],
  "PF2E.Platform.Editor.CodeBlock": ["Блок кода", "Code block"],
  "PF2E.Platform.Editor.Normal": ["Обычный", "Normal"],
  "PF2E.Platform.Editor.Code": ["Код", "Code"],
  "PF2E.Platform.Editor.Bold": ["Жирный", "Bold"],
  "PF2E.Platform.Editor.Italic": ["Курсив", "Italic"],
  "PF2E.Platform.Editor.Color": ["Цвет", "Color"],
  "PF2E.Platform.Editor.TextColor": ["Цвет текста", "Text color"],
  "PF2E.Platform.Editor.BulletedList": [
    "Маркированный список",
    "Bulleted list",
  ],
  "PF2E.Platform.Editor.NumberedList": [
    "Нумерованный список",
    "Numbered list",
  ],
  "PF2E.Platform.Editor.AlignLeft": [
    "Выровнять по левому краю",
    "Align left",
  ],
  "PF2E.Platform.Editor.AlignCenter": [
    "Выровнять по центру",
    "Align center",
  ],
  "PF2E.Platform.Editor.AlignRight": [
    "Выровнять по правому краю",
    "Align right",
  ],
  "PF2E.Platform.Editor.AlignJustify": ["По ширине", "Justify"],
  "PF2E.Platform.Editor.InsertImage": ["Вставить изображение", "Insert image"],
  "PF2E.Platform.Editor.ClearFormatting": [
    "Очистить форматирование",
    "Clear formatting",
  ],
  "PF2E.Platform.Editor.Save": ["💾 Сохранить", "💾 Save"],
  "PF2E.Platform.Editor.Unavailable": [
    "Команда форматирования недоступна.",
    "The formatting command is unavailable.",
  ],

  // ------------------------------------------------------ filter options
  "PF2E.Platform.Option.Rarity.Common": ["Обычный", "Common"],
  "PF2E.Platform.Option.Rarity.Uncommon": ["Необычный", "Uncommon"],
  "PF2E.Platform.Option.Rarity.Rare": ["Редкий", "Rare"],
  "PF2E.Platform.Option.Rarity.Unique": ["Уникальный", "Unique"],
  "PF2E.Platform.Option.ItemType.Ammo": ["Амуниция", "Ammunition"],
  "PF2E.Platform.Option.ItemType.Armor": ["Доспех", "Armor"],
  "PF2E.Platform.Option.ItemType.Weapon": ["Оружие", "Weapon"],
  "PF2E.Platform.Option.ItemType.Consumable": ["Расходуемый", "Consumable"],
  "PF2E.Platform.Option.ItemType.Equipment": ["Снаряжение", "Equipment"],
  "PF2E.Platform.Option.ItemType.Shield": ["Щит", "Shield"],
  "PF2E.Platform.Option.ItemType.Backpack": ["Рюкзак", "Backpack"],
  "PF2E.Platform.Option.ItemType.Kit": ["Набор", "Kit"],
  "PF2E.Platform.Option.ItemType.Treasure": ["Сокровище", "Treasure"],
  "PF2E.Platform.Option.ItemType.Book": ["Книга", "Book"],
  "PF2E.Platform.Option.Armor.Unarmored": ["Без брони", "Unarmored"],
  "PF2E.Platform.Option.Armor.Light": ["Лёгкий", "Light"],
  "PF2E.Platform.Option.Armor.Medium": ["Средний", "Medium"],
  "PF2E.Platform.Option.Armor.Heavy": ["Тяжёлый", "Heavy"],
  "PF2E.Platform.Option.Weapon.Simple": ["Простое", "Simple"],
  "PF2E.Platform.Option.Weapon.Martial": ["Воинское", "Martial"],
  "PF2E.Platform.Option.Weapon.Advanced": ["Продвинутое", "Advanced"],
  "PF2E.Platform.Option.Weapon.Unarmed": ["Безоружное", "Unarmed"],
  "PF2E.Platform.Option.SpellCategory.Spell": ["Заклинание", "Spell"],
  "PF2E.Platform.Option.SpellCategory.Cantrip": ["Чары", "Cantrip"],
  "PF2E.Platform.Option.SpellCategory.Focus": ["Фокус", "Focus"],
  "PF2E.Platform.Option.SpellCategory.Ritual": ["Ритуал", "Ritual"],
  "PF2E.Platform.Option.Tradition.Arcane": ["Арканный", "Arcane"],
  "PF2E.Platform.Option.Tradition.Occult": ["Оккультный", "Occult"],
  "PF2E.Platform.Option.Tradition.Primal": ["Природный", "Primal"],
  "PF2E.Platform.Option.Tradition.Divine": ["Сакральный", "Divine"],
  "PF2E.Platform.Option.Size.Tiny": ["Крошечный", "Tiny"],
  "PF2E.Platform.Option.Size.Small": ["Маленький", "Small"],
  "PF2E.Platform.Option.Size.Medium": ["Средний", "Medium"],
  "PF2E.Platform.Option.Size.Large": ["Большой", "Large"],
  "PF2E.Platform.Option.Size.Huge": ["Огромный", "Huge"],
  "PF2E.Platform.Option.Size.Gargantuan": ["Исполинский", "Gargantuan"],
  "PF2E.Platform.Option.Feat.Class": [
    "Способность класса",
    "Class Feat",
  ],
  "PF2E.Platform.Option.Feat.ClassFeature": [
    "Классовая особенность",
    "Class Feature",
  ],
  "PF2E.Platform.Option.Feat.Skill": [
    "Способность навыка",
    "Skill Feat",
  ],
  "PF2E.Platform.Option.Feat.Ancestry": [
    "Способность родословной",
    "Ancestry Feat",
  ],
  "PF2E.Platform.Option.Feat.AncestryFeature": [
    "Особенность родословной",
    "Ancestry Feature",
  ],
  "PF2E.Platform.Option.Feat.General": [
    "Общая способность",
    "General Feat",
  ],
  "PF2E.Platform.Option.Feat.Bonus": [
    "Бонусная способность",
    "Bonus Feat",
  ],
  "PF2E.Platform.Option.Feat.Calling": ["Призвание", "Calling"],
});

const dictionaries = Object.create(null);
const loadPromises = Object.create(null);
let currentLanguage = DEFAULT_LANGUAGE;
let flattenedDictionary = null;
let flattenedLanguage = null;
// Step 6.7: monotonically increasing revision observed by `useTranslation`.
let languageRevision = 0;
const languageListeners = new Set();

function emitLanguageChange() {
  languageRevision += 1;
  for (const listener of languageListeners) {
    try {
      listener();
    } catch (error) {
      // A broken subscriber must never prevent the global language change.
    }
  }
}

export function normalizeLanguage(value) {
  return value === "en" ? "en" : "ru";
}

export function getLanguage() {
  return currentLanguage;
}

/** Subscribe to language/dictionary changes for `useSyncExternalStore`. */
export function subscribeLanguage(listener) {
  languageListeners.add(listener);
  return () => {
    languageListeners.delete(listener);
  };
}

export function getLanguageRevision() {
  return languageRevision;
}

export function setLanguage(value) {
  currentLanguage = normalizeLanguage(value);
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.lang = currentLanguage;
  }
  emitLanguageChange();
  return currentLanguage;
}

/**
 * Step 6.7: React hook that re-renders on every language change.
 *
 * `t()` keeps the same signature as the module-level helper, but closes over
 * the current language and the subscription revision. This makes the whole
 * character sheet and every interface component switch language instantly.
 */
export function useTranslation() {
  const revision = useSyncExternalStore(
    subscribeLanguage,
    getLanguageRevision,
    getLanguageRevision,
  );
  const language = currentLanguage;
  return {
    language,
    revision,
    t: (key, fallback) => translate(key, fallback, language),
  };
}

/**
 * Read the persisted RU/EN choice. Used both by the React store and by
 * `main.js` before React mounts, so a reload cannot flash the wrong language.
 */
export function readStoredLanguage() {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_LANGUAGE;
  }
  try {
    return normalizeLanguage(
      window.localStorage.getItem(LANGUAGE_STORAGE_KEY) || DEFAULT_LANGUAGE,
    );
  } catch (error) {
    return DEFAULT_LANGUAGE;
  }
}

/** Persist the global language choice for the next launch/reload. */
export function persistLanguage(value) {
  const normalized = normalizeLanguage(value);
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
    } catch (error) {
      // Private browsing can reject writes; the in-memory value still works.
    }
  }
  return normalized;
}

/** Recursively flatten nested Foundry dictionaries into dotted keys. */
function flattenDictionary(source, prefix, target) {
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value === null || value === undefined) {
      continue;
    }
    const path = prefix === "" ? key : prefix + "." + key;
    if (typeof value === "string") {
      target[path] = value;
    } else if (typeof value === "object" && !Array.isArray(value)) {
      flattenDictionary(value, path, target);
    }
  }
  return target;
}

/**
 * Load one dictionary. Results are cached by language; English is resolved
 * synchronously because it uses keys/fallbacks.
 *
 * @param {"ru"|"en"} [language]
 * @returns {Promise<object>}
 */
export function loadTranslations(language) {
  const normalized = normalizeLanguage(language || currentLanguage);
  if (normalized === "en") {
    return Promise.resolve({});
  }
  if (dictionaries[normalized]) {
    return Promise.resolve(dictionaries[normalized]);
  }
  if (loadPromises[normalized]) {
    return loadPromises[normalized];
  }

  loadPromises[normalized] = fetch(
    "/api/i18n?lang=" + encodeURIComponent(normalized),
    { headers: { Accept: "application/json" } },
  )
    .then((response) => {
      if (!response.ok) {
        throw new Error("HTTP " + response.status + " " + response.statusText);
      }
      return response.json();
    })
    .then((payload) => {
      const dictionary =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload
          : {};
      dictionaries[normalized] = dictionary;
      loadPromises[normalized] = null;
      // The dictionary finished loading after the initial render: notify
      // `useTranslation` consumers so translated labels replace fallbacks.
      if (normalized === currentLanguage) {
        emitLanguageChange();
      }
      return dictionary;
    })
    .catch((error) => {
      loadPromises[normalized] = null;
      console.warn("[pf2e] i18n load failed", error);
      return {};
    });

  return loadPromises[normalized];
}

function getFlattenedDictionary(language) {
  const normalized = normalizeLanguage(language);
  if (normalized === "en") {
    return null;
  }
  const dictionary = dictionaries[normalized];
  if (!dictionary) {
    return null;
  }
  if (flattenedLanguage !== normalized || flattenedDictionary === null) {
    flattenedDictionary = flattenDictionary(dictionary, "", Object.create(null));
    flattenedLanguage = normalized;
  }
  return flattenedDictionary;
}

/**
 * Translate a dotted key.
 *
 * @param {string} key
 * @param {string} [fallback] English fallback shown in EN mode or on a miss
 * @returns {string}
 */
export function translate(key, fallback, language) {
  const normalized = normalizeLanguage(language || currentLanguage);
  const normalizedKey = typeof key === "string" ? key : String(key || "");

  // Step 6.8: platform chrome strings live in the local table and are
  // available for both languages, even before `/api/i18n` resolves.
  const local = Object.prototype.hasOwnProperty.call(
    PLATFORM_TRANSLATIONS,
    normalizedKey,
  )
    ? PLATFORM_TRANSLATIONS[normalizedKey]
    : null;
  if (local) {
    return (normalized === "en" ? local[1] : local[0]) || fallback || normalizedKey;
  }

  if (normalized === "en") {
    return fallback || normalizedKey;
  }
  const dictionary = getFlattenedDictionary(normalized);
  if (dictionary && Object.prototype.hasOwnProperty.call(dictionary, normalizedKey)) {
    return dictionary[normalizedKey];
  }
  return fallback || normalizedKey;
}

/**
 * Step 6.8: replace `{name}` placeholders in a translated template.
 *
 * @param {string} template
 * @param {Record<string, string|number>} [values]
 * @returns {string}
 */
export function formatMessage(template, values) {
  const source = typeof template === "string" ? template : String(template || "");
  if (!values) {
    return source;
  }
  return source.replace(/\{(\w+)\}/g, function (match, key) {
    return Object.prototype.hasOwnProperty.call(values, key)
      ? String(values[key])
      : match;
  });
}

/** Short alias used by components: `t("PF2E.SavesHeader")`. */
export function t(key, fallback) {
  return translate(key, fallback, currentLanguage);
}

/** Test/debug helper: expose the loaded dictionary without mutating it. */
export function hasDictionary(language) {
  return Boolean(dictionaries[normalizeLanguage(language)]);
}
