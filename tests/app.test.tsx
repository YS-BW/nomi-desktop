import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/ui/App";

const mockRandomUUID = vi.fn(() => "session-uuid");

const storeMocks = vi.hoisted(() => ({
  uploadRemoteSkillZip: vi.fn(async () => "upload-token-1"),
  saveRemoteCatalog: vi.fn(),
  saveProfile: vi.fn(),
  registerRemoteSession: vi.fn((catalog, remoteId, sessionId) => ({
    ...catalog,
    remotes: catalog.remotes.map((entry: { id: string; sessionIds?: string[] }) =>
      entry.id === remoteId
        ? { ...entry, sessionIds: Array.from(new Set([sessionId, ...(entry.sessionIds || [])])) }
        : entry,
    ),
  })),
  syncRemoteSessions: vi.fn((catalog, remoteId, sessionIds) => ({
    ...catalog,
    remotes: catalog.remotes.map((entry: { id: string; sessionIds?: string[] }) =>
      entry.id === remoteId ? { ...entry, sessionIds } : entry,
    ),
  })),
  unregisterRemoteSession: vi.fn((catalog, remoteId, sessionId) => ({
    ...catalog,
    remotes: catalog.remotes.map((entry: { id: string; sessionIds?: string[] }) =>
      entry.id === remoteId
        ? { ...entry, sessionIds: (entry.sessionIds || []).filter((id) => id !== sessionId) }
        : entry,
    ),
  })),
}));

vi.mock("../src/lib/store", () => ({
  loadRemoteCatalog: () => ({
    activeRemoteId: "test-client",
    remotes: [
      {
        id: "test-client",
        name: "默认远端",
        profile: {
          host: "127.0.0.1",
          port: "8765",
          token: "secret-token",
          clientId: "test-client",
          defaultSessionId: "desktop:test-client",
          lastBoundSessionId: "desktop:test-client",
          themePreference: "system",
        },
      },
      {
        id: "local-client",
        name: "本地",
        profile: {
          host: "127.0.0.1",
          port: "8765",
          token: "",
          clientId: "local-client",
          defaultSessionId: "desktop:local-client",
          lastBoundSessionId: "desktop:local-client",
          themePreference: "system",
        },
      },
    ],
  }),
  applyRemoteDefaults: vi.fn(async (profile) => profile),
  saveProfile: storeMocks.saveProfile,
  saveRemoteCatalog: storeMocks.saveRemoteCatalog,
  uploadRemoteSkillZip: storeMocks.uploadRemoteSkillZip,
  registerRemoteSession: storeMocks.registerRemoteSession,
  syncRemoteSessions: storeMocks.syncRemoteSessions,
  unregisterRemoteSession: storeMocks.unregisterRemoteSession,
  upsertRemoteEntry: vi.fn((catalog: { remotes: Array<{ id: string; name: string; profile: unknown }> }, entry: { id: string; name: string; profile: unknown }) => ({
    ...catalog,
    remotes: catalog.remotes.map((item) => (item.id === entry.id ? { id: item.id, name: entry.name, profile: entry.profile } : item)),
  })),
  deleteRemoteEntry: vi.fn((catalog) => catalog),
}));

type MockConnectCallback = {
  onOpen?: () => void;
  onClose?: (error?: { kind: string; message: string }) => void;
  onError?: (error: { kind: string; message: string }) => void;
  onEvent?: (event: { type?: string; [key: string]: unknown }) => void;
};

const connectCalls: Array<{ profile: { defaultSessionId: string; host: string; port: string; token: string }; callbacks: MockConnectCallback }> = [];
let pendingDisconnectResolve: (() => void) | null = null;
const mockSend = vi.fn(async () => true);

const mockConnect = vi.fn(async (profile, callbacks) => {
  connectCalls.push({ profile, callbacks });
  callbacks.onOpen?.();
  callbacks.onEvent?.({
    type: "ready",
    host: profile.host,
    port: Number(profile.port),
  });
  callbacks.onEvent?.({
    type: "session_bound",
    session_id: profile.defaultSessionId,
  });
});
const mockDisconnect = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      pendingDisconnectResolve = resolve;
    }),
);

vi.mock("../src/transport/remoteClient", () => {
  class MockRemoteClient {
    connect = mockConnect;
    disconnect = mockDisconnect;
    send = mockSend;
  }
  return { RemoteClient: MockRemoteClient };
});

describe("App", () => {
  beforeEach(() => {
    vi.useRealTimers();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.stubGlobal("crypto", { randomUUID: mockRandomUUID });
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: "(prefers-color-scheme: dark)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    mockConnect.mockClear();
    mockDisconnect.mockClear();
    mockSend.mockClear();
    connectCalls.length = 0;
    pendingDisconnectResolve = null;
    document.documentElement.dataset.theme = "";
  });

  it("renders the desktop shell and advanced settings", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Nomi")).toBeInTheDocument();
    });
  });

  it("keeps advanced settings free of removed desktop extras", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("高级设置")).toBeInTheDocument();
      expect(screen.queryByText("启用桌宠")).not.toBeInTheDocument();
      expect(screen.queryByText("缩放")).not.toBeInTheDocument();
      expect(screen.queryByText(/恢复默认位置/i)).not.toBeInTheDocument();
    });
  });

  it("keeps the fixed session wiring stable", async () => {
    render(<App />);

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
  });

  it("drops stale remote session events after switching to a local remote", async () => {
    render(<App />);

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getAllByRole("button", { name: /远端/ })[0]);
    const localRemoteCard = screen.getByText("本地").closest("article");
    expect(localRemoteCard).not.toBeNull();
    fireEvent.click(within(localRemoteCard as HTMLElement).getByRole("button", { name: "连接" }));

    connectCalls[0]?.callbacks.onEvent?.({
      type: "session_list",
      sessions: [
        {
          key: "desktop:stale",
          session_id: "desktop:stale",
          title: "stale",
          created_at_ms: 1710000000000,
          updated_at_ms: 1710000000000,
          message_count: 1,
          archived: false,
          source: "remote",
        },
      ],
      next_page_token: null,
      total_count: 1,
    });

    pendingDisconnectResolve?.();

    fireEvent.click(screen.getByRole("button", { name: "打开设置菜单" }));
    fireEvent.click(screen.getByRole("button", { name: /会话管理/ }));

    await waitFor(() => {
      expect(screen.getByText("当前远端还没有历史会话。")).toBeInTheDocument();
      expect(screen.queryByText("desktop:stale")).not.toBeInTheDocument();
    });
  });

  it("does not render browser-local sidebar fallback before remote snapshot arrives", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("等待当前 remote 同步 Skills。")).toBeInTheDocument();
    });

    expect(screen.queryByText("位于")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "卸载" })).not.toBeInTheDocument();
  });

  it("refreshes sidebar after successful skill uninstall mutation", async () => {
    render(<App />);

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    mockSend.mockClear();

    connectCalls[0]?.callbacks.onEvent?.({
      type: "resource_action_result",
      session_id: "desktop:test-client",
      resource: "skill",
      action: "uninstall",
      ok: true,
      message: "已卸载 skill。",
      skill_name: "demo-skill",
    });

    await waitFor(() => {
      expect(mockSend).toHaveBeenCalledWith({
        type: "get_sidebar",
        session_id: "desktop:test-client",
      });
    });
  });
});
