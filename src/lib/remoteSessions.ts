export interface RemoteSessionItem {
  key: string;
  sessionId: string;
  title: string | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  messageCount: number | null;
  archived: boolean;
  source: string | null;
}

export interface RemoteSessionListState {
  items: RemoteSessionItem[];
  nextPageToken: string | null;
  totalCount: number | null;
  loading: boolean;
  loadingMore: boolean;
  creating: boolean;
  pendingCreatedSessionId: string | null;
  bindingSessionId: string | null;
  deletingSessionId: string | null;
  initialized: boolean;
  error: string | null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseLegacyDate(value: unknown): number | null {
  const raw = readString(value);
  if (!raw) {
    return null;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function createEmptyRemoteSessionListState(): RemoteSessionListState {
  return {
    items: [],
    nextPageToken: null,
    totalCount: null,
    loading: false,
    loadingMore: false,
    creating: false,
    pendingCreatedSessionId: null,
    bindingSessionId: null,
    deletingSessionId: null,
    initialized: false,
    error: null,
  };
}

export function normalizeRemoteSessionItem(raw: Record<string, unknown>): RemoteSessionItem {
  const sessionId = readString(raw.session_id) || readString(raw.key) || "unknown-session";
  return {
    key: readString(raw.key) || sessionId,
    sessionId,
    title: readString(raw.title),
    createdAtMs: readNumber(raw.created_at_ms) ?? parseLegacyDate(raw.created_at),
    updatedAtMs: readNumber(raw.updated_at_ms) ?? parseLegacyDate(raw.updated_at),
    messageCount: readNumber(raw.message_count),
    archived: raw.archived === true,
    source: readString(raw.source) ?? readString(raw.path),
  };
}

export function mergeRemoteSessionItems(
  current: RemoteSessionItem[],
  incoming: RemoteSessionItem[],
): RemoteSessionItem[] {
  const byId = new Map<string, RemoteSessionItem>();
  for (const item of current) {
    byId.set(item.sessionId, item);
  }
  for (const item of incoming) {
    byId.set(item.sessionId, item);
  }
  return Array.from(byId.values()).sort((left, right) => {
    const leftCreated = left.createdAtMs ?? 0;
    const rightCreated = right.createdAtMs ?? 0;
    if (leftCreated !== rightCreated) {
      return rightCreated - leftCreated;
    }
    return left.sessionId.localeCompare(right.sessionId);
  });
}
