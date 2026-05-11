import { describe, expect, it } from "vitest";

import type { ConnectionProfile } from "../src/lib/types";
import { createInitialDesktopState, desktopReducer } from "../src/state/reducer";
import { buildThreadDisplayItems } from "../src/ui/presentation";

function createProfile(): ConnectionProfile {
  return {
    host: "127.0.0.1",
    port: "8765",
    token: "secret",
    clientId: "desktop-client",
    defaultSessionId: "desktop:desktop-client",
    lastBoundSessionId: "desktop:desktop-client",
    themePreference: "system",
  };
}

function makeConnected() {
  let state = createInitialDesktopState(createProfile());
  state = desktopReducer(state, {
    type: "event/received",
    event: { type: "ready", host: "127.0.0.1", port: 8765 },
  });
  state = desktopReducer(state, {
    type: "event/received",
    event: { type: "session_bound", session_id: "desktop:desktop-client" },
  });
  return state;
}

describe("desktop reducer", () => {
  it("merges delta, message and turn_completed into one assistant turn", () => {
    let state = makeConnected();
    state = desktopReducer(state, {
      type: "event/received",
      event: { type: "turn_started", session_id: "desktop:desktop-client" },
    });
    state = desktopReducer(state, {
      type: "event/received",
      event: { type: "delta", session_id: "desktop:desktop-client", content: "你好" },
    });
    state = desktopReducer(state, {
      type: "event/received",
      event: { type: "message", session_id: "desktop:desktop-client", content: "你好呀" },
    });
    state = desktopReducer(state, {
      type: "event/received",
      event: {
        type: "turn_completed",
        session_id: "desktop:desktop-client",
        stop_reason: "completed",
      },
    });

    expect(state.sessionState.messages).toHaveLength(1);
    expect(state.sessionState.messages[0].content).toBe("你好呀");
    expect(state.sessionState.messages[0].status).toBe("completed");
    expect(state.sessionState.activeTurn?.completed).toBe(true);
  });

  it("keeps task_delivered as a standalone task message", () => {
    let state = makeConnected();
    state = desktopReducer(state, {
      type: "event/received",
      event: {
        type: "task_delivered",
        session_id: "desktop:desktop-client",
        task_id: "task_1",
        content: "记得吃饭",
      },
    });

    expect(state.sessionState.messages).toHaveLength(1);
    expect(state.sessionState.messages[0].kind).toBe("task");
    expect(state.sessionState.messages[0].content).toBe("记得吃饭");
  });

  it("replaces current message list when history snapshot arrives", () => {
    let state = makeConnected();
    state = desktopReducer(state, {
      type: "event/received",
      event: {
        type: "history_snapshot",
        session_id: "desktop:desktop-client",
        messages: [
          { role: "user", content: "u1" },
          { role: "assistant", content: "a1" },
        ],
      },
    });

    expect(state.sessionState.messages).toHaveLength(2);
    expect(state.sessionState.messages[0].kind).toBe("user");
    expect(state.sessionState.messages[1].kind).toBe("assistant");
    expect(state.sessionState.activeTurn).toBeNull();
  });

  it("preserves progress and tool hint messages when rebuilding history", () => {
    let state = makeConnected();
    state = desktopReducer(state, {
      type: "event/received",
      event: {
        type: "history_snapshot",
        session_id: "desktop:desktop-client",
        messages: [
          { role: "user", content: "先查一下" },
          { role: "tool_hint", content: "正在调用 skill", tool_hint: true },
          { kind: "progress", role: "progress", content: "skill 返回中" },
          { role: "assistant", content: "已经查完了" },
        ],
      },
    });

    expect(state.sessionState.messages).toHaveLength(4);
    expect(state.sessionState.messages[1].kind).toBe("progress");
    expect(state.sessionState.messages[1].role).toBe("tool_hint");
    expect(state.sessionState.messages[2].kind).toBe("progress");
    expect(state.sessionState.messages[2].role).toBe("progress");
    expect(state.sessionState.messages[3].kind).toBe("assistant");
  });

  it("maps historical tool results into progress messages", () => {
    let state = makeConnected();
    state = desktopReducer(state, {
      type: "event/received",
      event: {
        type: "history_snapshot",
        session_id: "desktop:desktop-client",
        messages: [
          { role: "user", content: "帮我查一下" },
          { role: "assistant", content: "", tool_calls: [{ function: { name: "exec" } }] },
          { role: "tool", name: "exec", tool_call_id: "call_1", content: "tool output" },
          { role: "assistant", content: "已经查好了" },
        ],
      },
    });

    expect(state.sessionState.messages).toHaveLength(4);
    expect(state.sessionState.messages[1].kind).toBe("progress");
    expect(state.sessionState.messages[1].content).toContain("正在调用 exec");
    expect(state.sessionState.messages[2].kind).toBe("progress");
    expect(state.sessionState.messages[2].role).toBe("tool");
    expect(state.sessionState.messages[3].kind).toBe("assistant");

    const displayItems = buildThreadDisplayItems(state.sessionState.messages);
    expect(displayItems).toHaveLength(3);
    expect(displayItems[1].kind).toBe("process");
    expect(displayItems[2].kind).toBe("message");
  });

  it("appends local user message before assistant replies", () => {
    let state = makeConnected();
    state = desktopReducer(state, {
      type: "message/user",
      sessionId: "desktop:desktop-client",
      content: "我先说一句",
    });

    expect(state.sessionState.messages).toHaveLength(1);
    expect(state.sessionState.messages[0].kind).toBe("user");
    expect(state.sessionState.messages[0].content).toBe("我先说一句");
  });

  it("marks owner ready only after ready and session_bound", () => {
    let state = createInitialDesktopState(createProfile());

    state = desktopReducer(state, {
      type: "connection/status",
      status: "connecting",
      detail: "正在建立连接...",
      reason: "idle",
      readyReceived: false,
      bindCompleted: false,
    });
    expect(state.ownerReady).toBe(false);

    state = desktopReducer(state, {
      type: "event/received",
      event: { type: "ready", host: "127.0.0.1", port: 8765 },
    });
    expect(state.readyReceived).toBe(true);
    expect(state.bindCompleted).toBe(false);
    expect(state.ownerReady).toBe(false);
    expect(state.connectionStatus).toBe("connecting");

    state = desktopReducer(state, {
      type: "event/received",
      event: { type: "session_bound", session_id: "desktop:desktop-client" },
    });
    expect(state.bindCompleted).toBe(true);
    expect(state.ownerReady).toBe(true);
    expect(state.connectionStatus).toBe("connected");
  });

  it("keeps sidebar empty until a sidebar snapshot arrives", () => {
    let state = makeConnected();

    expect(state.sidebar.skills).toHaveLength(0);
    expect(state.sidebarReady).toBe(false);

    state = desktopReducer(state, {
      type: "event/received",
      event: {
        type: "sidebar_snapshot",
        session_id: "desktop:desktop-client",
        sidebar: {
          tasks: [],
          skills: [{ name: "demo-skill", path: "/tmp/demo-skill" }],
          mcpServers: [],
        },
      },
    });

    expect(state.sidebar.skills).toHaveLength(1);
    expect(state.sidebar.skills[0]?.name).toBe("demo-skill");
    expect(state.sidebarReady).toBe(true);
  });

  it("resets sidebar when switching sessions", () => {
    let state = makeConnected();
    state = desktopReducer(state, {
      type: "event/received",
      event: {
        type: "sidebar_snapshot",
        session_id: "desktop:desktop-client",
        sidebar: {
          tasks: [],
          skills: [{ name: "demo-skill", path: "/tmp/demo-skill" }],
          mcpServers: [],
        },
      },
    });

    state = desktopReducer(state, {
      type: "session/current",
      sessionId: "desktop:another-session",
    });

    expect(state.sidebar.skills).toHaveLength(0);
    expect(state.sidebarReady).toBe(false);
  });

  it("normalizes provider_list into provider state", () => {
    let state = makeConnected();

    state = desktopReducer(state, {
      type: "event/received",
      event: {
        type: "provider_list",
        provider_list: {
          providers: [
            {
              provider: "deepseek",
              display_name: "DeepSeek",
              backend: "openai_compatible",
              builtin: true,
              editable: true,
              deletable: false,
              api_key_set: true,
              api_key_preview: "…3688",
              saved_model: "deepseek-chat",
              api_base: "https://api.deepseek.com",
              api_base_editable: false,
              default_api_base: "https://api.deepseek.com",
              source: "config",
            },
          ],
          active: {
            provider: "deepseek",
            model: "deepseek-chat",
          },
          apply_mode: "reload_runtime",
        },
      },
    });

    expect(state.providerState?.providers).toHaveLength(1);
    expect(state.providerState?.providers[0]?.display_name).toBe("DeepSeek");
    expect(state.providerState?.active.provider).toBe("deepseek");
  });

  it("merges provider_updated into the existing provider item", () => {
    let state = makeConnected();

    state = desktopReducer(state, {
      type: "event/received",
      event: {
        type: "provider_list",
        provider_list: {
          providers: [
            {
              provider: "custom",
              display_name: "Custom",
              backend: "openai_compatible",
              builtin: false,
              editable: true,
              deletable: false,
              api_key_set: false,
              api_key_preview: null,
              saved_model: null,
              api_base: "https://api.example.com",
              api_base_editable: true,
              default_api_base: "https://api.example.com",
              source: "config",
            },
          ],
          active: {
            provider: "custom",
            model: "model-a",
          },
          apply_mode: "reload_runtime",
        },
      },
    });

    state = desktopReducer(state, {
      type: "event/received",
      event: {
        type: "provider_updated",
        provider: "custom",
        settings: {
          provider: "custom",
          api_key_set: true,
          api_key_preview: "…9999",
          saved_model: "model-b",
          api_base: "https://api.example.com/v2",
        },
        requires_runtime_reload: true,
      },
    });

    expect(state.providerState?.providers[0]?.display_name).toBe("Custom");
    expect(state.providerState?.providers[0]?.api_key_set).toBe(true);
    expect(state.providerState?.providers[0]?.saved_model).toBe("model-b");
    expect(state.providerState?.providers[0]?.api_base).toBe("https://api.example.com/v2");
  });
});
