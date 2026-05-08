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
  ConnectionProfile,
  DesktopActions,
  SidebarMcpItem,
  SidebarTaskItem,
  ThemePreference,
} from "../lib/types";
import type { DesktopRemoteEntry } from "../lib/store";
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
  actions: DesktopActions;
  draftInput: string;
  composerPhase: "idle" | "interrupting" | "sending";
  sidebarCollapsed: boolean;
  previewThemePreference: ThemePreference | null;
  setPreviewThemePreference(value: ThemePreference | null): void;
  remoteEntries: DesktopRemoteEntry[];
  activeRemoteId: string;
  selectRemote(remoteId: string): void;
  saveRemote(input: {
    id?: string;
    name: string;
    host: string;
    port: string;
    token: string;
  }): void;
  deleteRemote(remoteId: string): void;
  toggleSidebar(): void;
  updateProfile(patch: Partial<ConnectionProfile>): void;
}

interface SidebarDisclosureProps {
  title: string;
  count: number;
  children: ReactNode;
}

interface SidebarTaskGroup {
  key: string;
  label: string;
  tasks: SidebarTaskItem[];
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

function formatTaskStatus(task: SidebarTaskItem): string {
  const enabled = task.enabled ? "启用中" : "已停用";
  return `${enabled} · ${task.status || "pending"} · 已运行 ${task.runCount} 次`;
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
  return `位于 ${segments.slice(-2).join("/")}`;
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
      return state.readyReceived ? "主窗口尚未完成会话绑定。" : "正在连接 remote，请稍等。";
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

function SidebarDisclosure(props: SidebarDisclosureProps) {
  const { title, count, children } = props;
  const [open, setOpen] = useState(false);

  return (
    <section className={`sidebar-disclosure ${open ? "open" : ""}`}>
      <button
        className="sidebar-disclosure-toggle"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="sidebar-disclosure-main">
          <span className="sidebar-disclosure-title">{title}</span>
          <span className="sidebar-disclosure-count">{count}</span>
        </span>
        <Icon name="chevron-down" className="sidebar-disclosure-icon" />
      </button>
      <div className="sidebar-disclosure-panel">
        <div className="sidebar-disclosure-inner">{children}</div>
      </div>
    </section>
  );
}

function ActionModal(props: {
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  const { title, onClose, children } = props;
  return (
    <div className="overlay-backdrop" role="presentation" onClick={onClose}>
      <div
        className="overlay-dialog"
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
    selectRemote,
    saveRemote,
    deleteRemote,
    toggleSidebar,
    updateProfile,
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
  const [mcpModal, setMcpModal] = useState<McpFormState | null>(null);
  const [mcpFormError, setMcpFormError] = useState<string | null>(null);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [themeSliderDragValue, setThemeSliderDragValue] = useState<number | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const themeSliderRef = useRef<HTMLDivElement | null>(null);
  const themeSliderDragValueRef = useRef<number | null>(null);
  const composerStatusCopy = getComposerStatusCopy(state, composerPhase);
  const sendDisabled = draftInput.trim().length === 0 || !state.ownerReady || composerPhase !== "idle";
  const resourceActionsDisabled =
    !state.ownerReady ||
    (state.sessionState.activeTurn !== null && !state.sessionState.activeTurn.completed);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [draftInput]);

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
    themeSliderDragValueRef.current = themeSliderDragValue;
  }, [themeSliderDragValue]);

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

  function toggleProcess(key: string) {
    setExpandedProcessKeys((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function updateThemePreference(themePreference: ThemePreference) {
    setPreviewThemePreference(null);
    updateProfile({ themePreference });
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
    setRemoteFormError(null);
    setRemoteModal(buildRemoteFormState());
  }

  function openEditRemoteModal(entry: DesktopRemoteEntry) {
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
    if (!window.confirm(`确认删除任务“${task.title || task.id}”吗？`)) {
      return;
    }
    await actions.sendResourceCommand({
      type: "task_delete",
      session_id: state.currentSessionId,
      task_id: task.id,
    });
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
    if (!window.confirm(`确认卸载 Skill “${name}”吗？`)) {
      return;
    }
    await actions.sendResourceCommand({
      type: "skill_uninstall",
      session_id: state.currentSessionId,
      skill_name: name,
    });
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
    <div className={`desktop-chat-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
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
          <SidebarDisclosure title="远端" count={remoteEntries.length}>
            <div className="sidebar-section-actions">
              <button
                type="button"
                className="sidebar-inline-button"
                onClick={openCreateRemoteModal}
              >
                新建远端
              </button>
            </div>
            <div className="sidebar-entity-list">
              {remoteEntries.map((entry) => {
                const isActive = entry.id === activeRemoteId;
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
                      <button
                        type="button"
                        className="sidebar-inline-button secondary"
                        onClick={() => selectRemote(entry.id)}
                        disabled={isActive}
                      >
                        {isActive ? "当前远端" : "切换"}
                      </button>
                      <button
                        type="button"
                        className="sidebar-inline-button secondary"
                        onClick={() => openEditRemoteModal(entry)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="sidebar-inline-button danger"
                        onClick={() => {
                          if (!window.confirm(`确认删除远端“${entry.name}”吗？`)) {
                            return;
                          }
                          deleteRemote(entry.id);
                        }}
                        disabled={remoteEntries.length <= 1}
                      >
                        删除
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </SidebarDisclosure>
        </section>

        <section className="sidebar-section">
          <SidebarDisclosure title="定时任务" count={state.sidebar.tasks.length}>
            <div className="sidebar-section-actions">
              <button
                type="button"
                className="sidebar-inline-button"
                onClick={openCreateTaskModal}
                disabled={resourceActionsDisabled}
              >
                新建任务
              </button>
              <button
                type="button"
                className="sidebar-inline-button secondary"
                onClick={() => void actions.refreshSidebar()}
              >
                刷新
              </button>
            </div>
            {state.sidebar.tasks.length === 0
              ? renderEmptyState("当前远端还没有可显示的自动任务。")
              : (
                <div className="sidebar-task-groups">
                  {taskGroups.map((group) => (
                    <section key={group.key} className="sidebar-task-group">
                      <div className="sidebar-task-group-header">
                        <span>{group.label}</span>
                        <span>{group.tasks.length}</span>
                      </div>
                      <div className="sidebar-entity-list">
                        {group.tasks.map((task) => (
                          <article key={task.id} className="sidebar-entity-card">
                            <div className="sidebar-entity-title-row">
                              <div className="sidebar-entity-title">{task.title || task.id}</div>
                              <span className={`sidebar-badge ${task.enabled ? "success" : "muted"}`}>
                                {task.enabled ? "启用" : "停用"}
                              </span>
                            </div>
                            <div className="sidebar-entity-primary">下次执行 · {formatTaskTime(task)}</div>
                            <div className="sidebar-entity-meta">{formatTaskSchedule(task)}</div>
                            <div className="sidebar-entity-meta">{formatTaskStatus(task)}</div>
                            <div className="sidebar-entity-copy compact">{task.instruction}</div>
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
                              <button
                                type="button"
                                className="sidebar-inline-button danger"
                                onClick={() => void handleTaskDelete(task)}
                                disabled={resourceActionsDisabled}
                              >
                                删除
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
          </SidebarDisclosure>
        </section>

        <section className="sidebar-section">
          <SidebarDisclosure title="已安装 Skills" count={state.sidebar.skills.length}>
            <div className="sidebar-section-actions">
              <button
                type="button"
                className="sidebar-inline-button"
                onClick={openSkillInstallModal}
                disabled={resourceActionsDisabled}
              >
                安装 Skill
              </button>
            </div>
            <div className="sidebar-entity-list">
              {state.sidebar.skills.length === 0
                ? renderEmptyState("当前远端 skills 目录还是空的。")
                : state.sidebar.skills.map((skill) => (
                  <article key={skill.path} className="sidebar-entity-card compact">
                    <div className="sidebar-entity-title-row">
                      <div className="sidebar-entity-title">{skill.name}</div>
                    </div>
                    <div className="sidebar-entity-meta">{formatSkillSummary(skill.path)}</div>
                    <div className="sidebar-card-actions">
                      <button
                        type="button"
                        className="sidebar-inline-button danger"
                        onClick={() => void handleSkillUninstall(skill.name)}
                        disabled={resourceActionsDisabled}
                      >
                        卸载
                      </button>
                    </div>
                  </article>
                ))}
            </div>
          </SidebarDisclosure>
        </section>

        <section className="sidebar-section">
          <SidebarDisclosure title="MCP" count={state.sidebar.mcpServers.length}>
            <div className="sidebar-section-actions">
              <button
                type="button"
                className="sidebar-inline-button"
                onClick={openCreateMcpModal}
                disabled={resourceActionsDisabled}
              >
                新建 MCP
              </button>
            </div>
            <div className="sidebar-entity-list">
              {state.sidebar.mcpServers.length === 0
                ? renderEmptyState("当前远端配置里还没有 MCP server。")
                : state.sidebar.mcpServers.map((item) => (
                  <article key={item.name} className="sidebar-entity-card compact">
                    <div className="sidebar-entity-title-row">
                      <div className="sidebar-entity-title">{item.name}</div>
                      <span className={`sidebar-badge ${item.enabled ? "success" : "muted"}`}>
                        {item.enabled ? "启用" : "停用"}
                      </span>
                    </div>
                    <div className="sidebar-entity-meta">{formatMcpSummary(item)}</div>
                    <div className="sidebar-entity-meta">{item.transport}</div>
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
                      <button
                        type="button"
                        className="sidebar-inline-button danger"
                        onClick={() => void handleMcpDelete(item)}
                        disabled={resourceActionsDisabled}
                      >
                        删除
                      </button>
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
              <button className="secondary" type="button" onClick={() => void actions.createNewSession()}>
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
                <div className="settings-slider-block">
                  <div className="settings-slider-labels">
                    <span>浅色</span>
                    <span>跟随系统</span>
                    <span>深色</span>
                  </div>
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
                    <div className="settings-theme-slider-track" />
                    <div
                      className="settings-theme-slider-thumb"
                      style={{ left: `calc(18px + ${themeSliderRatio} * (100% - 36px))` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="chat-thread-scroller">
          <div className="chat-thread">
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
                  {isAssistant || isTask ? (
                    <div className="message-avatar">{isTask ? "!" : "N"}</div>
                  ) : null}
                  <div className="message-body">
                    {isTask ? <div className="message-kicker">{presentation.label}</div> : null}
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
          {state.errorText ? <div className="composer-error">{state.errorText}</div> : null}
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
                <Icon name="arrow-up" className="is-light" />
              </button>
            </div>
          </div>
        </footer>
      </main>

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
