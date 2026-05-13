import type { MessageItem } from "../lib/types";
import type { DesktopAppState } from "../state/reducer";

export interface ThreadMessageDisplayItem {
  kind: "message";
  key: string;
  message: MessageItem;
}

export interface ThreadProcessDisplayItem {
  kind: "process";
  key: string;
  entries: MessageItem[];
  title: string;
  statusLabel: string;
  summary: string;
}

export type ThreadDisplayItem = ThreadMessageDisplayItem | ThreadProcessDisplayItem;

function getConnectionStatusCopy(
  state: Pick<
    DesktopAppState,
    "connectionStatus" | "connectionReason" | "connectionDetail" | "bootstrapLoaded" | "eventsConnected"
  >,
): { label: string; detail: string } {
  if (state.connectionStatus === "connecting") {
    return {
      label: "连接中",
      detail: "正在建立连接…",
    };
  }

  if (state.connectionStatus === "connected") {
    return {
      label: "已连接",
      detail: state.eventsConnected
        ? state.connectionDetail || "已连接到当前 remote"
        : "HTTP 已连接，正在等待事件流",
    };
  }

  if (state.connectionStatus === "error") {
    if (state.connectionReason === "auth_error") {
      return {
        label: "鉴权失败",
        detail: "Token 无效或 remote 拒绝访问",
      };
    }
    return {
      label: "连接失败",
      detail: state.connectionDetail || "无法连接到当前 remote",
    };
  }

  if (state.connectionReason === "closed") {
    return {
      label: "未连接",
      detail: "连接已断开",
    };
  }

  return {
    label: "未连接",
    detail: "当前未连接 remote",
  };
}

export function getConnectionLabel(
  state: Pick<
    DesktopAppState,
    "connectionStatus" | "connectionReason" | "connectionDetail" | "bootstrapLoaded" | "eventsConnected"
  >,
): string {
  return getConnectionStatusCopy(state).label;
}

export function getConnectionDetailLabel(
  state: Pick<
    DesktopAppState,
    "connectionStatus" | "connectionReason" | "connectionDetail" | "bootstrapLoaded" | "eventsConnected"
  >,
): string {
  return getConnectionStatusCopy(state).detail;
}

export function getConversationSummary(
  state: Pick<
    DesktopAppState,
    "connectionStatus" | "connectionReason" | "connectionDetail" | "bootstrapLoaded" | "eventsConnected" | "sessionState"
  >,
): string {
  if (!state.bootstrapLoaded) {
    return getConnectionStatusCopy(state).detail;
  }

  const draft = state.sessionState.streamingDraft;
  if (draft && draft.status === "streaming") {
    return "正在回复当前会话";
  }
  if (draft?.stopReason === "interrupted") {
    return "上一轮已被打断";
  }
  if (state.sessionState.messages.length === 0) {
    return "当前会话为空";
  }
  return "当前会话已同步";
}

export function getWorkspaceSummary(
  state: Pick<
    DesktopAppState,
    "connectionStatus" | "connectionReason" | "connectionDetail" | "bootstrapLoaded" | "eventsConnected" | "sessionState" | "currentSessionId"
  >,
): string {
  if (!state.bootstrapLoaded) {
    return getConnectionStatusCopy(state).detail;
  }
  if (state.sessionState.streamingDraft?.status === "streaming") {
    return "当前会话正在处理中。";
  }
  if (!state.currentSessionId) {
    return "未选择会话，发送首条消息会自动创建。";
  }
  return `当前会话 · ${shortenSessionId(state.currentSessionId)}`;
}

export function getHeaderSessionLabel(sessionId: string): string {
  return shortenSessionId(sessionId);
}

export function getComposerHint(
  state: Pick<
    DesktopAppState,
    "connectionStatus" | "connectionReason" | "connectionDetail" | "bootstrapLoaded" | "eventsConnected" | "sessionState"
  >,
): string {
  if (!state.bootstrapLoaded) {
    if (state.connectionStatus === "connected") {
      return "当前还没有选中会话，发送首条消息时会自动创建。";
    }
    return getConnectionStatusCopy(state).detail;
  }
  if (state.sessionState.streamingDraft?.status === "streaming") {
    return "发送新消息会先中断上一轮。";
  }
  return "消息会直接进入当前 desktop session。";
}

export interface MessagePresentation {
  label: string;
  statusLabel: string;
  tone: "user" | "assistant" | "task" | "progress" | "system";
}

export function getMessagePresentation(message: MessageItem): MessagePresentation {
  const tone =
    message.kind === "task"
      ? "task"
      : message.kind === "progress"
        ? "progress"
        : message.kind === "assistant"
          ? "assistant"
          : message.kind === "user"
            ? "user"
            : "system";

  let label = "系统";
  if (message.kind === "user") {
    label = "我";
  } else if (message.kind === "assistant") {
    label = "Nomi";
  } else if (message.kind === "task") {
    label = "任务提醒";
  } else if (message.kind === "progress") {
    label = message.role === "tool_hint" ? "过程提示" : "处理中";
  }

  let statusLabel = "已记录";
  switch (message.status) {
    case "history":
      statusLabel = "历史消息";
      break;
    case "sent":
      statusLabel = "已发送";
      break;
    case "streaming":
      statusLabel = "正在回复";
      break;
    case "completed":
      statusLabel = message.kind === "progress" ? "过程更新" : "已完成";
      break;
    case "interrupted":
      statusLabel = "已被打断";
      break;
    case "task_delivered":
      statusLabel = "任务已送达";
      break;
    case "error":
      statusLabel = "错误";
      break;
  }

  return { label, statusLabel, tone };
}

export function buildThreadDisplayItems(messages: MessageItem[]): ThreadDisplayItem[] {
  const items: ThreadDisplayItem[] = [];
  let turnMessages: MessageItem[] = [];
  let progressEntries: MessageItem[] = [];

  const flushTurn = () => {
    if (progressEntries.length > 0) {
      const toolHintCount = progressEntries.filter((entry) => entry.role === "tool_hint").length;
      const title = toolHintCount > 0 ? "已思考" : "处理中";
      const lastEntry = progressEntries[progressEntries.length - 1];
      const summarySource = String(lastEntry.content || "").trim().split(/\n+/)[0] || "过程已更新";
      items.push({
        kind: "process",
        key: `process-${progressEntries.map((entry) => entry.id).join("-")}`,
        entries: progressEntries,
        title,
        statusLabel: `${progressEntries.length} 条过程更新`,
        summary: summarySource,
      });
    }
    for (const message of turnMessages) {
      items.push({
        kind: "message",
        key: message.id,
        message,
      });
    }
    turnMessages = [];
    progressEntries = [];
  };

  for (const message of messages) {
    if (message.kind === "progress") {
      progressEntries.push(message);
      continue;
    }
    if (message.kind === "assistant") {
      turnMessages.push(message);
      continue;
    }
    flushTurn();
    items.push({
      kind: "message",
      key: message.id,
      message,
    });
  }

  flushTurn();
  return items;
}

function shortenSessionId(sessionId: string): string {
  if (sessionId.length <= 36) {
    return sessionId;
  }
  return `${sessionId.slice(0, 22)}...${sessionId.slice(-8)}`;
}
