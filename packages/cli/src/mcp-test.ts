import { join, relative } from "node:path";
import {
  calculateMetrics,
  createEvent,
  prepareContainedOutputDirectory,
  resolveContainedOutputPath,
  sha256,
  stableStringify,
} from "@resilireplay/core";
import {
  auditMcp,
  loadInspectorConfig,
  metadataOnlyMcpEvidence,
  MCP_FAULT_TYPES,
  McpInspectorConfigError,
  writeMcpCertification,
  type ImportedInspectorServer,
} from "@resilireplay/mcp-chaos";
import { writeReportBundle } from "@resilireplay/reporters";
import { compileRegression, writeTrace } from "@resilireplay/trace";
import { executeRegression } from "./demo.js";

export const MCP_TEST_SAFETY_CLASSES = ["read-only", "inert", "reviewed-idempotent"] as const;

export interface McpTestOptions {
  config: string;
  server?: string;
  tool?: string;
  safety?: (typeof MCP_TEST_SAFETY_CLASSES)[number];
  dryRun?: boolean;
  approve?: string;
  fault?: (typeof MCP_FAULT_TYPES)[number];
  retries?: number;
  timeoutMs?: number;
  outputDirectory?: string;
  regression?: boolean;
  json?: boolean;
  rootDirectory?: string;
}

export interface McpTestPlan {
  schemaVersion: "1.0";
  sourceProfile: string;
  configSha256: string;
  server: string;
  transport: "stdio" | "streamable-http" | "sse";
  allowedTools: string[];
  safety: (typeof MCP_TEST_SAFETY_CLASSES)[number] | "unclassified";
  fault: (typeof MCP_FAULT_TYPES)[number];
  recovery: "retry";
  retryBudget: number;
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
  regression: boolean;
  outputDirectory: string;
  planSha256: string;
}

export interface McpTestResult {
  schemaVersion: "1.0";
  result: "PASS" | "FAIL";
  server: string;
  transport: "stdio" | "streamable-http" | "sse";
  tool: string;
  cleanControl: "PASS" | "FAIL";
  faultObserved: boolean;
  recoveryAttempts: number;
  recoverySucceeded: boolean;
  duplicateEffects: number;
  regressionGenerated: boolean;
  regressionExecuted: boolean;
  cleanupComplete: boolean;
  evidenceSha256: string;
  planSha256: string;
  outputDirectory: string;
}

function checkedInteger(value: number | undefined, fallback: number, label: string): number {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new McpInspectorConfigError(`${label} must be a positive integer`, "RR_MCP_TEST_BOUND");
  }
  return candidate;
}

function validateTool(tool: string | undefined): void {
  if (tool === undefined) return;
  if (
    tool.length === 0 ||
    tool.length > 128 ||
    [...tool].some((value) => value.charCodeAt(0) < 32)
  ) {
    throw new McpInspectorConfigError(
      "--tool must be bounded non-control text",
      "RR_MCP_TOOL_ALLOWLIST",
    );
  }
}

function relativeOutput(root: string, output: string): string {
  return relative(root, output).replaceAll("\\", "/") || ".";
}

async function importedPlan(
  options: McpTestOptions,
): Promise<{ imported: ImportedInspectorServer; output: string; plan: McpTestPlan }> {
  const root = options.rootDirectory ?? process.cwd();
  validateTool(options.tool);
  const retries = checkedInteger(options.retries, 1, "--retries");
  if (retries > 10) {
    throw new McpInspectorConfigError("--retries must be at most 10", "RR_MCP_TEST_BOUND");
  }
  const timeoutMs = checkedInteger(options.timeoutMs, 10_000, "--timeout");
  const fault = options.fault ?? "mcp-tool-error";
  if (!MCP_FAULT_TYPES.includes(fault)) {
    throw new McpInspectorConfigError(`Unknown MCP fault: ${fault}`, "RR_MCP_TEST_FAULT");
  }
  const imported = await loadInspectorConfig(options.config, {
    ...(options.server ? { serverName: options.server } : {}),
    allowRemote: false,
    allowedRoot: root,
    environment: process.env,
  });
  const output = await resolveContainedOutputPath(
    root,
    options.outputDirectory ?? ".resilireplay/mcp-test",
  );
  const unsigned = {
    schemaVersion: "1.0",
    sourceProfile: imported.plan.sourceProfile.id,
    configSha256: imported.configSha256,
    server: imported.serverName,
    transport: imported.transport,
    allowedTools: options.tool ? [options.tool] : [],
    safety: options.safety ?? "unclassified",
    fault,
    recovery: "retry",
    retryBudget: retries,
    connectionTimeoutMs: timeoutMs,
    requestTimeoutMs: timeoutMs,
    regression: options.regression ?? true,
    outputDirectory: relativeOutput(root, output),
  } as const;
  return {
    imported,
    output,
    plan: { ...unsigned, planSha256: sha256(stableStringify(unsigned)) },
  };
}

