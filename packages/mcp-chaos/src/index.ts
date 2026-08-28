import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  calculateMetrics,
  PRODUCT_VERSION,
  containsLikelySecret,
  createEvent,
  injectFaults,
  prepareContainedOutputDirectory,
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
const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
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
  allowedTools?: string[];
  toolArguments?: Record<string, Record<string, unknown>>;
  allowRemote?: boolean;
  fault?: (typeof MCP_FAULT_TYPES)[number];
  seed?: number;
  recoveryMode?: "none" | "retry";
  retryBudget?: number;
  signal?: AbortSignal;
  serverName?: string;
  sourceConfigSha256?: string;
}

export interface McpAuditResult {
  target: string;
  transport: "stdio" | "streamable-http" | "sse";
  tools: Array<{
    name: string;
    description?: string;
    inputSchema: unknown;
    annotations?: Record<string, unknown>;
  }>;
  findings: McpFinding[];
  events: TraceEvent[];
  passed: boolean;
  faultApplied?: string;
  serverName?: string;
  sourceConfigSha256?: string;
  recovery: { attempted: boolean; succeeded: boolean };
  secretOutputDetected: boolean;
  cleanup: {
    clientClosed: boolean;
    childProcessExited: boolean;
    listenerCountsRestored: boolean;
  };
}

export class McpConnectionError extends Error {
  readonly exitCode = MCP_EXIT_CODES.CONNECTION;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpConnectionError";
  }
}

export function metadataOnlyMcpEvidence(events: readonly TraceEvent[]): TraceEvent[] {
  return events.map((event) => {
    let payload = event.payload;
    if (event.type === "tool_requested") {
      payload = {
        reviewed: true,
        argumentsSha256: createHash("sha256").update(stableStringify(event.payload)).digest("hex"),
      };
    } else if (event.type === "tool_result") {
      payload = {
        bodyPersisted: false,
        outcome: event.fault ? "fault-injected" : "received",
      };
    } else if (event.type === "tool_discovered") {
      const rawTools =
        typeof event.payload === "object" &&
        event.payload !== null &&
        Array.isArray((event.payload as Record<string, unknown>).tools)
          ? ((event.payload as Record<string, unknown>).tools as Array<Record<string, unknown>>)
          : [];
      payload = {
        count: rawTools.length,
        names: rawTools
          .map((tool) => (typeof tool.name === "string" ? sanitize(tool.name) : undefined))
          .filter((name): name is string => name !== undefined),
      };
    }
    return createEvent({
      runId: event.runId,
      stepId: event.stepId,
      ...(event.parentId ? { parentId: event.parentId } : {}),
      ...(event.causeId ? { causeId: event.causeId } : {}),
      sequence: event.sequence,
      timestamp: event.timestamp,
      type: event.type,
      actor: event.actor,
      ...(event.tool ? { tool: event.tool } : {}),
      ...(event.model ? { model: event.model } : {}),
      metadata: event.metadata,
      payload,
      ...(event.fault ? { fault: event.fault } : {}),
    });
  });
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

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let abortHandler: (() => void) | undefined;
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
      ...(signal
        ? [
            new Promise<T>((_resolve, reject) => {
              abortHandler = () => reject(new Error(`${label} cancelled`));
              if (signal.aborted) abortHandler();
              else signal.addEventListener("abort", abortHandler, { once: true });
            }),
          ]
        : []),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortHandler) signal?.removeEventListener("abort", abortHandler);
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

