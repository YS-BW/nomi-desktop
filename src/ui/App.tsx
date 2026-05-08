import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import {
  applyRemoteDefaults,
  deleteRemoteEntry,
  loadRemoteCatalog,
  loadDesktopSidebarData,
  saveProfile,
  saveRemoteCatalog,
  upsertRemoteEntry,
  uploadRemoteSkillZip,
  type DesktopRemoteCatalog,
} from "../lib/store";
import type {
  ConnectionProfile,
  DesktopActions,
  RemoteClientError,
  RemoteCommand,
  ThemePreference,
} from "../lib/types";
import { createDesktopSessionId, createStableClientId } from "../lib/ids";
import { createInitialDesktopState, desktopReducer } from "../state/reducer";
import { RemoteClient } from "../transport/remoteClient";
import { MainShell } from "./MainShell";

const HISTORY_LIMIT = 100;

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

function applyDocumentTheme(theme: ResolvedTheme) {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  delete document.documentElement.dataset.windowKind;
  delete document.body.dataset.windowKind;
}

function hasConnectableProfile(profile: ConnectionProfile): boolean {
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
  const clientRef = useRef(new RemoteClient());
  const autoConnectDoneRef = useRef(false);
  const resolvedTheme = useResolvedTheme(previewThemePreference ?? state.profile.themePreference);

  useEffect(() => {
    applyDocumentTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    return () => {
      void clientRef.current.disconnect();
    };
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
    void refreshSidebarData();
  }, []);

  useEffect(() => {
    if (autoConnectDoneRef.current) {
      return;
    }
    if (!hasConnectableProfile(state.profile)) {
      return;
    }
    autoConnectDoneRef.current = true;
    connect();
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
      if (
        latestEvent.action.startsWith("skill_") ||
        latestEvent.action.startsWith("mcp_") ||
        latestEvent.action.startsWith("task_") ||
        latestEvent.action === "clear_remote_runtime"
      ) {
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
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [state.connectionStatus, state.currentSessionId]);

  function persistRemoteCatalog(nextCatalog: DesktopRemoteCatalog) {
    setRemoteCatalog(nextCatalog);
    saveRemoteCatalog(nextCatalog);
  }

  function updateProfile(patch: Partial<ConnectionProfile>) {
    const nextProfile = {
      ...state.profile,
      ...patch,
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

  async function refreshSidebarData() {
    if (state.ownerReady) {
      await sendCommand({ type: "get_sidebar", session_id: state.currentSessionId });
      return;
    }
    try {
      const data = await loadDesktopSidebarData();
      dispatch({ type: "sidebar/data", data });
    } catch {
      return;
    }
  }

  function connect(profileOverride: ConnectionProfile = state.profile) {
    autoConnectDoneRef.current = true;
    setComposerPhase("idle");
    dispatch({
      type: "connection/status",
      status: "connecting",
      detail: "正在建立连接...",
      reason: "idle",
      readyReceived: false,
      bindCompleted: false,
    });
    void clientRef.current.connect(profileOverride, {
      onOpen: () => {},
      onClose: (error) => {
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
        if (event.type === "ready") {
          const activeSessionId = profileOverride.defaultSessionId;
          dispatch({
            type: "connection/status",
            status: "connecting",
            detail: `已连接到 ${event.host}:${event.port}`,
            reason: "idle",
            readyReceived: true,
            bindCompleted: false,
          });
          void clientRef.current.send({
            type: "bind_session",
            session_id: activeSessionId,
          });
        }
        if (event.type === "session_bound") {
          const activeSessionId = event.session_id || profileOverride.defaultSessionId;
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
        }
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

  async function createNewSession() {
    if (state.ownerReady && state.sessionState.activeTurn && !state.sessionState.activeTurn.completed) {
      const interrupted = await interruptCurrentTurn();
      if (!interrupted) {
        dispatch({ type: "error/set", message: "当前轮中断失败，未创建新 session。" });
        return;
      }
    }

    const nextSessionId = createDesktopSessionId(state.profile.clientId);
    const nextProfile = {
      ...state.profile,
      defaultSessionId: nextSessionId,
      lastBoundSessionId: nextSessionId,
    };
    saveProfile(nextProfile);
    setRemoteCatalog(loadRemoteCatalog());
    dispatch({ type: "profile/update", profile: nextProfile });
    dispatch({ type: "session/current", sessionId: nextSessionId });
    dispatch({ type: "error/set", message: null });

    if (state.ownerReady) {
      await sendCommand({ type: "bind_session", session_id: nextSessionId });
      fetchBoundSessionState(nextSessionId);
    }
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

  async function selectRemote(remoteId: string) {
    const target = remoteCatalog.remotes.find((entry) => entry.id === remoteId);
    if (!target) {
      return;
    }
    const nextCatalog = {
      ...remoteCatalog,
      activeRemoteId: remoteId,
    };
    persistRemoteCatalog(nextCatalog);
    dispatch({ type: "profile/update", profile: target.profile });
    dispatch({ type: "session/current", sessionId: target.profile.defaultSessionId });
    dispatch({ type: "error/set", message: null });
    if (hasConnectableProfile(target.profile)) {
      await clientRef.current.disconnect();
      connect(target.profile);
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
    const profile: ConnectionProfile = existing
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
      if (hasConnectableProfile(nextProfile)) {
        void clientRef.current.disconnect().then(() => {
          connect(nextProfile);
        });
      }
    }
  }

  async function deleteRemote(remoteId: string) {
    const removedActive = remoteCatalog.activeRemoteId === remoteId;
    const nextCatalog = deleteRemoteEntry(remoteCatalog, remoteId);
    persistRemoteCatalog(nextCatalog);
    const nextActive = nextCatalog.remotes.find((entry) => entry.id === nextCatalog.activeRemoteId)!;
    dispatch({ type: "profile/update", profile: nextActive.profile });
    dispatch({ type: "session/current", sessionId: nextActive.profile.defaultSessionId });
    if (removedActive && hasConnectableProfile(nextActive.profile)) {
      await clientRef.current.disconnect();
      connect(nextActive.profile);
    }
  }

  return (
    <MainShell
      state={state}
      actions={actions}
      draftInput={draftInput}
      composerPhase={composerPhase}
      sidebarCollapsed={sidebarCollapsed}
      toggleSidebar={() => setSidebarCollapsed((current) => !current)}
      updateProfile={updateProfile}
      previewThemePreference={previewThemePreference}
      setPreviewThemePreference={setPreviewThemePreference}
      remoteEntries={remoteCatalog.remotes}
      activeRemoteId={remoteCatalog.activeRemoteId}
      selectRemote={(remoteId) => void selectRemote(remoteId)}
      saveRemote={saveRemoteEntryDraft}
      deleteRemote={(remoteId) => void deleteRemote(remoteId)}
    />
  );
}
