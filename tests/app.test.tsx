import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/ui/App";

const mockRandomUUID = vi.fn(() => "session-uuid");

const storeMocks = vi.hoisted(() => ({
  loadDesktopSidebarData: vi.fn(async () => ({
    tasks: [],
    skills: [],
    mcpServers: [],
  })),
  uploadRemoteSkillZip: vi.fn(async () => "upload-token-1"),
}));

vi.mock("../src/lib/store", () => ({
  loadProfile: () => ({
    host: "127.0.0.1",
    port: "8765",
    token: "secret-token",
    clientId: "test-client",
    defaultSessionId: "desktop:test-client",
    lastBoundSessionId: "desktop:test-client",
    themePreference: "system",
  }),
  applyRemoteDefaults: vi.fn(async (profile) => profile),
  loadDesktopSidebarData: storeMocks.loadDesktopSidebarData,
  saveProfile: vi.fn(),
  uploadRemoteSkillZip: storeMocks.uploadRemoteSkillZip,
}));

const mockSend = vi.fn(async () => true);
const mockConnect = vi.fn(async (profile, callbacks) => {
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
const mockDisconnect = vi.fn(async () => undefined);

vi.mock("../src/transport/remoteClient", () => {
  class MockRemoteClient {
    connect = mockConnect;
    disconnect = mockDisconnect;
    send = mockSend;
  }
  return { RemoteClient: MockRemoteClient };
});

function getComposerInput(): HTMLTextAreaElement {
  return screen.getByLabelText("消息输入") as HTMLTextAreaElement;
}

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
    mockSend.mockClear();
    mockConnect.mockClear();
    mockDisconnect.mockClear();
    storeMocks.loadDesktopSidebarData.mockClear();
    document.documentElement.dataset.theme = "";
  });

  it("connects, binds the fixed session and requests sidebar plus history", async () => {
    render(<App />);

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith({
        type: "bind_session",
        session_id: "desktop:test-client",
      });
      expect(mockSend).toHaveBeenCalledWith({
        type: "load_history",
        session_id: "desktop:test-client",
        limit: 100,
      });
      expect(mockSend).toHaveBeenCalledWith({
        type: "get_status",
        session_id: "desktop:test-client",
      });
      expect(mockSend).toHaveBeenCalledWith({
        type: "get_sidebar",
        session_id: "desktop:test-client",
      });
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

  it("sends on Enter and keeps Shift+Enter for newline", async () => {
    render(<App />);

    const textarea = await waitFor(() => getComposerInput());
    fireEvent.change(textarea, { target: { value: "你好" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(mockSend).toHaveBeenCalledWith({
        type: "send_message",
        session_id: "desktop:test-client",
        content: "你好",
        client_id: "test-client",
      });
    });

    fireEvent.change(textarea, { target: { value: "第一行" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(textarea.value).toBe("第一行");
  });
});