export async function planMcpTest(options: McpTestOptions): Promise<McpTestPlan> {
  return (await importedPlan(options)).plan;
}

export function mcpTestPlanReport(plan: McpTestPlan, config: string): string {
  const tool = plan.allowedTools[0];
  const reviewedCommand = tool
    ? `npx --yes resilireplay@latest mcp test --config ${config} --server ${plan.server} --tool ${tool} --safety ${plan.safety} --approve ${plan.planSha256}`
    : `npx --yes resilireplay@latest mcp test --config ${config} --server ${plan.server} --dry-run --tool <reviewed-tool> --safety <classification>`;
  return [
    "ResiliReplay MCP test plan",
    "",
    `Selected server: ${plan.server}`,
    `Transport: ${plan.transport}`,
    `Tools: ${tool ?? "none (review required)"}`,
    `Safety: ${plan.safety}`,
    `Fault: ${plan.fault}`,
    `Retries: ${plan.retryBudget}`,
    `Timeout: ${plan.requestTimeoutMs}ms`,
    `Regression: ${plan.regression ? "generate and execute" : "disabled"}`,
    `Plan SHA-256: ${plan.planSha256}`,
    "",
    "Nothing was started or written.",
    "",
    "Run the approved plan with:",
    reviewedCommand,
  ].join("\n");
}

