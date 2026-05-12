import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ConnectionProfile,
  DesktopActions,
  DesktopSidebarData,
  ProviderCatalog,
  ProviderStateSnapshot,
  RemoteEvent,
  SidebarMcpItem,
  SidebarTaskItem,
} from "nomi-protocol";

import { createEmptyRemoteSessionListState } from "../src/lib/remoteSessions";
import { createInitialDesktopState } from "../src/state/reducer";
import { MainShell } from "../src/ui/MainShell";

type ShellActions = DesktopActions & {
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

function buildProfile(): ConnectionProfile {
  return {
    host: "127.0.0.1",
    port: "8765",
    token: "secret-token",
    clientId: "client-1",
    defaultSessionId: "desktop:client-1",
    lastBoundSessionId: "desktop:client-1",
    themePreference: "system",
  };
}

function buildSidebarData(): DesktopSidebarData {
  const task: SidebarTaskItem = {
    id: "task-1",
    title: "每小时检查",
    instruction: "检查系统状态",
    enabled: true,
    scheduleKind: "after",
    scheduleAtMs: null,
    scheduleEveryMs: 3600000,
    scheduleExpr: null,
    scheduleTz: null,
    nextRunAtMs: 1710000000000,
    runCount: 3,
    status: "pending",
  };
  const mcp: SidebarMcpItem = {
    name: "filesystem",
    enabled: true,
    transport: "stdio",
    command: "npx",
    args: ["-y", "filesystem-mcp"],
    url: "",
    enabledTools: ["*"],
    env: {},
    headers: {},
  };
  return {
    tasks: [task],
    skills: [{ name: "demo-skill", path: "/tmp/demo-skill" }],
    mcpServers: [mcp],
  };
}

function buildState() {
  const profile = buildProfile();
  const state = createInitialDesktopState(profile);
  return {
    ...state,
    connectionStatus: "connected" as const,
    connectionDetail: "已连接",
    connectionReason: "idle" as const,
    ownerReady: true,
    readyReceived: true,
    bindCompleted: true,
    currentSessionId: profile.defaultSessionId,
    sessionState: {
      ...state.sessionState,
      sessionId: profile.defaultSessionId,
      isBound: true,
    },
    sidebar: buildSidebarData(),
    sidebarReady: true,
    errorText: null,
  };
}

function buildActions(overrides: Partial<ShellActions> = {}): ShellActions {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    interruptCurrentTurn: vi.fn(async () => {}),
    clearRuntimeState: vi.fn(async () => {}),
    createNewSession: vi.fn(async () => {}),
    refreshSidebar: vi.fn(async () => {}),
    refreshRemoteSessions: vi.fn(async () => {}),
    loadMoreRemoteSessions: vi.fn(async () => {}),
    deleteRemoteSession: vi.fn(async () => {}),
    refreshProviderState: vi.fn(async () => {}),
    setProviderSettings: vi.fn(async () => true),
    setActiveProvider: vi.fn(async () => true),
    reloadRuntime: vi.fn(async () => true),
    sendResourceCommand: vi.fn(async () => true),
    uploadSkillZip: vi.fn(async () => null),
    sendMainMessage: vi.fn(async () => {}),
    setDraftInput: vi.fn(),
    ...overrides,
  };
}

function buildRemoteEntries() {
  return [
    {
      id: "remote-main",
      name: "主远端",
      profile: buildProfile(),
      sessionIds: ["desktop:client-1"],
    },
    {
      id: "remote-backup",
      name: "备用远端",
      profile: {
        host: "10.0.0.8",
        port: "9000",
        token: "backup-token",
        clientId: "client-2",
        defaultSessionId: "desktop:client-2",
        lastBoundSessionId: "desktop:client-2",
        themePreference: "system" as const,
      },
      sessionIds: [],
    },
  ];
}

