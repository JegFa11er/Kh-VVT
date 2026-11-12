# Handoff — PF2ERWeb (Foundry-like VTT)

## 1. Архитектура и структура
- Монорепозиторий npm workspaces:
  * `packages/core` — эталонное чистое боевое ядро PF2e Remastered (CommonJS, 558 тестов, 0 падений).
  * `packages/server` — Node.js сервер (HTTP API + WebSocket /ws, хранилище компендиумов, сессии комнат).
  * `packages/client` — клиент на PixiJS v8 + React 19 + Vite (viewport, сетка, слой токенов, React-оверлей UI).

## 2. Завершённые вехи
- [x] **Инициализация монорепозитория**: настройка workspaces, перенос ядра и тестов, связка экспортов, билд клиента.
- [x] **Полная база компендиумов (Шаг 1)**:
  * Источник: ../pf2e-reference/packs/pf2e/
  * Скрипт сборки: packages/server/scripts/build-compendiums.js (npm run build:data)
  * Объём: 17 752 записи (2 018 заклинаний, 5 956 предметов, 7 301 черта, 1 702 монстра, 775 действий).
  * Сформированы полные JSON и быстрые поисковые *.index.json.
  * API: GET /api/compendiums, GET /api/compendiums/:category (фильтры), GET /api/compendiums/:category/:id.

## 3. Текущий этап в работе
- [x] **Шаг 2: Серверный диспетчер боевых действий (Action Intent Pipeline)**:
  * Валидация прав GM / Player (управление только своим токеном в свой ход).
  * Серверный роутинг действий в @pf2e/core (Strike, Stride, Step, CastSpell, Maneuvers, RaiseShield, TakeCover, EndTurn).
  * Рассылка обновлений через CombatEventBus и WebSocket broadcast (room:state-update).
  * Интеграционные тесты packages/server/tests/action-pipeline.test.js.
  * Реализация: `EncounterSession` создаёт изолированные `GridMap` и `CombatEventBus`, подписан на `*` и накапливает `combatLog` записей `{ id, timestamp, type, payload, message }`; `dispatchAction(clientRole, clientId, intent)` проверяет роль/назначение токена/активный ход, маршрутизирует интент в ядро и возвращает `{ ok, state, logEntries }` либо структурированную ошибку `{ ok:false, reason }` только вызвавшему клиенту.
  * Интегрированные экшены: `stride`, `step`, `strike`, `cast-spell`, `raise-shield`, `take-cover`, `trip`, `shove`, `grapple`, `stand`, `escape`, `end-turn`, `roll-initiative`.
  * Снапшоты: `Serializer.serializeCombatState` (encounter, map, combatants, hazards); назначение токенов — `session.assignToken` (только GM).
  * Новые входящие WS-сообщения: `room:action` (`{ intent: { action, payload } }`), `room:assign-token` (`{ playerId, combatantId }`, только GM), `room:sync` (полный снапшот + весь лог).
  * Новые исходящие WS-сообщения: `room:state-update` (`{ state, logEntries }`) — broadcast всем клиентам комнаты; `room:action-error` (`{ reason, intent }`) — точечно инициатору; `room:token-assigned` — подтверждение назначения.
  * Тесты: 5 сценариев в `packages/server/tests/action-pipeline.test.js` (GM Strike за любого бойца, запрет чужого токена/внеходового действия, расход действий Stride/Strike, `end-turn`, WS-broadcast снапшота и `room:sync`); запуск `npm run test --workspace=@pf2e/server` — 5/5, `npm run test:core` — 558/558.
- [x] **Шаг 3: Связка Vite dev-сервера с бэкендом**:
  * `packages/client/vite.config.js`: dev-сервер Vite (порт 5173) проксирует `/api` и `/ws` на бэкенд `http://localhost:3000` (переопределяется через `PF2E_SERVER_URL`). Для `/ws` включён `ws: true`, поэтому WebSocket идёт через тот же origin — без CORS и без хардкода порта в клиенте.
  * Статика для Production: `packages/server/src/index.js` отдаёт `packages/client/dist` через `node:fs`/`node:path` (express не используется). Любой GET/HEAD вне `/api` и `/ws` получает файл из `dist/`; пути без расширения (SPA-маршруты) падают обратно на `index.html`, отсутствующие ассеты возвращают 404. `index.html` отдаётся с `Cache-Control: no-cache`, хешированные ассеты — с `max-age=31536000, immutable`. Проверяется защита от path traversal. Путь можно переопределить через `CLIENT_DIST`.
  * `packages/client/src/net/network-client.js`: базовый `NetworkClient` подключается к same-origin `/ws` (в dev — через прокси Vite, в prod — напрямую к Node). Методы: `connect(role = "player", playerId)` (открывает сокет и автоматически выполняет `join`, переподключается с той же ролью/id), `sendIntent(action, payload)` (шлёт `room:action` с `{ intent: { action, payload } }`), `onStateUpdate(callback)` (подписка на `room:state-update`, включая «плоские» combat-сообщения) и `onActionError(callback)` (подписка на `room:action-error`).
  * `packages/client/src/main.js`: создаёт `NetworkClient`, регистрирует обработчики и делает тестовый коннект при загрузке; при `room:state-update` выводит `console.log` и синхронизирует токены.
  * Структура ассетов: `packages/client/public/assets/ui/` и `packages/client/public/assets/tokens/` (Vite копирует их в `dist/assets/`).
- [x] **Шаг 4.1: React-интерфейс и Compendium Browser**:
  * Зависимости `packages/client`: `react@19.3.1`, `react-dom@19.3.1`, dev-зависимость `@vitejs/plugin-react@4.7.0`. Плагин `react()` добавлен в `packages/client/vite.config.js` (Vite 6 + JSX и Fast Refresh в dev).
  * Точка монтирования: в `packages/client/index.html` добавлен `<div id="ui-root"></div>`; `#ui-root` — `position:absolute; inset:0; z-index:10; pointer-events:none`, окна включают `pointer-events:auto`. Пикси-канвас остаётся интерактивным вне окон.
  * `packages/client/src/ui/App.jsx` — корневой оверлей: верхняя панель (бренд, кнопка «Библиотека», статус WebSocket, бейдж роли GM/Player, сводка боя из контекста), окно Compendium Browser открыто по умолчанию, закрывается кнопкой × или Esc.
  * `packages/client/src/ui/StoreContext.jsx` — `StoreProvider`/`useStore()`: подписка на `networkClient.onStateUpdate()` (`room:state-update`) хранит `combatState`; `activeRole` берётся из `initialRole`/`NetworkClient.role` и уточняется из `joined.member.role`; также отслеживаются `session:snapshot`, `open`, `close` и флаг `connected`.
  * `packages/client/src/ui/CompendiumBrowser.jsx` — вкладки «Заклинания» (`spells`), «Оружие» (`equipment` + `type=weapon`), «Щиты» (`equipment` + `type=shield`), «Бестиарий» (`monsters` + `type=npc`), «Черты» (`feats`). Поиск с debounce 250 мс и `AbortController` делает fetch к `/api/compendiums/:category?search=...&limit=100` (+`type`), показывает счётчик, состояния загрузки/ошибки/пустоты и кнопку «Показать ещё» (догрузка увеличением `limit`).
  * Карточки: `id`, `name`, `type`, `level`, `img`, `traits` (первые 5 тегов + «+N»), placeholder `public/assets/ui/item-placeholder.svg` при ошибке загрузки Foundry-иконки.
  * Drag-and-Drop: карточки `draggable`; `onDragStart` пишет в `dataTransfer` (`application/json` и `text/plain`) JSON вида `{ type: "compendium-item", category, entry }` и ставит `effectAllowed = "copy"` — готово для drop-обработчиков листа персонажа на Шаге 4.3.
  * Стили: `packages/client/src/ui/styles.css` (тёмная Foundry-тема: окна, вкладки, поля, карточки, сетка, скроллбары, адаптив), импортируется в `main.js`.
  * `packages/client/src/main.js`: после создания `NetworkClient` монтирует React через `createRoot(document.getElementById("ui-root"))` в `StoreProvider` с `initialRole: role`; ссылка на корень доступна в `window.pf2e.uiRoot`.
  * Проверка: `npm run build --workspace=@pf2e/client` — успешно (758 модулей); `npm run dev:client` в браузере — без console-ошибок, запрос `GET /api/compendiums/spells?limit=100` → 200, карточки отрисовываются; вкладки «Оружие»/«Щиты»/«Бестиарий»/«Черты» подгружают свои каталоги; поиск `fireball` → `GET /api/compendiums/spells?search=fireball&limit=100` → 200 и карточка Fireball; dragstart возвращает payload `{ type: "compendium-item", category: "spells", entry: { … Fireball … } }`.
- [x] **Шаг 4.2: React Toolbar / HUD (левая панель инструментов)**:
  * `packages/client/src/ui/StoreContext.jsx`: в контекст добавлены `activeTool` (id активной категории слева) и `activeSubTool` (id активного инструмента справа), а также `setActiveTool(tool)` и `setActiveSubTool(subTool)`.
  * `packages/client/src/ui/Toolbar.jsx`: двухколоночный HUD с `position: fixed; top: 20px; left: 20px; pointer-events: auto` поверх PixiJS. Колонка 1 — категории «Токены» (`token`), «Рисование» (`draw`), «Стены» (`wall`), «Освещение» (`light`); колонка 2 — инструменты выбранной категории.
  * Токены: `select` (выделение кликом/рамкой) и `ruler` (линейка дистанции PF2e по правилу 5-10-5 футов). Рисование: `select`, `rect`, `ellipse`, `polygon`, `freehand`, `text`, `color` (палитра 8 цветов и индикатор текущего цвета), `clear`. Стены (8 инструментов): `select`, `normal`, `terrain`, `invisible`, `ethereal`, `door` (ПКМ — запереть/снять замок), `secret`, `clear`; подсказка `terrain` содержит точное описание «Блокирует: Зрение после второй стены, движение, слух». Освещение: `select`, `draw`, `darkness` (цикл «светлая → тусклая → тьма»), `gm-vision` (toggle), `reset-fog` (заглушка), `clear`.
  * Каждый клик публикует DOM-событие `pf2e:toolbar-action` (`{ category, tool, ... }`) — точка интеграции для будущих PixiJS-слоёв рисования, стен и света. У всех кнопок есть `title`-подсказка с механикой; активная кнопка обводится акцентом Foundry `#ff6400`.
  * `packages/client/src/ui/styles.css`: `.toolbar` — тёмный полупрозрачный фон `rgba(30, 30, 35, 0.9)`, скругление `6px`, `box-shadow`, кнопки `36×36px`, палитра и всплывающий статус действия. `App.jsx` рендерит `<Toolbar />` внутри оверлея.
  * Проверка: `npm run build --workspace=@pf2e/client` — успешно (759 модулей); `npm run dev:client` — без console-ошибок; в браузере клик по категории «Стены» раскрывает все 8 инструментов, тултип ландшафтной стены содержит требуемую строку.

- [x] **Шаг 4.3: Панель игроков и настройка профиля**:
  * `packages/server/src/room/encounter-session.js`: у сессии появился реестр `users` (`Map<memberId, { id, name, role, color, pronouns, characterId }>`). При `addMember` создаётся профиль по умолчанию: GM — «Ведущий» и золотой `#f2c94c`, игрок — «Игрок» и случайный цвет из палитры. `updateProfile(memberId, { name, color, pronouns, characterId })` обновляет профиль и имя участника, `removeMember` удаляет его из реестра. `snapshot()` теперь содержит `users`, а `_emitUsersUpdate()` рассылает `room:users-update` без записи в боевой лог.
  * `packages/server/src/index.js`: при `join` клиент сначала подписывается на события комнаты, затем добавляется в неё — поэтому сразу получает `room:users-update`; обработчик `room:update-profile` применяет данные отправителя. Каждое изменение состава/профиля уходит всем как `room:users-update` (`{ sessionId, users }`), дополнительно транслируется `session:snapshot`.
  * `packages/client/src/net/network-client.js`: `onUsersUpdate(callback)` (всегда отдаёт массив профилей) и `updateProfile(profileData)` → `room:update-profile`.
  * `packages/client/src/ui/StoreContext.jsx`: в контексте `users` и `myUserId`; подписка на `onUsersUpdate`, обновление состава из `joined`/`session:snapshot`.
  * `packages/client/src/ui/PlayerList.jsx`: fixed-панель в левом нижнем углу (`bottom/left: 20px`), цветной кружок + имя + роль в квадратных скобках; правый клик открывает `.context-menu` с пунктом «👤 Настройка участника».
  * `packages/client/src/ui/PlayerConfigModal.jsx`: модальное окно Foundry-стиля с полями имени, цвета (`type=color` + HEX), местоимений и персонажа (список берётся из `combatState.combatants`); «Сохранить настройки» вызывает `networkClient.updateProfile(...)` и закрывает окно. `App.jsx` рендерит `<PlayerList />`.
  * `styles.css`: стили `.player-list`, `.context-menu`, `.modal-backdrop`, `.modal-window`, полей и primary-кнопки.
  * Проверка: `npm run build --workspace=@pf2e/client` — 761 модуль, успешно; `npm run test --workspace=@pf2e/server` — 5/5 action-pipeline + 2/2 users-sync.
- [x] **Шаг 4.4: Чат, кубики, загрузка изображений и контекстное меню сообщений**:
  * `packages/server`: добавлена зависимость `formidable@^3.5.4`; `POST /api/upload` принимает multipart-поле `file` (только PNG/JPEG, до 8 МБ), сохраняет файл в `packages/server/data/uploads/` под уникальным именем и возвращает `{ url: "/uploads/chat-…png" }`. GET/HEAD `/uploads/<file>` раздаёт загруженные картинки с защитой от path traversal (каталог переопределяется через `UPLOADS_DIR`).
  * `packages/server/src/room/encounter-session.js`: у сессии появился `chatLog` (`id`, `timestamp`, `author`, `text`, `image`, `visibility`, `dice`). `addChatMessage()` определяет отправителя: при `user.characterId` берёт имя и аватар персонажа, иначе имя/цвет игрока; распознаёт `/r NdX` (и `/roll`), серверно генерирует `rolls`/`total`. `getChatLogFor(viewer)` фильтрует историю: `gm` — только мастеру, `blind` — автор и мастер видят результат, остальные получают `?`-заглушку, `self` — только автору. `deleteChatMessage()` разрешает автору или GM, `setChatVisibility()` меняет режим, `clearChat()` очищает лог.
  * `packages/server/src/index.js`: новые WS-сообщения `room:chat-message` (`{ text, image, visibility }`), `room:chat-delete` (`{ id }`), `room:chat-clear` (только GM) и `room:chat-visibility` (`{ id, visibility }`); после каждого изменения каждому клиенту уходит персональный `room:chat-update` с отфильтрованным `chatLog`. При join/`request:snapshot` история сразу отправляется клиенту.
  * `packages/client/src/net/network-client.js`: методы `sendChatMessage()`, `deleteChatMessage()`, `clearChat()`, `setChatVisibility()`, `uploadChatImage()` (fetch `/api/upload` + FormData) и `onChatUpdate()`.
  * `packages/client/src/ui/ChatPanel.jsx`: правая панель `position: absolute; right: 0; top: 0; bottom: 0; width: 320px`; сворачивание треугольником внизу; лог с автоскроллом, аватаром (картинка персонажа или инициалы), именем, временем, бейджем видимости и кнопкой «Удалить»; ПКМ открывает меню «Открепить сообщение / Сделать приватным / Удалить»; `textarea` с Drag-and-Drop PNG/JPEG (загрузка на `/api/upload` и отправка `room:chat-message` с URL); панель видимости 🌐/🎭/👁️‍🗨️/👤 и очистка 🗑️ через модальное окно «Вы уверены, что хотите очистить весь чат? Да / Нет».
  * `packages/client/src/ui/Toolbar.jsx`: в левую колонку добавлена категория «Кубики» (`dice`, 🎲). Во второй колонке — матрица: типы d2…d100 слева, кнопки количества 2–8 справа; клик по типу отправляет `/r 1dX`, клик по количеству — `/r NdX` через `networkClient.sendChatMessage()`.
  * `packages/client/src/ui/StoreContext.jsx`: `chatLog` в контексте + подписка на `onChatUpdate()`.
  * `styles.css`: Foundry-стили `.chat-panel`, сообщений, карточек броска, Drag-and-Drop-зоны, модального подтверждения и матрицы кубиков `.dice-matrix`.
  * Тесты: `packages/server/tests/chat.test.js` (идентичность персонажа, `/r`, фильтрация видимости, права удаления/смены видимости, WS-рассылка, `POST /api/upload` + раздача файла). `npm run test --workspace=@pf2e/server` — 12/12 (5 action-pipeline + 2 users-sync + 5 chat), `npm run build --workspace=@pf2e/client` — успешно (763 модуля), `npm run dev:client` — Vite ready. Проверено в браузере: бросок d4 из HUD, `/r 1d4` в textarea, Drag-and-Drop PNG (файл сохранён в `data/uploads/`, сообщение получило `/uploads/...`), ПКМ-меню сообщения, смена видимости на GM Only, модальное подтверждение очистки и сворачивание панели.
- [x] **Шаг 4.5: Правая боковая панель, 8 вкладок, уведомления, директории, журналы и Combat Tracker**:
  * `packages/client/src/ui/sidebar/RightSidebar.jsx` — контейнер из основной панели (`width: 320px`) и узкого icon-bar (`44px`). Сверху вниз: Чат (💬), Столкновения (⚔️), Сцены (🗺️), Актёры (👤), Предметы (💼), Журналы (📖), Библиотеки (📚), Настройки (⚙️); нижняя кнопка ▶/◀ сворачивает/разворачивает панель, оставляя только столбец иконок. `App.jsx` рендерит `<RightSidebar />` вместо отдельного `ChatPanel`; чат встроен через `<ChatPanel embedded />`.
  * `packages/client/src/ui/sidebar/ChatToasts.jsx` — подписка на `room:chat-update`, отслеживание уже виденных id и всплывающие уведомления в правом нижнем углу (над кнопкой сворачивания, `z-index: 2500`, поверх любых окон) при неактивной вкладке Чата или свёрнутой панели. Показываются имя отправителя и текст/результат броска; каждое уведомление удаляется через ровно 7 секунд (`TOAST_DURATION_MS = 7000`). Собственные сообщения не дублируются.
  * `packages/client/src/ui/sidebar/DirectoryPanel.jsx` — общая логика директорий: верхние кнопки «Создать …» и «📁 Создать папку», поиск, дерево папок с цветным заголовком, счётчиком и кнопкой «+» для создания сущности внутри папки. Универсальная модалка «Папка: Папка» с полями «Название», «Цвет (HEX)» и радиокнопками «По алфавиту / Ручной порядок». Модалки создания: «Создание: Сцена» (название, папка), «Создание: Актёр» (название, тип «Персонаж игрока / Персонаж мастера», папка), «Создание: Предмет» (название, тип предмета, папка), «Создание: Запись» (название, папка).
  * Сцены отображаются широкими карточками с превью-изображением (placeholder `public/assets/ui/item-placeholder.svg`); актёры под именем показывают «N-й уровень» или «Существо N»; предметы — тип; журналы открывают отдельное окно по клику.
  * `packages/client/src/ui/sidebar/LibraryPanel.jsx` — данные из `GET /api/compendiums`; встроенные папки «Создание персонажа» (Действия, Заклинания, Черты, Снаряжение) и «Инструменты мастера» (Бестиарий, Снаряжение). Клик по библиотеке открывает Compendium Browser на соответствующей вкладке (добавлены вкладки «Действия» и «Снаряжение», поддержан `initialTabId`).
  * `packages/client/src/ui/windows/JournalSheet.jsx` — отдельное окно журнала: левая колонка со списком страниц, поиском, HTML5 Drag-and-Drop сортировкой и кнопкой «+ Добавить страницу» (запрос названия); правая колонка — `contenteditable`-редактор с панелью «Формат» (заголовки H1–H3, цитата, блок кода), строковым стилем, Жирным/Курсивом, цветом текста, списками, выравниванием, вставкой изображения, очисткой форматирования и «Сохранить» через `document.execCommand`.
  * `packages/client/src/ui/sidebar/CombatTracker.jsx` — при отсутствии encounter кнопка «+ Создать бой» (`sendIntent("roll-initiative")`); при неброшенной инициативе (`rolling`) — список бойцов и кнопка «⚔️ Начать столкновение» (`room:start`); при `running` — текущий раунд, инициатива с подсветкой активного хода и кнопки «◀ Предыдущий», «■ Завершить», «Следующий ▶», «Следующий раунд». Контролы GM продублированы серверными `room:previous-turn`, `room:next-round`, `room:finish-encounter`; после `room:start`/ходов рассылается `room:state-update`.
  * `packages/client/src/ui/sidebar/SettingsPanel.jsx` — заглушка «Настройки»: версия системы PF2e Remastered 1.0.0 и неактивные кнопки «Настройки игры», «Настройки управления», «Настройка мира».
  * `packages/server/src/room/encounter-session.js` — in-memory `directories` (`scenes`, `actors`, `items`, `journals`) с папками (`id`, `name`, `color`, `sortMode`, `createdAt`) и сущностями; журналы хранят упорядоченные `pages`. Методы `createFolder`, `createDirectoryEntry`, `addJournalPage`, `updateJournalPage`, `deleteJournalPage`, `reorderJournalPages`, `getDirectories`; изменения рассылаются как `room:directories-update` без записи в боевой лог. `snapshot()` теперь содержит `directories`.
  * `packages/server/src/index.js` — WS-события `room:create-folder`, `room:create-scene`, `room:create-actor`, `room:create-item`, `room:create-journal`, `room:journal-page-add/update/delete/reorder`; дополнительные боевые команды `room:previous-turn`, `room:next-round`, `room:finish-encounter` (только GM) с broadcast состояния.
  * `packages/client/src/net/network-client.js` — методы `onDirectoriesUpdate`, `createFolder`, `createDirectoryEntry`, журнальные методы, `startEncounter`, `nextTurn`, `previousTurn`, `nextRound`, `finishEncounter`.
  * `packages/client/src/ui/StoreContext.jsx` — `directories` в контексте, подписка на `room:directories-update`, извлечение из `joined`/`session:snapshot`; `mergeRoomSnapshot` сохраняет богатый serialized-state, но обновляет раунд/активного бойца из плоских снапшотов.
  * `packages/client/src/ui/styles.css` — стили правой панели/icon-bar, всплывающих уведомлений, директорий, цветных папок, карточек сцен, библиотек, Combat Tracker, настроек и окна журнала.
  * Попутный багфикс: `packages/client/src/canvas/token-layer.js` — метод `_position` переименован в `_placeToken`, потому что Pixi `Container` создаёт одноимённое поле `_position` и затенял метод (ошибка `this._position is not a function` ломала обработчик `joined` и мешала синхронизации UI).
  * Тесты: `packages/server/tests/directories.test.js` (создание папок/сцен/актёров/предметов/журналов, страницы и их сортировка, WS-рассылка `room:directories-update`). `npm run test --workspace=@pf2e/server` — 14/14 (5 action-pipeline + 2 users-sync + 5 chat + 2 directories); `npm run build --workspace=@pf2e/client` — успешно (770 модулей); проверено в браузере на `npm run dev:client`: 8 вкладок, сворачивание, тосты при неактивном чате/свёрнутой панели с исчезновением через 7 с, модалки сцен/актёров/предметов/журналов, открытие JournalSheet с WYSIWYG, библиотеки из `/api/compendiums`, запуск и управление столкновением.
- [x] **Шаг 4.6: Связать левый HUD с интерактивностью PixiJS и доработать Компендиум**:
  * `packages/client/src/ui/Toolbar.jsx`: порядок категорий в первой колонке — «Токены» (👤) первой, «Рисование», «Стены», «Освещение», «Кубики» (🎲) последними. Повторный клик по уже активной категории сбрасывает `activeTool`/`activeSubTool` в `null` и скрывает правую колонку с под-инструментами; повторный клик снова раскрывает её. `useEffect` публикует глобальное DOM-событие `pf2e:tool-change` (`{ category, tool }`) при каждом изменении инструмента.
  * `packages/client/src/canvas/viewport.js`: добавлен `cameraEnabled`, глобальный слушатель `pf2e:tool-change`. Панорамирование ЛКМ/СКМ, колесо и будущий pinch работают только при `activeTool === "token" && activeSubTool === "select"`. Для всех остальных инструментов drag/zoom отключены (эквивалент `viewport.plugins.pause("drag")` pixi-viewport), поэтому клик и удержание мыши достаются инструменту.
  * `packages/client/src/canvas/interaction.js` (новый): `InteractionLayer` навешивает на `app.stage` обработчики `pointerdown`/`pointermove`/`pointerup`/`pointerupoutside`, переводит экранные координаты в мировые через `viewport.screenToWorld` и передаёт их заглушкам инструментов событием `pf2e:tool-pointer` (`{ phase, category, tool, world, screen, button }`). Для линейки (`token/ruler`), стен (`wall/*` кроме выбора/очистки) и рисования (`draw/rect|ellipse|polygon|freehand`) при зажатой ЛКМ рисует временную линию в `PIXI.Graphics` внутри `viewport.world` (толщина компенсирует зум). Слой подключён в `packages/client/src/main.js` поверх токенов и доступен как `window.pf2e.interactionLayer`.
  * `packages/client/src/ui/CompendiumBrowser.jsx`: окно перетаскивается за заголовок (`pointerdown` + pointer capture, координаты `left/top` в state), кнопка закрытия не запускает drag. Добавлены фильтры уровня «От»/«До» (`minLevel`, `maxLevel`) с debounce 250 мс; они уходят в query-параметры `/api/compendiums/:category` и сбрасывают пагинацию. Клик по карточке (без перетаскивания) открывает модальное окно поверх библиотеки с названием, типом, уровнем, чертами и текстовым описанием (`description` или `system.description.value`, догружается через `/api/compendiums/:category/:id`); drag-and-drop карточки сохранён.
  * `packages/server/src/compendium/catalog-service.js`: уровень записи читается как `entry.level`, либо как `system.level.value` для полных Foundry-документов; `minLevel`/`maxLevel` принимают отрицательные значения (уровни PF2e от -1).
  * `packages/client/src/ui/styles.css`: стили перетаскиваемой шапки Компендиума, компактных полей уровня и модального просмотра описания.
  * Проверка: `npm run build --workspace=@pf2e/client` — успешно; в браузере HUD сворачивается повторным кликом по активной иконке, «Токены» сверху и «Кубики» снизу, камера двигается только в режиме «Токены → Выбор», а линейка/стены/рисование показывают временную линию; окно библиотеки перетаскивается за шапку, фильтр уровня сужает выдачу, клик по карточке открывает описание.
