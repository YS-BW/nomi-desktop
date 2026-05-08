import { createStableClientId } from "./ids";
import type {
  ConnectionProfile,
  DesktopSidebarData,
} from "./types";

const STORAGE_KEY = "nomi.desktop.profile";

export interface DesktopRemoteEntry {
  id: string;
  name: string;
  profile: ConnectionProfile;
}

export interface DesktopRemoteCatalog {
  activeRemoteId: string;
  remotes: DesktopRemoteEntry[];
}

interface RemoteDefaults {
  host?: string | null;
  port?: number | string | null;
  token?: string | null;
}

interface SidebarDefaults {
  tasks?: DesktopSidebarData["tasks"];
  skills?: DesktopSidebarData["skills"];
  mcpServers?: DesktopSidebarData["mcpServers"];
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function loadBrowserRemoteDefaults(): Promise<RemoteDefaults | null> {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const response = await fetch("/__nomi/remote-defaults", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as RemoteDefaults;
  } catch {
    return null;
  }
}

async function loadBrowserSidebarDefaults(): Promise<SidebarDefaults | null> {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const response = await fetch("/__nomi/desktop-sidebar", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as SidebarDefaults;
  } catch {
    return null;
  }
}

function createDefaultProfile(): ConnectionProfile {
  const clientId = createStableClientId();
  return {
    host: "127.0.0.1",
    port: "8765",
    token: "",
    clientId,
    defaultSessionId: `desktop:${clientId}`,
    lastBoundSessionId: `desktop:${clientId}`,
    themePreference: "system",
  };
}

function createDefaultRemoteEntry(): DesktopRemoteEntry {
  const profile = createDefaultProfile();
  return {
    id: profile.clientId,
    name: "默认远端",
    profile,
  };
}

function normalizeProfile(
  profile: Partial<ConnectionProfile> | undefined,
  fallback?: ConnectionProfile,
): ConnectionProfile {
  const defaultProfile = fallback || createDefaultProfile();
  return {
    host: profile?.host || defaultProfile.host,
    port: profile?.port || defaultProfile.port,
    token: profile?.token || "",
    clientId: profile?.clientId || defaultProfile.clientId,
    defaultSessionId:
      profile?.defaultSessionId || `desktop:${profile?.clientId || defaultProfile.clientId}`,
    lastBoundSessionId:
      profile?.lastBoundSessionId ||
      profile?.defaultSessionId ||
      `desktop:${profile?.clientId || defaultProfile.clientId}`,
    themePreference:
      profile?.themePreference === "light" || profile?.themePreference === "dark"
        ? profile.themePreference
        : "system",
  };
}

function normalizeRemoteEntry(entry: Partial<DesktopRemoteEntry> | undefined): DesktopRemoteEntry {
  const profile = normalizeProfile(entry?.profile, createDefaultProfile());
  return {
    id: entry?.id || profile.clientId,
    name: entry?.name || "远端",
    profile,
  };
}

export function loadRemoteCatalog(): DesktopRemoteCatalog {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const entry = createDefaultRemoteEntry();
    return { activeRemoteId: entry.id, remotes: [entry] };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DesktopRemoteCatalog> & Partial<ConnectionProfile>;
    if (Array.isArray(parsed.remotes) && parsed.remotes.length > 0) {
      const remotes = parsed.remotes.map((entry) => normalizeRemoteEntry(entry));
      const activeRemoteId = parsed.activeRemoteId || remotes[0].id;
      return {
        activeRemoteId: remotes.some((entry) => entry.id === activeRemoteId)
          ? activeRemoteId
          : remotes[0].id,
        remotes,
      };
    }
    const entry = normalizeRemoteEntry({
      id: parsed.clientId || undefined,
      name: "默认远端",
      profile: normalizeProfile(parsed, createDefaultProfile()),
    });
    return { activeRemoteId: entry.id, remotes: [entry] };
  } catch {
    const entry = createDefaultRemoteEntry();
    return { activeRemoteId: entry.id, remotes: [entry] };
  }
}

export function saveRemoteCatalog(catalog: DesktopRemoteCatalog): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog));
}

export function loadProfile(): ConnectionProfile {
  const catalog = loadRemoteCatalog();
  return catalog.remotes.find((entry) => entry.id === catalog.activeRemoteId)?.profile || catalog.remotes[0].profile;
}

