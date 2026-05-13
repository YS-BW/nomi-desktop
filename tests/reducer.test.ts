import { describe, expect, it } from "vitest";

import type { BootstrapResponse, ConnectionProfile, SseEventEnvelope } from "../src/lib/types";
import { createInitialDesktopState, desktopReducer } from "../src/state/reducer";
import { buildThreadDisplayItems } from "../src/ui/presentation";

const SESSION_ID = "desktop:desktop-client";

function createProfile(): ConnectionProfile {
  return {
    host: "127.0.0.1",
    port: "8765",
    token: "secret",
    clientId: "desktop-client",
    defaultSessionId: SESSION_ID,
    lastBoundSessionId: SESSION_ID,
    themePreference: "system",
  };
}

function envelope(type: SseEventEnvelope["type"], data: Record<string, unknown>): SseEventEnvelope {
  return {
    id: `${type}-1`,
    type,
    created_at_ms: Date.now(),
    data,
  };
}

function bootstrap(): BootstrapResponse {
  return {
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
}

function makeConnected() {
  let state = createInitialDesktopState(createProfile());
  state = desktopReducer(state, {
    type: "bootstrap/loaded",
    bootstrap: bootstrap(),
    host: "127.0.0.1",
    port: "8765",
  });
  state = desktopReducer(state, { type: "session/current", sessionId: SESSION_ID });
  return state;
}

describe("desktop reducer HTTP/SSE native state", () => {
  it("loads message history as committed messages", () => {
    let state = makeConnected();
    state = desktopReducer(state, {
      type: "messages/loaded",
      response: {
        session_id: SESSION_ID,
        messages: [
          { role: "user", content: "u1" },
          { role: "assistant", content: "a1" },
        ],
        cursor: 0,
        next_cursor: null,
        total_messages: 2,
      },
    });

    expect(state.sessionState.messages).toHaveLength(2);
    expect(state.sessionState.committedMessages).toHaveLength(2);
    expect(state.sessionState.messages[0].kind).toBe("user");
    expect(state.sessionState.messages[1].kind).toBe("assistant");
  });

  it("confirms pending user message from session.message_appended without duplicate", () => {
    let state = makeConnected();
    state = desktopReducer(state, {
      type: "message/pendingUser",
      sessionId: SESSION_ID,
      content: "你好",
    });
    state = desktopReducer(state, {
      type: "sse/received",
      event: envelope("session.message_appended", {
        session_id: SESSION_ID,
        index: 0,
        message: { role: "user", content: "你好" },
      }),
    });

    expect(state.sessionState.pendingUserMessage).toBeNull();
    expect(state.sessionState.messages.filter((item) => item.kind === "user")).toHaveLength(1);
    expect(state.sessionState.committedMessages[0].content).toBe("你好");
  });

  it("keeps turn.delta in streaming draft until assistant message is committed", () => {
    let state = makeConnected();
    state = desktopReducer(state, {
      type: "sse/received",
      event: envelope("turn.started", { session_id: SESSION_ID, turn_id: "turn-1" }),
    });
    state = desktopReducer(state, {
      type: "sse/received",
      event: envelope("turn.delta", {
        session_id: SESSION_ID,
        turn_id: "turn-1",
        content: "你好",
        tool_hint: false,
      }),
    });

    expect(state.sessionState.streamingDraft?.content).toBe("你好");
    expect(state.sessionState.committedMessages).toHaveLength(0);

    state = desktopReducer(state, {
      type: "sse/received",
      event: envelope("session.message_appended", {
        session_id: SESSION_ID,
        index: 1,
        message: { role: "assistant", content: "你好呀" },
      }),
    });

    expect(state.sessionState.streamingDraft).toBeNull();
    expect(state.sessionState.committedMessages).toHaveLength(1);
    expect(state.sessionState.messages[0].content).toBe("你好呀");
  });

  it("groups progress messages into process display items", () => {
    let state = makeConnected();
    state = desktopReducer(state, {
      type: "sse/received",
      event: envelope("turn.progress", {
        session_id: SESSION_ID,
        turn_id: "turn-1",
        content: "正在调用 exec",
        tool_hint: true,
      }),
    });
    state = desktopReducer(state, {
      type: "sse/received",
      event: envelope("turn.delta", {
        session_id: SESSION_ID,
        turn_id: "turn-1",
        content: "完成",
        tool_hint: false,
      }),
    });

    const displayItems = buildThreadDisplayItems(state.sessionState.messages);
    expect(displayItems).toHaveLength(2);
    expect(displayItems[0].kind).toBe("process");
  });

  it("marks runtime.resync_required without mutating current thread", () => {
    let state = makeConnected();
    state = desktopReducer(state, {
      type: "sse/received",
      event: envelope("runtime.resync_required", { reason: "test" }),
    });

    expect(state.needsResync).toBe(true);
    state = desktopReducer(state, { type: "resync/handled" });
    expect(state.needsResync).toBe(false);
  });

  it("updates sidebar and provider state from native SSE", () => {
    let state = makeConnected();
    state = desktopReducer(state, {
      type: "sse/received",
      event: envelope("sidebar.snapshot", {
        sidebar: {
          tasks: [],
          skills: [{ name: "demo-skill", path: "/tmp/demo-skill" }],
          mcpServers: [],
        },
      }),
    });
    state = desktopReducer(state, {
      type: "sse/received",
      event: envelope("provider.settings_updated", {
        provider: "custom",
        settings: {
          provider: "custom",
          api_key_set: true,
          api_key_preview: "…9999",
          saved_model: "model-b",
          api_base: "https://api.example.com/v2",
        },
        requires_runtime_reload: true,
      }),
    });

    expect(state.sidebar.skills[0]?.name).toBe("demo-skill");
    expect(state.providerState?.providers[0]?.saved_model).toBe("model-b");
  });
});
