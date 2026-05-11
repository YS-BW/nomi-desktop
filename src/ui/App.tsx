import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import {
  applyRemoteDefaults,
  deleteRemoteEntry,
  loadRemoteCatalog,
  registerRemoteSession,
  syncRemoteSessions,
  saveProfile,
  saveRemoteCatalog,
  unregisterRemoteSession,
  upsertRemoteEntry,
  uploadRemoteSkillZip,
  type DesktopRemoteCatalog,
} from "../lib/store";
import {
  createEmptyRemoteSessionListState,
  mergeRemoteSessionItems,
  normalizeRemoteSessionItem,
  type RemoteSessionItem,
} from "../lib/remoteSessions";
import type {
  DesktopActions,
  DesktopConnectionProfile,
  RemoteClientError,
  RemoteCommand,
  ThemePreference,
} from "../lib/types";
import { createDesktopSessionId, createStableClientId } from "../lib/ids";
import {
  DEFAULT_ACCENT_COLOR,
  getAccentContrastColor,
  mixHex,
  normalizeAccentColor,
  rgbaFromHex,
} from "../lib/themeAccent";
import { createInitialDesktopState, desktopReducer } from "../state/reducer";
import { RemoteClient } from "../transport/remoteClient";
import { MainShell } from "./MainShell";

const HISTORY_LIMIT = 100;
const SESSION_PAGE_SIZE = 100;

interface SessionProtocolEvent extends Record<string, unknown> {
  type?: string;
  session_id?: string;
  sessions?: Array<Record<string, unknown>>;
  next_page_token?: string | null;
  total_count?: number | null;
  title?: string | null;
  created_at_ms?: number | null;
  deleted?: boolean;
  resource?: string;
  code?: string;
  command?: string;
  message?: string;
}

type ResolvedTheme = "light" | "dark";

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useResolvedTheme(preference: ThemePreference): ResolvedTheme {
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = (event?: MediaQueryListEvent) => {
      if (event) {
        setSystemTheme(event.matches ? "dark" : "light");
        return;
      }
      setSystemTheme(mediaQuery.matches ? "dark" : "light");
    };
    updateTheme();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateTheme);
      return () => {
        mediaQuery.removeEventListener("change", updateTheme);
      };
    }
    mediaQuery.addListener(updateTheme);
    return () => {
      mediaQuery.removeListener(updateTheme);
    };
  }, []);

  if (preference === "light" || preference === "dark") {
    return preference;
  }
  return systemTheme;
}

function applyDocumentTheme(theme: ResolvedTheme, accentColor: string) {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  const normalizedAccent = normalizeAccentColor(accentColor);
  const accentContrast = getAccentContrastColor(normalizedAccent);
  const accentSoft =
    theme === "dark"
      ? rgbaFromHex(normalizedAccent, 0.28)
      : rgbaFromHex(normalizedAccent, 0.18);
  const accentSoftStrong =
    theme === "dark"
      ? rgbaFromHex(normalizedAccent, 0.36)
      : rgbaFromHex(normalizedAccent, 0.24);
  const accentBorder =
    theme === "dark"
      ? rgbaFromHex(normalizedAccent, 0.42)
      : rgbaFromHex(normalizedAccent, 0.28);
  const accentHover =
    theme === "dark"
      ? mixHex(normalizedAccent, "#ffffff", 0.1)
      : mixHex(normalizedAccent, "#111827", 0.08);
  const glassTintSoft =
    theme === "dark"
      ? rgbaFromHex(normalizedAccent, 0.05)
      : rgbaFromHex(normalizedAccent, 0.08);
  const glassTintStrong =
    theme === "dark"
      ? rgbaFromHex(normalizedAccent, 0.11)
      : rgbaFromHex(normalizedAccent, 0.16);
  const glassTintEdge =
    theme === "dark"
      ? rgbaFromHex(normalizedAccent, 0.18)
      : rgbaFromHex(normalizedAccent, 0.22);
  const glassTintLine =
    theme === "dark"
      ? rgbaFromHex(normalizedAccent, 0.08)
      : rgbaFromHex(normalizedAccent, 0.1);

  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.style.setProperty("--accent", normalizedAccent);
  root.style.setProperty("--accent-contrast", accentContrast);
  root.style.setProperty("--accent-soft", accentSoft);
  root.style.setProperty("--accent-soft-strong", accentSoftStrong);
  root.style.setProperty("--accent-border", accentBorder);
  root.style.setProperty("--accent-hover", accentHover);
  root.style.setProperty("--glass-tint-soft", glassTintSoft);
  root.style.setProperty("--glass-tint-strong", glassTintStrong);
  root.style.setProperty("--glass-tint-edge", glassTintEdge);
  root.style.setProperty("--glass-tint-line", glassTintLine);
  delete root.dataset.windowKind;
  delete document.body.dataset.windowKind;
}

function hasConnectableProfile(profile: DesktopConnectionProfile): boolean {
  return Boolean(profile.host.trim() && profile.port.trim() && profile.token.trim());
}