export async function runMcpTest(options: McpTestOptions): Promise<McpTestPlan | McpTestResult> {
  const root = options.rootDirectory ?? process.cwd();
  const { imported, output, plan } = await importedPlan(options);
  if (options.dryRun) return plan;
  const tool = options.tool;
  if (!tool) {
    throw new McpInspectorConfigError(
      "Approved execution requires one explicit --tool allowlist entry",
      "RR_MCP_TEST_TOOL_REQUIRED",
    );
  }
  if (!options.safety || !MCP_TEST_SAFETY_CLASSES.includes(options.safety)) {
    throw new McpInspectorConfigError(
      `Approved execution requires --safety ${MCP_TEST_SAFETY_CLASSES.join("|")}`,
      "RR_MCP_TEST_SAFETY_REQUIRED",
    );
  }
  if (options.approve !== plan.planSha256) {
    throw new McpInspectorConfigError(
      "--approve must exactly match the reviewed plan SHA-256",
      "RR_MCP_TEST_APPROVAL",
    );
  }

  const auditTarget =
    imported.transport === "stdio"
      ? {
          stdio: {
            command: imported.command,
            args: imported.args,
            env: imported.env,
            ...(imported.cwd ? { cwd: imported.cwd } : {}),
          },
        }
      : {
          http: {
            url: imported.url,
            headers: imported.headers,
            transport: imported.transport,
          },
        };
  const auditCommon = {
    ...auditTarget,
    allowRemote: false,
    callTools: true,
    allowedTools: [tool],
    seed: 42,
    timeoutMs: plan.requestTimeoutMs,
    serverName: imported.serverName,
    sourceConfigSha256: imported.configSha256,
  };
  const cleanAudit = await auditMcp({
    ...auditCommon,
    recoveryMode: "none",
    retryBudget: plan.retryBudget,
  });
  const audit = await auditMcp({
    ...auditCommon,
    fault: plan.fault,
    recoveryMode: "retry",
    retryBudget: plan.retryBudget,
  });
  const cleanEvents = metadataOnlyMcpEvidence(cleanAudit.events);
  const events = metadataOnlyMcpEvidence(audit.events);
  const cleanCalls = cleanEvents.filter(
    (event) => event.type === "tool_requested" && event.tool === tool,
  );
  if (!cleanAudit.passed || cleanCalls.length === 0) {
    throw new McpInspectorConfigError(
      `The clean control for reviewed tool ${tool} did not pass`,
      "RR_MCP_TEST_TOOL_MISSING",
    );
  }
  const metrics = calculateMetrics(events, { retryBudget: plan.retryBudget });
  const directory = await prepareContainedOutputDirectory(root, output);
  await Promise.all([
    writeTrace(join(directory, "clean-control.jsonl"), cleanEvents, { allowedRoot: root }),
    writeTrace(join(directory, "trace.jsonl"), events, { allowedRoot: root }),
  ]);
  const sanitizedAudit = { ...audit, events };
  await writeMcpCertification(sanitizedAudit, directory);
  await writeReportBundle(events, join(directory, "reports"));

  let regressionGenerated = false;
  let regressionExecuted = false;
  if (plan.regression) {
    const faultIndex = events.findIndex((event) => event.fault !== undefined);
    if (faultIndex < 0) {
      throw new McpInspectorConfigError(
        "Regression generation requires causal fault evidence",
        "RR_MCP_TEST_REGRESSION_CAUSE",
      );
    }
    const causalEvents = events.slice(0, faultIndex + 1);
    const last = causalEvents.at(-1)!;
    causalEvents.push(
      createEvent({
        runId: last.runId,
        sequence: last.sequence + 1,
        type: "run_failed",
        actor: "resilireplay-mcp-test",
        causeId: last.stepId,
        payload: { expected: true, reason: "controlled MCP fault" },
      }),
    );
    const regression = await compileRegression(causalEvents, join(directory, "regression"), {
      allowedRoot: root,
    });
    regressionGenerated = true;
    await executeRegression(regression.testPath);
    regressionExecuted = true;
  }
  const recoveryAttempts = events.filter((event) => event.type === "retry").length;
  const faultObserved = events.some((event) => event.fault !== undefined);
  const cleanupComplete = [cleanAudit, audit].every(
    (result) =>
      result.cleanup.clientClosed &&
      result.cleanup.childProcessExited &&
      result.cleanup.listenerCountsRestored,
  );
  const passed =
    cleanAudit.passed &&
    audit.passed &&
    faultObserved &&
    audit.recovery.succeeded &&
    recoveryAttempts === plan.retryBudget &&
    metrics.duplicateSideEffectAttempts === 0 &&
    cleanupComplete &&
    (!plan.regression || regressionExecuted);
  const evidenceSha256 = sha256(
    stableStringify({
      planSha256: plan.planSha256,
      cleanEventDigests: cleanEvents.map((event) => event.payloadHash),
      eventDigests: events.map((event) => event.payloadHash),
      passed,
      recoveryAttempts,
      duplicateEffects: metrics.duplicateSideEffectAttempts,
      regressionGenerated,
      regressionExecuted,
    }),
  );
  return {
    schemaVersion: "1.0",
    result: passed ? "PASS" : "FAIL",
    server: imported.serverName,
    transport: imported.transport,
    tool,
    cleanControl: cleanAudit.passed && cleanCalls.length > 0 ? "PASS" : "FAIL",
    faultObserved,
    recoveryAttempts,
    recoverySucceeded: audit.recovery.succeeded,
    duplicateEffects: metrics.duplicateSideEffectAttempts,
    regressionGenerated,
    regressionExecuted,
    cleanupComplete,
    evidenceSha256,
    planSha256: plan.planSha256,
    outputDirectory: relativeOutput(root, directory),
  };
}

export function mcpTestTerminalReport(result: McpTestResult): string {
  return [
    `ResiliReplay MCP test: ${result.result}`,
    `Clean tool call: ${result.cleanControl}`,
    `Fault observed: ${result.faultObserved ? "yes" : "no"}`,
    `Recovery attempts: ${result.recoveryAttempts}`,
    `Duplicate effects: ${result.duplicateEffects}`,
    `Regression: ${result.regressionExecuted ? "generated and passed" : "disabled"}`,
    `Cleanup: ${result.cleanupComplete ? "complete" : "incomplete"}`,
    `Evidence: sha256:${result.evidenceSha256}`,
    `Artifacts: ${result.outputDirectory}`,
  ].join("\n");
}
