import { describe, expect, it } from "vitest";

import { parseMcpInstallJson } from "../src/ui/mcpJson";

describe("parseMcpInstallJson", () => {
  it("parses wrapped mcpServers JSON", () => {
    const result = parseMcpInstallJson(`{
      "mcpServers": {
        "12306-mcp": {
          "command": "npx",
          "args": ["-y", "12306-mcp"]
        }
      }
    }`);

    expect(result).toEqual([
      {
        name: "12306-mcp",
        config: {
          command: "npx",
          args: ["-y", "12306-mcp"],
        },
      },
    ]);
  });

  it("parses a named single config", () => {
    const result = parseMcpInstallJson(`{
      "name": "demo-mcp",
      "command": "uvx",
      "args": ["demo-mcp"],
      "enabledTools": ["*"]
    }`);

    expect(result).toEqual([
      {
        name: "demo-mcp",
        config: {
          command: "uvx",
          args: ["demo-mcp"],
          enabledTools: ["*"],
        },
      },
    ]);
  });

  it("rejects invalid root payload", () => {
    expect(() => parseMcpInstallJson(`["not-valid"]`)).toThrow(
      "MCP JSON 顶层必须是一个对象。",
    );
  });
});
