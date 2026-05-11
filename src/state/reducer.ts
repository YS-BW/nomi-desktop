import { createMessageId } from "../lib/ids";
import type {
  ActiveTurn,
  ConnectionReason,
  DesktopConnectionProfile,
  DesktopSidebarData,
  DesktopSessionState,
  MessageItem,
  ProviderCatalog,
  ProviderStateItem,
  ProviderStateSnapshot,
  RemoteEvent,
} from "../lib/types";

export interface DesktopAppState {
  connectionStatus: "disconnected" | "connecting" | "connected" | "error";
  connectionDetail: string;
  connectionReason: ConnectionReason;
  ownerReady: boolean;
  readyReceived: boolean;
  bindCompleted: boolean;
  profile: DesktopConnectionProfile;
  currentSessionId: string;
  sessionState: DesktopSessionState;
  providerCatalog: ProviderCatalog | null;
  providerState: ProviderStateSnapshot | null;
  sidebar: DesktopSidebarData;
  sidebarReady: boolean;
  eventLog: RemoteEvent[];
  errorText: string | null;
}

export type DesktopAction =
  | { type: "profile/update"; profile: DesktopConnectionProfile }
  | {
      type: "connection/status";
      status: DesktopAppState["connectionStatus"];
      detail: string;
      reason?: ConnectionReason;
      readyReceived?: boolean;
      bindCompleted?: boolean;
    }
  | { type: "session/current"; sessionId: string }
  | { type: "sidebar/data"; data: DesktopSidebarData }
  | { type: "sidebar/reset" }
  | { type: "message/user"; sessionId: string; content: string }
  | { type: "event/received"; event: RemoteEvent }
  | { type: "error/set"; message: string | null };

function createSessionState(sessionId: string): DesktopSessionState {
  return {
    sessionId,
    messages: [],
    activeTurn: null,
    lastStatus: null,
    isBound: false,
  };
}

function createSidebarState(): DesktopSidebarData {
  return {
    tasks: [],
    skills: [],
    mcpServers: [],
  };
}

function deriveOwnerReady(readyReceived: boolean, bindCompleted: boolean): boolean {
  return readyReceived && bindCompleted;
}

export function createInitialDesktopState(profile: DesktopConnectionProfile): DesktopAppState {
  const sessionId = profile.defaultSessionId;
  return {
    connectionStatus: "disconnected",
    connectionDetail: "连接已断开",
    connectionReason: "idle",
    ownerReady: false,
    readyReceived: false,
    bindCompleted: false,
    profile,
    currentSessionId: sessionId,
    sessionState: createSessionState(sessionId),
    providerCatalog: null,
    providerState: null,
    sidebar: createSidebarState(),
    sidebarReady: false,
    eventLog: [],
    errorText: null,
  };
}

function ensureActiveTurn(sessionState: DesktopSessionState, sessionId: string): ActiveTurn {
  if (!sessionState.activeTurn || sessionState.activeTurn.sessionId !== sessionId) {
    sessionState.activeTurn = {
      sessionId,
      draftText: "",
      hasStream: false,
      completed: false,
      stopReason: null,
      messageId: null,
    };
  }
  return sessionState.activeTurn;
}

function ensureDraftMessage(sessionState: DesktopSessionState, sessionId: string): MessageItem {
  const activeTurn = ensureActiveTurn(sessionState, sessionId);
  if (activeTurn.messageId) {
    return sessionState.messages.find((item) => item.id === activeTurn.messageId)!;
  }
  const message: MessageItem = {
    id: createMessageId("assistant"),
    kind: "assistant",
    role: "assistant",
    content: "",
    sessionId,
    status: "streaming",
  };
  sessionState.messages.push(message);
  activeTurn.messageId = message.id;
  return message;
}

function appendEventLog(state: DesktopAppState, event: RemoteEvent): void {
  state.eventLog = [event, ...state.eventLog].slice(0, 30);
}

function mergeProviderItem(
  current: ProviderStateItem,
  patch: ProviderStateItem,
): ProviderStateItem {
  return {
    ...current,
    ...patch,
  };
}

