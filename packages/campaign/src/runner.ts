import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { parseDocument, stringify } from "yaml";
import {
  calculateMetrics,
  injectFaults,
  PRODUCT_VERSION,
  safeOutputPath,
  sanitize,
  sha256,
  stableStringify,
  type RecoveryMetrics,
  type TraceEvent,
} from "@resilireplay/core";
import {
  auditMcp,
  loadInspectorConfig,
  metadataOnlyMcpEvidence,
  MCP_FAULT_TYPES,
  type McpAuditOptions,
} from "@resilireplay/mcp-chaos";
import { writeReportBundle } from "@resilireplay/reporters";
import { compileRegression, readTrace, writeTrace } from "@resilireplay/trace";
import {
  CAMPAIGN_EXIT_CODES,
  CampaignError,
  CampaignRunSchema,
  CampaignScenarioResultSchema,
  CampaignSchema,
  type Campaign,
  type CampaignRun,
  type CampaignScenario,
  type CampaignScenarioResult,
  type CampaignTarget,
} from "./schemas.js";

const MAX_CAMPAIGN_BYTES = 1_048_576;

export interface CampaignProgress {
  phase: "starting" | "scenario-started" | "scenario-completed" | "completed";
  completed: number;
  total: number;
  scenarioId?: string;
  scenarioStatus?: CampaignScenarioResult["status"];
}

export interface RunCampaignOptions {
  rootDirectory?: string;
  outputDirectory?: string;
  confirmedToolCampaignHash?: string;
  allowRemoteTargets?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: CampaignProgress) => void;
}

function isContained(root: string, candidate: string): boolean {
  const relationship = relative(root, candidate);
  return relationship === "" || (relationship !== ".." && !relationship.startsWith(`..${sep}`));
}

async function containedFile(rootInput: string, pathInput: string): Promise<string> {
  const root = await realpath(resolve(rootInput));
  const lexical = safeOutputPath(root, pathInput);
  let actual: string;
  try {
    actual = await realpath(lexical);
  } catch (error) {
    throw new CampaignError(
      `Campaign input was not found: ${pathInput}`,
      CAMPAIGN_EXIT_CODES.TARGET,
      {
        cause: error,
      },
    );
  }
  if (!isContained(root, actual)) {
    throw new CampaignError(
      `Campaign input resolves outside the repository root: ${pathInput}`,
      CAMPAIGN_EXIT_CODES.AUTHORIZATION,
    );
  }
  const information = await stat(actual);
  if (!information.isFile()) {
    throw new CampaignError(`Campaign input is not a file: ${pathInput}`);
  }
  return actual;
}

async function containedOutputDirectory(rootInput: string, pathInput: string): Promise<string> {
  const root = await realpath(resolve(rootInput));
  const output = safeOutputPath(root, pathInput);
  await mkdir(dirname(output), { recursive: true });
  const parent = await realpath(dirname(output));
  if (!isContained(root, parent)) {
    throw new CampaignError(
      `Campaign output parent resolves outside the repository root: ${pathInput}`,
      CAMPAIGN_EXIT_CODES.AUTHORIZATION,
    );
  }
  try {
    await mkdir(output);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new CampaignError(
        `Campaign output directory already exists; choose a new evidence path: ${pathInput}`,
        CAMPAIGN_EXIT_CODES.INTEGRITY,
        { cause: error },
      );
    }
    throw error;
  }
  const actual = await realpath(output);
  if (!isContained(root, actual)) {
    throw new CampaignError(
      `Campaign output resolves outside the repository root: ${pathInput}`,
      CAMPAIGN_EXIT_CODES.AUTHORIZATION,
    );
  }
  return actual;
}

function repositoryPath(root: string, candidate: string): string {
  const value = relative(root, candidate).replaceAll("\\", "/");
  if (!value || value.startsWith("../")) {
    throw new CampaignError("Artifact path escaped the repository root");
  }
  return value;
}

