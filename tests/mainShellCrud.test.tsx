import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DesktopSidebarData,
  ProviderStateSnapshot,
  SidebarMcpItem,
  SidebarTaskItem,
} from "nomi-protocol";
import type { ComponentProps } from "react";
import type { ConnectionProfile, DesktopActions, TaskSchedule } from "../src/lib/types";
import { createEmptyRemoteSessionListState } from "../src/lib/remoteSessions";
import { createInitialDesktopState } from "../src/state/reducer";
import { MainShell } from "../src/ui/MainShell";

type ShellActions = DesktopActions & {
  refreshRemoteSessions(): Promise<void>;
  loadMoreRemoteSessions(): Promise<void>;
  deleteRemoteSession(sessionId: string): Promise<void>;
  refreshProviderState(): Promise<boolean>;
  setProviderSettings(input: {
    provider: string;
    apiKey?: string | null;
    apiBase?: string | null;
    model?: string | null;
    clearApiKey?: boolean | null;
    tokenPlanApiKey?: string | null;
    clearTokenPlanApiKey?: boolean | null;
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
    scheduleKind: "every",
    scheduleAtMs: null,
    scheduleEveryMs: 3600000,
    scheduleExpr: null,
    scheduleTz: null,
    nextRunAtMs: 1710000000000,
    runCount: 3,
    status: "pending",
    targetChannels: [],
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

function buildProviderState(): ProviderStateSnapshot {
  return {
    active: { provider: "mimo", model: "mimo-chat" },
    apply_mode: "reload_runtime",
    providers: [
      {
        provider: "mimo",
        display_name: "Mimo",
        backend: "mimo",
        builtin: true,
        editable: true,
        deletable: false,
        api_key_set: true,
        api_key: "sk-existing",
        api_key_preview: "...ting",
        token_plan_api_key_set: true,
        token_plan_api_key: "tp-existing",
        token_plan_api_key_preview: "...ting",
        saved_model: "mimo-chat",
        api_base: "https://api.mimo.example",
        api_base_editable: false,
        default_api_base: "https://api.mimo.example",
        source: "config",
      },
      {
        provider: "custom",
        display_name: "Custom",
        backend: "custom",
        builtin: true,
        editable: true,
        deletable: false,
        api_key_set: true,
        api_key: "custom-existing",
        api_key_preview: "...ing",
        saved_model: "custom-model",
        api_base: "https://api.custom.example",
        api_base_editable: true,
        default_api_base: null,
        source: "config",
      },
    ],
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
    bootstrapLoaded: true,
    eventsConnected: true,
    currentSessionId: profile.defaultSessionId,
    sessionState: {
      ...state.sessionState,
      sessionId: profile.defaultSessionId,
    },
    sidebar: buildSidebarData(),
    sidebarReady: true,
    providerState: buildProviderState(),
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
    createTask: vi.fn(async () => true),
    updateTask: vi.fn(async () => true),
    deleteTask: vi.fn(async () => true),
    enableTask: vi.fn(async () => true),
    disableTask: vi.fn(async () => true),
    installSkill: vi.fn(async () => true),
    uninstallSkill: vi.fn(async () => true),
    createMcp: vi.fn(async () => true),
    updateMcp: vi.fn(async () => true),
    deleteMcp: vi.fn(async () => true),
    enableMcp: vi.fn(async () => true),
    disableMcp: vi.fn(async () => true),
    uploadSkillZip: vi.fn(async () => null),
    sendMainMessage: vi.fn(async () => {}),
    setDraftInput: vi.fn(),
    refreshRemoteSessions: vi.fn(async () => {}),
    loadMoreRemoteSessions: vi.fn(async () => {}),
    deleteRemoteSession: vi.fn(async () => {}),
    refreshProviderState: vi.fn(async () => true),
    setProviderSettings: vi.fn(async () => true),
    setActiveProvider: vi.fn(async () => true),
    reloadRuntime: vi.fn(async () => true),
    ...overrides,
  };
}

function renderShell(overrides: { actions?: Partial<ShellActions>; shellProps?: Partial<ComponentProps<typeof MainShell>> } = {}) {
  const actions = buildActions(overrides.actions);
  const profile = buildProfile();
  render(
    <MainShell
      state={buildState()}
      actions={actions}
      draftInput=""
      composerPhase="idle"
      sidebarCollapsed={false}
      previewThemePreference={null}
      setPreviewThemePreference={vi.fn()}
      remoteEntries={overrides.shellProps?.remoteEntries || [{ id: "remote-main", name: "主远端", profile, sessionIds: [] }]}
      activeRemoteId="remote-main"
      remoteRuntimeById={overrides.shellProps?.remoteRuntimeById || {
        "remote-main": {
          connectionStatus: "connected",
          connectionDetail: "已连接",
          connectionReason: "idle",
          bootstrapLoaded: true,
          eventsConnected: true,
          errorText: null,
          unreadCount: 0,
          lastActivityAt: null,
        },
      }}
      sessionListState={createEmptyRemoteSessionListState()}
      connectRemote={overrides.shellProps?.connectRemote || vi.fn()}
      reconnectRemote={overrides.shellProps?.reconnectRemote || vi.fn()}
      disconnectRemote={overrides.shellProps?.disconnectRemote || vi.fn()}
      selectSession={overrides.shellProps?.selectSession || vi.fn()}
      saveRemote={overrides.shellProps?.saveRemote || vi.fn()}
      deleteRemote={overrides.shellProps?.deleteRemote || vi.fn()}
      toggleSidebar={vi.fn()}
      updateProfile={vi.fn()}
      clearGlobalError={vi.fn()}
    />,
  );
  return actions;
}

async function openDisclosure(title: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${title}\\s+\\d+`) }));
}

function openModelSettings() {
  fireEvent.click(screen.getByRole("button", { name: "打开设置菜单" }));
  fireEvent.click(screen.getByRole("button", { name: /模型设置/ }));
}

describe("MainShell HTTP resource actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows active model in header and removes pending model settings meta", () => {
    renderShell();
    expect(screen.getByText("mimo-chat")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开设置菜单" }));

    expect(screen.getByRole("button", { name: "模型设置" })).toBeInTheDocument();
    expect(screen.queryByText("待接入")).not.toBeInTheDocument();
  });

  it("shows remote connection state per remote without the top status card", async () => {
    const profile = buildProfile();
    const disconnectRemote = vi.fn();
    renderShell({
      shellProps: {
        remoteEntries: [
          { id: "remote-main", name: "主远端", profile, sessionIds: [] },
          {
            id: "remote-bg",
            name: "后台远端",
            profile: { ...profile, clientId: "remote-bg", host: "10.0.0.2" },
            sessionIds: [],
          },
        ],
        remoteRuntimeById: {
          "remote-main": {
            connectionStatus: "connected",
            connectionDetail: "已连接",
            connectionReason: "idle",
            bootstrapLoaded: true,
            eventsConnected: true,
            errorText: null,
            unreadCount: 0,
            lastActivityAt: null,
          },
          "remote-bg": {
            connectionStatus: "connected",
            connectionDetail: "已连接",
            connectionReason: "idle",
            bootstrapLoaded: true,
            eventsConnected: true,
            errorText: null,
            unreadCount: 3,
            lastActivityAt: 1,
          },
        },
        disconnectRemote,
      },
    });

    expect(screen.queryByText("当前远端")).not.toBeInTheDocument();
    await openDisclosure("远端");
    const remoteSection = screen.getByText("后台远端").closest("article");
    expect(remoteSection).not.toBeNull();
    expect(within(remoteSection as HTMLElement).getByText("已连接")).toBeInTheDocument();
    expect(within(remoteSection as HTMLElement).getByText("3")).toBeInTheDocument();
    fireEvent.click(within(remoteSection as HTMLElement).getByRole("button", { name: "断开" }));
    expect(disconnectRemote).toHaveBeenCalledWith("remote-bg");
  });

  it("creates a task through explicit createTask action", async () => {
    const actions = renderShell();
    await openDisclosure("任务");
    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    fireEvent.change(screen.getByLabelText("任务内容"), { target: { value: "提醒我喝水" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(actions.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          instruction: "提醒我喝水",
          sourceSessionKey: "desktop:client-1",
          targetChannels: [],
          schedule: expect.objectContaining({ kind: "at" }) as TaskSchedule,
        }),
      );
    });
  });

  it("toggles and deletes task through explicit actions", async () => {
    const actions = renderShell();
    await openDisclosure("任务");
    const taskCard = screen.getByText("每小时检查").closest("article")!;
    fireEvent.click(within(taskCard).getByRole("button", { name: "停用" }));
    await waitFor(() => expect(actions.disableTask).toHaveBeenCalledWith("task-1"));

    fireEvent.click(within(taskCard).getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(actions.deleteTask).toHaveBeenCalledWith("task-1"));
  });

  it("installs and uninstalls skill through explicit actions", async () => {
    const actions = renderShell();
    await openDisclosure("Skills");
    fireEvent.click(screen.getByRole("button", { name: "安装 Skill" }));
    fireEvent.change(screen.getByLabelText("远端来源"), { target: { value: "github:demo/skill" } });
    fireEvent.click(screen.getByRole("button", { name: "安装" }));
    await waitFor(() => expect(actions.installSkill).toHaveBeenCalledWith({ source: "github:demo/skill" }));

    fireEvent.click(screen.getByRole("button", { name: "卸载" }));
    await waitFor(() => expect(actions.uninstallSkill).toHaveBeenCalledWith("demo-skill"));
  });

  it("updates MCP through explicit action", async () => {
    const actions = renderShell();
    await openDisclosure("MCP");
    const mcpCard = screen.getByText("filesystem").closest("article")!;
    fireEvent.click(within(mcpCard).getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(actions.updateMcp).toHaveBeenCalledWith("filesystem", expect.any(Object)));
  });

  it("saves mimo provider keys without submitting read-only apiBase", async () => {
    const actions = renderShell();
    openModelSettings();

    const apiKeyInput = screen.getByLabelText("apiKey");
    const tokenPlanInput = screen.getByLabelText("tokenPlanApiKey");
    expect(apiKeyInput).toHaveValue("sk-existing");
    expect(tokenPlanInput).toHaveValue("tp-existing");

    fireEvent.focus(apiKeyInput);
    expect(apiKeyInput).toHaveValue("");
    fireEvent.change(apiKeyInput, { target: { value: "sk-new" } });
    fireEvent.focus(tokenPlanInput);
    expect(tokenPlanInput).toHaveValue("");
    fireEvent.change(tokenPlanInput, { target: { value: "tp-new" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => {
      expect(actions.setProviderSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "mimo",
          apiKey: "sk-new",
          tokenPlanApiKey: "tp-new",
          model: "mimo-chat",
          clearApiKey: false,
        }),
      );
    });
    expect(screen.getByText("Provider 设置已保存，必要时请 reload runtime 生效。")).toBeInTheDocument();
    const banner = screen.queryByRole("status");
    if (banner) {
      expect(banner).not.toHaveTextContent("Provider 设置已保存");
    }
    expect(actions.setProviderSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({ provider: "mimo", apiBase: expect.anything() }),
    );
  });

  it("does not submit saved provider keys until the encrypted input is edited", async () => {
    const actions = renderShell();
    openModelSettings();

    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => {
      expect(actions.setProviderSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "mimo",
          model: "mimo-chat",
        }),
      );
    });
    expect(actions.setProviderSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "mimo",
        apiKey: expect.anything(),
      }),
    );
    expect(actions.setProviderSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "mimo",
        tokenPlanApiKey: expect.anything(),
      }),
    );
  });

  it("only submits apiBase for editable custom provider", async () => {
    const actions = renderShell();
    openModelSettings();
    fireEvent.click(screen.getByRole("button", { name: /Custom/ }));

    const apiBaseInput = screen.getByLabelText("apiBase");
    expect(apiBaseInput).not.toBeDisabled();
    fireEvent.change(apiBaseInput, { target: { value: "https://new.custom.example" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => {
      expect(actions.setProviderSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "custom",
          apiBase: "https://new.custom.example",
        }),
      );
    });
  });

  it("clears provider reload busy state after runtime reload succeeds", async () => {
    const actions = renderShell();
    openModelSettings();
    fireEvent.click(screen.getByRole("button", { name: "Reload Runtime" }));

    await waitFor(() => expect(actions.reloadRuntime).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole("button", { name: "Reload Runtime" })).toBeEnabled());
    expect(screen.getAllByText("Runtime 已重新加载。").length).toBeGreaterThan(0);
  });
});
