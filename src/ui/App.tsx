import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import {
  applyRemoteDefaults,
  deleteRemoteEntry,
  loadRemoteCatalog,
  registerRemoteSession,
  saveProfile,
  saveRemoteCatalog,
  syncRemoteSessions,
  unregisterRemoteSession,
  uploadRemoteSkillZip,
  upsertRemoteEntry,
  type DesktopRemoteCatalog,
} from "../lib/store";
import {
  createEmptyRemoteSessionListState,
  mergeRemoteSessionItems,
  normalizeRemoteSessionItem,
  type RemoteSessionItem,
} from "../lib/remoteSessions";
import type {
  BootstrapResponse,
  ConnectionReason,
  DesktopActions,
  DesktopConnectionProfile,
  RemoteClientError,
  SseEventEnvelope,
  TaskSchedule,
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
import { createInitialDesktopState, desktopReducer, type DesktopAppState } from "../state/reducer";
import { RemoteApiError, RemoteClient } from "../transport/remoteClient";
import { MainShell } from "./MainShell";

const HISTORY_LIMIT = 100;
const SESSION_PAGE_SIZE = 100;

export interface RemoteRuntimeState {
  connectionStatus: "disconnected" | "connecting" | "connected" | "error";
  connectionDetail: string;
  connectionReason: ConnectionReason;
  bootstrapLoaded: boolean;
  eventsConnected: boolean;
  errorText: string | null;
  unreadCount: number;
  lastActivityAt: number | null;
  lastNotificationSessionId: string | null;
  lastNotificationMessage: string | null;
}

export type RemoteRuntimeById = Record<string, RemoteRuntimeState>;

const DISCONNECTED_REMOTE_RUNTIME: RemoteRuntimeState = {
  connectionStatus: "disconnected",
  connectionDetail: "连接已断开",
  connectionReason: "closed",
  bootstrapLoaded: false,
  eventsConnected: false,
  errorText: null,
  unreadCount: 0,
  lastActivityAt: null,
  lastNotificationSessionId: null,
  lastNotificationMessage: null,
};

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
      setSystemTheme(event ? (event.matches ? "dark" : "light") : mediaQuery.matches ? "dark" : "light");
    };
    updateTheme();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateTheme);
      return () => mediaQuery.removeEventListener("change", updateTheme);
    }
    mediaQuery.addListener(updateTheme);
    return () => mediaQuery.removeListener(updateTheme);
  }, []);

  return preference === "light" || preference === "dark" ? preference : systemTheme;
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

