export * from "../protocol/remote";

import type {
  DesktopSidebarData,
  McpServerItem,
  ProviderCatalog,
  ProviderStateSnapshot,
  SessionSummary,
  SidebarMcpItem,
  SidebarSkillItem,
  SidebarTaskItem,
  SkillItem,
  TaskItem,
  TaskSchedule,
} from "../protocol/remote";

export type ThemePreference = "system" | "light" | "dark";

export interface ConnectionProfile {
  host: string;
  port: string;
  token: string;
  clientId: string;
  defaultSessionId: string;
  lastBoundSessionId: string;
  themePreference: ThemePreference;
}

export interface DesktopConnectionProfile extends ConnectionProfile {
  accentColor?: string;
}

export type ConnectionReason =
  | "idle"
  | "closed"
  | "auth_error"
  | "transport_error"
  | "unknown";

export interface RemoteClientError {
  kind: ConnectionReason;
  message: string;
}

export interface MessageItem {
  id: string;
  kind: "user" | "assistant" | "progress" | "task" | "system";
  role: string;
  content: string;
  sessionId: string;
  status:
    | "history"
    | "sent"
    | "streaming"
    | "completed"
    | "interrupted"
      | "task_delivered"
      | "error";
}

export interface CommittedMessage extends MessageItem {
  source: "history" | "sse";
  index: number | null;
}

export interface PendingUserMessage extends MessageItem {
  status: "sent" | "error";
}

export interface StreamingDraft extends MessageItem {
  turnId: string | null;
  progress: MessageItem[];
  stopReason: string | null;
}

export interface CurrentThreadState {
  sessionId: string;
  committedMessages: CommittedMessage[];
  pendingUserMessage: PendingUserMessage | null;
  streamingDraft: StreamingDraft | null;
  messages: MessageItem[];
  lastStatus: Record<string, unknown> | null;
}

export interface DesktopActions {
  connect(): void;
  disconnect(): void;
  interruptCurrentTurn(): Promise<void>;
  clearRuntimeState(): Promise<void>;
  createNewSession(title?: string): Promise<void>;
  refreshSidebar(): Promise<void>;
  createTask(input: { instruction: string; schedule: TaskSchedule; sourceSessionKey: string; targetChannels?: string[] }): Promise<boolean>;
  updateTask(taskId: string, input: { instruction?: string | null; schedule?: TaskSchedule | null; targetChannels?: string[] | null }): Promise<boolean>;
  deleteTask(taskId: string): Promise<boolean>;
  enableTask(taskId: string): Promise<boolean>;
  disableTask(taskId: string): Promise<boolean>;
  installSkill(input: { source?: string | null; uploadToken?: string | null }): Promise<boolean>;
  uninstallSkill(name: string): Promise<boolean>;
  createMcp(input: { mcp: Record<string, unknown> }): Promise<boolean>;
  updateMcp(name: string, input: { mcp: Record<string, unknown> }): Promise<boolean>;
  deleteMcp(name: string): Promise<boolean>;
  enableMcp(name: string): Promise<boolean>;
  disableMcp(name: string): Promise<boolean>;
  uploadSkillZip(file: File): Promise<string | null>;
  sendMainMessage(): Promise<void>;
  setDraftInput(value: string): void;
}

export type {
  DesktopSidebarData,
  McpServerItem,
  ProviderCatalog,
  ProviderStateSnapshot,
  SessionSummary,
  SidebarMcpItem,
  SidebarSkillItem,
  SidebarTaskItem,
  SkillItem,
  TaskItem,
  TaskSchedule,
};
