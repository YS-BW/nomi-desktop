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
import { createInitialDesktopState, desktopReducer } from "../state/reducer";
import { RemoteApiError, RemoteClient } from "../transport/remoteClient";
import { MainShell } from "./MainShell";

const HISTORY_LIMIT = 100;
const SESSION_PAGE_SIZE = 100;

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
  const clientRef = useRef(new RemoteClient());
  const autoConnectDoneRef = useRef(false);
  const remoteCatalogRef = useRef(initialRemoteCatalog);
  const activeRemoteIdRef = useRef(initialRemoteCatalog.activeRemoteId);
  const sessionListStateRef = useRef(sessionListState);
  const sessionListRequestModeRef = useRef<"replace" | "append">("replace");
  const resyncInFlightRef = useRef(false);
  const resolvedTheme = useResolvedTheme(previewThemePreference ?? state.profile.themePreference);

  useEffect(() => {
    remoteCatalogRef.current = remoteCatalog;
    activeRemoteIdRef.current = remoteCatalog.activeRemoteId;
  }, [remoteCatalog]);

  useEffect(() => {
    sessionListStateRef.current = sessionListState;
  }, [sessionListState]);

  useEffect(() => {
    applyDocumentTheme(resolvedTheme, state.profile.accentColor || DEFAULT_ACCENT_COLOR);
  }, [resolvedTheme, state.profile.accentColor]);

  useEffect(() => () => {
    void clientRef.current.disconnect();
  }, []);

  useEffect(() => {
    void applyRemoteDefaults(state.profile).then((nextProfile) => {
      if (JSON.stringify(nextProfile) === JSON.stringify(state.profile)) {
        return;
      }
      saveProfile(nextProfile);
      setRemoteCatalog(loadRemoteCatalog());
      dispatch({ type: "profile/update", profile: nextProfile });
    });
  }, []);

  useEffect(() => {
    if (autoConnectDoneRef.current || !hasConnectableProfile(state.profile)) {
      return;
    }
    autoConnectDoneRef.current = true;
    connect(state.profile, activeRemoteIdRef.current);
  }, [state.profile]);

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

  async function loadSessionMessages(sessionId: string) {
    const response = await clientRef.current.loadMessages(sessionId, { limit: HISTORY_LIMIT });
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
      const response = await clientRef.current.listSessions({
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
      dispatch({ type: "sidebar/data", data: await clientRef.current.getSidebar() });
    } catch (error) {
      dispatch({ type: "error/set", message: formatRemoteError(error, "Sidebar 刷新失败。") });
    }
  }

  async function refreshProviderState() {
    try {
      const response = await clientRef.current.listProviders();
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
      const response = await clientRef.current.updateProvider(input.provider, {
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
      const response = await clientRef.current.setActiveProvider({
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
      const response = await clientRef.current.reloadRuntime();
      dispatch({ type: "provider/stateLoaded", providerState: response.provider_state });
      return true;
    } catch (error) {
      dispatch({ type: "error/set", message: formatRemoteError(error, "Runtime reload 失败。") });
      return false;
    }
  }

  async function resyncRemoteState() {
    try {
      const bootstrap = await clientRef.current.bootstrap();
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

  function handleSseEvent(event: SseEventEnvelope) {
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
    dispatch({
      type: "connection/status",
      status: "connecting",
      detail: "正在建立连接...",
      reason: "idle",
      bootstrapLoaded: false,
      eventsConnected: false,
    });
    void clientRef.current.connect(profileOverride, {
      onBootstrap: (bootstrap) => {
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
        if (remoteIdOverride === activeRemoteIdRef.current) {
          dispatch({ type: "events/connected", connected: true });
        }
      },
      onClose: (error) => {
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
        if (remoteIdOverride === activeRemoteIdRef.current) {
          handleSseEvent(event);
        }
      },
    });
  }

  function disconnect() {
    clearPendingSessionWork();
    void clientRef.current.disconnect();
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
      await clientRef.current.clearRemoteState();
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
      const response = await clientRef.current.createSession({
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
      await clientRef.current.interruptTurn(state.currentSessionId);
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
        const response = await clientRef.current.createSession({ session_id: nextSessionId });
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
      await clientRef.current.createTurn(sessionId, {
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
      await clientRef.current.deleteSession(sessionId);
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
      dispatch({ type: "profile/update", profile });
      dispatch({ type: "session/current", sessionId: "" });
      dispatch({ type: "sidebar/reset" });
      void clientRef.current.disconnect().then(() => {
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
        bootstrapLoaded: false,
        eventsConnected: false,
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
      bootstrapLoaded: false,
      eventsConnected: false,
    });
  }

  async function deleteRemote(remoteId: string) {
    clearPendingSessionWork();
    const removedActive = remoteCatalogRef.current.activeRemoteId === remoteId;
    const nextCatalog = deleteRemoteEntry(remoteCatalogRef.current, remoteId);
    persistRemoteCatalog(nextCatalog);
    const nextActive = nextCatalog.remotes.find((entry) => entry.id === nextCatalog.activeRemoteId)!;
    dispatch({ type: "profile/update", profile: nextActive.profile });
    dispatch({ type: "session/current", sessionId: "" });
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
          clientRef.current.createTask({
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
          clientRef.current.updateTask(taskId, {
            instruction: input.instruction,
            schedule: input.schedule,
            target_channels: input.targetChannels,
          }),
        "任务更新失败。",
      ),
    deleteTask: (taskId) =>
      actionWithSidebarRefresh(() => clientRef.current.deleteTask(taskId), "任务删除失败。"),
    enableTask: (taskId) =>
      actionWithSidebarRefresh(() => clientRef.current.enableTask(taskId), "任务启用失败。"),
    disableTask: (taskId) =>
      actionWithSidebarRefresh(() => clientRef.current.disableTask(taskId), "任务停用失败。"),
    installSkill: (input) =>
      actionWithSidebarRefresh(
        () =>
          clientRef.current.installSkill({
            source: input.source || undefined,
            upload_token: input.uploadToken || undefined,
          }),
        "Skill 安装失败。",
      ),
    uninstallSkill: (name) =>
      actionWithSidebarRefresh(() => clientRef.current.uninstallSkill(name), "Skill 卸载失败。"),
    createMcp: (input) =>
      actionWithSidebarRefresh(() => clientRef.current.createMcp({ mcp: input.mcp }), "MCP 创建失败。"),
    updateMcp: (name, input) =>
      actionWithSidebarRefresh(() => clientRef.current.updateMcp(name, { mcp: input.mcp }), "MCP 更新失败。"),
    deleteMcp: (name) =>
      actionWithSidebarRefresh(() => clientRef.current.deleteMcp(name), "MCP 删除失败。"),
    enableMcp: (name) =>
      actionWithSidebarRefresh(() => clientRef.current.enableMcp(name), "MCP 启用失败。"),
    disableMcp: (name) =>
      actionWithSidebarRefresh(() => clientRef.current.disableMcp(name), "MCP 停用失败。"),
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
      sessionListState={sessionListState}
      connectRemote={(remoteId) => void connectRemote(remoteId)}
      reconnectRemote={(remoteId) => void reconnectRemote(remoteId)}
      disconnectRemote={disconnectRemote}
      selectSession={(sessionId) => void selectSession(sessionId)}
      saveRemote={saveRemoteEntryDraft}
      deleteRemote={(remoteId) => void deleteRemote(remoteId)}
      clearGlobalError={() => dispatch({ type: "error/set", message: null })}
    />
  );
}
