import fs from "node:fs";
import type { IncomingMessage } from "node:http";
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

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
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
        server.middlewares.use("/__nomi/skills/upload", async (req, res) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ message: "method not allowed" }));
            return;
          }
          try {
            const host = String(req.headers["x-nomi-remote-host"] || "").trim();
            const port = String(req.headers["x-nomi-remote-port"] || "").trim();
            const token = String(req.headers["x-nomi-remote-token"] || "").trim();
            const contentType = String(req.headers["content-type"] || "").trim();
            if (!host || !port || !contentType) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ message: "remote upload target missing" }));
              return;
            }

            const body = await readRequestBody(req);
            const response = await fetch(`http://${host}:${port}/skills/upload`, {
              method: "POST",
              headers: {
                "Content-Type": contentType,
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: new Uint8Array(body),
            });

            res.statusCode = response.status;
            res.setHeader(
              "Content-Type",
              response.headers.get("content-type") || "application/json; charset=utf-8",
            );
            res.end(Buffer.from(await response.arrayBuffer()));
          } catch (error) {
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({
                message: error instanceof Error ? error.message : "skill upload unavailable",
              }),
            );
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
