import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopSidebarData, SidebarMcpItem, SidebarTaskItem } from "nomi-protocol";
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

function renderShell(overrides: { actions?: Partial<ShellActions> } = {}) {
  const actions = buildActions(overrides.actions);
  render(
    <MainShell
      state={buildState()}
      actions={actions}
      draftInput=""
      composerPhase="idle"
      sidebarCollapsed={false}
      previewThemePreference={null}
      setPreviewThemePreference={vi.fn()}
      remoteEntries={[{ id: "remote-main", name: "主远端", profile: buildProfile(), sessionIds: [] }]}
      activeRemoteId="remote-main"
      sessionListState={createEmptyRemoteSessionListState()}
      connectRemote={vi.fn()}
      reconnectRemote={vi.fn()}
      disconnectRemote={vi.fn()}
      selectSession={vi.fn()}
      saveRemote={vi.fn()}
      deleteRemote={vi.fn()}
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

describe("MainShell HTTP resource actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
