import type {
  BootstrapResponse,
  CreateSessionRequest,
  CreateTaskRequest,
  CreateTurnRequest,
  CreateTurnResponse,
  DeleteMcpResponse,
  DeleteSessionResponse,
  DeleteTaskResponse,
  DesktopSidebarData,
  HealthResponse,
  InstallSkillRequest,
  InterruptSessionResponse,
  McpListResponse,
  McpResponse,
  ProviderListResponse,
  ProviderStateResponse,
  ResetSessionResponse,
  ResourceActionResponse,
  RuntimeReloadResponse,
  SessionListResponse,
  SessionMessagesResponse,
  SessionResponse,
  SetActiveProviderRequest,
  SetActiveProviderResponse,
  SkillListResponse,
  TaskListResponse,
  TaskResponse,
  UpdateProviderRequest,
  UpdateProviderResponse,
  UpdateTaskRequest,
  UpsertMcpRequest,
} from "../protocol/remote";
import { SSE_EVENT_TYPES, type SseEventEnvelope } from "../protocol/remote";
import type { ConnectionProfile, RemoteClientError } from "../lib/types";

export interface RemoteClientCallbacks {
  onBootstrap?: (bootstrap: BootstrapResponse) => void;
  onOpen?: () => void;
  onClose?: (error?: RemoteClientError) => void;
  onError?: (error: RemoteClientError) => void;
  onEvent?: (event: SseEventEnvelope) => void;
}

export interface RemoteApiErrorDetail {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

const CONNECT_TIMEOUT_MS = 5000;

function classifyHttpError(status: number, message?: string): RemoteClientError {
  if (status === 401 || /unauthorized/i.test(message || "")) {
    return {
      kind: "auth_error",
      message: "remote 鉴权失败，请检查 token。",
    };
  }
  return {
    kind: "transport_error",
    message: message || "无法连接到当前 remote，请检查 host 和 port。",
  };
}

function classifyConnectError(error: unknown): RemoteClientError {
  const message = error instanceof Error ? error.message : String(error);
  if (/401|unauthorized/i.test(message)) {
    return {
      kind: "auth_error",
      message: "remote 鉴权失败，请检查 token。",
    };
  }
  if (/timeout/i.test(message)) {
    return {
      kind: "transport_error",
      message: "连接当前 remote 超时，请检查 host、port 或网络连通性。",
    };
  }
  return {
    kind: "transport_error",
    message: message || "无法连接到当前 remote，请检查 host 和 port。",
  };
}

function createBaseUrl(profile: ConnectionProfile): string {
  return `http://${profile.host}:${profile.port}`;
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function readApiError(payload: unknown, status: number): RemoteApiErrorDetail {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const rawError =
      record.error && typeof record.error === "object"
        ? (record.error as Record<string, unknown>)
        : record;
    return {
      status,
      code: typeof rawError.code === "string" ? rawError.code : "request_failed",
      message:
        typeof rawError.message === "string"
          ? rawError.message
          : typeof record.message === "string"
            ? record.message
            : `remote http error ${status}`,
      details:
        rawError.details && typeof rawError.details === "object"
          ? (rawError.details as Record<string, unknown>)
          : {},
    };
  }
  return {
    status,
    code: "request_failed",
    message: typeof payload === "string" && payload.trim() ? payload : `remote http error ${status}`,
    details: {},
  };
}

function appendQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export class RemoteApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(readonly error: RemoteApiErrorDetail) {
    super(error.message);
    this.status = error.status;
    this.code = error.code;
    this.details = error.details;
  }
}

export class RemoteClient {
  private profile: ConnectionProfile | null = null;
  private callbacks: RemoteClientCallbacks | null = null;
  private eventSource: EventSource | null = null;
  private connectionSeq = 0;
  private connected = false;

