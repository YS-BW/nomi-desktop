import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import type {
  DesktopActions,
  DesktopConnectionProfile,
  ProviderCatalogItem,
  ProviderStateItem,
  SidebarMcpItem,
  SidebarTaskItem,
  ThemePreference,
} from "../lib/types";
import type { DesktopRemoteEntry } from "../lib/store";
import type { RemoteSessionListState } from "../lib/remoteSessions";
import { ACCENT_PRESETS, DEFAULT_ACCENT_COLOR } from "../lib/themeAccent";
import type { DesktopAppState } from "../state/reducer";
import {
  buildThreadDisplayItems,
  getComposerHint,
  getConnectionDetailLabel,
  getConnectionLabel,
  getMessagePresentation,
  getWorkspaceSummary,
} from "./presentation";
import { AnimatedMessageContent } from "./AnimatedMessageContent";
import { parseMcpInstallJson } from "./mcpJson";

interface MainShellProps {
  state: DesktopAppState;
  actions: DesktopActions & {
    refreshRemoteSessions(): Promise<void>;
    loadMoreRemoteSessions(): Promise<void>;
    deleteRemoteSession(sessionId: string): Promise<void>;
    refreshProviderState(): Promise<void>;
    setProviderSettings(input: {
      provider: string;
      apiKey?: string | null;
      apiBase?: string | null;
      model?: string | null;
      clearApiKey?: boolean | null;
    }): Promise<boolean>;
    setActiveProvider(input: { provider: string; model?: string | null }): Promise<boolean>;
    reloadRuntime(): Promise<boolean>;
  };
  draftInput: string;
  composerPhase: "idle" | "interrupting" | "sending";
  sidebarCollapsed: boolean;
  previewThemePreference: ThemePreference | null;
  setPreviewThemePreference(value: ThemePreference | null): void;
  remoteEntries: DesktopRemoteEntry[];
  activeRemoteId: string;
  sessionListState: RemoteSessionListState;
  connectRemote(remoteId: string): void;
  reconnectRemote(remoteId: string): void;
  disconnectRemote(): void;
  selectSession(sessionId: string): void;
  saveRemote(input: {
    id?: string;
    name: string;
    host: string;
    port: string;
    token: string;
  }): void;
  deleteRemote(remoteId: string): void;
  toggleSidebar(): void;
  updateProfile(patch: Partial<DesktopConnectionProfile>): void;
  clearGlobalError(): void;
}

interface SidebarDisclosureProps {
  title: string;
  count: number;
  action?: ReactNode;
  children: ReactNode;
}

interface SidebarTaskGroup {
  key: string;
  label: string;
  tasks: SidebarTaskItem[];
}

interface SessionChannelGroup {
  key: string;
  label: string;
  items: RemoteSessionListState["items"];
}

type TaskFormMode = "create" | "edit";
type TaskScheduleMode = "after" | "at" | "daily" | "every";

interface TaskFormState {
  mode: TaskFormMode;
  taskId: string | null;
  instruction: string;
  scheduleMode: TaskScheduleMode;
  afterSeconds: string;
  at: string;
  dailyTime: string;
  everySeconds: string;
}

interface SkillInstallState {
  source: string;
  file: File | null;
  error: string | null;
}

interface McpFormState {
  mode: "create" | "edit";
  json: string;
  name: string;
  enabled: boolean;
  transport: string;
  command: string;
  args: string;
  url: string;
  enabledTools: string;
  env: string;
  headers: string;
}

interface RemoteFormState {
  mode: "create" | "edit";
  remoteId: string | null;
  name: string;
  host: string;
  port: string;
  token: string;
}

interface SkillFeedbackState {
  tone: "error";
  message: string;
}

interface TaskFeedbackState {
  tone: "error";
  message: string;
}

interface ProviderSettingsFeedbackState {
  tone: "error" | "success";
  message: string;
}

interface BannerNotificationState {
  id: string;
  tone: "error" | "success";
  message: string;
  source: "global" | "remote" | "task" | "skill" | "provider";
}

interface ModelSettingsProviderItem {
  name: string;
  display_name?: string | null;
  backend?: string | null;
  default_api_base?: string | null;
  api_base_editable?: boolean;
  is_gateway?: boolean;
  is_local?: boolean;
  is_direct?: boolean;
  strip_model_prefix?: boolean;
  supports_prompt_caching?: boolean;
  builtin?: boolean;
  editable?: boolean;
  deletable?: boolean;
  api_key_set?: boolean;
  api_key_preview?: string | null;
  saved_model?: string | null;
  api_base?: string | null;
  source?: string | null;
}

interface ModelSettingsProviderDraft {
  apiBase: string;
  apiKey: string;
  model: string;
}

interface ModelSettingsFormState {
  [providerName: string]: ModelSettingsProviderDraft;
}

