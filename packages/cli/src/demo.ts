import { spawn } from "node:child_process";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OutputContainmentError,
  PRODUCT_VERSION,
  calculateMetrics,
  createEvent,
  prepareContainedOutputDirectory,
  resolveContainedOutputPath,
  sha256,
  stableStringify,
  type TraceEvent,
} from "@resilireplay/core";
import { auditMcp, metadataOnlyMcpEvidence } from "@resilireplay/mcp-chaos";
import { compileRegression, writeTrace } from "@resilireplay/trace";
import { z } from "zod";

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

export const DemoResultSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    productVersion: z.literal(PRODUCT_VERSION),
    result: z.literal("PASS"),
    cleanControl: z.literal("PASS"),
    faultObserved: z.literal(true),
    recoveryAttempts: z.literal(1),
    duplicateEffects: z.literal(0),
    regressionGenerated: z.literal(true),
    regressionExecuted: z.literal(true),
    cleanupComplete: z.literal(true),
    evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    seed: z.number().int(),
    durationMs: z.number().int().nonnegative(),
    outputDirectory: z.string().nullable(),
    nextCommand: z.string().min(1),
  })
  .strict();

export type DemoResult = z.infer<typeof DemoResultSchema>;

const DemoEvidenceSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    productVersion: z.literal(PRODUCT_VERSION),
    seed: z.number().int(),
    cleanControl: z.literal("PASS"),
    faultObserved: z.literal(true),
    recoveryAttempts: z.literal(1),
    duplicateEffects: z.literal(0),
    regressionGenerated: z.literal(true),
    regressionExecuted: z.literal(true),
    cleanupComplete: z.literal(true),
    cleanTraceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    recoveredTraceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    controlledFailureTraceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    regressionFixtureSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    regressionTestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export async function verifyDemoEvidence(path: string): Promise<{
  valid: true;
  evidenceSha256: string;
  duplicateEffects: 0;
  recoveryAttempts: 1;
}> {
  const evidence = DemoEvidenceSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const { evidenceSha256, ...canonical } = evidence;
  if (sha256(stableStringify(canonical)) !== evidenceSha256) {
    throw new Error("ResiliReplay demo evidence digest mismatch");
  }
  return {
    valid: true,
    evidenceSha256,
    duplicateEffects: evidence.duplicateEffects,
    recoveryAttempts: evidence.recoveryAttempts,
  };
}

interface BundleEntry {
  path: string;
  bytes: number;
  sha256: string;
}

const FIXED_TIME = Date.UTC(2026, 0, 1, 0, 0, 0);
const DEMO_TOOL = "local_echo";

function executionError(message: string): Error {
  return Object.assign(new Error(message), { exitCode: DEMO_EXIT_CODES.EXECUTION });
}

function deterministicEvents(events: readonly TraceEvent[], runId: string): TraceEvent[] {
  const stepIds = new Map(events.map((event, index) => [event.stepId, `${runId}-step-${index}`]));
  return events.map((event, index) =>
    createEvent({
      runId,
      stepId: stepIds.get(event.stepId)!,
      sequence: index,
      timestamp: new Date(FIXED_TIME + index * 1_000).toISOString(),
      type: event.type,
      actor: event.actor,
      payload: event.payload,
      metadata: event.metadata,
      ...(event.tool ? { tool: event.tool } : {}),
      ...(event.model ? { model: event.model } : {}),
      ...(event.parentId && stepIds.has(event.parentId)
        ? { parentId: stepIds.get(event.parentId)! }
        : {}),
      ...(event.causeId && stepIds.has(event.causeId)
        ? { causeId: stepIds.get(event.causeId)! }
        : {}),
      ...(event.fault ? { fault: event.fault } : {}),
    }),
  );
}