- [x] **Шаг 4.7: Рабочие инструменты левого HUD, сортировка Компендиума и сохранение на диск**:
  * Persistence (`packages/server/src/room/encounter-session.js`): `EncounterSession` получил `dataFile`, `saveToDisk(filePath)` и `loadFromDisk(filePath)` на `node:fs/promises`. Файл по умолчанию — `packages/server/data/session.json`; сохраняются `directories` (сцены/актёры/предметы/журналы с папками и страницами), `chatLog` и счётчики id. Запись атомарная (`.tmp` + `rename`), очереди записей сериализованы через `_saveChain`; `flushPersistence()` дожидается их завершения. Любая мутация директорий/чата (`createFolder`, `createDirectoryEntry`, журнальные страницы, сообщения, удаление/видимость) ставит сохранение в очередь.
  * `packages/server/src/index.js`: путь `SESSION_FILE` (переопределяется env `SESSION_FILE`), `PERSISTENCE_ENABLED` включается для `npm run start:server` (или `PF2E_PERSIST=1`); `startServer()` загружает файл до открытия порта, `closeServer()` сбрасывает очередь. Заодно исправлен reconnect-баг: повторный `join` с тем же `memberId` заменяет устаревшего участника, а закрытие старого сокета не удаляет нового.
  * Сортировка Компендиума (`packages/server/src/compendium/catalog-service.js`): `filterIndex()` сортирует результат **сначала по уровню (возрастание), затем по названию** (`compareCatalogEntries`); записи без уровня (большинство снаряжения) идут после уровневых. Сортировка применяется до `offset`/`limit`, поэтому страницы и «Показать ещё» остаются согласованными.
  * Общая математика сетки (`packages/client/src/canvas/grid.js`, новый): `GRID_SIZE = 100` px = 5 ft, `cellFromWorld`, `cellCenter`, `snapToCorner`, `snapToCellCenter`, `measureCells`/`measureFeet` по PF2e 5-10-5 — `straight + floor(diagonal * 1.5)` клеток × 5 футов. Все новые слои используют один `createGrid({ gridSize })`.
  * Линейка (`packages/client/src/canvas/ruler-layer.js` + `grid.js`): ЛКМ ставит начало в центре клетки, затем путь строится **по клеткам** алгоритмом Брезенхема (`grid.cellsBetween`) через центры пересечённых клеток, а не прямой линией. Дистанция считается по PF2e 5-10-5: `(straight + floor(diagonal * 1.5)) * 5 ft`; подпись `N ft (M кл.)` выводится над концом пути, толщина линии и масштаб текста компенсируют зум. Проверено: 1 диагональ = 5 ft, 2 диагонали = 15 ft, 4 прямые клетки = 20 ft.
  * Рисование (`packages/client/src/canvas/draw-layer.js`): `rect`/`ellipse` привязывают углы к сетке, `freehand` идёт по сырым координатам мыши. `polygon` теперь кликовый: первый ЛКМ ставит вершину, каждая следующая ЛКМ добавляет вершину, двойной клик замыкает и фиксирует фигуру (`finishPolygon`). `text` создаёт `PIXI.Text` через `prompt` и редактирует существующий по клику. `select` находит рисунок/текст, рисует белую рамку с угловыми маркерами и перетаскивает объект (`beginItemDrag`/`updateDrag`/`endDrag`). `clear` из HUD показывает `window.confirm("Удалить все рисунки?")` и очищает слой только после подтверждения. Палитра HUD применяется к новым рисункам.
  * Стены (`packages/client/src/canvas/wall-layer.js`): ЛКМ+тянуть создаёт сегмент по сетке; `normal` — светло-серая, `terrain` — зелёная, `invisible` — полупрозрачная синяя, `ethereal` — фиолетовая, `door` — золотая, `secret` — розовая; у дверей/секретов иконка 🚪 по центру. Двери открываются/закрываются ЛКМ в режиме `token → select` и в режиме выбора стен; ПКМ в режиме `wall` запирает/отпирает (красный 🔒, замок блокирует открытие). `clear` показывает `window.confirm("Удалить все стены?")`.
  * Освещение (`packages/client/src/canvas/light-layer.js`): `draw` задаёт радиус длиной оттягивания (в футах), источник рисуется полупрозрачным жёлтым кругом и 💡; двойной клик по иконке вызывает `prompt` для яркого/тусклого радиусов; `darkness` ставит альфу чёрного оверлея 0 / 0.4 / 0.8, `gm-vision` снижает её до 35 %; `select` перетаскивает источники; `clear` показывает `window.confirm("Удалить весь свет?")`.
  * Роутинг (`packages/client/src/canvas/interaction.js` + `viewport.js`): `pointerdown`/`pointermove`/`pointerup` конвертируются в мировые координаты и распределяются по слоям. В `token → select` пустая ЛКМ+протяжка панорамирует камеру, ЛКМ по токену выделяет и перетаскивает его (камера временно блокируется через `viewport.plugins.pause("drag")`), ЛКМ по двери открывает/закрывает её. В `token → ruler` камера отключена, путь идёт по клеткам. Полигон обновляет превью между кликами, двойной клик завершает. ПКМ по двери в режиме стен переключает замок; контекстное меню подавлено.
  * `packages/client/src/main.js`: слои подключены в порядке `grid → drawings → walls → tokens → light/darkness → ruler`, `cellSize = 100`, все слои доступны через `window.pf2e` для отладки.
  * Тесты: новый `packages/server/tests/persistence.test.js` — round-trip persistence, отсутствующий файл, in-memory режим, сортировка level/name и проверка реального `spells.index.json`. `npm run test --workspace=@pf2e/server` — 19/19 (5 action + 2 users + 5 chat + 2 directories + 5 persistence); `npm run build --workspace=@pf2e/client` — успешно (776 модулей). Проверено в браузере (`npm run dev:client`) через реальный указательный ввод PixiJS: перетаскивание токена меняет его клетку, пустая ЛКМ двигает камеру только в `token → select`, дверь переключается из режима токенов, линейка на двух диагоналях показывает `15 ft (3 кл.)`, полигон строится кликами и завершается двойным, рамка выделяет и двигает рисунок, `confirm` вызывается для всех трёх мусорок, `prompt` меняет радиусы света, а `GET /api/compendiums/spells?limit=250` возвращает монотонную сортировку по уровню и имени.
- [x] **Шаг 4.8 (часть 1): Мультивыделение, хоткеи, resize рисунков, выбор стен/света и менеджер активных сцен**:
  * `packages/client/src/canvas/interaction.js`: добавлен общий Marquee (`Graphics` поверх `viewport.world`) для режимов `select` любой категории. Пустая ЛКМ + протяжка рисует рамку, при отпускании объекты текущего слоя выбираются пересечением AABB. Панорамирование камеры теперь всегда выполняется удержанием ПКМ, поэтому Marquee на ЛКМ не конфликтует с камерой. Marquee отменяется при смене инструмента и при `_cancelGesture()`.
  * `interaction.js`: глобальный `keydown`-слушатель удаляет выделенные объекты текущего слоя по `Delete` (игнорируются `INPUT`/`TEXTAREA`/`SELECT`/`contenteditable`). Для токенов удаление локальное; GM дополнительно отправляет `room:remove-combatant`. После удаления рисунков/стен/света публикуется `pf2e:scene-canvas-changed`.
  * `interaction.js`: `_onToolChange` теперь сбрасывает выделения на всех слоях (`tokenLayer`, `drawLayer`, `wallLayer`, `lightLayer`) и обновляет видимость маркеров света через `lightLayer.setActiveCategory(...)`.
  * `interaction.js`: Shift+ПКМ по двери в режиме стен переключает замок (как и раньше), при этом обычное удержание ПКМ остаётся панорамированием. В `wall → select` ЛКМ по стене выделяет её и начинает перетаскивание, пустое место рисует Marquee; перетаскивание меняет `x1/y1/x2/y2` всех выделенных сегментов. В `light → select` клик по источнику выделяет/двигает его, пустое место — Marquee. В `draw → select` сначала проверяется угловой маркер (resize), затем перетаскивание объекта, затем Marquee.
  * `packages/client/src/canvas/token-layer.js`: `selectedIds: Set`, `selectTokens`, `selectInRect`, `deleteSelected`, `serializeScene`, `applyScenePositions`. Белые кольца рисуются для каждого выбранного токена.
  * `packages/client/src/canvas/draw-layer.js`: у каждого рисунка появились `color` и сериализуемое `data` (`rect`/`ellipse`/`polygon`/`freehand`/`text`), трансформация хранится как `tx/ty/scaleX/scaleY`. Добавлены `serialize()`/`loadState()`, мультивыделение (`selectionItems`, `itemsInRect`, `selectItems`), удаление и интерактивный resize за угловые маркеры (`beginResize`/`updateResize`/`endResize`, `_applyBounds`). Перемещение теперь применяется ко всем выбранным объектам.
  * `packages/client/src/canvas/wall-layer.js`: `selectedIds`, `wallAt`, `selectWall(s)`, `selectInRect`, `deleteSelected`, `beginDrag`/`updateDrag`/`endDrag`, `serialize()`/`loadState()` и отдельный слой подсветки (голубая линия + белые концы). `renderAll()` перерисовывает выделение.
  * `packages/client/src/canvas/light-layer.js`: `💡` виден только при `activeCategory === "light"` (`setActiveCategory`), при остальных инструментах маркер скрыт, а затемнение/источники продолжают работать. Добавлены `selectedIds`, `selectSource(s)`, `selectInRect`, `deleteSelected`, `serialize()`/`loadState()` и белые кольца выделения.
  * `packages/server/src/room/encounter-session.js`: `activeSceneId`, `baseSceneCanvas` и scene-canvas (`walls`, `drawings`, `lights`, `tokens`) на записях `scenes[id]`. Методы `getSceneCanvas`, `activateScene`, `updateSceneCanvas`; события `room:scene-activated` / `room:scene-canvas-update` отправляются слушателям напрямую (без записи в боевой лог). `saveToDisk`/`loadFromDisk` сохраняют activeSceneId, baseSceneCanvas и scene-canvas вместе с директориями в `packages/server/data/session.json`. Комбатанты получают `sceneId` при добавлении и он попадает в `serializeState()`/`snapshot()`.
  * `packages/server/src/index.js`: WS-сообщения `room:activate-scene` (`{ sceneId }`) и `room:scene-canvas-update` (`{ sceneId, canvas }`; источник передаётся как `sourceMemberId`).
  * `packages/client/src/net/network-client.js`: `activateScene`, `updateSceneCanvas`, `onSceneActivated`, `onSceneCanvasUpdate`, `removeCombatant`.
  * `packages/client/src/ui/StoreContext.jsx`: `activeSceneId` в контексте; обновляется из `joined`, `session:snapshot` и `room:scene-activated`.
  * `packages/client/src/ui/sidebar/DirectoryPanel.jsx`: карточка сцены кликабельна и содержит кнопку «Активировать»; активная сцена подсвечивается рамкой Foundry `#ff6400`. Ошибки активации выводятся в панель. Стили — `.directory-scene-card--active`, `.directory-scene-card__activate` в `styles.css`.
  * `packages/client/src/main.js`: загрузка scene-canvas при join/активации, очистка и повторная загрузка рисунков/стен/света, фильтрация токенов по `sceneId`, восстановление сохранённых позиций токенов один раз после активации, debounce 250 мс и отправка полного canvas через `updateSceneCanvas` по событию `pf2e:scene-canvas-changed`; собственные broadcast-обновления игнорируются по `sourceMemberId`.
  * Тесты: новый `packages/server/tests/scenes.test.js` — активация и пустой canvas, сохранение массивов на сцене, round-trip `session.json` для сцен и базовой сцены, привязка комбатантов к сцене, WS-broadcast активации и canvas-обновлений. `npm run test --workspace=@pf2e/server` — 24/24 (5 action + 2 users + 5 chat + 2 directories + 5 persistence + 5 scenes); `npm run test:core` — 558/558; `npm run build --workspace=@pf2e/client` — успешно (776 модулей).

- [x] **Шаг 4.7+ (Foundry-полировка UX/UI холста): вейпоинты, чейнинг стен, точный свет и полигоны**:
  * Линейка (`packages/client/src/canvas/ruler-layer.js`): добавлен массив `waypoints` и метод `addWaypoint(worldPoint)`. Во время измерения (удерживается ЛКМ) клик ПКМ ставит промежуточную точку; `end`/`cancel` очищают/сбрасывают путь. `_anchors()` собирает старт → все вейпоинты → текущий конец, `_buildPath()` проходит `grid.cellsBetween` по каждому отрезку (Брезенхем, центры клеток), суммирует `grid.measureCells` по сегментам и умножает на 5 футов — дистанция считается по правилу PF2e 5-10-5 на каждом участке ломаной, а не по прямой старт→финиш. Промежуточные точки рисуются отдельными жёлтыми маркерами с тёмной обводкой, подпись показывает суммарные `N ft (M кл.)`.
  * `packages/client/src/canvas/interaction.js`: при `pointerdown` с `button === 2` сначала обрабатывается вейпоинт линейки (`rulerLayer.dragging`), затем завершение полигона, затем замок двери; `pointerup` не-левой кнопки игнорируется, поэтому ПКМ-клик не обрывает удержание ЛКМ. Добавлен `_modifiers(event)` (`Shift`/`Ctrl`, читаются из `nativeEvent` и федеративного события).
  * Стены (`packages/client/src/canvas/wall-layer.js`): `resolvePoint(worldPoint, { free, excludeWall })` — по умолчанию примагничивает конец к ближайшему узлу существующей стены в радиусе `NODE_MAGNET_PX = 15` экранных пикселей (`15 / zoom`), иначе привязывает к пересечению сетки; `Shift` (`free`) отключает и сетку, и магнитизм, оставляя сырые координаты мыши. В `_renderPreview` конечная точка подсвечивается голубым, когда «прилипла» к узлу.
  * Чейнинг стен (`Ctrl`): `begin`/`update`/`end` принимают `{ free, chain }`. При отпускании ЛКМ с зажатым `Ctrl` сегмент сохраняется, `chainFrom` фиксируется в его конечной точке, инструмент остаётся активным, превью сразу продолжается из этого узла; `interaction.js` не сбрасывает `gesture = "wall"` и возвращает управление, пока не последует отпускание ЛКМ без `Ctrl`. Так строится непрерывная ломаная стена.
  * Редактирование узлов (`wall → select`): `handleAt` находит концевые маркеры только у выделенных стен; `_renderSelection` рисует квадратные маркеры на обоих концах и голубой центральный маркер. `beginDrag` переключается в режим `node` (перетаскивание конца меняет `x1/y1` или `x2/y2` — длина и угол) либо `segment` (перемещение всех выделенных сегментов). `updateDrag` для узла использует `resolvePoint` с исключением собственной стены из магнитизма; `Shift` даёт свободное размещение.
  * Скрытая дверь: обычная дверь остаётся эмодзи 🚪 (🔒 при замке), а `secret` рисуется процедурной аркой через `_createSecretDoorIcon` (`Graphics.arc` + стойки), поэтому типы визуально различимы; цвет по-прежнему отражает `open`/`locked`.
  * Свет (`packages/client/src/canvas/light-layer.js`): убрано округление радиуса до целых клеток/футов. Длина оттяжки задаёт **тусклый** радиус точно в пикселях (`dimFeet = pixelsToFeet(radius)` без `Math.round`), **яркий** всегда равен `dimFeet / 2`; превью рисует оба круга (dim + bright/2), `renderAll` обводит и внешний тусклый радиус, `loadState` допускает дробные значения, двойной клик принимает дробные футы (`parseFloat`, запятая как разделитель). При `gridSize = 100` / 5 ft оттяжка 250 px даёт `dimFeet = 12.5`, `brightFeet = 6.25`, обратное преобразование — ровно 250 px / 125 px.
  * Полигоны (`packages/client/src/canvas/draw-layer.js` + `interaction.js`): завершение перенесено с дабл-клика на ПКМ. `finishPolygon` отбрасывает тянущуюся линию до курсора и замыкает `polygonPoints` (`closePath`), соединяя последнюю поставленную ЛКМ вершину с первой; при < 3 точках фигура отменяется. `pointerdown` ЛКМ теперь только добавляет вершину.
  * Совместимость данных: формат `serialize()` стен/света/рисунков не менялся, свет допускает дробные `brightFeet`/`dimFeet`; вейпоинты линейки живут только в памяти сеанса измерения.
  * Проверка: `npm run build --workspace=@pf2e/client` — успешно (776 модулей). В браузере (`npm run dev:client`) через реальные `PointerEvent` на канвасе: ПКМ во время измерения ставит 1 вейпоинт, путь 500→500 px ломается в узле и даёт `30 ft (6 кл.)` (два отрезка по 3 клетки), отпускание ПКМ не завершает линейку; Ctrl-отпускание сохраняет сегмент и оставляет `gesture = "wall"` (2 сегмента после второго отпускания без Ctrl), Shift даёт координаты `[450,450] → [473,431]` без привязки, конец в 10 px от узла `(800,100)` примагничивается ровно в него; после выделения стены перетаскивание конца меняет `x1/y1` на `(800,400)`, а центральный маркер двигает сегмент целиком; свет из оттяжки 250 px создаётся с `dimFeet = 12.5` / `brightFeet = 6.25`; полигон из трёх ЛКМ-вершин закрывается ПКМ (3 точки, `closePath`); у скрытой двери в `storage` только `Graphics`-арка, у обычной — `Text`. Console: 0 ошибок и предупреждений.

- [x] **Шаг 4.8 (часть 1): Полноценный лист персонажа PF2e, панорамирование ПКМ и плавающий чат**:
  * Камера (`packages/client/src/canvas/viewport.js`, `interaction.js`): панорамирование теперь запускается **только** правой кнопкой мыши (`event.button === 2`) при любом активном инструменте. ЛКМ больше никогда не двигает камеру: в `token → select` она занята кликом по токену/двери и Marquee. На `pointerdown` с ПКМ `interaction` вызывает `viewport.plugins.resume("drag")`, а `contextmenu` на канвасе подавляется через `preventDefault()`. Shift+ПКМ в режиме стен по-прежнему переключает замок двери, ПКМ во время линейки ставит вейпоинт, ПКМ при активном полигоне замыкает его. Проверено синтетическими `PointerEvent`: ЛКМ-протяжка 80×40 px не меняет `viewport.world` (`0,0`), ПКМ-протяжка сдвигает его ровно на `80,40`.
  * Плавающий чат (`packages/client/src/ui/sidebar/FloatingChatInput.jsx`, `RightSidebar.jsx`): при свёрнутой правой панели внизу экрана, левее столбца иконок, остаётся компактная строка ввода (`textarea`) с кнопкой видимости (public → GM → blind → self), кнопкой 🎲 (`/r 1d20`) и отправкой по Enter. Кнопка `⤢` разворачивает панель на вкладке «Чат». В браузере отправлено текстовое сообщение и бросок `/r 1d20` — оба попали в `chatLog` и `session.json`.
  * Лист персонажа (`packages/client/src/ui/windows/CharacterSheet.jsx`): отдельное плавающее окно (portal, почти на весь экран), открывается по ЛКМ на Актёре типа `character` в директории. Повторяет структуру `static/templates/actors/character/sheet.hbs`: левый sidebar (HP, AC/щит, восприятие, инициатива, спасброски, иммунитеты/слабости/сопротивления) + `char-header` (имя, уровень, опыт) + навигация + контент. Вкладки: **Основа** (`tabs/character.hbs` — портрет, черты, наследие/предыстория/класс/божество, сведения, языки, скорости, модификаторы атрибутов), **Бой** (`partials/strike.hbs` — атаки, бонусы, урон, черты, кнопки d20/урона), **Инвентарь** (`tabs/inventory.hbs` — монеты, таблица предметов, экипировка/инвеститура, расчёт Bulk и перегруз), **Действия** (`tabs/actions.hbs` — столкновение/исследование/свободное время), **Заклинания** (`tabs/spellcasting.hbs` — круг, традиция, стоимость, подготовка), **Черты** (`tabs/feats.hbs` — секции наследия/класса/навыка/общих/бонусных), **Навыки** (`tabs/proficiencies.hbs` — 16 навыков, знания, спасброски, восприятие, владения атаками/защитой), **Эффекты** (`tabs/effects.hbs` — состояния и эффекты). Все списки поддерживают добавление/редактирование/удаление, а кнопки d20/урона/действий отправляют `/r` в чат.
  * Данные и математика (`packages/client/src/ui/windows/character/character-data.js`): `actor.system` нормализуется к Foundry-подобному контракту (`abilities`, `attributes.hp/ac/shield/immunities/weaknesses/resistances`, `details`, `traits`, `perception`, `initiative`, `saves`, `skills`, `lore`, `speeds`, `proficiencies`, `strikes`, `inventory`, `actions`, `spells`, `feats`, `conditions`, `effects`). Бонус владения считается как в `src/module/actor/modifiers.ts`: ранг 0 не добавляет уровень, ранги T/E/M/L дают `level + 2/4/6/8`. Отображаются значки **U/T/E/M/L**; спасброски, навыки, восприятие и инициатива считаются из атрибута + владения.
  * Редакторы и словари (`CharacterModals.jsx`): модальное окно IWR по образцу `templates/actors/iwr-editor.hbs` — тип из выпадающего списка, значение для слабостей/сопротивлений, поле исключений и `doubleVs` для сопротивлений. Словари иммунитетов/слабостей/сопротивлений собраны из эталонных `src/scripts/config/iwr.ts`, `damage.ts` и `traits.ts` (материалы, стихии, состояния, эффекты, традиции, holy/unholy и т.д.). Также реализованы модальные редакторы языков (теги + datalist), скоростей (5 типов в футах) и модификаторов атрибутов.
  * Persistence: `NetworkClient.updateActor(actorId, { name, system })` отправляет `room:update-actor`; сервер (`EncounterSession.updateActor`) атомарно проверяет владельца, валидирует/клонирует `system` с лимитом 256 КБ, обновляет `actor.level`, рассылает `room:directories-update` и ставит запись `packages/server/data/session.json` в очередь `_scheduleSave()`. Изменения HP (10 → 6) и иммунитет `fire` проверены в браузере и пережили чтение сохранённого файла; round-trip покрыт тестом.
  * Права и привязка: `PlayerConfigModal` теперь предлагает и листы персонажей из директории, и боевые токены, поэтому `users[].characterId` может указывать на `actor.id`; `_resolveChatAuthor` разрешает такое имя/портрет и для чата. Мастер открывает/редактирует/закрывает любой лист; игрок — только свой (по `users[].characterId`) или ещё не занятый персонаж. Чужой лист не открывается игроку и показывает уведомление в правой панели.
  * Тесты: новый `packages/server/tests/actors.test.js` — атомарное обновление `system`, права владельца/GM, чат-идентичность по листу, round-trip `saveToDisk/loadFromDisk`, WS-broadcast `room:update-actor`. `npm run test --workspace=@pf2e/server` — 29/29 (5 action + 2 users + 5 chat + 2 directories + 5 persistence + 5 scenes + 5 actors); `npm run build --workspace=@pf2e/client` — успешно (781 модуль); `npm run test:core` — 558/558. В браузере открыты все 8 вкладок, ошибок консоли нет.

## 4. Следующие шаги (Roadmap)
- [x] **Шаг 3**: Связка Vite dev-сервера с бэкендом, раздача статики и ассетов (прокси `/api` + `/ws`, `dist` на едином порту, базовый `NetworkClient`).
- [ ] **Шаг 4**: UI Foundry-стиля (окна, листы персонажей, инвентарь, drag-and-drop черт и предметов, hotbar макросов).
  - [x] **Шаг 4.1**: Установка React, контекст состояния, Compendium Browser, Drag-and-Drop payload.
  - [x] **Шаг 4.2**: React Toolbar / HUD: токены (выделение + линейка 5-10-5), рисование, стены (8 инструментов, точная механика ландшафтных стен), освещение (уровни темноты, зрение мастера).
  - [x] **Шаг 4.3**: Панель игроков, контекстное меню, модальное окно настройки профиля, WS-синхронизация пользователей.
  - [x] **Шаг 4.4**: Чат, отправка /r кубиков, загрузка картинок (formidable), контекстное меню сообщений, матрица кубиков в HUD.
  - [x] **Шаг 4.5**: Правая панель, 8 вкладок, сворачивание, всплывающие сообщения на 7 сек, директории с папками, журналы с WYSIWYG, библиотеки, Combat Tracker, настройки.
  - [x] **Шаг 4.6**: Сворачивание колонок HUD, правильный порядок кнопок, блокировка drag-камеры PixiJS под инструменты, перетаскиваемое окно Компендиума с фильтрами уровня и просмотром карточек.
  - [x] **Шаг 4.7**: Рабочие слои линейки/рисования/стен/света, PF2e 5-10-5, двери с состояниями, сортировка Компендиума по уровню, persistence `data/session.json`.
  - [x] **Шаг 4.8 (часть 1)**: Marquee-мультивыделение по всем `select`-инструментам, `Delete`, resize рисунков за углы, выбор/перетаскивание/удаление стен и источников света, скрытие 💡 вне вкладки освещения, Shift+ПКМ-замок двери в режиме стен, менеджер активных сцен (`activeSceneId`, `room:activate-scene`, scene-canvas в `session.json`, активация из карточки сцены).
  - [x] **Шаг 4.7+**: Foundry-полировка холста: вейпоинты линейки по ПКМ с суммированием 5-10-5 по сегментам, чейнинг стен (Ctrl), свободное размещение и отключение магнитизма (Shift), магнитизм узлов < 15 px, перетаскивание концов выделенной стены, точный радиус света (Dim = R, Bright = R/2), завершение полигона на ПКМ, иконка скрытой двери-арки.
  - [x] **Шаг 4.8 (часть 1, PC Sheet)**: Полный лист персонажа PF2e по шаблонам `static/templates/actors/character/` (8 вкладок), IWR/языки/скорости/атрибуты из эталонных словарей, сохранение `actor.system` через `room:update-actor` в `session.json`, панорамирование камеры строго по ПКМ, плавающий чат при свёрнутой панели.
  - [ ] **Шаг 4.8 (часть 2)**: Drag-and-Drop из Компендиума в лист, автоматизация предметов/классов/заклинаний, привязка листа к токену и derived-статистика.
- [ ] **Шаг 5**: PixiJS сцена (рендеринг стен, укрытий, шаблонов заклинаний и видимости).

## Step 4.8 (Part 1) — финализация (canvas fixes, chat bubbles, floating chat, PC sheet, derived stats, ABC)

### Canvas / ruler / camera
- `packages/client/src/canvas/interaction.js`: добавлены глобальные capture-обработчики `pointerdown` / `pointermove` / `pointerup` на `window`, поэтому ПКМ во время удержания ЛКМ больше не теряется. Вейпоинт ставится по ПКМ через `event.button === 2`, а также по битовой маске `event.buttons & 2` (ЛКМ=1, ПКМ=2, обе=3). `contextmenu` остаётся страховочным путём и всегда подавляет браузерное меню. Добавлен `viewport.panGuard`, который не даёт ПКМ-панорамированию стартовать одновременно с замером линейки.
- `packages/client/src/canvas/viewport.js`: панорамирование жёстко ограничено ПКМ (`event.button === 2`) во всех режимах; ЛКМ не двигает камеру. Колесо/зум по-прежнему работает только там, где камера разрешена.
- Проверено в браузере: ЛКМ-протяжка не меняет `viewport.world.x/y`, ПКМ-протяжка двигает камеру; `RulerLayer.addWaypoint()` добавляет точку при ПКМ во время активного замера.

### Chat bubbles
- Новый слой `packages/client/src/canvas/chat-bubble-layer.js`, подключён поверх сцены в `packages/client/src/main.js` (`window.pf2e.chatBubbleLayer`).
- Подписка на `room:chat-update`; первая порция истории только запоминается, новые сообщения рисуются облачком над токеном автора. Поиск токена: `author.characterId` → `combatantId` / `combatantData.characterId` / `actorId`, с fallback по имени.
- Облачко следует за токеном, масштабируется обратно при зуме, показывает текст и результат `/r` (скрытый бросок — `?`), живёт ~6.5 с и плавно исчезает последние 0.9 с. Слой не принимает pointer events.
- Проверено в браузере: сообщение «Привет из пузыря!» и бросок `1d20` создали bubble над токеном `test-hero-token`.

### Floating chat
- `packages/client/src/ui/sidebar/RightSidebar.jsx` + `FloatingChatInput.jsx`: при свёрнутой правой панели показывается компактная строка ввода у правого нижнего края; поддержаны видимость public/GM/blind/self, Enter, кнопка `🎲 /r 1d20` и разворот панели.

### Character sheet window
- `packages/client/src/ui/windows/CharacterSheet.jsx`: лист стал плавающим `position: fixed` окном шириной 820 px (адаптивно `min(820px, 96vw)`, высота `min(900px, 92vh)`), без затемнения и blur фона (`pf2e-sheet-backdrop` прозрачный, `pointer-events: none`; само окно — `pointer-events: auto`).
- Перетаскивание за заголовок через pointer capture, как в Compendium Browser; кнопки/поля заголовка не запускают drag. ABC-поля получили кнопки с лупой.
- Открытие по ЛКМ на актёра в директории через `DirectoryPanel` → `RightSidebar.openActor`.

### Derived statistics (`prepareActorData`)
- `packages/client/src/ui/windows/character/character-data.js`: добавлены `prepareActorData(actor)`, `prepareActorSystem(system)`, `armorClassBreakdown(system)`, `prepareStrikes(system)`.
- Модификатор характеристики: `floor((score - 10) / 2)`; старые данные только с `mod` автоматически переводятся в `score = 10 + mod * 2`.
- Бонус мастерства: `level + rank * 2` (U=0, T=2, E=4, M=6, L=8); Untrained = 0 без уровня.
- Безоружный удар (Fist): атака = Str Mod + бонус мастерства unarmed, урон = базовый дайс + Str Mod. Расчёт идемпотентен (не удваивает `+N`).
- КБ = 10 + Dex Mod (с `dexCap` надетой брони) + item bonus брони + бонус мастерства категории брони (unarmored/light/medium/heavy).
- Спасброски, Восприятие и навыки автоматически суммируют базовую характеристику и мастерство; значения сохраняются в `actor.system` и пересчитываются при каждом изменении.
- `AttributesEditorModal` теперь редактирует значения характеристик (score) и показывает вычисленный модификатор.

### ABC selection
- Новый `packages/client/src/ui/windows/character/CompendiumSelectModal.jsx`: поиск, иконка, название, источник/публикация, выбор строки. Использует `GET /api/compendiums/{ancestries|heritages|backgrounds|classes}`.
- В `CharacterTab` поля Наследие / Наследие (особенность) / Предыстория / Класс заменены на picker-кнопки; выбор сохраняет в `actor.system.details[key]` поля `id`, `name`, `img`, `value` и уходит на сервер через `room:update-actor`.
- `packages/server/scripts/build-compendiums.js`: добавлены категории `ancestries` (51), `heritages` (334), `backgrounds` (540), `classes` (29); в индекс добавлено поле `source`. Данные сгенерированы в `packages/server/data/compendiums/`. Проверено: `GET /api/compendiums/classes?search=fighter` → 200 + Fighter (Pathfinder Player Core).

### Verification
- `npm run test --workspace=@pf2e/client` — 6/6 (character-data: ability formula, proficiency, legacy scores, fist/saves, armor AC, idempotency).
- `npm run test --workspace=@pf2e/server` — 29/29.
- `npm run test:core` — 558/558.
- `npm run build --workspace=@pf2e/client` — успешно (783 modules).
- Ручная проверка в браузере: плавающий лист 770×603 при узком viewport, прозрачный backdrop, drag заголовка (x 15→106), ABC-класс Fighter выбран из 29 классов, Strength 18/Dex 14 дали AC 12 и Fist `+4 / 1d4+4`, floating chat `/r 1d20` создал bubble `🎲 1d20 = 9`.
- Примечание: после генерации новых каталогов запущенный ранее сервер нужно перезапустить — `CatalogService` читает индексы при старте.

