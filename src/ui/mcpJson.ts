export interface ParsedMcpInstallEntry {
  name: string;
  config: Record<string, unknown>;
}

const MCP_CONFIG_KEYS = new Set([
  "enabled",
  "type",
  "command",
  "args",
  "env",
  "url",
  "headers",
  "toolTimeout",
  "tool_timeout",
  "enabledTools",
  "enabled_tools",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeMcpServerConfig(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return keys.some((key) => MCP_CONFIG_KEYS.has(key));
}

function buildSingleNamedConfig(root: Record<string, unknown>): ParsedMcpInstallEntry[] | null {
  const rawName = root.name;
  if (typeof rawName !== "string" || !rawName.trim()) {
    return null;
  }
  if (!looksLikeMcpServerConfig(root)) {
    return null;
  }
  const config = Object.fromEntries(
    Object.entries(root).filter(([key]) => key !== "name"),
  );
  return [{ name: rawName.trim(), config }];
}

export function parseMcpInstallJson(raw: string): ParsedMcpInstallEntry[] {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("MCP JSON 不是合法 JSON。");
  }
  if (!isRecord(payload)) {
    throw new Error("MCP JSON 顶层必须是一个对象。");
  }

  const namedConfig = buildSingleNamedConfig(payload);
  if (namedConfig) {
    return namedConfig;
  }

  let serverMap: Record<string, unknown> | null = null;
  if (isRecord(payload.mcpServers)) {
    serverMap = payload.mcpServers;
  } else if (!looksLikeMcpServerConfig(payload)) {
    serverMap = payload;
  }
  if (!serverMap) {
    throw new Error("请粘贴 {\"mcpServers\": {...}}，或提供带 name 的单个 MCP 配置。");
  }

  const entries = Object.entries(serverMap);
  if (entries.length === 0) {
    throw new Error("MCP JSON 里没有可安装的 server。");
  }

  return entries.map(([name, value]) => {
    if (!name.trim()) {
      throw new Error("MCP 名称不能为空。");
    }
    if (!isRecord(value)) {
      throw new Error(`MCP “${name}” 的配置必须是一个对象。`);
    }
    return {
      name: name.trim(),
      config: value,
    };
  });
}
