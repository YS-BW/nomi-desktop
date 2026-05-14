import { createMessageId } from "../lib/ids";
import type {
  BootstrapResponse,
  ConnectionReason,
  CurrentThreadState,
  DesktopConnectionProfile,
  DesktopSidebarData,
  MessageItem,
  ProviderCatalog,
  ProviderStateItem,
  ProviderStateSnapshot,
  SessionMessage,
  SessionMessagesResponse,
  SseEventEnvelope,
} from "../lib/types";

export interface DesktopAppState {
  connectionStatus: "disconnected" | "connecting" | "connected" | "error";
  connectionDetail: string;
  connectionReason: ConnectionReason;
  bootstrapLoaded: boolean;
  eventsConnected: boolean;
  needsResync: boolean;
  profile: DesktopConnectionProfile;
  currentSessionId: string;
  sessionState: CurrentThreadState;
  providerCatalog: ProviderCatalog | null;
  providerState: ProviderStateSnapshot | null;
  sidebar: DesktopSidebarData;
  sidebarReady: boolean;
  eventLog: SseEventEnvelope[];
  errorText: string | null;
}

export type DesktopAction =
  | { type: "profile/update"; profile: DesktopConnectionProfile }
  | {
      type: "connection/status";
      status: DesktopAppState["connectionStatus"];
      detail: string;
      reason?: ConnectionReason;
      bootstrapLoaded?: boolean;
      eventsConnected?: boolean;
    }
  | { type: "bootstrap/loaded"; bootstrap: BootstrapResponse; host: string; port: string }
  | { type: "events/connected"; connected: boolean }
  | { type: "session/current"; sessionId: string }
  | { type: "messages/loaded"; response: SessionMessagesResponse }
  | { type: "message/pendingUser"; sessionId: string; content: string }
  | { type: "sidebar/data"; data: DesktopSidebarData }
  | { type: "sidebar/reset" }
  | { type: "status/loaded"; status: Record<string, unknown> | null }
  | { type: "provider/listLoaded"; providerCatalog?: ProviderCatalog | null; providerState: ProviderStateSnapshot }
  | { type: "provider/stateLoaded"; providerState: ProviderStateSnapshot }
  | { type: "thread/clear" }
  | { type: "sse/received"; event: SseEventEnvelope }
  | { type: "resync/handled" }
  | { type: "error/set"; message: string | null };

function createSidebarState(): DesktopSidebarData {
  return {
    tasks: [],
    skills: [],
    mcpServers: [],
  };
}

function composeThreadMessages(thread: Omit<CurrentThreadState, "messages">): MessageItem[] {
  const messages: MessageItem[] = [...thread.committedMessages];
  if (thread.pendingUserMessage) {
    messages.push(thread.pendingUserMessage);
  }
  if (thread.streamingDraft) {
    messages.push(...thread.streamingDraft.progress);
    messages.push(thread.streamingDraft);
  }
  return messages;
}

function createThreadState(sessionId: string): CurrentThreadState {
  const base = {
    sessionId,
    committedMessages: [],
    pendingUserMessage: null,
    streamingDraft: null,
    lastStatus: null,
  };
  return {
    ...base,
    messages: composeThreadMessages(base),
  };
}

function withComposedMessages(thread: CurrentThreadState): CurrentThreadState {
  return {
    ...thread,
    messages: composeThreadMessages(thread),
  };
}

export function createInitialDesktopState(profile: DesktopConnectionProfile): DesktopAppState {
  return {
    connectionStatus: "disconnected",
    connectionDetail: "连接已断开",
    connectionReason: "idle",
    bootstrapLoaded: false,
    eventsConnected: false,
    needsResync: false,
    profile,
    currentSessionId: "",
    sessionState: createThreadState(""),
    providerCatalog: null,
    providerState: null,
    sidebar: createSidebarState(),
    sidebarReady: false,
    eventLog: [],
    errorText: null,
  };
}