## Step 4.8.1 — Глубокая автоматизация классов/родословных, экипировка и Spellcasting Entries

### Remastered-модификаторы
- Новый headless-модуль `packages/core/src/actor/prepare-data.js` (экспортируется как `Actor.PrepareData` из `@pf2e/core`). Клиентский `character-data.js` больше не содержит собственной математики: он импортирует и реэкспортирует функции ядра, поэтому сервер, тесты и лист персонажа используют один код.
- `actor.system.abilities[attr].mod` — единственный источник истины. `abilityMod()` читает только `mod`; формула `floor((score - 10) / 2)` удалена из живых расчётов. В `normalizeCharacterSystem()` остался одноразовый миграционный путь для старых сохранений, где был только `score`; результат нормализации хранит только `{ mod }`.
- `AttributesEditorModal` редактирует и сохраняет чистый модификатор (от −5 до +15), без поля score.

### ABC Pipeline (класс → `actor.items` + `actor.system`)
- `CharacterSheet` при выборе класса в `CompendiumSelectModal` (или drag-and-drop карточки класса из Compendium Browser) запрашивает `GET /api/compendiums/classes/:id` и передаёт полный документ в `applyClassToActor()`.
- `applyClassToActor()`:
  * добавляет все классовые особенности уровня ≤ текущего из `classDoc.system.items` в `actor.items` (`type: "feat"`; при наличии `actionType` — `type: "action"`);
  * дедуплицирует по `id`/`uuid`/`name+type`, поэтому повторный выбор и повышение уровня не создают дублей;
  * зеркалит особенности во вкладки «Черты» (`system.feats.class`) и «Действия» (`system.actions.encounter`);
  * устанавливает базовые мастерства класса: атаки (simple/martial/advanced/unarmed), защиту (unarmored/light/medium/heavy), восприятие и спасброски — ранги только повышаются, никогда не понижаются;
  * записывает `system.details.class` и ключевой атрибут класса.
- Повышение уровня (`system.details.level.value`) перезапускает пайплайн: новые фичи добавляются, слоты классовых черт строятся из `classFeatLevels` (1/2/4/6…), общие — из `generalFeatLevels` (3/7/11/15/19). В `FeatsTab` слоты интерактивны: «+ Заполнить» открывает редактор черты и привязывает выбранную черту к слоту.
- Сервер (`EncounterSession`) теперь хранит и валидирует `entry.items` / `room:update-actor.items` вместе с `system`; `NetworkClient.updateActor()` передаёт `items`.

### Экипировка и Strikes
- У предметов инвентаря канонический статус `carried: "held" | "worn" | "stowed"` (старый `equipped` мигрирует: броня → worn, остальное → held/stowed). В инвентаре появился селект «Ношение».
- `armorClassBreakdown()` учитывает броню только при `carried === "worn"`: бонус КБ, Dex Cap и мастерство категории не применяются, если броня лежит в рюкзаке или просто в руках.
- `prepareStrikes()` генерирует Strike из каждого оружия с `carried === "held"` (атака = модификатор силы/ловкости + мастерство категории + item bonus; урон = базовый дайс + Str/пропульсивный модификатор). Оружие в `stowed`/`worn` в боевом меню не появляется; ранее сгенерированные weapon-strikes пересобираются идемпотентно.
- Bulk: `totalBulk()` считает вклад каждого предмета (10 × L = 1 Bulk) и вычитает первые 2 Bulk предметов со статусом `stowed` — правило рюкзака PF2e.

### Spellcasting Entries
- Новая модалка `SpellcastingSetupModal`: тип (подготовленные/спонтанные/врождённые/фокусировка), мастерство (атака заклинаний / DC класса), традиция (арканный/сакральный/оккультный/природный), ключевой атрибут.
- Контейнер сохраняется в `actor.items` с `type: "spellcastingEntry"` и `system: { prepared, mode, tradition, ability, proficiency, slots }`.
- `prepareActorData()`/`prepareActorItems()` автоматически вычисляют `spellAttack = Level + Rank * 2 + KeyAttributeMod` и `spellDC = 10 + spellAttack`; значения доступны как `entry.spellAttack`, `entry.spellDC`, `entry.spellcasting` и в `system.derived.spellcasting`.
- Вкладка «Заклинания» показывает плашку набора с типом/традицией/атрибутом, атакой и DC; можно добавлять/удалять ранги ячеек и менять их текущее/максимальное значение.

### Тесты и проверка
- `packages/server/tests/actor-pipeline.test.js` (7 кейсов): held/stowed оружие, Spell DC для `spellcastingEntry`, отсутствие AC-бонуса у stowed-брони, правило рюкзака, добавление фич/мастерств класса, повышение уровня без дублей, сохранение `actor.items` сервером.
- `npm run test --workspace=@pf2e/client` — 6/6 (чистые модификаторы, миграция score, мастерство, кулак/спасброски, worn-броня, идемпотентность).
- `npm run test --workspace=@pf2e/server` — 36/36 (5 action + 2 users + 5 chat + 2 directories + 5 persistence + 5 scenes + 5 actors + 7 actor-pipeline).
- `npm run test:core` — 558/558.
- `npm run build --workspace=@pf2e/client` — успешно (785 modules, `dist` собран). Для CJS-ядра из workspace в `vite.config.js` добавлены `optimizeDeps.include` и `build.commonjsOptions.include`.

## Step 4.8.2 — Точный UI/UX листа: Attribute Builder, КБ, HP, ресайз и тайные броски

### Окно листа, вкладки и ресайз
- `packages/client/src/ui/windows/CharacterSheet.jsx`: лист получил собственный драггер размера в правом нижнем углу (`pf2e-sheet__resizer`, pointer capture, `nwse-resize`). `sheetSize` хранит ширину/высоту, при первом ресайзе окно фиксируется по `left/top`, чтобы не «прыгать» из центрированного положения. Минимум 520×420, максимум ограничен viewport.
- `ResizeObserver` на самом окне листа переключает класс `pf2e-sheet--compact` при ширине < 960 px. В компактном режиме подписи вкладок и заголовок «Лист персонажа» скрываются, остаются только иконки; сама навигация не переносится и не скрывается (`overflow-x: auto`), поэтому все вкладки остаются доступными. Backdrop остаётся прозрачным (`background: transparent`), фон игры не затемняется.
- Вкладки «Родословная» / «Наследие» переименованы: `ancestry` → «Родословная», `heritage` → «Наследие».

### Attribute Builder (`AttributeBuilderModal`)
- Новый `packages/client/src/ui/windows/character/AttributeBuilderModal.jsx`: сетка «источник × шесть характеристик» повторяет Foundry Attribute Builder.
  * Родословная: фиксированные повышения/недостатки из `system.boosts` / `system.flaws`, плюс свободные повышения из документа.
  * Предыстория: два повышения из `background.system.boosts` (ограниченные слоты соблюдаются).
  * Класс: выбор ключевого атрибута из `class.system.keyAbility.value`.
  * Уровни 1, 5, 10, 15, 20: по четыре свободных повышения; строки выше текущего уровня заблокированы. В пределах одного ряда повышение нельзя дублировать.
  * Создание персонажа ограничено модификатором +4 (score 18); недостатки применяются после повышений, уровни 5+ добавляются сверх этого предела.
  * Чекбокс «Ручной ввод» отключает сетку и показывает числовые поля итоговых модификаторов; состояние сетки и `manual` сохраняются в `actor.system.build`.
- Математика вынесена в чистые функции `character-data.js`: `readAbilitySource`, `normalizeAbilityBuild`, `sanitizeAbilityBuild`, `abilityBuildBreakdown`, `defaultAbilityBuild`. Для старых персонажей без `system.build` распределение восстанавливается эвристически из текущих модификаторов.
- Кнопка «✎ Редактировать» у блока «Модификаторы атрибутов» открывает builder; сохранение пишет `abilities` и `build` через общий `prepareActorSystem` → `room:update-actor`.

### Детализация КБ
- Клик по плашке КБ или кнопке «Мод.» открывает popover: `[База 10] + [Ловкость (с капом)] + [Обученность/Мастерство] + [Бонус брони]`, затем кастомные модификаторы и итог.
- В popover есть форма «Название / Значение / Тип (circumstance|status)». Модификаторы сохраняются в `system.attributes.ac.modifiers`; `armorClassBreakdown()` применяет каноническое PF2e-стэкинг: лучший бонус и худший штраф каждого типа, бонус и штраф одного типа учитываются раздельно. Модификаторы можно удалять.
- `system.derived.armorClass` теперь содержит `modifiers`, `circumstance`, `status`, `customBonus`, `rank`; те же данные использует popover.

### Авторасчёт HP
- `packages/core/src/actor/prepare-data.js`: `maxHpBreakdown()` и `sourceBaseHp()` считают `макс. HP = ancestryHP + (classHP + Con mod) × level`.
- Данные берутся из `system.details.ancestry/class` (компактный summary, сохраняемый при выборе ABC) либо из документов `type: "ancestry"` / `type: "class"` в `actor.items`.
- `prepareActorSystem()` автоматически обновляет `attributes.hp.max` и пишет разбор в `system.derived.hp` (`ancestryHp`, `classHp`, `conMod`, `level`, `max`). Если выбрана только одна часть ABC, ручной максимум не перезаписывается.

### Наследия и универсальные наследия
- `CompendiumSelectModal` принимает `filters` и прокидывает их в `GET /api/compendiums/:category`.
- `build-compendiums.js` добавляет в индекс наследий `ancestry`, `ancestryName`, `versatile`; существующий `heritages.index.json` дополнен этими полями (334 записи, 17 универсальных).
- `CatalogService.filterIndex()` поддерживает `ancestry`, `includeVersatile` и `versatile`; сервер парсит соответствующие query-параметры. Список наследий показывает строго наследия выбранной родословной + универсальные (Nephilim, Dhampir, Aiuvarin и т. д.). Без выбранной родословной показываются только универсальные.

### Восприятие, чувства и инициатива
- Под Восприятием добавлена кнопка «перечёркнутый глаз»: бросок `/r 1d20+mod` уходит в чат с `visibility: "blind"` (результат видит только GM). `sendChat` расширен третьим параметром visibility.
- Под Восприятием выводятся плашки особых чувств из родословной (`system.details.ancestry.vision`) и наследия (`system.details.heritage.senses`): «СУМЕРЕЧНОЕ ЗРЕНИЕ», «ТЕМНОЕ ЗРЕНИЕ», «УЛУЧШЕННОЕ ТЁМНОЕ ЗРЕНИЕ».
- Рядом с селектом инициативы добавлена кнопка d20 для мгновенного броска инициативы в чат.

### Проверка
- `npm run test --workspace=@pf2e/client` — 10/10 (добавлены кейсы builder: cap +4, фиксированные повышения/недостатки, умолчательное восстановление сетки, ограниченные слоты предыстории).
- `npm run test --workspace=@pf2e/server` — 40/40 (добавлены HP-формула, HP из `actor.items`, стэкинг кастомных КБ-модификаторов, фильтрация наследий с universal).
- `npm run test:core` — 558/558.
- `npm run build --workspace=@pf2e/client` — успешно (786 modules).
- Ручные проверки, которые нужно выполнить после `npm run dev:client`: ресайз за правый нижний угол, сжатие вкладок до иконок, авторасчёт HP после выбора родословной и класса, builder с чекбоксом ручного ввода, popover КБ с добавлением circumstance/status, тайный бросок Восприятия, плашки чувств, кнопка инициативы и универсальные наследия в списке.

## Step 4.8.3 — Drag-and-Drop предметов, Инвентарь, генерация Strikes, модалки IWR/Языков

### Модель данных: `actor.items` — источник истины
- Физические документы (`weapon`, `armor`, `shield`, `equipment`, `consumable`, `ammo`, `backpack`, `kit`, `treasure`, `misc`) теперь живут в `actor.items`, как в Foundry. `system.inventory.items` остаётся производным снимком для обратной совместимости и старых акторов.
- `packages/core/src/actor/prepare-data.js`:
  * `normalizePhysicalItem()` читает Foundry-форму: `system.equipped.carryType`, `system.equipped.handsHeld`, `system.usage.value`, `system.bulk.value` (`0.1` → Light), `system.damage` (`dice`/`die`/`damageType`), `system.runes`, `system.bonus`, `system.bonusDamage`, `system.range`, `system.traits.value`.
  * `physicalActorItems()` / `mergePhysicalActorItems()` отделяют физические документы от feat/action/spellcastingEntry/ancestry/class/spell.
  * `createActorItemFromDocument()` превращает полный компендиум-документ в компактный actor-item (system сохраняется, `description`/`publication` обрезаются, чтобы не превысить серверный лимит 256 KB).
  * `prepareActorData()` мигрирует старые `system.inventory.items` в `actor.items` без дублирования по `id`.

### Drag-and-Drop
- `packages/client/src/ui/windows/CharacterSheet.jsx`: `onDrop` теперь принимает и ABC-категории (прежнее поведение), и физические предметы. Для payload `{ type: "compendium-item", category, entry }` выполняется `GET /api/compendiums/:category/:id`, предмет создаётся через `createActorItemFromDocument()` с уникальным id и статусом `stowed`, добавляется в `actor.items` и сохраняется общим `commitActorState()` → `room:update-actor`.
- Дубликаты одного и того же компендиум-предмета получают суффиксы `-2`, `-3`, …; повторный дроп не перезаписывает существующий экземпляр.

### Инвентарь и Bulk
- `packages/client/src/ui/windows/character/CharacterTabs.jsx`: `InventoryTab` больше не читает `system.inventory.items`, а работает с prop `items` (`actor.items`) и `onItemsChange`. Предметы сгруппированы по `ITEM_GROUPS`: Оружие, Броня (включая щиты), Снаряжение (equipment/backpack/kit/treasure), Расходники (consumable/ammo).
- Для каждого предмета: иконка, уровень, масса, количество, тип урона (для оружия), черты; селектор `held | worn | stowed`; для `held` — селектор «1 рука / 2 руки» (`handsHeld`). Кнопки инвеституры, редактирования и удаления пишут полный массив `actor.items`.
- `character-data.js` добавляет `ITEM_GROUPS`, `itemGroupId()`, `itemCanHoldHands()`, реэкспорт `normalizePhysicalItem`, `createActorItemFromDocument`, `parseBulkValue`, `applyStrikingRune`.
- Bulk (`totalBulk`): Light = 0.1 Bulk (10 Light = 1 Bulk); `quantity` умножается; первые 2 Bulk `stowed` вычитаются из суммы (правило рюкзака). `encumbranceState()` возвращает `{ bulk, limit: 5 + Str, max: 10 + Str, state, label }`. Полоса и дробь `bulk / limit (макс. max)` вынесены вниз инвентаря; `system.derived.inventory` содержит те же значения для других панелей.

### Генерация Strikes и кнопки бросков
- `prepareStrikes()` строит Strike для каждого `type: "weapon"` со статусом `carried === "held"`:
  * атака = модификатор Str (Dex для Finesse, ranged или явного `system.attribute`) + proficiency (`level + rank*2`) + item bonus (`max(system.bonus.value, potency)`);
  * урон = базовый кубик + striking-руна (`1d8` → `2d8` для striking, больше для greater/major) + Str (ближний бой, thrown), половина Str (propulsive) или 0 (обычный ranged), плюс `system.bonusDamage`;
  * MAP: `-5/-10`, для agile `-4/-8`; поля `attackMap`, `attackMap2`, `map`, `map2`, `attackAbility`, `handsHeld`.
- Вкладка «Бой»: у каждого Strike четыре кнопки — «Атака», MAP-1, MAP-2, «Урон». Click-to-roll отправляет `/r 1d20+8 Название — атака` или `/r 1d8+4 Название — урон` через `networkClient.sendChatMessage`; сгенерированные из оружия Strikes нельзя редактировать вручную (они пересчитываются), ручные атаки остаются редактируемыми.

### Модалки IWR и Языков
- IWR: `IwrEditorModal` использует списки из `src/scripts/config/iwr.ts` + материалы из `src/scripts/config/damage.ts` (`IMMUNITY_TYPES`, `WEAKNESS_TYPES`, `RESISTANCE_TYPES`). Для иммунитетов значение скрыто, для слабостей/сопротивлений вводится число, плюс `exceptions` и `doubleVs`. Сохранение — в `system.attributes.immunities|weaknesses|resistances`.
- Языки: `LanguagesEditorModal` переписан на чекбоксы по всем 119 языкам PF2e из `src/module/actor/creature/values.ts` (`LANGUAGES_BY_RARITY.pf2e`), с редкостью, поиском и счётчиком. Старые русские названия конвертируются в Foundry-слаги (`normalizeLanguageValue`), отображение — `languageLabel()`. Сохранение — в `system.details.languages.value` (слаги) + `details`.

### Тесты и проверка
- `packages/server/tests/actor-pipeline.test.js`: 16/16. Новые кейсы: кинжал из реального `equipment.json` (bulk `L`, finesse Dex, урон `1d4+4`, agile MAP), potency/striking/two-hand, 10 Light = 1 Bulk + рюкзак, пороги `5+Str`/`10+Str`, миграция `system.inventory.items` без дублей.
- `npm run test --workspace=@pf2e/client` — 10/10; `npm run test --workspace=@pf2e/server` — 45/45 (5 action + 2 users + 5 chat + 2 directories + 5 persistence + 5 scenes + 5 actors + 16 actor-pipeline); `npm run test:core` — 558/558; `npm run build --workspace=@pf2e/client` — успешно (786 modules).
- Ручные проверки после `npm run dev:client`: перетащить Dagger из вкладки «Оружие» на лист → предмет появляется в «Инвентаре»; переключить его на «В руках» → во вкладке «Бой» появляется Strike `+5 / 1d4+4`; кнопки атаки и урона отправляют `/r` в чат; в модалке языков видны все 119 языков с чекбоксами; в IWR-модалке выбирается тип из эталонного списка. Проверено в браузере на живом актёре.
- Если Vite-сервер был запущен до этого шага, перезапустите его с `npm run dev --workspace=@pf2e/client -- --force`: pre-bundle `@pf2e/core` кэшируется, и без re-optimization новый экспорт `isPhysicalItemType` не появится в браузере.

## Step 4.8.4 — Навыки, Спасброски, Черты и Заклинания (Click-to-Roll)

### Feature Readiness
- goal: навыки/спасброски считаются и кидаются из листа; черты и заклинания из компендиума попадают в правильные контейнеры; ACP применяется к Str/Dex-навыкам.
- pf2e_remaster_rule: `Statistic = attribute modifier + proficiency(level + rank*2) + item bonus + armor check penalty`; ACP берётся из `wornArmor.system.checkPenalty` и применяется как `untyped`-штраф (`src/module/actor/character/document.ts#prepareSkills`). Strength requirement брони сравнивается с `abilities.str.mod` (Foundry хранит требование в модификаторной форме, например `+4`, а не score 18).
- behavior_and_boundaries: реализованы 16 стандартных навыков, 3 спасброска, ACP для Acrobatics/Athletics/Stealth/Thievery с предикатами `strength-requirement-met` / `flexible` / `noisy`; черты группируются по `system.category`; заклинания привязываются к `system.location.value`; ручные (legacy) заклинания остаются во вкладке отдельным блоком.
- data_contracts: `actor.system.skills[slug] = { rank, itemBonus, mod, armorPenalty, ability }`; `system.derived.armorCheckPenalty = { value, armorId, armorName, requirement, strengthMod, strengthMet, flexible, noisy, applies }`; `system.derived.spellsByEntry[entryId]`, `system.derived.spellcasting[].spells`; `actor.items` типов `feat`/`spell`; WS `room:update-actor`.
- acceptance_tests: Untrained→Trained Athletics 4→7; ACP −2 к Athletics/Stealth/Thievery при Str ниже требования; noisy-броня сохраняет ACP на Stealth при выполненном требовании; spell с `location.value="sc-arcane"` попадает в `derived.spellsByEntry` и получает DC 21; feats раскладываются по ancestry/class/general/skill/bonus (+ legacy `classfeature`).
- delegated_assumptions: item bonus навыка хранится в `system.skills[slug].itemBonus` (в компендиуме нет предметов с FlatModifier-правилами для навыков); спасброски не получают ACP по правилам PF2e.
- confidence: 97%.

### Математика навыков и ACP (`packages/core/src/actor/prepare-data.js`)
- `skillModifier(system, key, ability)` = `abilityMod + proficiencyBonus(level, rank) + itemBonus + armorCheckPenaltyForSkill()`. Item bonus читается из `system.skills[slug].itemBonus` (алиас `bonus`) и не стекается с другими item-бонусами.
- `normalizeCharacterSystem()` сохраняет `itemBonus` у навыка; `prepareActorSystem()` записывает в каждый навык `ability`, `itemBonus`, `armorPenalty` и итоговый `mod`, поэтому лист больше не считает навыки вручную.
- `wornArmorItem()` / `armorCheckPenaltyState()` / `armorCheckPenaltyForSkill()` повторяют `CharacterPF2e#prepareSkills`:
  * ACP применяется только к навыкам с `str`/`dex` и только для надетой (`carried: "worn"`) брони с `checkPenalty < 0`;
  * при невыполненном Strength-требовании штраф получают все Str/Dex-навыки (Athletics, Acrobatics, Stealth, Thievery);
  * при выполненном требовании Athletics/Acrobatics игнорируют ACP, Thievery тоже, а Stealth сохраняет штраф только для брони с трейтом `noisy`;
  * `flexible` и `noisy` читаются из `system.traits.value` через `normalizePhysicalItem()`; `strength: null` означает отсутствие требования, а legacy-значение вида `16` автоматически переводится в модификатор `+3`.
- `prepareActorSystem()` добавляет `system.derived.armorCheckPenalty` со всеми слагаемыми для тултипов и отладки.

### Черты (`FeatsTab`)
- `prepareFeatSections(actor.items, system.feats)` группирует `type: "feat"` по `system.category`: `ancestry`/`ancestryfeature` → «Родословная», `heritage` → «Наследие», `class`/`classfeature` → «Класс», `skill`, `general`, `bonus`; неизвестная категория уходит в «Бонусные». `actor.items` — источник истины, `system.feats` сохраняется как legacy-fallback без дублей по `id`.
- `createActorFeatFromDocument()` строит actor-item, сохраняет `system.category`, уровень, traits, description (обрезка 6000 символов) и, при дропе на слот, `system.location = slotId`.
- `FeatsTab` принимает `items`, `onCommitActor`, `onCompendiumDrop`, `onRoll`. Дроп на секцию добавляет черту по её категории; дроп на пустой слот (`featSlots[]`) привязывает `featId` к слоту через `system.location`. Иконка/кнопка 💬 отправляет карточку (название, уровень, черты, очищенное от HTML описание) в чат.

### Книга заклинаний (`SpellsTab`)
- `createActorSpellFromDocument()` создаёт `actor.items` тип `spell` с `system.location.value = entryId` и `system.level.value = rank` (0 = cantrips). `prepareActorItems()` разворачивает `entryId`, `rank`, `spellAttack`, `spellDC` из родительского `spellcastingEntry`.
- `system.derived.spellcasting[].spells` и `system.derived.spellsByEntry[entryId]` содержат сгруппированные заклинания; ранг 0 отображается как «Чары», далее 1–10-й круг.
- `SpellsTab` показывает под каждым набором его заклинания по рангам. Целевой набор выделяется рамкой (клик по заголовку карточки); дроп на карточку набора или на вкладку привязывает заклинание к нему. Клик по иконке/названию отправляет карточку заклинания (название, круг, действия, DC, модификатор атаки, описание), кнопка d20 кидает `/r 1d20+attack` в чат.

### Click-to-Roll и тайные броски
- `CharacterTabs.jsx`: `BlindRollButton` (перечёркнутый глаз) добавлен рядом с каждым навыком, спасброском и восприятием; бросок уходит через `onRoll(..., false, "blind")`, сервер маскирует результат для всех, кроме GM и автора.
- Спасброски в левой панели вкладки «Основа» (`CharacterSheet.jsx`) получили такую же кнопку тайного броска; обычные броски остались `/r 1d20±mod Название`.
- Смена ранга U/T/E/M/L сохраняет `system.skills[slug].rank` и проходит общий `prepareActorSystem()` → `room:update-actor`; модификатор сразу пересчитывается, ACP-бейдж показывает штраф брони.

### Тесты и проверка
- `packages/server/tests/actor-pipeline.test.js`: 20/20. Новые кейсы: пересчёт навыка Untrained→Trained и item bonus; ACP на Athletics/Stealth/Thievery при Str ниже требования, снятие штрафа при выполнении требования, сохранение Stealth-штрафа для `noisy`, снятие при `stowed`; привязка spell к `spellcastingEntry` по id и `derived.spellsByEntry`; группировка feats по категориям и drop на слот.
- `npm run test --workspace=@pf2e/client` — 10/10; `npm run test --workspace=@pf2e/server` — 49/49 (5 action + 2 users + 5 chat + 2 directories + 5 persistence + 5 scenes + 5 actors + 20 actor-pipeline); `npm run test:core` — 558/558; `npm run build --workspace=@pf2e/client` — успешно (786 modules).
- Ручная проверка в браузере (выполнена на живом листе `actor-a1`): переключение Athletics U→T даёт `+3 → +6`, возврат в U — снова `+3`; клик d20 отправляет `1D20+3 Атлетика` в чат, «глаз» — `Скрытность (тайно)` с маркером blind; надетый Chain Mail (`Strength +3`, `checkPenalty -2`, `noisy`) при Str +3 оставляет Athletics/Thievery без штрафа, но даёт Stealth `ACP -2` (`+3 → +1`), после снятия брони штраф исчезает; перетаскивание `Toughness` из компендиума кладёт его в секцию «Общие» (`system.category = "general"`), удаление убирает и item, и слот; перетаскивание `Fireball` на набор `spellcastingEntry-mw9u3sg4-pwie` сохраняет `system.location.value` этого набора и показывает заклинание под 3-м кругом с DC 13; клик по карточке выводит описание, DC и модификатор атаки в чат. Консоль браузера без ошибок; тестовые броски/предметы после проверки удалены.

## Step 4.8.5 — Связка токенов с актёрами и полоски ХП

### Feature Readiness
- goal: перетаскивание карточки актёра из директории на холст создаёт токен в активной сцене; токен хранит `actorId`, рисует полоску ХП и обновляет её без перезагрузки, когда ХП меняются в листе персонажа.
- pf2e_remaster_rule: полоса показывает `current / max` из `actor.system.derived.hp` (подготовленное значение) с fallback на `actor.system.attributes.hp`; цвет заливки — зелёный > 50%, жёлтый 26–50%, красный ≤ 25%; координата дропа — клетка сетки (`Math.floor(world / cellSize)`), соответствующий 5-футовый квадрат.
- behavior_and_boundaries: реализованы drag-and-drop актёра, серверное хранение токена в `scenes[id].tokens`, отрисовка токена и HP-бара, live-обновление по `room:update-actor` / `room:directories-update`, выделение/перетаскивание/удаление токена как обычного объекта сцены. Не реализованы портретные текстуры, многоразмерные токены, автопривязка combatant↔token по клику и туман войны.
- data_contracts: `scenes[sceneId].tokens[] = { id: "token-N", actorId, sceneId, name, img, gridX, gridY }`; WS `room:create-token` `{ actorId, sceneId, x, y }`; broadcast `room:scene-canvas-update` (`reason: "token-created"`, `sourceMemberId: null`, `token`) + `room:token-created`; focused `room:update-actor` `{ actorId, actor }`; `combatant.actorId` в `serializeState()`/`snapshot()`; `system.derived.hp = { ...breakdown, value, temp, max }`.
- acceptance_tests: `tokens.test.js` 7/7 — создание токена с `actorId`, snap координат, ошибки неизвестного актёра/сцены, persistence + продолжение `token-N`, broadcast `room:update-actor`, `actorId` у combatant, WebSocket `room:create-token`.
- delegated_assumptions: токен — одиночная клетка; сервер доверяет клиентскому snap и дополнительно клампит координаты в `0..1000`; актёрский токен удаляется через сохранение массива сцены, а не через `room:remove-combatant`.
- confidence: 97%.

### Сервер (`packages/server/src/room/encounter-session.js`, `src/index.js`)
- `EncounterSession.createToken(data, sourceMemberId)` валидирует `actorId` и `sceneId`, кладёт токен в `scenes[sceneId].tokens` (или `baseSceneCanvas.tokens` при `sceneId: null`), сохраняет `session.json` и рассылает `room:scene-canvas-update` с `reason: "token-created"`.
- Добавлен счётчик `_sceneTokenSequence` и восстановление из `sequences.sceneToken` / id `token-N`, поэтому после рестарта новые токены не конфликтуют.
- `room:create-token` в `index.js` принимает `{ actorId, sceneId, x, y }`, вызывает сессию и отправляет автору `room:token-created`.
- `updateActor()` дополнительно эмитит `room:update-actor` с полным актёром; это presentation-событие, в combat log не пишется.
- `_applyCombatantPresentation()` сохраняет `spec.actorId` на combatant; `serializeState()` и `snapshot()` отдают `actorId` для матчинга токена и трекера.

