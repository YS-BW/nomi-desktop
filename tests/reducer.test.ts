import { describe, expect, it } from "vitest";

import type { ConnectionProfile } from "../src/lib/types";
import { createInitialDesktopState, desktopReducer } from "../src/state/reducer";

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
});