function formatRemoteError(error: unknown, fallback: string): string {
  if (error instanceof RemoteApiError) {
    return error.message || fallback;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function isDesktopSession(item: RemoteSessionItem): boolean {
  const source = item.source?.trim().toLowerCase();
  return source === "desktop" || item.sessionId.trim().toLowerCase().startsWith("desktop:");
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

function normalizeSessions(items: Array<Record<string, unknown>>): RemoteSessionItem[] {
  return items.map((item) => normalizeRemoteSessionItem(item));
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRemoteEventSessionId(event: SseEventEnvelope): string | null {
  const data = (event.data || {}) as Record<string, unknown>;
  const direct = readString(data.session_id);
  if (direct) {
    return direct;
  }
  const session = data.session && typeof data.session === "object"
    ? (data.session as Record<string, unknown>)
    : null;
  return readString(session?.session_id) || readString(session?.key);
}

function readRemoteEventMessageSummary(event: SseEventEnvelope): string | null {
  const data = (event.data || {}) as Record<string, unknown>;
  const message = data.message && typeof data.message === "object"
    ? (data.message as Record<string, unknown>)
    : null;
  const content = readString(message?.content);
  if (!content) {
    return null;
  }
  return content.length > 42 ? `${content.slice(0, 42)}...` : content;
}

function createRemoteRuntime(patch?: Partial<RemoteRuntimeState>): RemoteRuntimeState {
  return {
    ...DISCONNECTED_REMOTE_RUNTIME,
    ...patch,
  };
}

function remoteRuntimeFromAppState(state: DesktopAppState): RemoteRuntimeState {
  return createRemoteRuntime({
    connectionStatus: state.connectionStatus,
    connectionDetail: state.connectionDetail,
    connectionReason: state.connectionReason,
    bootstrapLoaded: state.bootstrapLoaded,
    eventsConnected: state.eventsConnected,
    errorText: state.errorText,
  });
}

export function App() {
  const initialRemoteCatalog = useMemo(() => loadRemoteCatalog(), []);
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
  const [remoteRuntimeById, setRemoteRuntimeById] = useState<RemoteRuntimeById>(() => ({
    [initialRemoteCatalog.activeRemoteId]: remoteRuntimeFromAppState(
      createInitialDesktopState(initialProfile),
    ),
  }));
  const clientByRemoteIdRef = useRef(new Map<string, RemoteClient>());
  const autoConnectDoneRef = useRef(false);
  const remoteCatalogRef = useRef(initialRemoteCatalog);
  const activeRemoteIdRef = useRef(initialRemoteCatalog.activeRemoteId);
  const remoteRuntimeByIdRef = useRef(remoteRuntimeById);
  const stateRef = useRef(state);
  const sessionListStateRef = useRef(sessionListState);
  const sessionListRequestModeRef = useRef<"replace" | "append">("replace");
  const resyncInFlightRef = useRef(false);
  const resolvedTheme = useResolvedTheme(previewThemePreference ?? state.profile.themePreference);

  useEffect(() => {
    remoteCatalogRef.current = remoteCatalog;
    activeRemoteIdRef.current = remoteCatalog.activeRemoteId;
  }, [remoteCatalog]);

  useEffect(() => {
    stateRef.current = state;
    setRemoteRuntimeById((current) => ({
      ...current,
      [activeRemoteIdRef.current]: {
        ...(current[activeRemoteIdRef.current] || createRemoteRuntime()),
        ...remoteRuntimeFromAppState(state),
      },
    }));
  }, [state]);

  useEffect(() => {
    remoteRuntimeByIdRef.current = remoteRuntimeById;
  }, [remoteRuntimeById]);

  useEffect(() => {
    sessionListStateRef.current = sessionListState;
  }, [sessionListState]);

  useEffect(() => {
    applyDocumentTheme(resolvedTheme, state.profile.accentColor || DEFAULT_ACCENT_COLOR);
  }, [resolvedTheme, state.profile.accentColor]);

  useEffect(() => () => {
    for (const client of clientByRemoteIdRef.current.values()) {
      void client.disconnect();
    }
    clientByRemoteIdRef.current.clear();
  }, []);

  useEffect(() => {
    void applyRemoteDefaults(state.profile).then((nextProfile) => {
      if (JSON.stringify(nextProfile) === JSON.stringify(state.profile)) {
        return;
      }
      saveProfile(nextProfile);
      const nextCatalog = loadRemoteCatalog();
      setRemoteCatalog(nextCatalog);
      remoteCatalogRef.current = nextCatalog;
      dispatch({ type: "profile/update", profile: nextProfile });
      window.setTimeout(() => connectAllRemotes(), 0);
    });
  }, []);

  useEffect(() => {
    if (autoConnectDoneRef.current) {
      return;
    }
    autoConnectDoneRef.current = true;
    connectAllRemotes();
  }, []);

  useEffect(() => {
    setSessionListState(createEmptyRemoteSessionListState());
  }, [remoteCatalog.activeRemoteId]);

  useEffect(() => {
    const handleFocus = () => {
      if (state.bootstrapLoaded) {
        void refreshSidebarData();
        void refreshRemoteSessions();
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [state.bootstrapLoaded, state.currentSessionId]);

  useEffect(() => {
    if (!state.needsResync || resyncInFlightRef.current) {
      return;
    }
    resyncInFlightRef.current = true;
    void resyncRemoteState().finally(() => {
      resyncInFlightRef.current = false;
    });
  }, [state.needsResync, state.currentSessionId]);

  function persistRemoteCatalog(nextCatalog: DesktopRemoteCatalog) {
    remoteCatalogRef.current = nextCatalog;
    setRemoteCatalog(nextCatalog);
    saveRemoteCatalog(nextCatalog);
    setRemoteRuntimeById((current) => {
      const next: RemoteRuntimeById = {};
      for (const entry of nextCatalog.remotes) {
        next[entry.id] = current[entry.id] || createRemoteRuntime();
      }
      return next;
    });
  }

  function updateRemoteCatalog(transform: (current: DesktopRemoteCatalog) => DesktopRemoteCatalog) {
    const nextCatalog = transform(remoteCatalogRef.current);
    persistRemoteCatalog(nextCatalog);
    return nextCatalog;
  }

  function persistProfileForRemote(remoteId: string, profile: DesktopConnectionProfile, remoteName?: string) {
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

  function updateProfile(patch: Partial<DesktopConnectionProfile>) {
    const nextProfile = {
      ...state.profile,
      ...patch,
      accentColor: normalizeAccentColor(patch.accentColor || state.profile.accentColor || DEFAULT_ACCENT_COLOR),
    };
    const activeRemoteId = activeRemoteIdRef.current;
    persistRemoteCatalog(upsertRemoteEntry(remoteCatalogRef.current, {
      id: activeRemoteId,
      name:
        remoteCatalogRef.current.remotes.find((entry) => entry.id === activeRemoteId)?.name || "远端",
      profile: nextProfile,
    }));
    dispatch({ type: "profile/update", profile: nextProfile });
  }

  function rememberSession(sessionId: string, remoteId = activeRemoteIdRef.current) {
    const trimmedSessionId = sessionId.trim();
    if (!trimmedSessionId) {
      return;
    }
    const activeEntry = remoteCatalogRef.current.remotes.find((entry) => entry.id === remoteId);
    const nextProfile = activeEntry
      ? {
          ...activeEntry.profile,
          defaultSessionId: trimmedSessionId,
          lastBoundSessionId: trimmedSessionId,
        }
      : {
          ...state.profile,
          defaultSessionId: trimmedSessionId,
          lastBoundSessionId: trimmedSessionId,
        };
    saveProfile(nextProfile);
    persistRemoteCatalog(
      registerRemoteSession(
        upsertRemoteEntry(remoteCatalogRef.current, {
          id: remoteId,
          name: activeEntry?.name || "远端",
          profile: nextProfile,
          sessionIds: activeEntry?.sessionIds || [],
        }),
        remoteId,
        trimmedSessionId,
      ),
    );
    if (remoteId === activeRemoteIdRef.current) {
      dispatch({ type: "profile/update", profile: nextProfile });
    }
  }

  function syncRemoteSessionCatalogFromList(remoteId: string, items: RemoteSessionItem[]) {
    updateRemoteCatalog((current) =>
      syncRemoteSessions(current, remoteId, items.map((item) => item.sessionId)),
    );
  }

  function enterInitialHome(remoteId: string) {
    const activeEntry = remoteCatalogRef.current.remotes.find((entry) => entry.id === remoteId);
    const nextProfile = {
      ...(activeEntry?.profile || state.profile),
      defaultSessionId: "",
      lastBoundSessionId: "",
    };
    saveProfile(nextProfile);
    persistProfileForRemote(remoteId, nextProfile, activeEntry?.name);
    dispatch({ type: "profile/update", profile: nextProfile });
    dispatch({ type: "session/current", sessionId: "" });
  }

  function clearPendingSessionWork() {
    setComposerPhase("idle");
    setSessionListState((current) => ({
      ...current,
      loading: false,
      loadingMore: false,
      creating: false,
      pendingCreatedSessionId: null,
      bindingSessionId: null,
      deletingSessionId: null,
    }));
  }

  function getRemoteClient(remoteId: string): RemoteClient {
    const existing = clientByRemoteIdRef.current.get(remoteId);
    if (existing) {
      return existing;
    }
    const client = new RemoteClient();
    clientByRemoteIdRef.current.set(remoteId, client);
    return client;
  }

  function getActiveClient(): RemoteClient {
    return getRemoteClient(activeRemoteIdRef.current);
  }

  function updateRemoteRuntime(remoteId: string, patch: Partial<RemoteRuntimeState>) {
    setRemoteRuntimeById((current) => {
      const next = {
        ...current,
        [remoteId]: {
          ...(current[remoteId] || createRemoteRuntime()),
          ...patch,
        },
      };
      remoteRuntimeByIdRef.current = next;
      return next;
    });
  }

  function markRemoteActivity(remoteId: string, event: SseEventEnvelope) {
    setRemoteRuntimeById((current) => {
      const previous = current[remoteId] || createRemoteRuntime();
      const shouldIncrementUnread =
        remoteId !== activeRemoteIdRef.current &&
        (event.type === "session.message_appended" || event.type === "session.updated");
      const sessionId = shouldIncrementUnread ? readRemoteEventSessionId(event) : null;
      const messageSummary = shouldIncrementUnread ? readRemoteEventMessageSummary(event) : null;
      const next = {
        ...current,
        [remoteId]: {
          ...previous,
          lastActivityAt: Date.now(),
          unreadCount: shouldIncrementUnread ? previous.unreadCount + 1 : previous.unreadCount,
          lastNotificationSessionId: sessionId || previous.lastNotificationSessionId,
          lastNotificationMessage: messageSummary || previous.lastNotificationMessage,
        },
      };
      remoteRuntimeByIdRef.current = next;
      return next;
    });
  }

  async function loadSessionMessages(sessionId: string) {
    const response = await getActiveClient().loadMessages(sessionId, { limit: HISTORY_LIMIT });
    dispatch({ type: "messages/loaded", response });
    rememberSession(sessionId);
    return response;
  }

  async function initializeSessionFromItems(items: RemoteSessionItem[], remoteId: string) {
    const latestDesktopSession = pickLatestDesktopSession(items);
    if (!latestDesktopSession) {
      enterInitialHome(remoteId);
      return;
    }
    dispatch({ type: "session/current", sessionId: latestDesktopSession.sessionId });
    try {
      await loadSessionMessages(latestDesktopSession.sessionId);
    } catch (error) {
      enterInitialHome(remoteId);
      dispatch({ type: "error/set", message: formatRemoteError(error, "会话消息加载失败。") });
    }
  }

  function updateSessionListFromItems(items: RemoteSessionItem[], options?: {
    append?: boolean;
    nextPageToken?: string | null;
    totalCount?: number | null;
  }) {
    const nextItems = options?.append
      ? mergeRemoteSessionItems(sessionListStateRef.current.items, items)
      : items;
    syncRemoteSessionCatalogFromList(activeRemoteIdRef.current, nextItems);
    setSessionListState((current) => ({
      ...current,
      items: nextItems,
      nextPageToken: options?.nextPageToken ?? null,
      totalCount: options?.totalCount ?? nextItems.length,
      loading: false,
      loadingMore: false,
      initialized: true,
      error: null,
    }));
  }

  async function requestRemoteSessions(options?: { append?: boolean; pageToken?: string | null }) {
    const append = options?.append === true;
    sessionListRequestModeRef.current = append ? "append" : "replace";
    setSessionListState((current) => ({
      ...current,
      loading: !append,
      loadingMore: append,
      error: null,
    }));
    try {
      const response = await getActiveClient().listSessions({
        pageToken: options?.pageToken ?? null,
        pageSize: SESSION_PAGE_SIZE,
        includeArchived: false,
      });
      const items = normalizeSessions(response.sessions as unknown as Array<Record<string, unknown>>);
      updateSessionListFromItems(items, {
        append,
        nextPageToken: response.page.next_page_token || null,
        totalCount: response.page.total_count ?? items.length,
      });
    } catch (error) {
      setSessionListState((current) => ({
        ...current,
        loading: false,
        loadingMore: false,
        creating: false,
        bindingSessionId: null,
        deletingSessionId: null,
        error: formatRemoteError(error, "会话列表请求失败。"),
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

  async function refreshSidebarData() {
    if (!state.bootstrapLoaded) {
      dispatch({ type: "sidebar/reset" });
      return;
    }
    try {
      dispatch({ type: "sidebar/data", data: await getActiveClient().getSidebar() });
    } catch (error) {
      dispatch({ type: "error/set", message: formatRemoteError(error, "Sidebar 刷新失败。") });
    }
  }

  async function refreshProviderState() {
    try {
      const response = await getActiveClient().listProviders();
      dispatch({ type: "provider/listLoaded", providerState: response.provider_list });
      return true;
    } catch (error) {
      dispatch({ type: "error/set", message: formatRemoteError(error, "Provider 列表刷新失败。") });
      return false;
    }
  }

  async function setProviderSettings(input: {
    provider: string;
    apiKey?: string | null;
    apiBase?: string | null;
    model?: string | null;
    clearApiKey?: boolean | null;
    tokenPlanApiKey?: string | null;
    clearTokenPlanApiKey?: boolean | null;
  }) {
    try {
      const response = await getActiveClient().updateProvider(input.provider, {
        ...(input.apiKey !== undefined ? { api_key: input.apiKey } : {}),
        ...(input.apiBase !== undefined ? { api_base: input.apiBase } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.clearApiKey !== undefined ? { clear_api_key: input.clearApiKey } : {}),
        ...(input.tokenPlanApiKey !== undefined ? { token_plan_api_key: input.tokenPlanApiKey } : {}),
        ...(input.clearTokenPlanApiKey !== undefined
          ? { clear_token_plan_api_key: input.clearTokenPlanApiKey }
          : {}),
      });
      if (state.providerState) {
        dispatch({
          type: "provider/stateLoaded",
          providerState: {
            ...state.providerState,
            providers: state.providerState.providers.some((item) => item.provider === response.settings.provider)
              ? state.providerState.providers.map((item) =>
                  item.provider === response.settings.provider ? { ...item, ...response.settings } : item,
                )
              : [...state.providerState.providers, response.settings],
          },
        });
      }
      return true;
    } catch (error) {
      dispatch({ type: "error/set", message: formatRemoteError(error, "Provider 设置保存失败。") });
      return false;
    }
  }

  async function setActiveProvider(input: { provider: string; model?: string | null }) {
    try {
      const response = await getActiveClient().setActiveProvider({
        provider: input.provider,
        model: input.model,
      });
      if (state.providerState) {
        dispatch({
          type: "provider/stateLoaded",
          providerState: {
            ...state.providerState,
            active: response.active,
          },
        });
      }
      return true;
    } catch (error) {
      dispatch({ type: "error/set", message: formatRemoteError(error, "当前模型切换失败。") });
      return false;
    }
  }

  async function reloadRuntime() {
    try {
      const response = await getActiveClient().reloadRuntime();
      dispatch({ type: "provider/stateLoaded", providerState: response.provider_state });
      return true;
    } catch (error) {
      dispatch({ type: "error/set", message: formatRemoteError(error, "Runtime reload 失败。") });
      return false;
    }
  }

  async function resyncRemoteState() {
    try {
      const bootstrap = await getActiveClient().bootstrap();
      dispatch({
        type: "bootstrap/loaded",
        bootstrap,
        host: state.profile.host,
        port: state.profile.port,
      });
      const items = normalizeSessions(bootstrap.sessions as unknown as Array<Record<string, unknown>>);
      updateSessionListFromItems(items);
      if (state.currentSessionId) {
        await loadSessionMessages(state.currentSessionId);
      } else {
        await initializeSessionFromItems(items, activeRemoteIdRef.current);
      }
      dispatch({ type: "resync/handled" });
    } catch (error) {
      dispatch({ type: "error/set", message: formatRemoteError(error, "Remote resync 失败。") });
    }
  }

  async function loadActiveRemoteSnapshot(remoteId: string, profile: DesktopConnectionProfile) {
    try {
      const bootstrap = await getRemoteClient(remoteId).bootstrap();
      if (remoteId !== activeRemoteIdRef.current) {
        return;
      }
      dispatch({
        type: "bootstrap/loaded",
        bootstrap,
        host: profile.host,
        port: profile.port,
      });
      const items = normalizeSessions(bootstrap.sessions as unknown as Array<Record<string, unknown>>);
      updateSessionListFromItems(items);
      await initializeSessionFromItems(items, remoteId);
    } catch (error) {
      if (remoteId !== activeRemoteIdRef.current) {
        return;
      }
      dispatch({ type: "error/set", message: formatRemoteError(error, "远端状态加载失败。") });
    }
  }

  function handleSseEvent(remoteId: string, event: SseEventEnvelope) {
    markRemoteActivity(remoteId, event);
    if (remoteId !== activeRemoteIdRef.current) {
      return;
    }
    dispatch({ type: "sse/received", event });
    const data = (event.data || {}) as Record<string, unknown>;
    if (event.type === "session.created" || event.type === "session.updated") {
      const session = data.session && typeof data.session === "object"
        ? normalizeRemoteSessionItem(data.session as Record<string, unknown>)
        : null;
      if (session) {
        const items = mergeRemoteSessionItems(sessionListStateRef.current.items, [session]);
        syncRemoteSessionCatalogFromList(activeRemoteIdRef.current, items);
        setSessionListState((current) => ({
          ...current,
          items,
          totalCount: current.totalCount === null ? items.length : Math.max(current.totalCount, items.length),
          creating:
            current.pendingCreatedSessionId === session.sessionId ? false : current.creating,
          pendingCreatedSessionId:
            current.pendingCreatedSessionId === session.sessionId ? null : current.pendingCreatedSessionId,
          initialized: true,
          error: null,
        }));
      }
    }
    if (event.type === "session.deleted") {
      const sessionId = typeof data.session_id === "string" ? data.session_id : null;
      if (sessionId) {
        const removed = sessionListStateRef.current.items.some((item) => item.sessionId === sessionId);
        const items = sessionListStateRef.current.items.filter((item) => item.sessionId !== sessionId);
        syncRemoteSessionCatalogFromList(activeRemoteIdRef.current, items);
        updateRemoteCatalog((current) => unregisterRemoteSession(current, activeRemoteIdRef.current, sessionId));
        setSessionListState((current) => ({
          ...current,
          items,
          totalCount:
            current.totalCount === null
              ? items.length
              : removed
                ? Math.max(0, current.totalCount - 1)
                : current.totalCount,
          deletingSessionId: current.deletingSessionId === sessionId ? null : current.deletingSessionId,
          error: null,
        }));
      }
    }
    if (
      event.type === "sidebar.invalidated" ||
      event.type === "task.created" ||
      event.type === "task.updated" ||
      event.type === "task.deleted" ||
      event.type === "skill.installed" ||
      event.type === "skill.uninstalled" ||
      event.type === "mcp.created" ||
      event.type === "mcp.updated" ||
      event.type === "mcp.deleted" ||
      event.type === "mcp.enabled" ||
      event.type === "mcp.disabled"
    ) {
      void refreshSidebarData();
    }
  }

  function connect(profileOverride: DesktopConnectionProfile = state.profile, remoteIdOverride = activeRemoteIdRef.current) {
    autoConnectDoneRef.current = true;
    setComposerPhase("idle");
    updateRemoteRuntime(remoteIdOverride, {
      connectionStatus: "connecting",
      connectionDetail: "正在建立连接...",
      connectionReason: "idle",
      bootstrapLoaded: false,
      eventsConnected: false,
      errorText: null,
    });
    if (remoteIdOverride === activeRemoteIdRef.current) {
      dispatch({
        type: "connection/status",
        status: "connecting",
        detail: "正在建立连接...",
        reason: "idle",
        bootstrapLoaded: false,
        eventsConnected: false,
      });
    }
    void getRemoteClient(remoteIdOverride).connect(profileOverride, {
      onBootstrap: (bootstrap) => {
        updateRemoteRuntime(remoteIdOverride, {
          connectionStatus: "connected",
          connectionDetail: `已连接到 ${profileOverride.host}:${profileOverride.port}`,
          connectionReason: "idle",
          bootstrapLoaded: true,
          errorText: null,
        });
        if (remoteIdOverride !== activeRemoteIdRef.current) {
          return;
        }
        dispatch({
          type: "bootstrap/loaded",
          bootstrap,
          host: profileOverride.host,
          port: profileOverride.port,
        });
        const items = normalizeSessions(bootstrap.sessions as unknown as Array<Record<string, unknown>>);
        updateSessionListFromItems(items);
        void initializeSessionFromItems(items, remoteIdOverride);
      },
      onOpen: () => {
        updateRemoteRuntime(remoteIdOverride, {
          connectionStatus: "connected",
          connectionReason: "idle",
          eventsConnected: true,
          errorText: null,
        });
        if (remoteIdOverride === activeRemoteIdRef.current) {
          dispatch({ type: "events/connected", connected: true });
        }
      },
      onClose: (error) => {
        updateRemoteRuntime(remoteIdOverride, {
          connectionStatus: "disconnected",
          connectionDetail: error?.message || "连接已断开",
          connectionReason: error?.kind || "closed",
          bootstrapLoaded: false,
          eventsConnected: false,
          errorText: error?.message || null,
        });
        if (remoteIdOverride !== activeRemoteIdRef.current) {
          return;
        }
        dispatch({ type: "sidebar/reset" });
        dispatch({
          type: "connection/status",
          status: "disconnected",
          detail: error?.message || "连接已断开",
          reason: error?.kind || "closed",
          bootstrapLoaded: false,
          eventsConnected: false,
        });
      },
      onError: (error: RemoteClientError) => {
        updateRemoteRuntime(remoteIdOverride, {
          connectionStatus: "error",
          connectionDetail: error.message,
          connectionReason: error.kind,
          bootstrapLoaded: false,
          eventsConnected: false,
          errorText: error.message,
        });
        if (remoteIdOverride !== activeRemoteIdRef.current) {
          return;
        }
        if (state.bootstrapLoaded && error.kind === "transport_error") {
          dispatch({ type: "events/connected", connected: false });
          return;
        }
        dispatch({ type: "sidebar/reset" });
        dispatch({
          type: "connection/status",
          status: "error",
          detail: error.message,
          reason: error.kind,
          bootstrapLoaded: false,
          eventsConnected: false,
        });
      },
      onEvent: (event) => {
        handleSseEvent(remoteIdOverride, event);
      },
    });
  }

  function connectAllRemotes() {
    for (const entry of remoteCatalogRef.current.remotes) {
      if (!hasConnectableProfile(entry.profile)) {
        updateRemoteRuntime(entry.id, createRemoteRuntime());
        continue;
      }
      const runtime = remoteRuntimeByIdRef.current[entry.id];
      if (runtime?.connectionStatus === "connected" || runtime?.connectionStatus === "connecting") {
        continue;
      }
      connect(entry.profile, entry.id);
    }
  }

  function disconnect() {
    clearPendingSessionWork();
    const remoteId = activeRemoteIdRef.current;
    void getRemoteClient(remoteId).disconnect();
    updateRemoteRuntime(remoteId, createRemoteRuntime());
    dispatch({
      type: "connection/status",
      status: "disconnected",
      detail: "连接已断开",
      reason: "closed",
      bootstrapLoaded: false,
      eventsConnected: false,
    });
  }

  async function clearRuntimeState() {
    if (!state.bootstrapLoaded) {
      dispatch({ type: "error/set", message: "当前未连接 remote。" });
      return;
    }
    try {
      await getActiveClient().clearRemoteState();
      dispatch({ type: "thread/clear" });
      await refreshSidebarData();
    } catch (error) {
      dispatch({ type: "error/set", message: formatRemoteError(error, "清空远端运行态失败。") });
    }
  }

  async function createNewSession(title?: string) {
    if (!state.bootstrapLoaded) {
      dispatch({ type: "error/set", message: "当前未连接 remote。" });
      return;
    }
    const nextSessionId = createDesktopSessionId(state.profile.clientId);
    setSessionListState((current) => ({
      ...current,
      creating: true,
      pendingCreatedSessionId: nextSessionId,
      bindingSessionId: nextSessionId,
      error: null,
    }));
    try {
      const response = await getActiveClient().createSession({
        session_id: nextSessionId,
        title: title?.trim() || undefined,
      });
      const item = normalizeRemoteSessionItem(response.session as unknown as Record<string, unknown>);
      const items = mergeRemoteSessionItems(sessionListStateRef.current.items, [item]);
      updateSessionListFromItems(items);
      dispatch({ type: "session/current", sessionId: item.sessionId });
      rememberSession(item.sessionId);
      await loadSessionMessages(item.sessionId);
      setSessionListState((current) => ({
        ...current,
        creating: false,
        pendingCreatedSessionId: null,
        bindingSessionId: null,
        error: null,
      }));
    } catch (error) {
      setSessionListState((current) => ({
        ...current,
        creating: false,
        pendingCreatedSessionId: null,
        bindingSessionId: null,
        error: formatRemoteError(error, "会话创建请求失败。"),
      }));
    }
  }

  async function interruptCurrentTurn() {
    if (!state.currentSessionId) {
      return false;
    }
    setComposerPhase("interrupting");
    try {
      await getActiveClient().interruptTurn(state.currentSessionId);
      return true;
    } catch (error) {
      dispatch({ type: "error/set", message: formatRemoteError(error, "当前轮中断失败。") });
      return false;
    } finally {
      setComposerPhase("idle");
    }
  }

  async function sendMessage(content: string) {
    const normalized = content.trim();
    if (!normalized) {
      return;
    }
    if (!state.bootstrapLoaded) {
      dispatch({ type: "error/set", message: "当前未连接 remote。" });
      return;
    }
    let sessionId = state.currentSessionId;
    setComposerPhase("sending");
    try {
      if (!sessionId) {
        const nextSessionId = createDesktopSessionId(state.profile.clientId);
        setSessionListState((current) => ({
          ...current,
          creating: true,
          pendingCreatedSessionId: nextSessionId,
          bindingSessionId: nextSessionId,
          error: null,
        }));
        const response = await getActiveClient().createSession({ session_id: nextSessionId });
        const item = normalizeRemoteSessionItem(response.session as unknown as Record<string, unknown>);
        sessionId = item.sessionId;
        const items = mergeRemoteSessionItems(sessionListStateRef.current.items, [item]);
        updateSessionListFromItems(items);
        dispatch({ type: "session/current", sessionId });
        rememberSession(sessionId);
        setSessionListState((current) => ({
          ...current,
          creating: false,
          pendingCreatedSessionId: null,
          bindingSessionId: null,
          error: null,
        }));
      }
      dispatch({ type: "message/pendingUser", sessionId, content: normalized });
      setDraftInput("");
      await getActiveClient().createTurn(sessionId, {
        content: normalized,
        client_id: state.profile.clientId,
        metadata: { source: "desktop" },
      });
    } catch (error) {
      dispatch({ type: "error/set", message: formatRemoteError(error, "消息发送失败，未进入远端会话。") });
      setSessionListState((current) => ({
        ...current,
        creating: false,
        pendingCreatedSessionId: null,
        bindingSessionId: null,
      }));
    } finally {
      setComposerPhase("idle");
    }
  }

  async function selectSession(sessionId: string) {
    const trimmedSessionId = sessionId.trim();
    if (!trimmedSessionId || trimmedSessionId === state.currentSessionId) {
      return;
    }
    setSessionListState((current) => ({
      ...current,
      bindingSessionId: trimmedSessionId,
      error: null,
    }));
    try {
      dispatch({ type: "session/current", sessionId: trimmedSessionId });
      await loadSessionMessages(trimmedSessionId);
      await refreshSidebarData();
      setSessionListState((current) => ({
        ...current,
        bindingSessionId: null,
        error: null,
      }));
    } catch (error) {
      setSessionListState((current) => ({
        ...current,
        bindingSessionId:
          current.bindingSessionId === trimmedSessionId ? null : current.bindingSessionId,
        error: formatRemoteError(error, "会话切换失败。"),
      }));
    }
  }

  async function deleteRemoteSession(sessionId: string) {
    if (sessionId === state.currentSessionId) {
      setSessionListState((current) => ({
        ...current,
        error: "请先切换到其他会话，再删除当前会话。",
      }));
      return;
    }
    setSessionListState((current) => ({
      ...current,
      deletingSessionId: sessionId,
      error: null,
    }));
    try {
      await getActiveClient().deleteSession(sessionId);
      const items = sessionListStateRef.current.items.filter((item) => item.sessionId !== sessionId);
      updateSessionListFromItems(items);
      updateRemoteCatalog((current) => unregisterRemoteSession(current, activeRemoteIdRef.current, sessionId));
      setSessionListState((current) => ({
        ...current,
        deletingSessionId: null,
        error: null,
      }));
    } catch (error) {
      setSessionListState((current) => ({
        ...current,
        deletingSessionId: null,
        error: formatRemoteError(error, "会话删除请求失败。"),
      }));
    }
  }

  function saveRemoteEntryDraft(entry: {
    id?: string;
    name: string;
    host: string;
    port: string;
    token: string;
  }) {
    const currentCatalog = remoteCatalogRef.current;
    const existing = entry.id
      ? currentCatalog.remotes.find((item) => item.id === entry.id)
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
    const nextCatalog = upsertRemoteEntry(currentCatalog, {
      id: entry.id,
      name: entry.name,
      profile,
      activate: !existing,
    });
    const activatesRemote = !existing || existing.id === currentCatalog.activeRemoteId;
    persistRemoteCatalog(nextCatalog);
    if (activatesRemote) {
      void getRemoteClient(entry.id || profile.clientId).disconnect();
      dispatch({ type: "profile/update", profile });
      dispatch({ type: "session/current", sessionId: "" });
      dispatch({ type: "sidebar/reset" });
      void Promise.resolve().then(() => {
        if (hasConnectableProfile(profile)) {
          connect(profile, nextCatalog.activeRemoteId);
          return;
        }
        dispatch({
          type: "connection/status",
          status: "disconnected",
          detail: "连接已断开",
          reason: "closed",
          bootstrapLoaded: false,
          eventsConnected: false,
        });
      });
    } else if (hasConnectableProfile(profile)) {
      void getRemoteClient(entry.id || profile.clientId).disconnect().then(() => {
        connect(profile, entry.id || profile.clientId);
      });
    }
  }

  async function activateRemote(remoteId: string) {
    const target = remoteCatalogRef.current.remotes.find((entry) => entry.id === remoteId);
    if (!target) {
      return null;
    }
    clearPendingSessionWork();
    persistRemoteCatalog({
      ...remoteCatalogRef.current,
      activeRemoteId: remoteId,
    });
    dispatch({ type: "profile/update", profile: target.profile });
    dispatch({ type: "session/current", sessionId: "" });
    dispatch({ type: "sidebar/reset" });
    dispatch({ type: "error/set", message: null });
    updateRemoteRuntime(remoteId, {
      unreadCount: 0,
      lastNotificationSessionId: null,
      lastNotificationMessage: null,
    });
    const runtime = remoteRuntimeByIdRef.current[remoteId] || createRemoteRuntime();
    dispatch({
      type: "connection/status",
      status: runtime.connectionStatus,
      detail: runtime.connectionDetail,
      reason: runtime.connectionReason,
      bootstrapLoaded: runtime.bootstrapLoaded,
      eventsConnected: runtime.eventsConnected,
    });
    return target;
  }

  async function selectRemote(remoteId: string) {
    const target = await activateRemote(remoteId);
    if (!target) {
      return;
    }
    if (hasConnectableProfile(target.profile)) {
      const runtime = remoteRuntimeByIdRef.current[remoteId];
      if (runtime?.connectionStatus === "connected" || getRemoteClient(remoteId).isConnected()) {
        await loadActiveRemoteSnapshot(remoteId, target.profile);
      } else {
        connect(target.profile, remoteId);
      }
    } else {
      dispatch({
        type: "connection/status",
        status: "disconnected",
        detail: "连接已断开",
        reason: "closed",
        bootstrapLoaded: false,
        eventsConnected: false,
      });
    }
  }

  async function selectRemoteSession(remoteId: string, sessionId: string) {
    const target = await activateRemote(remoteId);
    if (!target) {
      return;
    }
    if (hasConnectableProfile(target.profile)) {
      const runtime = remoteRuntimeByIdRef.current[remoteId];
      if (runtime?.connectionStatus === "connected" || getRemoteClient(remoteId).isConnected()) {
        await loadActiveRemoteSnapshot(remoteId, target.profile);
      } else {
        connect(target.profile, remoteId);
      }
    }
    if (sessionId.trim()) {
      await selectSession(sessionId);
    }
  }

  async function connectRemote(remoteId: string) {
    const target = await activateRemote(remoteId);
    if (!target) {
      return;
    }
    if (hasConnectableProfile(target.profile)) {
      connect(target.profile, remoteId);
      return;
    }
    dispatch({
      type: "connection/status",
      status: "disconnected",
      detail: "连接已断开",
      reason: "closed",
      bootstrapLoaded: false,
      eventsConnected: false,
    });
  }

  function disconnectRemote(remoteId = activeRemoteIdRef.current) {
    if (remoteId === activeRemoteIdRef.current) {
      disconnect();
      return;
    }
    void getRemoteClient(remoteId).disconnect();
    updateRemoteRuntime(remoteId, createRemoteRuntime());
  }

  async function reconnectRemote(remoteId: string) {
    const target = await activateRemote(remoteId);
    if (!target) {
      return;
    }
    await getRemoteClient(remoteId).disconnect();
    if (hasConnectableProfile(target.profile)) {
      connect(target.profile, remoteId);
      return;
    }
    dispatch({
      type: "connection/status",
      status: "disconnected",
      detail: "连接已断开",
      reason: "closed",
      bootstrapLoaded: false,
      eventsConnected: false,
    });
  }

  async function deleteRemote(remoteId: string) {
    clearPendingSessionWork();
    const removedActive = remoteCatalogRef.current.activeRemoteId === remoteId;
    await getRemoteClient(remoteId).disconnect();
    clientByRemoteIdRef.current.delete(remoteId);
    const nextCatalog = deleteRemoteEntry(remoteCatalogRef.current, remoteId);
    persistRemoteCatalog(nextCatalog);
    const nextActive = nextCatalog.remotes.find((entry) => entry.id === nextCatalog.activeRemoteId)!;
    dispatch({ type: "profile/update", profile: nextActive.profile });
    dispatch({ type: "session/current", sessionId: "" });
    dispatch({ type: "sidebar/reset" });
    if (removedActive) {
      if (hasConnectableProfile(nextActive.profile)) {
        connect(nextActive.profile, nextActive.id);
      } else {
        dispatch({
          type: "connection/status",
          status: "disconnected",
          detail: "连接已断开",
          reason: "closed",
          bootstrapLoaded: false,
          eventsConnected: false,
        });
      }
    }
  }

  async function actionWithSidebarRefresh(fn: () => Promise<unknown>, fallback: string): Promise<boolean> {
    if (!state.bootstrapLoaded) {
      dispatch({ type: "error/set", message: "当前未连接 remote。" });
      return false;
    }
    try {
      await fn();
      await refreshSidebarData();
      return true;
    } catch (error) {
      dispatch({ type: "error/set", message: formatRemoteError(error, fallback) });
      return false;
    }
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
    createTask: (input) =>
      actionWithSidebarRefresh(
        () =>
          getActiveClient().createTask({
            instruction: input.instruction,
            schedule: input.schedule,
            source_session_key: input.sourceSessionKey,
            target_channels: input.targetChannels || [],
          }),
        "任务创建失败。",
      ),
    updateTask: (taskId, input) =>
      actionWithSidebarRefresh(
        () =>
          getActiveClient().updateTask(taskId, {
            instruction: input.instruction,
            schedule: input.schedule,
            target_channels: input.targetChannels,
          }),
        "任务更新失败。",
      ),
    deleteTask: (taskId) =>
      actionWithSidebarRefresh(() => getActiveClient().deleteTask(taskId), "任务删除失败。"),
    enableTask: (taskId) =>
      actionWithSidebarRefresh(() => getActiveClient().enableTask(taskId), "任务启用失败。"),
    disableTask: (taskId) =>
      actionWithSidebarRefresh(() => getActiveClient().disableTask(taskId), "任务停用失败。"),
    installSkill: (input) =>
      actionWithSidebarRefresh(
        () =>
          getActiveClient().installSkill({
            source: input.source || undefined,
            upload_token: input.uploadToken || undefined,
          }),
        "Skill 安装失败。",
      ),
    uninstallSkill: (name) =>
      actionWithSidebarRefresh(() => getActiveClient().uninstallSkill(name), "Skill 卸载失败。"),
    createMcp: (input) =>
      actionWithSidebarRefresh(() => getActiveClient().createMcp({ mcp: input.mcp }), "MCP 创建失败。"),
    updateMcp: (name, input) =>
      actionWithSidebarRefresh(() => getActiveClient().updateMcp(name, { mcp: input.mcp }), "MCP 更新失败。"),
    deleteMcp: (name) =>
      actionWithSidebarRefresh(() => getActiveClient().deleteMcp(name), "MCP 删除失败。"),
    enableMcp: (name) =>
      actionWithSidebarRefresh(() => getActiveClient().enableMcp(name), "MCP 启用失败。"),
    disableMcp: (name) =>
      actionWithSidebarRefresh(() => getActiveClient().disableMcp(name), "MCP 停用失败。"),
    uploadSkillZip: async (file) => {
      try {
        return await uploadRemoteSkillZip(state.profile, file);
      } catch (error) {
        dispatch({ type: "error/set", message: `Skill 上传失败：${String(error)}` });
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
    deleteRemoteSession,
    refreshProviderState,
    setProviderSettings,
    setActiveProvider,
    reloadRuntime,
  };

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
      remoteRuntimeById={remoteRuntimeById}
      sessionListState={sessionListState}
      connectRemote={(remoteId) => void connectRemote(remoteId)}
      reconnectRemote={(remoteId) => void reconnectRemote(remoteId)}
      disconnectRemote={disconnectRemote}
      selectSession={(sessionId) => void selectSession(sessionId)}
      selectRemoteSession={(remoteId, sessionId) => void selectRemoteSession(remoteId, sessionId)}
      saveRemote={saveRemoteEntryDraft}
      deleteRemote={(remoteId) => void deleteRemote(remoteId)}
      clearGlobalError={() => dispatch({ type: "error/set", message: null })}
    />
  );
}