### Клиентский слой токенов (`packages/client/src/canvas/token-layer.js`, `main.js`, `interaction.js`)
- `TokenLayer` теперь хранит два вида сущностей в одном `tokens` Map: combatant-токены и actor-токены сцены. Общие операции (hit-test, marquee, selection, drag, `serializeScene`) работают для обоих.
- `_paintActorToken()` рисует круг с инициалами, активное кольцо хода (`ACTIVE_RING`) при совпадении `combatant.actorId` с `activeCombatantId`, и HP-бар под токеном (`PIXI.Graphics`: рамка, тёмный фон, зелёная/жёлтая/красная заливка по проценту).
- `setActors()` пересобирает кэш `actorId → actor`; `upsertActor()` точечно обновляет один лист; `setCombatState()` сохраняет `combatState` и перекрашивает активное кольцо/defeated. `sync()` трогает только combatant-токены, `syncActorTokens()` — только actor-токены.
- `main.js` разделяет `scenes[id].tokens` на actor-токены и legacy-позиции combatant'ов, подписан на `room:directories-update`, `room:update-actor`, `room:state-update`, `joined`/`session:snapshot`; слой обновляется в реальном времени.
- `DirectoryPanel.jsx`: карточки актёров получили `draggable` и payload `{ type: "pf2e-actor-token", actorId, name, img }`. Холст (`main.js`) принимает drop, переводит экран в мир через `viewport.toWorld()`, привязывает к сетке и отправляет `room:create-token`.
- `interaction.js`: `Delete` удаляет actor-токен через сохранение сцены, а combatant-токен — через `room:remove-combatant`; `Viewport.toWorld()` добавлен как алиас `screenToWorld()`.
- `packages/core/src/actor/prepare-data.js`: `system.derived.hp` теперь содержит `value`, `temp` и `max`; при неполной ancestry/class-формуле максимум берётся из `system.attributes.hp.max`.

## Step 4.9 — Нижний хотбар макросов

### Feature Readiness
- goal: нижняя панель из 10 квадратных слотов (1–0), персональная для каждого игрока; перетаскивание атаки/заклинания/навыка из листа сохраняет макрос и по клику или горячей клавише отправляет тот же бросок в чат.
- pf2e_remaster_rule: макрос не пересчитывает правила на клиенте — он сохраняет готовый текст броска (`/r 1d20±mod …`) и `visibility`, поэтому результат совпадает с кликом внутри листа; `blind` сохраняется для тайных проверок; клавиши 1–9/0 не перехватываются в `input/textarea/select/contentEditable`.
- behavior_and_boundaries: реализованы слоты, `localStorage`-профиль `pf2e.hotbar.v1:<memberId>`, drop макроса, клик, горячие клавиши, ПКМ-очистка, подсветка слота активного актёра из `combatState`. Не реализованы drag-перестановка между слотами, папки макросов и выполнение через Action Intent Pipeline.
- data_contracts: `hotbar: { [slot]: { type, actorId, actionId, name, icon, text, plain, visibility } }`; drag payload `{ type: "pf2e-hotbar-macro", macro }`; отправка через `networkClient.sendChatMessage({ text, visibility })`.
- acceptance_tests: `packages/client/tests/hotbar.test.js` 8/8 — раскладка 1–0, ключ на игрока, нормализация макроса, точное повторение маршрута `/r` vs `Использует:`, фильтрация drag payload, игнорирование модификаторов/полей ввода, поднятие UI над листом при drag.
- delegated_assumptions: макрос хранит текст, а не live-ссылку на Strike, поэтому после удаления оружия старый макрос продолжает отправлять прежнюю формулу; это ожидаемо для «закреплённого» макроса.
- confidence: 98%.

### Реализация (`packages/client/src/ui/Hotbar.jsx`, `hotbar-macros.js`, `drag-payloads.js`)
- `Hotbar` — flex-ряд из 10 слотов внизу по центру; показывает номер слота, иконку (или глиф типа), название и жёлтую точку, если `macro.actorId` совпадает с актёром активного combatant'а из `combatState`.
- `localStorage`-ключ включает `myUserId` (fallback — роль), поэтому у GM и каждого игрока свой хотбар; запись обновляется только при drop/очистке.
- `hotbar-macros.js`: `createMacro/normalizeMacro`, `buildMacroChatMessage` (повторяет `CharacterSheet.sendChat`), `executeMacro` (`networkClient.sendChatMessage`), `slotFromKeyboardEvent`, `isTypingTarget`.
- Drag из листа не блокируется порталом листа: `setMacroDragData()` добавляет `body.pf2e-macro-dragging`, CSS поднимает `#ui-root` над листом (z-index 3100) на время drag; в `Hotbar` дополнительно есть window-фолбэк по координатам слота, если drop всё же адресован листу.
- `drag-payloads.js`: единый контракт `application/json` для `pf2e-actor-token`, `pf2e-hotbar-macro` и `compendium-item`.
- `CharacterTabs.jsx`: draggable-кнопки атак/урона (Combat), карточек и d20-атак заклинаний (Spells), навыков/знаний/восприятия/спасбросков и тайных бросков (Skills), а также кнопка действия (Actions). Payload содержит `actorId`, `actionId`, имя, иконку и готовый текст.
- `App.jsx` монтирует `<Hotbar />`; CSS-секция `Step 4.9` задаёт квадратные слоты, адаптивные размеры и состояния drop/active-turn.

### Тесты и проверка
- `packages/server/tests/tokens.test.js`: 7/7. Серверный набор: 56/56 (5 action + 2 users + 5 chat + 2 directories + 5 persistence + 5 scenes + 5 actors + 20 actor-pipeline + 7 tokens).
- Клиент: 18/18 (10 character-data + 8 hotbar), `npm run test:core` — 558/558, `npm run build --workspace=@pf2e/client` — успешно (789 modules).
- Ручной сценарий: актёр из директории → drop на холст → `room:create-token` → токен с HP-баром; изменение `attributes.hp.value` в листе → `room:update-actor` → бар сразу уменьшается; кнопка атаки из вкладки «Бой» → drop в слот 1 → клавиша `1` → `/r 1d20…` в чате; ПКМ по слоту очищает его, F5 сохраняет раскладку.
- Проверка dev-стека: `npm run dev:client` (Vite 5173) + `npm run start:server` (3000) — клиент поднимается без ошибок импорта; серверные и клиентские сюиты зелёные.

## Step 5.1 — Движок коллизий и ограничение движения токенов стенами

### Feature Readiness
- goal: перетаскивание токена по холсту проверяется физикой стен; если отрезок «стартовая клетка → целевая клетка» пересекает блокирующую стену, токен возвращается на исходную клетку, появляется Toast «Движение заблокировано препятствием», а сохранение сцены/координат не отправляется.
- pf2e_remaster_rule: пересечение двух отрезков через векторное произведение (`t = (q × s) / (r × s)`, `u = (q × r) / (r × s)`); деление выполняется только после проверки `r × s ≠ 0`. Стены `normal`/`terrain`/`invisible` блокируют движение; `ethereal` пропускает; `door`/`secret` пропускают только при `open === true` (или совместимом `isOpen === true`) и не заперты (`locked !== true`).
- behavior_and_boundaries: реализованы чистая математика отрезков, `WallLayer.checkCollision(origin, destination, type = "movement")`, блокировка drag-and-drop токена, snap-back и Toast. Не реализованы pathfinding/обход стен, проверка коллизий для программных перемещений (серверный `Stride`, `applyScenePositions`), физика размеров токена больше одной клетки и line-of-sight/shadow-casting (следующие шаги Фазы 5).
- data_contracts: `segmentsIntersect(p1,p2,p3,p4) -> {x,y}|null`; `WallLayer.checkCollision -> { point, wall, wallId, type, distance } | null`; `TokenLayer.dragOrigin = { x, y, gridX, gridY }`; DOM-события `pf2e:toast` (`{ message, kind, duration }`) и существующее `pf2e:scene-canvas-changed` только при разрешённом drop.
- acceptance_tests: `packages/client/tests/math.test.js` — диагонали, вертикаль/горизонталь, параллельные, коллинеарные overlap/disjoint, касание концами, пересечение вне отрезков, вырожденная точка, некорректные точки. `packages/client/tests/wall-collision.test.js` — normal/invisible/terrain блокируют, ethereal пропускает, открытая дверь/секрет пропускают, закрытая и запертая блокируют, `isOpen`, выбор ближайшей стены, промах, нулевое перемещение, невалидные концы.
- delegated_assumptions: токен считается одной клеткой, а маршрут — прямой линией между центрами клеток; диагональный обход угла стены не выполняется (линия проверяется геометрически). Стены, начинающиеся ровно в центре стартовой клетки, считаются препятствием.
- confidence: 98%.

### Реализация
- `packages/client/src/canvas/math.js` (новый): `segmentsIntersect(p1, p2, p3, p4)` на определителях/векторном произведении, `EPSILON` для параллельности и коллинеарности, обработка вырожденных точек и коллинеарных наложений. `distanceSquared(a, b)` — вспомогательная метрика без `sqrt`.
- `packages/client/src/canvas/wall-layer.js`: экспортирован `wallBlocksCollision(wall, type)`; метод `checkCollision(origin, destination, type = "movement")` строит отрезок между центрами клеток, перебирает `this.walls`, фильтрует по типу и возвращает ближайшее столкновение (`point`, `wall`, `wallId`, `type`, `distance`). Для `movement` игнорируются `ethereal` и открытые незапертые `door`/`secret`; `normal`, `terrain`, `invisible` и закрытые/запертые двери блокируют.
- `packages/client/src/canvas/token-layer.js`: `beginDrag()` запоминает `dragOrigin`; добавлены `dragStartCenter()`, `dragTargetCenter(worldPoint)` (центр целевой клетки) и `cancelDrag()` — возврат `x/y`, `gridX/gridY`, перерисовка без мутации `sceneToken`/`combatantData`. `endDrag()` использует общий `_dropCell()`, сбрасывает `dragOrigin`.
- `packages/client/src/canvas/interaction.js`: `_checkTokenDragCollision(point)` вызывает `wallLayer.checkCollision(startCenter, targetCenter, "movement")` до `endDrag()`. При коллизии — `cancelDrag()` + `showToast("Движение заблокировано препятствием")`, `pf2e:scene-canvas-changed` не публикуется (значит, debounce-сохранение сцены и `room:update-actor` не уходят). `_cancelGesture()` теперь отменяет drag через `cancelDrag()`, а не фиксирует позицию.
- `packages/client/src/ui/toast.js` (новый): `showToast(message, { kind, duration })` публикует `pf2e:toast`, не импортируя React. `packages/client/src/ui/ToastHost.jsx` (новый) слушает событие, стек до 4 уведомлений, автоскрытие 3.2 с; подключён в `App.jsx`. Стили `.pf2e-toast-host` / `.pf2e-toast` добавлены в `styles.css` (над хотбаром, `pointer-events: none`).

### Тесты и проверка
- `npm run test --workspace=@pf2e/client` — 42/42 (10 character-data + 8 hotbar + 10 math + 14 wall-collision).
- `npm run build --workspace=@pf2e/client` — успешно (792 modules).
- Браузер (`npm run dev:client`, синтетические `PointerEvent` на канвасе): токен в коробке 1×1 из `normal`-стен не выходит наружу (`gridX/gridY` остаются `2,2`, Toast найден в accessibility-дереве, `pf2e:scene-canvas-changed` = 0); `invisible`-стена блокирует; `ethereal`-стена пропускает (`2,2 → 5,2`); закрытая `door` блокирует, после `open = true` — пропускает; разрешённый drop без стен двигает токен `2,2 → 5,2` и публикует ровно одно событие сохранения сцены. Console errors: 0.

## Step 5.2 — Raycasting-движок видимости, обрезка света стенами и скрытие невидимых токенов

### Feature Readiness
- goal: свет и зрение строятся реальными полигонами лучей, а не кругами. Свет обрезается стенами комнаты и вырезает дыры в слое затемнения; при выделении токена чужие токены вне его линии видимости исчезают, а GM с включённым `gm-vision` видит их полупрозрачными.
- pf2e_remaster_rule: видимость — это геометрия луча до первого непрозрачного препятствия. `invisible`-стены не участвуют в симуляции зрения/света; `ethereal`-стены блокируют зрение; `normal`, `terrain` и закрытые `door`/`secret` блокируют; открытая незапертая дверь (включая `isOpen`) пропускает. `terrain` — единственное исключение: луч проходит сквозь **одну** ландшафтную стену, а вторая стена (terrain или любая обычная) его останавливает. Свет использует тот же фильтр, что и зрение.
- behavior_and_boundaries: реализованы `computePolygon` (Raycasting по конечным точкам + ±ε лучи + равномерные лучи замыкания открытых дуг), `castVisibilityRay`, `wallBlocksSight`, `pointInPolygon`; свет рендерится полигонами bright/dim и через inverse mask (`setMask({ inverse: true })`) вырезает дыры в `darkness`; `VisionLayer` строит LOS выбранного токена, `TokenLayer.applyVisionState` скрывает/приглушает токены; GM-режим оставляет все токены видимыми (`alpha = 0.45` вне LOS). Не реализованы: туман войны с запоминанием исследованных зон (Шаг 5.3), darkvision/low-light и разные режимы зрения, автообновление света при движении серверных `Stride` без canvas-события, многоклеточные токены и звук/нюх.
- data_contracts: `computePolygon(origin, radius, walls, type = "vision", { arcSamples?, epsilon? }) -> Array<{x,y}>`; `castVisibilityRay(origin, angle, radius, blockers) -> {x,y}`; `wallBlocksSight(wall) -> boolean`; `pointInPolygon(point, polygon) -> boolean`; `LightLayer.polygonFor(origin, radius, arcSamples?)`, `LightLayer.setWallLayer(wallLayer)`, `darknessContainer` + `lightMaskGraphics` (inverse mask); `VisionLayer.refresh() -> polygon|null`, `setGmVision`, `setRadius`, `setEnabled`, `contains(point)`; `TokenLayer.applyVisionState({ origin, polygon, gmVision } | null)`, `TokenLayer.onSelectionChange(selectedId)`; поля токена `baseAlpha`, `visionAlpha`, `visionVisible`.
- acceptance_tests: `packages/client/tests/raycasting.test.js` — 20/20: фильтр `invisible`/`ethereal`/`normal`/`terrain`/`door`/`secret` (`open`, `isOpen`, `locked`); полный круг без стен; сортировка вершин по углу; радиус; невалидные origin/radius/стены; `invisible` не режет; `ethereal` режет; `normal` режет; закрытая дверь режет, открытая пропускает; одна `terrain` пропускает; две `terrain` останавливают на второй; `terrain` + `normal` — на normal; `terrain` + `invisible` — проходит; `castVisibilityRay` без препятствий возвращает конец радиуса; комната содержит только внутренность; точный луч попадает в угол стены; even-odd `pointInPolygon`.
- delegated_assumptions: полигон видимости считается по центрам токенов (не по их краям); радиус зрения по умолчанию 2000 px (~100 футов) и меняется через `VisionLayer.setRadius`; `terrain`-проход считается по каждому лучу отдельно, а не как «один раз на источник»; яркий/тусклый свет заливаются сплошными полупрозрачными цветами (радиальный градиент не обязателен по ТЗ).
- confidence: 98%.

### Реализация
- `packages/client/src/canvas/math.js`: добавлены `DEFAULT_ARC_SAMPLES = 180`, `DEFAULT_RAY_EPSILON = 1e-5`, `wallBlocksSight(wall)`, `castVisibilityRay(origin, angle, radius, blockers)` и `computePolygon(origin, radius, walls, type, options)`.
  * `computePolygon` собирает конечные точки всех блокирующих стен в радиусе, добавляет лучи под углом каждой точки и ±ε, затем равномерные лучи по кругу — это замыкает открытые дуги, когда единственная стена не образует комнату. Лучи сортируются по `atan2`, каждый разрешается через `segmentsIntersect`, результат сортируется по углу и возвращается как вершины для `PIXI.Graphics.poly`/`PIXI.Polygon`.
  * `castVisibilityRay` собирает все пересечения луча со стенами, сортирует по дистанции и применяет правило terrain: первая `terrain` пропускается, следующая стена (terrain/normal/ethereal/closed door) останавливает луч. Коллинеарные/вырожденные случаи обрабатывает существующий `segmentsIntersect`.
  * `pointInPolygon` реализует even-odd тест и используется для скрытия токенов.
- `packages/client/src/canvas/light-layer.js`: `LightLayer` принимает `wallLayer`/`walls` и метод `polygonFor()`; `renderAll()` рисует dim/bright полигоны (`Graphics.poly().fill().stroke()`) вместо `circle()`; `_renderDarknessMask()` запекает объединение всех световых полигонов в `lightMaskGraphics`; `darknessContainer.setMask({ mask, inverse: true })` оставляет чёрный оверлей везде, кроме освещённых областей. `_renderPreview()` тоже режется стенами. `setWallLayer()` перерисовывает свет при подключении слоя стен.
- `packages/client/src/canvas/vision-layer.js` (новый): `VisionLayer` хранит выбранный токен, радиус и `gmVision`, по `refresh()` вызывает `computePolygon(origin, radius, walls, "vision")` и передаёт результат в `TokenLayer.applyVisionState()`; `contains()` проверяет точку, `setShowOutline()` рисует отладочный контур (по умолчанию выключен). `visionOrigin` назван так специально: у Pixi `Container` уже есть свойство `origin` (ObservablePoint), и присваивание `this.origin = null` падало с `Cannot read properties of null (reading 'x')`.
- `packages/client/src/canvas/token-layer.js`: добавлены `visionState`, `onSelectionChange`, `applyVisionState()`, `_applyVisionToToken()`, `_applyTokenPresentation()`. Отрисовка токена теперь пишет `baseAlpha` (defeated) и комбинирует его с `visionAlpha`; `visionVisible = false` полностью исключает токен из рендера и hit-теста. `selectTokens()`, `deleteSelected()` и `clear()` уведомляют `VisionLayer` через `onSelectionChange`.
- `packages/client/src/canvas/interaction.js`: проброс `visionLayer`; событие тулбара `gm-vision` теперь включает/выключает GM-режим и в слое света, и в слое зрения.
- `packages/client/src/main.js`: создаёт `VisionLayer(app, viewport, grid, { tokenLayer, wallLayer })`, поднимает его над светом; `tokenLayer.onSelectionChange = () => visionLayer.refresh()`; на `pf2e:scene-canvas-changed` пересобирает свет и LOS; `applySceneCanvas()` и `syncTokens()` завершаются `visionLayer.refresh()`; слой доступен как `window.pf2e.visionLayer`.

### Тесты и проверка
- `npm run test --workspace=@pf2e/client` — 62/62 (10 character-data + 8 hotbar + 10 math + 14 wall-collision + 20 raycasting).
- `npm run build --workspace=@pf2e/client` — успешно (793 modules).
- Браузер (`npm run dev:client`, сцена собрана через `window.pf2e`, сервер отключён, чтобы снапшоты не перезаписывали тестовые данные):
  * комната 400×300…1200×900 и источник света `(800, 600)` с dim 40 футов (800 px): полигон света имеет границы `x = 400…1200`, `y = 300…900`, хотя радиус 800 px должен был выйти за стены; пиксель вне комнаты `(300, 600)` — `rgb(7, 8, 9)` (тьма), внутри комнаты — `rgb(78, 69, 51)`, в центре — яркий `rgb(255, 214, 121)`;
  * `invisible`-стена `x = 900` внутри комнаты свет не режет: точка `(950, 600)` остаётся освещённой;
  * две `terrain`-стены `x = 1500` и `x = 1700`, свет из `(1250, 600)`: луч под углом 0 упирается ровно в `(1700, 600)`; после перевода второй стены в `invisible` тот же луч доходит до радиуса `(2050, 600)`;
  * токены: `hero (8,6)`, `ally (7,5)` внутри комнаты, `enemy (13,6)` и `orc (16,6)` снаружи. Синтетический ЛКМ `PointerEvent` по `hero` в режиме `token → select` выбирает `hero` (204 вершины LOS), `enemy`/`orc` получают `visible = false`, `ally` остаётся видимым; при `gm-vision = true` `enemy`/`orc` видимы с `alpha = 0.45`; после выключения снова скрыты.
  * Console errors: 0.

## Step 5.3 — Туман войны с персистентной памятью (`PIXI.RenderTexture`)

### Feature Readiness
- goal: выбранный токен оставляет за собой «шлейф» открытой карты; неисследованные области полностью чёрные, ранее исследованные — полупрозрачная дымка, а вокруг текущего LOS абсолютно светло. Чужой токен в любом тумане вне текущего LOS скрыт; GM видит всех. История исследования переживает перезагрузку и сброс через HUD.
- pf2e_remaster_rule: видимость строится по тому же raycast-полигону, что и Шаг 5.2 (`computePolygon(origin, radius, walls, "vision")`). Для fog of war правило VTT: `current LOS = fully visible`, `seen before but not current = dim`, `never seen = black`; скрытие чужих токенов выполняется только по текущему LOS, накопленная история не даёт права видеть токен.
- behavior_and_boundaries: реализованы два затемняющих уровня, накопительная `RenderTexture`, маска истории + маска текущего LOS, скрытие/приглушение токенов, debounce-сохранение Base64, восстановление при загрузке сцены, `room:update-fog` / `room:reset-fog`, кнопка HUD. Не реализованы: индивидуальный fog на каждого игрока (история общая для комнаты), ownership-токены для автоматического выбора своего токена, зрение в темноте/darkvision/low-light, анимация растворения тумана.
- data_contracts: `scenes[sceneId].fogExploration: "data:image/png;base64,…" | null`; `baseSceneFogExploration` для `sceneId === null`; `snapshot().sceneFogExploration`; `room:scene-activated` дополнительно несёт `fogExploration`; WS входящие `room:update-fog` `{ sceneId, fogExploration }` и `room:reset-fog` `{ sceneId }`; WS исходящие `room:fog-update` `{ sessionId, sceneId, fogExploration, sourceMemberId }`, `room:fog-reset` `{ sessionId, sceneId, sourceMemberId }`. `TokenLayer.setFogEnabled(boolean)`, `TokenLayer.setGMViewer(boolean)`, `FogLayer.updateVision(polygon)`, `FogLayer.reset({ notify })`, `FogLayer.loadEncoded(dataUrl)`.
- acceptance_tests: `packages/server/tests/fog.test.js` 5/5 — запись в `scenes[id].fogExploration`, базовая сцена, валидация PNG/размера/неизвестной сцены, round-trip `session.json`, WebSocket broadcast update/reset. Браузерные сценарии ниже.
- delegated_assumptions: туман общий для комнаты (один Base64 на сцену), а не персональный; размер текстуры равен карте `24×16 × 100 px = 2400×1600`, за пределами карты всегда чёрно; сервер не декодирует PNG, только валидирует data-URL и ограничивает 8 МБ.
- confidence: 97%.

### Клиент (`packages/client/src/canvas/fog-layer.js`, `vision-layer.js`, `token-layer.js`, `main.js`, `interaction.js`)
- Новый `FogLayer` — ровно два визуальных уровня:
  * `Unexplored`: чёрный прямоугольник `alpha = 1.0` на весь мир; `setMask({ mask: historyMask, inverse: true })` прорезает дыры там, где токен когда-либо видел.
  * `Explored`: чёрный прямоугольник `alpha = 0.5`; inverse-маска — `Graphics` с текущим LOS-полигоном, поэтому вокруг выбранного токена абсолютно светло, а посещённые, но невидимые сейчас клетки остаются дымкой.
- `fogTexture` (`RenderTexture.create({ width: 2400, height: 1600 })`) — единственное накопительное хранилище. При каждом новом LOS-полигоне `VisionLayer.refresh()` вызывает `fogLayer.updateVision(polygon)`: полигон рисуется белым в `Graphics` и рендерится как `app.renderer.render({ container: revealBrush, target: fogTexture, clear: false })`. Полигоны **не** хранятся в массивах — только пиксели текстуры. Хэш вершин (`polygonSignature`) пропускает повторную заливку неизменившегося полигона.
- Отдельная `historyTexture` используется как маска. `fogTexture` нельзя одновременно рендерить и сэмплировать в inverse-маске: Pixi/WebGL молча теряет или очищает такую текстуру на следующем кадре. Поэтому `_syncHistoryTexture()` делает GPU-копию `fogTexture → historyTexture`, временно снимая маску (`unexplored.mask = null`) и возвращая её после копирования. После рендера в `RenderTexture` **не** вызывается `source.update()` — для render-target источника это может перезаписать содержимое пустым CPU-ресурсом (найдено и исправлено при браузерной проверке).
- `TokenLayer.applyVisionState()`:
  * выбранный токен виден всегда;
  * `fogEnabled = true` и игрок без LOS: чужие токены скрыты (`visible = false`);
  * игрок с активным LOS: виден только токен, чей центр внутри полигона; накопленный «исследованный» туман сам по себе видимость не даёт;
  * GM (`setGMViewer(true)` или `gm-vision`): видит все токены, вне LOS — `alpha = 0.45`.
- `main.js` создаёт `fogLayer`, ставит его выше токенов/света/vision (но ниже ruler), связывает `visionLayer.setFogLayer(fogLayer)`, вызывает `tokenLayer.setFogEnabled(true)` и `setGMViewer(role === "gm")`. При `applySceneState()` слой переключается на новую сцену и восстанавливает `fogExploration` один раз через `Assets.load` + `Sprite` → `fogTexture`; после отрисовки `Assets.unload(url)` освобождает Base64-текстуру из кэша, чтобы долгая сессия не накапливала все исторические PNG.
- `interaction.js`: пункт HUD `light → reset-fog` вызывает `fogLayer.reset({ notify: true })`, очищает локальную текстуру и шлёт `room:reset-fog`; `Toolbar.jsx` обновляет описание и статус («карта снова полностью чёрная»).

### Сервер и персистентность (`packages/server/src/room/encounter-session.js`, `src/index.js`, `network-client.js`)
- `EncounterSession.updateFog(sceneId, fogExploration, sourceMemberId)` сохраняет PNG на `scenes[id].fogExploration` (или `baseSceneFogExploration` для `sceneId: null`), ставит запись в очередь `_scheduleSave()` и рассылает `room:fog-update`. `resetFog()` обнуляет строку и рассылает `room:fog-reset`.
- `sanitizeFogExploration()` принимает только `data:image/png;base64,…`, ограничивает 8 МБ, `null` разрешён; `sanitizePersistedFog()` терпимо читает старые/повреждённые файлы. `getSceneFog()` отдаёт сохранённый PNG; `snapshot()` добавляет `sceneFogExploration`, `activateScene()` — `fogExploration`.
- Base64-строка не попадает в `getDirectories({ includeFog: false })`, поэтому `room:directories-update` и `session:snapshot().directories` остаются компактными; сохранение на диск по-прежнему использует полный `getDirectories()`. `saveToDisk()` пишет `baseSceneFogExploration`; `loadFromDisk()` восстанавливает его и сцены.
- `index.js` обрабатывает `room:update-fog` и `room:reset-fog`. Клиент (`network-client.js`) получил `updateFog`, `resetFog`, `onFogUpdate`, `onFogReset`; входящие чужие обновления заменяют локальную текстуру, свои (`sourceMemberId === network.playerId`) игнорируются. Debounce сохранения — 2 с после последнего изменения.

### Тесты и проверка
- `packages/server/tests/fog.test.js`: 5/5. Серверный набор: 61/61 (5 action + 2 users + 5 chat + 2 directories + 5 persistence + 5 scenes + 5 actors + 20 actor-pipeline + 7 tokens + 5 fog).
- `npm run test --workspace=@pf2e/client` — 62/62; `npm run test:core` — 558/558; `npm run build --workspace=@pf2e/client` — успешно (794 modules).
- Браузерный сценарий (Vite 5201 → сервер 3100, отдельный `session.json`):
  * сцена 24×16, герой `(5,5)`, враг `(10,10)`, горизонтальная стена `y = 700` с открытой дверью `x = 650…900`: из стартовой клетки враг видим через дверь; после перетаскивания героя в `(9,3)` линия зрения упирается в стену, и враг получает `visible = false`, оставаясь в уже исследованной области;
  * `fogTexture` после стартового LOS — 2 482 896 непрозрачных пикселей, после перемещения — 2 949 935 (≈76.8 % карты), т.е. текстура накапливает, а не заменяет историю;
  * debounce отправил `room:update-fog`: в `session.json` появился `baseSceneFogExploration` длиной 121 842 символа (пустая текстура того же размера даёт 106 346 — содержимое реальное); после F5 восстановлено ровно 2 949 935 пикселей;
  * HUD «Освещение → Сброс тумана войны» очистил локальную текстуру до 0 пикселей, сервер записал `baseSceneFogExploration = null`; повторный F5 оставил карту полностью чёрной;
  * GM-вкладка: оба токена `visible = true` без LOS, вне текущего LOS `alpha = 0.45`.
  * Console errors: 0.
