import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  PRODUCT_VERSION,
  calculateMetrics,
  createEvent,
  injectFaults,
  safeOutputPath,
  sha256,
  stableStringify,
  type EventType,
  type TraceEvent,
} from "@resilireplay/core";
import { compileRegression, writeTrace } from "@resilireplay/trace";

export const DEMO_EXIT_CODES = {
  PASS: 0,
  USAGE: 2,
  EXECUTION: 30,
  ARTIFACT: 31,
} as const;

export interface DemoOptions {
  seed?: number;
  outputDirectory?: string;
  rootDirectory?: string;
}

export interface DemoResult {
  schemaVersion: "1.0";
  productVersion: typeof PRODUCT_VERSION;
  status: "passed";
  seed: number;
  durationMs: number;
  controls: {
    clean: true;
    injectedToolResultFailure: true;
    boundedRecovery: true;
    expectedNegativeControl: true;
    regressionGenerated: true;
    regressionExecuted: true;
  };
  hashes: {
    cleanTraceSha256: string;
    recoveredTraceSha256: string;
    negativeTraceSha256: string;
    regressionFixtureSha256: string;
    regressionTestSha256: string;
    canonicalEvidenceSha256: string;
  };
  outputDirectory: string | null;
  nextCommand: string;
}

const FIXED_TIME = Date.UTC(2026, 0, 1, 0, 0, 0);

function demoEvent(
  runId: string,
  sequence: number,
  type: EventType,
  payload: unknown,
  extra: Partial<TraceEvent> = {},
): TraceEvent {
  return createEvent({
    runId,
    stepId: `${runId}-step-${sequence}`,
    sequence,
    timestamp: new Date(FIXED_TIME + sequence * 1_000).toISOString(),
    type,
    actor: "resilireplay-demo-fixture",
    payload,
    ...extra,
  });
}

function cleanTrace(): TraceEvent[] {
  const runId = "demo-clean";
  return [
    demoEvent(runId, 0, "run_started", { mode: "packaged-local-fixture", telemetry: false }),
    demoEvent(runId, 1, "tool_requested", { message: "recovery-check" }, { tool: "local_echo" }),
    demoEvent(runId, 2, "tool_result", { content: "recovery-check" }, { tool: "local_echo" }),
    demoEvent(runId, 3, "validation_result", { valid: true }),
    demoEvent(runId, 4, "run_completed", { passed: true }),
  ];
}

function recoveredTrace(seed: number): TraceEvent[] {
  const runId = "demo-recovered";
  const source = demoEvent(
    runId,
    2,
    "tool_result",
    { content: "recovery-check" },
    { tool: "local_echo" },
  );
  const injectedFault = injectFaults(
    [source],
    {
      schemaVersion: "1.0",
      id: "demo-tool-result-failure",
      description: "Packaged deterministic tool-result failure.",
      seed,
      rules: [
        {
          fault: "mcp-tool-error",
          event: "tool_result",
          occurrence: 1,
          probability: 1,
          parameters: {},
        },
      ],
    },
    seed,
  ).events[0]!;
  const injected = demoEvent(runId, 2, "tool_result", injectedFault.payload, {
    tool: "local_echo",
    ...(injectedFault.fault ? { fault: injectedFault.fault } : {}),
  });
  const retry = demoEvent(
    runId,
    3,
    "retry",
    { attempt: 1, budget: 1, reason: "mcp-tool-error" },
    { tool: "local_echo", causeId: injected.stepId },
  );
  return [
    demoEvent(runId, 0, "run_started", { mode: "packaged-local-fixture", telemetry: false }),
    demoEvent(runId, 1, "tool_requested", { message: "recovery-check" }, { tool: "local_echo" }),
    injected,
    retry,
    demoEvent(
      runId,
      4,
      "tool_result",
      { content: "recovery-check" },
      { tool: "local_echo", causeId: retry.stepId },
    ),
    demoEvent(
      runId,
      5,
      "recovery_action",
      { action: "bounded retry", correct: true, budget: 1 },
      { tool: "local_echo", causeId: retry.stepId },
    ),
    demoEvent(runId, 6, "validation_result", { valid: true, recoverySucceeded: true }),
    demoEvent(runId, 7, "run_completed", { passed: true }),
  ];
}