function getCommandBlockMessage(state: ReturnType<typeof createInitialDesktopState>): string | null {
  if (state.connectionStatus === "connecting") {
    return "正在连接 remote，请稍等。";
  }
  if (!state.readyReceived || !state.bindCompleted || !state.ownerReady) {
    return "主窗口尚未完成会话绑定。";
  }
  if (state.connectionStatus === "error") {
    if (state.connectionReason === "auth_error") {
      return "remote 鉴权失败，请检查 token。";
    }
    if (state.connectionReason === "transport_error") {
      return "remote 连接失败，请检查 host 和 port。";
    }
    return state.connectionDetail || "remote 连接异常。";
  }
  if (state.connectionStatus === "disconnected") {
    return "当前未连接 remote。";
  }
  return null;
}

export function App() {
  const initialRemoteCatalog = useMemo(() => loadRemoteCatalog(), []);
  console.info("[nomi-desktop] initial remote catalog", initialRemoteCatalog);
  const initialProfile =
    initialRemoteCatalog.remotes.find((entry) => entry.id === initialRemoteCatalog.activeRemoteId)?.profile ||
    initialRemoteCatalog.remotes[0].profile;
  const [state, dispatch] = useReducer(
    desktopReducer,
    initialProfile,
    createInitialDesktopState,
  );
  const [remoteCatalog, setRemoteCatalog] = useState<DesktopRemoteCatalog>(initialRemoteCatalog);
  const [draftInput, setDraftInput] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [composerPhase, setComposerPhase] = useState<"idle" | "interrupting" | "sending">("idle");
  const [previewThemePreference, setPreviewThemePreference] = useState<ThemePreference | null>(null);
  const [sessionListState, setSessionListState] = useState(createEmptyRemoteSessionListState);
  const clientRef = useRef(new RemoteClient());
  const autoConnectDoneRef = useRef(false);
  const sessionRecoveryRef = useRef<{
    remoteId: string;
    requestedSessionId: string | null;
    recoverySessionId: string;
    attempted: boolean;
    reason: "missing_session" | "first_message";
  } | null>(null);
  const startupSessionScanRef = useRef<{
    remoteId: string;
    awaitingSelection: boolean;
  } | null>(null);
  const pendingInitialMessageRef = useRef<string | null>(null);
  const remoteCatalogRef = useRef(initialRemoteCatalog);
  const activeRemoteIdRef = useRef(initialRemoteCatalog.activeRemoteId);
  const sessionListStateRef = useRef(sessionListState);
  const sessionListRequestModeRef = useRef<"replace" | "append">("replace");
  const resolvedTheme = useResolvedTheme(previewThemePreference ?? state.profile.themePreference);

  useEffect(() => {
    remoteCatalogRef.current = remoteCatalog;
    activeRemoteIdRef.current = remoteCatalog.activeRemoteId;
    console.info("[nomi-desktop] remote catalog updated", remoteCatalog);
  }, [remoteCatalog]);

  useEffect(() => {
    sessionListStateRef.current = sessionListState;
  }, [sessionListState]);

  useEffect(() => {
    applyDocumentTheme(resolvedTheme, state.profile.accentColor || DEFAULT_ACCENT_COLOR);
  }, [resolvedTheme, state.profile.accentColor]);

  useEffect(() => {
    return () => {
      void clientRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
    void applyRemoteDefaults(state.profile).then((nextProfile) => {
      console.info("[nomi-desktop] applyRemoteDefaults resolved", {
        before: state.profile,
        after: nextProfile,
      });
      if (JSON.stringify(nextProfile) === JSON.stringify(state.profile)) {
        return;
      }
      saveProfile(nextProfile);
      setRemoteCatalog(loadRemoteCatalog());
      dispatch({ type: "profile/update", profile: nextProfile });
    });
  }, []);

  useEffect(() => {
    if (autoConnectDoneRef.current) {
      return;
    }
    if (!hasConnectableProfile(state.profile)) {
      return;
    }
    autoConnectDoneRef.current = true;
    connect(state.profile, activeRemoteIdRef.current);
  }, [state.profile]);

  useEffect(() => {
    const latestEvent = state.eventLog[0];
    if (!latestEvent) {
      return;
    }
    const matchesCurrentSession =
      !latestEvent.session_id || latestEvent.session_id === state.currentSessionId;
    if (
      matchesCurrentSession &&
      (latestEvent.type === "turn_completed" || latestEvent.type === "task_delivered")
    ) {
      void refreshSidebarData();
    }
    if (
      matchesCurrentSession &&
      latestEvent.type === "resource_action_result" &&
      latestEvent.ok &&
      latestEvent.action
    ) {
      const shouldRefreshSidebar =
        latestEvent.resource === "skill" ||
        latestEvent.resource === "mcp" ||
        latestEvent.resource === "task" ||
        latestEvent.action === "clear_remote_runtime";
      if (shouldRefreshSidebar) {
        void refreshSidebarData();
      }
      if (latestEvent.action === "clear_remote_runtime") {
        fetchBoundSessionState(state.currentSessionId);
      }
    }
  }, [state.currentSessionId, state.eventLog]);

  useEffect(() => {
    const handleFocus = () => {
      void refreshSidebarData();
      if (state.ownerReady) {
        void refreshRemoteSessions();
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [state.connectionStatus, state.currentSessionId]);

  useEffect(() => {
    setSessionListState(createEmptyRemoteSessionListState());
  }, [remoteCatalog.activeRemoteId]);

  useEffect(() => {
    if (!state.ownerReady) {
      return;
    }
    void refreshRemoteSessions();
  }, [remoteCatalog.activeRemoteId, state.ownerReady]);

  function persistRemoteCatalog(nextCatalog: DesktopRemoteCatalog) {
    remoteCatalogRef.current = nextCatalog;
    setRemoteCatalog(nextCatalog);
    saveRemoteCatalog(nextCatalog);
  }

  function updateRemoteCatalog(transform: (current: DesktopRemoteCatalog) => DesktopRemoteCatalog) {
    const nextCatalog = transform(remoteCatalogRef.current);
    persistRemoteCatalog(nextCatalog);
    return nextCatalog;
  }

  function rememberSession(sessionId: string, remoteId = activeRemoteIdRef.current) {
    const trimmedSessionId = sessionId.trim();
    if (!trimmedSessionId) {
      return;
    }
    const nextCatalog = registerRemoteSession(remoteCatalogRef.current, remoteId, trimmedSessionId);
    if (nextCatalog === remoteCatalogRef.current) {
      return;
    }
    persistRemoteCatalog(nextCatalog);
  }

  function updateProfile(patch: Partial<DesktopConnectionProfile>) {
    const nextProfile = {
      ...state.profile,
      ...patch,
      accentColor: normalizeAccentColor(patch.accentColor || state.profile.accentColor || DEFAULT_ACCENT_COLOR),
      lastBoundSessionId: state.profile.defaultSessionId,
    };
    persistRemoteCatalog(upsertRemoteEntry(remoteCatalog, {
      id: remoteCatalog.activeRemoteId,
      name:
        remoteCatalog.remotes.find((entry) => entry.id === remoteCatalog.activeRemoteId)?.name || "远端",
      profile: nextProfile,
    }));
    dispatch({ type: "profile/update", profile: nextProfile });
  }

  async function sendCommand(command: RemoteCommand) {
    const blockedMessage = getCommandBlockMessage(state);
    if (blockedMessage) {
      dispatch({ type: "error/set", message: blockedMessage });
      return false;
    }
    const ok = await clientRef.current.send(command);
    if (!ok) {
      dispatch({ type: "error/set", message: "连接已断开，请重新连接 remote。" });
      dispatch({
        type: "connection/status",
        status: "disconnected",
        detail: "连接已断开",
        reason: "closed",
        readyReceived: false,
        bindCompleted: false,
      });
    }
    return ok;
  }

  function fetchBoundSessionState(sessionId: string) {
    void sendCommand({ type: "load_history", session_id: sessionId, limit: HISTORY_LIMIT });
    void sendCommand({ type: "get_status", session_id: sessionId });
  }

  async function refreshProviderState() {
    await sendCommand({ type: "list_providers" as never });
  }

  async function setProviderSettings(input: {
    provider: string;
    apiKey?: string | null;
    apiBase?: string | null;
    model?: string | null;
    clearApiKey?: boolean | null;
  }) {
    const command: Record<string, unknown> = {
      type: "update_provider" as never,
      provider: input.provider,
      model: input.model,
    };
    if (input.apiKey !== null && input.apiKey !== undefined) {
      command.api_key = input.apiKey;
    }
    if (input.apiBase !== null && input.apiBase !== undefined) {
      command.api_base = input.apiBase;
    }
    if (input.clearApiKey !== null && input.clearApiKey !== undefined) {
      command.clear_api_key = input.clearApiKey;
    }
    return sendCommand(command as unknown as RemoteCommand);
  }

  async function setActiveProvider(input: {
    provider: string;
    model?: string | null;
  }) {
    return sendCommand({
      type: "set_active_provider" as never,
      provider: input.provider,
      model: input.model,
    } as RemoteCommand);
  }

  async function reloadRuntime() {
    return sendCommand({ type: "reload_runtime" as never } as RemoteCommand);
  }

  function syncRemoteSessionCatalogFromList(remoteId: string, items: RemoteSessionItem[]) {
    const sessionIds = items.map((item) => item.sessionId);
    updateRemoteCatalog((current) =>
      syncRemoteSessions(current, remoteId, sessionIds),
    );
  }

  function isDesktopSession(item: RemoteSessionItem): boolean {
    const source = item.source?.trim().toLowerCase();
    if (source === "desktop") {
      return true;
    }
    return item.sessionId.trim().toLowerCase().startsWith("desktop:");
  }

  function pickLatestDesktopSession(items: RemoteSessionItem[]): RemoteSessionItem | null {
    const desktopItems = items.filter(isDesktopSession);
    if (desktopItems.length === 0) {
      return null;
    }
    return [...desktopItems].sort((left, right) => {
      const leftUpdated = left.updatedAtMs ?? 0;
      const rightUpdated = right.updatedAtMs ?? 0;
      if (leftUpdated !== rightUpdated) {
        return rightUpdated - leftUpdated;
      }
      return left.sessionId.localeCompare(right.sessionId);
    })[0] || null;
  }

  function persistProfileForRemote(
    remoteId: string,
    profile: DesktopConnectionProfile,
    remoteName?: string,
  ) {
    persistRemoteCatalog(
      upsertRemoteEntry(remoteCatalogRef.current, {
        id: remoteId,
        name:
          remoteName ||
          remoteCatalogRef.current.remotes.find((entry) => entry.id === remoteId)?.name ||
          "远端",
        profile,
        sessionIds:
          remoteCatalogRef.current.remotes.find((entry) => entry.id === remoteId)?.sessionIds || [],
      }),
    );
  }

  function rememberRecoveredSession(remoteId: string, sessionId: string) {
    const nextProfile = {
      ...state.profile,
      defaultSessionId: sessionId,
      lastBoundSessionId: sessionId,
    };
    saveProfile(nextProfile);
    persistProfileForRemote(remoteId, nextProfile);
    dispatch({ type: "profile/update", profile: nextProfile });
    dispatch({ type: "session/current", sessionId });
    return nextProfile;
  }

  function enterInitialHome(remoteId: string) {
    const nextProfile = {
      ...state.profile,
      defaultSessionId: "",
      lastBoundSessionId: "",
    };
    saveProfile(nextProfile);
    persistProfileForRemote(remoteId, nextProfile);
    dispatch({ type: "profile/update", profile: nextProfile });
    dispatch({ type: "session/current", sessionId: "" });
    dispatch({
      type: "connection/status",
      status: "connected",
      detail: state.connectionDetail || "已连接到当前 remote",
      reason: "idle",
      readyReceived: true,
      bindCompleted: false,
    });
  }

  async function recoverMissingSession(remoteId: string, missingSessionId: string) {
    if (
      sessionRecoveryRef.current &&
      sessionRecoveryRef.current.remoteId === remoteId &&
      sessionRecoveryRef.current.requestedSessionId === missingSessionId &&
      sessionRecoveryRef.current.attempted
    ) {
      return;
    }
    const recoverySessionId = createDesktopSessionId(state.profile.clientId);
    sessionRecoveryRef.current = {
      remoteId,
      requestedSessionId: missingSessionId,
      recoverySessionId,
      attempted: true,
      reason: "missing_session",
    };
    setSessionListState((current) => ({ ...current, creating: true, error: null }));
    const ok = await clientRef.current.send({
      type: "create_session" as never,
      session_id: recoverySessionId,
    } as RemoteCommand);
    if (!ok) {
      setSessionListState((current) => ({
        ...current,
        creating: false,
        error: current.error || "自动恢复会话失败。",
      }));
    }
  }

  async function startFirstMessageSession(content: string) {
    const recoverySessionId = createDesktopSessionId(state.profile.clientId);
    sessionRecoveryRef.current = {
      remoteId: activeRemoteIdRef.current,
      requestedSessionId: null,
      recoverySessionId,
      attempted: true,
      reason: "first_message",
    };
    pendingInitialMessageRef.current = content;
    setComposerPhase("sending");
    setSessionListState((current) => ({ ...current, creating: true, error: null }));
    const ok = await clientRef.current.send({
      type: "create_session" as never,
      session_id: recoverySessionId,
    } as RemoteCommand);
    if (!ok) {
      pendingInitialMessageRef.current = null;
      sessionRecoveryRef.current = null;
      setComposerPhase("idle");
      setSessionListState((current) => ({
        ...current,
        creating: false,
        error: current.error || "新会话创建失败。",
      }));
      dispatch({ type: "error/set", message: "新会话创建失败，未发送消息。" });
    }
  }

  async function requestRemoteSessions(options?: {
    append?: boolean;
    pageToken?: string | null;
  }) {
    const append = options?.append === true;
    const pageToken = options?.pageToken ?? null;
    sessionListRequestModeRef.current = append ? "append" : "replace";
    setSessionListState((current) => ({
      ...current,
      loading: !append,
      loadingMore: append,
      error: null,
    }));
    const ok = await sendCommand({
      type: "list_sessions" as never,
      page_token: pageToken,
      page_size: SESSION_PAGE_SIZE,
      include_archived: false,
    } as RemoteCommand);
    if (!ok) {
      setSessionListState((current) => ({
        ...current,
        loading: false,
        loadingMore: false,
        creating: false,
        deletingSessionId: null,
        error: current.error || "会话列表请求失败。",
      }));
    }
  }

  async function refreshRemoteSessions() {
    await requestRemoteSessions({ append: false, pageToken: null });
  }

  async function loadMoreRemoteSessions() {
    if (!sessionListState.nextPageToken || sessionListState.loadingMore) {
      return;
    }
    await requestRemoteSessions({ append: true, pageToken: sessionListState.nextPageToken });
  }

  function handleSessionProtocolEvent(rawEvent: SessionProtocolEvent, sourceRemoteId: string) {
    if (sourceRemoteId !== activeRemoteIdRef.current) {
      return;
    }

    if (rawEvent.type === "session_list") {
      const incoming = (rawEvent.sessions || []).map((item) => normalizeRemoteSessionItem(item));
      const nextItems =
        sessionListRequestModeRef.current === "append"
          ? mergeRemoteSessionItems(sessionListStateRef.current.items, incoming)
          : incoming;
      if (
        startupSessionScanRef.current &&
        startupSessionScanRef.current.remoteId === sourceRemoteId &&
        startupSessionScanRef.current.awaitingSelection
      ) {
        startupSessionScanRef.current = {
          ...startupSessionScanRef.current,
          awaitingSelection: false,
        };
        const latestDesktopSession = pickLatestDesktopSession(nextItems);
        if (latestDesktopSession) {
          rememberRecoveredSession(sourceRemoteId, latestDesktopSession.sessionId);
          void clientRef.current.send({
            type: "bind_session",
            session_id: latestDesktopSession.sessionId,
          });
        } else {
          enterInitialHome(sourceRemoteId);
        }
      }
      syncRemoteSessionCatalogFromList(sourceRemoteId, nextItems);
      setSessionListState((current) => ({
        ...current,
        items: nextItems,
        nextPageToken:
          typeof rawEvent.next_page_token === "string" && rawEvent.next_page_token.trim().length > 0
            ? rawEvent.next_page_token
            : null,
        totalCount: typeof rawEvent.total_count === "number" ? rawEvent.total_count : current.totalCount,
        loading: false,
        loadingMore: false,
        initialized: true,
        error: null,
      }));
      return;
    }

    if (rawEvent.type === "session_created") {
      const sessionId =
        typeof rawEvent.session_id === "string" && rawEvent.session_id.trim().length > 0
          ? rawEvent.session_id
          : null;
      if (!sessionId) {
        setSessionListState((current) => ({ ...current, creating: false }));
        return;
      }
      const createdItem = normalizeRemoteSessionItem({
        key: sessionId,
        session_id: sessionId,
        title: rawEvent.title,
        created_at_ms: rawEvent.created_at_ms,
        updated_at_ms: rawEvent.created_at_ms,
        message_count: 0,
        archived: false,
        source: "remote",
      });
      const exists = sessionListStateRef.current.items.some((item) => item.sessionId === sessionId);
      const items = mergeRemoteSessionItems(sessionListStateRef.current.items, [createdItem]);
      syncRemoteSessionCatalogFromList(sourceRemoteId, items);
      setSessionListState((current) => ({
        ...current,
        items,
        totalCount:
          current.totalCount === null
            ? current.totalCount
            : exists
              ? current.totalCount
              : current.totalCount + 1,
        creating: false,
        initialized: true,
        error: null,
      }));
      if (
        sessionRecoveryRef.current &&
        sessionRecoveryRef.current.remoteId === sourceRemoteId &&
        sessionRecoveryRef.current.recoverySessionId === sessionId
      ) {
        rememberRecoveredSession(sourceRemoteId, sessionId);
        void clientRef.current.send({
          type: "bind_session",
          session_id: sessionId,
        });
      }
      return;
    }

    if (rawEvent.type === "session_deleted") {
      const sessionId =
        typeof rawEvent.session_id === "string" && rawEvent.session_id.trim().length > 0
          ? rawEvent.session_id
          : null;
      if (!sessionId) {
        setSessionListState((current) => ({ ...current, deletingSessionId: null }));
        return;
      }
      const removed = sessionListStateRef.current.items.some((item) => item.sessionId === sessionId);
      const items = sessionListStateRef.current.items.filter((item) => item.sessionId !== sessionId);
      syncRemoteSessionCatalogFromList(sourceRemoteId, items);
      setSessionListState((current) => ({
        ...current,
        items,
        totalCount:
          current.totalCount === null
            ? current.totalCount
            : removed
              ? Math.max(0, current.totalCount - 1)
              : current.totalCount,
        deletingSessionId: null,
        error: null,
      }));
      updateRemoteCatalog((current) => unregisterRemoteSession(current, sourceRemoteId, sessionId));
      if (sessionId === state.profile.defaultSessionId || sessionId === state.profile.lastBoundSessionId) {
        const fallbackSessionId = state.currentSessionId === sessionId ? "" : state.currentSessionId;
        if (fallbackSessionId) {
          const nextProfile = {
            ...state.profile,
            defaultSessionId: fallbackSessionId,
            lastBoundSessionId: fallbackSessionId,
          };
          saveProfile(nextProfile);
          persistRemoteCatalog(
            upsertRemoteEntry(remoteCatalogRef.current, {
              id: remoteCatalogRef.current.activeRemoteId,
              name:
                remoteCatalogRef.current.remotes.find((entry) => entry.id === remoteCatalogRef.current.activeRemoteId)?.name || "远端",
              profile: nextProfile,
              sessionIds:
                remoteCatalogRef.current.remotes.find((entry) => entry.id === remoteCatalogRef.current.activeRemoteId)?.sessionIds || [],
            }),
          );
          dispatch({ type: "profile/update", profile: nextProfile });
        }
      }
      return;
    }

    if (rawEvent.type === "error") {
      if (
        rawEvent.command === "bind_session" &&
        rawEvent.code === "session_not_found" &&
        typeof rawEvent.session_id === "string" &&
        rawEvent.session_id.trim().length > 0
      ) {
        void recoverMissingSession(sourceRemoteId, rawEvent.session_id);
      }
      if (rawEvent.command === "list_sessions") {
        setSessionListState((current) => ({
          ...current,
          loading: false,
          loadingMore: false,
          error: typeof rawEvent.message === "string" ? rawEvent.message : "会话列表加载失败。",
        }));
      }
      if (rawEvent.command === "create_session") {
        setSessionListState((current) => ({
          ...current,
          creating: false,
          error: typeof rawEvent.message === "string" ? rawEvent.message : current.error,
        }));
      }
      if (rawEvent.command === "delete_session") {
        setSessionListState((current) => ({
          ...current,
          deletingSessionId: null,
          error: typeof rawEvent.message === "string" ? rawEvent.message : current.error,
        }));
      }
    }
  }

  async function refreshSidebarData() {
    if (!state.ownerReady) {
      dispatch({ type: "sidebar/reset" });
      return;
    }
    await sendCommand({ type: "get_sidebar", session_id: state.currentSessionId });
  }

  function connect(
    profileOverride: DesktopConnectionProfile = state.profile,
    remoteIdOverride = activeRemoteIdRef.current,
  ) {
    autoConnectDoneRef.current = true;
    setComposerPhase("idle");
    console.info("[nomi-desktop] connect requested", {
      remoteId: remoteIdOverride,
      host: profileOverride.host,
      port: profileOverride.port,
      hasToken: Boolean(profileOverride.token),
      clientId: profileOverride.clientId,
      sessionId: profileOverride.defaultSessionId,
    });
    dispatch({
      type: "connection/status",
      status: "connecting",
      detail: "正在建立连接...",
      reason: "idle",
      readyReceived: false,
      bindCompleted: false,
    });
    void clientRef.current.connect(profileOverride, {
      onOpen: () => {
        console.info("[nomi-desktop] websocket opened", {
          remoteId: remoteIdOverride,
          host: profileOverride.host,
          port: profileOverride.port,
        });
      },
      onClose: (error) => {
        if (remoteIdOverride !== activeRemoteIdRef.current) {
          return;
        }
        console.info("[nomi-desktop] websocket closed", {
          remoteId: remoteIdOverride,
          error,
        });
        dispatch({ type: "sidebar/reset" });
        dispatch({
          type: "connection/status",
          status: "disconnected",
          detail: error?.message || "连接已断开",
          reason: error?.kind || "closed",
          readyReceived: false,
          bindCompleted: false,
        });
        void refreshSidebarData();
      },
      onError: (error: RemoteClientError) => {
        if (remoteIdOverride !== activeRemoteIdRef.current) {
          return;
        }
        console.info("[nomi-desktop] websocket error", {
          remoteId: remoteIdOverride,
          error,
        });
        dispatch({ type: "sidebar/reset" });
        dispatch({
          type: "connection/status",
          status: "error",
          detail: error.message,
          reason: error.kind,
          readyReceived: false,
          bindCompleted: false,
        });
      },
      onEvent: (event) => {
        if (remoteIdOverride !== activeRemoteIdRef.current) {
          return;
        }
        if (event.type === "ready" || event.type === "session_bound" || event.type === "error") {
          console.info("[nomi-desktop] remote event", {
            remoteId: remoteIdOverride,
            event,
          });
        }
        if (event.type === "ready") {
          sessionRecoveryRef.current = null;
          startupSessionScanRef.current = {
            remoteId: remoteIdOverride,
            awaitingSelection: true,
          };
          dispatch({
            type: "connection/status",
            status: "connecting",
            detail: `已连接到 ${event.host}:${event.port}`,
            reason: "idle",
            readyReceived: true,
            bindCompleted: false,
          });
          void clientRef.current.send({
            type: "list_sessions" as never,
            page_size: SESSION_PAGE_SIZE,
            include_archived: false,
          } as RemoteCommand);
        }
        if (event.type === "session_bound") {
          startupSessionScanRef.current = null;
          sessionRecoveryRef.current = null;
          const activeSessionId = event.session_id || profileOverride.defaultSessionId;
          rememberSession(activeSessionId, remoteIdOverride);
          void clientRef.current.send({
            type: "load_history",
            session_id: activeSessionId,
            limit: HISTORY_LIMIT,
          });
          void clientRef.current.send({
            type: "get_status",
            session_id: activeSessionId,
          });
          void clientRef.current.send({
            type: "get_sidebar",
            session_id: activeSessionId,
          });
          void clientRef.current.send({
            type: "list_providers" as never,
          } as RemoteCommand);
          if (pendingInitialMessageRef.current) {
            const initialMessage = pendingInitialMessageRef.current;
            pendingInitialMessageRef.current = null;
            void clientRef.current.send({
              type: "send_message",
              session_id: activeSessionId,
              content: initialMessage,
              client_id: state.profile.clientId,
            }).then((ok) => {
              if (!ok) {
                setComposerPhase("idle");
                dispatch({ type: "error/set", message: "消息发送失败，未进入远端会话。" });
                return;
              }
              dispatch({
                type: "message/user",
                sessionId: activeSessionId,
                content: initialMessage,
              });
              setDraftInput("");
              setComposerPhase("idle");
            });
          }
        }
        handleSessionProtocolEvent(event as SessionProtocolEvent, remoteIdOverride);
        dispatch({ type: "event/received", event });
      },
    });
  }

  function disconnect() {
    setComposerPhase("idle");
    void clientRef.current.disconnect();
    dispatch({
      type: "connection/status",
      status: "disconnected",
      detail: "连接已断开",
      reason: "closed",
      readyReceived: false,
      bindCompleted: false,
    });
  }

  async function clearRuntimeState() {
    const blockedMessage = getCommandBlockMessage(state);
    if (blockedMessage) {
      dispatch({ type: "error/set", message: blockedMessage });
      return;
    }
    await sendCommand({
      type: "clear_remote_runtime",
      session_id: state.currentSessionId,
    });
  }

  async function createNewSession(title?: string) {
    if (state.ownerReady && state.sessionState.activeTurn && !state.sessionState.activeTurn.completed) {
      const interrupted = await interruptCurrentTurn();
      if (!interrupted) {
        dispatch({ type: "error/set", message: "当前轮中断失败，未创建新 session。" });
        return;
      }
    }
    const nextSessionId = createDesktopSessionId(state.profile.clientId);
    setSessionListState((current) => ({ ...current, creating: true, error: null }));
    const ok = await sendCommand({
      type: "create_session" as never,
      session_id: nextSessionId,
      title: title?.trim() || undefined,
    } as RemoteCommand);
    if (!ok) {
      setSessionListState((current) => ({
        ...current,
        creating: false,
        error: current.error || "会话创建请求失败。",
      }));
      return;
    }
    await selectSession(nextSessionId);
  }

  async function interruptCurrentTurn() {
    setComposerPhase("interrupting");
    const ok = await sendCommand({ type: "interrupt_turn", session_id: state.currentSessionId });
    if (!ok) {
      setComposerPhase("idle");
      return false;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    setComposerPhase("idle");
    return true;
  }

  async function sendMessage(content: string) {
    const normalized = content.trim();
    if (!normalized) {
      return;
    }
    const canStartFreshSession =
      !state.ownerReady &&
      state.readyReceived &&
      !state.bindCompleted &&
      state.connectionReason === "idle" &&
      state.connectionStatus !== "error";
    if (canStartFreshSession) {
      await startFirstMessageSession(normalized);
      return;
    }
    const blockedMessage = getCommandBlockMessage(state);
    if (blockedMessage) {
      setComposerPhase("idle");
      dispatch({ type: "error/set", message: blockedMessage });
      return;
    }
    if (state.sessionState.activeTurn && !state.sessionState.activeTurn.completed) {
      const interrupted = await interruptCurrentTurn();
      if (!interrupted) {
        dispatch({ type: "error/set", message: "当前轮中断失败，未发送新消息。" });
        return;
      }
    }
    setComposerPhase("sending");
    const ok = await sendCommand({
      type: "send_message",
      session_id: state.currentSessionId,
      content: normalized,
      client_id: state.profile.clientId,
    });
    if (!ok) {
      setComposerPhase("idle");
      dispatch({ type: "error/set", message: "消息发送失败，未进入远端会话。" });
      return;
    }
    dispatch({
      type: "message/user",
      sessionId: state.currentSessionId,
      content: normalized,
    });
    setDraftInput("");
    setComposerPhase("idle");
  }

  const actions: DesktopActions = {
    connect,
    disconnect,
    interruptCurrentTurn: async () => {
      await interruptCurrentTurn();
    },
    clearRuntimeState,
    createNewSession,
    refreshSidebar: refreshSidebarData,
    sendResourceCommand: sendCommand,
    uploadSkillZip: async (file) => {
      try {
        return await uploadRemoteSkillZip(state.profile, file);
      } catch (error) {
        dispatch({
          type: "error/set",
          message: `Skill 上传失败：${String(error)}`,
        });
        return null;
      }
    },
    sendMainMessage: async () => sendMessage(draftInput),
    setDraftInput,
  };
  const shellActions = {
    ...actions,
    refreshRemoteSessions,
    loadMoreRemoteSessions,
    deleteRemoteSession: async (sessionId: string) => {
      if (sessionId === state.currentSessionId) {
        setSessionListState((current) => ({
          ...current,
          error: "当前正在绑定的会话不能删除。",
        }));
        return;
      }
      setSessionListState((current) => ({
        ...current,
        deletingSessionId: sessionId,
        error: null,
      }));
      const ok = await sendCommand({
        type: "delete_session" as never,
        session_id: sessionId,
      } as RemoteCommand);
      if (!ok) {
        setSessionListState((current) => ({
          ...current,
          deletingSessionId: null,
          error: current.error || "会话删除请求失败。",
        }));
      }
    },
    refreshProviderState,
    setProviderSettings,
    setActiveProvider,
    reloadRuntime,
  };

  async function activateRemote(remoteId: string) {
    const target = remoteCatalogRef.current.remotes.find((entry) => entry.id === remoteId);
    if (!target) {
      return null;
    }
    const nextCatalog = {
      ...remoteCatalogRef.current,
      activeRemoteId: remoteId,
    };
    persistRemoteCatalog(nextCatalog);
    dispatch({ type: "profile/update", profile: target.profile });
    dispatch({ type: "session/current", sessionId: target.profile.defaultSessionId });
    dispatch({ type: "sidebar/reset" });
    dispatch({ type: "error/set", message: null });
    return target;
  }

  async function selectRemote(remoteId: string) {
    const target = await activateRemote(remoteId);
    if (!target) {
      return;
    }
    await clientRef.current.disconnect();
    if (hasConnectableProfile(target.profile)) {
      connect(target.profile, remoteId);
    } else {
      dispatch({
        type: "connection/status",
        status: "disconnected",
        detail: "连接已断开",
        reason: "closed",
        readyReceived: false,
        bindCompleted: false,
      });
    }
  }

  async function connectRemote(remoteId: string) {
    await selectRemote(remoteId);
  }

  function disconnectRemote() {
    disconnect();
  }

  async function reconnectRemote(remoteId: string) {
    const target = await activateRemote(remoteId);
    if (!target) {
      return;
    }
    await clientRef.current.disconnect();
    if (hasConnectableProfile(target.profile)) {
      connect(target.profile, remoteId);
      return;
    }
    dispatch({
      type: "connection/status",
      status: "disconnected",
      detail: "连接已断开",
      reason: "closed",
      readyReceived: false,
      bindCompleted: false,
    });
  }

  async function selectSession(sessionId: string) {
    const trimmedSessionId = sessionId.trim();
    if (!trimmedSessionId || trimmedSessionId === state.currentSessionId) {
      return;
    }
    const nextProfile = {
      ...state.profile,
      defaultSessionId: trimmedSessionId,
      lastBoundSessionId: trimmedSessionId,
    };
    const nextCatalog = registerRemoteSession(
      upsertRemoteEntry(remoteCatalog, {
        id: remoteCatalog.activeRemoteId,
        name:
          remoteCatalog.remotes.find((entry) => entry.id === remoteCatalog.activeRemoteId)?.name || "远端",
        profile: nextProfile,
        sessionIds:
          remoteCatalog.remotes.find((entry) => entry.id === remoteCatalog.activeRemoteId)?.sessionIds || [],
      }),
      remoteCatalog.activeRemoteId,
      trimmedSessionId,
    );
    persistRemoteCatalog(nextCatalog);
    dispatch({ type: "profile/update", profile: nextProfile });
    dispatch({ type: "session/current", sessionId: trimmedSessionId });
    dispatch({ type: "sidebar/reset" });
    dispatch({ type: "error/set", message: null });
    if (state.ownerReady) {
      await sendCommand({ type: "bind_session", session_id: trimmedSessionId });
      fetchBoundSessionState(trimmedSessionId);
    }
  }

  function saveRemoteEntryDraft(entry: {
    id?: string;
    name: string;
    host: string;
    port: string;
    token: string;
  }) {
    const existing = entry.id
      ? remoteCatalog.remotes.find((item) => item.id === entry.id)
      : null;
    const profile: DesktopConnectionProfile = existing
      ? {
          ...existing.profile,
          host: entry.host.trim(),
          port: entry.port.trim(),
          token: entry.token,
        }
      : {
          host: entry.host.trim(),
          port: entry.port.trim(),
          token: entry.token,
          clientId: createStableClientId(),
          defaultSessionId: "",
          lastBoundSessionId: "",
          themePreference: state.profile.themePreference,
          accentColor: state.profile.accentColor || DEFAULT_ACCENT_COLOR,
        };
    const nextProfile =
      existing && existing.profile.clientId
        ? profile
        : {
            ...profile,
            clientId: profile.clientId || state.profile.clientId,
            defaultSessionId: profile.defaultSessionId || `desktop:${profile.clientId || state.profile.clientId}`,
            lastBoundSessionId:
              profile.lastBoundSessionId ||
              profile.defaultSessionId ||
              `desktop:${profile.clientId || state.profile.clientId}`,
          };
    let nextCatalog = upsertRemoteEntry(remoteCatalog, {
      id: entry.id,
      name: entry.name,
      profile: nextProfile,
    });
    if (existing && existing.id !== remoteCatalog.activeRemoteId) {
      nextCatalog = {
        ...nextCatalog,
        activeRemoteId: remoteCatalog.activeRemoteId,
      };
    }
    persistRemoteCatalog(nextCatalog);
    const activatesRemote = !existing || existing.id === remoteCatalog.activeRemoteId;
    if (activatesRemote) {
      dispatch({ type: "profile/update", profile: nextProfile });
      dispatch({ type: "session/current", sessionId: nextProfile.defaultSessionId });
      dispatch({ type: "sidebar/reset" });
      void clientRef.current.disconnect().then(() => {
        if (hasConnectableProfile(nextProfile)) {
          connect(nextProfile, nextCatalog.activeRemoteId);
          return;
        }
        dispatch({
          type: "connection/status",
          status: "disconnected",
          detail: "连接已断开",
          reason: "closed",
          readyReceived: false,
          bindCompleted: false,
        });
      });
    }
  }

  async function deleteRemote(remoteId: string) {
    const removedActive = remoteCatalogRef.current.activeRemoteId === remoteId;
    const nextCatalog = deleteRemoteEntry(remoteCatalogRef.current, remoteId);
    persistRemoteCatalog(nextCatalog);
    const nextActive = nextCatalog.remotes.find((entry) => entry.id === nextCatalog.activeRemoteId)!;
    dispatch({ type: "profile/update", profile: nextActive.profile });
    dispatch({ type: "session/current", sessionId: nextActive.profile.defaultSessionId });
    dispatch({ type: "sidebar/reset" });
    if (removedActive) {
      await clientRef.current.disconnect();
      if (hasConnectableProfile(nextActive.profile)) {
        connect(nextActive.profile, nextActive.id);
      } else {
        dispatch({
          type: "connection/status",
          status: "disconnected",
          detail: "连接已断开",
          reason: "closed",
          readyReceived: false,
          bindCompleted: false,
        });
      }
    }
  }

  return (
    <MainShell
      state={state}
      actions={shellActions}
      draftInput={draftInput}
      composerPhase={composerPhase}
      sidebarCollapsed={sidebarCollapsed}
      toggleSidebar={() => setSidebarCollapsed((current) => !current)}
      updateProfile={updateProfile}
      previewThemePreference={previewThemePreference}
      setPreviewThemePreference={setPreviewThemePreference}
      remoteEntries={remoteCatalog.remotes}
      activeRemoteId={remoteCatalog.activeRemoteId}
      sessionListState={sessionListState}
      connectRemote={(remoteId) => void connectRemote(remoteId)}
      reconnectRemote={(remoteId) => void reconnectRemote(remoteId)}
      disconnectRemote={disconnectRemote}
      selectSession={(sessionId) => void selectSession(sessionId)}
      saveRemote={saveRemoteEntryDraft}
      deleteRemote={(remoteId) => void deleteRemote(remoteId)}
    />
  );
}