- Диагностическое замечание: пустая RGBA-текстура 2400×1600 в этом окружении кодируется в PNG ~106 КБ, поэтому проверять сохранение нужно по длине/содержимому, а не по факту непустой строки.

## Step 5.4 — GM Vision (Foundry parity) и туман войны на каждого актёра

### Feature Readiness
- goal: мастер при входе на сцену сразу видит всю карту (сетку, фон, стены, двери, рисунки и все токены) без чёрного экрана. Выделение чужого/игрового токена включает эмуляцию его зрения: туман и тьма возвращаются, показывается LOS-полигон и исследованная этим актёром история, а чужие токены вне LOS скрываются. Клик по пустому месту снимает выделение и снова открывает карту.
- pf2e_remaster_rule: это UI-правило VTT (GM vision), а не механика PF2e Remastered; геометрия видимости остаётся прежней (`computePolygon(origin, radius, walls, "vision")` из Шага 5.2). Туман войны: `current LOS = fully visible`, `seen before = dim`, `never seen = black`.
- behavior_and_boundaries: реализованы автоматическое скрытие `FogLayer` и `LightLayer.darknessContainer` для GM без выделения; автоматическое включение тумана и тьмы при выборе токена; скрытие чужих токенов вне LOS в режиме эмуляции; персистентный туман `scenes[sceneId].fogExploration[actorId]` с переключением текстур при смене токена; сохранение тумана перед переключением актёра. Не реализованы: ownership-ограничения выбора токенов игроком, darkvision/low-light, автоматический выбор «своего» токена при входе.
- data_contracts: `scenes[sceneId].fogExploration: { [actorId]: "data:image/png;base64,…" } | "data:image/png;base64,…" | null`; резервный ключ `__scene__` хранит плоский fog старого формата; `baseSceneFogExploration` — тот же контракт для `sceneId === null`; WS входящий `room:update-fog` `{ sceneId, fogExploration, actorId }`; WS исходящий `room:fog-update` `{ sessionId, sceneId, actorId, fogExploration, sourceMemberId }`; `VisionLayer.setViewerRole(role)`, `FogLayer.setVisible(boolean)`, `FogLayer.setActiveActor(actorId)`, `FogLayer.loadSceneFog(collection)`, `FogLayer.applyRemoteFog(actorId, dataUrl)`, `TokenLayer.actorKeyForToken(id)`, `LightLayer.setRevealAll(boolean)`.
- acceptance_tests: `packages/server/tests/fog.test.js` 6/6 (добавлены per-actor запись/удаление ключа, round-trip map-формата и fallback `__scene__`); серверный набор 62/62; клиентский 62/62; `npm run build --workspace=@pf2e/client` успешно. Браузерные проверки ниже.
- delegated_assumptions: per-actor fog хранит полный Base64 каждого актёра на клиенте и сервере (карта памяти растёт с числом исследованных актёров); переключение текстур сериализовано и может занимать время кодирования PNG, но не теряет штрихи; legacy-текстура сцены остаётся общим fallback до первой записи конкретного актёра.
- confidence: 98%.

### Клиент (`packages/client/src/canvas/fog-layer.js`, `vision-layer.js`, `token-layer.js`, `light-layer.js`, `main.js`, `interaction.js`, `ui/Toolbar.jsx`)
- `VisionLayer` теперь знает `viewerRole` (`gm`/`player`) и `lightLayer`. В `refresh()`:
  * GM без выделения: `fogLayer.setVisible(false)` и `lightLayer.setRevealAll(true)` — туман и абсолютная тьма полностью скрыты;
  * GM с выделенным токеном: `fogLayer.setVisible(true)`, `setActiveActor(actorKey)`, `lightLayer.setRevealAll(false)`, строится LOS и штампуется туман выбранного актёра;
  * игрок всегда получает `fogLayer.setVisible(true)` и активную тьму.
- `FogLayer` получил карту `fogByActor`, `activeActorId` и `_targetActorId`. `setActiveActor()` сериализует переключение: сначала сохраняет «грязную» текстуру предыдущего актёра, затем загружает PNG нового. LOS-полигон, пришедший во время загрузки, паркуется в `_pendingVision` и применяется после смены текстуры. `loadSceneFog()` понимает и строку старого формата, и map; ключ `__scene__` становится общим fallback.
- `token-layer.js`: добавлен `actorKeyForToken(id)` (actorId → combatant.actorId → token id). В GM-режиме без LOS видны все токены без затемнения; при выбранном токене чужие токены вне его LOS скрываются, как у игрока. Явный переключатель `gm-vision` по-прежнему может раскрыть всех.
- `light-layer.js`: `setRevealAll(true)` жёстко выключает `darknessContainer.visible`, не меняя вычисленный alpha сцены.
- `main.js`: `VisionLayer` создаётся с `lightLayer` и `viewerRole: role`; `onFogChanged` передаёт `actorId` в `network.updateFog`; `applySceneState()` вызывает `fogLayer.loadSceneFog(fogExploration)`; `room:fog-update` применяется через `applyRemoteFog(actorId, …)`; `room:fog-reset` — через `clearSceneFog()`; после реконнекта роль берётся из `joined.member.role`.
- `network-client.js`: `updateFog(sceneId, fogExploration, actorId)` добавляет `actorId` в payload. `interaction.js`: после `reset-fog` вызывает `visionLayer.refresh()`, чтобы текущий LOS снова прорезал очищенный туман.

### Сервер (`packages/server/src/room/encounter-session.js`, `src/index.js`)
- `updateFog(sceneId, fogExploration, sourceMemberId, actorId)` пишет `scenes[id].fogExploration[actorId]`. Запись `null` удаляет только этот ключ. Без `actorId` сохраняется прежний плоский PNG (обратная совместимость).
- `getSceneFog(sceneId, actorId)` читает ключ актёра, затем fallback `__scene__`; `getSceneFogCollection(sceneId)` отдаёт строку или map для snapshot/activation. `resetFog()` очищает всю коллекцию сцены.
- `sanitizeFogCollection()` валидирует как старую строку, так и map; `sanitizePersistedFog()` терпимо читает оба формата из `session.json`. `index.js` пробрасывает `payload.actorId` в `updateFog`.

### Тесты и проверка
- `npm run test --workspace=@pf2e/server` — 62/62 (fog 6/6, включая per-actor map и fallback).
- `npm run test --workspace=@pf2e/client` — 62/62; `npm run build --workspace=@pf2e/client` — успешно (794 modules).
- Браузер (`npm run dev:client` → Vite 5176, `start:server` → 3000, роль `gm`, существующая сцена `scene-s2`):
  * GM без выделения: `fogLayer.visible = false`, `darknessContainer.visible = false`, `revealAll = true`, выбранный токен `null`, `lightLayer.darknessLevel = "dark"` не затемняет карту;
  * GM выбрал токен `token-1` (`actor-a1`): `fogLayer.visible = true`, активная текстура `actor-a1`, 180 вершин LOS, `darknessContainer.visible = true` при `dark`; второй токен вне LOS получил `visible = false`;
  * клик в пустоту (`clearSelection()`): `fogLayer.visible = false`, тьма снова скрыта, все токены `visible = true`, `alpha = 1`;
  * повторный выбор токена восстанавливает сохранённую текстуру `actor-a1` без потери исследования;
  * per-actor: после debounce в `fogByActor` появились ключи `actor-a1` и `actor-b`; возврат на `actor-a1` переключил активную текстуру обратно;
  * игрок (`role=player`): `fogLayer.visible = true` и `darknessContainer.visible = true` и без выделения, и после выбора токена;
  * console errors/warnings: 0.

## Step 5.5 — Character-sheet UX polish, actor context menu and rule fixes

### Feature Readiness
- goal: right-click actor cards opens a working context menu; the character sheet's left column fits without horizontal scrolling; AC and Max HP are read-only derived values; Temp HP is a small row below them; class/background automation only adds real class features and non-droppable skill training; the Actions tab is folded into Combat.
- pf2e_remaster_rule: class features are documents with `system.category === "classfeature"`; ordinary class feats (`system.category === "class"`) are player choices and must not be auto-granted. Backgrounds grant exactly two ability boosts. Fixed background/class skill training is a proficiency floor (trained or better). AC and maximum HP are derived statistics.
- behavior_and_boundaries: implemented actor context menu (ownership placeholder, export, import, copy, delete), read-only AC/Max HP, Temp HP row, class-feature-only automation, heritage picker strictness, `minRank` skill floors, Combat action list, toast for own chat messages. Ownership matrix, generic base-action library and full import merge/validation UI are explicitly deferred.
- data_contracts: `actor.system.skills.<key>.minRank` (0–4); `actor.system.details.class.trainedSkills`; `deleteDirectoryEntry(kind, entryId, memberId, role)`; WS `room:delete-entry` and `room:delete-actor` variants; `networkClient.deleteDirectoryEntry(kind, entryId)`; exported actor JSON is `{ system, items }`; `OwnershipModal`.
- acceptance_tests: server 65/65 (added class-feature filter, skill floor and delete tests), client 63/63 (added two-boost background test), core 558/558; production client build succeeds. Browser smoke: context menu lists all five items, ownership modal opens, copy creates "(Копия)", delete asks the exact confirmation and removes it, export downloads `<actor>.json`; sheet has no Actions tab, `pf2e-sidebar` has `scrollWidth === clientWidth`, AC/Max HP `readOnly`, Temp HP input under HP, Combat shows "Атаки → Действия и особенности → Оружие".
- delegated_assumptions: ownership matrix UI is an empty placeholder by request; base actions (Trip/Shove/...) are filtered out of the Combat action list until a later slice.
- confidence: 98%.

### Client (`packages/client/src/ui/...`)
- `sidebar/DirectoryPanel.jsx`: actor cards now handle `onContextMenu`; portal menu with "Настройка владения", "Экспорт данных", "Импорт данных", "Создать копию", "Удалить"; hidden file input reuses `updateActor`; copy preserves `actorType/level/img/folderId/system/items`; delete uses `window.confirm("Вы уверены, что хотите удалить?")`. `sidebar/OwnershipModal.jsx` is the placeholder dialog.
- `windows/CharacterSheet.jsx` / `styles.css`: left column capped by `minmax(0, 260px)` (224px compact) with `overflow-x: hidden`; header rows wrap; AC and Max HP are read-only values computed by preparation; Temp HP moved to the small `.pf2e-hp-temp` row below Current/Max; AC "Мод." button no longer overlaps the shield (verified rectangles: Mod right 212 < shield left 218).
- `windows/character/CharacterTabs.jsx`: `RankSelect` accepts `minRank` and disables lower ranks; `patchSkill` clamps downgrades; the Combat tab renders non-base actions from `system.actions` between Атаки and Weapons; the Actions tab is no longer reachable.
- `windows/character/CompendiumSelectModal.jsx`: client-side heritage predicate keeps only `versatile === true` or entries whose `ancestry`/`ancestryName` matches the selected ancestry.
- `windows/character/character-data.js`: background boost extraction is capped at two slots; `trimBackgroundBoosts` exported for the ABC picker.
- `sidebar/ChatToasts.jsx`: own messages are no longer filtered out, so the GM sees a send confirmation while the right sidebar is closed.

### Core (`packages/core/src/actor/prepare-data.js`)
- `readClassFeatureEntries` merges top-level `classDoc.items` (strict `system.category === "classfeature"` filter) with the legacy `system.items` summary, deduplicating by uuid/name. `classFeatureItems` persists `system.category = "classfeature"` so ordinary class feats are never auto-added.
- `applyClassDocument` stores `details.class.trainedSkills`.
- `minimumSkillRanks(system)` reads background/class `trainedSkills.value`; `prepareActorSystem` writes `skills.<key>.minRank` and clamps the rank upward, so a background-trained skill cannot be downgraded to untrained.

### Server (`packages/server/src/room/encounter-session.js`, `src/index.js`)
- `EncounterSession.deleteDirectoryEntry(kind, entryId, memberId, role)` removes directory entries, rejects unknown ids, and enforces actor owner/GM deletion rights.
- `index.js` accepts `room:delete-entry` (generic) and the per-kind aliases.

### Tests and verification
- `npm run test:core` — 558/558.
- `npm run test --workspace=@pf2e/server` — 65/65.
- `npm run test --workspace=@pf2e/client` — 63/63.
- `npm run build --workspace=@pf2e/client` — success (795 modules).
- Browser smoke on a fresh Vite instance (`npx vite --port 5180`) with a copied temp `session.json`: context menu, ownership placeholder, copy, delete confirmation, JSON download, read-only AC/Max HP, Temp HP row, skill floor (`crafting` value `1`, option `0` disabled), no Actions tab and Combat action section all verified; console errors 0.

## Step 5.6 — Interactive spells, chat cards, sheet initiative and UI polish

### Feature Readiness
- goal: the character sheet stops auto-spending ability boosts, heritage pickers order ancestry-bound options first, blind rolls remain only on Perception, the initiative button registers the actor in the Combat Tracker, wheel zoom always works under the cursor, the AC block fits two-digit values, held shields can be raised (AC + Action), prepared/spontaneous spellcasting consumes real resources with drag-and-drop preparation, and spell cards in chat roll saves/damage for the selected tokens.
- pf2e_remaster_rule: free ability boosts are player choices (only fixed ancestry/background boosts apply automatically; the creation cap is +4). Heritages describe an ancestry, so ancestry-bound options precede universal (`versatile`) ones. Raise a Shield is a 1-action manipulate action granting the shield's item bonus as a circumstance bonus to AC until the start of your next turn (circumstance bonuses never stack). Spontaneous casters spend a ranked spell slot (`value`), prepared casters expend one prepared slot. A saving throw is `d20 + save modifier` compared with the spell DC.
- behavior_and_boundaries: implemented empty free boosts, heritage sorting (server + picker), blind-roll removal from saves/skills, sheet → server `roll-initiative` registration, unconditional cursor-centred wheel zoom, wider AC input, held-shield raised toggle + generated "Поднять щит" action + AC math, prepared/spontaneous slot UI with HTML5 drag-and-drop and expended slots, interactive `spell-card` chat payloads with selected-token save rolls and damage rolls. Not implemented: automatic degree-of-success comparison on the server (the chat roll shows the DC and total), multi-formula damage application to HP, shield Block reaction automation from the sheet, and a dedicated spell-preparation daily reset.
- data_contracts:
  * `actor.build` — free boosts/levels may be empty; `defaultAbilityBuild` no longer fills them. New builds carry `version: 2`; legacy builds without that marker are re-opened on the empty grid (auto-distribution reset).
  * `actor.items[type=shield].raised: boolean`; `actor.system.attributes.shield = { ac, hardness, hp, brokenThreshold, broken, raised, name, itemId }`; `derived.armorClass.shieldBonus/shieldRaised/shieldName/circumstanceBonus/statusBonus`.
  * `spellcastingEntry.system.slots.slot<N> = { rank, value, max, prepared: Array<{ id, expended } | null> }` (legacy array form is still read).
  * chat message `card = { type: "spell-card" | "attack-card" | "damage-card", spellId, name, dc, saveType, damageFormula, description }`; WS `room:chat-message` accepts `card`.
  * WS intent `roll-initiative` with `{ actorId, secret }` for a directory actor (players may roll their own profile character).
- acceptance_tests: server 68/68 (new: sheet initiative creates the encounter and registers the actor; chat cards persist/validate and stay hidden on blind messages; raised held shield AC; heritage ordering), client 63/63 (default builder leaves every free boost empty), core 558/558; production client build succeeds. Browser smoke: boosts empty, heritages ordered, only Perception keeps the crossed-out eye, initiative appears in the tracker, spontaneous slots decrement, prepared slots accept drops and strike through when cast, "КС … Реакция" makes the selected token roll Reflex.
- delegated_assumptions: prepared casting stores `expended` on the slot entry (Foundry parity) but does not tick `value`; the sheet's initiative roll uses the actor's chosen `system.initiative.statistic` and starts the encounter on the first roll; the chat save button rolls for every selected token and posts the DC in the roll label.
- confidence: 97%.

### Client
- `ui/windows/character/character-data.js`: `defaultAbilityBuild(sources, level)` now applies only single-option ancestry/background boosts. Free 1st/5th/10th/15th/20th-level boosts and the class key ability start empty; `chooseDefaultBoost` and the reconstruction from current modifiers were removed.
- `ui/windows/character/AttributeBuilderModal.jsx`: passes no actor modifiers to the default builder; a saved grid (including a saved class key ability) is restored only for `version >= 2` builds, while legacy auto-distributed grids reopen empty. `commit` writes `build.version = 2`.
- `ui/windows/character/CompendiumSelectModal.jsx`: `sortCompendiumEntries` orders ancestry-bound heritages alphabetically, then versatile heritages alphabetically.
- `ui/windows/CharacterSheet.jsx`: `sendChat(text, plain, visibility, card)` forwards interactive card JSON; the initiative buttons call `networkClient.sendIntent("roll-initiative", { actorId, secret: false })`; the blind save buttons are gone (Perception keeps its eye).
- `ui/windows/character/CharacterTabs.jsx`:
  * `CombatTab` accepts `items`/`onItemsChange`, prepends a generated "Поднять щит" base action while a shield is `carried: "held"`, shows a "Поднять/Опустить" toggle and passes an `attack-card` to damage rolls.
  * `InventoryTab` shows a "Поднят" checkbox for held shields; changing the carried status away from `held` clears the flag.
  * `SkillsTab` keeps the blind-roll button only on Perception; skill and save rows lost it.
  * `SpellcastingEntryCard` normalizes legacy and object slot shapes, renders spontaneous `value/max` with a "Сотворить" button that decrements the slot, renders prepared slot rows (`max`) that accept drag-and-drop from the entry's spellbook, marks `expended` (strike-through, cast button hidden), supports removing a prepared spell, and toggles inline spell descriptions on name clicks. Icon/cast buttons send `spellCardPayload(...)`.
- `ui/ChatPanel.jsx`: renders `message.card` as `.chat-card` with "КС <dc> · <Реакция/Стойкость/Воля>" and "Бросить урон: <formula>". Save clicks read `window.pf2e.tokenLayer.selectedIds`, resolve each token's linked actor (or combatant saves), and send `/r 1d20±mod <name> — <save> (КС <dc>)`; damage clicks send a `/r` roll.
- `canvas/viewport.js`: wheel zoom is unconditional and centred on the pointer; the `pf2e:tool-change` wheel gate and its listener were removed (right-drag panning remains tool-independent).
- `net/network-client.js`: `sendChatMessage` forwards `card`.
- `ui/styles.css`: wider AC column (1.55fr) and 58px AC input; prepared-slot, expanded description, raised-shield toggle, cast button and chat-card styles.

### Core (`packages/core/src/actor/prepare-data.js`)
- `heldShieldItem(items)` / `raisedShieldItem(items)` / `shieldAcBonus(shield)` were added.
- `armorClassBreakdown(system, items)` adds a raised held shield's AC bonus as a circumstance bonus (max with other circumstance bonuses) and returns `shieldBonus`, `shieldRaised`, `shieldName`, `circumstanceBonus`, `statusBonus`.
- `prepareActorSystem` syncs the held shield into `system.attributes.shield` (AC, hardness, HP, broken threshold, raised, name, item id); no held shield forces `raised = false`.

### Server
- `room/encounter-session.js`:
  * `rollActorInitiative(actor, options)` builds a `Combatant` from `prepareActorData`, creates the encounter on demand (or appends to a started encounter), rolls only that actor's d20 with its chosen statistic, refreshes the order and starts the encounter.
  * `dispatchAction` handles the sheet-actor `roll-initiative` path before encounter/turn checks and permits a player who owns the actor (`user.characterId` or `controlledIds`); ownership is remembered in `member.controlledIds`.
  * `normalizeChatCard` validates/stores `card`; `cloneChatMessage` deep-copies it and `maskChatMessage` drops it on blind messages.
- `src/index.js`: forwards `payload.card` to `addChatMessage`.
- `compendium/catalog-service.js`: `filterIndex(entries, filters, categoryId)` sorts heritages with `compareHeritageEntries(ancestry)` (bound first, then versatile, alphabetical within each group).

### Tests and verification
- `npm run test:core` — 558/558.
- `npm run test --workspace=@pf2e/server` — 68/68.
- `npm run test --workspace=@pf2e/client` — 63/63.
- `npm run build --workspace=@pf2e/client` — success (795 modules).
- New/updated tests: `action-pipeline.test.js` (sheet initiative + permission), `chat.test.js` (card validation/visibility), `actor-pipeline.test.js` (raised shield AC, heritage ordering), `character-data.test.js` (empty default boosts).

## Step 5.7 - Feat architecture, item sheets, dynamic slots and traits

### Feature Readiness
- goal: the Feats tab separates automatically granted class features from the four player-selectable feat groups (ancestry, class, skill, general), empty slots appear/disappear with the actor's level, every sheet list expands descriptions inline and opens a real item card, and ancestry/background choices write size, traits and non-droppable skill floors.
- pf2e_remaster_rule: class features are granted by the class document and are not chosen in feat slots. Ancestry feats are gained at 1/5/9/13/17, class feats per the class document (standard 1/2/4/6/8/10/12/14/16/18/20), skill feats at 2/4/6/8/10/12/14/16/18/20 (rogue/investigator/swashbuckler differ), general feats at 3/7/11/15/19. A character cannot use a slot above their level. An ancestry sets the creature's size (`sm`, `med`, ...) and contributes its tags (`gnome`, `humanoid`, ...). Backgrounds grant exactly two ability boosts, and background/class fixed training is a floor (`minRank`) the sheet cannot lower. The item card shows description, traits and embedded rule elements.
- behavior_and_boundaries: implemented four-group slot generation from the live level, class-feature section above the slots, slot-bound drag-and-drop, automatic detaching of feats whose slot closes, size/trait propagation from ancestry and heritage, background boost trimming, read-only AC/Max HP and the item sheet modal. Not implemented: prerequisite/enforcement of feat category vs slot type (a dropped feat keeps its compendium category), full class-feature HTML descriptions (the extracted class summary only has name/level/icon), and an ownership permission matrix (still a placeholder modal).
- data_contracts:
  * `actor.system.featSlots[] = { id: "feat-slot-<ancestry|class|skill|general>-<level>", type, level, featId }`.
  * `actor.system.details.class.featLevels = { ancestry[], class[], skill[], general[] }`.
  * `actor.system.feats.classfeature[]` - automatic class features (feats and activated actions).
  * `actor.items[type=feat].slotId` and `system.location` bind a feat to a slot; a missing slot deletes the feat document during preparation.
  * `actor.system.traits.size = { value }` and `actor.system.traits.value[]` include ancestry/heritage tags; `actor.system.traits.inherited[]` records the tags contributed by the current sources so switching ancestry removes the old ones.
  * `actor.system.skills[key].minRank` (already persisted in Step 5.5) is enforced by the Skills tab.
- acceptance_tests: core 558/558; server 70/70 (new: level-down closes slots and detaches feats; ancestry size/traits); client 64/64 (new: ancestry size/traits); production build succeeds. Browser smoke: actor context menu export/copy/delete, Gnome ancestry gives Small + `gnome`/`humanoid`, Acolyte background gives exactly two boosts and `religion` `minRank = 1` with option `0` disabled, level 1 -> 3 opens class/skill/general slots, level 3 -> 2 closes the general slot and deletes its feat, feat/inventory/spell names expand inline and pencils open `ItemSheetModal` with description/traits/rules, AC input 64 px with no overlap, sidebar has no horizontal scroll.
- delegated_assumptions: slot cadence comes from the class document when present, otherwise the Remastered default table; a dropped feat keeps its compendium category and is displayed in its slot regardless of category (prerequisite enforcement is deferred); class-feature cards are read-only in the item sheet.
- confidence: 96%.

### Core (`packages/core/src/actor/prepare-data.js`)
- `FEAT_SECTION_IDS` gains `classfeature`; `FEAT_CATEGORY_SECTIONS.classfeature` no longer collapses into `class`.
- `DEFAULT_FEAT_SLOT_LEVELS`, `featSlotLevels()`, `computeFeatSlots()` and `ensureFeatSlots()` generate ancestry/class/skill/general slots for the current level and rebuild them on every derivation.
- `applyClassDocument()` persists the class cadence in `details.class.featLevels`; `pruneInactiveClassFeatures()` removes above-level/previous-class features and feats bound to closed slots; `pruneOrphanSlotFeats()` does the same for payloads edited outside the class pipeline (spells are never treated as slot feats).
- `applySourceTraits()` folds ancestry/heritage traits and ancestry size into `system.traits`, removing tags inherited from the previous source while keeping player-authored tags.
- `createActorFeatFromDocument()` accepts an explicit `category` override used by typed slot drops.

### Client
- `ui/windows/character/ItemSheetModal.jsx` (new): floating read-only item sheet built on `ModalShell`; renders meta, trait tags, full plain-text description and `system.rules` with Russian rule labels. Optional "Изменить данные" reopens the tab's editor.
- `ui/windows/character/CharacterTabs.jsx`:
  * `FeatsTab` renders "Особенности класса" first, then the four slot groups in strict order, then heritage/bonus lists. Names toggle inline descriptions; pencils open `ItemSheetModal`; slot rows show level, group, filled/empty state and release action.
  * `InventoryTab`, `SpellsTab` and `SpellcastingEntryCard` gain inline description toggles and item-sheet pencils for items, manual spells and prepared spells.
  * `RankSelect` still clamps to `minRank` and disables lower options.
- `ui/windows/CharacterSheet.jsx`: typed slot drops pass `slotType`; AC and Max HP are `readOnly` text inputs; Temp HP stays as a compact row under Current/Max; level input has an ARIA label.
- `ui/styles.css`: wider AC block (64 px value, 1.85fr column), ellipsized Mod. button that never overlaps the shield, spinner suppression, and styles for inline descriptions, feat groups and the item sheet.

### Tests and verification
- `npm run test:core` - 558/558.
- `npm run test --workspace=@pf2e/server` - 70/70.
- `npm run test --workspace=@pf2e/client` - 64/64.
- `npm run build --workspace=@pf2e/client` - success.
- Browser smoke on `npm run dev:client` + `npm run start:server`: console errors 0; context menu export produced `111.json`, copy created `12 (Копия)`, delete confirmed and removed it; 1 -> 3 -> 2 level test changed slots from `ancestry:1` to `ancestry:1/class:2/skill:2/general:3` and back, deleting the bound Toughness feat.


## Step 5.8 - In-game dialogs, token HUD, AC layout and rule-element ranks

### Feature Readiness
- goal: remove every browser `window.confirm` / `window.prompt` in favour of game-styled React surfaces; give tokens a real HUD (HP math + conditions), double-click sheets and temporary-HP bars; rebuild the AC block as layered graphics + value; and apply PF2e proficiency-granting feats as non-droppable `minRank` floors.
- pf2e_remaster_rule: a feat/class feature that says "your proficiency rank increases to expert" sets the statistic's rank to 2 (`trained = 1`, `expert = 2`, `master = 3`, `legendary = 4`). The grant is a floor: the player may later raise the rank but never lower it. Rule elements use `{ key: "ActiveEffectLike", path: "system.<stat>.rank", value }`; the Remastered compendium also stores fixed grants in `system.subfeatures.proficiencies.<stat>.rank`. Temporary HP are a separate pool that does not stack with normal HP; on the token bar they are displayed as a blue overlay of width `temp / max`.
- behavior_and_boundaries: implemented React `ConfirmModal`/`PromptModal` for directory deletion, canvas clear and feat-slot release; inline `<input type="text">` for the draw text tool at the click position; journal page name and image URL prompts; light radius prompts; RMB token HUD with HP entry (`15`, `+10`, `-10`) and the 30-condition grid; LMB double-click opens the linked sheet; blue temp-HP overlay; layered AC block; blind-roll buttons on all skills, lore and Perception (never on saves); `ActiveEffectLike` and `subfeatures.proficiencies` floors for saves, Perception, skills, attacks and defenses. Not implemented: arbitrary Foundry rule keys other than proficiency ranks, full predicate language, and a per-stat "why is this floored" tooltip.
- data_contracts:
  * `actor.system.saves[key] = { rank, minRank, mod }`, `perception`, `skills[key]`, `proficiencies.attacks[key]` and `proficiencies.defenses[key]` now expose `minRank`.
  * `actor.items[].system.rules[] = { key: "ActiveEffectLike", mode: "upgrade", path, value, predicate? }` is read during every preparation; numerical values and `ternary/gte/lte/eq/max/min/@actor.*` expressions are supported.
  * `actor.items[].system.subfeatures.proficiencies` is read as a fallback for Remastered class features (`{ reflex: { rank: 2 } }`).
  * `actor.system.conditions[]` is edited by the token HUD; HP changes write `system.attributes.hp.value` and `system.derived.hp.value` through `room:update-actor`.
  * DOM events: `pf2e:confirm-request`, `pf2e:prompt-request`, `pf2e:canvas-text-request`, `pf2e:token-hud-open`, `pf2e:open-actor-sheet`.
