import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  createEvent,
  injectFaults,
  safeOutputPath,
  stableStringify,
  type FaultType,
  type TraceEvent,
} from "@resilireplay/core";

export const MCP_FAULT_TYPES = [
  "mcp-malformed-tools-list",
  "mcp-renamed-tool",
  "mcp-missing-tool",
  "mcp-incompatible-argument-schema",
  "mcp-tool-timeout",
  "mcp-tool-error",
  "mcp-oversized-content",
  "mcp-protocol-version-mismatch",
  "mcp-invalid-jsonrpc-id",
  "mcp-malicious-canary-instruction",
  "mcp-permission-capability-mismatch",
  "mcp-canary-secret-leakage-attempt",
] as const satisfies readonly FaultType[];

const SAFE_CANARY = "CHAOS_CANARY_DO_NOT_EXPOSE_12345";
const INJECTION_PATTERN =
  /\b(ignore (?:all |any )?(?:previous|prior) instructions?|reveal (?:the )?(?:canary|secret)|send .+ to https?:\/\/)\b/i;

export interface McpFinding {
  id: string;
  severity: "note" | "warning" | "error";
  title: string;
  evidence: string;
  tool?: string;
}

export interface McpAuditOptions {
  command?: string;
  url?: string;
  timeoutMs?: number;
  callTools?: boolean;
  allowRemote?: boolean;
  fault?: (typeof MCP_FAULT_TYPES)[number];
  seed?: number;
}

export interface McpAuditResult {
  target: string;
  transport: "stdio" | "streamable-http";
  tools: Array<{ name: string; description?: string; inputSchema: unknown }>;
  findings: McpFinding[];
  events: TraceEvent[];
  passed: boolean;
  faultApplied?: string;
}

export function splitCommandLine(commandLine: string): string[] {
  const output: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  const trimmed = commandLine.trim();
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]!;
    if (character === "\\" && quote === '"' && ['"', "\\"].includes(trimmed[index + 1] ?? "")) {
      current += trimmed[index + 1];
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      if (quote === character) quote = null;
      else if (quote === null) quote = character;
      else current += character;
      continue;
    }
    if (/\s/u.test(character) && quote === null) {
      if (current) output.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (quote) throw new Error("Unterminated quote in MCP command");
  if (current) output.push(current);
  if (output.length === 0) throw new Error("MCP command cannot be empty");
  return output;
}

