import { createStableClientId } from "./ids";
import type {
  ConnectionProfile,
  DesktopSidebarData,
} from "./types";

const STORAGE_KEY = "nomi.desktop.profile";

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

export function loadProfile(): ConnectionProfile {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return createDefaultProfile();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ConnectionProfile>;
    const fallback = createDefaultProfile();
    return {
      host: parsed.host || fallback.host,
      port: parsed.port || fallback.port,
      token: parsed.token || "",
      clientId: parsed.clientId || fallback.clientId,
      defaultSessionId: parsed.defaultSessionId || `desktop:${parsed.clientId || fallback.clientId}`,
      lastBoundSessionId:
        parsed.lastBoundSessionId ||
        parsed.defaultSessionId ||
        `desktop:${parsed.clientId || fallback.clientId}`,
      themePreference:
        parsed.themePreference === "light" || parsed.themePreference === "dark"
          ? parsed.themePreference
          : "system",
    };
  } catch {
    return createDefaultProfile();
  }
}

export function saveProfile(profile: ConnectionProfile): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
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