- acceptance_tests: `ruleElementRankFloors` turns `system.saves.reflex.rank: 2` into `rank = 2, minRank = 2` even when the persisted rank is 0; `subfeatures.proficiencies` grants Fortitude/Light Armor floors; level-scaled ternary values yield 2/3/4 at levels 1/7/15; in the Skills tab all 16 skills and Perception have the crossed-eye button while Fortitude/Reflex/Will do not; the Reflex select has options 0 and 1 disabled. Browser smoke confirms the React dialogs, inline canvas text, HUD HP math and conditions, double-click sheet, blue temp-HP pixels and layered AC block.
- delegated_assumptions: `ActiveEffectLike` values are treated as upgrade floors regardless of `mode`; unsupported formulas never grant a rank; predicates are evaluated only for `class:<slug>` (plus `or`/`and`/`not`), and unknown namespaces do not grant.
- confidence: 97%.

### Core (`packages/core/src/actor/prepare-data.js`)
- `ruleElementRankFloors(items, system)` scans `actor.items[].system.rules` for `ActiveEffectLike` `.rank` paths and `system.subfeatures.proficiencies`, then returns floors for saves, skills, Perception, attacks, defenses and spellcasting.
- `evaluateRuleExpression()` supports numeric literals, `@actor.level` / `@actor.system...`, nested `ternary`, `gte/gt/lte/lt/eq/ne`, `max/min`; `rulePredicatesPass()` handles `class:<slug>` and `or`/`and`/`not`.
- `applyRuleElementRankFloors()` clamps every rank up to its floor before strikes, AC, saves and skill modifiers are derived; `minRank` is persisted in the prepared system (the sheet's existing `minRank` contract is reused).
- `classFeatureRecord()`/`classFeatureItems()` now preserve `system.rules` and `system.subfeatures`, so class features granted by the class pipeline can carry proficiency automation.

### Client
- `ui/overlays/dialog-service.js` (new): promise-based `confirmAction`, `promptText`, `requestCanvasText`, `openTokenHud`, `openActorSheet`.
- `ui/overlays/DialogHost.jsx` (new): queued game-styled confirm/prompt modals with ОК/Отмена, Escape handling and danger styling.
- `ui/overlays/CanvasTextInput.jsx` (new): fixed-position inline text input at the click coordinates; Enter/blur commits, Escape cancels, text colour follows the drawing palette.
- `ui/overlays/TokenHUD.jsx` (new): token-anchored HP field (`15`, `+10`, `-10`, clamped to 0..max), aura-person conditions button with a 30-icon toggle grid, outside-click/Escape close and per-frame camera re-anchoring.
- `ui/overlays/OverlayHost.jsx` (new) mounted once in `App.jsx`.
- `canvas/interaction.js`: RMB on a token selects it (if needed) and opens the HUD without panning/deselecting; LMB double-click opens the linked sheet; canvas clear uses the React confirm; async text/light dialogs notify the scene saver after completion.
- `canvas/token-layer.js`: `_resolveActorHp()` returns `temp`; `_paintHpBar()` paints the blue `temp/max` overlay over the green/yellow/red bar; `actorIdForToken()` resolves sheet/HUD targets.
- `canvas/draw-layer.js`: text tool uses the inline React input for creation and editing (no `window.prompt`).
- `canvas/light-layer.js`: bulb radius editing uses the in-game prompt.
- `ui/sidebar/DirectoryPanel.jsx`: actor deletion uses `ConfirmModal`.
- `ui/sidebar/RightSidebar.jsx`: listens for `pf2e:open-actor-sheet` and reuses the ownership check.
- `ui/windows/CharacterSheet.jsx` + `ui/styles.css`: AC background is now a 62 px graphic block; the number sits in a separate absolutely positioned `.pf2e-ac__value` layer (`z-index: 10`, 78 px input, never clipped); the "Мод." button is absolute at `top: -10px; right: -20px` inside a reserved 32 px gutter so it never covers the shield.
- `ui/windows/character/CharacterTabs.jsx`: every skill/lore row and Perception gets `BlindRollButton`; saves never do; `patchSave`/`patchPerception`/`patchMartial` clamp to `minRank`; feat removal asks for confirmation.
- `ui/windows/JournalSheet.jsx`: page-name and image-URL prompts use the in-game `promptText`.

### Tests and verification
- `npm run test:core` - 558/558.
- `npm run test --workspace=@pf2e/server` - 70/70.
- `npm run test --workspace=@pf2e/client` - 67/67 (3 new rule-element/minRank tests).
- `npm run build --workspace=@pf2e/client` - success (801 modules).
- Browser smoke on `npm run dev:client` + `npm run start:server` (session `verify58`): actor deletion opened the React `ConfirmModal` with ОК/Отмена; the draw text tool opened the inline input at `(220,180)` and Enter created a `PIXI.Text` "Привет"; RMB opened the token HUD and `-5` then `+5` moved HP 20 -> 15 -> 20 and closed the field; double-click opened "Лист персонажа: Test Hero"; extracted token pixels show blue `(74,144,226)` on the left 40 % and green `(76,175,112)` on the right of the HP bar; the AC block renders the number in a separate layer with "Мод." hanging outside and clear of the shield; Reflex shows E with options 0/1 disabled, and all 16 skills plus Perception expose the crossed-eye button while saves do not.

## Step 5.8.1 - Circular token effects, floating combat text and sheet fixes

### Feature Readiness
- goal: remove the remaining browser-dialog edge cases, show condition stages directly on the token, give HP edits readable feedback above the token, force bonus-section feats to stay in that section, and make class attack/defense proficiencies non-droppable.
- pf2e_remaster_rule: valued conditions use a numeric stage (`frightened 1..4`, `clumsy/sickened/enfeebled/stupefied 1..4`, `doomed 1..3`, `dying 1..4`, `wounded 1..3`, `slowed 1..3`); boolean conditions have no stage. A class's base proficiencies (for example a cleric's trained simple weapons and unarmored defense) are automatic grants, so they act as a minimum rank exactly like background/class skill training. Temporary HP are an overlay of width `temp / max`.
- behavior_and_boundaries: implemented React confirm/prompt/inline-text surfaces, circular condition icons with LMB stage-up/RMB stage-down-or-remove, a 1.7 s rising floating HP label, forced `system.category = "bonus"` on bonus-section drops, and class proficiency floors for saves, Perception, attacks and defenses. Not implemented: rolling back an optimistic condition change on a disconnected socket (a toast is shown), per-condition custom maximums from arbitrary Foundry effects, or a full drag-and-drop prerequisite validator.
- data_contracts:
  * `actor.system.conditions[] = { id, value, label, value2 }`; `value2` is the current stage.
  * `actor.system.proficiencies.attacks[key] = { rank, minRank }` and `defenses[key] = { rank, minRank }`; the same floor fields exist for saves and Perception.
  * `actor.system.details.class.proficiencyFloors = { attacks, defenses, saves, perception }` persists the class guarantee so every preparation re-applies it.
  * `actor.items[type=feat].system.category` is the section contract; a bonus-section drop writes `"bonus"` even when the compendium document says `class`/`skill`.
  * DOM/UI contracts: `pf2e:confirm-request`, `pf2e:prompt-request`, `pf2e:canvas-text-request`, `pf2e:token-hud-open`; the token layer exposes `showFloatingText(target, text, color)` and `tokenForActor(actorId)`.
- acceptance_tests: no `window.confirm`/`window.prompt`/`window.alert` remains under `packages/client/src`; the inline canvas text input appears at the click position and commits on Enter; a `-5` HUD entry moves HP 20 -> 15 and spawns a red `-5` label; `+5` returns HP to 20 and spawns a green `+5`; two conditions are laid out at `(22.03,-22.03)` and `(2.72,-31.04)` relative to the token (upper-right, then counter-clockwise); frightened LMB goes 2 -> 3 -> 4 and caps at 4, RMB goes 4 -> 3 -> 2 -> 1 -> removed; prone LMB is a no-op and RMB removes it; a `class` feat dropped on "Бонусные способности" persists in `system.feats.bonus` with an empty `system.feats.class`; a level-8 class actor with a manually zeroed simple/martial/light rank is clamped back to rank 1 with `minRank = 1`.
- delegated_assumptions: stage maxima for the sheet's 30-condition list follow the common Remastered 1..4 (and 1..3 for doomed/wounded/slowed) convention; persistent damage is treated as a boolean badge because its numeric value is a damage formula, not a stage.
- confidence: 97%.

### Client
- `ui/conditions.js` (new): shared `CONDITION_ICONS`, `CONDITION_MAX_STAGES`, `conditionIcon`, `conditionMaxStage`, `conditionStage`, `initialConditionStage`; used by both the HUD and the PixiJS badges so they cannot drift.
- `canvas/token-layer.js`:
  * `_paintEffects()` draws condition badges in a true spiral: start at -45 deg (upper-right), advance counter-clockwise, and shrink the radius after each full circle. Each icon has a stage badge and its own `pointerdown` handler.
  * LMB calls `_changeConditionStage(..., +1)`, RMB calls it with `-1`; the handler stops Pixi/DOM propagation so a badge click never starts a token drag or camera pan.
  * condition edits optimistically repaint the local actor, then persist through `room:update-actor` with a rollback toast on failure.
  * `showFloatingText()` creates a stroked `PIXI.Text` at the token centre, rises it by 0.9 cells and fades it over 1.7 s using the shared Pixi ticker.
  * `floatingTextLayer` is a dedicated overlay that `main.js` reparents above fog/light so healing/damage numbers stay readable.
- `ui/overlays/TokenHUD.jsx`: HP commits compute the actual delta and trigger `showFloatingText` (green `+N`, red `-N`); newly applied valued conditions start at stage 1 and the grid title shows the current stage.
- `main.js`: wires `tokenLayer.networkClient = network` and adds `floatingTextLayer` to the top of the world stack.
- `ui/windows/CharacterSheet.jsx`: `addCompendiumFeat()` now uses the explicit drop section (`target.section`) before the compendium category, so any feat dropped on "Бонусные способности" becomes `bonus`.
- `ui/styles.css`: AC block is now a 62 px border-box graphic; the value stays in `.pf2e-ac__value` (`z-index: 10`, 78 px unclipped input); the row is a fixed `92px + 1fr` grid with a 2 px gap, so the shield sits immediately after the "Мод." gutter without overlapping it.
- `ui/overlays/dialog-service.js` remains the only bridge for canvas-initiated dialogs; the Step 5.8.1 audit found no direct browser dialog calls left.

### Core (`packages/core/src/actor/prepare-data.js`)
- `classProficiencyFloors(classDoc)` snapshots the class document's attacks, defenses, saving throws and Perception as rank floors.
- `applyClassDocument()` writes that snapshot to `details.class.proficiencyFloors`; `applyClassProficiencies()` also writes the matching `minRank` immediately.
- `ruleElementRankFloors()` seeds its floor tables from `details.class.proficiencyFloors` before scanning `ActiveEffectLike` rules and `system.subfeatures.proficiencies`, so every later preparation clamps and re-exposes the class guarantee.

### Tests and verification
- `npm run test:core` - 558/558.
- `npm run test --workspace=@pf2e/server` - 72/72 (new: class attack/defense floors; forced bonus feat stays in the bonus section).
- `npm run test --workspace=@pf2e/client` - 68/68 (new: staged vs boolean condition helpers).
- `npm run build --workspace=@pf2e/client` - success (802 modules).
- Browser smoke on `npm run dev:client` + `npm run start:server` (session `verify581`): console errors 0; created `Test Hero` and dropped it on the canvas as `token-1`; the HUD showed `20/20`, `-5` closed the field and produced HP 15 plus a red floating `-5`, `+5` returned HP to 20 with a green `+5` (`fill = 0x4caf70`); the two condition badges rendered upper-right/counter-clockwise; the Pixi handlers produced frightened stages `2 -> 3 -> 4 -> 4` (cap) then `4 -> 3 -> 2 -> 1 -> removed`, while prone ignored LMB and was removed by RMB; the text tool opened `.pf2e-canvas-text-input`, committed "Hello" into a drawing, and never used `window.prompt`; canvas clear opened the React confirm with `Отмена`/`ОК`; a `class` feat "Keep Up the Good Fight" dropped on "Бонусные способности" persisted with `system.category = "bonus"` and stayed in `feats.bonus` with `feats.class` empty; the AC graphic measured 62 px, the value layer reported `z-index: 10`, and the "Мод." button (right edge 181) stayed clear of the shield block (left edge 195).

## Step 5.9 - Magic rework (slots & preparation book), AC fix, HP cap and MAP formatting

### Feature Readiness
- goal: current HP can never exceed maximum HP from either the sheet or the token HUD; attack buttons show Foundry's one-line MAP labels; the AC graphic is as narrow as possible with the number on an absolute overlay and the shield tight against it; spell slots follow the character level, spontaneous casters get `[current] / [max]` + refresh inputs, and prepared casters get per-rank slot-count inputs plus a draggable preparation book window.
- pf2e_remaster_rule: current HP is bounded by `maxHp` (`Math.min(value, maxHp)`, never below 0); a caster's highest spell rank is `Math.ceil(level / 2)` capped at 10; MAP is `-5/-10` (`-4/-8` with agile); spontaneous casting spends one current spell slot; prepared casting expends the specific prepared slot and strikes it through until the next preparation.
- behavior_and_boundaries: implemented shared HP parsing/clamping, one-line strike labels, a 50 px AC graphic with an overflow value layer and an absolute `Мод.` button, level-gated rank creation, spontaneous current/max number inputs with a refresh arrow, prepared per-rank slot-count number inputs that create exactly N empty slots, a `Подгот.` preparation book window with drag-and-drop into empty slots, cast/trash controls per prepared slot. Not implemented: automatic per-day slot tables from class documents, prepared-slot drag reordering, or a spell-list filter inside the preparation book.
- data_contracts:
  * `actor.system.attributes.hp.value` is always persisted in `0..hp.max`; `parseHpInput(raw, current)` accepts `15`, `+10`, `-5`; `clampHpToMax(value, maxHp)` is shared by the sheet and the token HUD.
  * Spell slots keep the Foundry object form `system.slots.slot<N> = { rank, value, max, prepared[] }`; `prepared[index] = { id, expended } | null`.
  * Drag payload: `application/x-pf2e-prepared-spell` with `{ spellId, entryId, rank, name }`; the drop is rejected when the entry id or rank does not match.
  * UI helpers: `maxSpellRankForLevel(level)` and `strikeMapLabel(modifier, penalty)` in `character-data.js`.
- acceptance_tests: sheet `+20` HP clamps to max; token HUD `+20` clamps to max; strike buttons read `+8`, `+3 (MAP -5)`, `-2 (MAP -10)`, and agile `+6 (MAP -4)`, `+2 (MAP -8)`; level 1 allows rank 1 only, level 5 unlocks rank 3, level 19/20 unlock rank 10; spontaneous rank row shows `2 / 2` and `↻` restores spent slots; typing `2` in a prepared rank header renders exactly two empty slots; `Подгот.` opens `SpellPreparationModal`; dragging a spell from it onto a matching empty slot fills the slot; `Сотворить` adds the `--expended` strike-through; the trash button clears the slot.
- delegated_assumptions: existing saved slots above the level cap stay visible but are locked (opacity + disabled inputs) instead of being deleted; the preparation book lists all spells already attached to the entry and does not duplicate compendium drops; slot counts are capped at 99.
- confidence: 97%.

### Client
- `ui/windows/character/character-data.js`: new `maxSpellRankForLevel`, `parseHpInput`, `clampHpToMax`, `strikeMapLabel`.
- `ui/windows/CharacterSheet.jsx`: the current-HP commit parses absolute/delta text and clamps through `clampHpToMax(value, hp.max)`.
- `ui/overlays/TokenHUD.jsx`: uses the shared `parseHpInput`/`clampHpToMax`, so `+20` never raises HP above the maximum.
- `ui/windows/character/CharacterTabs.jsx`:
  * Combat strike buttons are single-line: `+N`, `+N (MAP -5)`, `+N (MAP -10)` (agile `-4/-8`).
  * Spellcasting entries compute `maxRank = maxSpellRankForLevel(level)`; the add-rank select disables higher ranks and prepared entries render a header for every unlocked rank.
  * Spontaneous slot rows use two number inputs (`current` / `max`) plus a `↻` refresh button; prepared rows show filled/max and a rank-removal button.
  * Prepared rank headers contain a number input; entering `2` resizes `prepared[]` to exactly two empty slots (`0` removes the rank).
  * The entry header has a `📖 Подгот.` button that opens `SpellPreparationModal`; prepared slot casts mark `expended` (line-through via CSS) and the `🗑` button clears a slot.
- `ui/windows/character/SpellPreparationModal.jsx` (new): floating, non-blocking preparation book (no full-screen backdrop) listing the entry's spells by rank with expandable descriptions and native HTML5 drag support.
- `ui/windows/character/spell-drag.js` (new): shared `PREPARED_DRAG_TYPE`, `setPreparedSpellDragData`, `readPreparedSpellDrag`, `acceptsPreparedSpellDrag`.
- `ui/styles.css`: AC background reduced to `50 px` with the value in `.pf2e-ac__value` (`z-index: 10`, 76 px unclipped input), the row uses `auto + 1fr` with a 2 px gap so the shield is tight; `Мод.` stays at `top: -10px; right: -20px`; new MAP, slot-input and preparation-book styles.

### Tests and verification
- `npm run test --workspace=@pf2e/client` - 72/72 (new: HP cap, HP delta parsing, spell-rank gating, MAP label formatting).
- `npm run test --workspace=@pf2e/server` - 72/72.
- `npm run test:core` - 558/558.
- `npm run build --workspace=@pf2e/client` - success (804 modules).
- Browser smoke on `npm run dev:client` + `npm run start:server`: console errors 0. A level-1 test actor rendered the AC background at 50×46 px with the value layer at `z-index: 10`, `Мод.` at `z-index: 11`, a 2 px gap to the shield, and the button bottom above the shield digits. The combat tab showed the agile fist buttons `+0`, `-4 (MAP -4)`, `-8 (MAP -8)`. A prepared entry displayed `📖 Подгот.`; typing `2` in the rank header rendered exactly two empty slots; dragging `Daze` from the preparation book onto an empty slot filled it; `Сотворить` produced `line-through` and the `🗑` button cleared the slot. Switching the same entry to spontaneous showed the two inputs `2 / 2` and `↻` restored `1 / 2` back to `2 / 2`. The sheet's current-HP field, after entering `+20` against a maximum of `10`, displayed and persisted `10` (the field accepts absolute values and signed deltas; the shared `CommitInput` mirrors a clamped commit result so a stale out-of-range draft cannot remain visible).
- Temporary smoke-test actors/items were removed afterwards.

---

## Phase 6.1 / 6.2 — Persistent Lobby Profiles and Actor Ownership

### Feature Readiness
- goal: show a real lobby before PixiJS starts, keep player accounts in `session.json` across F5, and enforce Foundry's ownership matrix on both the UI and the server.
- pf2e_remaster_rule: Foundry permissions are the four-level actor matrix `0 = None`, `1 = Limited`, `2 = Observer`, `3 = Owner`; an explicit per-user row overrides the `default` row, and the GM always has Owner on every document. Observer opens a sheet read-only; Owner edits; None/Limited cannot open the character sheet.
- behavior_and_boundaries: implemented the lobby profile list/create flow over HTTP before any WebSocket exists, persistent profiles, the ownership matrix dialog (default + every real profile, GM locked to Owner), player-side sheet gating and read-only mode, and the server-side Owner check on `updateActor`. Not implemented: per-actor permission sharing, ownership on journals/items, profile deletion/renaming from the lobby, or data redaction inside the directory broadcast.
- data_contracts:
  * `session.json.users[] = { id, name, role, color, pronouns, characterId, createdAt }` stores persistent lobby accounts. `sequences.profile` keeps the `user-N` counter.
  * `actor.ownership = { default: 0, [userId]: 3 }`; unknown ids are filtered by the server, levels are clamped to `0..3`.
  * `GET /api/lobby?sessionId=default` → `{ sessionId, users }` (the persistent profile list); `POST /api/lobby/users` with `{ sessionId, name, role }` → `201 { sessionId, user, users }`.
  * WS join resolves the role from the persistent profile, never from a client-supplied `role`.
  * `room:update-actor` accepts `ownership` only from the GM and broadcasts the focused actor plus the directory tree.
  * `room:profiles-update` (`{ sessionId, users }`) and `snapshot.profiles` keep offline accounts visible in the ownership dialog.
  * UI contract: `packages/client/src/ui/permissions.js` exposes `OWNERSHIP_LEVELS`, `OWNERSHIP_OPTIONS`, `normalizeOwnership`, `getOwnershipLevel`, `canViewActor`, `canEditActor`.
- acceptance_tests:
  * Lobby loads before `#app canvas` exists; selecting a profile mounts PixiJS and connects the socket with `memberId = profile.id`.
  * F5 returns to the lobby; the previously created profiles are still listed from `session.json`.
  * Right-clicking an actor opens "Настройка владения" with "Все игроки" plus every profile; saving writes `{ default: 0, "user-2": 3, "user-3": 2 }` to the persisted actor.
  * Owner (`3`) opens an editable sheet and can drag actor entries; Observer (`2`) gets an open sheet with `pf2e-sheet--readonly`, `inert` content/sidebar and no directory drag; None/Limited gets the "Нет доступа" toast and no sheet.
  * The GM always resolves to Owner; a player sending `ownership` is rejected with "Only the GM can change actor ownership".
  * Linking `characterId` no longer grants ownership, so a player cannot self-escalate.
- delegated_assumptions: player profiles may be created with the GM role from the lobby in this single-machine build (no password/authentication layer yet); the directory still broadcasts sheet data to all connected clients and only the editing surface is permission-gated.
- confidence: 98%.

### Server
- `packages/server/src/room/encounter-session.js`:
  * new persistent `profiles` map + `createProfile()`, `getProfiles()`, `getProfile()`, `_ensureProfileForMember()`, `_createUserFromProfile()`, `_emitProfilesUpdate()`.
  * `saveToDisk()` writes `users` and `sequences.profile`; `loadFromDisk()` restores them and normalizes every actor matrix.
  * `getActorPermission(actorId, memberId, role)` and `setActorOwnership()` implement explicit-row-over-default stacking; the GM short-circuits to level 3.
  * `updateActor()` rejects any non-Owner write and restricts matrix changes to the GM; `createDirectoryEntry()` seeds `ownership` and supports a trusted `ownerId`; `deleteDirectoryEntry()` uses the same matrix.
  * `updateProfile()` mirrors the live roster into the persistent profile but never changes ownership.
  * `snapshot()` now includes `profiles`.
- `packages/server/src/index.js`:
  * `readJsonBody()` and the lobby endpoints; join resolves name/role from the profile; player-created actors get `ownerId`; `room:update-actor` forwards `ownership`.

### Client
- `ui/StartScreen.jsx` (new): full-screen lobby with profile cards, role badge, refresh, unique-name creation (player/GM) and the "Войти" action; uses HTTP only.
- `main.js`: `bootstrap()` renders `StartScreen` first; `startGame(profile)` creates PixiJS, mounts `StoreProvider`/`App` and opens the WebSocket only after login. URL `?role=gm`/`?player=<id>` remain lobby hints.
- `ui/permissions.js` (new) + `ui/sidebar/OwnershipModal.jsx`: the live matrix dialog, level selects, GM row disabled, save through `room:update-actor`.
- `ui/sidebar/DirectoryPanel.jsx`: ownership entry is GM-only, sheet opening uses `canViewActor` and shows "Нет доступа", actor drag is Owner-only, locked rows are dimmed.
- `ui/sidebar/RightSidebar.jsx`: double-click/LMB sheet opening validates the matrix and toasts "Нет доступа" for levels 0/1.
- `ui/windows/CharacterSheet.jsx`: effective level drives `editable`, `pf2e-sheet--readonly`, an "👁 Только чтение" badge, `inert` sidebar/content, blocked drag-and-drop, and a live self-check that closes a sheet that lost access.
- `ui/StoreContext.jsx`: `profiles` state fed by snapshots and `room:profiles-update`; `net/network-client.js` forwards `ownership`.
- `ui/styles.css`: lobby, ownership matrix, read-only badge and locked-directory styles.

### Tests and verification
- `npm run test --workspace=@pf2e/server` — 77/77 (new `tests/ownership.test.js`: matrix levels, default row, characterId escalation regression, save/load persistence, HTTP lobby + WS permissions).
- `npm run test --workspace=@pf2e/client` — 78/78 (new `tests/permissions.test.js`).
- `npm run test:core` — 558/558.
- `npm run build --workspace=@pf2e/client` — success (806 modules).
- Browser smoke on `npm run dev:client` + `npm run start:server`: created profiles «Ведущий Тест», «Игрок Один», «Игрок Два», «Игрок Три»; F5 returned to the lobby with the same list and no canvas; the GM matrix showed "Все игроки" + 3 real profiles and persisted `{ default: 0, "user-2": 3, "user-3": 2 }`; login as `user-3` (Observer) opened the sheet with `.pf2e-sheet--readonly`, `inert` content/sidebar and `draggable=null` on the actor row; login as `user-4` (default 0) showed the "Нет доступа" toast and no sheet; login as `user-2` (Owner) opened the editable sheet with `draggable=true`. Console errors: 0.

---

## Phase 6.3 вЂ” Scene Settings and Character Sheet Fixes (AC / Shield / Focus / Cantrips)

### Feature Readiness
- goal: let the GM configure a scene (background image, pixel grid size, outside-map colour) and remove the character-sheet UI defects around the AC breakdown, shield block, Focus Points and rank-0 cantrips.
- pf2e_remaster_rule: a focus pool maximum equals the number of known non-cantrip focus spells, capped at 3 (`SpellPF2e#prepareActorData`); focus spells spend 1 Focus Point instead of a spell slot; cantrips are rank 0 and never consume spell slots. PF2e maps are 5-ft squares, so one grid cell is one 5-ft square (default 100 px).
- behavior_and_boundaries: implemented scene settings persistence and canvas rendering, a global Focus pool with automatic/manual maximum, focus-point consumption, infinite rank-0 cantrips for both prepared and spontaneous entries, and the AC/shield layout fixes. Not implemented: per-scene ambient darkness sliders, scene dimensions separate from the background image, or focus-point refocus automation.
- data_contracts:
  * `scenes[id] = { img, gridSize, backgroundColor, walls, drawings, lights, tokens, ... }`; `gridSize` is clamped to `20..400` (default `100`), `backgroundColor` is normalized `#rrggbb`.
  * `room:update-scene` (`{ sceneId, img, gridSize, backgroundColor }`) is GM-only, persists the entry, and broadcasts `room:directories-update`.
  * `room:scene-activated` and `snapshot` now include `scene: { id, name, img, gridSize, backgroundColor }`.
  * `actor.system.resources.focus = { value, max, cap: 3, override, known }`; `applyFocusPool()` recomputes `max = min(knownFocusSpells, 3)` unless `override === true`.
  * rank-0 spells never create/consume `spellcastingEntry.system.slots.slot0`.
- acceptance_tests:
  * The AC popover is anchored to `.pf2e-ac-row` and its right edge stays inside `.pf2e-sidebar` (measured `218 px <= 240 px`).
  * The AC graphic block and shield block are both `64x46 px`; the shield shows its HP values above and the caption "Р©РРў" below.
  * Focus pool: 0 focus spells -> `0/0`; 3 non-cantrip focus spells -> `0/3`; 4+ -> still `0/3`; a focus cantrip does not widen the pool.
  * Casting a focus spell with `value=3` changes the pool to `2/3` and leaves spell slots untouched.
  * Rank-0 sections render "Р—Р°РіРѕРІРѕСЂС‹ В· Р±РµР· СЏС‡РµРµРє, РЅРµРѕРіСЂР°РЅРёС‡РµРЅРЅРѕ", contain no slot inputs, and keep `РЎРѕС‚РІРѕСЂРёС‚СЊ` enabled after casting (spontaneous slots remained `2/2`).
  * Saving a scene with `/uploads/map-test.png`, grid 80 and `#223344` produced a `PIXI.Sprite` (`800x600`), `gridSize=80`, `gridColumns=10`, `gridRows=8`, and renderer background `#223344`.
- delegated_assumptions: scene settings are stored on the scene directory entry (matching the existing scene-canvas model); the fog texture keeps its existing 2400x1600 allocation when the grid size changes, and only grid/background sizing follows the configured cell size.
- confidence: 97%.

### Core / Data
- `packages/core/src/actor/prepare-data.js`:
  * new `FOCUS_POOL_CAP = 3`, `system.resources.focus` defaults, normalization and `focusSpellCount()` / `applyFocusPool()`.
  * `prepareActorSystem()` derives the focus maximum from `actor.items` on every preparation; duplicate spell names count once and `override: true` keeps an authored maximum.
  * exported `focusSpellCount` and `applyFocusPool`.

### Server
- `packages/server/src/room/encounter-session.js`:
  * scene defaults (`gridSize`, `backgroundColor`) on creation and load; `normalizeSceneGridSize()` and `DEFAULT_SCENE_BACKGROUND`.
  * new `getSceneSettings(sceneId)` and `updateSceneSettings(sceneId, data, sourceMemberId)`; activation payloads and `snapshot()` carry the scene settings.
- `packages/server/src/index.js`: new GM-only `room:update-scene` WS handler.

### Client
- `ui/windows/CharacterSheet.jsx` + `ui/styles.css`:
  * AC popover moved out of the 50 px wrap into the full-width `.pf2e-ac-row`; `width: 100%`, `max-width: 240px`, internal scrolling, so it can never leave the left panel.
  * AC graphic/background widened to 64 px; shield changed to the same 64 px block with values on top and "Р©РРў" underneath.
