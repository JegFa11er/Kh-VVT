import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  DEFAULT_LANGUAGE,
  loadTranslations,
  normalizeLanguage,
  persistLanguage,
  readStoredLanguage,
  setLanguage as setI18nLanguage,
} from "./i18n.js";

/**
 * Minimal application store for the React UI layer.
 *
 * The provider mirrors the authoritative state owned by NetworkClient: the
 * latest combat snapshot received through `room:state-update` and the role the
 * local client joined the room with. Components read it through `useStore()`
 * instead of wiring their own WebSocket listeners.
 */
const EMPTY_DIRECTORIES = {
  scenes: { folders: [], entries: [] },
  actors: { folders: [], entries: [] },
  items: { folders: [], entries: [] },
  journals: { folders: [], entries: [] },
};

const StoreContext = createContext({
  networkClient: null,
  combatState: null,
  chatLog: [],
  users: [],
  profiles: [],
  myUserId: null,
  directories: EMPTY_DIRECTORIES,
  activeRole: "player",
  connected: false,
  activeSceneId: null,
  viewedSceneId: null,
  activeTool: "token",
  activeSubTool: "select",
  language: DEFAULT_LANGUAGE,
  i18nRevision: 0,
  setCombatState: () => {},
  setDirectories: () => {},
  setActiveTool: () => {},
  setActiveSubTool: () => {},
  setViewedSceneId: () => {},
  setLanguage: () => {},
});

function normalizeRole(role) {
  return role === "gm" ? "gm" : "player";
}

/**
 * `session:snapshot` carries the flat room snapshot, while
 * `room:state-update` carries the richer serialized combat state. Preserve the
 * rich payload once it exists, but refresh the clock/roster metadata from every
 * snapshot so the Combat Tracker stays live.
 */
function mergeRoomSnapshot(current, snapshot) {
  if (!current || !current.encounter) {
    return snapshot;
  }
  return {
    ...current,
    status: snapshot.status || current.status,
    encounter: {
      ...current.encounter,
      round:
        typeof snapshot.round === "number"
          ? snapshot.round
          : current.encounter.round,
      activeCombatantId:
        snapshot.activeCombatantId === undefined
          ? current.encounter.activeCombatantId
          : snapshot.activeCombatantId,
    },
  };
}