function parseCampaignText(raw: string, source: string): Campaign {
  let value: unknown;
  if (source.toLowerCase().endsWith(".json")) {
    try {
      value = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new CampaignError(
        `Invalid campaign JSON: ${error instanceof Error ? error.message : String(error)}`,
        CAMPAIGN_EXIT_CODES.INVALID_SCHEMA,
        { cause: error },
      );
    }
  } else {
    const document = parseDocument(raw, { uniqueKeys: true });
    if (document.errors.length > 0) {
      throw new CampaignError(
        `Invalid campaign YAML: ${document.errors[0]?.message ?? "unknown error"}`,
      );
    }
    try {
      value = document.toJS({ maxAliasCount: 0 }) as unknown;
    } catch (error) {
      throw new CampaignError(
        `Unsafe campaign YAML: ${error instanceof Error ? error.message : String(error)}`,
        CAMPAIGN_EXIT_CODES.INVALID_SCHEMA,
        { cause: error },
      );
    }
  }
  const parsed = CampaignSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".") || "$"}: ${issue.message}`)
      .join("; ");
    throw new CampaignError(`Invalid campaign schema: ${issues}`);
  }
  return parsed.data;
}

export async function loadCampaignFile(
  pathInput: string,
  rootDirectory = process.cwd(),
): Promise<{ campaign: Campaign; path: string; campaignHash: string }> {
  const path = await containedFile(rootDirectory, pathInput);
  const information = await stat(path);
  if (information.size > MAX_CAMPAIGN_BYTES) {
    throw new CampaignError(`Campaign file exceeds ${MAX_CAMPAIGN_BYTES} bytes`);
  }
  const campaign = parseCampaignText(await readFile(path, "utf8"), path);
  return { campaign, path, campaignHash: campaignHash(campaign) };
}

export function campaignHash(campaignInput: Campaign): string {
  return sha256(stableStringify(CampaignSchema.parse(campaignInput)));
}

export function createCampaignTemplate(): Campaign {
  return CampaignSchema.parse({
    schemaVersion: "1.0",
    kind: "resilireplay-campaign",
    id: "my-first-campaign",
    description: "A bounded deterministic recovery campaign.",
    seed: 42,
    budgets: {
      concurrency: 1,
      retries: 1,
      scenarioTimeoutMs: 10_000,
      totalTimeoutMs: 60_000,
    },
    targets: [{ id: "recorded-agent", kind: "trace", trace: "runs/latest/trace.jsonl" }],
    scenarios: [
      {
        id: "malformed-model-response",
        target: "recorded-agent",
        fault: "malformed-json",
        event: "model_response",
        occurrence: 1,
        parameters: {},
        recovery: "none",
        assertions: {
          outcome: "failed",
          noDuplicateSideEffects: true,
          safetyPolicyCompliance: true,
        },
      },
    ],
    thresholds: {
      maxScoreDrop: 0,
      maxRetryIncrease: 0,
      maxDuplicateSideEffectIncrease: 0,
    },
  });
}

export async function writeCampaignFile(
  campaignInput: Campaign,
  pathInput: string,
  rootDirectory = process.cwd(),
): Promise<{ path: string; campaignHash: string }> {
  const campaign = CampaignSchema.parse(campaignInput);
  const root = await realpath(resolve(rootDirectory));
  const path = safeOutputPath(root, pathInput);
  await mkdir(dirname(path), { recursive: true });
  const actualParent = await realpath(dirname(path));
  if (!isContained(root, actualParent)) {
    throw new CampaignError(
      `Campaign output resolves outside the repository root: ${pathInput}`,
      CAMPAIGN_EXIT_CODES.AUTHORIZATION,
    );
  }
  const content = path.toLowerCase().endsWith(".json")
    ? `${stableStringify(campaign)}\n`
    : stringify(JSON.parse(stableStringify(campaign)) as unknown, { lineWidth: 100 });
  await writeFile(path, content, { encoding: "utf8", flag: "wx" });
  return { path, campaignHash: campaignHash(campaign) };
}

function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new CampaignError("Campaign cancelled", CAMPAIGN_EXIT_CODES.INCOMPLETE);
  }
}

function scenarioSeed(campaign: Campaign, scenario: CampaignScenario, index: number): number {
  return scenario.seed ?? campaign.seed + index;
}

function evaluateAssertions(
  scenario: CampaignScenario,
  metrics: RecoveryMetrics,
  observedPassed: boolean,
  faultApplied: boolean,
): string[] {
  const failures: string[] = [];
  const expectedPassed = scenario.assertions.outcome === "passed";
  if (observedPassed !== expectedPassed) {
    failures.push(
      `Expected observed outcome ${scenario.assertions.outcome}, received ${observedPassed ? "passed" : "failed"}.`,
    );
  }
  if (scenario.fault !== "none" && !faultApplied) {
    failures.push(`Declared fault ${scenario.fault} was not applied.`);
  }
  if (
    scenario.assertions.safeRecovery !== undefined &&
    metrics.recoverySuccess !== scenario.assertions.safeRecovery
  ) {
    failures.push(`Expected safeRecovery=${String(scenario.assertions.safeRecovery)}.`);
  }
  if (scenario.assertions.maxRecoveryLatencyMs !== undefined) {
    if (metrics.timeToRecoveryMs === null) {
      failures.push("Recovery latency evidence is unavailable.");
    } else if (metrics.timeToRecoveryMs > scenario.assertions.maxRecoveryLatencyMs) {
      failures.push(
        `Recovery latency ${metrics.timeToRecoveryMs}ms exceeds ${scenario.assertions.maxRecoveryLatencyMs}ms.`,
      );
    }
  }
  if (
    scenario.assertions.maxRetries !== undefined &&
    metrics.retryCount > scenario.assertions.maxRetries
  ) {
    failures.push(`Retry count ${metrics.retryCount} exceeds ${scenario.assertions.maxRetries}.`);
  }
  if (scenario.assertions.noDuplicateSideEffects && metrics.duplicateSideEffectAttempts !== 0) {
    failures.push(
      `${metrics.duplicateSideEffectAttempts} duplicate side-effect attempt(s) observed.`,
    );
  }
  if (scenario.assertions.safetyPolicyCompliance && !metrics.safetyPolicyCompliance) {
    failures.push("Safety policy compliance failed.");
  }
  if (
    scenario.assertions.minScore !== undefined &&
    metrics.deterministicScore < scenario.assertions.minScore
  ) {
    failures.push(
      `Recovery score ${metrics.deterministicScore} is below ${scenario.assertions.minScore}.`,
    );
  }
  return failures;
}

async function executeGeneratedRegression(testPath: string, timeoutMs: number): Promise<boolean> {
  const child = spawn(process.execPath, ["--test", testPath], {
    cwd: dirname(testPath),
    stdio: "ignore",
    windowsHide: true,
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      new Promise<boolean>((resolveResult, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => resolveResult(code === 0));
      }),
      new Promise<boolean>((resolveResult) => {
        timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolveResult(false);
        }, timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function writeScenarioArtifacts(
  root: string,
  output: string,
  index: number,
  scenario: CampaignScenario,
  events: readonly TraceEvent[],
  timeoutMs: number,
): Promise<{
  artifactDirectory: string;
  tracePath: string;
  regression: CampaignScenarioResult["regression"];
}> {
  const directory = await containedOutputDirectory(
    root,
    relative(
      root,
      resolve(output, "scenarios", `${String(index + 1).padStart(3, "0")}-${scenario.id}`),
    ),
  );
  const trace = safeOutputPath(directory, "trace.jsonl");
  await writeTrace(trace, events);
  await writeReportBundle(events, safeOutputPath(directory, "report"));
  let regression: CampaignScenarioResult["regression"] = {
    status: "not-applicable",
    verified: false,
  };
  if (events.at(-1)?.type === "run_failed") {
    try {
      const regressionDirectory = safeOutputPath(directory, "regression");
      const generated = await compileRegression(events, regressionDirectory);
      const verified = await executeGeneratedRegression(generated.testPath, timeoutMs);
      regression = {
        status: verified ? "generated" : "generation-failed",
        verified,
        directory: repositoryPath(root, regressionDirectory),
      };
    } catch {
      regression = { status: "generation-failed", verified: false };
    }
  }
  return {
    artifactDirectory: repositoryPath(root, directory),
    tracePath: repositoryPath(root, trace),
    regression,
  };
}

async function runTraceScenario(
  root: string,
  target: Extract<CampaignTarget, { kind: "trace" }>,
  scenario: CampaignScenario,
  seed: number,
): Promise<{
  events: TraceEvent[];
  observedPassed: boolean;
  faultApplied: boolean;
  sourceHash: string;
}> {
  const tracePath = await containedFile(root, target.trace);
  const raw = await readFile(tracePath, "utf8");
  const source = await readTrace(tracePath);
  if (scenario.fault === "none") {
    return {
      events: source,
      observedPassed: calculateMetrics(source).passed,
      faultApplied: false,
      sourceHash: createHash("sha256").update(raw).digest("hex"),
    };
  }
  const injected = injectFaults(source, {
    schemaVersion: "1.0",
    id: scenario.id,
    description: `Campaign scenario ${scenario.id}`,
    seed,
    rules: [
      {
        fault: scenario.fault,
        ...(scenario.event ? { event: scenario.event } : {}),
        occurrence: scenario.occurrence,
        probability: 1,
        parameters: scenario.parameters,
      },
    ],
  });
  return {
    events: injected.events,
    observedPassed: calculateMetrics(injected.events).passed,
    faultApplied: injected.applied.length > 0,
    sourceHash: createHash("sha256").update(raw).digest("hex"),
  };
}

async function runMcpScenario(
  root: string,
  target: Extract<CampaignTarget, { kind: "mcp" }>,
  scenario: CampaignScenario,
  seed: number,
  timeoutMs: number,
  retryBudget: number,
  signal: AbortSignal,
  allowRemoteTargets: boolean,
): Promise<{
  events: TraceEvent[];
  observedPassed: boolean;
  faultApplied: boolean;
  sourceHash: string;
}> {
  if (target.allowRemote && !allowRemoteTargets) {
    throw new CampaignError(
      `Remote target ${target.id} requires explicit CLI authorization.`,
      CAMPAIGN_EXIT_CODES.AUTHORIZATION,
    );
  }
  const imported = await loadInspectorConfig(resolve(root, target.inspectorConfig), {
    serverName: target.server,
    allowRemote: target.allowRemote && allowRemoteTargets,
    allowedRoot: root,
    environment: process.env,
  });
  const options: McpAuditOptions = {
    ...(imported.transport === "stdio"
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
        }),
    serverName: imported.serverName,
    sourceConfigSha256: imported.configSha256,
    connectionTimeoutMs: Math.min(imported.connectionTimeoutMs, timeoutMs),
    requestTimeoutMs: Math.min(imported.requestTimeoutMs, timeoutMs),
    callTools: target.allowTools.length > 0,
    allowedTools: target.allowTools,
    toolArguments: await expandToolArguments(target.toolArguments ?? {}, root),
    allowRemote: target.allowRemote && allowRemoteTargets,
    ...(scenario.fault !== "none" && MCP_FAULT_TYPES.includes(scenario.fault as never)
      ? { fault: scenario.fault as (typeof MCP_FAULT_TYPES)[number] }
      : {}),
    seed,
    recoveryMode: scenario.recovery,
    retryBudget,
    signal,
  };
  if (scenario.fault !== "none" && !MCP_FAULT_TYPES.includes(scenario.fault as never)) {
    throw new CampaignError(`Fault ${scenario.fault} is not supported for MCP targets.`);
  }
  const result = await auditMcp(options);
  return {
    events:
      target.evidenceMode === "metadata-only"
        ? metadataOnlyMcpEvidence(result.events)
        : result.events,
    observedPassed: result.passed,
    faultApplied: result.events.some((event) => event.fault !== undefined),
    sourceHash: imported.configSha256,
  };
}

async function expandToolArguments(
  value: Record<string, Record<string, unknown>>,
  root: string,
): Promise<Record<string, Record<string, unknown>>> {
  const expand = async (entry: unknown): Promise<unknown> => {
    if (typeof entry === "string" && entry.startsWith("{{PROJECT_ROOT}}/")) {
      const candidate = safeOutputPath(root, entry.slice("{{PROJECT_ROOT}}/".length));
      let ancestor = candidate;
      while (
        !(await access(ancestor).then(
          () => true,
          () => false,
        ))
      ) {
        const parent = dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
      }
      if (!isContained(root, await realpath(ancestor))) {
        throw new CampaignError(
          "Tool argument path resolves outside the repository root",
          CAMPAIGN_EXIT_CODES.AUTHORIZATION,
        );
      }
      return candidate;
    }
    if (Array.isArray(entry)) return Promise.all(entry.map(expand));
    if (entry && typeof entry === "object") {
      return Object.fromEntries(
        await Promise.all(
          Object.entries(entry as Record<string, unknown>).map(async ([key, item]) => [
            key,
            await expand(item),
          ]),
        ),
      );
    }
    return entry;
  };
  return (await expand(value)) as Record<string, Record<string, unknown>>;
}

async function runOneScenario(
  root: string,
  output: string,
  campaign: Campaign,
  target: CampaignTarget,
  scenario: CampaignScenario,
  index: number,
  signal: AbortSignal,
  allowRemoteTargets: boolean,
): Promise<CampaignScenarioResult> {
  const started = performance.now();
  const seed = scenarioSeed(campaign, scenario, index);
  try {
    checkSignal(signal);
    const observed =
      target.kind === "trace"
        ? await runTraceScenario(root, target, scenario, seed)
        : await runMcpScenario(
            root,
            target,
            scenario,
            seed,
            campaign.budgets.scenarioTimeoutMs,
            campaign.budgets.retries,
            signal,
            allowRemoteTargets,
          );
    checkSignal(signal);
    const metrics = calculateMetrics(observed.events, { retryBudget: campaign.budgets.retries });
    const assertionFailures = evaluateAssertions(
      scenario,
      metrics,
      observed.observedPassed,
      observed.faultApplied,
    );
    const artifacts = await writeScenarioArtifacts(
      root,
      output,
      index,
      scenario,
      observed.events,
      campaign.budgets.scenarioTimeoutMs,
    );
    return CampaignScenarioResultSchema.parse({
      id: scenario.id,
      target: scenario.target,
      status: assertionFailures.length === 0 ? "passed" : "failed",
      observedOutcome: observed.observedPassed ? "passed" : "failed",
      seed,
      fault: scenario.fault,
      faultApplied: observed.faultApplied,
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      metrics,
      assertionFailures,
      targetSourceSha256: observed.sourceHash,
      ...(scenario.adapterEvidence ? { adapterEvidence: scenario.adapterEvidence } : {}),
      ...artifacts,
      firstCriticalStep: metrics.firstCriticalStep,
    });
  } catch (error) {
    const cancelled = signal.aborted;
    const message = String(sanitize(error instanceof Error ? error.message : String(error))).slice(
      0,
      1_000,
    );
    return CampaignScenarioResultSchema.parse({
      id: scenario.id,
      target: scenario.target,
      status: cancelled ? "cancelled" : "invalid",
      observedOutcome: "unavailable",
      seed,
      fault: scenario.fault,
      faultApplied: false,
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      metrics: null,
      assertionFailures: [],
      firstCriticalStep: null,
      regression: { status: "not-applicable", verified: false },
      error: message,
    });
  }
}

async function mapConcurrent<T>(
  count: number,
  concurrency: number,
  worker: (index: number) => Promise<T>,
): Promise<T[]> {
  const results = new Array<T>(count);
  let next = 0;
  async function consume(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      if (index >= count) return;
      results[index] = await worker(index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, () => consume()));
  return results;
}

function unsignedRun(run: Omit<CampaignRun, "runHash">): string {
  return stableStringify(run);
}

export function verifyCampaignRun(runInput: unknown): CampaignRun {
  const run = CampaignRunSchema.parse(runInput);
  const { runHash: stored, ...withoutHash } = run;
  const actual = sha256(unsignedRun(withoutHash as Omit<CampaignRun, "runHash">));
  if (actual !== stored) {
    throw new CampaignError("Campaign run integrity hash mismatch", CAMPAIGN_EXIT_CODES.INTEGRITY);
  }
  return run;
}

export async function writeCampaignRun(
  runInput: CampaignRun,
  outputDirectory: string,
): Promise<string> {
  const run = verifyCampaignRun(runInput);
  const path = safeOutputPath(outputDirectory, "campaign-run.json");
  await writeFile(path, `${stableStringify(run)}\n`, "utf8");
  return path;
}

export async function loadCampaignRun(pathInput: string): Promise<CampaignRun> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(pathInput, "utf8")) as unknown;
  } catch (error) {
    throw new CampaignError(
      `Unable to read campaign run: ${error instanceof Error ? error.message : String(error)}`,
      CAMPAIGN_EXIT_CODES.INVALID_SCHEMA,
      { cause: error },
    );
  }
  return verifyCampaignRun(value);
}

export async function runCampaign(
  campaignInput: Campaign,
  options: RunCampaignOptions = {},
): Promise<{ run: CampaignRun; path: string; outputDirectory: string }> {
  const campaign = CampaignSchema.parse(campaignInput);
  const root = await realpath(resolve(options.rootDirectory ?? process.cwd()));
  const hash = campaignHash(campaign);
  const requiresToolConfirmation = campaign.targets.some(
    (target) => target.kind === "mcp" && target.allowTools.length > 0,
  );
  if (requiresToolConfirmation && options.confirmedToolCampaignHash !== hash) {
    throw new CampaignError(
      `Tool-calling campaign requires confirmation of reviewed hash ${hash}.`,
      CAMPAIGN_EXIT_CODES.AUTHORIZATION,
    );
  }

  const defaultOutput = `runs/campaign-${campaign.id}-${hash.slice(0, 8)}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const output = await containedOutputDirectory(root, options.outputDirectory ?? defaultOutput);
  const controller = new AbortController();
  const relay = (): void => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) controller.abort(options.signal.reason);
  else options.signal?.addEventListener("abort", relay, { once: true });
  const totalTimer = setTimeout(
    () => controller.abort(new Error("Campaign total time budget exceeded")),
    campaign.budgets.totalTimeoutMs,
  );
  totalTimer.unref();
  const startedAt = new Date();
  const runId = `campaign-${hash.slice(0, 12)}-${randomUUID()}`;
  let completed = 0;
  options.onProgress?.({ phase: "starting", completed: 0, total: campaign.scenarios.length });
  try {
    const targets = new Map(campaign.targets.map((target) => [target.id, target]));
    const results = await mapConcurrent(
      campaign.scenarios.length,
      campaign.budgets.concurrency,
      async (index) => {
        const scenario = campaign.scenarios[index]!;
        options.onProgress?.({
          phase: "scenario-started",
          completed,
          total: campaign.scenarios.length,
          scenarioId: scenario.id,
        });
        const target = targets.get(scenario.target)!;
        const result = await runOneScenario(
          root,
          output,
          campaign,
          target,
          scenario,
          index,
          controller.signal,
          options.allowRemoteTargets ?? false,
        );
        completed += 1;
        options.onProgress?.({
          phase: "scenario-completed",
          completed,
          total: campaign.scenarios.length,
          scenarioId: scenario.id,
          scenarioStatus: result.status,
        });
        return result;
      },
    );
    const cancelledCount = results.filter((result) => result.status === "cancelled").length;
    const invalidCount = results.filter((result) => result.status === "invalid").length;
    const failedCount = results.filter((result) => result.status === "failed").length;
    const passedCount = results.filter((result) => result.status === "passed").length;
    const faultScenarios = results.filter((result) => result.fault !== "none");
    const status: CampaignRun["status"] =
      cancelledCount > 0
        ? "cancelled"
        : invalidCount > 0
          ? "invalid"
          : results.length < campaign.scenarios.length
            ? "incomplete"
            : "complete";
    const completedAt = new Date();
    const withoutHash: Omit<CampaignRun, "runHash"> = {
      schemaVersion: "1.0",
      kind: "resilireplay-campaign-run",
      productVersion: PRODUCT_VERSION,
      campaignId: campaign.id,
      campaignHash: hash,
      runId,
      status,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
      results,
      thresholds: campaign.thresholds,
      summary: {
        passed: status === "complete" && failedCount === 0,
        total: results.length,
        passedCount,
        failedCount,
        invalidCount,
        cancelledCount,
        faultCoverage:
          faultScenarios.length === 0
            ? null
            : faultScenarios.filter((result) => result.faultApplied).length / faultScenarios.length,
      },
      telemetry: false,
    };
    const run = CampaignRunSchema.parse({
      ...withoutHash,
      runHash: sha256(unsignedRun(withoutHash)),
    });
    const path = await writeCampaignRun(run, output);
    options.onProgress?.({
      phase: "completed",
      completed: results.length,
      total: campaign.scenarios.length,
    });
    return { run, path, outputDirectory: output };
  } finally {
    clearTimeout(totalTimer);
    options.signal?.removeEventListener("abort", relay);
  }
}