- `ui/windows/character/CharacterTabs.jsx`:
  * global Focus pool block with `РўРµРєСѓС‰РёРµ / РњР°РєСЃРёРјСѓРј`, automatic maximum hint, and an "РђРІС‚Рѕ" reset after a manual override.
  * focus spells spend a Focus Point; focus cantrips are free; rank-0 spells are always castable.
  * rank-0 slot inputs, prepared slot lanes and add-rank option removed; rank-0 headers show the infinite-cantrip hint.
- `ui/sidebar/SceneConfigModal.jsx` (new): URL/file upload background, grid size, HEX outside colour and preview; save sends `room:update-scene`.
- `ui/sidebar/DirectoryPanel.jsx`: GM-only gear button on every scene card, scene config modal wiring.
- `canvas/background-layer.js` (new) + `canvas/grid-layer.js` + `main.js`: `PIXI.Sprite` background, renderer background colour, grid recreation at the configured cell size, and grid cell count derived from the loaded image dimensions.
- `net/network-client.js`: `updateScene(sceneId, settings)`.
- `vite.config.js`: `/uploads` is now proxied to the Node server in development, so uploaded scene backgrounds and chat images load on the Vite port.

### Tests and verification
- `npm run test:core` вЂ” 558/558.
- `npm run test --workspace=@pf2e/server` вЂ” 86/86 (new scene-settings default/update/clamp/persistence/activation tests; WS activation test now also verifies GM-only scene settings broadcast).
- `npm run test --workspace=@pf2e/client` вЂ” 80/80 (new focus pool derivation, cantrip exclusion, duplicate-name and manual-override tests).
- `npm run build --workspace=@pf2e/client` вЂ” success (808 modules).
- Browser smoke on `npm run dev:client` + `npm run start:server`: AC block `64x46`, shield `64x46` with "Р©РРў" below the digits, AC popover right edge `218 px` against sidebar right edge `240 px`; Focus pool showed `0/3` after adding three focus spells and `2/3` after casting one; rank-0 cantrips in both prepared and spontaneous entries rendered no slot inputs and kept casting without changing `2/2` slots; scene config saved an 800x600 background with grid 80 and colour `#223344`, producing a loaded PixiJS sprite and a 10x8 grid. Console errors: 0. Test scene and focus/cantrip probe items were removed afterwards.

---

## Step 6.3.1 — Focus Spell UI and Focus Pool Fixes

### Feature Readiness
- goal: focus spell sets stop showing rank/slot controls, the global Focus pool is hidden unless relevant, and casting a focus spell spends the shared pool instead of a slot.
- pf2e_remaster_rule: focus spells are auto-heightened and use one shared Focus pool (maximum 3); they never consume spell ranks/slots. Inside a focus set, rank-0 cantrips are unlimited and free, while every rank-1+ focus spell costs exactly 1 Focus Point.
- behavior_and_boundaries: implemented conditional Focus pool rendering, rankless flat focus sets, focus-entry metadata, compendium drop persistence into `system.location.value`, and focus-gated casting. Not implemented: automatic heightening of the chat-card rank text, Refocus exploration automation, or changing an entry's type after creation.
- data_contracts:
  * Focus entry detection: `system.prepared === "focus"` OR `system.type === "focus"` OR `system.mode === "focus"` (`isFocusSpellcastingEntry`).
  * `SpellcastingSetupModal` writes `prepared: "focus"` and `mode: "focus"` for a Focus set; `system.slots` stays `[]`.
  * A dropped spell keeps `entryId` and `system.location.value = <entry id>`; no `slotN`/rank-cell record is written.
  * Casting a ranked focus spell calls `onFocusSpend(1)` → `updateSystem` → `room:update-actor`; `focusSpellPointCost(rank)` returns `0` for rank 0 and `1` for rank 1+.
- acceptance_tests:
  * a clean sheet with no focus set and `focus.max === 0` renders no `.pf2e-focus-pool` block at all.
  * creating a "Фокусировка" entry shows the pool block even while `focus.max === 0`.
  * a focus entry renders no `.pf2e-spell-slot-add`, no rank `<select>`, and no `.pf2e-spell-rank` headers; its spells render in one `.pf2e-spell-list--flat`.
  * an empty focus entry shows the dashed drop zone with "Перетащите заклинания из компендиума в этот набор."
  * a ranked focus spell is `disabled` at `focus.value === 0`; with points available it sends the chat card and reduces the pool by 1. Rank-0 cantrips stay enabled and spend nothing.
  * a compendium spell dropped into a focus entry is stored with `entryId`/`system.location.value` and the document rank, without a slot rank.
- delegated_assumptions: focus auto-heightening remains display-only for now; the sheet uses the rank stored on the spell document.
- confidence: 97%.

### Client
- `ui/windows/character/character-data.js`: new pure helpers `isFocusSpellcastingEntry(entry)` and `focusSpellPointCost(rank)`.
- `ui/windows/character/CharacterTabs.jsx`:
  * `SpellsTab` gates the purple Focus pool on `hasFocusEntry || focusMax > 0`.
  * `SpellcastingEntryCard` branches for focus sets: read-only `✦ Фокус value / max` badge, no rank selector, no "+ Ранг ячеек", no rank grouping, one flat spell list, dashed drop zone when empty.
  * focus casting uses `castFocusEntrySpell`: rank 0 sends the card for free, rank 1+ requires a point, sends the card, then calls `onFocusSpend(1)`.
- `ui/windows/character/CharacterModals.jsx`: the setup modal stores `mode: "focus"` for the "Фокусировка" type and disables the proficiency select.
- `ui/styles.css`: focus card, flat list and drop-zone styling.

### Tests and verification
- `npm run test --workspace=@pf2e/client` — 83/83 (3 new tests: focus-entry detection, focus point cost, drop persistence with `location.value` and no slots).
- `npm run test:core` — 558/558.
- `npm run test --workspace=@pf2e/server` — 80/80.
- `npm run build --workspace=@pf2e/client` — success (808 modules).
- `npm run dev:client` — Vite ready (5173 was occupied, so it started on 5174). The click-through checklist from the prompt (clean sheet, create focus set, drop, cast) was not automated; the component logic is covered by the acceptance paths above.

---

# Часть II — Хроника Шагов 6.4–6.5

Документ фиксирует результаты Шагов 6.4 и 6.5: экспорт/импорт миров, двуязычные компендиумы, язык API и локализация интерфейса.

## 1. Шаг 6.4 — Экспорт и импорт миров

### Серверная модель

- `packages/server/src/room/encounter-session.js`
  - Добавлен `EncounterSession#exportWorld()`. Метод возвращает полный JSON-документ мира:
    `version`, `sessionId`, `savedAt`, `users`, `directories`, `chatLog`, `activeSceneId`, `baseSceneCanvas`, `baseSceneFogExploration`, `sequences`.
  - `saveToDisk()` теперь использует `exportWorld()`, поэтому экспорт и `session.json` гарантированно имеют одинаковую структуру.
  - Восстановление состояния вынесено в приватный `_applyPersistedWorld(parsed)`. Его используют и `loadFromDisk()`, и `importWorld()`, поэтому импорт не может разойтись с загрузкой с диска.
  - Добавлен `EncounterSession#importWorld(world)`:
    - проверяет, что документ является объектом и содержит корневые ключи `directories` и `users`;
    - проверяет, что `directories` — объект, а `users` — массив;
    - заменяет `directories`, `profiles`, `chatLog`, активную сцену, Base Scene canvas/fog и счётчики ID;
    - сбрасывает боевое состояние (`combatants`, `encounter`, `combatLog`, статус `lobby`), потому что старые бойцы относятся к удалённому миру;
    - вызывает `_scheduleSave()` и рассылает обновления директорий/профилей.

### HTTP API

- `GET /api/lobby/export?sessionId=...&memberId=...`
  - только GM (проверка по connected member или persistent profile);
  - отдаёт `session.exportWorld()`;
  - заголовок `Content-Disposition: attachment; filename="world-export.json"`.
- `POST /api/lobby/import?sessionId=...`
  - только GM;
  - принимает `multipart/form-data`, поле файла `file`;
  - лимит загрузки `256 MB`;
  - парсит JSON, валидирует `directories`/`users`, вызывает `session.importWorld(parsed)`;
  - при успехе рассылает всем сокетам комнаты WebSocket-событие `room:reload`;
  - отвечает `{ ok: true, imported: true, sessionId }`;
  - коды ошибок: `403` для не-GM, `400` для невалидного JSON/структуры, `413` для слишком большого файла.

### Клиент

- `packages/client/src/net/network-client.js`
  - при получении `room:reload` вызывает `window.location.reload()`; это перезагружает и GM, и всех игроков.
- `packages/client/src/ui/sidebar/SettingsPanel.jsx`
  - во вкладке «Настройки» добавлен блок «Управление миром» (только GM);
  - «Скачать мир»: `GET /api/lobby/export`, скачивание `world-export.json` через Blob + `<a download>`;
  - «Загрузить мир»: скрытый `<input type="file" accept="application/json,.json">`;
  - после выбора файла показывается внутриигровой `ConfirmModal` через `confirmAction()`:
    «Вы уверены? Текущий мир будет безвозвратно удалён.»;
  - при согласии отправляется `POST /api/lobby/import` с `FormData`;
  - `window.confirm` не используется.

## 2. Шаг 6.5 — Двуязычные компендиумы

### Сборка данных

`packages/server/scripts/build-compendiums.js`:

- Каталоги перевода ищутся автоматически:
  - `PF2E_TRANSLATIONS_DIR`, если задан;
  - `packages/server/data/translations/pf2r/data/community/pf2e/packs`;
  - `packages/server/data/translations/pf2r/packs`.
- Для каждой категории подбираются Babele-файлы:
  - `spells` → `pf2e.spells-srd.json`;
  - `equipment` → `pf2e.equipment-srd.json`;
  - `feats` → `pf2e.feats-srd.json`, `pf2e.classfeatures.json`, `pf2e.ancestryfeatures.json`;
  - `monsters` → `pf2e.<source-pack>.json` для каждого используемого бестиария;
  - `actions` → `pf2e.actionspf2e.json`, `pf2e.adventure-specific-actions.json`;
  - `ancestries`, `heritages`, `backgrounds`, `classes` → одноимённые `pf2e.*.json`.
- Английский массив сортируется и пишется как есть.
- Русский массив — глубокая копия английского. Для каждого entry ищется оригинальное английское `name` в `entries` перевода. При совпадении заменяются:
  - `entry.name`;
  - `entry.description`;
  - `entry.system.description.value`.
- HTML описания прогоняются через существующий `cleanHtml()`, потому что английский компендиум хранит читаемый текст, а не HTML. Это сохраняет единый контракт отображения в Compendium Browser.
- Для каждой категории пишутся четыре файла:
  - `<category>.en.json`;
  - `<category>.en.index.json`;
  - `<category>.ru.json`;
  - `<category>.ru.index.json`.

Результат `npm run build:data`:

- 18 706 предметов;
- 17 581 переведённая запись;
- EN: 67.1 MB full + 6.1 MB indexes;
- RU: 90.0 MB full + 6.5 MB indexes.

Примеры покрытия:

- заклинания: 1 789 / 2 018;
- снаряжение: 5 628 / 5 956;
- черты: 6 860 / 7 301;
- монстры: 1 702 / 1 702;
- действия: 714 / 775;
- родословные: 50 / 51;
- наследия: 322 / 334;
- предыстории: 489 / 540;
- классы: 27 / 29.

Непереведённые записи остаются с английским названием и описанием.

### Серверный каталог

`packages/server/src/compendium/catalog-service.js`:

- `normalizeLanguage(value)` поддерживает `en`/`ru`, по умолчанию `en`.
- `_loadIndexes()` читает `<category>.<lang>.index.json`, сохраняя legacy `<category>.index.json` как fallback.
- `getCategory(categoryId, lang)`, `hasCategory(categoryId, lang)`, `getIndex(categoryId, filters, lang)`, `getItem(categoryId, itemId, lang)`, `getCatalog(categoryId, lang)`, `getEntry(categoryId, itemId, lang)` принимают язык.
- `filterIndex(entries, filters, categoryId, lang)` использует язык для сортировки `localeCompare`.
- Поиск идёт по выбранному языку: в `ru` ищутся русские названия, в `en` — английские.
- Кэш полных файлов разделён по фактическому имени файла, поэтому `spells.en.json` и `spells.ru.json` не перетирают друг друга.

`packages/server/src/index.js`:

- `GET /api/compendiums/:category?lang=ru|en`;
- `GET /api/compendiums/:category/:id?lang=ru|en`;
- `GET /api/compendiums?lang=ru|en`;
- WebSocket `compendium:list` / `compendium:get` принимают `payload.lang`;
- ответы содержат `X-Lang` (и `lang` в JSON там, где это объект).

### Локализация UI

- `packages/server/src/index.js`: `GET /api/i18n?lang=ru` отдаёт `pf2e.json` из перевода (с кэшем в памяти). Для `en` возвращается `{}`.
- `packages/client/src/ui/i18n.js`:
  - `setLanguage(lang)`, `getLanguage()`, `normalizeLanguage(lang)`;
  - `loadTranslations(lang)` c кэшем;
  - `t(key, fallback)` / `translate(key, fallback)` по точечным ключам Foundry (`PF2E.ArmorClassLabel`);
  - при `language === "en"` возвращается английский fallback или сам ключ.
- `packages/client/src/ui/StoreContext.jsx`:
  - состояние `language`, по умолчанию `"ru"`;
  - сохранение в `localStorage` под ключом `pf2e.language`;
  - `i18nRevision` перерисовывает потребителей после загрузки словаря;
  - `setLanguage()` обновляет i18n-модуль и localStorage.
- `packages/client/src/ui/sidebar/SettingsPanel.jsx`: переключатель «Язык компендиумов и UI: [ RU | EN ]».
- `packages/client/src/ui/CompendiumBrowser.jsx`: `lang` входит в URL списка и деталей; смена языка автоматически перезапрашивает каталог.
- `packages/client/src/ui/windows/CharacterSheet.jsx`: через `t()` локализованы вкладки листа, заголовки «Хиты», «Броня», «Восприятие», «Инициатива», подписи «КБ», «Щит» и вариант инициативы «Восприятие».

## 3. Контракты данных и событий

### World JSON

```json
{
  "version": 1,
  "sessionId": "default",
  "savedAt": "2026-11-12T00:00:00.000Z",
  "users": [],
  "directories": {
    "scenes": { "folders": [], "entries": [] },
    "actors": { "folders": [], "entries": [] },
    "items": { "folders": [], "entries": [] },
    "journals": { "folders": [], "entries": [] }
  },
  "chatLog": [],
  "activeSceneId": null,
  "baseSceneCanvas": {},
  "baseSceneFogExploration": null,
  "sequences": {}
}
```

Обязательные корневые ключи импорта: `directories`, `users`.

### WebSocket

- `room:reload` — broadcast после успешного импорта: `{ reason: "world-import", by: "<memberId>", importedAt: "<ISO>" }`.
- Клиент на `room:reload` делает `window.location.reload()`.

### Файлы компендиума

- `<category>.en.json`
- `<category>.en.index.json`
- `<category>.ru.json`
- `<category>.ru.index.json`

Legacy-файлы `<category>.json` / `<category>.index.json` остаются поддерживаемым fallback, но сборщик пишет только языковые комплекты.

## 4. Проверка

- `npm run test:core` — 558/558.
- `npm run test --workspace=@pf2e/server` — 84/84, включая новые:
  - `exportWorld/importWorld заменяют кампанию и валидируют корневые ключи`;
  - `catalog service читает en/ru indexes и full files по lang`;
  - `GM может экспортировать/импортировать мир, все получают room:reload`;
  - `compendium/UI endpoints соблюдают ?lang=ru|en`.
- `npm run test --workspace=@pf2e/client` — 86/86, включая новые тесты i18n:
  - нормализация `ru`/`en`;
  - EN возвращает английский fallback или ключ;
  - RU загружает вложенный словарь и разрешает точечные ключи.
- `npm run build --workspace=@pf2e/client` — успешно, 809 модулей.
- `npm run build:data` — успешно, EN + RU комплекты сгенерированы.

## 5. Ручная проверка в dev

1. `npm run dev:client` + `npm run start:server`.
2. Войти GM-профилем.
3. Открыть «Настройки» → «Управление миром»:
   - «Скачать мир» скачивает `world-export.json`;
   - «Загрузить мир» открывает выбор файла, затем внутриигровой ConfirmModal;
   - после подтверждения страница перезагружается у всех клиентов.
4. Переключить RU/EN:
   - Compendium Browser мгновенно меняет названия и описания;
   - вкладки и ключевые подписи листа персонажа перерисовываются через `t()`;
   - выбор сохраняется после перезагрузки страницы.

---

# Часть III — Хроника Шагов 6.6–6.7

Документ фиксирует Шаг 6.6 (Компендиум и серверная фильтрация снаряжения) и
Шаг 6.7: мгновенный глобальный i18n через React-hook, иконки предметов,
расширенные фильтры заклинаний/бестиария/черт, трёхпозиционные признаки с
исключением и переключатели `RollOption` / `FlatModifier` в листе персонажа.

## Feature Readiness — Шаг 6.6

- **goal:** Компендиум не открывается сам при входе; язык RU/EN сохраняется
  между запусками; вкладка «Снаряжение» получает левую панель фильтров; любые
  фильтры объединяются через AND и каждый изменённый фильтр вызывает
  `/api/compendiums/:category`.
- **pf2e_remaster_rule:** редкость предмета — `system.traits.rarity`
  (`common`, `uncommon`, `rare`, `unique`); тип документа — `type`; категория
  доспеха/оружия — `system.category`; цена — `system.price.value.gp/sp/cp`
  (1 gp = 10 sp = 100 cp, 1 pp = 10 gp).
- **behavior_and_boundaries:** реализованы фильтры Снаряжения и общий
  price-фильтр каталога. Внутри одной группы значений действует OR, между
  группами — AND. Пагинация `limit/offset` применяется после фильтрации.
  Полнотекстовый поиск по описанию, сортировка по цене и сохранение состояния
  фильтров между сессиями не входят в этот шаг.
- **data_contracts:** индексы каталога получили компактные `rarity`, `category`,
  `price`; HTTP-параметры `rarity`, `itemTypes`, `armorCategories`,
  `weaponCategories`, `priceMin`, `priceMax`; клиентский контракт
  `buildCompendiumUrl(tab, state)`.
- **acceptance_tests:** см. разделы 5 и 6 ниже.
- **delegated_assumptions:** цена без единицы измерения трактуется как золото
  (`10` = `10 зм`), потому что подписи полей цены в UI используют золото как
  основную валюту. Пустая или нераспознанная цена не участвует в сравнении.
- **confidence:** 97%.

## 1. Компендиум закрыт по умолчанию и глобальный язык

### Компендиум

`packages/client/src/ui/App.jsx`:

- начальное состояние окон изменено с `{ compendium: true }` на
  `{ compendium: false }`;
- Компендиум открывается кнопкой «📖 Библиотека» в верхней панели или из
  правой панели «Библиотеки».

### Сохранение языка

`packages/client/src/ui/i18n.js`:

- добавлены `LANGUAGE_STORAGE_KEY = "pf2e.language"`;
- `readStoredLanguage()` читает сохранённое значение и нормализует его в
  `ru`/`en`;
- `persistLanguage(value)` записывает выбор в `localStorage` и безопасно
  игнорирует запрет записи в приватном режиме;
- `setLanguage(value)` теперь также выставляет `document.documentElement.lang`,
  чтобы глобальный язык совпадал с языком компендиума и UI.

`packages/client/src/ui/StoreContext.jsx`:

- убраны локальные дубли чтения/записи `localStorage`;
- `useState(readStoredLanguage)` и `setLanguage()` используют общие helpers из
  `i18n.js`;
- переключатель RU/EN в `SettingsPanel.jsx` меняет UI, Compendium Browser и
  сохраняет выбор.

`packages/client/src/main.js`:

- `setI18nLanguage(readStoredLanguage())` вызывается до монтирования лобби и
  React-дерева, поэтому после F5 / повторного запуска первый кадр уже использует
  нужный язык и нет вспышки русского словаря при сохранённом EN.

## 2. Двухколоночный Compendium Browser

`packages/client/src/ui/CompendiumBrowser.jsx`:

- окно разделено на `.pf2e-compendium-sidebar` шириной 250 px и правую колонку
  с карточками;
- строка «Поиск» (`Искать…`) и фильтр «Уровни» (`От`/`До`) перенесены в левую
  панель;
- добавлена кнопка «Очистить все фильтры», сбрасывающая поиск, уровни,
  чекбоксы и поля цены;
- вкладки «Оружие» и «Щиты» удалены из верхней навигации; остаются
  «Заклинания», «Бестиарий», «Черты», «Действия», «Снаряжение»;
- `LibraryPanel.jsx` открывает каталог `equipment` в единой вкладке
  «Снаряжение» (раньше открывалась вкладка `weapons`);
- при смене вкладки состояние чекбоксов Снаряжения сбрасывается, чтобы старые
  фильтры не влияли на другой каталог.

`packages/client/src/ui/compendium-filters.js` — чистые, тестируемые helpers:

- списки опций редкости, типов инвентаря, категорий доспехов и оружия;
- `createEmptyEquipmentFilters()`;
- `toggleFilterValue(values, value)`;
- `hasEquipmentFilters(filters)`;
- `buildCompendiumUrl(tab, state)` — собирает запрос и добавляет
  equipment-параметры только для вкладки «Снаряжение».

## 3. Фильтры Снаряжения в левой панели

Для вкладки «Снаряжение» отображаются пять аккордеонов:

- **Редкость:** `common`, `uncommon`, `rare`, `unique`.
- **Типы инвентаря:** `ammo`, `armor`, `weapon`, `consumable`, `equipment`,
  `shield`, `backpack`, `kit`, `treasure`, `book`.
- **Фильтры доспехов:** `unarmored`, `light`, `medium`, `heavy`.
- **Фильтры оружия:** `simple`, `martial`, `advanced`, `unarmed`.
- **Цена:** текстовые поля «От» и «До» с подсказками `0 мм` / `10 зм` и
  пояснением `1 зм = 10 см = 100 мм`.

Поведение:

- чекбоксы применяются сразу и вызывают новый запрос;
- поиск, уровни и цена дебаунсятся на 250 мс;
- «Очистить все фильтры» сбрасывает всё состояние и немедленно
  перезапрашивает каталог;
- в одной группе значения объединяются через OR, разные группы — через AND.

## 4. Серверная фильтрация и парсинг цены

`packages/server/src/index.js`:

- `parseIndexFilters()` принимает:
  - `rarity` / `rarities`;
  - `itemTypes` / `itemType`;
  - `armorCategories` / `armorCategory`;
  - `weaponCategories` / `weaponCategory`;
  - `priceMin`, `priceMax`;
- списки принимают как повторяющиеся параметры
  (`?rarity=rare&rarity=unique`), так и значения через запятую
  (`?itemTypes=armor,shield`).

`packages/server/src/compendium/catalog-service.js`:

- `parsePriceToCp(value)` переводит строку цены в медь:
  - `5 зм` → `500`;
  - `10 см` → `100`;
  - `4 gp` → `400`;
  - `0 мм` → `0`;
  - `1 зм 5 см` → `150`;
  - `2.5 зм` / `1,5 см` → корректные доли;
  - пустое/неизвестное/отрицательное значение → `null`.
- `filterIndex()` получил:
  - `rarity` — сравнение с `entry.rarity` или `system.traits.rarity`;
  - `itemTypes` — сравнение с `entry.type`;
  - `armorCategories` — требует `type: "armor"` и совпадения категории;
  - `weaponCategories` — требует `type: "weapon"` и совпадения категории;
  - `priceMin` / `priceMax` — сравнение в cp с `entry.price` или
    `system.price.value`;
  - фильтрация выполняется до сортировки и до обрезки `limit/offset`.
- `readEntryRarity`, `readEntryCategory`, `readEntryPriceCp` понимают обе формы:
  компактную индексную и полную Foundry-документную.
- `CatalogService#_hydrateFilterFields()` подстраховывает старые
  индексы без `rarity/category/price`: при первом запросе с такими фильтрами
  недостающие поля один раз подтягиваются из полного кэшированного файла.

`packages/server/scripts/build-compendiums.js`:

- `makeIndexEntry()` теперь всегда пишет ключи `rarity`, `category` и `price`
  (значение `null`, если поля нет в документе);
- индексы остаются компактными, но сервер может фильтровать их без загрузки
  полного 15–22 MB каталога на каждый запрос; наличие всех ключей позволяет
  `_hydrateFilterFields()` отличить новый индекс от старого и не читать полный
  файл зря.

## 5. Контракты API

```http
GET /api/compendiums/equipment
  ?lang=ru
  &search=доспех
  &minLevel=1&maxLevel=10
  &rarity=rare,unique
  &itemTypes=armor
  &armorCategories=light,medium
  &weaponCategories=simple
  &priceMin=0%20мм
  &priceMax=10%20зм
  &limit=100
  &offset=0
```

Правила:

- все активные группы объединяются через AND;
- значения внутри одной группы — OR;
- `armorCategories` и `weaponCategories` одновременно могут вернуть пустой
  список, потому что предмет не может быть одновременно доспехом и оружием;
- `limit/offset` обрезают уже отфильтрованный массив;
- ответ сохраняет заголовки `X-Total-Count`, `X-Filtered-Count`, `X-Lang`.

## 6. Проверка

- `npm run test:core` — **558/558**.
- `npm run test --workspace=@pf2e/server` — **92/92**, включая новые:
  - `price strings convert to copper pieces`;
  - `index and full Foundry shapes expose rarity/category/price`;
  - `rarity AND item type filters leave only rare armor`;
  - `armor and weapon category filters target their own document type`;
  - `price range filters use copper-piece comparisons`;
  - `filters run before limit/offset pagination`;
  - `comma-separated query values share OR semantics inside a group`;
  - `equipment API combines rarity/type/category/price filters with AND`.
- `npm run test --workspace=@pf2e/client` — **91/91**, включая новые:
  - `toggleFilterValue adds and removes checkbox values`;
  - `equipment filters are detected for the clear button/state`;
  - `equipment URL carries combined rarity/type/category/price filters`;
  - `non-equipment tabs never send stale equipment filters`;
  - `the chosen language is persisted for the next launch`.
- `npm run build --workspace=@pf2e/client` — успешно, **810 модулей**.
- Пересборка каталога снаряжения:
  `buildCategory("equipment")` → **5 956** предметов, EN index ≈ 2.39 MB,
  RU index ≈ 2.52 MB. Фильтр `rarity+itemTypes+priceMax` выполнялся по индексу
  без чтения полного файла (`_itemCache.size === 0`).

### Ручная проверка в dev

1. `npm run start:server` + `npm run dev:client`.
2. Войти профилем GM.
3. **Компендиум закрыт:** после входа и после F5 элемент
   `.compendium-browser` отсутствует до нажатия «📖 Библиотека».
4. **Язык сохраняется:** Настройки → EN → `localStorage["pf2e.language"] = "en"`,
   `<html lang="en">`; после reload и повторного входа Compendium Browser
   запрашивает `/api/compendiums/equipment?lang=en`.
5. **Левая панель:** вкладка «Снаряжение» содержит
   `.pf2e-compendium-sidebar` (~250 px), поиск, уровни, пять аккордеонов и
   кнопку «Очистить все фильтры».
6. **AND-фильтры:** отметить «Редкий» + «Доспех» → запрос
   `?rarity=rare&itemTypes=armor&limit=100`, в результате 34 карточки, все
   `type: "armor"`.
7. **Цена:** открыть «Цена», ввести `0 мм` и `10 зм` → запрос
   `?rarity=rare&itemTypes=armor&priceMin=0+мм&priceMax=10+зм`; ответ содержит
   один предмет `Разделяющий боль санкейт(*)` с ценой `5 gp`, все карточки
   соответствуют диапазону.
8. **Очистка:** «Очистить все фильтры» → чекбоксы/поля пусты, запрос снова
   `/api/compendiums/equipment?lang=ru&limit=100`, показано 100 из 5 956.

## 7. Изменённые файлы

- `packages/client/src/main.js`
- `packages/client/src/ui/App.jsx`
- `packages/client/src/ui/CompendiumBrowser.jsx`
- `packages/client/src/ui/StoreContext.jsx`
- `packages/client/src/ui/i18n.js`
- `packages/client/src/ui/compendium-filters.js` (новый)
- `packages/client/src/ui/sidebar/LibraryPanel.jsx`
- `packages/client/src/ui/styles.css`
- `packages/client/tests/i18n.test.js`
- `packages/client/tests/compendium-filters.test.js` (новый)
- `packages/client/package.json`
- `packages/server/src/index.js`
- `packages/server/src/compendium/catalog-service.js`
- `packages/server/scripts/build-compendiums.js`
- `packages/server/tests/catalog-filters.test.js` (новый)
- `packages/server/tests/world-transfer.test.js`
- `packages/server/package.json`
- `packages/server/data/compendiums/equipment.*.index.json` (пересобраны)
- `docs/HANDOFF.md`, `docs/ROADMAP.md`