export async function executeRegression(testPath: string): Promise<void> {
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
    if (code !== 0) throw executionError(`Generated regression exited with ${code}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function bundleEntries(directory: string, current = directory): Promise<BundleEntry[]> {
  const entries: BundleEntry[] = [];
  for (const item of (await readdir(current, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  )) {
    const path = join(current, item.name);
    const bundlePath = relative(directory, path).replaceAll("\\", "/");
    if (bundlePath === "manifest.json") continue;
    if (item.isDirectory()) entries.push(...(await bundleEntries(directory, path)));
    else if (item.isFile()) {
      const body = await readFile(path);
      entries.push({ path: bundlePath, bytes: body.byteLength, sha256: sha256(body) });
    } else {
      throw new Error(`Demo bundle contains a non-regular entry: ${bundlePath}`);
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

async function matchingExistingBundle(target: string, manifest: string): Promise<boolean> {
  try {
    const information = await lstat(target);
    if (information.isSymbolicLink() || !information.isDirectory()) return false;
    const existingManifest = await readFile(join(target, "manifest.json"), "utf8");
    if (existingManifest !== manifest) return false;
    const parsed = JSON.parse(existingManifest) as { files?: BundleEntry[] };
    return stableStringify(await bundleEntries(target)) === stableStringify(parsed.files);
  } catch {
    return false;
  }
}

async function persistentTarget(root: string, candidate: string): Promise<string> {
  try {
    const target = await resolveContainedOutputPath(root, candidate);
    if (resolve(target) === resolve(root)) {
      throw new OutputContainmentError("Demo output cannot replace the project root");
    }
    await prepareContainedOutputDirectory(root, dirname(target));
    return target;
  } catch (error) {
    if (!(error instanceof OutputContainmentError)) throw error;
    throw Object.assign(new Error("Demo output resolves outside the current project"), {
      exitCode: DEMO_EXIT_CODES.ARTIFACT,
      cause: error,
    });
  }
}

async function targetExists(target: string): Promise<boolean> {
  return lstat(target).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
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

  const target = options.outputDirectory
    ? await persistentTarget(root, options.outputDirectory)
    : undefined;
  const workspace = target
    ? await mkdtemp(join(dirname(target), `.resilireplay-demo-${basename(target)}-`))
    : await mkdtemp(join(tmpdir(), "resilireplay-demo-"));
  let published = false;
  try {
    const fixture = fileURLToPath(new URL("../fixtures/demo-mcp-server.mjs", import.meta.url));
    try {
      await stat(fixture);
    } catch (error) {
      throw Object.assign(new Error("The packaged local MCP demo fixture is missing"), {
        exitCode: DEMO_EXIT_CODES.ARTIFACT,
        cause: error,
      });
    }
    const common = {
      stdio: { command: process.execPath, args: [fixture], cwd: root },
      callTools: true,
      allowedTools: [DEMO_TOOL],
      toolArguments: { [DEMO_TOOL]: { message: "recovery-check" } },
      allowRemote: false,
      seed,
      timeoutMs: 5_000,
      serverName: "resilireplay-local-demo",
    };
    let cleanAudit: Awaited<ReturnType<typeof auditMcp>>;
    let recoveredAudit: Awaited<ReturnType<typeof auditMcp>>;
    try {
      cleanAudit = await auditMcp({ ...common, recoveryMode: "none", retryBudget: 1 });
      recoveredAudit = await auditMcp({
        ...common,
        fault: "mcp-tool-error",
        recoveryMode: "retry",
        retryBudget: 1,
      });
    } catch (error) {
      throw Object.assign(
        executionError("The packaged local MCP server did not complete its protocol exchange"),
        { cause: error },
      );
    }
    const clean = deterministicEvents(metadataOnlyMcpEvidence(cleanAudit.events), "demo-clean");
    const recovered = deterministicEvents(
      metadataOnlyMcpEvidence(recoveredAudit.events),
      "demo-recovered",
    );
    const cleanCalls = clean.filter(
      (event) => event.type === "tool_requested" && event.tool === DEMO_TOOL,
    ).length;
    const faultObserved = recovered.some((event) => event.fault !== undefined);
    const recoveryAttempts = recovered.filter((event) => event.type === "retry").length;
    const duplicateEffects = calculateMetrics(recovered, {
      retryBudget: 1,
    }).duplicateSideEffectAttempts;
    const cleanupComplete = [cleanAudit, recoveredAudit].every(
      (audit) =>
        audit.cleanup.clientClosed &&
        audit.cleanup.childProcessExited &&
        audit.cleanup.listenerCountsRestored,
    );
    if (!cleanAudit.passed || cleanCalls !== 1) {
      throw executionError("The clean local MCP tool call did not pass exactly once");
    }
    if (
      !recoveredAudit.passed ||
      !faultObserved ||
      !recoveredAudit.recovery.succeeded ||
      recoveryAttempts !== 1 ||
      duplicateEffects !== 0
    ) {
      throw executionError("The deterministic MCP fault did not recover within one retry");
    }
    if (!cleanupComplete) throw executionError("The local MCP demo did not clean up completely");

    const faultIndex = recovered.findIndex((event) => event.fault !== undefined);
    const controlledFailure = recovered.slice(0, faultIndex + 1);
    const faultEvent = controlledFailure.at(-1)!;
    controlledFailure.push(
      createEvent({
        runId: faultEvent.runId,
        stepId: `${faultEvent.runId}-step-${faultEvent.sequence + 1}`,
        sequence: faultEvent.sequence + 1,
        timestamp: new Date(FIXED_TIME + (faultEvent.sequence + 1) * 1_000).toISOString(),
        type: "run_failed",
        actor: "resilireplay-mcp-demo",
        causeId: faultEvent.stepId,
        payload: { expected: true, reason: "controlled MCP fault" },
      }),
    );

    const evidenceDirectory = await prepareContainedOutputDirectory(
      workspace,
      join(workspace, "evidence"),
    );
    await Promise.all([
      writeTrace(join(evidenceDirectory, "clean-control.jsonl"), clean, { allowedRoot: workspace }),
      writeTrace(join(evidenceDirectory, "recovered-failure.jsonl"), recovered, {
        allowedRoot: workspace,
      }),
      writeTrace(join(evidenceDirectory, "controlled-failure.jsonl"), controlledFailure, {
        allowedRoot: workspace,
      }),
    ]);
    const regression = await compileRegression(controlledFailure, join(workspace, "regression"), {
      allowedRoot: workspace,
    });
    await executeRegression(regression.testPath);

    const canonical = {
      schemaVersion: "1.0",
      productVersion: PRODUCT_VERSION,
      seed,
      cleanControl: "PASS",
      faultObserved: true,
      recoveryAttempts: 1,
      duplicateEffects: 0,
      regressionGenerated: true,
      regressionExecuted: true,
      cleanupComplete: true,
      cleanTraceSha256: sha256(stableStringify(clean)),
      recoveredTraceSha256: sha256(stableStringify(recovered)),
      controlledFailureTraceSha256: regression.sourceTraceHash,
      regressionFixtureSha256: regression.fixtureHash,
      regressionTestSha256: regression.testHash,
    } as const;
    const evidenceSha256 = sha256(stableStringify(canonical));
    await writeFile(
      join(workspace, "evidence.json"),
      `${stableStringify({ ...canonical, evidenceSha256 })}\n`,
      "utf8",
    );
    const files = await bundleEntries(workspace);
    const manifest = `${stableStringify({
      schemaVersion: "1.0",
      status: "complete",
      product: "ResiliReplay",
      productVersion: PRODUCT_VERSION,
      evidenceSha256,
      files,
    })}\n`;
    await writeFile(join(workspace, "manifest.json"), manifest, "utf8");

    if (target) {
      if (await targetExists(target)) {
        if (!(await matchingExistingBundle(target, manifest))) {
          throw Object.assign(
            new Error(
              `Demo output contains mismatched evidence; refusing to overwrite: ${relative(root, target).replaceAll("\\", "/")}`,
            ),
            { exitCode: DEMO_EXIT_CODES.ARTIFACT },
          );
        }
      } else {
        await rename(workspace, target);
        published = true;
      }
    }

    return DemoResultSchema.parse({
      schemaVersion: "1.0",
      productVersion: PRODUCT_VERSION,
      result: "PASS",
      cleanControl: "PASS",
      faultObserved: true,
      recoveryAttempts: 1,
      duplicateEffects: 0,
      regressionGenerated: true,
      regressionExecuted: true,
      cleanupComplete: true,
      evidenceSha256,
      seed,
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      outputDirectory: target ? relative(root, target).replaceAll("\\", "/") || "." : null,
      nextCommand:
        "npx --yes resilireplay@latest mcp test --config ./mcp.json --server my-server --tool echo --safety inert --dry-run",
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "exitCode" in error) throw error;
    throw Object.assign(
      new Error("Demo artifact generation failed", {
        cause: error,
      }),
      { exitCode: DEMO_EXIT_CODES.ARTIFACT },
    );
  } finally {
    if (!published) await rm(workspace, { recursive: true, force: true });
  }
}

export function demoTerminalReport(result: DemoResult, color = true): string {
  const green = color ? "\u001B[32m" : "";
  const reset = color ? "\u001B[0m" : "";
  const check = `${green}✓${reset}`;
  return [
    "ResiliReplay MCP demo",
    "",
    `${check} Clean MCP tool call`,
    `${check} Deterministic failure reproduced`,
    `${check} Recovery bounded to one retry`,
    `${check} Duplicate effects observed: ${result.duplicateEffects}`,
    `${check} Regression generated`,
    `${check} Regression executed`,
    "",
    "MCP reliability check passed.",
    `Evidence: sha256:${result.evidenceSha256}`,
    ...(result.outputDirectory ? [`Artifacts: ${result.outputDirectory}`] : []),
  ].join("\n");
}
