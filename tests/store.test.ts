import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadRemoteCatalog,
  saveRemoteCatalog,
  upsertRemoteEntry,
  type DesktopRemoteCatalog,
} from "../src/lib/store";
import type { DesktopConnectionProfile } from "../src/lib/types";

function profile(clientId: string): DesktopConnectionProfile {
  return {
    host: "127.0.0.1",
    port: "8765",
    token: `${clientId}-token`,
    clientId,
    defaultSessionId: `desktop:${clientId}`,
    lastBoundSessionId: `desktop:${clientId}`,
    themePreference: "system",
    accentColor: "#7C9CF6",
  };
}

function catalog(): DesktopRemoteCatalog {
  return {
    activeRemoteId: "remote-a",
    remotes: [
      {
        id: "remote-a",
        name: "远端 A",
        profile: profile("remote-a"),
        sessionIds: ["desktop:remote-a"],
      },
      {
        id: "remote-b",
        name: "远端 B",
        profile: profile("remote-b"),
        sessionIds: ["desktop:remote-b"],
      },
    ],
  };
}

describe("remote catalog store", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
      clear: vi.fn(() => {
        storage.clear();
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not activate an edited inactive remote", () => {
    const next = upsertRemoteEntry(catalog(), {
      id: "remote-b",
      name: "远端 B 改名",
      profile: { ...profile("remote-b"), host: "10.0.0.2" },
    });

    expect(next.activeRemoteId).toBe("remote-a");
    expect(next.remotes.find((entry) => entry.id === "remote-b")?.name).toBe("远端 B 改名");
  });

  it("activates a newly created remote only when requested", () => {
    const next = upsertRemoteEntry(catalog(), {
      name: "远端 C",
      profile: profile("remote-c"),
      activate: true,
    });

    expect(next.activeRemoteId).toBe("remote-c");
    expect(next.remotes.map((entry) => entry.id)).toContain("remote-c");
  });

  it("normalizes saved catalogs without dropping or duplicating remotes", () => {
    saveRemoteCatalog({
      activeRemoteId: "remote-b",
      remotes: [
        ...catalog().remotes,
        {
          id: "remote-b",
          name: "远端 B 最新",
          profile: profile("remote-b"),
          sessionIds: ["desktop:remote-b", "wechat:remote-b"],
        },
      ],
    });

    const loaded = loadRemoteCatalog();
    expect(loaded.activeRemoteId).toBe("remote-b");
    expect(loaded.remotes).toHaveLength(2);
    expect(loaded.remotes.find((entry) => entry.id === "remote-b")?.name).toBe("远端 B 最新");
    expect(loaded.remotes.find((entry) => entry.id === "remote-b")?.sessionIds).toEqual([
      "desktop:remote-b",
      "wechat:remote-b",
    ]);
  });
});
