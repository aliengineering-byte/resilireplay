import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { auditMcp } from "@resilireplay/mcp-chaos";
import { describe, expect, it } from "vitest";

const cli = resolve("packages/cli/dist/bin.js");

describe("universal ResiliReplay MCP server", () => {
  it("publishes a coherent annotated stdio surface", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, "mcp", "serve"],
      stderr: "pipe",
    });
    const client = new Client(
      { name: "resilireplay-test", version: "1.0.0" },
      { capabilities: {} },
    );
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "resilireplay_status",
          "resilireplay_list_faults",
          "resilireplay_capture_start",
          "resilireplay_generate_regression",
          "resilireplay_run_campaign",
          "resilireplay_verify_evidence",
        ]),
      );
      const status = await client.callTool({ name: "resilireplay_status", arguments: {} });
      expect(status.isError).not.toBe(true);
      expect(JSON.stringify(status)).toContain("capture");
      const payload = JSON.parse(
        ((status as { content: Array<{ text: string }> }).content[0] as { text: string }).text,
      );
      expect(payload.attribution.repository).toBe(
        "https://github.com/aliengineering-byte/resilireplay",
      );
      expect(payload.attribution.packageVersion).toBe("0.7.1");
      const execution = listed.tools.find((tool) => tool.name === "resilireplay_run_campaign");
      expect(execution?.annotations).toMatchObject({
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      });
    } finally {
      await client.close();
    }
  });

  it("passes ResiliReplay's own audit without recursive tool execution", async () => {
    const result = await auditMcp({
      stdio: { command: process.execPath, args: [cli, "mcp", "serve"] },
      timeoutMs: 8_000,
    });
    expect(result.passed).toBe(true);
    expect(result.tools.length).toBeGreaterThanOrEqual(8);
    expect(result.events.some((event) => event.type === "tool_requested")).toBe(false);
  }, 15_000);

  it("rejects malformed calls without terminating the stdio lifecycle", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, "mcp", "serve"],
      stderr: "pipe",
    });
    const client = new Client(
      { name: "resilireplay-negative-test", version: "1.0.0" },
      { capabilities: {} },
    );
    try {
      await client.connect(transport);
      const invalid = await client.callTool({
        name: "resilireplay_inspect_config",
        arguments: { path: "../outside.json" },
      });
      expect(invalid.isError).toBe(true);
      await expect(client.listTools()).resolves.toMatchObject({ tools: expect.any(Array) });
    } finally {
      await client.close();
    }
  });
});