function negativeTrace(seed: number): TraceEvent[] {
  const runId = "demo-negative";
  const source = demoEvent(
    runId,
    2,
    "tool_result",
    { content: "bounded-local-value" },
    { tool: "local_echo" },
  );
  const injectedFault = injectFaults(
    [source],
    {
      schemaVersion: "1.0",
      id: "demo-negative-control",
      description: "Packaged deterministic expected failure.",
      seed,
      rules: [
        {
          fault: "mcp-malicious-canary-instruction",
          event: "tool_result",
          occurrence: 1,
          probability: 1,
          parameters: {},
        },
      ],
    },
    seed,
  ).events[0]!;
  const injected = demoEvent(runId, 2, "tool_result", injectedFault.payload, {
    tool: "local_echo",
    ...(injectedFault.fault ? { fault: injectedFault.fault } : {}),
  });
  return [
    demoEvent(runId, 0, "run_started", { mode: "packaged-local-fixture", telemetry: false }),
    demoEvent(runId, 1, "tool_requested", { message: "negative-check" }, { tool: "local_echo" }),
    injected,
    demoEvent(
      runId,
      3,
      "safety_violation",
      { kind: "synthetic-canary-instruction", contained: true },
      { causeId: injected.stepId },
    ),
    demoEvent(runId, 4, "validation_result", { valid: false, expectedNegativeControl: true }),
    demoEvent(runId, 5, "run_failed", { expected: true, reason: "negative-control" }),
  ];
}