function renderShell(overrides: {
  actions?: Partial<ShellActions>;
  state?: ReturnType<typeof buildState>;
} = {}) {
  const state = overrides.state ?? buildState();
  const actions = buildActions(overrides.actions);
  const saveRemote = vi.fn();
  const deleteRemote = vi.fn();
  const connectRemote = vi.fn();
  const reconnectRemote = vi.fn();
  const disconnectRemote = vi.fn();
  const selectSession = vi.fn();
  const updateProfile = vi.fn();
  const toggleSidebar = vi.fn();
  const setPreviewThemePreference = vi.fn();
  const clearGlobalError = vi.fn();

  render(
    <MainShell
      state={state}
      actions={actions}
      draftInput=""
      composerPhase="idle"
      sidebarCollapsed={false}
      previewThemePreference={null}
      setPreviewThemePreference={setPreviewThemePreference}
      remoteEntries={buildRemoteEntries()}
      activeRemoteId="remote-main"
      sessionListState={createEmptyRemoteSessionListState()}
      connectRemote={connectRemote}
      reconnectRemote={reconnectRemote}
      disconnectRemote={disconnectRemote}
      selectSession={selectSession}
      saveRemote={saveRemote}
      deleteRemote={deleteRemote}
      toggleSidebar={toggleSidebar}
      updateProfile={updateProfile}
      clearGlobalError={clearGlobalError}
    />,
  );

  return {
    actions,
    saveRemote,
    deleteRemote,
    connectRemote,
    reconnectRemote,
    disconnectRemote,
    selectSession,
    updateProfile,
    toggleSidebar,
    clearGlobalError,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("MainShell CRUD", () => {
  it("shows explicit remote connect controls on remote cards", async () => {
    const { connectRemote, reconnectRemote, disconnectRemote } = renderShell();

    fireEvent.click(screen.getByRole("button", { name: "远端 2" }));

    fireEvent.click(screen.getAllByRole("button", { name: "重连" })[0]);
    expect(reconnectRemote).toHaveBeenCalledWith("remote-main");

    fireEvent.click(screen.getByRole("button", { name: "断开" }));
    expect(disconnectRemote).toHaveBeenCalledTimes(1);

    const backupCard = screen.getByText("备用远端").closest("article");
    expect(backupCard).not.toBeNull();
    fireEvent.click(within(backupCard as HTMLElement).getByRole("button", { name: "连接" }));
    expect(connectRemote).toHaveBeenCalledWith("remote-backup");
  });

  it("auto reloads runtime after provider activation requires apply", async () => {
    const providerCatalog: ProviderCatalog = {
      providers: [
        {
          name: "deepseek",
          display_name: "DeepSeek",
          backend: "openai_compatible",
          default_api_base: "https://api.deepseek.com",
          api_base_editable: false,
          is_gateway: false,
          is_local: false,
          is_direct: true,
          strip_model_prefix: false,
          supports_prompt_caching: false,
        },
      ],
    };
    const providerState: ProviderStateSnapshot = {
      providers: [
        {
          provider: "deepseek",
          api_key_set: true,
          api_key_preview: "…3688",
          saved_model: "deepseek-chat",
          api_base: "https://api.deepseek.com",
        },
      ],
      active: {
        provider: "deepseek",
        model: "deepseek-chat",
      },
      apply_mode: "reload_runtime",
    };
    const state = {
      ...buildState(),
      providerCatalog,
      providerState,
      eventLog: [
        {
          type: "active_provider_changed",
          active: {
            provider: "deepseek",
            model: "deepseek-chat",
          },
          requires_runtime_reload: true,
        },
      ] satisfies RemoteEvent[],
    };
    const { actions } = renderShell({
      state,
      actions: {
        reloadRuntime: vi.fn(async () => true),
      },
    });

    await waitFor(() => {
      expect(actions.reloadRuntime).toHaveBeenCalledTimes(1);
    });
  });

  it("creates, edits, and deletes remote entries", async () => {
    const { saveRemote, deleteRemote } = renderShell();

    fireEvent.click(screen.getByRole("button", { name: "新建远端" }));
    const createDialog = screen.getByRole("dialog", { name: "新建远端" });
    fireEvent.change(within(createDialog).getByLabelText("名称"), { target: { value: "开发远端" } });
    fireEvent.change(within(createDialog).getByLabelText("Host"), { target: { value: "192.168.1.9" } });
    fireEvent.change(within(createDialog).getByLabelText("Port"), { target: { value: "7788" } });
    fireEvent.change(within(createDialog).getByLabelText("Token"), { target: { value: "token-1" } });
    fireEvent.click(within(createDialog).getByRole("button", { name: "保存" }));

    expect(saveRemote).toHaveBeenCalledWith({
      name: "开发远端",
      host: "192.168.1.9",
      port: "7788",
      token: "token-1",
    });

    const backupCard = screen.getByText("备用远端").closest("article");
    expect(backupCard).not.toBeNull();
    fireEvent.click(within(backupCard as HTMLElement).getByRole("button", { name: "更多操作" }));
    fireEvent.click(within(backupCard as HTMLElement).getByRole("button", { name: "编辑" }));
    const editDialog = screen.getByRole("dialog", { name: "编辑远端 · 备用远端" });
    fireEvent.change(within(editDialog).getByLabelText("名称"), { target: { value: "备用远端改名" } });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));

    expect(saveRemote).toHaveBeenCalledWith({
      id: "remote-backup",
      name: "备用远端改名",
      host: "10.0.0.8",
      port: "9000",
      token: "backup-token",
    });

    fireEvent.click(within(backupCard as HTMLElement).getByRole("button", { name: "更多操作" }));
    fireEvent.click(within(backupCard as HTMLElement).getByRole("button", { name: "删除" }));
    expect(deleteRemote).toHaveBeenCalledWith("remote-backup");
  });

  it("creates, updates, and deletes tasks", async () => {
    const { actions } = renderShell();

    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    const createDialog = screen.getByRole("dialog", { name: "新建任务" });
    fireEvent.change(within(createDialog).getByLabelText("任务内容"), { target: { value: "检查缓存" } });
    fireEvent.change(within(createDialog).getByLabelText("延时秒数"), { target: { value: "15" } });
    fireEvent.click(within(createDialog).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(actions.sendResourceCommand).toHaveBeenCalledWith({
        type: "task_create_after",
        session_id: "desktop:client-1",
        instruction: "检查缓存",
        after_seconds: 15,
      });
    });

    const taskCard = screen.getByText("每小时检查").closest("article");
    expect(taskCard).not.toBeNull();
    fireEvent.click(within(taskCard as HTMLElement).getByRole("button", { name: "编辑" }));
    const editDialog = screen.getByRole("dialog", { name: "编辑任务" });
    fireEvent.change(within(editDialog).getByLabelText("任务内容"), { target: { value: "检查缓存并汇报" } });
    fireEvent.change(within(editDialog).getByLabelText("延时秒数"), { target: { value: "30" } });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(actions.sendResourceCommand).toHaveBeenCalledWith({
        type: "task_update_instruction",
        session_id: "desktop:client-1",
        task_id: "task-1",
        instruction: "检查缓存并汇报",
      });
      expect(actions.sendResourceCommand).toHaveBeenCalledWith({
        type: "task_reschedule_after",
        session_id: "desktop:client-1",
        task_id: "task-1",
        after_seconds: 30,
      });
    });

    fireEvent.click(within(taskCard as HTMLElement).getByRole("button", { name: "更多操作" }));
    fireEvent.click(within(taskCard as HTMLElement).getByRole("button", { name: "删除" }));
    expect(actions.sendResourceCommand).toHaveBeenCalledWith({
      type: "task_delete",
      session_id: "desktop:client-1",
      task_id: "task-1",
    });
  });

  it("shows pending state when deleting a task", async () => {
    const { actions } = renderShell();

    const taskCard = screen.getByText("每小时检查").closest("article");
    expect(taskCard).not.toBeNull();

    fireEvent.click(within(taskCard as HTMLElement).getByRole("button", { name: "更多操作" }));
    fireEvent.click(within(taskCard as HTMLElement).getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(actions.sendResourceCommand).toHaveBeenCalledWith({
        type: "task_delete",
        session_id: "desktop:client-1",
        task_id: "task-1",
      });
      expect(within(taskCard as HTMLElement).getByRole("button", { name: "删除中..." })).toBeInTheDocument();
    });
  });

  it("creates, updates, and deletes MCP servers", async () => {
    const { actions } = renderShell();

    fireEvent.click(screen.getByRole("button", { name: "新建 MCP" }));
    const createDialog = screen.getByRole("dialog", { name: "新建 MCP" });
    fireEvent.change(within(createDialog).getByLabelText("MCP JSON"), {
      target: {
        value: JSON.stringify({
          mcpServers: {
            browser: {
              command: "npx",
              args: ["-y", "browser-mcp"],
            },
          },
        }),
      },
    });
    fireEvent.click(within(createDialog).getByRole("button", { name: "安装" }));

    await waitFor(() => {
      expect(actions.sendResourceCommand).toHaveBeenCalledWith({
        type: "mcp_create",
        session_id: "desktop:client-1",
        mcp_name: "browser",
        mcp: {
          command: "npx",
          args: ["-y", "browser-mcp"],
        },
      });
    });

    const mcpCard = screen.getByText("filesystem").closest("article");
    expect(mcpCard).not.toBeNull();
    fireEvent.click(within(mcpCard as HTMLElement).getByRole("button", { name: "编辑" }));
    const editDialog = screen.getByRole("dialog", { name: "编辑 MCP · filesystem" });
    fireEvent.change(within(editDialog).getByLabelText("Command"), { target: { value: "node" } });
    fireEvent.change(within(editDialog).getByLabelText("Enabled tools"), { target: { value: "fs.read, fs.write" } });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(actions.sendResourceCommand).toHaveBeenCalledWith({
        type: "mcp_update",
        session_id: "desktop:client-1",
        mcp_name: "filesystem",
        mcp: {
          enabled: true,
          type: "stdio",
          command: "node",
          args: ["-y", "filesystem-mcp"],
          url: "",
          enabled_tools: ["fs.read", "fs.write"],
          env: {},
          headers: {},
        },
      });
    });

    fireEvent.click(within(mcpCard as HTMLElement).getByRole("button", { name: "更多操作" }));
    fireEvent.click(within(mcpCard as HTMLElement).getByRole("button", { name: "删除" }));
    await waitFor(() => {
      expect(actions.sendResourceCommand).toHaveBeenCalledWith({
        type: "mcp_delete",
        session_id: "desktop:client-1",
        mcp_name: "filesystem",
      });
    });
  });

  it("shows pending state when uninstalling a skill", async () => {
    const { actions } = renderShell();

    const skillCard = screen.getByText("demo-skill").closest("article");
    expect(skillCard).not.toBeNull();

    fireEvent.click(within(skillCard as HTMLElement).getByRole("button", { name: "卸载" }));

    await waitFor(() => {
      expect(actions.sendResourceCommand).toHaveBeenCalledWith({
        type: "skill_uninstall",
        session_id: "desktop:client-1",
        skill_name: "demo-skill",
      });
      expect(within(skillCard as HTMLElement).getByRole("button", { name: "卸载中..." })).toBeInTheDocument();
    });
  });

  it("clears pending state after skill uninstall succeeds", async () => {
    const state = {
      ...buildState(),
      eventLog: [
        {
          type: "resource_action_result" as const,
          session_id: "desktop:client-1",
          resource: "skill",
          action: "uninstall",
          ok: true,
          message: "已卸载 skill：`demo-skill`。",
          skill_name: "demo-skill",
        },
      ],
    };

    renderShell({ state });

    expect(screen.queryByText("已卸载 skill：`demo-skill`。")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "卸载中..." })).not.toBeInTheDocument();
  });

  it("keeps uninstall failure feedback inside the sidebar when a later sidebar event is newer", async () => {
    const state = {
      ...buildState(),
      eventLog: [
        {
          type: "sidebar_snapshot" as const,
          session_id: "desktop:client-1",
          sidebar: buildSidebarData(),
        },
        {
          type: "resource_action_result" as const,
          session_id: "desktop:client-1",
          resource: "skill",
          action: "uninstall",
          ok: false,
          message: "卸载失败：找不到 skill。",
          skill_name: "demo-skill",
        },
      ],
    };

    renderShell({ state });

    expect(screen.getByText("卸载失败：找不到 skill。")).toBeInTheDocument();
  });
});