export function StoreProvider({ networkClient, initialRole = "player", children }) {
  const [combatState, setCombatState] = useState(null);
  // Viewer-filtered chat history (Step 4.4).
  const [chatLog, setChatLog] = useState([]);
  // Connected-client roster shared by the player list and the profile modal.
  const [users, setUsers] = useState([]);
  // Persistent lobby accounts from `session.json`. Offline profiles still
  // appear in the ownership matrix.
  const [profiles, setProfiles] = useState([]);
  const [myUserId, setMyUserId] = useState(null);
  // Folders/entities for the right-sidebar directories (Step 4.5).
  const [directories, setDirectories] = useState(EMPTY_DIRECTORIES);
  const [activeRole, setActiveRole] = useState(normalizeRole(initialRole));
  // Active scene selected in the Scenes directory (Step 4.8).
  const [activeSceneId, setActiveSceneId] = useState(null);
  // Step 6.8: GM-only local preview. The canvas renders this scene while the
  // players (and the authoritative `activeSceneId`) stay untouched.
  const [viewedSceneId, setViewedSceneId] = useState(null);
  const [connected, setConnected] = useState(
    Boolean(networkClient && networkClient.connected),
  );
  // Scene controls: `activeTool` is the left-hand category, `activeSubTool`
  // is the concrete tool inside that category.
  const [activeTool, setActiveTool] = useState("token");
  const [activeSubTool, setActiveSubTool] = useState("select");
  // Step 6.5: RU/EN preference, persisted locally for the browser profile. The
  // revision counter forces `t()` consumers to re-render once the dictionary
  // has finished loading.
  const [language, setLanguageState] = useState(readStoredLanguage);
  const [i18nRevision, setI18nRevision] = useState(0);

  const setLanguage = useCallback((nextLanguage) => {
    const normalized = normalizeLanguage(nextLanguage);
    setLanguageState(normalized);
    setI18nLanguage(normalized);
    persistLanguage(normalized);
  }, []);

  useEffect(() => {
    setI18nLanguage(language);
    let cancelled = false;
    loadTranslations(language).then(() => {
      if (!cancelled) {
        setI18nRevision((current) => current + 1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  useEffect(() => {
    if (!networkClient) {
      return undefined;
    }

    setActiveRole(normalizeRole(networkClient.role || initialRole));

    const unsubscribeState = networkClient.onStateUpdate((update) => {
      if (!update) {
        return;
      }
      // `room:state-update` sends `{ state, logEntries }`; older callbacks may
      // pass a bare combat state, so accept both shapes.
      setCombatState(update.state || update);
    });

    const unsubscribeJoined = networkClient.on("joined", (payload) => {
      const member = payload && payload.member;
      if (member && member.role) {
        setActiveRole(normalizeRole(member.role));
      }
      if (member && member.id) {
        setMyUserId(member.id);
      }
      if (payload && payload.session) {
        setCombatState((current) => current || payload.session);
        if (payload.session.activeSceneId !== undefined) {
          setActiveSceneId(payload.session.activeSceneId || null);
        }
        if (Array.isArray(payload.session.users)) {
          setUsers(payload.session.users);
        }
        if (Array.isArray(payload.session.profiles)) {
          setProfiles(payload.session.profiles);
        }
        if (payload.session.directories) {
          setDirectories(payload.session.directories);
        }
      }
    });

    const unsubscribeSnapshot = networkClient.on("session:snapshot", (snapshot) => {
      if (snapshot) {
        setCombatState((current) => mergeRoomSnapshot(current, snapshot));
        if (snapshot.activeSceneId !== undefined) {
          setActiveSceneId(snapshot.activeSceneId || null);
        }
        if (Array.isArray(snapshot.users)) {
          setUsers(snapshot.users);
        }
        if (Array.isArray(snapshot.profiles)) {
          setProfiles(snapshot.profiles);
        }
        if (snapshot.directories) {
          setDirectories(snapshot.directories);
        }
      }
    });

    const unsubscribeUsers = networkClient.onUsersUpdate((nextUsers) => {
      setUsers(Array.isArray(nextUsers) ? nextUsers : []);
    });

    const unsubscribeProfiles = networkClient.on("room:profiles-update", (payload) => {
      const nextProfiles = Array.isArray(payload)
        ? payload
        : payload && Array.isArray(payload.users)
          ? payload.users
          : [];
      setProfiles(nextProfiles);
    });

    const unsubscribeChat = networkClient.onChatUpdate((nextChatLog) => {
      setChatLog(Array.isArray(nextChatLog) ? nextChatLog : []);
    });

    // Scene activation changes the PixiJS canvas; the directory panel still
    // needs the id to highlight the active card.
    const unsubscribeScene = networkClient.onSceneActivated((payload) => {
      if (payload) {
        setActiveSceneId(payload.activeSceneId || null);
        // Activation is authoritative for the whole room; a GM preview must
        // end so everyone (including the GM) returns to the active scene.
        setViewedSceneId(null);
      }
    });

    const unsubscribeDirectories = networkClient.onDirectoriesUpdate(
      (nextDirectories) => {
        if (nextDirectories) {
          setDirectories(nextDirectories);
        }
      },
    );

    const unsubscribeOpen = networkClient.on("open", () => setConnected(true));
    const unsubscribeClose = networkClient.on("close", () => setConnected(false));

    return () => {
      unsubscribeState();
      unsubscribeJoined();
      unsubscribeSnapshot();
      unsubscribeUsers();
      unsubscribeProfiles();
      unsubscribeChat();
      unsubscribeScene();
      unsubscribeDirectories();
      unsubscribeOpen();
      unsubscribeClose();
    };
  }, [networkClient, initialRole]);

  const value = useMemo(
    () => ({
      networkClient,
      combatState,
      chatLog,
      users,
      profiles,
      myUserId,
      directories,
      activeRole,
      connected,
      activeSceneId,
      viewedSceneId,
      activeTool,
      activeSubTool,
      language,
      i18nRevision,
      setCombatState,
      setDirectories,
      setActiveTool,
      setActiveSubTool,
      setViewedSceneId,
      setLanguage,
    }),
    [
      networkClient,
      combatState,
      chatLog,
      users,
      profiles,
      myUserId,
      directories,
      activeRole,
      connected,
      activeSceneId,
      viewedSceneId,
      activeTool,
      activeSubTool,
      language,
      i18nRevision,
      setLanguage,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  return useContext(StoreContext);
}

export default StoreContext;