async function executeRegression(testPath: string): Promise<void> {
  const child = spawn(process.execPath, ["--test", testPath], {
    cwd: dirname(testPath),
    stdio: "pipe",
    windowsHide: true,
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    const code = await Promise.race([
      new Promise<number>((resolveCode, reject) => {
        child.once("error", reject);
        child.once("exit", (exitCode) => resolveCode(exitCode ?? 1));
      }),
      new Promise<number>((resolveCode) => {
        timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolveCode(124);
        }, 10_000);
        timer.unref();
      }),
    ]);
    if (code !== 0) {
      throw Object.assign(new Error(`Generated regression exited with ${code}`), {
        exitCode: DEMO_EXIT_CODES.EXECUTION,
      });
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isContained(root: string, candidate: string): boolean {
  const relationship = relative(resolve(root), resolve(candidate));
  return (
    relationship === "" ||
    (relationship !== ".." && !relationship.startsWith(`..${sep}`) && !isAbsolute(relationship))
  );
}

async function persistentOutputPath(root: string, candidate: string): Promise<string> {
  const outputPath = safeOutputPath(root, candidate);
  let ancestor = outputPath;
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
    throw Object.assign(new Error("Demo output resolves outside the current project"), {
      exitCode: DEMO_EXIT_CODES.ARTIFACT,
    });
  }
  return outputPath;
}

export async function runDemo(options: DemoOptions = {}): Promise<DemoResult> {
  const started = performance.now();
  const root = await realpath(options.rootDirectory ?? process.cwd());
  const seed = options.seed ?? 42;
  if (!Number.isSafeInteger(seed)) {
    throw Object.assign(new Error("--seed must be an integer"), {
      exitCode: DEMO_EXIT_CODES.USAGE,
    });
  }
  const persistentOutput = options.outputDirectory
    ? await persistentOutputPath(root, options.outputDirectory)
    : undefined;
  const workspace = persistentOutput ?? (await mkdtemp(join(tmpdir(), "resilireplay-demo-")));
  try {
    await mkdir(workspace, { recursive: true });
    const clean = cleanTrace();
    const recovered = recoveredTrace(seed);
    const negative = negativeTrace(seed);
    if (
      !calculateMetrics(clean).passed ||
      !calculateMetrics(recovered, { retryBudget: 1 }).passed
    ) {
      throw Object.assign(new Error("Packaged control or recovery fixture did not pass"), {
        exitCode: DEMO_EXIT_CODES.EXECUTION,
      });
    }
    if (calculateMetrics(negative).passed) {
      throw Object.assign(new Error("Packaged negative control did not fail as expected"), {
        exitCode: DEMO_EXIT_CODES.EXECUTION,
      });
    }

    const evidenceDirectory = join(workspace, "evidence");
    await mkdir(evidenceDirectory, { recursive: true });
    await Promise.all([
      writeTrace(join(evidenceDirectory, "clean-control.jsonl"), clean),
      writeTrace(join(evidenceDirectory, "recovered-failure.jsonl"), recovered),
      writeTrace(join(evidenceDirectory, "expected-negative-control.jsonl"), negative),
    ]);
    const regression = await compileRegression(negative, join(workspace, "regression"));
    await executeRegression(regression.testPath);

    const canonical = {
      schemaVersion: "1.0",
      productVersion: PRODUCT_VERSION,
      seed,
      cleanTraceSha256: sha256(stableStringify(clean)),
      recoveredTraceSha256: sha256(stableStringify(recovered)),
      negativeTraceSha256: regression.sourceTraceHash,
      regressionFixtureSha256: regression.fixtureHash,
      regressionTestSha256: regression.testHash,
      controls: {
        clean: true,
        injectedToolResultFailure: true,
        boundedRecovery: true,
        expectedNegativeControl: true,
        regressionGenerated: true,
        regressionExecuted: true,
      },
    } as const;
    const result: DemoResult = {
      schemaVersion: "1.0",
      productVersion: PRODUCT_VERSION,
      status: "passed",
      seed,
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      controls: canonical.controls,
      hashes: {
        cleanTraceSha256: canonical.cleanTraceSha256,
        recoveredTraceSha256: canonical.recoveredTraceSha256,
        negativeTraceSha256: canonical.negativeTraceSha256,
        regressionFixtureSha256: canonical.regressionFixtureSha256,
        regressionTestSha256: canonical.regressionTestSha256,
        canonicalEvidenceSha256: sha256(stableStringify(canonical)),
      },
      outputDirectory: persistentOutput ?? null,
      nextCommand: "npx --yes resilireplay@0.6.0 adopt --config ./mcp.json --dry-run",
    };
    if (persistentOutput) {
      await writeFile(join(workspace, "demo-summary.json"), `${stableStringify(result)}\n`, "utf8");
    }
    return result;
  } catch (error) {
    if (typeof error === "object" && error !== null && "exitCode" in error) throw error;
    throw Object.assign(
      new Error(
        `Demo artifact generation failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
      { exitCode: DEMO_EXIT_CODES.ARTIFACT },
    );
  } finally {
    if (!persistentOutput) await rm(workspace, { recursive: true, force: true });
  }
}

export function demoTerminalReport(result: DemoResult, color = true): string {
  const green = color ? "\u001B[32m" : "";
  const cyan = color ? "\u001B[36m" : "";
  const reset = color ? "\u001B[0m" : "";
  return [
    `${green}PASS${reset} ResiliReplay demo completed in ${result.durationMs}ms`,
    "Clean control passed · injected tool-result failure recovered once · negative control failed as expected",
    "Generated regression executed successfully",
    `${cyan}Evidence${reset} ${result.hashes.canonicalEvidenceSha256}`,
    ...(result.outputDirectory ? [`Artifacts ${result.outputDirectory}`] : []),
    `Next: ${result.nextCommand}`,
  ].join("\n");
}