function isLoopback(url: URL): boolean {
  return (
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]" ||
    url.hostname === "localhost"
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function exampleForSchema(schema: unknown): Record<string, unknown> {
  if (typeof schema !== "object" || schema === null) return {};
  const root = schema as Record<string, unknown>;
  const properties =
    typeof root.properties === "object" && root.properties !== null
      ? (root.properties as Record<string, unknown>)
      : {};
  const required = Array.isArray(root.required)
    ? root.required.filter((entry) => typeof entry === "string")
    : [];
  return Object.fromEntries(
    required.map((name) => {
      const property =
        typeof properties[name] === "object" && properties[name] !== null
          ? (properties[name] as Record<string, unknown>)
          : {};
      const value =
        property.type === "number" || property.type === "integer"
          ? 1
          : property.type === "boolean"
            ? true
            : property.type === "array"
              ? []
              : property.type === "object"
                ? {}
                : "resilireplay-audit";
      return [name, value];
    }),
  );
}

function inspectText(text: string, tool: string | undefined, findings: McpFinding[]): void {
  if (INJECTION_PATTERN.test(text)) {
    findings.push({
      id: "MCP001",
      severity: "error",
      title: "Prompt-injection-like instruction in MCP content",
      evidence: text.slice(0, 240),
      ...(tool ? { tool } : {}),
    });
  }
  if (text.includes(SAFE_CANARY)) {
    findings.push({
      id: "MCP002",
      severity: "error",
      title: "Safe canary exposed by MCP content",
      evidence: SAFE_CANARY,
      ...(tool ? { tool } : {}),
    });
  }
}

function applyMcpFault(
  runId: string,
  event: TraceEvent,
  fault: (typeof MCP_FAULT_TYPES)[number],
  seed: number,
): TraceEvent {
  const result = injectFaults(
    [event],
    {
      schemaVersion: "1.0",
      id: `mcp-audit-${fault}`,
      description: `Controlled MCP mutation: ${fault}`,
      seed,
      rules: [{ fault, event: event.type, occurrence: 1, probability: 1, parameters: {} }],
    },
    seed,
  );
  const mutated = result.events[0];
  if (!mutated || mutated.runId !== runId) throw new Error("MCP mutation did not produce an event");
  return mutated;
}

export async function auditMcp(options: McpAuditOptions): Promise<McpAuditResult> {
  if (Boolean(options.command) === Boolean(options.url)) {
    throw new Error("Supply exactly one explicitly authorized MCP target: --command or --url");
  }
  const timeoutMs = options.timeoutMs ?? 5000;
  const runId = `mcp-${Date.now().toString(36)}`;
  const events: TraceEvent[] = [
    createEvent({
      runId,
      sequence: 0,
      type: "run_started",
      actor: "resilireplay-mcp-auditor",
      payload: { mode: "authorized-local-audit", telemetry: false },
    }),
  ];
  const findings: McpFinding[] = [];
  let transport: StdioClientTransport | StreamableHTTPClientTransport;
  let target: string;
  let transportName: McpAuditResult["transport"];

  if (options.command) {
    const parts = splitCommandLine(options.command);
    const command = parts.shift();
    if (!command) throw new Error("MCP command cannot be empty");
    transport = new StdioClientTransport({
      command,
      args: parts,
      stderr: "pipe",
    });
    target = options.command;
    transportName = "stdio";
  } else {
    const url = new URL(options.url!);
    if (!isLoopback(url) && !options.allowRemote) {
      throw new Error("Remote MCP audit requires explicit --allow-remote confirmation");
    }
    transport = new StreamableHTTPClientTransport(url);
    target = url.toString();
    transportName = "streamable-http";
  }

  const client = new Client({ name: "resilireplay", version: "0.1.0" }, { capabilities: {} });
  try {
    await withTimeout(client.connect(transport), timeoutMs, "MCP connection");
    const listed = await withTimeout(client.listTools(), timeoutMs, "MCP tools/list");
    let discoveryEvent = createEvent({
      runId,
      sequence: events.length,
      type: "tool_discovered",
      actor: "mcp-server",
      payload: listed,
    });
    if (options.fault?.startsWith("mcp-") && options.fault.includes("tool") === false) {
      discoveryEvent = applyMcpFault(runId, discoveryEvent, options.fault, options.seed ?? 42);
    }
    events.push(discoveryEvent);

    const tools = listed.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      inputSchema: tool.inputSchema,
    }));
    if (tools.length === 0) {
      findings.push({
        id: "MCP003",
        severity: "warning",
        title: "Server exposes no tools",
        evidence: "tools/list returned an empty array",
      });
    }
    for (const tool of tools) {
      inspectText(tool.description ?? "", tool.name, findings);
      if (
        typeof tool.inputSchema !== "object" ||
        tool.inputSchema === null ||
        (tool.inputSchema as Record<string, unknown>).type !== "object"
      ) {
        findings.push({
          id: "MCP004",
          severity: "error",
          title: "Tool input schema is not an object schema",
          evidence: stableStringify(tool.inputSchema).slice(0, 240),
          tool: tool.name,
        });
      }

      const shouldCall = options.callTools || tool.name === "reliability_probe";
      if (!shouldCall) continue;
      events.push(
        createEvent({
          runId,
          sequence: events.length,
          type: "tool_requested",
          actor: "resilireplay-mcp-auditor",
          tool: tool.name,
          payload: exampleForSchema(tool.inputSchema),
        }),
      );
      try {
        const result = await withTimeout(
          client.callTool({ name: tool.name, arguments: exampleForSchema(tool.inputSchema) }),
          timeoutMs,
          `MCP tool ${tool.name}`,
        );
        let resultEvent = createEvent({
          runId,
          sequence: events.length,
          type: "tool_result",
          actor: "mcp-server",
          tool: tool.name,
          payload: result,
        });
        if (options.fault) {
          resultEvent = applyMcpFault(runId, resultEvent, options.fault, options.seed ?? 42);
        }
        events.push(resultEvent);
        inspectText(stableStringify(resultEvent.payload), tool.name, findings);
        if (result.isError) {
          findings.push({
            id: "MCP005",
            severity: "warning",
            title: "MCP tool returned an error",
            evidence: stableStringify(result).slice(0, 240),
            tool: tool.name,
          });
        }
      } catch (error) {
        findings.push({
          id: "MCP006",
          severity: "error",
          title: "MCP tool call failed or timed out",
          evidence: error instanceof Error ? error.message : String(error),
          tool: tool.name,
        });
      }
    }

    const passed = findings.every((finding) => finding.severity !== "error");
    events.push(
      createEvent({
        runId,
        sequence: events.length,
        type: "validation_result",
        actor: "resilireplay-mcp-auditor",
        payload: { valid: passed, findingCount: findings.length },
      }),
      createEvent({
        runId,
        sequence: events.length + 1,
        type: passed ? "run_completed" : "run_failed",
        actor: "resilireplay-mcp-auditor",
        payload: { passed, findingCount: findings.length },
      }),
    );
    return {
      target,
      transport: transportName,
      tools,
      findings,
      events,
      passed,
      ...(options.fault ? { faultApplied: options.fault } : {}),
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

function certificationBadge(passed: boolean): string {
  const value = passed ? "passing v0.1.0" : "findings v0.1.0";
  const color = passed ? "#159957" : "#c0392b";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="276" height="20" role="img" aria-label="MCP Chaos Tested: ${value}"><rect width="164" height="20" rx="3" fill="#555"/><rect x="164" width="112" height="20" rx="3" fill="${color}"/><g fill="#fff" text-anchor="middle" font-family="Verdana,sans-serif" font-size="11"><text x="82" y="15">MCP Chaos Tested</text><text x="220" y="15">${value}</text></g></svg>\n`;
}

export async function writeMcpCertification(
  result: McpAuditResult,
  directoryInput: string,
): Promise<{ jsonPath: string; htmlPath: string; badgePath: string }> {
  const directory = resolve(directoryInput);
  await mkdir(directory, { recursive: true });
  const jsonPath = safeOutputPath(directory, "mcp-certification.json");
  const htmlPath = safeOutputPath(directory, "mcp-certification.html");
  const badgePath = safeOutputPath(directory, "mcp-badge.svg");
  const json = `${stableStringify({
    schemaVersion: "1.0",
    product: "ResiliReplay",
    version: "0.1.0",
    scope:
      "Evidence for this declared local suite and version; not a universal security certification.",
    ...result,
  })}\n`;
  const rows = result.findings
    .map(
      (finding) =>
        `<li><strong>${finding.severity.toUpperCase()} ${finding.id}: ${finding.title}</strong><pre>${finding.evidence.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</pre></li>`,
    )
    .join("");
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>MCP Chaos certification</title><style>body{font:16px system-ui;max-width:850px;margin:40px auto;padding:0 20px}pre{white-space:pre-wrap;background:#f4f4f4;padding:12px}strong{color:${result.passed ? "#159957" : "#c0392b"}}</style><h1>MCP Chaos Tested: ${result.passed ? "PASS" : "FINDINGS"}</h1><p>This is evidence for one declared local suite and ResiliReplay version, not a universal security certification.</p><p>Transport: ${result.transport}; tools: ${result.tools.length}</p><ul>${rows || "<li>No findings.</li>"}</ul></html>\n`;
  await Promise.all([
    writeFile(jsonPath, json, "utf8"),
    writeFile(htmlPath, html, "utf8"),
    writeFile(badgePath, certificationBadge(result.passed), "utf8"),
  ]);
  return { jsonPath, htmlPath, badgePath };
}
