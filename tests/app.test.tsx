import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/ui/App";
import type { BootstrapResponse, SessionMessagesResponse, SessionResponse } from "../src/lib/types";

const mockRandomUUID = vi.fn(() => "session-uuid");

const storeMocks = vi.hoisted(() => ({
  remotes: [
    {
      id: "test-client",
      name: "默认远端",
      profile: {
        host: "127.0.0.1",
        port: "8765",
        token: "secret-token",
        clientId: "test-client",
        defaultSessionId: "",
        lastBoundSessionId: "",
        themePreference: "system",
      },
      sessionIds: [],
    },
  ],
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
}));

vi.mock("../src/lib/store", () => ({
  loadRemoteCatalog: () => ({
    activeRemoteId: "test-client",
    remotes: storeMocks.remotes,
  }),
  applyRemoteDefaults: vi.fn(async (profile) => profile),
  saveProfile: storeMocks.saveProfile,
  saveRemoteCatalog: storeMocks.saveRemoteCatalog,
  uploadRemoteSkillZip: vi.fn(async () => "upload-token-1"),
  registerRemoteSession: storeMocks.registerRemoteSession,
  syncRemoteSessions: storeMocks.syncRemoteSessions,
  unregisterRemoteSession: vi.fn((catalog) => catalog),
  upsertRemoteEntry: vi.fn((catalog, entry) => ({
    ...catalog,
    remotes: catalog.remotes.map((item: { id: string }) =>
      item.id === entry.id ? { ...item, ...entry } : item,
    ),
  })),
  deleteRemoteEntry: vi.fn((catalog) => catalog),
}));

type MockConnectCallback = {
  onBootstrap?: (bootstrap: BootstrapResponse) => void;
  onOpen?: () => void;
  onEvent?: (event: unknown) => void;
};

const bootstrapPayload: BootstrapResponse = {
  status: { ok: true },
  sessions: [],
  provider_catalog: { providers: [] },
  provider_state: {
    providers: [],
    active: { provider: "custom", model: "model-a" },
    apply_mode: "reload_runtime",
  },
  tasks: [],
  sidebar: { tasks: [], skills: [], mcpServers: [] },
};

const emptyMessages = (sessionId: string): SessionMessagesResponse => ({
  session_id: sessionId,
  messages: [],
  cursor: 0,
  next_cursor: null,
  total_messages: 0,
});

const connectCalls: MockConnectCallback[] = [];
const mockCreateSession = vi.fn(async (): Promise<SessionResponse> => ({
  session: {
    key: "desktop:test-client:session-uuid",
    session_id: "desktop:test-client:session-uuid",
    title: null,
    created_at_ms: Date.now(),
    updated_at_ms: Date.now(),
    message_count: 0,
    archived: false,
    source: "desktop",
  },
}));
const mockLoadMessages = vi.fn(async (sessionId: string) => emptyMessages(sessionId));
const mockCreateTurn = vi.fn(async () => ({
  turn_id: "turn-1",
  session_id: "desktop:test-client:session-uuid",
  status: "queued" as const,
}));

vi.mock("../src/transport/remoteClient", () => {
  class MockRemoteClient {
    connect = vi.fn(async (_profile, callbacks: MockConnectCallback) => {
      connectCalls.push(callbacks);
      callbacks.onBootstrap?.(bootstrapPayload);
      callbacks.onOpen?.();
    });
    disconnect = vi.fn(async () => {});
    bootstrap = vi.fn(async () => bootstrapPayload);
    listSessions = vi.fn(async () => ({ sessions: [], page: { next_page_token: null, total_count: 0 } }));
    createSession = mockCreateSession;
    loadMessages = mockLoadMessages;
    createTurn = mockCreateTurn;
    getSidebar = vi.fn(async () => bootstrapPayload.sidebar);
  }
  return { RemoteClient: MockRemoteClient, RemoteApiError: class RemoteApiError extends Error {} };
});

describe("App HTTP/SSE native session flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectCalls.length = 0;
    storeMocks.remotes = [
      {
        id: "test-client",
        name: "默认远端",
        profile: {
          host: "127.0.0.1",
          port: "8765",
          token: "secret-token",
          clientId: "test-client",
          defaultSessionId: "",
          lastBoundSessionId: "",
          themePreference: "system",
        },
        sessionIds: [],
      },
    ];
    vi.stubGlobal("crypto", { randomUUID: mockRandomUUID });
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: "(prefers-color-scheme: dark)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
  });

  it("does not create a session on bootstrap when remote has no desktop sessions", async () => {
    render(<App />);

    await waitFor(() => expect(connectCalls).toHaveLength(1));
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(screen.getByText("今天想聊点什么？")).toBeInTheDocument();
  });

  it("connects every configured remote on startup", async () => {
    storeMocks.remotes = [
      ...storeMocks.remotes,
      {
        id: "second-client",
        name: "第二远端",
        profile: {
          host: "127.0.0.1",
          port: "8766",
          token: "second-token",
          clientId: "second-client",
          defaultSessionId: "",
          lastBoundSessionId: "",
          themePreference: "system",
        },
        sessionIds: [],
      },
    ];

    render(<App />);

    await waitFor(() => expect(connectCalls).toHaveLength(2));
  });

  it("creates a session and posts first turn only after user sends content", async () => {
    render(<App />);

    const input = await screen.findByLabelText("消息输入");
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    await waitFor(() => expect(mockCreateSession).toHaveBeenCalledWith({
      session_id: "desktop:test-client:session-uuid",
    }));
    await waitFor(() => expect(mockCreateTurn).toHaveBeenCalledWith(
      "desktop:test-client:session-uuid",
      expect.objectContaining({ content: "你好", client_id: "test-client" }),
    ));
    expect(screen.getByText("你好")).toBeInTheDocument();
  });
});