function isMessageKind(value: unknown): value is MessageItem["kind"] {
  return (
    value === "user" ||
    value === "assistant" ||
    value === "progress" ||
    value === "task" ||
    value === "system"
  );
}

function isMessageStatus(value: unknown): value is MessageItem["status"] {
  return (
    value === "history" ||
    value === "sent" ||
    value === "streaming" ||
    value === "completed" ||
    value === "interrupted" ||
    value === "task_delivered" ||
    value === "error"
  );
}

function hasToolCalls(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function formatToolCallHint(message: Record<string, unknown>): string | null {
  if (!hasToolCalls(message.tool_calls)) {
    return null;
  }
  const toolNames = (message.tool_calls as Array<Record<string, unknown>>)
    .map((toolCall) => {
      const directName = typeof toolCall.name === "string" ? toolCall.name : null;
      if (directName && directName.trim()) {
        return directName.trim();
      }
      const functionName =
        toolCall.function && typeof toolCall.function === "object"
          ? (toolCall.function as Record<string, unknown>).name
          : null;
      return typeof functionName === "string" && functionName.trim() ? functionName.trim() : null;
    })
    .filter((name): name is string => Boolean(name));
  if (toolNames.length === 0) {
    return "正在调用工具";
  }
  return `正在调用 ${toolNames.join("、")}`;
}

function normalizeHistoryMessage(
  message: Record<string, unknown>,
  sessionId: string,
): MessageItem {
  const rawRole = typeof message.role === "string" ? message.role : "";
  const toolHint = message.tool_hint === true;
  const rawContent = String(message.content || "");
  const trimmedContent = rawContent.trim();
  const toolCallHint = formatToolCallHint(message);
  let kind: MessageItem["kind"] = "system";

  if (isMessageKind(message.kind)) {
    kind = message.kind;
  } else if (rawRole === "tool") {
    kind = "progress";
  } else if (rawRole === "assistant" && toolCallHint && trimmedContent.length === 0) {
    kind = "progress";
  } else if (rawRole === "assistant") {
    kind = "assistant";
  } else if (rawRole === "user") {
    kind = "user";
  } else if (rawRole === "task") {
    kind = "task";
  } else if (rawRole === "progress" || rawRole === "tool_hint" || toolHint) {
    kind = "progress";
  }

  const role =
    kind === "progress" && (rawRole === "tool_hint" || toolHint)
      ? "tool_hint"
      : rawRole || kind;
  const content =
    rawRole === "assistant" && kind === "progress" && toolCallHint
      ? toolCallHint
      : rawContent;

  return {
    id:
      typeof message.id === "string" && message.id.trim().length > 0
        ? message.id
        : createMessageId(role || "history"),
    kind,
    role,
    content,
    sessionId:
      typeof message.session_id === "string" && message.session_id.trim().length > 0
        ? message.session_id
        : sessionId,
    status: isMessageStatus(message.status) ? message.status : "history",
  };
}

function replaceHistory(
  sessionState: DesktopSessionState,
  messages: Array<Record<string, unknown>>,
): void {
  sessionState.messages = messages.map((message) =>
    normalizeHistoryMessage(message, sessionState.sessionId),
  );
  sessionState.activeTurn = null;
}

export function desktopReducer(state: DesktopAppState, action: DesktopAction): DesktopAppState {
  if (action.type === "profile/update") {
    return {
      ...state,
      profile: action.profile,
      providerCatalog: null,
      providerState: null,
      sidebar: createSidebarState(),
      sidebarReady: false,
    };
  }
  if (action.type === "connection/status") {
    const readyReceived = action.readyReceived ?? state.readyReceived;
    const bindCompleted = action.bindCompleted ?? state.bindCompleted;
    const shouldResetSidebar = action.status !== "connected" || !deriveOwnerReady(readyReceived, bindCompleted);
    return {
      ...state,
      connectionStatus: action.status,
      connectionDetail: action.detail,
      connectionReason: action.reason ?? state.connectionReason,
      readyReceived,
      bindCompleted,
      ownerReady: deriveOwnerReady(readyReceived, bindCompleted),
      providerCatalog: action.status === "connected" || readyReceived ? state.providerCatalog : null,
      providerState: action.status === "connected" || readyReceived ? state.providerState : null,
      sidebar: shouldResetSidebar ? createSidebarState() : state.sidebar,
      sidebarReady: shouldResetSidebar ? false : state.sidebarReady,
      errorText: action.status === "error" ? action.detail : null,
    };
  }
  if (action.type === "session/current") {
    return {
      ...state,
      currentSessionId: action.sessionId,
      bindCompleted: false,
      ownerReady: deriveOwnerReady(state.readyReceived, false),
      sessionState: createSessionState(action.sessionId),
      providerCatalog: state.providerCatalog,
      providerState: state.providerState,
      sidebar: createSidebarState(),
      sidebarReady: false,
    };
  }
  if (action.type === "sidebar/data") {
    return {
      ...state,
      sidebar: action.data,
      sidebarReady: true,
    };
  }
  if (action.type === "sidebar/reset") {
    return {
      ...state,
      sidebar: createSidebarState(),
      sidebarReady: false,
    };
  }
  if (action.type === "message/user") {
    const nextSessionState: DesktopSessionState = {
      ...state.sessionState,
      sessionId: action.sessionId,
      messages: [
        ...state.sessionState.messages,
        {
          id: createMessageId("user"),
          kind: "user",
          role: "user",
          content: action.content,
          sessionId: action.sessionId,
          status: "sent",
        },
      ],
      activeTurn: null,
    };
    return {
      ...state,
      sessionState: nextSessionState,
    };
  }
  if (action.type === "error/set") {
    return { ...state, errorText: action.message };
  }
  if (action.type !== "event/received") {
    return state;
  }

  const nextState: DesktopAppState = {
    ...state,
    sessionState: {
      ...state.sessionState,
      messages: [...state.sessionState.messages],
      activeTurn: state.sessionState.activeTurn
        ? { ...state.sessionState.activeTurn }
        : null,
    },
  };
  const { event } = action;
  appendEventLog(nextState, event);

  if (event.session_id && event.session_id !== nextState.sessionState.sessionId) {
    return nextState;
  }

  switch (event.type) {
    case "ready":
      nextState.connectionStatus = "connecting";
      nextState.connectionDetail = `已连接到 ${event.host}:${event.port}`;
      nextState.connectionReason = "idle";
      nextState.readyReceived = true;
      nextState.bindCompleted = false;
      nextState.ownerReady = false;
      nextState.providerCatalog = event.provider_catalog || null;
      nextState.providerState = event.provider_state || null;
      nextState.errorText = null;
      return nextState;
    case "session_bound":
      nextState.sessionState.isBound = true;
      nextState.currentSessionId = event.session_id || nextState.currentSessionId;
      nextState.connectionStatus = "connected";
      nextState.connectionReason = "idle";
      nextState.bindCompleted = true;
      nextState.ownerReady = deriveOwnerReady(nextState.readyReceived, nextState.bindCompleted);
      return nextState;
    case "provider_state_snapshot":
      nextState.providerState = event.provider_state || null;
      return nextState;
    case "provider_list":
      nextState.providerState = event.provider_list || null;
      nextState.errorText = null;
      return nextState;
    case "provider_settings_updated":
    case "provider_updated":
      if (!nextState.providerState || !event.settings?.provider) {
        return nextState;
      }
      if (!nextState.providerState.providers.some((item) => item.provider === event.settings?.provider)) {
        nextState.providerState = {
          ...nextState.providerState,
          providers: [...nextState.providerState.providers, event.settings],
        };
        nextState.errorText = null;
        return nextState;
      }
      nextState.providerState = {
        ...nextState.providerState,
        providers: nextState.providerState.providers.map((item) =>
          item.provider === event.settings?.provider
            ? mergeProviderItem(item, event.settings!)
            : item,
        ),
      };
      nextState.errorText = null;
      return nextState;
    case "active_provider_changed":
      if (!event.active || !nextState.providerState) {
        return nextState;
      }
      nextState.providerState = {
        ...nextState.providerState,
        active: event.active,
        apply_mode: event.apply_mode || nextState.providerState.apply_mode,
      };
      nextState.errorText = null;
      return nextState;
    case "runtime_reloaded":
      if (event.provider_state) {
        nextState.providerState = event.provider_state;
      } else if (nextState.providerState && event.apply_mode) {
        nextState.providerState = {
          ...nextState.providerState,
          apply_mode: event.apply_mode,
        };
      }
      if (event.active && nextState.providerState) {
        nextState.providerState = {
          ...nextState.providerState,
          active: event.active,
        };
      }
      nextState.errorText = null;
      return nextState;
    case "turn_started":
      ensureActiveTurn(nextState.sessionState, event.session_id || nextState.currentSessionId);
      return nextState;
    case "progress":
      nextState.sessionState.messages.push({
        id: createMessageId("progress"),
        kind: "progress",
        role: event.tool_hint ? "tool_hint" : "progress",
        content: String(event.content || ""),
        sessionId: event.session_id || nextState.currentSessionId,
        status: "completed",
      });
      return nextState;
    case "delta": {
      const sessionId = event.session_id || nextState.currentSessionId;
      const draft = ensureDraftMessage(nextState.sessionState, sessionId);
      const activeTurn = ensureActiveTurn(nextState.sessionState, sessionId);
      activeTurn.hasStream = true;
      activeTurn.draftText += String(event.content || "");
      draft.content = activeTurn.draftText;
      draft.status = "streaming";
      return nextState;
    }
    case "message": {
      const sessionId = event.session_id || nextState.currentSessionId;
      const activeTurn = ensureActiveTurn(nextState.sessionState, sessionId);
      if (activeTurn.messageId) {
        const target = nextState.sessionState.messages.find(
          (item) => item.id === activeTurn.messageId,
        );
        if (target) {
          target.content = String(event.content || target.content);
          target.status = "completed";
        }
      } else {
        nextState.sessionState.messages.push({
          id: createMessageId("assistant"),
          kind: "assistant",
          role: "assistant",
          content: String(event.content || ""),
          sessionId,
          status: "completed",
        });
      }
      return nextState;
    }
    case "turn_completed":
      if (nextState.sessionState.activeTurn) {
        nextState.sessionState.activeTurn.completed = true;
        nextState.sessionState.activeTurn.stopReason = String(event.stop_reason || "completed");
        if (nextState.sessionState.activeTurn.messageId) {
          const target = nextState.sessionState.messages.find(
            (item) => item.id === nextState.sessionState.activeTurn?.messageId,
          );
          if (target && target.status === "streaming") {
            target.status = event.stop_reason === "interrupted" ? "interrupted" : "completed";
          }
        }
      }
      return nextState;
    case "interrupt_result":
      nextState.sessionState.lastStatus = event.result || null;
      return nextState;
    case "status_result":
      nextState.sessionState.lastStatus = event.snapshot || null;
      return nextState;
    case "history_snapshot":
      replaceHistory(nextState.sessionState, event.messages || []);
      return nextState;
    case "sidebar_snapshot":
      if (event.sidebar) {
        nextState.sidebar = event.sidebar;
        nextState.sidebarReady = true;
      }
      return nextState;
    case "resource_action_result":
      if (event.ok) {
        nextState.errorText = null;
        if (event.action === "clear_remote_runtime") {
          nextState.sessionState = createSessionState(nextState.currentSessionId);
        }
      } else {
        nextState.errorText = String(event.message || "资源操作失败");
      }
      return nextState;
    case "task_delivered":
      nextState.sessionState.messages.push({
        id: createMessageId("task"),
        kind: "task",
        role: "task",
        content: String(event.content || ""),
        sessionId: event.session_id || nextState.currentSessionId,
        status: "task_delivered",
      });
      return nextState;
    case "error":
      nextState.errorText = String(event.message || "未知错误");
      if (!event.session_id) {
        nextState.connectionStatus = "error";
        nextState.connectionDetail = nextState.errorText;
        if (nextState.connectionReason === "idle") {
          nextState.connectionReason = "unknown";
        }
        nextState.bindCompleted = false;
        nextState.ownerReady = false;
      }
      return nextState;
    default:
      return nextState;
  }
}