function Icon(props: { name: string; className?: string }) {
  const { name, className } = props;
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  const icons: Record<string, JSX.Element> = {
    "panel-left": (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" {...common} />
        <path d="M9 4v16" {...common} />
      </>
    ),
    bolt: (
      <>
        <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" {...common} />
      </>
    ),
    sparkles: (
      <>
        <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8Z" {...common} />
        <path d="M5 16.5 5.8 18 7.5 18.8 5.8 19.5 5 21 4.2 19.5 2.5 18.8 4.2 18Z" {...common} />
      </>
    ),
    plug: (
      <>
        <path d="M12 22v-5" {...common} />
        <path d="M9 8V2" {...common} />
        <path d="M15 8V2" {...common} />
        <path d="M8 8h8v4a4 4 0 0 1-8 0Z" {...common} />
      </>
    ),
    "arrow-up": (
      <>
        <path d="M12 19V5" {...common} />
        <path d="m5 12 7-7 7 7" {...common} />
      </>
    ),
    send: (
      <>
        <path d="M12 18V7" {...common} strokeWidth={2.4} />
        <path d="m7.5 11.5 4.5-4.5 4.5 4.5" {...common} strokeWidth={2.4} />
      </>
    ),
    "chevron-down": (
      <>
        <path d="m6 9 6 6 6-6" {...common} />
      </>
    ),
    "more-horizontal": (
      <>
        <circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none" />
      </>
    ),
    plus: (
      <>
        <path d="M12 4.5v15" {...common} strokeWidth={2.6} />
        <path d="M4.5 12h15" {...common} strokeWidth={2.6} />
      </>
    ),
    spinner: (
      <>
        <path d="M12 3a9 9 0 1 1-6.36 2.64" {...common} />
      </>
    ),
  };

  return (
    <svg
      className={`icon-svg${className ? ` ${className}` : ""}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {icons[name] || null}
    </svg>
  );
}

function formatDateTime(ms: number | null): string {
  if (!ms) {
    return "未安排";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function formatDuration(ms: number | null): string {
  if (!ms || ms <= 0) {
    return "未设置";
  }
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds} 秒`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} 分钟`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    return `${totalHours} 小时`;
  }
  const totalDays = Math.floor(totalHours / 24);
  return `${totalDays} 天`;
}

function formatTaskSchedule(task: SidebarTaskItem): string {
  if (task.scheduleKind === "at") {
    return `一次性 · ${formatDateTime(task.scheduleAtMs)}`;
  }
  if (task.scheduleKind === "every") {
    return `循环间隔 · ${formatDuration(task.scheduleEveryMs)}`;
  }
  if (task.scheduleKind === "cron") {
    return task.scheduleExpr
      ? `Cron · ${task.scheduleExpr}${task.scheduleTz ? ` · ${task.scheduleTz}` : ""}`
      : "Cron";
  }
  return task.scheduleKind || "未知调度";
}

function formatTaskCompactMeta(task: SidebarTaskItem): string {
  const parts = [formatTaskSchedule(task), task.enabled ? "启用中" : "已停用", task.status || "pending"];
  if (task.runCount > 0) {
    parts.push(`已运行 ${task.runCount} 次`);
  }
  return parts.join(" · ");
}

function formatMcpSummary(item: SidebarMcpItem): string {
  const tools =
    item.enabledTools.length === 0
      ? "无 tool 配置"
      : item.enabledTools.length === 1 && item.enabledTools[0] === "*"
        ? "全部工具"
        : `${item.enabledTools.length} 个 tools`;
  if (item.transport === "stdio") {
    return `${tools} · 本地 ${item.transport}`;
  }
  return `${tools} · ${item.url || "未配置地址"}`;
}

function formatSkillSummary(skillPath: string): string {
  const segments = skillPath.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "本地 Skill 包";
  }
  return segments.slice(-2).join("/");
}

function formatTaskTime(task: SidebarTaskItem): string {
  if (task.nextRunAtMs) {
    return formatDateTime(task.nextRunAtMs);
  }
  if (task.scheduleKind === "at") {
    return formatDateTime(task.scheduleAtMs);
  }
  return "未安排";
}

function formatSessionTimestamp(ms: number | null): string {
  if (!ms) {
    return "未知时间";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function getSessionChannelKey(sessionId: string, source: string | null): string {
  const sourceKey = (source || "").trim().toLowerCase();
  if (sourceKey === "desktop" || sourceKey === "wechat" || sourceKey === "cron") {
    return sourceKey;
  }
  const prefix = sessionId.split(":", 1)[0]?.trim().toLowerCase();
  if (prefix === "desktop" || prefix === "wechat" || prefix === "cron") {
    return prefix;
  }
  return "other";
}

function buildSessionChannelGroups(items: RemoteSessionListState["items"]): SessionChannelGroup[] {
  const labels: Record<string, string> = {
    desktop: "Desktop",
    wechat: "微信",
    cron: "Cron",
    other: "其他",
  };
  const order = ["desktop", "wechat", "cron", "other"];
  return order
    .map((key) => ({
      key,
      label: labels[key],
      items: items.filter((item) => getSessionChannelKey(item.sessionId, item.source) === key),
    }))
    .filter((group) => group.items.length > 0);
}

function getComposerStatusCopy(
  state: DesktopAppState,
  composerPhase: MainShellProps["composerPhase"],
): string {
  if (composerPhase === "interrupting") {
    return "正在中断上一轮...";
  }
  if (composerPhase === "sending") {
    return "正在发送到当前会话...";
  }
  if (!state.ownerReady) {
    if (state.connectionStatus === "connecting") {
      return state.readyReceived
        ? "当前还没有选中会话，发送首条消息时会自动创建。"
        : "正在连接 remote，请稍等。";
    }
    if (state.connectionStatus === "error") {
      return state.connectionReason === "auth_error"
        ? "remote 鉴权失败，请检查 token。"
        : "remote 连接失败，请检查 host 和 port。";
    }
    return "未连接，先连上 remote 再发送。";
  }
  if (state.sessionState.activeTurn && !state.sessionState.activeTurn.completed) {
    return "正在回复中，发送新消息会先中断上一轮。";
  }
  return "Enter 发送，Shift+Enter 换行。";
}

function renderEmptyState(copy: string) {
  return <div className="sidebar-empty-state">{copy}</div>;
}

function buildTaskGroups(tasks: SidebarTaskItem[]): SidebarTaskGroup[] {
  const groups: SidebarTaskGroup[] = [];
  const pushGroup = (key: string, label: string, matches: (task: SidebarTaskItem) => boolean) => {
    const items = tasks.filter(matches);
    if (items.length > 0) {
      groups.push({ key, label, tasks: items });
    }
  };

  pushGroup("at", "一次性任务", (task) => task.enabled && task.scheduleKind === "at");
  pushGroup("every", "间隔循环", (task) => task.enabled && task.scheduleKind === "every");
  pushGroup("cron", "Cron / 每日任务", (task) => task.enabled && task.scheduleKind === "cron");
  pushGroup(
    "other",
    "其他任务",
    (task) => task.enabled && !["at", "every", "cron"].includes(task.scheduleKind),
  );
  pushGroup("disabled", "已停用", (task) => !task.enabled);

  return groups;
}

function buildProviderCapabilityBadges(provider: {
  is_gateway?: boolean;
  is_local?: boolean;
  is_direct?: boolean;
  strip_model_prefix?: boolean;
  supports_prompt_caching?: boolean;
}): string[] {
  const badges: string[] = [];
  if (provider.is_gateway) {
    badges.push("Gateway");
  }
  if (provider.is_local) {
    badges.push("Local");
  }
  if (provider.is_direct) {
    badges.push("Direct");
  }
  if (provider.strip_model_prefix) {
    badges.push("Strip Prefix");
  }
  if (provider.supports_prompt_caching) {
    badges.push("Prompt Cache");
  }
  return badges;
}

function getTaskInstructionSummary(task: SidebarTaskItem): string | null {
  const instruction = task.instruction.trim();
  const title = (task.title || "").trim();
  if (!instruction) {
    return null;
  }
  if (title && title === instruction) {
    return null;
  }
  return instruction;
}

function SidebarDisclosure(props: SidebarDisclosureProps) {
  const { title, count, action, children } = props;
  const [open, setOpen] = useState(false);

  return (
    <section className={`sidebar-disclosure ${open ? "open" : ""}`}>
      <div className="sidebar-disclosure-toggle">
        <button
          className="sidebar-disclosure-toggle-button"
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="sidebar-disclosure-main">
            <span className="sidebar-disclosure-title">{title}</span>
            <span className="sidebar-disclosure-meta">
              <span className="sidebar-disclosure-count">{count}</span>
              <Icon name="chevron-down" className="sidebar-disclosure-icon" />
            </span>
          </span>
        </button>
        {action ? <div className="sidebar-disclosure-action">{action}</div> : null}
      </div>
      <div className="sidebar-disclosure-panel">
        <div className="sidebar-disclosure-inner">{children}</div>
      </div>
    </section>
  );
}

function SidebarMoreMenu(props: {
  ariaLabel?: string;
  items: Array<{
    label: string;
    danger?: boolean;
    disabled?: boolean;
    onClick(): void;
  }>;
}) {
  const { ariaLabel = "更多操作", items } = props;
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  return (
    <div ref={menuRef} className={`sidebar-more-menu${open ? " open" : ""}`}>
      <button
        type="button"
        className="sidebar-inline-button secondary sidebar-more-trigger"
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="more-horizontal" />
      </button>
      {open ? (
        <div className="sidebar-more-menu-panel" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`sidebar-more-menu-item${item.danger ? " danger" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                item.onClick();
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BannerNotification(props: {
  tone: "error" | "success";
  message: string;
  onClose(): void;
}) {
  const { tone, message, onClose } = props;
  return (
    <div className="banner-notification-layer" role="status" aria-live="polite">
      <div className={`banner-notification ${tone}`}>
        <div className="banner-notification-copy">{message}</div>
        <button
          type="button"
          className="banner-notification-close"
          aria-label="关闭通知"
          onClick={onClose}
        >
          ×
        </button>
      </div>
    </div>
  );
}

function ActionModal(props: {
  title: string;
  onClose(): void;
  children: ReactNode;
  visualState?: "open" | "closing";
  dialogClassName?: string;
}) {
  const { title, onClose, children, visualState = "open", dialogClassName } = props;
  return (
    <div
      className={`overlay-backdrop ${visualState === "closing" ? "closing" : "open"}`}
      role="presentation"
      onClick={onClose}
    >
      <div
        className={`overlay-dialog ${visualState === "closing" ? "closing" : "open"}${dialogClassName ? ` ${dialogClassName}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="overlay-header">
          <h2>{title}</h2>
          <button type="button" className="overlay-close" onClick={onClose} aria-label="关闭弹窗">
            ×
          </button>
        </div>
        <div className="overlay-body">{children}</div>
      </div>
    </div>
  );
}

function buildTaskFormState(task?: SidebarTaskItem): TaskFormState {
  if (!task) {
    return {
      mode: "create",
      taskId: null,
      instruction: "",
      scheduleMode: "after",
      afterSeconds: "3600",
      at: "",
      dailyTime: "09:00",
      everySeconds: "86400",
    };
  }
  return {
    mode: "edit",
    taskId: task.id,
    instruction: task.instruction,
    scheduleMode:
      task.scheduleKind === "at" || task.scheduleKind === "daily" || task.scheduleKind === "every"
        ? task.scheduleKind
        : task.scheduleKind === "cron"
          ? "daily"
          : "after",
    afterSeconds: task.scheduleEveryMs ? String(Math.max(1, Math.floor(task.scheduleEveryMs / 1000))) : "3600",
    at: task.scheduleAtMs ? new Date(task.scheduleAtMs).toISOString().slice(0, 16) : "",
    dailyTime:
      task.scheduleExpr && task.scheduleExpr.split(" ").length >= 2
        ? `${task.scheduleExpr.split(" ")[1].padStart(2, "0")}:${task.scheduleExpr.split(" ")[0].padStart(2, "0")}`
        : "09:00",
    everySeconds: task.scheduleEveryMs ? String(Math.max(1, Math.floor(task.scheduleEveryMs / 1000))) : "86400",
  };
}

function buildMcpFormState(item?: SidebarMcpItem): McpFormState {
  return {
    mode: item ? "edit" : "create",
    json: "",
    name: item?.name || "",
    enabled: item?.enabled ?? true,
    transport: item?.transport || "stdio",
    command: item?.command || "",
    args: item?.args.join(" ") || "",
    url: item?.url || "",
    enabledTools: item?.enabledTools.join(", ") || "*",
    env: JSON.stringify(item?.env || {}, null, 2),
    headers: JSON.stringify(item?.headers || {}, null, 2),
  };
}

function buildRemoteFormState(entry?: DesktopRemoteEntry): RemoteFormState {
  return {
    mode: entry ? "edit" : "create",
    remoteId: entry?.id || null,
    name: entry?.name || "",
    host: entry?.profile.host || "127.0.0.1",
    port: entry?.profile.port || "8765",
    token: entry?.profile.token || "",
  };
}

function shortenSessionId(sessionId: string): string {
  if (sessionId.length <= 52) {
    return sessionId;
  }
  return `${sessionId.slice(0, 34)}...${sessionId.slice(-12)}`;
}

export function MainShell(props: MainShellProps) {
  const {
    state,
    actions,
    draftInput,
    composerPhase,
    sidebarCollapsed,
    previewThemePreference,
    setPreviewThemePreference,
    remoteEntries,
    activeRemoteId,
    sessionListState,
    connectRemote,
    reconnectRemote,
    disconnectRemote,
    selectSession,
    saveRemote,
    deleteRemote,
    toggleSidebar,
    updateProfile,
    clearGlobalError,
  } = props;
  const connectionLabel = getConnectionLabel(state);
  const connectionDetailLabel = getConnectionDetailLabel(state);
  const workspaceSummary = getWorkspaceSummary(state);
  const composerHint = getComposerHint(state);
  const taskGroups = buildTaskGroups(state.sidebar.tasks);
  const threadItems = useMemo(
    () => buildThreadDisplayItems(state.sessionState.messages),
    [state.sessionState.messages],
  );
  const hasMeaningfulMessages = state.sessionState.messages.some(
    (message) => message.kind === "user" || message.kind === "assistant" || message.kind === "task",
  );
  const showHomePrototype =
    !hasMeaningfulMessages &&
    (!state.sessionState.activeTurn || state.sessionState.activeTurn.completed);
  const [expandedProcessKeys, setExpandedProcessKeys] = useState<Record<string, boolean>>({});
  const [taskModal, setTaskModal] = useState<TaskFormState | null>(null);
  const [taskFormError, setTaskFormError] = useState<string | null>(null);
  const [skillModalOpen, setSkillModalOpen] = useState(false);
  const [skillForm, setSkillForm] = useState<SkillInstallState>({
    source: "",
    file: null,
    error: null,
  });
  const [remoteModal, setRemoteModal] = useState<RemoteFormState | null>(null);
  const [remoteFormError, setRemoteFormError] = useState<string | null>(null);
  const [remoteFeedback, setRemoteFeedback] = useState<string | null>(null);
  const [mcpModal, setMcpModal] = useState<McpFormState | null>(null);
  const [mcpFormError, setMcpFormError] = useState<string | null>(null);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [sessionManagerOpen, setSessionManagerOpen] = useState(false);
  const [sessionManagerRendered, setSessionManagerRendered] = useState(false);
  const [sessionManagerClosing, setSessionManagerClosing] = useState(false);
  const [sessionManagerVisible, setSessionManagerVisible] = useState(false);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [modelSettingsRendered, setModelSettingsRendered] = useState(false);
  const [modelSettingsClosing, setModelSettingsClosing] = useState(false);
  const [modelSettingsVisible, setModelSettingsVisible] = useState(false);
  const [modelApiBases, setModelApiBases] = useState<ModelSettingsFormState>({});
  const [selectedModelProviderName, setSelectedModelProviderName] = useState<string | null>(null);
  const [themeSliderDragValue, setThemeSliderDragValue] = useState<number | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [taskFeedback, setTaskFeedback] = useState<TaskFeedbackState | null>(null);
  const [pendingSkillName, setPendingSkillName] = useState<string | null>(null);
  const [skillFeedback, setSkillFeedback] = useState<SkillFeedbackState | null>(null);
  const [providerSettingsBusyProvider, setProviderSettingsBusyProvider] = useState<string | null>(null);
  const [providerActivationBusyProvider, setProviderActivationBusyProvider] = useState<string | null>(null);
  const [providerReloading, setProviderReloading] = useState(false);
  const [providerSettingsFeedback, setProviderSettingsFeedback] =
    useState<ProviderSettingsFeedbackState | null>(null);
  const [bannerNotification, setBannerNotification] = useState<BannerNotificationState | null>(null);
  const processedTaskFeedbackRef = useRef<string | null>(null);
  const processedSkillFeedbackRef = useRef<string | null>(null);
  const processedNotificationKeyRef = useRef<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const threadScrollerRef = useRef<HTMLElement | null>(null);
  const threadContentRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowThreadRef = useRef(true);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const themeSliderRef = useRef<HTMLDivElement | null>(null);
  const themeSliderDragValueRef = useRef<number | null>(null);
  const composerStatusCopy = getComposerStatusCopy(state, composerPhase);
  const activeRemote = remoteEntries.find((entry) => entry.id === activeRemoteId) || remoteEntries[0] || null;
  const sendDisabled = draftInput.trim().length === 0 || !state.ownerReady || composerPhase !== "idle";
  const resourceActionsDisabled =
    !state.ownerReady ||
    (state.sessionState.activeTurn !== null && !state.sessionState.activeTurn.completed);
  const sessionChannelGroups = useMemo(
    () => buildSessionChannelGroups(sessionListState.items),
    [sessionListState.items],
  );
  const providerCatalogItems = useMemo(() => state.providerCatalog?.providers || [], [state.providerCatalog]);
  const providerCatalogByName = useMemo(
    () =>
      providerCatalogItems.reduce<Record<string, ProviderCatalogItem>>((acc, item) => {
        acc[item.name] = item;
        return acc;
      }, {}),
    [providerCatalogItems],
  );
  const providerStateItems = useMemo(() => state.providerState?.providers || [], [state.providerState]);
  const providerStateByName = useMemo(
    () =>
      providerStateItems.reduce<Record<string, ProviderStateItem>>((acc, item) => {
        acc[item.provider] = item;
        return acc;
      }, {}),
    [providerStateItems],
  );
  const providerManagementItems = useMemo<ModelSettingsProviderItem[]>(() => {
    if (providerStateItems.length > 0) {
      return providerStateItems.map((item) => {
        const catalogItem = providerCatalogByName[item.provider];
        return {
          ...catalogItem,
          ...item,
          name: item.provider,
          display_name: item.display_name || catalogItem?.display_name || item.provider,
          backend: item.backend || catalogItem?.backend || "",
          api_base_editable: item.api_base_editable ?? catalogItem?.api_base_editable ?? false,
          default_api_base: item.default_api_base ?? catalogItem?.default_api_base ?? null,
        };
      });
    }
    return providerCatalogItems.map((item) => ({
      ...item,
      name: item.name,
      display_name: item.display_name || item.name,
      backend: item.backend,
      api_base_editable: item.api_base_editable,
      default_api_base: item.default_api_base,
      api_key_set: false,
      saved_model: null,
      api_base: item.default_api_base || null,
    }));
  }, [providerCatalogByName, providerCatalogItems, providerStateItems]);
  const activeProviderSelection = state.providerState?.active || null;
  const selectedProvider =
    providerManagementItems.find((provider) => provider.name === selectedModelProviderName) ||
    providerManagementItems[0] ||
    null;
  const selectedProviderState = selectedProvider ? providerStateByName[selectedProvider.name] || null : null;
  const selectedProviderDraft = selectedProvider
    ? modelApiBases[selectedProvider.name] || {
        apiBase: selectedProviderState?.api_base || selectedProvider.default_api_base || "",
        apiKey: "",
        model:
          selectedProviderState?.saved_model ||
          (activeProviderSelection?.provider === selectedProvider.name ? activeProviderSelection.model : "") ||
          "",
      }
    : null;
  const selectedProviderIsActivating =
    Boolean(selectedProvider) && providerActivationBusyProvider === selectedProvider.name;
  const selectedProviderIsSaving =
    Boolean(selectedProvider) && providerSettingsBusyProvider === selectedProvider.name;
  const providerActionBusy =
    selectedProviderIsSaving || selectedProviderIsActivating || providerReloading;

  function updateSelectedProviderDraft(
    field: keyof ModelSettingsProviderDraft,
    value: string,
  ) {
    if (!selectedProvider) {
      return;
    }
    setModelApiBases((current) => ({
      ...current,
      [selectedProvider.name]: {
        ...current[selectedProvider.name],
        apiBase: current[selectedProvider.name]?.apiBase ?? selectedProvider.default_api_base ?? "",
        apiKey: current[selectedProvider.name]?.apiKey ?? "",
        model: current[selectedProvider.name]?.model ?? "",
        [field]: value,
      },
    }));
  }

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [draftInput]);

  useEffect(() => {
    const scroller = threadScrollerRef.current;
    if (!scroller || showHomePrototype) {
      return;
    }
    if (!shouldFollowThreadRef.current) {
      return;
    }
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: "smooth",
    });
  }, [showHomePrototype, state.sessionState.messages, state.sessionState.activeTurn]);

  useEffect(() => {
    const scroller = threadScrollerRef.current;
    const content = threadContentRef.current;
    if (!scroller || !content || showHomePrototype || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (!shouldFollowThreadRef.current) {
        return;
      }
      scroller.scrollTo({
        top: scroller.scrollHeight,
        behavior: "smooth",
      });
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
  }, [showHomePrototype]);

  useEffect(() => {
    if (!settingsMenuOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!settingsMenuRef.current?.contains(event.target as Node)) {
        setSettingsMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [settingsMenuOpen]);

  useEffect(() => {
    if (!sessionManagerRendered) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeSessionManager();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sessionManagerRendered]);

  useEffect(() => {
    if (sessionManagerOpen) {
      setSessionManagerRendered(true);
      setSessionManagerClosing(false);
      let nestedFrame = 0;
      const frame = window.requestAnimationFrame(() => {
        nestedFrame = window.requestAnimationFrame(() => {
          setSessionManagerVisible(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(frame);
        if (nestedFrame) {
          window.cancelAnimationFrame(nestedFrame);
        }
      };
    }
    setSessionManagerVisible(false);
    if (!sessionManagerRendered) {
      return;
    }
    setSessionManagerClosing(true);
    const timer = window.setTimeout(() => {
      setSessionManagerRendered(false);
      setSessionManagerClosing(false);
    }, 220);
    return () => {
      window.clearTimeout(timer);
    };
  }, [sessionManagerOpen, sessionManagerRendered]);

  useEffect(() => {
    if (!modelSettingsRendered) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeModelSettings();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [modelSettingsRendered]);

  useEffect(() => {
    if (modelSettingsOpen) {
      setModelSettingsRendered(true);
      setModelSettingsClosing(false);
      let nestedFrame = 0;
      const frame = window.requestAnimationFrame(() => {
        nestedFrame = window.requestAnimationFrame(() => {
          setModelSettingsVisible(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(frame);
        if (nestedFrame) {
          window.cancelAnimationFrame(nestedFrame);
        }
      };
    }
    setModelSettingsVisible(false);
    if (!modelSettingsRendered) {
      return;
    }
    setModelSettingsClosing(true);
    const timer = window.setTimeout(() => {
      setModelSettingsRendered(false);
      setModelSettingsClosing(false);
    }, 220);
    return () => {
      window.clearTimeout(timer);
    };
  }, [modelSettingsOpen, modelSettingsRendered]);

  useEffect(() => {
    const nextDrafts: ModelSettingsFormState = {};
    for (const provider of providerManagementItems) {
      const providerState = providerStateByName[provider.name];
      nextDrafts[provider.name] = {
        apiBase: providerState?.api_base || provider.default_api_base || "",
        apiKey: "",
        model:
          providerState?.saved_model ||
          (activeProviderSelection?.provider === provider.name ? activeProviderSelection.model : "") ||
          "",
      };
    }
    setModelApiBases(nextDrafts);
    setSelectedModelProviderName((current) => {
      if (current && providerManagementItems.some((provider) => provider.name === current)) {
        return current;
      }
      return activeProviderSelection?.provider || providerManagementItems[0]?.name || null;
    });
  }, [providerManagementItems, providerStateByName, activeProviderSelection]);

  useEffect(() => {
    themeSliderDragValueRef.current = themeSliderDragValue;
  }, [themeSliderDragValue]);

  useEffect(() => {
    setPendingTaskId(null);
    setTaskFeedback(null);
    setPendingSkillName(null);
    setSkillFeedback(null);
    setProviderSettingsBusyProvider(null);
    setProviderActivationBusyProvider(null);
    setProviderReloading(false);
    setProviderSettingsFeedback(null);
    setRemoteFeedback(null);
    setBannerNotification(null);
    processedNotificationKeyRef.current = null;
    processedTaskFeedbackRef.current = null;
    processedSkillFeedbackRef.current = null;
  }, [activeRemoteId, state.currentSessionId]);

  useEffect(() => {
    const candidates: Array<Omit<BannerNotificationState, "id"> | null> = [
      state.errorText
        ? { tone: "error", message: state.errorText, source: "global" }
        : null,
      remoteFeedback
        ? { tone: "error", message: remoteFeedback, source: "remote" }
        : null,
      taskFeedback
        ? { tone: taskFeedback.tone, message: taskFeedback.message, source: "task" }
        : null,
      skillFeedback
        ? { tone: skillFeedback.tone, message: skillFeedback.message, source: "skill" }
        : null,
      providerSettingsFeedback
        ? {
            tone: providerSettingsFeedback.tone,
            message: providerSettingsFeedback.message,
            source: "provider",
          }
        : null,
    ];
    const nextNotification = candidates.find(Boolean) || null;
    if (!nextNotification) {
      return;
    }
    const key = `${nextNotification.source}::${nextNotification.tone}::${nextNotification.message}`;
    if (processedNotificationKeyRef.current === key) {
      return;
    }
    processedNotificationKeyRef.current = key;
    setBannerNotification({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...nextNotification,
    });
  }, [providerSettingsFeedback, remoteFeedback, skillFeedback, state.errorText, taskFeedback]);

  function dismissBannerNotification(source = bannerNotification?.source) {
    if (!source) {
      return;
    }
    if (source === "global") {
      clearGlobalError();
    } else if (source === "remote") {
      setRemoteFeedback(null);
    } else if (source === "task") {
      setTaskFeedback(null);
    } else if (source === "skill") {
      setSkillFeedback(null);
    } else if (source === "provider") {
      setProviderSettingsFeedback(null);
    }
    processedNotificationKeyRef.current = null;
    setBannerNotification(null);
  }

  useEffect(() => {
    const latestProviderEvent = state.eventLog.find(
      (event) =>
        event.type === "provider_list" ||
        event.type === "provider_settings_updated" ||
        event.type === "provider_updated" ||
        event.type === "active_provider_changed" ||
        event.type === "runtime_reloaded" ||
        (event.type === "error" &&
          (event.command === "update_provider" ||
            event.command === "set_provider_settings" ||
            event.command === "set_active_provider" ||
            event.command === "reload_runtime")),
    );
    if (!latestProviderEvent) {
      return;
    }
    const triggerAutoReload = (message: string, failureMessage: string) => {
      setProviderReloading(true);
      setProviderSettingsFeedback({
        tone: "success",
        message,
      });
      void actions.reloadRuntime().then((ok) => {
        if (!ok) {
          setProviderReloading(false);
          setProviderSettingsFeedback({
            tone: "error",
            message: failureMessage,
          });
        }
      });
    };
    if (latestProviderEvent.type === "provider_list") {
      return;
    }
    if (latestProviderEvent.type === "provider_settings_updated") {
      setProviderSettingsBusyProvider(null);
      if (latestProviderEvent.requires_runtime_reload) {
        triggerAutoReload(
          "Provider 设置已保存，正在自动 Reload Runtime…",
          "Provider 设置已保存，但自动 Reload Runtime 失败。",
        );
        return;
      }
      setProviderSettingsFeedback({
        tone: "success",
        message: "Provider 设置已保存。",
      });
      return;
    }
    if (latestProviderEvent.type === "provider_updated") {
      setProviderSettingsBusyProvider(null);
      if (latestProviderEvent.requires_runtime_reload) {
        triggerAutoReload(
          "Provider 设置已保存，正在自动 Reload Runtime…",
          "Provider 设置已保存，但自动 Reload Runtime 失败。",
        );
        return;
      }
      setProviderSettingsFeedback({
        tone: "success",
        message: "Provider 设置已保存。",
      });
      return;
    }
    if (latestProviderEvent.type === "active_provider_changed") {
      setProviderActivationBusyProvider(null);
      if (latestProviderEvent.requires_runtime_reload) {
        triggerAutoReload(
          "当前模型已切换，正在自动 Reload Runtime…",
          "当前模型已切换，但自动 Reload Runtime 失败。",
        );
        return;
      }
      setProviderSettingsFeedback({
        tone: "success",
        message: "当前模型已切换。",
      });
      return;
    }
    if (latestProviderEvent.type === "runtime_reloaded") {
      setProviderReloading(false);
      setProviderSettingsFeedback({ tone: "success", message: "Runtime 已重新加载。" });
      return;
    }
    setProviderSettingsBusyProvider(null);
    setProviderActivationBusyProvider(null);
    setProviderReloading(false);
    const fieldMessage =
      latestProviderEvent.fields && latestProviderEvent.fields.length > 0
        ? latestProviderEvent.fields.map((field) => `${field.field}: ${field.message}`).join("；")
        : "";
    setProviderSettingsFeedback({
      tone: "error",
      message:
        latestProviderEvent.code === "runtime_reload_busy"
          ? "当前有进行中的对话，暂时不能 Reload Runtime。"
          :
        fieldMessage ||
        (typeof latestProviderEvent.message === "string" && latestProviderEvent.message.trim().length > 0
          ? latestProviderEvent.message
          : "Provider 设置操作失败。"),
    });
  }, [state.eventLog]);

  useEffect(() => {
    const latestTaskEvent = state.eventLog.find(
      (event) =>
        event.type === "resource_action_result" &&
        event.resource === "task" &&
        event.action === "delete" &&
        event.session_id === state.currentSessionId,
    );
    if (!latestTaskEvent) {
      return;
    }
    const feedbackKey = [
      latestTaskEvent.session_id || "",
      latestTaskEvent.task_id || "",
      latestTaskEvent.ok ? "ok" : "error",
      typeof latestTaskEvent.message === "string" ? latestTaskEvent.message : "",
    ].join("::");
    if (processedTaskFeedbackRef.current === feedbackKey) {
      return;
    }
    processedTaskFeedbackRef.current = feedbackKey;
    setPendingTaskId(null);
    if (latestTaskEvent.ok) {
      setTaskFeedback(null);
      return;
    }
    setTaskFeedback({
      tone: "error",
      message:
        typeof latestTaskEvent.message === "string" && latestTaskEvent.message.trim().length > 0
          ? latestTaskEvent.message
          : "任务删除失败。",
    });
  }, [state.currentSessionId, state.eventLog]);

  useEffect(() => {
    const latestSkillEvent = state.eventLog.find(
      (event) =>
        event.type === "resource_action_result" &&
        event.resource === "skill" &&
        event.action === "uninstall" &&
        event.session_id === state.currentSessionId,
    );
    if (!latestSkillEvent) {
      return;
    }
    const feedbackKey = [
      latestSkillEvent.session_id || "",
      latestSkillEvent.skill_name || "",
      latestSkillEvent.ok ? "ok" : "error",
      typeof latestSkillEvent.message === "string" ? latestSkillEvent.message : "",
    ].join("::");
    if (processedSkillFeedbackRef.current === feedbackKey) {
      return;
    }
    processedSkillFeedbackRef.current = feedbackKey;
    setPendingSkillName(null);
    if (latestSkillEvent.ok) {
      setSkillFeedback(null);
      return;
    }
    setSkillFeedback({
      tone: "error",
      message:
        typeof latestSkillEvent.message === "string" && latestSkillEvent.message.trim().length > 0
          ? latestSkillEvent.message
          : "Skill 卸载失败。",
    });
  }, [state.currentSessionId, state.eventLog]);

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number };
    if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
      return;
    }
    event.preventDefault();
    void actions.sendMainMessage();
  }

  function handleThreadScroll(event: React.UIEvent<HTMLElement>) {
    const target = event.currentTarget;
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    shouldFollowThreadRef.current = distanceFromBottom <= 80;
  }

  function toggleProcess(key: string) {
    setExpandedProcessKeys((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function openSessionManager() {
    void actions.refreshRemoteSessions();
    setSessionManagerOpen(true);
  }

  function closeSessionManager() {
    setSessionManagerOpen(false);
  }

  function openModelSettings() {
    void actions.refreshProviderState();
    setModelSettingsOpen(true);
  }

  function closeModelSettings() {
    setModelSettingsOpen(false);
  }

  async function handleSaveProviderSettings() {
    if (!selectedProvider || !selectedProviderDraft) {
      return;
    }
    setProviderSettingsFeedback(null);
    setProviderSettingsBusyProvider(selectedProvider.name);
    const ok = await actions.setProviderSettings({
      provider: selectedProvider.name,
      apiKey: selectedProviderDraft.apiKey.trim() || null,
      apiBase: selectedProvider.api_base_editable ? selectedProviderDraft.apiBase.trim() || null : null,
      model: selectedProviderDraft.model.trim() || null,
      clearApiKey: false,
    });
    if (!ok) {
      setProviderSettingsBusyProvider(null);
    }
  }

  async function handleClearProviderApiKey() {
    if (!selectedProvider) {
      return;
    }
    setProviderSettingsFeedback(null);
    setProviderSettingsBusyProvider(selectedProvider.name);
    const ok = await actions.setProviderSettings({
      provider: selectedProvider.name,
      clearApiKey: true,
    });
    if (!ok) {
      setProviderSettingsBusyProvider(null);
      return;
    }
    updateSelectedProviderDraft("apiKey", "");
  }

  async function handleSetActiveProvider() {
    if (!selectedProvider || !selectedProviderDraft) {
      return;
    }
    setProviderSettingsFeedback(null);
    setProviderActivationBusyProvider(selectedProvider.name);
    const ok = await actions.setActiveProvider({
      provider: selectedProvider.name,
      model: selectedProviderDraft.model.trim() || null,
    });
    if (!ok) {
      setProviderActivationBusyProvider(null);
    }
  }

  async function handleReloadRuntime() {
    setProviderSettingsFeedback(null);
    setProviderReloading(true);
    const ok = await actions.reloadRuntime();
    if (!ok) {
      setProviderReloading(false);
    }
  }

  function updateThemePreference(themePreference: ThemePreference) {
    setPreviewThemePreference(null);
    updateProfile({ themePreference });
  }

  function updateAccentColor(accentColor: string) {
    updateProfile({ accentColor });
  }

  function getThemeSliderValue(): number {
    const preference = previewThemePreference ?? state.profile.themePreference;
    if (preference === "light") {
      return 0;
    }
    if (preference === "dark") {
      return 2;
    }
    return 1;
  }

  function getThemePreferenceFromValue(value: number): ThemePreference {
    if (value < 0.5) {
      return "light";
    }
    if (value > 1.5) {
      return "dark";
    }
    return "system";
  }

  function readThemeSliderValue(clientX: number): number {
    const rect = themeSliderRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) {
      return getThemeSliderValue();
    }
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * 2;
  }

  function handleThemeSliderPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const nextValue = readThemeSliderValue(event.clientX);
    themeSliderDragValueRef.current = nextValue;
    setThemeSliderDragValue(nextValue);
    setPreviewThemePreference(getThemePreferenceFromValue(nextValue));
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleThemeSliderPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    const nextValue = readThemeSliderValue(event.clientX);
    themeSliderDragValueRef.current = nextValue;
    setThemeSliderDragValue(nextValue);
    setPreviewThemePreference(getThemePreferenceFromValue(nextValue));
  }

  function handleThemeSliderPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const nextValue = themeSliderDragValueRef.current ?? getThemeSliderValue();
    themeSliderDragValueRef.current = null;
    setThemeSliderDragValue(null);
    updateThemePreference(getThemePreferenceFromValue(nextValue));
  }

  function handleThemeSliderPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    themeSliderDragValueRef.current = null;
    setThemeSliderDragValue(null);
    setPreviewThemePreference(null);
  }

  const themeSliderDisplayValue = themeSliderDragValue ?? getThemeSliderValue();
  const themeSliderRatio = themeSliderDisplayValue / 2;

  function openCreateTaskModal() {
    setTaskFormError(null);
    setTaskModal(buildTaskFormState());
  }

  function openEditTaskModal(task: SidebarTaskItem) {
    setTaskFormError(null);
    setTaskModal(buildTaskFormState(task));
  }

  function openSkillInstallModal() {
    setSkillForm({ source: "", file: null, error: null });
    setSkillModalOpen(true);
  }

  function openCreateMcpModal() {
    setMcpFormError(null);
    setMcpModal(buildMcpFormState());
  }

  function openCreateRemoteModal() {
    setRemoteFeedback(null);
    setRemoteFormError(null);
    setRemoteModal(buildRemoteFormState());
  }

  function openEditRemoteModal(entry: DesktopRemoteEntry) {
    setRemoteFeedback(null);
    setRemoteFormError(null);
    setRemoteModal(buildRemoteFormState(entry));
  }

  function openEditMcpModal(item: SidebarMcpItem) {
    setMcpFormError(null);
    setMcpModal(buildMcpFormState(item));
  }

  function submitRemoteModal() {
    if (!remoteModal) {
      return;
    }
    if (!remoteModal.name.trim()) {
      setRemoteFormError("远端名称不能为空。");
      return;
    }
    if (!remoteModal.host.trim() || !remoteModal.port.trim()) {
      setRemoteFormError("Host 和 Port 不能为空。");
      return;
    }
    saveRemote({
      id: remoteModal.remoteId || undefined,
      name: remoteModal.name.trim(),
      host: remoteModal.host.trim(),
      port: remoteModal.port.trim(),
      token: remoteModal.token,
    });
    setRemoteModal(null);
  }

  function handleRemoteDelete(entry: DesktopRemoteEntry) {
    if (remoteEntries.length <= 1) {
      setRemoteFeedback("至少保留一个远端，当前最后一个不能删除。");
      return;
    }
    setRemoteFeedback(`已删除远端“${entry.name}”。`);
    deleteRemote(entry.id);
  }

  async function submitTaskModal() {
    if (!taskModal) {
      return;
    }
    const instruction = taskModal.instruction.trim();
    if (!instruction) {
      setTaskFormError("任务内容不能为空。");
      return;
    }

    let scheduleCommand:
      | { type: string; payload: Record<string, unknown> }
      | null = null;
    if (taskModal.scheduleMode === "after") {
      const afterSeconds = Number(taskModal.afterSeconds);
      if (!Number.isFinite(afterSeconds) || afterSeconds <= 0) {
        setTaskFormError("延时秒数必须大于 0。");
        return;
      }
      scheduleCommand = {
        type: taskModal.mode === "create" ? "task_create_after" : "task_reschedule_after",
        payload: { after_seconds: Math.floor(afterSeconds) },
      };
    } else if (taskModal.scheduleMode === "at") {
      if (!taskModal.at.trim()) {
        setTaskFormError("请选择具体执行时间。");
        return;
      }
      scheduleCommand = {
        type: taskModal.mode === "create" ? "task_create_at" : "task_reschedule_at",
        payload: { at: new Date(taskModal.at).toISOString() },
      };
    } else if (taskModal.scheduleMode === "daily") {
      if (!taskModal.dailyTime.trim()) {
        setTaskFormError("请输入每日执行时间。");
        return;
      }
      scheduleCommand = {
        type: taskModal.mode === "create" ? "task_create_daily" : "task_reschedule_daily",
        payload: { daily_time: taskModal.dailyTime.trim() },
      };
    } else {
      const everySeconds = Number(taskModal.everySeconds);
      if (!Number.isFinite(everySeconds) || everySeconds <= 0) {
        setTaskFormError("循环秒数必须大于 0。");
        return;
      }
      scheduleCommand = {
        type: taskModal.mode === "create" ? "task_create_every" : "task_reschedule_every",
        payload: { every_seconds: Math.floor(everySeconds) },
      };
    }

    if (taskModal.mode === "create") {
      const ok = await actions.sendResourceCommand({
        type: scheduleCommand.type as never,
        session_id: state.currentSessionId,
        instruction,
        ...scheduleCommand.payload,
      });
      if (ok) {
        setTaskModal(null);
      }
      return;
    }

    if (!taskModal.taskId) {
      setTaskFormError("缺少任务 ID。");
      return;
    }
    const currentTask = state.sidebar.tasks.find((item) => item.id === taskModal.taskId);
    if (!currentTask) {
      setTaskFormError("任务已不存在。");
      return;
    }
    let ok = true;
    if (instruction !== currentTask.instruction) {
      ok = await actions.sendResourceCommand({
        type: "task_update_instruction",
        session_id: state.currentSessionId,
        task_id: taskModal.taskId,
        instruction,
      });
      if (!ok) {
        return;
      }
    }
    ok = await actions.sendResourceCommand({
      type: scheduleCommand.type as never,
      session_id: state.currentSessionId,
      task_id: taskModal.taskId,
      ...scheduleCommand.payload,
    });
    if (ok) {
      setTaskModal(null);
    }
  }

  async function handleTaskToggle(task: SidebarTaskItem) {
    await actions.sendResourceCommand({
      type: task.enabled ? "task_disable" : "task_enable",
      session_id: state.currentSessionId,
      task_id: task.id,
    });
  }

  async function handleTaskDelete(task: SidebarTaskItem) {
    setPendingTaskId(task.id);
    setTaskFeedback(null);
    const ok = await actions.sendResourceCommand({
      type: "task_delete",
      session_id: state.currentSessionId,
      task_id: task.id,
    });
    if (!ok) {
      setPendingTaskId(null);
      setTaskFeedback({
        tone: "error",
        message: `任务删除请求未发出：${task.title || task.id}`,
      });
    }
  }

  async function submitSkillInstall() {
    if (skillForm.file) {
      const uploadToken = await actions.uploadSkillZip(skillForm.file);
      if (!uploadToken) {
        return;
      }
      const ok = await actions.sendResourceCommand({
        type: "skill_install",
        session_id: state.currentSessionId,
        upload_token: uploadToken,
      });
      if (ok) {
        setSkillModalOpen(false);
      }
      return;
    }
    if (!skillForm.source.trim()) {
      setSkillForm((current) => ({ ...current, error: "请输入 Skill 来源，或选择一个 zip 包。" }));
      return;
    }
    const ok = await actions.sendResourceCommand({
      type: "skill_install",
      session_id: state.currentSessionId,
      source: skillForm.source.trim(),
    });
    if (ok) {
      setSkillModalOpen(false);
    }
  }

  async function handleSkillUninstall(name: string) {
    setPendingSkillName(name);
    setSkillFeedback(null);
    const ok = await actions.sendResourceCommand({
      type: "skill_uninstall",
      session_id: state.currentSessionId,
      skill_name: name,
    });
    if (!ok) {
      setPendingSkillName(null);
      setSkillFeedback({
        tone: "error",
        message: `Skill 卸载请求未发出：${name}`,
      });
    }
  }

  async function submitMcpModal() {
    if (!mcpModal) {
      return;
    }
    if (mcpModal.mode === "create") {
      let entries;
      try {
        entries = parseMcpInstallJson(mcpModal.json);
      } catch (error) {
        setMcpFormError(error instanceof Error ? error.message : "MCP JSON 解析失败。");
        return;
      }
      const existingNames = new Set(state.sidebar.mcpServers.map((item) => item.name));
      const duplicated = entries.find((entry) => existingNames.has(entry.name));
      if (duplicated) {
        setMcpFormError(`MCP “${duplicated.name}” 已存在，请先修改名称或删除旧配置。`);
        return;
      }
      for (const entry of entries) {
        const ok = await actions.sendResourceCommand({
          type: "mcp_create",
          session_id: state.currentSessionId,
          mcp_name: entry.name,
          mcp: entry.config,
        });
        if (!ok) {
          return;
        }
      }
      setMcpModal(null);
      return;
    }
    if (!mcpModal.name.trim()) {
      setMcpFormError("MCP 名称不能为空。");
      return;
    }
    let env: Record<string, string> = {};
    let headers: Record<string, string> = {};
    try {
      env = JSON.parse(mcpModal.env || "{}") as Record<string, string>;
      headers = JSON.parse(mcpModal.headers || "{}") as Record<string, string>;
    } catch {
      setMcpFormError("Env / Headers 必须是合法 JSON。");
      return;
    }

    const commandPayload = {
      enabled: mcpModal.enabled,
      type: mcpModal.transport,
      command: mcpModal.command.trim(),
      args: mcpModal.args.split(/\s+/).filter(Boolean),
      url: mcpModal.url.trim(),
      enabled_tools: mcpModal.enabledTools
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      env,
      headers,
    };
    const ok = await actions.sendResourceCommand({
      type: "mcp_update",
      session_id: state.currentSessionId,
      mcp_name: mcpModal.name.trim(),
      mcp: commandPayload,
    });
    if (ok) {
      setMcpModal(null);
    }
  }

  async function handleMcpToggle(item: SidebarMcpItem) {
    await actions.sendResourceCommand({
      type: item.enabled ? "mcp_disable" : "mcp_enable",
      session_id: state.currentSessionId,
      mcp_name: item.name,
    });
  }

  async function handleMcpDelete(item: SidebarMcpItem) {
    if (!window.confirm(`确认删除 MCP “${item.name}”吗？`)) {
      return;
    }
    await actions.sendResourceCommand({
      type: "mcp_delete",
      session_id: state.currentSessionId,
      mcp_name: item.name,
    });
  }

  return (
    <div
      className={[
        "desktop-chat-shell",
        sidebarCollapsed ? "sidebar-collapsed" : "",
        showHomePrototype ? "view-home" : "view-thread",
      ].filter(Boolean).join(" ")}
    >
      {bannerNotification ? (
        <BannerNotification
          key={bannerNotification.id}
          tone={bannerNotification.tone}
          message={bannerNotification.message}
          onClose={() => dismissBannerNotification()}
        />
      ) : null}
      <aside className="desktop-sidebar">
        <section className="sidebar-section">
          <div className="sidebar-section-label">当前远端</div>
          <div className="sidebar-status-card">
            <div className="sidebar-status-row">
              <span className="status-dot" />
              <span>{connectionLabel}</span>
            </div>
            <div className="sidebar-status-detail">{workspaceSummary}</div>
            <div className="sidebar-status-copy">{connectionDetailLabel}</div>
          </div>
        </section>

        <section className="sidebar-section">
          <SidebarDisclosure
            title="远端"
            count={remoteEntries.length}
            action={(
              <button
                type="button"
                className="sidebar-inline-button secondary sidebar-disclosure-action-button"
                aria-label="新建远端"
                onClick={openCreateRemoteModal}
              >
                <span className="sidebar-disclosure-action-label">新建</span>
                <Icon name="plus" className="sidebar-disclosure-action-icon" />
              </button>
            )}
          >
            <div className="sidebar-entity-list">
              {remoteEntries.map((entry) => {
                const isActive = entry.id === activeRemoteId;
                const showConnectedActions = isActive && state.connectionStatus === "connected";
                const showConnectingActions = isActive && state.connectionStatus === "connecting";
                return (
                  <article key={entry.id} className="sidebar-entity-card compact">
                    <div className="sidebar-entity-title-row">
                      <div className="sidebar-entity-title">{entry.name}</div>
                      <span className={`sidebar-badge ${isActive ? "success" : "muted"}`}>
                        {isActive ? "当前" : "待命"}
                      </span>
                    </div>
                    <div className="sidebar-entity-primary">
                      {entry.profile.host}:{entry.profile.port}
                    </div>
                      <div className="sidebar-entity-meta">
                        {entry.profile.token ? "已配置 token" : "未配置 token"}
                      </div>
                    <div className="sidebar-card-actions">
                      {isActive ? (
                        <>
                          <button
                            type="button"
                            className="sidebar-inline-button"
                            onClick={
                              showConnectedActions ? disconnectRemote : () => connectRemote(entry.id)
                            }
                            disabled={showConnectingActions}
                          >
                            {showConnectingActions ? "连接中..." : showConnectedActions ? "断开" : "连接"}
                          </button>
                          <button
                            type="button"
                            className="sidebar-inline-button secondary"
                            onClick={() => reconnectRemote(entry.id)}
                            disabled={showConnectingActions}
                          >
                            重连
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="sidebar-inline-button"
                          onClick={() => connectRemote(entry.id)}
                        >
                          连接
                        </button>
                      )}
                      <SidebarMoreMenu
                        items={[
                          {
                            label: "编辑",
                            onClick: () => openEditRemoteModal(entry),
                          },
                          {
                            label: "删除",
                            danger: true,
                            disabled: remoteEntries.length <= 1,
                            onClick: () => handleRemoteDelete(entry),
                          },
                        ]}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          </SidebarDisclosure>
        </section>

        <section className="sidebar-section">
          <SidebarDisclosure
            title="任务"
            count={state.sidebar.tasks.length}
            action={(
              <button
                type="button"
                className="sidebar-inline-button secondary sidebar-disclosure-action-button"
                aria-label="新建任务"
                onClick={openCreateTaskModal}
                disabled={resourceActionsDisabled}
              >
                <span className="sidebar-disclosure-action-label">新建</span>
                <Icon name="plus" className="sidebar-disclosure-action-icon" />
              </button>
            )}
          >
            {state.sidebar.tasks.length === 0
              ? renderEmptyState(
                state.ownerReady && state.sidebarReady
                  ? "当前远端还没有可显示的自动任务。"
                  : "等待当前 remote 同步任务列表。",
              )
              : (
                <div className="sidebar-task-groups">
                  {taskGroups.map((group) => (
                    <section key={group.key} className="sidebar-task-group">
                      <div className="sidebar-task-group-header">
                        <span>{group.label}</span>
                        <span>{group.tasks.length}</span>
                      </div>
                      <div className="sidebar-entity-list">
                        {group.tasks.map((task) => {
                          const taskInstructionSummary = getTaskInstructionSummary(task);
                          return (
                            <article key={task.id} className="sidebar-entity-card">
                              <div className="sidebar-entity-title-row">
                                <div className="sidebar-entity-title">{task.title || task.id}</div>
                                <span className={`sidebar-badge ${task.enabled ? "success" : "muted"}`}>
                                  {task.enabled ? "启用" : "停用"}
                                </span>
                              </div>
                              <div className="sidebar-entity-primary">下次执行 · {formatTaskTime(task)}</div>
                              <div className="sidebar-entity-meta">{formatTaskCompactMeta(task)}</div>
                              {taskInstructionSummary ? (
                                <div className="sidebar-entity-copy compact">{taskInstructionSummary}</div>
                              ) : null}
                              <div className="sidebar-card-actions">
                                <button
                                  type="button"
                                  className="sidebar-inline-button secondary"
                                  onClick={() => openEditTaskModal(task)}
                                  disabled={resourceActionsDisabled}
                                >
                                  编辑
                                </button>
                                <button
                                  type="button"
                                  className="sidebar-inline-button secondary"
                                  onClick={() => void handleTaskToggle(task)}
                                  disabled={resourceActionsDisabled}
                                >
                                  {task.enabled ? "停用" : "启用"}
                                </button>
                                {pendingTaskId === task.id ? (
                                  <button
                                    type="button"
                                    className="sidebar-inline-button secondary"
                                    disabled
                                  >
                                    删除中...
                                  </button>
                                ) : (
                                  <SidebarMoreMenu
                                    items={[
                                      {
                                        label: "删除",
                                        danger: true,
                                        disabled: resourceActionsDisabled || pendingTaskId !== null,
                                        onClick: () => {
                                          void handleTaskDelete(task);
                                        },
                                      },
                                    ]}
                                  />
                                )}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
          </SidebarDisclosure>
        </section>

        <section className="sidebar-section">
          <SidebarDisclosure
            title="Skills"
            count={state.sidebar.skills.length}
            action={(
              <button
                type="button"
                className="sidebar-inline-button secondary sidebar-disclosure-action-button"
                aria-label="安装 Skill"
                onClick={openSkillInstallModal}
                disabled={resourceActionsDisabled}
              >
                <span className="sidebar-disclosure-action-label">安装</span>
                <Icon name="plus" className="sidebar-disclosure-action-icon" />
              </button>
            )}
          >
            <div className="sidebar-entity-list">
              {state.sidebar.skills.length === 0
                ? renderEmptyState(
                  state.ownerReady && state.sidebarReady
                    ? "当前远端 skills 目录还是空的。"
                    : "等待当前 remote 同步 Skills。",
                )
                : state.sidebar.skills.map((skill) => (
                  <article key={skill.path} className="sidebar-entity-card compact">
                    <div className="sidebar-entity-title-row">
                      <div className="sidebar-entity-title">{skill.name}</div>
                      <button
                        type="button"
                        className="sidebar-inline-button danger"
                        onClick={() => void handleSkillUninstall(skill.name)}
                        disabled={resourceActionsDisabled || pendingSkillName !== null}
                      >
                        {pendingSkillName === skill.name ? "卸载中..." : "卸载"}
                      </button>
                    </div>
                    <div className="sidebar-entity-meta">{formatSkillSummary(skill.path)}</div>
                  </article>
                ))}
            </div>
          </SidebarDisclosure>
        </section>

        <section className="sidebar-section">
          <SidebarDisclosure
            title="MCP"
            count={state.sidebar.mcpServers.length}
            action={(
              <button
                type="button"
                className="sidebar-inline-button secondary sidebar-disclosure-action-button"
                aria-label="新建 MCP"
                onClick={openCreateMcpModal}
                disabled={resourceActionsDisabled}
              >
                <span className="sidebar-disclosure-action-label">新建</span>
                <Icon name="plus" className="sidebar-disclosure-action-icon" />
              </button>
            )}
          >
            <div className="sidebar-entity-list">
              {state.sidebar.mcpServers.length === 0
                ? renderEmptyState(
                  state.ownerReady && state.sidebarReady
                    ? "当前远端配置里还没有 MCP server。"
                    : "等待当前 remote 同步 MCP。",
                )
                : state.sidebar.mcpServers.map((item) => (
                  <article key={item.name} className="sidebar-entity-card compact">
                    <div className="sidebar-entity-title-row">
                      <div className="sidebar-entity-title">{item.name}</div>
                      <span className={`sidebar-badge ${item.enabled ? "success" : "muted"}`}>
                        {item.enabled ? "启用" : "停用"}
                      </span>
                    </div>
                    <div className="sidebar-entity-meta">{formatMcpSummary(item)}</div>
                    <div className="sidebar-card-actions">
                      <button
                        type="button"
                        className="sidebar-inline-button secondary"
                        onClick={() => openEditMcpModal(item)}
                        disabled={resourceActionsDisabled}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="sidebar-inline-button secondary"
                        onClick={() => void handleMcpToggle(item)}
                        disabled={resourceActionsDisabled}
                      >
                        {item.enabled ? "停用" : "启用"}
                      </button>
                      <SidebarMoreMenu
                        items={[
                          {
                            label: "删除",
                            danger: true,
                            disabled: resourceActionsDisabled,
                            onClick: () => {
                              void handleMcpDelete(item);
                            },
                          },
                        ]}
                      />
                    </div>
                  </article>
                ))}
            </div>
          </SidebarDisclosure>
        </section>

        <details className="sidebar-debug">
          <summary>高级设置</summary>
          <div className="sidebar-debug-body">
            <div className="control-actions">
              <button
                className="secondary"
                type="button"
                onClick={() => void actions.createNewSession()}
                disabled={sessionListState.creating || Boolean(sessionListState.bindingSessionId)}
              >
                新建 session
              </button>
              <button
                className="danger"
                type="button"
                onClick={() => {
                  if (!window.confirm("确认清空当前远端运行态吗？会保留 config 和认证信息。")) {
                    return;
                  }
                  void actions.clearRuntimeState();
                }}
                disabled={resourceActionsDisabled}
              >
                清空远端运行态
              </button>
            </div>
            <section className="debug-panel">
              <h2>状态快照</h2>
              <pre>{JSON.stringify(state.sessionState.lastStatus, null, 2) || "暂无状态"}</pre>
            </section>
            <section className="debug-panel">
              <h2>事件流</h2>
              <div className="event-list overlay">
                {state.eventLog.map((event, index) => (
                  <article key={`${event.type}-${index}`} className="event">
                    <div className="meta">{event.type}</div>
                    <pre>{JSON.stringify(event, null, 2)}</pre>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </details>
      </aside>

      <main className="desktop-chat-main">
        <header className="chat-header">
          <div className="chat-header-main with-toggle">
            <button
              className="header-icon-button sidebar-toggle-button"
              type="button"
              aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
              onClick={toggleSidebar}
            >
              <Icon name="panel-left" />
            </button>
            <div className="chat-header-copy">
              <div className="chat-header-row">
                <div className="chat-header-title">Nomi</div>
                <span className={`chat-header-pill ${state.connectionStatus}`}>{connectionLabel}</span>
              </div>
            </div>
          </div>
          <div className="chat-header-actions" ref={settingsMenuRef}>
            <div className="chat-header-actions-shell">
              <button
                className={`header-icon-button settings-trigger${settingsMenuOpen ? " active" : ""}`}
                type="button"
                aria-label="打开设置菜单"
                aria-expanded={settingsMenuOpen}
                onClick={() => setSettingsMenuOpen((current) => !current)}
              >
                <Icon name="more-horizontal" />
              </button>
            </div>
            <div className={`settings-prototype-popover${settingsMenuOpen ? " open" : ""}`}>
              <div className="settings-prototype-title">设置</div>
              <div className="settings-prototype-body">
                <button
                  type="button"
                  className="settings-menu-button"
                  onClick={() => {
                    setSettingsMenuOpen(false);
                    openModelSettings();
                  }}
                >
                  <span>模型设置</span>
                  <span className="settings-menu-button-meta">待接入</span>
                </button>
                <button
                  type="button"
                  className="settings-menu-button"
                  onClick={() => {
                    setSettingsMenuOpen(false);
                    openSessionManager();
                  }}
                >
                  <span>会话管理</span>
                  <span className="settings-menu-button-meta">
                    {sessionListState.totalCount ?? sessionListState.items.length}
                  </span>
                </button>
                <div className="settings-slider-block">
                  <div
                    ref={themeSliderRef}
                    className="settings-theme-slider"
                    role="slider"
                    aria-label="主题模式"
                    aria-valuemin={0}
                    aria-valuemax={2}
                    aria-valuenow={Math.round(themeSliderDisplayValue)}
                    onPointerDown={handleThemeSliderPointerDown}
                    onPointerMove={handleThemeSliderPointerMove}
                    onPointerUp={handleThemeSliderPointerUp}
                    onPointerCancel={handleThemeSliderPointerCancel}
                  >
                    <div className="settings-theme-slider-segments" aria-hidden="true">
                      <span className="settings-theme-slider-segment">浅色</span>
                      <span className="settings-theme-slider-segment">跟随系统</span>
                      <span className="settings-theme-slider-segment">深色</span>
                    </div>
                    <div className="settings-theme-slider-track" />
                    <div
                      className="settings-theme-slider-thumb"
                      style={{ left: `calc(16px + ${themeSliderRatio} * (100% - 32px))` }}
                    />
                  </div>
                </div>
                <div className="settings-accent-block">
                  <div className="settings-accent-header">
                    <span>主题色</span>
                    <span className="settings-accent-value">
                      {(state.profile.accentColor || DEFAULT_ACCENT_COLOR).toUpperCase()}
                    </span>
                  </div>
                  <div className="settings-accent-grid">
                    {ACCENT_PRESETS.map((preset) => {
                      const active =
                        (state.profile.accentColor || DEFAULT_ACCENT_COLOR).toLowerCase() ===
                        preset.color.toLowerCase();
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className={`settings-accent-swatch${active ? " active" : ""}`}
                          aria-label={`切换主题色到${preset.label}`}
                          title={preset.label}
                          onClick={() => updateAccentColor(preset.color)}
                          style={{ "--swatch-color": preset.color } as JSX.IntrinsicElements["button"]["style"]}
                        />
                      );
                    })}
                    <label className="settings-accent-custom" title="自定义主题色">
                      <input
                        type="color"
                        value={state.profile.accentColor || DEFAULT_ACCENT_COLOR}
                        aria-label="自定义主题色"
                        onChange={(event) => updateAccentColor(event.target.value)}
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section
          ref={threadScrollerRef}
          className={`chat-thread-scroller${showHomePrototype ? " home-mode" : ""}`}
          onScroll={handleThreadScroll}
        >
          <div
            ref={threadContentRef}
            className={`chat-thread ${showHomePrototype ? "is-home" : "is-thread"}`}
          >
            {showHomePrototype ? (
              <section className="home-prototype" aria-label="Nomi 首页原型">
                <div className="home-prototype-hero">
                  <h1 className="home-prototype-title">今天想聊点什么？</h1>
                  <p className="home-prototype-copy">提问题，发图片，继续你的对话。</p>
                </div>
              </section>
            ) : null}
            {threadItems.map((item) => {
              if (item.kind === "process") {
                const expanded = Boolean(expandedProcessKeys[item.key]);
                return (
                  <article key={item.key} className="chat-process-block">
                    <button
                      className={`process-block-toggle ${expanded ? "expanded" : ""}`}
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => toggleProcess(item.key)}
                    >
                      <div className="process-block-main">
                        <div className="process-block-title-row">
                          <span className="process-block-title">{item.title}</span>
                          <span className="process-block-status">{item.statusLabel}</span>
                        </div>
                        <div className="process-block-summary">{item.summary}</div>
                      </div>
                      <Icon name="chevron-down" className="process-block-icon" />
                    </button>
                    <div className={`process-block-panel ${expanded ? "expanded" : ""}`}>
                      <div className="process-block-inner">
                        <div className="progress-message-scroll">
                          {item.entries.map((entry) => (
                            <div key={entry.id} className="process-block-entry">
                              <div className="process-block-entry-label">
                                {entry.role === "tool_hint" ? "过程提示" : "处理中"}
                              </div>
                              <div className="message-surface process-entry-surface">
                                <AnimatedMessageContent content={entry.content} animate={false} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              }

              const { message } = item;
              const presentation = getMessagePresentation(message);
              const isAssistant = message.kind === "assistant";
              const isUser = message.kind === "user";
              const isTask = message.kind === "task";
              const showAvatar = isAssistant;
              return (
                <article
                  key={item.key}
                  className={[
                    "chat-message",
                    `tone-${presentation.tone}`,
                    `status-${message.status}`,
                    isUser ? "is-user" : "",
                    isAssistant ? "is-assistant" : "",
                    isTask ? "is-task" : "",
                  ].filter(Boolean).join(" ")}
                >
                  {showAvatar ? <div className="message-avatar">N</div> : null}
                  <div className="message-body">
                    {isTask ? (
                      <div className="message-system-head">
                        <span className="message-kicker">{presentation.label}</span>
                        <span className="message-system-status">{presentation.statusLabel}</span>
                      </div>
                    ) : null}
                    <div className={`message-surface ${isAssistant ? "plain" : ""}`}>
                      <AnimatedMessageContent
                        content={message.content}
                        animate={message.kind === "assistant" && message.status !== "history"}
                      />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <footer className="chat-composer-shell">
          <div className="chat-composer">
            <div className="composer-row">
              <textarea
                ref={composerRef}
                className="composer-input"
                aria-label="消息输入"
                value={draftInput}
                onChange={(event) => actions.setDraftInput(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={composerHint || "Message Nomi"}
                rows={1}
              />
              <button
                className="send-button"
                type="button"
                onClick={() => void actions.sendMainMessage()}
                aria-label="发送消息"
                disabled={sendDisabled}
              >
                <Icon name="send" className="send-icon" />
              </button>
            </div>
          </div>
        </footer>
      </main>

      {sessionManagerRendered ? (
        <ActionModal
          title="会话管理"
          onClose={closeSessionManager}
          visualState={sessionManagerClosing ? "closing" : sessionManagerVisible ? "open" : "closing"}
          dialogClassName="session-manager-dialog"
        >
          <div className="session-manager-panel model-settings-shell">
            <div className="session-manager-copy">
              这里展示当前远端保存的全部会话，默认按创建时间从近到远排序。
            </div>
            {sessionListState.error ? <div className="overlay-error">{sessionListState.error}</div> : null}
            <div className="session-manager-list">
              {sessionListState.loading && sessionListState.items.length === 0 ? (
                <div className="sidebar-empty-state">正在加载会话列表...</div>
              ) : null}
              {!sessionListState.loading && sessionListState.items.length === 0 ? (
                <div className="sidebar-empty-state">当前远端还没有历史会话。</div>
              ) : null}
              {sessionChannelGroups.map((group) => (
                <section key={group.key} className="session-manager-group">
                  <div className="session-manager-group-header">
                    <span>{group.label}</span>
                    <span>{group.items.length}</span>
                  </div>
                  <div className="session-manager-group-list">
                    {group.items.map((session) => {
                      const isActive = session.sessionId === state.currentSessionId;
                      const isBinding = sessionListState.bindingSessionId === session.sessionId;
                      return (
                        <div
                          key={session.sessionId}
                          className={`session-manager-item${isActive ? " active" : ""}`}
                        >
                          <button
                            type="button"
                            className="session-manager-select"
                            onClick={() => {
                              void selectSession(session.sessionId);
                              closeSessionManager();
                            }}
                            disabled={isBinding}
                          >
                            <div className="session-manager-item-row compact">
                              <div className="session-manager-item-title mono">
                                {shortenSessionId(session.sessionId)}
                              </div>
                              <div className="session-manager-item-badges">
                                {isActive ? <span className="session-manager-badge active">当前</span> : null}
                                {!isActive && isBinding ? (
                                  <span className="session-manager-badge">切换中</span>
                                ) : null}
                              </div>
                            </div>
                            <div className="session-manager-item-meta">
                              更新于 {formatSessionTimestamp(session.updatedAtMs || session.createdAtMs)} ·{" "}
                              {typeof session.messageCount === "number" ? `${session.messageCount} 条消息` : "消息数未知"}
                            </div>
                          </button>
                          <div className="session-manager-row-actions">
                            <button
                              type="button"
                              className="sidebar-inline-button danger"
                              disabled={
                                isActive ||
                                isBinding ||
                                sessionListState.deletingSessionId === session.sessionId
                              }
                              onClick={() => {
                                void actions.deleteRemoteSession(session.sessionId);
                              }}
                            >
                              {sessionListState.deletingSessionId === session.sessionId
                                ? "删除中..."
                                : isBinding
                                  ? "切换中..."
                                  : "删除"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
            <div className="session-manager-actions">
              <button
                className="sidebar-inline-button"
                type="button"
                onClick={() => {
                  void actions.createNewSession();
                }}
                disabled={sessionListState.creating || Boolean(sessionListState.bindingSessionId)}
              >
                {sessionListState.creating ? (
                  <>
                    <Icon name="spinner" className="session-manager-spinner" />
                    创建中...
                  </>
                ) : Boolean(sessionListState.bindingSessionId) ? (
                  <>
                    <Icon name="spinner" className="session-manager-spinner" />
                    绑定中...
                  </>
                ) : (
                  "新建会话"
                )}
              </button>
              <button
                className="sidebar-inline-button secondary"
                type="button"
                onClick={() => void actions.refreshRemoteSessions()}
                disabled={sessionListState.loading}
              >
                刷新列表
              </button>
              {sessionListState.nextPageToken ? (
                <button
                  className="sidebar-inline-button secondary"
                  type="button"
                  onClick={() => void actions.loadMoreRemoteSessions()}
                  disabled={sessionListState.loadingMore}
                >
                  {sessionListState.loadingMore ? "加载中..." : "加载更多"}
                </button>
              ) : null}
            </div>
          </div>
        </ActionModal>
      ) : null}

      {modelSettingsRendered ? (
        <ActionModal
          title="模型设置"
          onClose={closeModelSettings}
          visualState={modelSettingsClosing ? "closing" : modelSettingsVisible ? "open" : "closing"}
          dialogClassName="session-manager-dialog model-settings-dialog"
        >
          <div className="session-manager-panel model-settings-shell">
            {providerManagementItems.length === 0 ? (
              <div className="sidebar-empty-state">当前 remote 还没有返回 provider 列表。</div>
            ) : (
              <div className="model-settings-layout">
                <div className="model-settings-provider-panel">
                  <div className="model-settings-provider-list">
                    {providerManagementItems.map((provider) => {
                      const active = provider.name === selectedProvider?.name;
                      const isCurrentActive = activeProviderSelection?.provider === provider.name;
                      return (
                        <button
                          key={provider.name}
                          type="button"
                          className={`model-settings-provider-chip${active ? " active" : ""}`}
                          onClick={() => setSelectedModelProviderName(provider.name)}
                        >
                          <span className="model-settings-provider-chip-copy">
                            <span className="model-settings-provider-chip-title">
                              {provider.display_name || provider.name}
                            </span>
                            <span className="model-settings-provider-chip-meta">
                              {provider.name}
                            </span>
                          </span>
                          <span className={`session-manager-badge${isCurrentActive ? " active" : ""}`}>
                            {isCurrentActive ? "当前" : provider.api_base_editable ? "可编辑" : "只读"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {selectedProvider && selectedProviderDraft ? (
                  <div className="model-settings-detail-panel">
                    <article className="model-settings-card">
                      <div className="model-settings-card-header">
                        <div className="model-settings-card-copy">
                          <div className="model-settings-card-title">
                            {selectedProvider.display_name || selectedProvider.name}
                          </div>
                          <div className="model-settings-card-subtitle">
                            {selectedProvider.name} · {selectedProvider.backend}
                          </div>
                        </div>
                        <span className="session-manager-badge">
                          {activeProviderSelection?.provider === selectedProvider.name ? "当前生效" : "未生效"}
                        </span>
                      </div>
                      <div className="model-settings-badges">
                        {buildProviderCapabilityBadges(selectedProvider).map((badge) => (
                          <span key={badge} className="sidebar-badge muted">
                            {badge}
                          </span>
                        ))}
                      </div>
                      {selectedProviderState?.api_key_set ? (
                        <div className="overlay-hint">
                          已保存的 apiKey：{selectedProviderState.api_key_preview || "已设置"}
                        </div>
                      ) : null}
                      <label className="model-settings-field">
                        <span className="model-settings-field-label">apiKey</span>
                        <input
                          type="password"
                          value={selectedProviderDraft.apiKey}
                          onChange={(event) => updateSelectedProviderDraft("apiKey", event.target.value)}
                          placeholder="请输入 apiKey"
                        />
                      </label>
                      {selectedProviderState?.api_key_set ? (
                        <div className="model-settings-actions compact">
                          <button
                            className="sidebar-inline-button secondary"
                            type="button"
                            onClick={() => void handleClearProviderApiKey()}
                            disabled={providerActionBusy}
                          >
                            {selectedProviderIsSaving ? "处理中..." : "清空已保存 apiKey"}
                          </button>
                        </div>
                      ) : null}
                      <label className="model-settings-field">
                        <span className="model-settings-field-label">model</span>
                        <input
                          type="text"
                          value={selectedProviderDraft.model}
                          onChange={(event) => updateSelectedProviderDraft("model", event.target.value)}
                          placeholder="例如 gpt-4.1 / deepseek-chat"
                        />
                      </label>
                      <label className="model-settings-field">
                        <span className="model-settings-field-label">apiBase</span>
                        <input
                          type="text"
                          value={selectedProviderDraft.apiBase || selectedProvider.default_api_base || ""}
                          onChange={(event) => updateSelectedProviderDraft("apiBase", event.target.value)}
                          readOnly={!selectedProvider.api_base_editable}
                          disabled={!selectedProvider.api_base_editable}
                        />
                      </label>
                      <div className="overlay-hint">
                        {selectedProvider.api_base_editable
                          ? "当前 provider 允许编辑 apiBase。"
                          : selectedProvider.default_api_base
                            ? `该 provider 由 core 固定 apiBase：${selectedProvider.default_api_base}`
                            : "该 provider 不允许在 desktop 侧修改 apiBase。"}
                      </div>
                      <div className="overlay-hint">
                        当前生效：{activeProviderSelection?.provider || "未设置"}
                        {activeProviderSelection?.model ? ` / ${activeProviderSelection.model}` : ""}
                        {state.providerState?.apply_mode === "reload_runtime"
                          ? " · 修改后需要 reload runtime 才会完整生效。"
                          : ""}
                      </div>
                      {providerSettingsFeedback ? (
                        <div
                          className={
                            providerSettingsFeedback.tone === "error" ? "overlay-error" : "overlay-hint"
                          }
                        >
                          {providerSettingsFeedback.message}
                        </div>
                      ) : null}
                      <div className="model-settings-actions">
                        <button
                          className="sidebar-inline-button"
                          type="button"
                          onClick={() => void handleSaveProviderSettings()}
                          disabled={providerActionBusy}
                        >
                          {selectedProviderIsSaving
                            ? "保存中..."
                            : providerReloading
                              ? "应用中..."
                              : "保存设置"}
                        </button>
                        <button
                          className="sidebar-inline-button secondary"
                          type="button"
                          onClick={() => void handleSetActiveProvider()}
                          disabled={selectedProviderIsActivating || providerReloading || resourceActionsDisabled}
                        >
                          {selectedProviderIsActivating || providerReloading
                            ? "应用中..."
                            : "设为当前模型"}
                        </button>
                        <button
                          className="sidebar-inline-button secondary"
                          type="button"
                          onClick={() => void actions.refreshProviderState()}
                        >
                          刷新状态
                        </button>
                        <button
                          className="sidebar-inline-button secondary"
                          type="button"
                          onClick={() => void handleReloadRuntime()}
                          disabled={providerReloading || resourceActionsDisabled}
                        >
                          {providerReloading ? "Reload 中..." : "Reload Runtime"}
                        </button>
                      </div>
                    </article>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </ActionModal>
      ) : null}

      {taskModal ? (
        <ActionModal
          title={taskModal.mode === "create" ? "新建任务" : "编辑任务"}
          onClose={() => setTaskModal(null)}
        >
          <div className="overlay-form">
            <label>
              任务内容
              <textarea
                value={taskModal.instruction}
                onChange={(event) =>
                  setTaskModal((current) => (current ? { ...current, instruction: event.target.value } : current))
                }
                rows={4}
              />
            </label>
            <label>
              时间类型
              <select
                value={taskModal.scheduleMode}
                onChange={(event) =>
                  setTaskModal((current) =>
                    current
                      ? { ...current, scheduleMode: event.target.value as TaskScheduleMode }
                      : current,
                  )
                }
              >
                <option value="after">after</option>
                <option value="at">at</option>
                <option value="daily">daily</option>
                <option value="every">every</option>
              </select>
            </label>
            {taskModal.scheduleMode === "after" ? (
              <label>
                延时秒数
                <input
                  value={taskModal.afterSeconds}
                  onChange={(event) =>
                    setTaskModal((current) =>
                      current ? { ...current, afterSeconds: event.target.value } : current,
                    )
                  }
                />
              </label>
            ) : null}
            {taskModal.scheduleMode === "at" ? (
              <label>
                执行时间
                <input
                  type="datetime-local"
                  value={taskModal.at}
                  onChange={(event) =>
                    setTaskModal((current) => (current ? { ...current, at: event.target.value } : current))
                  }
                />
              </label>
            ) : null}
            {taskModal.scheduleMode === "daily" ? (
              <label>
                每日时间
                <input
                  type="time"
                  value={taskModal.dailyTime}
                  onChange={(event) =>
                    setTaskModal((current) =>
                      current ? { ...current, dailyTime: event.target.value } : current,
                    )
                  }
                />
              </label>
            ) : null}
            {taskModal.scheduleMode === "every" ? (
              <label>
                循环秒数
                <input
                  value={taskModal.everySeconds}
                  onChange={(event) =>
                    setTaskModal((current) =>
                      current ? { ...current, everySeconds: event.target.value } : current,
                    )
                  }
                />
              </label>
            ) : null}
            {taskFormError ? <div className="overlay-error">{taskFormError}</div> : null}
            <div className="overlay-actions">
              <button type="button" className="secondary" onClick={() => setTaskModal(null)}>
                取消
              </button>
              <button type="button" onClick={() => void submitTaskModal()}>
                保存
              </button>
            </div>
          </div>
        </ActionModal>
      ) : null}

      {skillModalOpen ? (
        <ActionModal title="安装 Skill" onClose={() => setSkillModalOpen(false)}>
          <div className="overlay-form">
            <label>
              远端来源
              <input
                value={skillForm.source}
                onChange={(event) =>
                  setSkillForm((current) => ({ ...current, source: event.target.value, error: null }))
                }
                placeholder="本地路径 / 下载链接 / Git 链接"
              />
            </label>
            <label>
              或上传 zip
              <input
                type="file"
                accept=".zip"
                onChange={(event) =>
                  setSkillForm((current) => ({
                    ...current,
                    file: event.target.files?.[0] || null,
                    error: null,
                  }))
                }
              />
            </label>
            {skillForm.error ? <div className="overlay-error">{skillForm.error}</div> : null}
            <div className="overlay-actions">
              <button type="button" className="secondary" onClick={() => setSkillModalOpen(false)}>
                取消
              </button>
              <button type="button" onClick={() => void submitSkillInstall()}>
                安装
              </button>
            </div>
          </div>
        </ActionModal>
      ) : null}

      {mcpModal ? (
        <ActionModal
          title={mcpModal.mode === "create" ? "新建 MCP" : `编辑 MCP · ${mcpModal.name}`}
          onClose={() => setMcpModal(null)}
        >
          <div className="overlay-form">
            {mcpModal.mode === "create" ? (
              <>
                <label>
                  MCP JSON
                  <textarea
                    className="overlay-code-input"
                    value={mcpModal.json}
                    onChange={(event) =>
                      setMcpModal((current) => (current ? { ...current, json: event.target.value } : current))
                    }
                    rows={16}
                    placeholder={`{\n  "mcpServers": {\n    "12306-mcp": {\n      "command": "npx",\n      "args": ["-y", "12306-mcp"]\n    }\n  }\n}`}
                  />
                </label>
                <div className="overlay-hint">
                  支持直接粘贴 <code>mcpServers</code> JSON。一次可以安装一个或多个 MCP server。
                </div>
              </>
            ) : (
              <>
                <label>
                  名称
                  <input
                    value={mcpModal.name}
                    disabled={mcpModal.mode === "edit"}
                    onChange={(event) =>
                      setMcpModal((current) => (current ? { ...current, name: event.target.value } : current))
                    }
                  />
                </label>
                <label>
                  Transport
                  <select
                    value={mcpModal.transport}
                    onChange={(event) =>
                      setMcpModal((current) =>
                        current ? { ...current, transport: event.target.value } : current,
                      )
                    }
                  >
                    <option value="stdio">stdio</option>
                    <option value="sse">sse</option>
                    <option value="streamableHttp">streamableHttp</option>
                  </select>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={mcpModal.enabled}
                    onChange={(event) =>
                      setMcpModal((current) =>
                        current ? { ...current, enabled: event.target.checked } : current,
                      )
                    }
                  />
                  启用
                </label>
                <label>
                  Command
                  <input
                    value={mcpModal.command}
                    onChange={(event) =>
                      setMcpModal((current) => (current ? { ...current, command: event.target.value } : current))
                    }
                  />
                </label>
                <label>
                  Args
                  <input
                    value={mcpModal.args}
                    onChange={(event) =>
                      setMcpModal((current) => (current ? { ...current, args: event.target.value } : current))
                    }
                    placeholder="空格分隔"
                  />
                </label>
                <label>
                  URL
                  <input
                    value={mcpModal.url}
                    onChange={(event) =>
                      setMcpModal((current) => (current ? { ...current, url: event.target.value } : current))
                    }
                  />
                </label>
                <label>
                  Enabled tools
                  <input
                    value={mcpModal.enabledTools}
                    onChange={(event) =>
                      setMcpModal((current) =>
                        current ? { ...current, enabledTools: event.target.value } : current,
                      )
                    }
                    placeholder="逗号分隔，默认 *"
                  />
                </label>
                <label>
                  Env JSON
                  <textarea
                    value={mcpModal.env}
                    onChange={(event) =>
                      setMcpModal((current) => (current ? { ...current, env: event.target.value } : current))
                    }
                    rows={4}
                  />
                </label>
                <label>
                  Headers JSON
                  <textarea
                    value={mcpModal.headers}
                    onChange={(event) =>
                      setMcpModal((current) => (current ? { ...current, headers: event.target.value } : current))
                    }
                    rows={4}
                  />
                </label>
              </>
            )}
            {mcpFormError ? <div className="overlay-error">{mcpFormError}</div> : null}
            <div className="overlay-actions">
              <button type="button" className="secondary" onClick={() => setMcpModal(null)}>
                取消
              </button>
              <button type="button" onClick={() => void submitMcpModal()}>
                {mcpModal.mode === "create" ? "安装" : "保存"}
              </button>
            </div>
          </div>
        </ActionModal>
      ) : null}

      {remoteModal ? (
        <ActionModal
          title={remoteModal.mode === "create" ? "新建远端" : `编辑远端 · ${remoteModal.name}`}
          onClose={() => setRemoteModal(null)}
        >
          <div className="overlay-form">
            <label>
              名称
              <input
                value={remoteModal.name}
                onChange={(event) =>
                  setRemoteModal((current) => (current ? { ...current, name: event.target.value } : current))
                }
                placeholder="例如：本地开发 / 线上测试"
              />
            </label>
            <label>
              Host
              <input
                value={remoteModal.host}
                onChange={(event) =>
                  setRemoteModal((current) => (current ? { ...current, host: event.target.value } : current))
                }
              />
            </label>
            <label>
              Port
              <input
                value={remoteModal.port}
                onChange={(event) =>
                  setRemoteModal((current) => (current ? { ...current, port: event.target.value } : current))
                }
              />
            </label>
            <label>
              Token
              <input
                type="password"
                value={remoteModal.token}
                onChange={(event) =>
                  setRemoteModal((current) => (current ? { ...current, token: event.target.value } : current))
                }
              />
            </label>
            {remoteFormError ? <div className="overlay-error">{remoteFormError}</div> : null}
            <div className="overlay-actions">
              <button type="button" className="secondary" onClick={() => setRemoteModal(null)}>
                取消
              </button>
              <button type="button" onClick={submitRemoteModal}>
                保存
              </button>
            </div>
          </div>
        </ActionModal>
      ) : null}
    </div>
  );
}