---

# Шаг 6.7 — Глобальный i18n, расширенные фильтры и переключатели эффектов

## Feature Readiness — Шаг 6.7

- **goal:** RU/EN переключается без перезагрузки во всех компонентах с `t()`;
  Компендиум показывает иконки предметов с fallback; вкладки Заклинаний,
  Бестиария и Черт получают тематические аккордеоны; общий фильтр «Признаки»
  умеет включать и исключать теги; `RollOption`-переключатели в листе
  персонажа мгновенно пересчитывают КБ/атаки/спасброски.
- **pf2e_remaster_rule:** редкость — `system.traits.rarity`; обычаи —
  `system.traits.traditions` (`arcane`, `divine`, `occult`, `primal`); ранг
  заклинания — `system.level.value`; категория заклинания выводится из
  признаков `cantrip`/`focus`/`ritual`; размер существа —
  `system.traits.size.value` (`tiny/sm/med/lg/huge/grg`); категория черты —
  `system.category`; признак `traitsIn` требует присутствия ВСЕХ тегов, а
  `traitsOut` запрещает ЛЮБОЙ из них. `FlatModifier` применяется только при
  истинном `predicate`, где имя без namespace — активная `RollOption`.
- **behavior_and_boundaries:** реализованы клиентские аккордеоны и серверная
  фильтрация по индексу/полному документу, трёхпозиционные теги, сбор
  toggleable `RollOption` и применение `FlatModifier` к `ac`, инициативе,
  восприятию, спасброскам, навыкам и атакам ударов. `FlatModifier` для урона,
  degrees-of-success и сложные item-relative селекторы (например,
  `bow-group-attack-roll`) в этот шаг не входят. Полнотекстовый поиск по
  описанию и сохранение фильтров между сессиями не входят.
- **data_contracts:** `system.toggles[] = { id, option, label, itemId,
  itemName, domain, enabled }`; состояние — `system.flags.pf2e.rollOptions`
  (поддерживаются плоская форма и Foundry-домен `all`); производные
  `system.ruleModifiers` и `system.derived.armorClass.ruleModifiers`;
  query-параметры `traitsIn`, `traitsOut`, `spellCategories`, `traditions`,
  `ranks`, `sizes`, `featCategories`, `skills`, `rarity`; клиентский
  контракт `buildCompendiumUrl(tab, state)`.
- **acceptance_tests:** см. разделы ниже; ключевые —
  `toggleable RollOption enables its predicate-gated FlatModifier`,
  `enabled attack FlatModifier changes Strike attack numbers`,
  `traitsIn requires every tag and traitsOut rejects any excluded tag`,
  `trait filter cycles none -> included -> excluded -> none`.
- **delegated_assumptions:** фокусные заклинания в текущем каталоге не хранят
  `system.traits.traditions`, поэтому фильтр обычаев для них может давать
  пустую выдачу; это свойство данных, а не потеря фильтра. Иконки без
  доступного файла заменяются на `/assets/ui/item-placeholder.svg`.
- **confidence:** 97%.

## 1. Глобальный i18n через `useTranslation()`

`packages/client/src/ui/i18n.js`:

- добавлен `useSyncExternalStore`-хук `useTranslation()`, возвращающий
  `{ t, language, revision }`;
- `setLanguage()` увеличивает глобальную ревизию и уведомляет подписчиков;
  завершение загрузки `/api/i18n` также уведомляет их, поэтому поздние
  переводы заменяют английские fallback без F5;
- `StoreContext` по-прежнему вызывает `setLanguage` из `i18n.js` при смене
  языка в Настройках, поэтому хук фактически подписан на язык StoreContext.

`packages/client/src/ui/windows/CharacterSheet.jsx`:

- вместо статического `t` используется `const { t } = useTranslation()`;
- заголовки вкладок, «Класс брони»/«СИЛ» и прочие локализованные подписи
  перерисовываются сразу после RU/EN.

`packages/client/src/ui/windows/character/CharacterTabs.jsx`:

- `CombatTab` также использует `useTranslation()` для подписи переключателей,
  если `rule.label` — ключ вида `PF2E.*`.

`packages/client/src/ui/CompendiumBrowser.jsx`:

- вкладки используют `PF2E.CompendiumBrowser.Tab*` и перерисовываются через
  `useTranslation()`; язык из хука также уходит в `/api/compendiums`.

## 2. Иконки предметов

- `CompendiumCard` уже брал `entry.img`; fallback через `onError` на
  `item-placeholder.svg` сохранён.
- `CompendiumSelectModal` (списки родословных/наследий/классов) показывает
  иконку слева с тем же fallback.
- `ItemSheetModal` теперь сбрасывает ошибку при смене предмета, показывает
  `item.img` и заменяет 404 на дефолтный `item-placeholder.svg`.

## 3. Расширенные фильтры Компендиума

`packages/client/src/ui/compendium-filters.js`:

- `SPELL_CATEGORIES` — Заклинание, Чары, Фокус, Ритуал;
- `SPELL_TRADITIONS` — Арканный, Оккультный, Природный, Сакральный;
- `SPELL_RANKS` — 1–10;
- `CREATURE_SIZES` — Крошечный, Маленький, Средний, Большой, Огромный,
  Исполинский;
- `FEAT_CATEGORIES` и `FEAT_SKILLS` — категории черт и 16 навыков;
- `createEmptyAdvancedFilters()`, `hasAdvancedFilters()`,
  `cycleTraitFilter()`, `traitFilterState()`.

`packages/client/src/ui/CompendiumBrowser.jsx`:

- вкладка «Заклинания»: аккордеоны «Категории», «Обычаи», «Ранги», «Редкость»;
- вкладка «Бестиарий»: «Размеры», «Редкость» и общий блок «Уровни (От/До)»;
- вкладка «Черты»: «Категории», «Навыки», «Редкость» и «Уровни (От/До)»;
- во всех вкладках добавлен аккордеон «Признаки» с полем поиска тега;
- палитра тегов загружается из
  `GET /api/compendiums/:category/facets?type=npc`, поэтому тег `android`
  доступен даже вне первых 100 карточек;
- при смене вкладки и нажатии «Очистить все фильтры» расширенное состояние
  сбрасывается.

`packages/server/src/compendium/catalog-service.js`:

- чтение `traits`, `traditions`, `spellCategory`, `size`, `featCategory`,
  `skills` из компактного индекса и полного Foundry-документа;
- `_hydrateFilterFields()` подтягивает недостающие поля из полного кэша;
- `filterIndex()` применяет новые группы через AND, значения внутри группы —
  через OR; `ranks` работает как точный список уровней;
- `readEntrySpellCategory()` выводит `cantrip`/`focus`/`ritual` из признаков.

## 4. Признаки с исключением

- Клик по тегу: нет выбора → `traitsIn` (зелёный, ✓) → `traitsOut`
  (красный, ✕ и перечёркивание) → сброс.
- Тег не может одновременно быть в `traitsIn` и `traitsOut`.
- Запрос: `?traitsIn=tag1,tag2&traitsOut=tag3`.
- Сервер возвращает только записи, содержащие ВСЕ `traitsIn` и не содержащие
  ни одного `traitsOut`.
- Проверено на реальном бестиарии: 1 702 существа, 1 андроид
  (`Android Infiltrator`), с `traitsOut=android` — 1 701 запись.

## 5. Переключатели `RollOption` / `FlatModifier`

`packages/core/src/actor/prepare-data.js`:

- `collectToggleableRollOptions()` собирает `RollOption` с
  `toggleable: true`; `alwaysActive` используется как значение по умолчанию,
  пока пользователь не записал явный флаг;
- `readRollOptionFlags()`/`activeRollOptions()` читают
  `system.flags.pf2e.rollOptions` в плоской форме и в форме `all`;
- `rulePredicatesPass()` теперь считает голое имя (`nimble-dodge`) активной
  опцией и поддерживает `class:*`, `item:trait:*`, `item:type:*`,
  `item:category:*`, `item:equipped/held/worn`, `or`/`and`/`not`;
- `collectRuleModifiers()` применяет `FlatModifier` только при выполненном
  предикате и раскладывает значения по селекторам:
  `ac`, `perception`, `initiative`, спасброски, навыки, `attack`/`attack-roll`,
  `skill-check`, `saving-throw`;
- AC использует каноническое типовое стекование (лучший бонус/худший штраф
  одного типа, untyped складывается), поэтому «Ловкое уклонение» даёт +2
  обстоятельства к КБ, а «Ageless Patience» — +2 к Восприятию и проверкам
  навыков;
- `applyRuleModifiersToStrikes()` меняет атаку/вторую/третью атаку, сохраняя
  `baseAttack`, поэтому повторная подготовка идемпотентна.

`packages/client/src/ui/windows/character/CharacterTabs.jsx`:

- вкладка «Бой» получила секцию «Переключатели» с чекбоксами;
- переключение записывает
  `system.flags.pf2e.rollOptions.all[option]` и вызывает `updateSystem`,
  который пересчитывает актёра и отправляет `room:update-actor`.

## 6. Контракты API

```http
GET /api/compendiums/spells
  ?lang=ru
  &spellCategories=focus,cantrip
  &traditions=occult,divine
  &ranks=1,2
  &rarity=uncommon
  &traitsIn=mental
  &traitsOut=android
  &limit=100

GET /api/compendiums/monsters
  ?lang=ru&type=npc&sizes=med,huge&rarity=rare&traitsOut=android

GET /api/compendiums/feats
  ?lang=ru&featCategories=skill&skills=acrobatics&traitsOut=general

GET /api/compendiums/monsters/facets?lang=ru&type=npc
  -> { category, lang, traits: ["aberration", "android", ...] }
```

Правила: списки принимают повторы и значения через запятую; группы
объединяются через AND; `traitsIn` — AND по тегам, `traitsOut` — запрет любого
тега.

## 7. Проверка

- `npm run test:core` — **558/558**.
- `npm run test --workspace=@pf2e/server` — **99/99**, включая новые:
  - `traitsIn requires every tag and traitsOut rejects any excluded tag`;
  - `spell category/tradition/rank filters use AND across groups`;
  - `bestiary size and feat category/skill filters are independent groups`;
  - `catalogue facets expose every tag, optionally narrowed by type`;
  - `spell category is derived from focus/cantrip/ritual traits`;
  - `toggleable RollOption enables its predicate-gated FlatModifier`;
  - `enabled attack FlatModifier changes Strike attack numbers`.
- `npm run test --workspace=@pf2e/client` — **94/94**, включая
  `trait filter cycles none -> included -> excluded -> none`,
  `advanced filters are detected and included only on relevant tabs` и
  `language changes notify useTranslation subscribers immediately`.
- `npm run build --workspace=@pf2e/client` — успешно, **810 модулей**.
- Реальные данные: заклинания-чары — 120, ранг 1 — 507; черты категории
  `skill` с Acrobatics — 17; бестиарий без андроидов — 1 701 из 1 702;
  средние существа — 724; редкие — 115.

### Ручная проверка в dev

1. `npm run start:server` + `npm run dev:client`, войти профилем GM.
2. Открыть лист персонажа, сменить Настройки → EN/RU: подписи вкладок и
   локальные заголовки меняются без F5.
3. Открыть «📖 Библиотека»: слева от каждого названия видна иконка; при
   битом пути показывается `item-placeholder.svg`.
4. Бестиарий → «Признаки» → ввести `android` → клик (✓) оставляет только
   `Android Infiltrator`; второй клик (✕) исключает его и возвращает 1 701
   запись; третий клик сбрасывает фильтр.
5. Заклинания → «Чары» + «Оккультный»; Бестиарий → «Размеры: Средний»;
   Черты → «Навыки: Акробатика» — выдача и URL соответствуют выбранным
   группам.
6. Добавить персонажу «Nimble Dodge»: во вкладке «Бой» появляется чекбокс
   `Nimble Dodge`; включение сразу повышает КБ на +2 (обстоятельство),
   выключение возвращает прежнее значение; изменение уходит в
   `room:update-actor`.

## 8. Изменённые файлы (Шаг 6.7)

- `packages/client/src/ui/i18n.js`
- `packages/client/src/ui/windows/CharacterSheet.jsx`
- `packages/client/src/ui/windows/character/CharacterTabs.jsx`
- `packages/client/src/ui/windows/character/ItemSheetModal.jsx`
- `packages/client/src/ui/CompendiumBrowser.jsx`
- `packages/client/src/ui/compendium-filters.js`
- `packages/client/src/ui/styles.css`
- `packages/client/tests/compendium-filters.test.js`
- `packages/core/src/actor/prepare-data.js`
- `packages/server/src/index.js`
- `packages/server/src/compendium/catalog-service.js`
- `packages/server/tests/catalog-filters.test.js`
- `packages/server/tests/actor-pipeline.test.js`
- `docs/HANDOFF.md`, `docs/ROADMAP.md`

---

# Шаг 6.8 — Полная локализация UI, двухколоночные навыки, Биография и контекстное меню сцен

## Feature Readiness — Шаг 6.8

- **goal:** при выборе EN весь интерфейс платформы (Toolbar, правая панель,
  Combat Tracker, Компендиум, директории, меню сцен) отображается на
  английском; 16 базовых навыков идут двумя колонками в алфавитном порядке
  локализованных названий; лист персонажа получает вкладку «Биография» с
  редактируемыми по карандашу WYSIWYG-полями; у карточки сцены появляется
  ПКМ-меню с просмотром, активацией, предзагрузкой, экспортом/импортом,
  копией и удалением.
- **pf2e_remaster_rule:** названия навыков и биографических разделов берутся
  из Foundry-словаря `PF2E.Skill.*` и `PF2E.Biography*`; навыки персонажа —
  это 16 фиксированных навыков PF2e Remastered; биография хранится в
  `system.details.biography` и не участвует в расчёте КБ/ХП/спасбросков.
- **behavior_and_boundaries:** локализованы все строки перечисленных
  компонентов, включая подписи фильтров, тултипы, aria-label, пустые
  состояния и ошибки. Реализованы двухколоночная сетка навыков, новая
  вкладка «Биография», переиспользуемый `RichTextEditor`, GM-only просмотр
  сцены, предзагрузка изображения и операции контекстного меню. В этот шаг не
  входят: перевод всех исторических текстов Журнала/листа персонажа, серверная
  авторизация просмотра сцены (просмотр — чисто клиентское состояние GM),
  синхронизация viewedSceneId игрокам и хранение фильтров Компендиума между
  сессиями.
- **data_contracts:**
  `system.details.biography = { height, weight, backstory, personality,
  beliefs, edicts[], anathema[], likes, dislikes, catchphrases, campaignNotes,
  allies, enemies, organizations }`;
  `StoreContext.viewedSceneId: string|null`;
  WS `room:preload-scene { sceneId }` → broadcast
  `room:preload-scene { sceneId, name, img, by }`;
  DOM `pf2e:view-scene { sceneId, scene }`;
  сцена в директории хранит `img/gridSize/backgroundColor/walls/drawings/lights/tokens`.
- **acceptance_tests:** `t("PF2E.Platform.Sidebar.TabScenes")` → «Сцены»/«Scenes»;
  `formatMessage` подставляет имя сцены; двухколоночный CSS Grid; сортировка
  навыков по локализованному названию; сохранение биографии уходит в
  `room:update-actor`; копия сцены сохраняет массивы канваса; удаление
  активной сцены возвращает базовую сцену; `room:preload-scene` доставляет
  `img` всем клиентам.
- **delegated_assumptions:** «Просмотр» не меняет `activeSceneId` и не
  отправляет серверу новую активную сцену; изображение предзагружается через
  `new Image().src` без гарантии завершения декодирования; импорт сцены
  заменяет конфигурацию и канвас выбранной сцены, а не создаёт новую.
- **confidence:** 97%.

## 1. Локальный словарь платформы и полная локализация

`packages/client/src/ui/i18n.js`:

- добавлен `PLATFORM_TRANSLATIONS` — локальная таблица `[ru, en]` для
  строк, которых нет в официальном `pf2e.json`: вкладки правой панели,
  категории/инструменты Toolbar, Combat Tracker, аккордеоны и фильтры
  Компендиума, директории, меню сцен, биография и панель WYSIWYG;
- `translate()` сначала ищет ключ в `PLATFORM_TRANSLATIONS`, затем в
  загруженном Foundry-словаре; EN возвращает английское значение локальной
  таблицы или переданный fallback;
- добавлен `formatMessage(template, values)` для подстановки `{name}`,
  `{sceneId}`, `{count}` и других плейсхолдеров.

`Toolbar.jsx`, `RightSidebar.jsx`, `CombatTracker.jsx`,
`CompendiumBrowser.jsx`, `DirectoryPanel.jsx`:

- все видимые подписи, тултипы, aria-label, статусы, пустые состояния и
  сообщения об ошибках переведены на `t()`; `SettingsPanel.jsx` также
  локализует язык UI и блок управления миром;
- опции фильтров Компендиума получили `labelKey` + английский `labelEn`;
- при переключении RU/EN компоненты перерисовываются через
  `useTranslation()`, не требуя F5.

## 2. Двухколоночные навыки

`packages/client/src/ui/windows/character/CharacterTabs.jsx`:

- `SkillsTab` строит `localizedSkills` из `SKILLS`:
  `displayLabel = t(skill.labelKey, skill.name)`;
- массив сортируется через `localeCompare` с локалью активного языка, поэтому
  порядок меняется при смене RU/EN;
- базовый список получил класс `pf2e-skill-grid`.

`packages/client/src/ui/styles.css`:

```css
.pf2e-skill-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
```

Список «Знания» остаётся одноколоночным.

## 3. Вкладка «Биография» и RichTextEditor

`packages/client/src/ui/RichTextEditor.jsx` (новый):

- вынесен из `JournalSheet.jsx` WYSIWYG-редактор на
  `document.execCommand` (форматы, стиль, жирный/курсив, цвет, списки,
  выравнивание, изображение, очистка форматирования, сохранение);
- поддерживает внешний `editorRef`, `initialValue`, `onChange`, `onSave`,
  `disabled`, placeholder и локализованные подписи;
- `JournalSheet.jsx` теперь использует `RichTextEditor` вместо собственной
  панели и `contenteditable`.

`CharacterSheet.jsx`:

- вкладка `biography` добавлена в `SHEET_TABS` сразу после `effects`;
- рендер вкладки — `<BiographyTab {...commonTabProps} />`.

`CharacterTabs.jsx`:

- удалён старый блок «Сведения» (пол/возраст/этничность/национальность) со
  вкладки «Основа»;
- `BiographyTab` содержит:
  * «Внешность»: Рост, Вес;
  * «Предыстория»: форматированный текст;
  * «Личность»: Характер, Убеждения, списки Эдикты/Анафемы, Любит, Не любит,
    Коронные фразы;
  * «Кампании»: Заметки, Союзники, Противники, Организации;
- по умолчанию поля только для чтения; карандаш появляется на hover/focus и
  включает режим редактирования;
- сохранение идёт через `updateSystem` → `prepareActorSystem` →
  `networkClient.updateActor` → `room:update-actor`, данные пишутся в
  `system.details.biography`.

## 4. Контекстное меню и режимы сцен

`StoreContext.jsx`:

- добавлено клиентское состояние `viewedSceneId` и сеттер
  `setViewedSceneId`; активация сцены сервером сбрасывает просмотр.

`DirectoryPanel.jsx`:

- ПКМ по карточке сцены открывает меню: «Просмотр», «Активация»,
  «Предзагрузить», «Экспорт данных», «Импорт данных», «Создать копию»,
  «Удалить»;
- «Просмотр» доступен только GM: выставляет `viewedSceneId`, отправляет
  DOM-событие `pf2e:view-scene` и не трогает `activeSceneId`;
- «Активация» вызывает `networkClient.activateScene` и сбрасывает просмотр;
- «Предзагрузить» вызывает `networkClient.preloadScene`;
- «Экспорт данных» скачивает `*.scene.json` с конфигурацией и массивами
  стен/рисунков/света/токенов;
- «Импорт данных» читает JSON и заменяет канвас и настройки сцены;
- «Создать копию» создаёт новую сцену с теми же массивами;
- «Удаление» подтверждается `ConfirmModal`.

`main.js`:

- `viewedSceneId`/последнее активное состояние хранятся локально; холст
  применяет просматриваемую сцену через `applyViewedScene` и возвращается к
  активной через `restoreActiveScene`;
- сохранение канваса, обновления канваса и тумана используют
  `canvasSceneId() = viewedSceneId || activeSceneId`;
- подписка `network.onPreloadScene` создаёт `new Image()` с
  `payload.img`, прогревая кэш браузера.

`network-client.js`:

- `preloadScene(sceneId)` → WS `room:preload-scene`;
- `onPreloadScene(callback)` → подписка на `room:preload-scene`.

`packages/server/src/index.js`:

- обработчик `room:preload-scene` разрешает `img/name` через
  `session.getSceneSettings()` и рассылает событие всей комнате.

`packages/server/src/room/encounter-session.js`:

- `createDirectoryEntry("scenes", ...)` сохраняет переданные
  `walls/drawings/lights/tokens` (копия/импорт не теряют канвас);
- удаление активной сцены активирует базовую сцену и рассылает
  `room:scene-activated`.

## 5. Проверка

- Core: `npm run test:core` — **558/558**.
- Server: `npm run test --workspace=@pf2e/server` — **101/101**
  (добавлены копия канваса сцены, удаление активной сцены и
  `room:preload-scene`).
- Client: `npm run test --workspace=@pf2e/client` — **95/95**
  (добавлен тест локального словаря платформы и `formatMessage`).
- Build: `npm run build --workspace=@pf2e/client` — успешно, **811 модулей**.

## 6. Изменённые файлы

- `packages/client/src/ui/i18n.js`
- `packages/client/src/ui/Toolbar.jsx`
- `packages/client/src/ui/sidebar/RightSidebar.jsx`
- `packages/client/src/ui/sidebar/CombatTracker.jsx`
- `packages/client/src/ui/sidebar/SettingsPanel.jsx`
- `packages/client/src/ui/sidebar/DirectoryPanel.jsx`
- `packages/client/src/ui/CompendiumBrowser.jsx`
- `packages/client/src/ui/compendium-filters.js`
- `packages/client/src/ui/RichTextEditor.jsx` (новый)
- `packages/client/src/ui/StoreContext.jsx`
- `packages/client/src/ui/windows/JournalSheet.jsx`
- `packages/client/src/ui/windows/CharacterSheet.jsx`
- `packages/client/src/ui/windows/character/CharacterTabs.jsx`
- `packages/client/src/ui/windows/character/character-data.js`
- `packages/client/src/ui/styles.css`
- `packages/client/src/net/network-client.js`
- `packages/client/src/main.js`
- `packages/client/tests/i18n.test.js`
- `packages/server/src/index.js`
- `packages/server/src/room/encounter-session.js`
- `packages/server/tests/scenes.test.js`
- `docs/HANDOFF.md`, `docs/ROADMAP.md`

# Шаг 6.9 — Краш правой панели, удаление верхней панели и доперевод UI

## Feature Readiness — Шаг 6.9

- **goal:** клик по вкладкам «Актёры»/«Журналы» больше не размонтирует весь
  React-интерфейс; верхняя навигационная панель удалена; остаточные строки
  чата и HUD переводятся RU/EN без перезагрузки.
- **pf2e_remaster_rule:** N/A — чисто интерфейсный слой, правила PF2e
  Remastered не затрагиваются.
- **behavior_and_boundaries:** исправлен рендер директорий и добавлена
  изоляция ошибок вкладок. Компендиум открывается только из вкладки
  «Библиотеки». Кастомные темы/скины и новые окна не добавлялись.
- **data_contracts:** форма `directories[kind].entries/folders` не менялась;
  уровень актёра читается как `entry.level` либо
  `entry.system.details.level.value`.
- **acceptance_tests:** вкладки актёров/журналов открываются при пустых и
  заполненных списках; ошибка рендера вкладки показывает «Ошибка рендера»,
  не трогая левый HUD; RU/EN переключает видимость чата, placeholder,
  drag-and-drop подсказку и тултипы; сборка клиента проходит.
- **delegated_assumptions:** нет.
- **confidence:** 98%.

## 1. Корневая причина исчезновения HUD

`DirectoryPanel.jsx` → `EntryRow` вызывал `entrySubtitle(kind, entry)` **без
третьего аргумента `t`**. Для актёров и журналов helper обращался к
`t()`/`formatMessage(t(...))`, где `t` был `undefined`, что бросало
`TypeError` прямо во время render. React при необработанной ошибке render
размонтировал всё дерево — вместе с левым HUD, списком игроков и чатом.

Исправления:

- `EntryRow` передаёт локализатор: `entrySubtitle(kind, entry, t)`.
- Уровень актёра читается защищённо (`actorLevel`): поддерживаются
  `entry.level` и вложенный `entry.system.details.level.value`; отсутствие
  уровня даёт `1`, а не исключение.
- Списки/папки директории нормализуются до массивов, а чтение `pages`,
  `itemType`, `actorType`, `name`, `id`, `img`, `folderId` использует
  optional chaining.
- Добавлен классовый `ErrorBoundary` (`packages/client/src/ui/ErrorBoundary.jsx`).
  Содержимое вкладки в `RightSidebar.jsx` обёрнуто в него с `key={activeTab}`:
  падение одной вкладки показывает локализованный текст «Ошибка рендера» и
  кнопку «Повторить», а остальной интерфейс остаётся смонтированным. Смена
  вкладки автоматически сбрасывает boundary.
- Дополнительно в `App.jsx` изолированы `Toolbar`, `PlayerList`, `Hotbar`,
  `RightSidebar` и `CompendiumBrowser`: ошибка одного HUD-виджета не
  размонтирует соседние.

## 2. Удаление верхней навигационной панели

- Из `App.jsx` полностью удалён `.ui-topbar` (бренд, кнопка «Библиотека»,
  статус WebSocket, роль и строка боя), а также неиспользуемые
  `useStore`/`toggleWindow`.
- Компендиум открывается только через вкладку «Библиотеки» правой панели
  (`LibraryPanel` → `onOpenCompendium`).
- Удалены CSS-правила `.ui-topbar*`, `.ui-status-dot*`, `.ui-role-badge`.
- `right-sidebar` теперь начинается с `top: 0` (desktop и mobile), а
  `.compendium-browser` поднят с `top: 64px` до `top: 20px`
  (`height: calc(100vh - 40px)`); на узких экранах — `top: 12px`.
- Добавлены стили `.ui-error-boundary*` для изолированной ошибки.

## 3. Доперевод интерфейса

В `PLATFORM_TRANSLATIONS` добавлены ключи:

- видимость чата: `PF2E.Platform.Chat.Visibility.Public/Gm/Blind/Self` и
  соответствующие `*Title` (тултипы);
- композер: `Chat.Placeholder`, `Chat.DropHint`, `Chat.Uploading`,
  `Chat.Empty`, `Chat.Send/SendTitle`, `Chat.Clear*`;
- сообщения и карточки: `Chat.HiddenMessage`, `Chat.HiddenContent`,
  `Chat.HiddenResult`, `Chat.ImageAlt`, `Chat.Save.*`, `Chat.Damage*`,
  `Chat.DCShort`, `Chat.SelectToken`, `Chat.CharacterPrefix`;
- быстрый ввод (`FloatingChatInput`): `Chat.QuickPlaceholder`,
  `Chat.QuickExpand`, `Chat.RollDice`, `Chat.QuickInput`;
- HUD игроков: `Players.Title/Aria/Waiting/RoleGm/RolePlayer/Configure*`;
- системные: `Common.RenderError`, `Common.Retry`, `Common.Yes/No`.

`ChatPanel.jsx` использует `useTranslation()` и `formatMessage()`; массив
`VISIBILITIES` теперь хранит `labelKey`/`titleKey`, поэтому подписи и тултипы
переключаются мгновенно. `FloatingChatInput.jsx`, `PlayerList.jsx` и
`Toolbar.jsx` также читают строки через `useTranslation()`. Время сообщений
форматируется по текущему языку (`ru-RU`/`en-US`).

## 4. Проверка

- Core: `npm run test:core` — **558/558**.
- Server: `npm run test --workspace=@pf2e/server` — **101/101**.
- Client: `npm run test --workspace=@pf2e/client` — **96/96**
  (добавлен регрессионный тест RU/EN для видимости чата, placeholder,
  drag-and-drop подсказки и тултипов HUD).
- Build: `npm run build --workspace=@pf2e/client` — успешно, **812 модулей**.

## 5. Изменённые файлы

- `packages/client/src/ui/ErrorBoundary.jsx` (новый)
- `packages/client/src/ui/App.jsx`
- `packages/client/src/ui/ChatPanel.jsx`
- `packages/client/src/ui/Toolbar.jsx` (проверен: все тултипы уже через `t()`)
- `packages/client/src/ui/PlayerList.jsx`
- `packages/client/src/ui/i18n.js`
- `packages/client/src/ui/sidebar/DirectoryPanel.jsx`
- `packages/client/src/ui/sidebar/RightSidebar.jsx`
- `packages/client/src/ui/sidebar/FloatingChatInput.jsx`
- `packages/client/src/ui/styles.css`
- `packages/client/tests/i18n.test.js`
- `docs/HANDOFF.md`