export function saveProfile(profile: ConnectionProfile): void {
  const catalog = loadRemoteCatalog();
  const activeIndex = catalog.remotes.findIndex((entry) => entry.id === catalog.activeRemoteId);
  const nextEntry: DesktopRemoteEntry = {
    id: catalog.activeRemoteId,
    name: catalog.remotes[activeIndex]?.name || "远端",
    profile,
  };
  const nextRemotes =
    activeIndex >= 0
      ? catalog.remotes.map((entry, index) => (index === activeIndex ? nextEntry : entry))
      : [nextEntry, ...catalog.remotes];
  saveRemoteCatalog({
    activeRemoteId: nextEntry.id,
    remotes: nextRemotes,
  });
}

export function upsertRemoteEntry(
  catalog: DesktopRemoteCatalog,
  entry: Omit<DesktopRemoteEntry, "id" | "profile"> & {
    id?: string;
    profile: ConnectionProfile;
  },
): DesktopRemoteCatalog {
  const id = entry.id || entry.profile.clientId;
  const nextEntry: DesktopRemoteEntry = {
    id,
    name: entry.name || "远端",
    profile: entry.profile,
  };
  const index = catalog.remotes.findIndex((item) => item.id === id);
  const remotes = index >= 0 ? catalog.remotes.map((item, i) => (i === index ? nextEntry : item)) : [...catalog.remotes, nextEntry];
  return {
    activeRemoteId: id,
    remotes,
  };
}

export function deleteRemoteEntry(catalog: DesktopRemoteCatalog, remoteId: string): DesktopRemoteCatalog {
  const remotes = catalog.remotes.filter((item) => item.id !== remoteId);
  if (remotes.length === 0) {
    const fallback = createDefaultRemoteEntry();
    return { activeRemoteId: fallback.id, remotes: [fallback] };
  }
  const activeRemoteId =
    catalog.activeRemoteId === remoteId ? remotes[0].id : catalog.activeRemoteId;
  return {
    activeRemoteId: remotes.some((item) => item.id === activeRemoteId) ? activeRemoteId : remotes[0].id,
    remotes,
  };
}

export async function applyRemoteDefaults(
  profile: ConnectionProfile,
): Promise<ConnectionProfile> {
  if (!isTauriRuntime()) {
    const defaults = await loadBrowserRemoteDefaults();
    if (!defaults) {
      return profile;
    }
    const nextProfile = {
      ...profile,
      host: profile.host.trim() || String(defaults.host || "").trim() || profile.host,
      port:
        profile.port.trim() ||
        String(defaults.port ?? "").trim() ||
        profile.port,
      token: profile.token.trim() || String(defaults.token || "").trim(),
    };
    if (JSON.stringify(nextProfile) !== JSON.stringify(profile)) {
      saveProfile(nextProfile);
    }
    return nextProfile;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const defaults = await invoke<RemoteDefaults>("load_remote_defaults");
    const nextProfile = {
      ...profile,
      host: profile.host.trim() || String(defaults.host || "").trim() || profile.host,
      port:
        profile.port.trim() ||
        String(defaults.port ?? "").trim() ||
        profile.port,
      token: profile.token.trim() || String(defaults.token || "").trim(),
    };
    if (JSON.stringify(nextProfile) !== JSON.stringify(profile)) {
      saveProfile(nextProfile);
    }
    return nextProfile;
  } catch {
    return profile;
  }
}

export async function loadDesktopSidebarData(): Promise<DesktopSidebarData> {
  if (!isTauriRuntime()) {
    const defaults = await loadBrowserSidebarDefaults();
    if (!defaults) {
      throw new Error("desktop sidebar defaults unavailable");
    }
    return {
      tasks: defaults.tasks || [],
      skills: defaults.skills || [],
      mcpServers: defaults.mcpServers || [],
    };
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const defaults = await invoke<SidebarDefaults>("load_desktop_sidebar_data");
    return {
      tasks: defaults.tasks || [],
      skills: defaults.skills || [],
      mcpServers: defaults.mcpServers || [],
    };
  } catch {
    throw new Error("desktop sidebar defaults unavailable");
  }
}

export async function clearDesktopRuntimeState(): Promise<void> {
  if (!isTauriRuntime()) {
    const response = await fetch("/__nomi/clear-runtime", {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error("clear desktop runtime unavailable");
    }
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("clear_nomi_runtime_state");
  } catch {
    throw new Error("clear desktop runtime unavailable");
  }
}

export async function uploadRemoteSkillZip(
  profile: ConnectionProfile,
  file: File,
): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`http://${profile.host}:${profile.port}/skills/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${profile.token}`,
    },
    body: form,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "skill upload failed");
  }
  const payload = (await response.json()) as { upload_token?: string };
  if (!payload.upload_token) {
    throw new Error("skill upload token missing");
  }
  return payload.upload_token;
}
