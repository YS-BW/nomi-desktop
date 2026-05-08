import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readRemoteDefaults() {
  const configPath = path.join(os.homedir(), ".nomi", "config.json");
  const parsed = readJsonFile(configPath) as {
    remote?: {
      host?: string;
      port?: number | string;
      authToken?: string;
      auth_token?: string;
    };
  } | null;
  const remote = parsed?.remote || {};
  return {
    host: remote.host || "",
    port: remote.port || "",
    token: remote.authToken || remote.auth_token || "",
  };
}

function readDesktopSidebarData() {
  const nomiRoot = path.join(os.homedir(), ".nomi");
  const configPath = path.join(nomiRoot, "config.json");
  const tasksPath = path.join(nomiRoot, "workspace", "tasks", "tasks.json");
  const cronPath = path.join(nomiRoot, "workspace", "cron", "jobs.json");
  const skillsRoot = path.join(nomiRoot, "skills");

  const config = readJsonFile(configPath) as {
    tools?: {
      mcpServers?: Record<string, Record<string, unknown>>;
      mcp_servers?: Record<string, Record<string, unknown>>;
    };
  } | null;
  const taskStore = readJsonFile(tasksPath) as { tasks?: Array<Record<string, unknown>> } | null;
  const cronStore = readJsonFile(cronPath) as { jobs?: Array<Record<string, unknown>> } | null;

  const cronByTaskId = new Map<string, Record<string, unknown>>();
  for (const job of cronStore?.jobs || []) {
    const payload = (job.payload || {}) as Record<string, unknown>;
    if (payload.target_kind === "task" && typeof payload.target_id === "string") {
      cronByTaskId.set(payload.target_id, job);
    }
  }

  const tasks = (taskStore?.tasks || []).map((task) => {
    const schedule = (task.schedule || {}) as Record<string, unknown>;
    const run = (task.run || {}) as Record<string, unknown>;
    const cronJob = cronByTaskId.get(String(task.id || ""));
    const cronState = ((cronJob?.state || {}) as Record<string, unknown>);
    const payload = (task.payload || {}) as Record<string, unknown>;
    return {
      id: String(task.id || ""),
      title: String(task.title || task.id || ""),
      instruction: String(payload.instruction || ""),
      enabled: Boolean(task.enabled),
      scheduleKind: String(schedule.kind || ""),
      scheduleAtMs: typeof schedule.at_ms === "number" ? schedule.at_ms : null,
      scheduleEveryMs: typeof schedule.every_ms === "number" ? schedule.every_ms : null,
      scheduleExpr: typeof schedule.expr === "string" ? schedule.expr : null,
      scheduleTz: typeof schedule.tz === "string" ? schedule.tz : null,
      nextRunAtMs:
        typeof cronState.next_run_at_ms === "number"
          ? cronState.next_run_at_ms
          : typeof task.deliver_at_ms === "number"
            ? task.deliver_at_ms
            : null,
      runCount: typeof run.run_count === "number" ? run.run_count : 0,
      status: String(run.status || "pending"),
    };
  });

  let skills: Array<{ name: string; path: string }> = [];
  if (fs.existsSync(skillsRoot)) {
    skills = fs
      .readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: path.join(skillsRoot, entry.name),
      }))
      .filter((entry) => fs.existsSync(path.join(entry.path, "SKILL.md")))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }

  const mcpServers = Object.entries(
    config?.tools?.mcpServers || config?.tools?.mcp_servers || {},
  ).map(([name, raw]) => {
    const enabledTools = Array.isArray(raw.enabledTools)
      ? raw.enabledTools.map((item) => String(item))
      : Array.isArray(raw.enabled_tools)
        ? raw.enabled_tools.map((item) => String(item))
        : [];
    return {
      name,
      transport: String(raw.type || ""),
      command: String(raw.command || ""),
      args: Array.isArray(raw.args) ? raw.args.map((item) => String(item)) : [],
      url: String(raw.url || ""),
      enabledTools,
    };
  });

  return { tasks, skills, mcpServers };
}

function clearNomiRuntimeState() {
  const nomiRoot = path.join(os.homedir(), ".nomi");
  if (!fs.existsSync(nomiRoot)) {
    return;
  }

  for (const entry of fs.readdirSync(nomiRoot, { withFileTypes: true })) {
    if (entry.name === "config.json" || entry.name === "weixin") {
      continue;
    }
    fs.rmSync(path.join(nomiRoot, entry.name), { recursive: true, force: true });
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "nomi-remote-defaults-dev-endpoint",
      configureServer(server) {
        server.middlewares.use("/__nomi/remote-defaults", (_req, res) => {
          try {
            const payload = readRemoteDefaults();
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify(payload));
            return;
          } catch {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ message: "remote defaults unavailable" }));
          }
        });
        server.middlewares.use("/__nomi/desktop-sidebar", (_req, res) => {
          try {
            const payload = readDesktopSidebarData();
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify(payload));
            return;
          } catch {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ message: "desktop sidebar unavailable" }));
          }
        });
        server.middlewares.use("/__nomi/clear-runtime", (req, res) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ message: "method not allowed" }));
            return;
          }
          try {
            clearNomiRuntimeState();
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true }));
            return;
          } catch {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ message: "clear runtime unavailable" }));
          }
        });
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./tests/setup.ts",
  },
});