  async connect(
    profile: ConnectionProfile,
    callbacks: RemoteClientCallbacks,
  ): Promise<void> {
    await this.disconnect();
    const currentSeq = ++this.connectionSeq;
    this.profile = profile;
    this.callbacks = callbacks;
    this.connected = false;

    try {
      const bootstrap = await Promise.race([
        this.bootstrap(),
        new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(new Error("connect timeout")), CONNECT_TIMEOUT_MS),
        ),
      ]);
      if (currentSeq !== this.connectionSeq) {
        return;
      }
      this.connected = true;
      callbacks.onBootstrap?.(bootstrap);
      this.openEventStream(currentSeq);
    } catch (error) {
      if (currentSeq === this.connectionSeq) {
        this.connected = false;
        callbacks.onError?.(classifyConnectError(error));
      }
    }
  }

  async disconnect(): Promise<void> {
    this.connectionSeq += 1;
    this.connected = false;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("GET", "/v1/health");
  }

  async bootstrap(): Promise<BootstrapResponse> {
    return this.request<BootstrapResponse>("GET", "/v1/bootstrap");
  }

  async getStatus(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", "/v1/status");
  }

  async getSidebar(): Promise<DesktopSidebarData> {
    return this.request<DesktopSidebarData>("GET", "/v1/sidebar");
  }

  async listSessions(options?: {
    pageToken?: string | null;
    pageSize?: number | null;
    includeArchived?: boolean | null;
  }): Promise<SessionListResponse> {
    const params = new URLSearchParams();
    if (options?.pageToken) {
      params.set("page_token", options.pageToken);
    }
    if (typeof options?.pageSize === "number") {
      params.set("page_size", String(options.pageSize));
    }
    if (typeof options?.includeArchived === "boolean") {
      params.set("include_archived", options.includeArchived ? "true" : "false");
    }
    return this.request<SessionListResponse>("GET", appendQuery("/v1/sessions", params));
  }

  async createSession(body: CreateSessionRequest): Promise<SessionResponse> {
    return this.request<SessionResponse>("POST", "/v1/sessions", body);
  }

  async getSession(sessionId: string): Promise<SessionResponse> {
    return this.request<SessionResponse>("GET", `/v1/sessions/${encodePath(sessionId)}`);
  }

  async deleteSession(sessionId: string): Promise<DeleteSessionResponse> {
    return this.request<DeleteSessionResponse>("DELETE", `/v1/sessions/${encodePath(sessionId)}`);
  }

  async loadMessages(sessionId: string, options?: {
    cursor?: number | null;
    limit?: number | null;
  }): Promise<SessionMessagesResponse> {
    const params = new URLSearchParams();
    if (typeof options?.cursor === "number") {
      params.set("cursor", String(options.cursor));
    }
    if (typeof options?.limit === "number") {
      params.set("limit", String(options.limit));
    }
    return this.request<SessionMessagesResponse>(
      "GET",
      appendQuery(`/v1/sessions/${encodePath(sessionId)}/messages`, params),
    );
  }

  async createTurn(sessionId: string, body: CreateTurnRequest): Promise<CreateTurnResponse> {
    return this.request<CreateTurnResponse>(
      "POST",
      `/v1/sessions/${encodePath(sessionId)}/turns`,
      body,
    );
  }

  async interruptTurn(sessionId: string): Promise<InterruptSessionResponse> {
    return this.request<InterruptSessionResponse>(
      "POST",
      `/v1/sessions/${encodePath(sessionId)}/interrupt`,
      {},
    );
  }

  async resetSession(sessionId: string): Promise<ResetSessionResponse> {
    return this.request<ResetSessionResponse>(
      "POST",
      `/v1/sessions/${encodePath(sessionId)}/reset`,
      {},
    );
  }

  async listTasks(): Promise<TaskListResponse> {
    return this.request<TaskListResponse>("GET", "/v1/tasks");
  }

  async createTask(body: CreateTaskRequest): Promise<TaskResponse> {
    return this.request<TaskResponse>("POST", "/v1/tasks", body);
  }

  async updateTask(taskId: string, body: UpdateTaskRequest): Promise<TaskResponse> {
    return this.request<TaskResponse>("PATCH", `/v1/tasks/${encodePath(taskId)}`, body);
  }

  async deleteTask(taskId: string): Promise<DeleteTaskResponse> {
    return this.request<DeleteTaskResponse>("DELETE", `/v1/tasks/${encodePath(taskId)}`);
  }

  async enableTask(taskId: string): Promise<TaskResponse> {
    return this.request<TaskResponse>("POST", `/v1/tasks/${encodePath(taskId)}/enable`, {});
  }

  async disableTask(taskId: string): Promise<TaskResponse> {
    return this.request<TaskResponse>("POST", `/v1/tasks/${encodePath(taskId)}/disable`, {});
  }

  async rescheduleTask(taskId: string, body: UpdateTaskRequest): Promise<TaskResponse> {
    return this.request<TaskResponse>("POST", `/v1/tasks/${encodePath(taskId)}/reschedule`, body);
  }

  async listProviders(): Promise<ProviderListResponse> {
    return this.request<ProviderListResponse>("GET", "/v1/providers");
  }

  async getProviderState(): Promise<ProviderStateResponse> {
    return this.request<ProviderStateResponse>("GET", "/v1/providers/state");
  }

  async updateProvider(provider: string, body: UpdateProviderRequest): Promise<UpdateProviderResponse> {
    return this.request<UpdateProviderResponse>("PATCH", `/v1/providers/${encodePath(provider)}`, body);
  }

  async setActiveProvider(body: SetActiveProviderRequest): Promise<SetActiveProviderResponse> {
    return this.request<SetActiveProviderResponse>("PUT", "/v1/providers/active", body);
  }

  async reloadRuntime(): Promise<RuntimeReloadResponse> {
    return this.request<RuntimeReloadResponse>("POST", "/v1/runtime/reload", {});
  }

  async clearRemoteState(): Promise<ResourceActionResponse> {
    return this.request<ResourceActionResponse>("POST", "/v1/runtime/clear-remote-state", {});
  }

  async listSkills(): Promise<SkillListResponse> {
    return this.request<SkillListResponse>("GET", "/v1/skills");
  }

  async installSkill(body: InstallSkillRequest): Promise<ResourceActionResponse> {
    return this.request<ResourceActionResponse>("POST", "/v1/skills", body);
  }

  async uninstallSkill(skillName: string): Promise<ResourceActionResponse> {
    return this.request<ResourceActionResponse>("DELETE", `/v1/skills/${encodePath(skillName)}`);
  }

  async listMcp(): Promise<McpListResponse> {
    return this.request<McpListResponse>("GET", "/v1/mcp");
  }

  async createMcp(body: UpsertMcpRequest): Promise<McpResponse> {
    return this.request<McpResponse>("POST", "/v1/mcp", body);
  }

  async updateMcp(name: string, body: UpsertMcpRequest): Promise<McpResponse> {
    return this.request<McpResponse>("PATCH", `/v1/mcp/${encodePath(name)}`, body);
  }

  async deleteMcp(name: string): Promise<DeleteMcpResponse> {
    return this.request<DeleteMcpResponse>("DELETE", `/v1/mcp/${encodePath(name)}`);
  }

  async enableMcp(name: string): Promise<McpResponse> {
    return this.request<McpResponse>("POST", `/v1/mcp/${encodePath(name)}/enable`, {});
  }

  async disableMcp(name: string): Promise<McpResponse> {
    return this.request<McpResponse>("POST", `/v1/mcp/${encodePath(name)}/disable`, {});
  }

  private openEventStream(connectionSeq: number): void {
    if (!this.profile || !this.callbacks) {
      return;
    }
    const profile = this.profile;
    const callbacks = this.callbacks;
    const url = `${createBaseUrl(profile)}/v1/events?token=${encodeURIComponent(profile.token)}`;
    const source = new EventSource(url);
    this.eventSource = source;

    const handleMessage = (message: MessageEvent<string>) => {
      if (connectionSeq !== this.connectionSeq) {
        return;
      }
      try {
        callbacks.onEvent?.(JSON.parse(message.data) as SseEventEnvelope);
      } catch (error) {
        callbacks.onError?.({
          kind: "unknown",
          message: `事件解析失败: ${String(error)}`,
        });
      }
    };
    source.onopen = () => {
      if (connectionSeq === this.connectionSeq) {
        callbacks.onOpen?.();
      }
    };
    source.onmessage = handleMessage;
    for (const eventType of SSE_EVENT_TYPES) {
      source.addEventListener(eventType, handleMessage as EventListener);
    }
    source.onerror = () => {
      if (connectionSeq !== this.connectionSeq) {
        return;
      }
      callbacks.onError?.({
        kind: "transport_error",
        message: "SSE 事件流异常，正在等待浏览器自动重连。",
      });
    };
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    if (!this.profile) {
      throw new Error("remote profile missing");
    }
    const response = await fetch(`${createBaseUrl(this.profile)}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.profile.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    if (!response.ok) {
      const error = readApiError(payload, response.status);
      if (!this.connected && response.status >= 400) {
        throw new Error(classifyHttpError(response.status, error.message).message);
      }
      throw new RemoteApiError(error);
    }
    return payload as T;
  }
}
