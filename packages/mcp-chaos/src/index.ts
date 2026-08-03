import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  calculateMetrics,
  containsLikelySecret,
  createEvent,
  injectFaults,
  safeOutputPath,
  sanitize,
  stableStringify,
  type FaultType,
  type TraceEvent,
} from "@resilireplay/core";
import {
  MCP_EXIT_CODES,
  McpInspectorConfigError,
  McpRemoteAuthorizationError,
  isLoopbackMcpUrl,
} from "./inspector-config.js";

export * from "./inspector-config.js";

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
const DISCOVERY_FAULTS = new Set<(typeof MCP_FAULT_TYPES)[number]>([
  "mcp-malformed-tools-list",
  "mcp-renamed-tool",
  "mcp-missing-tool",
  "mcp-incompatible-argument-schema",
  "mcp-protocol-version-mismatch",
  "mcp-permission-capability-mismatch",
]);

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
  stdio?: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
  };
  http?: {
    url: string;
    headers?: Record<string, string>;
    transport?: "streamable-http" | "sse";
  };
  timeoutMs?: number;
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
  callTools?: boolean;
  allowRemote?: boolean;
  fault?: (typeof MCP_FAULT_TYPES)[number];
  seed?: number;
  recoveryMode?: "none" | "retry";
  serverName?: string;
  sourceConfigSha256?: string;
}

export interface McpAuditResult {
  target: string;
  transport: "stdio" | "streamable-http" | "sse";
  tools: Array<{ name: string; description?: string; inputSchema: unknown }>;
  findings: McpFinding[];
  events: TraceEvent[];
  passed: boolean;
  faultApplied?: string;
  serverName?: string;
  sourceConfigSha256?: string;
  recovery: { attempted: boolean; succeeded: boolean };
  secretOutputDetected: boolean;
}

export class McpConnectionError extends Error {
  readonly exitCode = MCP_EXIT_CODES.CONNECTION;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpConnectionError";
  }
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
      evidence: sanitize(text).slice(0, 240),
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

function inspectSecretOutput(
  value: unknown,
  tool: string | undefined,
  findings: McpFinding[],
): boolean {
  if (!containsLikelySecret(value)) return false;
  findings.push({
    id: "MCP007",
    severity: "error",
    title: "Credential-shaped MCP output was redacted",
    evidence:
      "Credential-shaped content was detected before persistence and replaced with [REDACTED].",
    ...(tool ? { tool } : {}),
  });
  return true;
}

function mergeHeaders(
  base: ConstructorParameters<typeof Headers>[0] | undefined,
  imported: Record<string, string>,
): Headers {
  const headers = new Headers(base);
  for (const [name, value] of Object.entries(imported)) headers.set(name, value);
  return headers;
}

function publicHttpTarget(url: URL): string {
  return `${url.origin}${url.pathname}`;
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
  return createEvent({ ...mutated, sequence: event.sequence, timestamp: event.timestamp });
}