function appendEventLog(state: DesktopAppState, event: SseEventEnvelope): void {
  state.eventLog = [event, ...state.eventLog].slice(0, 30);
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
      if (directName?.trim()) {
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

function normalizeSessionMessage(
  message: SessionMessage | Record<string, unknown>,
  sessionId: string,
  options?: { id?: string; status?: MessageItem["status"] },
): MessageItem {
  const raw = message as Record<string, unknown>;
  const rawRole = typeof raw.role === "string" ? raw.role : "";
  const toolHint = raw.tool_hint === true;
  const rawContent =
    typeof raw.content === "string"
      ? raw.content
      : raw.content === undefined || raw.content === null
        ? ""
        : JSON.stringify(raw.content);
  const trimmedContent = rawContent.trim();
  const toolCallHint = formatToolCallHint(raw);
  let kind: MessageItem["kind"] = "system";

  if (isMessageKind(raw.kind)) {
    kind = raw.kind;
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
      options?.id ||
      (typeof raw.id === "string" && raw.id.trim().length > 0
        ? raw.id
        : createMessageId(role || "message")),
    kind,
    role,
    content,
    sessionId,
    status: options?.status || "history",
  };
}

function normalizeCommittedMessages(response: SessionMessagesResponse): CurrentThreadState["committedMessages"] {
  return response.messages.map((message, index) => ({
    ...normalizeSessionMessage(message, response.session_id, {
      id: `${response.session_id}:${index}`,
      status: "history",
    }),
    source: "history" as const,
    index,
  }));
}

function shouldConfirmPending(pending: MessageItem | null, incoming: MessageItem): boolean {
  return Boolean(
    pending &&
      incoming.kind === "user" &&
      pending.sessionId === incoming.sessionId &&
      pending.content.trim() === incoming.content.trim(),
  );
}

function appendCommittedMessage(
  thread: CurrentThreadState,
  sessionId: string,
  rawMessage: SessionMessage,
  index?: number | null,
): CurrentThreadState {
  const normalized = normalizeSessionMessage(rawMessage, sessionId, {
    id: typeof index === "number" ? `${sessionId}:${index}` : createMessageId("sse"),
    status: "history",
  });
  const committed = {
    ...normalized,
    source: "sse" as const,
    index: typeof index === "number" ? index : null,
  };
  const committedMessages = [...thread.committedMessages];
  const existingById = committedMessages.findIndex((message) => message.id === committed.id);
  if (existingById >= 0) {
    committedMessages[existingById] = committed;
  } else {
    committedMessages.push(committed);
  }

  return withComposedMessages({
    ...thread,
    committedMessages,
    pendingUserMessage: shouldConfirmPending(thread.pendingUserMessage, normalized)
      ? null
      : thread.pendingUserMessage,
    streamingDraft:
      normalized.kind === "assistant" && thread.streamingDraft
        ? null
        : thread.streamingDraft,
  });
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

function normalizeProviderState(
  providerState: ProviderStateSnapshot | null | undefined,
  previous?: ProviderStateSnapshot | null,
): ProviderStateSnapshot | null {
  if (!providerState) {
    return providerState ?? null;
  }

  const explicitActive =
    providerState.active?.provider?.trim() || providerState.active?.model?.trim()
      ? providerState.active
      : null;
  const previousActive =
    previous?.active?.provider?.trim() || previous?.active?.model?.trim()
      ? previous.active
      : null;
  const inferredProvider = providerState.providers.find((item) => item.saved_model?.trim());
  const inferredActive = inferredProvider?.saved_model
    ? { provider: inferredProvider.provider, model: inferredProvider.saved_model }
    : null;

  return {
    ...providerState,
    active: explicitActive || previousActive || inferredActive || { provider: "", model: "" },
  };
}

function updateProviderSettings(
  providerState: ProviderStateSnapshot | null,
  settings: ProviderStateItem,
): ProviderStateSnapshot | null {
  if (!providerState) {
    return providerState;
  }
  const exists = providerState.providers.some((item) => item.provider === settings.provider);
  return normalizeProviderState({
    ...providerState,
    providers: exists
      ? providerState.providers.map((item) =>
          item.provider === settings.provider ? mergeProviderItem(item, settings) : item,
        )
      : [...providerState.providers, settings],
  }, providerState);
}

function updateSseState(state: DesktopAppState, event: SseEventEnvelope): DesktopAppState {
  const data = (event.data || {}) as Record<string, unknown>;
  const next: DesktopAppState = {
    ...state,
    sessionState: {
      ...state.sessionState,
      committedMessages: [...state.sessionState.committedMessages],
      messages: [...state.sessionState.messages],
      pendingUserMessage: state.sessionState.pendingUserMessage
        ? { ...state.sessionState.pendingUserMessage }
        : null,
      streamingDraft: state.sessionState.streamingDraft
        ? {
            ...state.sessionState.streamingDraft,
            progress: [...state.sessionState.streamingDraft.progress],
          }
        : null,
    },
  };
  appendEventLog(next, event);

  switch (event.type) {
    case "runtime.connected":
      next.eventsConnected = true;
      next.connectionStatus = "connected";
      next.connectionReason = "idle";
      next.connectionDetail = "已连接到当前 remote";
      if (data.provider_state) {
        next.providerState = normalizeProviderState(data.provider_state as ProviderStateSnapshot, next.providerState);
      }
      next.errorText = null;
      return next;
    case "runtime.status_changed":
      next.sessionState = withComposedMessages({
        ...next.sessionState,
        lastStatus: (data.status || data) as Record<string, unknown>,
      });
      return next;
    case "runtime.reloaded":
      if (data.provider_state) {
        next.providerState = normalizeProviderState(data.provider_state as ProviderStateSnapshot, next.providerState);
      }
      if (data.active && next.providerState) {
        next.providerState = normalizeProviderState({
          ...next.providerState,
          active: data.active as ProviderStateSnapshot["active"],
        }, next.providerState);
      }
      next.errorText = null;
      return next;
    case "runtime.resync_required":
      next.needsResync = true;
      return next;
    case "session.message_appended": {
      const sessionId = typeof data.session_id === "string" ? data.session_id : "";
      if (!sessionId || sessionId !== next.currentSessionId || !data.message || typeof data.message !== "object") {
        return next;
      }
      next.sessionState = appendCommittedMessage(
        next.sessionState,
        sessionId,
        data.message as SessionMessage,
        typeof data.index === "number" ? data.index : null,
      );
      return next;
    }
    case "turn.started": {
      const sessionId = typeof data.session_id === "string" ? data.session_id : next.currentSessionId;
      if (!sessionId || sessionId !== next.currentSessionId) {
        return next;
      }
      next.sessionState = withComposedMessages({
        ...next.sessionState,
        streamingDraft: {
          id: createMessageId("assistant"),
          kind: "assistant",
          role: "assistant",
          content: "",
          sessionId,
          status: "streaming",
          turnId: typeof data.turn_id === "string" ? data.turn_id : null,
          progress: [],
          stopReason: null,
        },
      });
      return next;
    }
    case "turn.progress":
    case "turn.delta": {
      const sessionId = typeof data.session_id === "string" ? data.session_id : next.currentSessionId;
      if (!sessionId || sessionId !== next.currentSessionId) {
        return next;
      }
      const content = String(data.content || "");
      const draft =
        next.sessionState.streamingDraft ||
        ({
          id: createMessageId("assistant"),
          kind: "assistant",
          role: "assistant",
          content: "",
          sessionId,
          status: "streaming",
          turnId: typeof data.turn_id === "string" ? data.turn_id : null,
          progress: [],
          stopReason: null,
        } as CurrentThreadState["streamingDraft"]);
      if (!draft) {
        return next;
      }
      if (event.type === "turn.progress") {
        draft.progress = [
          ...draft.progress,
          {
            id: createMessageId("progress"),
            kind: "progress",
            role: data.tool_hint ? "tool_hint" : "progress",
            content,
            sessionId,
            status: "completed",
          },
        ];
      } else {
        draft.content += content;
        draft.status = "streaming";
      }
      next.sessionState = withComposedMessages({
        ...next.sessionState,
        streamingDraft: draft,
      });
      return next;
    }
    case "turn.completed":
    case "turn.failed":
    case "turn.interrupted":
    case "turn.stream_end": {
      if (!next.sessionState.streamingDraft) {
        return next;
      }
      const stopped =
        event.type === "turn.interrupted"
          ? "interrupted"
          : event.type === "turn.failed"
            ? "failed"
            : typeof data.stop_reason === "string"
              ? data.stop_reason
              : "completed";
      next.sessionState = withComposedMessages({
        ...next.sessionState,
        streamingDraft: {
          ...next.sessionState.streamingDraft,
          status: stopped === "interrupted" ? "interrupted" : "completed",
          stopReason: stopped,
        },
      });
      return next;
    }
    case "task.delivered": {
      const sessionId = typeof data.session_id === "string" ? data.session_id : next.currentSessionId;
      if (!sessionId || sessionId !== next.currentSessionId) {
        return next;
      }
      const taskMessage: MessageItem = {
        id: createMessageId("task"),
        kind: "task",
        role: "task",
        content: String(data.content || ""),
        sessionId,
        status: "task_delivered",
      };
      next.sessionState = withComposedMessages({
        ...next.sessionState,
        committedMessages: [
          ...next.sessionState.committedMessages,
          {
            ...taskMessage,
            source: "sse",
            index: null,
          },
        ],
      });
      return next;
    }
    case "provider.state_changed":
    case "provider.list_changed":
      if (data.provider_state) {
        next.providerState = normalizeProviderState(data.provider_state as ProviderStateSnapshot, next.providerState);
      } else if (data.provider_list) {
        next.providerState = normalizeProviderState(data.provider_list as ProviderStateSnapshot, next.providerState);
      }
      next.errorText = null;
      return next;
    case "provider.settings_updated":
      if (data.settings) {
        next.providerState = updateProviderSettings(
          next.providerState,
          data.settings as ProviderStateItem,
        );
      }
      next.errorText = null;
      return next;
    case "provider.active_changed":
      if (data.active && next.providerState) {
        next.providerState = normalizeProviderState({
          ...next.providerState,
          active: data.active as ProviderStateSnapshot["active"],
        }, next.providerState);
      }
      next.errorText = null;
      return next;
    case "sidebar.snapshot":
      if (data.sidebar) {
        next.sidebar = data.sidebar as DesktopSidebarData;
        next.sidebarReady = true;
      }
      return next;
    case "sidebar.invalidated":
      next.sidebarReady = false;
      return next;
    default:
      return next;
  }
}

export function desktopReducer(state: DesktopAppState, action: DesktopAction): DesktopAppState {
  switch (action.type) {
    case "profile/update":
      return {
        ...state,
        profile: action.profile,
        providerCatalog: null,
        providerState: null,
        sidebar: createSidebarState(),
        sidebarReady: false,
      };
    case "connection/status": {
      const connected = action.status === "connected";
      return {
        ...state,
        connectionStatus: action.status,
        connectionDetail: action.detail,
        connectionReason: action.reason ?? state.connectionReason,
        bootstrapLoaded: action.bootstrapLoaded ?? (connected ? state.bootstrapLoaded : false),
        eventsConnected: action.eventsConnected ?? (connected ? state.eventsConnected : false),
        providerCatalog: connected ? state.providerCatalog : null,
        providerState: connected ? state.providerState : null,
        sidebar: connected ? state.sidebar : createSidebarState(),
        sidebarReady: connected ? state.sidebarReady : false,
        errorText: action.status === "error" ? action.detail : null,
      };
    }
    case "bootstrap/loaded":
      return {
        ...state,
        connectionStatus: "connected",
        connectionDetail: `已连接到 ${action.host}:${action.port}`,
        connectionReason: "idle",
        bootstrapLoaded: true,
        providerCatalog: action.bootstrap.provider_catalog,
        providerState: normalizeProviderState(action.bootstrap.provider_state, state.providerState),
        sidebar: action.bootstrap.sidebar,
        sidebarReady: true,
        sessionState: withComposedMessages({
          ...state.sessionState,
          lastStatus: action.bootstrap.status,
        }),
        errorText: null,
      };
    case "events/connected":
      return {
        ...state,
        eventsConnected: action.connected,
        connectionStatus: action.connected ? "connected" : state.connectionStatus,
      };
    case "session/current":
      return {
        ...state,
        currentSessionId: action.sessionId,
        sessionState: createThreadState(action.sessionId),
      };
    case "messages/loaded":
      return {
        ...state,
        currentSessionId: action.response.session_id,
        sessionState: withComposedMessages({
          ...createThreadState(action.response.session_id),
          committedMessages: normalizeCommittedMessages(action.response),
          lastStatus: state.sessionState.lastStatus,
        }),
      };
    case "message/pendingUser": {
      const pending = {
        id: createMessageId("user"),
        kind: "user" as const,
        role: "user",
        content: action.content,
        sessionId: action.sessionId,
        status: "sent" as const,
      };
      return {
        ...state,
        currentSessionId: action.sessionId,
        sessionState: withComposedMessages({
          ...state.sessionState,
          sessionId: action.sessionId,
          pendingUserMessage: pending,
        }),
      };
    }
    case "sidebar/data":
      return {
        ...state,
        sidebar: action.data,
        sidebarReady: true,
      };
    case "sidebar/reset":
      return {
        ...state,
        sidebar: createSidebarState(),
        sidebarReady: false,
      };
    case "status/loaded":
      return {
        ...state,
        sessionState: withComposedMessages({
          ...state.sessionState,
          lastStatus: action.status,
        }),
      };
    case "provider/listLoaded":
      return {
        ...state,
        providerCatalog: action.providerCatalog ?? state.providerCatalog,
        providerState: normalizeProviderState(action.providerState, state.providerState),
      };
    case "provider/stateLoaded":
      return {
        ...state,
        providerState: normalizeProviderState(action.providerState, state.providerState),
      };
    case "thread/clear":
      return {
        ...state,
        sessionState: createThreadState(state.currentSessionId),
      };
    case "sse/received":
      return updateSseState(state, action.event);
    case "resync/handled":
      return {
        ...state,
        needsResync: false,
      };
    case "error/set":
      return {
        ...state,
        errorText: action.message,
      };
    default:
      return state;
  }
}
