import TauriWebSocket, {
  type Message as TauriSocketMessage,
} from "@tauri-apps/plugin-websocket";

import type {
  ConnectionProfile,
  RemoteClientError,
  RemoteCommand,
  RemoteEvent,
} from "../lib/types";

export interface RemoteClientCallbacks {
  onOpen?: () => void;
  onClose?: (error?: RemoteClientError) => void;
  onError?: (error: RemoteClientError) => void;
  onEvent?: (event: RemoteEvent) => void;
}

interface SocketAdapter {
  send(data: string): Promise<boolean>;
  disconnect(): void | Promise<void>;
}

function classifyConnectError(error: unknown): RemoteClientError {
  const message = String(error);
  if (/401|unauthorized/i.test(message)) {
    return {
      kind: "auth_error",
      message: "remote 鉴权失败，请检查 token。",
    };
  }
  return {
    kind: "transport_error",
    message: "无法连接到当前 remote，请检查 host 和 port。",
  };
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function createTauriSocket(
  profile: ConnectionProfile,
  callbacks: RemoteClientCallbacks,
): Promise<SocketAdapter> {
  const socket = await TauriWebSocket.connect(`ws://${profile.host}:${profile.port}/ws`, {
    headers: {
      Authorization: `Bearer ${profile.token}`,
    },
  });

  socket.addListener((message: TauriSocketMessage) => {
    if (message.type === "Close") {
      callbacks.onClose?.({
        kind: "closed",
        message: "连接已断开",
      });
      return;
    }
    if (message.type !== "Text" || typeof message.data !== "string") {
      return;
    }
    try {
      callbacks.onEvent?.(JSON.parse(message.data) as RemoteEvent);
    } catch (error) {
      callbacks.onError?.({
        kind: "unknown",
        message: `事件解析失败: ${String(error)}`,
      });
    }
  });

  callbacks.onOpen?.();

  return {
    async send(data: string) {
      await socket.send(data);
      return true;
    },
    disconnect() {
      return socket.disconnect();
    },
  };
}

function createBrowserSocket(
  profile: ConnectionProfile,
  callbacks: RemoteClientCallbacks,
): SocketAdapter {
  const url = `ws://${profile.host}:${profile.port}/ws?token=${encodeURIComponent(profile.token)}`;
  const socket = new WebSocket(url);
  let opened = false;
  let closed = false;
  let resolveReady: ((value: boolean) => void) | null = null;
  const readyPromise = new Promise<boolean>((resolve) => {
    resolveReady = resolve;
  });

  socket.addEventListener("open", () => {
    opened = true;
    resolveReady?.(true);
    resolveReady = null;
    callbacks.onOpen?.();
  });
  socket.addEventListener("close", () => {
    closed = true;
    resolveReady?.(false);
    resolveReady = null;
    callbacks.onClose?.(
      opened
        ? {
            kind: "closed",
            message: "连接已断开",
          }
        : {
            kind: "transport_error",
            message: "无法连接到当前 remote，请检查 host 和 port。",
          },
    );
  });
  socket.addEventListener("error", () => {
    resolveReady?.(false);
    resolveReady = null;
    callbacks.onError?.({
      kind: "transport_error",
      message: "无法连接到当前 remote，请检查 host 和 port。",
    });
  });
  socket.addEventListener("message", (raw) => {
    try {
      callbacks.onEvent?.(JSON.parse(raw.data) as RemoteEvent);
    } catch (error) {
      callbacks.onError?.({
        kind: "unknown",
        message: `事件解析失败: ${String(error)}`,
      });
    }
  });

  return {
    async send(data: string) {
      if (!opened && !closed) {
        const ready = await Promise.race<boolean>([
          readyPromise,
          new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 3000)),
        ]);
        if (!ready) {
          return false;
        }
      }
      if (closed || socket.readyState !== WebSocket.OPEN) {
        return false;
      }
      socket.send(data);
      return true;
    },
    disconnect() {
      socket.close();
    },
  };
}

export class RemoteClient {
  private socket: SocketAdapter | null = null;
  private connectionSeq = 0;

  async connect(
    profile: ConnectionProfile,
    callbacks: RemoteClientCallbacks,
  ): Promise<void> {
    await this.disconnect();
    const currentSeq = ++this.connectionSeq;
    const wrappedCallbacks: RemoteClientCallbacks = {
      onOpen: () => {
        if (currentSeq !== this.connectionSeq) {
          return;
        }
        callbacks.onOpen?.();
      },
      onClose: (error) => {
        if (currentSeq !== this.connectionSeq) {
          return;
        }
        this.socket = null;
        callbacks.onClose?.(error);
      },
      onError: (error) => {
        if (currentSeq !== this.connectionSeq) {
          return;
        }
        callbacks.onError?.(error);
      },
      onEvent: (event) => {
        if (currentSeq !== this.connectionSeq) {
          return;
        }
        callbacks.onEvent?.(event);
      },
    };
    try {
      this.socket = isTauriRuntime()
        ? await createTauriSocket(profile, wrappedCallbacks)
        : createBrowserSocket(profile, wrappedCallbacks);
    } catch (error) {
      this.socket = null;
      callbacks.onError?.(classifyConnectError(error));
    }
  }

  async disconnect(): Promise<void> {
    if (!this.socket) {
      return;
    }
    const active = this.socket;
    this.socket = null;
    await active.disconnect();
  }

  async send(command: RemoteCommand): Promise<boolean> {
    if (!this.socket) {
      return false;
    }
    return this.socket.send(JSON.stringify(command));
  }
}
