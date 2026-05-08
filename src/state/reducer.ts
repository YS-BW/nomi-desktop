import { createMessageId } from "../lib/ids";
import type {
  ActiveTurn,
  ConnectionReason,
  ConnectionProfile,
  DesktopSidebarData,
  DesktopSessionState,
  MessageItem,
  RemoteEvent,
} from "../lib/types";

export interface DesktopAppState {
  connectionStatus: "disconnected" | "connecting" | "connected" | "error";
  connectionDetail: string;
  connectionReason: ConnectionReason;
  ownerReady: boolean;
  readyReceived: boolean;
  bindCompleted: boolean;
  profile: ConnectionProfile;
  currentSessionId: string;
  sessionState: DesktopSessionState;
  sidebar: DesktopSidebarData;
  eventLog: RemoteEvent[];
  errorText: string | null;
}

export type DesktopAction =
  | { type: "profile/update"; profile: ConnectionProfile }
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

export function createInitialDesktopState(profile: ConnectionProfile): DesktopAppState {
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
    sidebar: createSidebarState(),
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

function replaceHistory(
  sessionState: DesktopSessionState,
  messages: Array<Record<string, unknown>>,
): void {
  sessionState.messages = messages.map((message) => ({
    id: createMessageId(String(message.role || "history")),
    kind:
      message.role === "assistant"
        ? "assistant"
        : message.role === "user"
          ? "user"
          : "system",
    role: String(message.role || "unknown"),
    content: String(message.content || ""),
    sessionId: sessionState.sessionId,
    status: "history",
  }));
  sessionState.activeTurn = null;
}

export function desktopReducer(state: DesktopAppState, action: DesktopAction): DesktopAppState {
  if (action.type === "profile/update") {
    return { ...state, profile: action.profile };
  }
  if (action.type === "connection/status") {
    const readyReceived = action.readyReceived ?? state.readyReceived;
    const bindCompleted = action.bindCompleted ?? state.bindCompleted;
    return {
      ...state,
      connectionStatus: action.status,
      connectionDetail: action.detail,
      connectionReason: action.reason ?? state.connectionReason,
      readyReceived,
      bindCompleted,
      ownerReady: deriveOwnerReady(readyReceived, bindCompleted),
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
    };
  }
  if (action.type === "sidebar/data") {
    return {
      ...state,
      sidebar: action.data,
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
