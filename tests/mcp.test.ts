import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { auditMcp, MCP_FAULT_TYPES, splitCommandLine } from "@resilireplay/mcp-chaos";

function commandFor(server: string): string {
  const path = join(resolve("."), "examples", server, "dist", "index.js");
  return `"${process.execPath}" "${path}"`;
}

describe("MCP chaos lab", () => {
  it("preserves Windows-style quoted paths and arguments", () => {
    expect(
      splitCommandLine('"C:\\Program Files\\nodejs\\node.exe" "C:\\My Server\\index.js" --flag'),
    ).toEqual(["C:\\Program Files\\nodejs\\node.exe", "C:\\My Server\\index.js", "--flag"]);
    expect(() => splitCommandLine('"unterminated')).toThrow("Unterminated");
  });

  it("ships the complete MCP mutation catalog", () => {
    expect(MCP_FAULT_TYPES).toHaveLength(12);
    expect(MCP_FAULT_TYPES).toContain("mcp-invalid-jsonrpc-id");
    expect(MCP_FAULT_TYPES).toContain("mcp-canary-secret-leakage-attempt");
  });

  it("finds safe toy weaknesses in the vulnerable stdio server", async () => {
    const result = await auditMcp({
      command: commandFor("vulnerable-mcp-server"),
      timeoutMs: 5_000,
    });
    expect(result.passed).toBe(false);
    expect(result.tools.map((tool) => tool.name)).toContain("reliability_probe");
    expect(result.findings.some((finding) => finding.id === "MCP001")).toBe(true);
    expect(result.findings.some((finding) => finding.id === "MCP002")).toBe(true);
  });

  it("certifies the resilient local stdio server", async () => {
    const result = await auditMcp({
      command: commandFor("resilient-mcp-server"),
      timeoutMs: 5_000,
    });
    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("rejects remote HTTP targets without explicit ownership confirmation", async () => {
    await expect(auditMcp({ url: "https://example.com/mcp" })).rejects.toThrow("--allow-remote");
  });
});