async function waitForChildExit(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
    await new Promise<void>((resolveDelay) => {
      setTimeout(resolveDelay, 10);
    });
  }
  return false;
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
  const retryBudget = options.retryBudget ?? 1;
  if (
    !Number.isSafeInteger(connectionTimeoutMs) ||
    connectionTimeoutMs <= 0 ||
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs <= 0 ||
    !Number.isSafeInteger(retryBudget) ||
    retryBudget < 0 ||
    retryBudget > 10
  ) {
    throw new McpInspectorConfigError(
      "MCP timeouts must be positive integer milliseconds and retry budget must be 0..10",
      "RR_MCP_TIMEOUT",
    );
  }
  if (options.toolArguments && containsLikelySecret(options.toolArguments)) {
    throw new McpInspectorConfigError(
      "Credential-shaped tool arguments are not accepted; replace them with a safe fixture value",
      "RR_MCP_TOOL_ARGUMENT_SECRET",
    );
  }
  if (
    options.toolArguments &&
    Object.keys(options.toolArguments).some(
      (name) => options.allowedTools === undefined || !options.allowedTools.includes(name),
    )
  ) {
    throw new McpInspectorConfigError(
      "Every tool argument entry must match the explicit tool allowlist",
      "RR_MCP_TOOL_ARGUMENT_ALLOWLIST",
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

  if (
    options.allowedTools?.some(
      (name) => name.length === 0 || name.length > 128 || hasControlCharacter(name),
    )
  ) {
    throw new McpInspectorConfigError(
      "MCP tool allowlist entries must be bounded non-control text",
      "RR_MCP_TOOL_ALLOWLIST",
    );
  }
  const client = new Client(
    { name: "resilireplay", version: PRODUCT_VERSION },
    { capabilities: {} },
  );
  const observedSignals = ["SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"] as const;
  const listenerBaseline = Object.fromEntries(
    observedSignals.map((signal) => [signal, process.listenerCount(signal)]),
  );
  let completedResult: McpAuditResult | undefined;
  let secretOutputDetected = false;
  let recoveryAttempted = false;
  let recoveredFaultCount = 0;
  try {
    await withTimeout(
      client.connect(transport),
      connectionTimeoutMs,
      "MCP connection",
      options.signal,
    );
    const listed = await withTimeout(
      client.listTools(),
      requestTimeoutMs,
      "MCP tools/list",
      options.signal,
    );
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
      ...(tool.annotations
        ? { annotations: sanitize(tool.annotations as Record<string, unknown>) }
        : {}),
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

      const shouldCall =
        options.allowedTools === undefined
          ? options.callTools || listedTool.name === "reliability_probe"
          : options.callTools === true && options.allowedTools.includes(listedTool.name);
      if (!shouldCall) continue;
      const argumentsValue =
        options.toolArguments?.[listedTool.name] ?? exampleForSchema(listedTool.inputSchema);
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
          options.signal,
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
        if (options.recoveryMode === "retry" && retryableFault && retryBudget > 0) {
          recoveryAttempted = true;
          let recovered = false;
          let lastFailure = "The bounded recovery retry returned isError=true.";
          for (let attempt = 1; attempt <= retryBudget && !recovered; attempt += 1) {
            events.push(
              createEvent({
                runId,
                sequence: events.length,
                type: "retry",
                actor: "resilireplay-mcp-auditor",
                tool: tool.name,
                payload: { attempt, budget: retryBudget, reason: options.fault },
              }),
            );
            try {
              const retried = await withTimeout(
                client.callTool({ name: listedTool.name, arguments: argumentsValue }),
                requestTimeoutMs,
                `MCP recovery retry ${attempt}/${retryBudget} ${tool.name}`,
                options.signal,
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
              if (!retried.isError) {
                recovered = true;
              }
            } catch (error) {
              lastFailure = sanitize(error instanceof Error ? error.message : String(error));
            }
          }
          if (recovered) {
            recoveredFaultCount += 1;
          } else {
            findings.push({
              id: "MCP008",
              severity: "error",
              title: "MCP recovery retry budget exhausted",
              evidence: lastFailure,
              tool: tool.name,
            });
          }
          events.push(
            createEvent({
              runId,
              sequence: events.length,
              type: "recovery_action",
              actor: "resilireplay-mcp-auditor",
              tool: tool.name,
              payload: { correct: recovered, action: "bounded retry", budget: retryBudget },
            }),
          );
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
    const passed = passedBeforeMetrics && calculateMetrics(events, { retryBudget }).passed;
    completedResult = {
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
      cleanup: {
        clientClosed: false,
        childProcessExited: transportName !== "stdio",
        listenerCountsRestored: false,
      },
    };
    return completedResult;
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
    const childPid = transport instanceof StdioClientTransport ? transport.pid : null;
    await client.close().catch(() => undefined);
    const childProcessExited = childPid === null ? true : await waitForChildExit(childPid);
    if (completedResult) {
      completedResult.cleanup = {
        clientClosed: true,
        childProcessExited,
        listenerCountsRestored: observedSignals.every(
          (signal) => process.listenerCount(signal) === listenerBaseline[signal],
        ),
      };
    }
  }
}

function certificationBadge(passed: boolean): string {
  const value = passed ? `passing v${PRODUCT_VERSION}` : `findings v${PRODUCT_VERSION}`;
  const color = passed ? "#159957" : "#c0392b";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="276" height="20" role="img" aria-label="MCP Chaos Tested: ${value}"><rect width="164" height="20" rx="3" fill="#555"/><rect x="164" width="112" height="20" rx="3" fill="${color}"/><g fill="#fff" text-anchor="middle" font-family="Verdana,sans-serif" font-size="11"><text x="82" y="15">MCP Chaos Tested</text><text x="220" y="15">${value}</text></g></svg>\n`;
}

export async function writeMcpCertification(
  result: McpAuditResult,
  directoryInput: string,
): Promise<{ jsonPath: string; htmlPath: string; badgePath: string }> {
  const requestedDirectory = resolve(directoryInput);
  const directory = await prepareContainedOutputDirectory(
    dirname(requestedDirectory),
    requestedDirectory,
  );
  const jsonPath = safeOutputPath(directory, "mcp-certification.json");
  const htmlPath = safeOutputPath(directory, "mcp-certification.html");
  const badgePath = safeOutputPath(directory, "mcp-badge.svg");
  const json = `${stableStringify({
    schemaVersion: "1.0",
    product: "ResiliReplay",
    version: PRODUCT_VERSION,
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