export async function auditMcp(options: McpAuditOptions): Promise<McpAuditResult> {
  const targetCount = [options.command, options.url, options.stdio, options.http].filter(
    Boolean,
  ).length;
  if (targetCount !== 1) {
    throw new McpInspectorConfigError(
      "Supply exactly one MCP target: --inspector-config, --command, or --url",
      "RR_MCP_TARGET_SELECTION",
    );
  }
  const connectionTimeoutMs = options.timeoutMs ?? options.connectionTimeoutMs ?? 5_000;
  const requestTimeoutMs = options.timeoutMs ?? options.requestTimeoutMs ?? 5_000;
  if (
    !Number.isSafeInteger(connectionTimeoutMs) ||
    connectionTimeoutMs <= 0 ||
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs <= 0
  ) {
    throw new McpInspectorConfigError(
      "MCP timeouts must be positive integer milliseconds",
      "RR_MCP_TIMEOUT",
    );
  }
  const runId = `mcp-${Date.now().toString(36)}`;
  const events: TraceEvent[] = [
    createEvent({
      runId,
      sequence: 0,
      type: "run_started",
      actor: "resilireplay-mcp-auditor",
      payload: {
        mode: "authorized-mcp-audit",
        telemetry: false,
        ...(options.serverName ? { inspectorServer: sanitize(options.serverName) } : {}),
        ...(options.sourceConfigSha256 ? { sourceConfigSha256: options.sourceConfigSha256 } : {}),
      },
    }),
  ];
  const findings: McpFinding[] = [];
  let transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;
  let target: string;
  let transportName: McpAuditResult["transport"];

  if (options.command || options.stdio) {
    const direct = options.command ? splitCommandLine(options.command) : undefined;
    const command = options.stdio?.command ?? direct?.shift();
    if (!command) {
      throw new McpInspectorConfigError("MCP command cannot be empty", "RR_MCP_CONFIG_COMMAND");
    }
    const declaredEnvironment = options.stdio?.env;
    transport = new StdioClientTransport({
      command,
      args: options.stdio?.args ?? direct ?? [],
      ...(declaredEnvironment && Object.keys(declaredEnvironment).length > 0
        ? { env: { ...getDefaultEnvironment(), ...declaredEnvironment } }
        : {}),
      ...(options.stdio?.cwd ? { cwd: options.stdio.cwd } : {}),
      stderr: "pipe",
    });
    target = options.serverName
      ? `Inspector server ${sanitize(options.serverName)}`
      : `stdio executable ${sanitize(command.split(/[\\/]/u).at(-1) ?? "configured")}`;
    transportName = "stdio";
  } else {
    const rawUrl = options.http?.url ?? options.url!;
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch (error) {
      throw new McpInspectorConfigError(`Invalid MCP server URL: ${rawUrl}`, "RR_MCP_CONFIG_URL", {
        cause: error,
      });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new McpInspectorConfigError(
        "MCP server URL must use http or https",
        "RR_MCP_CONFIG_URL",
      );
    }
    if (
      url.username ||
      url.password ||
      [...url.searchParams].some(
        ([key, value]) =>
          /(?:authorization|api[-_]?key|token|secret|password)/iu.test(key) ||
          containsLikelySecret(value),
      )
    ) {
      throw new McpInspectorConfigError(
        "Credentials are not permitted in an MCP server URL; use a protected header declaration",
        "RR_MCP_CONFIG_URL_CREDENTIAL",
      );
    }
    if (!isLoopbackMcpUrl(url) && !options.allowRemote) {
      throw new McpRemoteAuthorizationError();
    }
    const headers = options.http?.headers ?? {};
    const requestInit =
      Object.keys(headers).length > 0 ? { headers: mergeHeaders(undefined, headers) } : undefined;
    if (options.http?.transport === "sse") {
      const sseFetch = ((input: string | URL | Request, init?: RequestInit) =>
        fetch(input, {
          ...init,
          headers: mergeHeaders(init?.headers, headers),
        })) as never;
      transport = new SSEClientTransport(url, {
        ...(requestInit ? { requestInit } : {}),
        eventSourceInit: { fetch: sseFetch },
      });
      transportName = "sse";
    } else {
      transport = new StreamableHTTPClientTransport(url, requestInit ? { requestInit } : undefined);
      transportName = "streamable-http";
    }
    target = options.serverName
      ? `Inspector server ${sanitize(options.serverName)}`
      : publicHttpTarget(url);
  }

  const client = new Client({ name: "resilireplay", version: "0.2.1" }, { capabilities: {} });
  let secretOutputDetected = false;
  let recoveryAttempted = false;
  let recoveredFaultCount = 0;
  try {
    await withTimeout(client.connect(transport), connectionTimeoutMs, "MCP connection");
    const listed = await withTimeout(client.listTools(), requestTimeoutMs, "MCP tools/list");
    secretOutputDetected = inspectSecretOutput(listed, undefined, findings);
    let discoveryEvent = createEvent({
      runId,
      sequence: events.length,
      type: "tool_discovered",
      actor: "mcp-server",
      payload: listed,
    });
    if (options.fault && DISCOVERY_FAULTS.has(options.fault)) {
      discoveryEvent = applyMcpFault(runId, discoveryEvent, options.fault, options.seed ?? 42);
    }
    events.push(discoveryEvent);

    const tools = listed.tools.map((tool) => ({
      name: sanitize(tool.name),
      ...(tool.description ? { description: sanitize(tool.description) } : {}),
      inputSchema: sanitize(tool.inputSchema),
    }));
    if (tools.length === 0) {
      findings.push({
        id: "MCP003",
        severity: "warning",
        title: "Server exposes no tools",
        evidence: "tools/list returned an empty array",
      });
    }
    for (const [toolIndex, tool] of tools.entries()) {
      const listedTool = listed.tools[toolIndex]!;
      inspectText(listedTool.description ?? "", tool.name, findings);
      if (
        typeof listedTool.inputSchema !== "object" ||
        listedTool.inputSchema === null ||
        (listedTool.inputSchema as Record<string, unknown>).type !== "object"
      ) {
        findings.push({
          id: "MCP004",
          severity: "error",
          title: "Tool input schema is not an object schema",
          evidence: stableStringify(tool.inputSchema).slice(0, 240),
          tool: tool.name,
        });
      }

      const shouldCall = options.callTools || listedTool.name === "reliability_probe";
      if (!shouldCall) continue;
      const argumentsValue = exampleForSchema(listedTool.inputSchema);
      events.push(
        createEvent({
          runId,
          sequence: events.length,
          type: "tool_requested",
          actor: "resilireplay-mcp-auditor",
          tool: tool.name,
          payload: argumentsValue,
        }),
      );
      try {
        const result = await withTimeout(
          client.callTool({ name: listedTool.name, arguments: argumentsValue }),
          requestTimeoutMs,
          `MCP tool ${tool.name}`,
        );
        secretOutputDetected =
          inspectSecretOutput(result, tool.name, findings) || secretOutputDetected;
        let resultEvent = createEvent({
          runId,
          sequence: events.length,
          type: "tool_result",
          actor: "mcp-server",
          tool: tool.name,
          payload: result,
        });
        if (options.fault && !DISCOVERY_FAULTS.has(options.fault)) {
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

        const retryableFault =
          options.fault === "mcp-tool-error" || options.fault === "mcp-tool-timeout";
        if (options.recoveryMode === "retry" && retryableFault) {
          recoveryAttempted = true;
          events.push(
            createEvent({
              runId,
              sequence: events.length,
              type: "retry",
              actor: "resilireplay-mcp-auditor",
              tool: tool.name,
              payload: { attempt: 1, budget: 1, reason: options.fault },
            }),
          );
          try {
            const retried = await withTimeout(
              client.callTool({ name: listedTool.name, arguments: argumentsValue }),
              requestTimeoutMs,
              `MCP recovery retry ${tool.name}`,
            );
            secretOutputDetected =
              inspectSecretOutput(retried, tool.name, findings) || secretOutputDetected;
            events.push(
              createEvent({
                runId,
                sequence: events.length,
                type: "tool_result",
                actor: "mcp-server",
                tool: tool.name,
                payload: retried,
              }),
            );
            if (retried.isError) {
              findings.push({
                id: "MCP008",
                severity: "error",
                title: "MCP recovery retry returned an error",
                evidence: "The bounded recovery retry returned isError=true.",
                tool: tool.name,
              });
              events.push(
                createEvent({
                  runId,
                  sequence: events.length,
                  type: "recovery_action",
                  actor: "resilireplay-mcp-auditor",
                  tool: tool.name,
                  payload: { correct: false, action: "bounded retry" },
                }),
              );
            } else {
              recoveredFaultCount += 1;
              events.push(
                createEvent({
                  runId,
                  sequence: events.length,
                  type: "recovery_action",
                  actor: "resilireplay-mcp-auditor",
                  tool: tool.name,
                  payload: { correct: true, action: "bounded retry" },
                }),
              );
            }
          } catch (error) {
            findings.push({
              id: "MCP008",
              severity: "error",
              title: "MCP recovery retry failed",
              evidence: sanitize(error instanceof Error ? error.message : String(error)),
              tool: tool.name,
            });
            events.push(
              createEvent({
                runId,
                sequence: events.length,
                type: "recovery_action",
                actor: "resilireplay-mcp-auditor",
                tool: tool.name,
                payload: { correct: false, action: "bounded retry" },
              }),
            );
          }
        }
      } catch (error) {
        findings.push({
          id: "MCP006",
          severity: "error",
          title: "MCP tool call failed or timed out",
          evidence: sanitize(error instanceof Error ? error.message : String(error)),
          tool: tool.name,
        });
      }
    }

    if (secretOutputDetected) {
      events.push(
        createEvent({
          runId,
          sequence: events.length,
          type: "safety_violation",
          actor: "resilireplay-mcp-auditor",
          payload: { kind: "credential-shaped-output", persisted: false },
        }),
      );
    }
    const faultCount = events.filter((event) => event.fault !== undefined).length;
    const recoverySucceeded = recoveryAttempted && recoveredFaultCount === faultCount;
    const passedBeforeMetrics =
      findings.every((finding) => finding.severity !== "error") &&
      (faultCount === 0 || recoverySucceeded);
    events.push(
      createEvent({
        runId,
        sequence: events.length,
        type: "validation_result",
        actor: "resilireplay-mcp-auditor",
        payload: {
          valid: passedBeforeMetrics,
          findingCount: findings.length,
          recoveryAttempted,
          recoverySucceeded,
        },
      }),
      createEvent({
        runId,
        sequence: events.length + 1,
        type: passedBeforeMetrics ? "run_completed" : "run_failed",
        actor: "resilireplay-mcp-auditor",
        payload: { passed: passedBeforeMetrics, findingCount: findings.length },
      }),
    );
    const passed = passedBeforeMetrics && calculateMetrics(events).passed;
    return {
      target,
      transport: transportName,
      tools,
      findings,
      events,
      passed,
      ...(options.fault ? { faultApplied: options.fault } : {}),
      ...(options.serverName ? { serverName: sanitize(options.serverName) } : {}),
      ...(options.sourceConfigSha256 ? { sourceConfigSha256: options.sourceConfigSha256 } : {}),
      recovery: { attempted: recoveryAttempted, succeeded: recoverySucceeded },
      secretOutputDetected,
    };
  } catch (error) {
    if (
      error instanceof McpInspectorConfigError ||
      error instanceof McpRemoteAuthorizationError ||
      error instanceof McpConnectionError
    ) {
      throw error;
    }
    const message = sanitize(error instanceof Error ? error.message : String(error));
    throw new McpConnectionError(`MCP connection or protocol failure: ${message}`, {
      cause: error,
    });
  } finally {
    await client.close().catch(() => undefined);
  }
}

function certificationBadge(passed: boolean): string {
  const value = passed ? "passing v0.2.1" : "findings v0.2.1";
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
    version: "0.2.1",
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
