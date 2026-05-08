export function createStableClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `desktop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDesktopSessionId(clientId: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `desktop:${clientId}:${crypto.randomUUID()}`;
  }
  return `desktop:${clientId}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createMessageId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
