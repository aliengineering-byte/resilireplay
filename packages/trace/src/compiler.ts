import { link, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  calculateMetrics,
  prepareContainedOutputDirectory,
  PRODUCT_VERSION,
  safeOutputPath,
  sha256,
  stableStringify,
  type FaultType,
  type TraceEvent,
} from "@resilireplay/core";
import { stringify } from "yaml";
import { serializeTrace } from "./jsonl.js";

export interface RegressionArtifacts {
  outputDirectory: string;
  scenarioPath: string;
  fixturePath: string;
  testPath: string;
  manifestPath: string;
  sourceTraceHash: string;
  fixtureHash: string;
  scenarioHash: string;
  testHash: string;
  firstCriticalStep: string;
  minimizedEventCount: number;
  sourceEventCount: number;
}

export interface CompileRegressionOptions {
  allowedRoot?: string;
}

function causalSlice(events: readonly TraceEvent[], critical: TraceEvent): TraceEvent[] {
  const byId = new Map(events.map((event) => [event.stepId, event]));
  const included = new Set<string>([critical.stepId]);
  const queue = [critical];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const dependencyId of [current.parentId, current.causeId]) {
      if (!dependencyId || included.has(dependencyId)) continue;
      const dependency = byId.get(dependencyId);
      if (dependency) {
        included.add(dependencyId);
        queue.push(dependency);
      }
    }
  }

  const runStart = events.find((event) => event.type === "run_started");
  const terminal = events.findLast(
    (event) => event.type === "run_failed" || event.type === "run_completed",
  );
  if (runStart) included.add(runStart.stepId);
  if (terminal) included.add(terminal.stepId);

  for (const event of events) {
    if (
      event.sequence <= critical.sequence &&
      (event.fault ||
        event.type === "retry" ||
        event.type === "recovery_action" ||
        event.type === "validation_result" ||
        event.type === "safety_violation")
    ) {
      included.add(event.stepId);
    }
  }
  return events.filter((event) => included.has(event.stepId));
}

function generatedTest(
  fixtureName: string,
  fixtureHash: string,
  sourceTraceHash: string,
  criticalStep: string,
): string {
  return `import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const SOURCE_TRACE_SHA256 = ${JSON.stringify(sourceTraceHash)};
const FIXTURE_SHA256 = ${JSON.stringify(fixtureHash)};
const FIRST_CRITICAL_STEP = ${JSON.stringify(criticalStep)};

test("reproduces the captured ResiliReplay failure", async () => {
  const raw = await readFile(new URL(${JSON.stringify(`./${fixtureName}`)}, import.meta.url), "utf8");
  assert.equal(createHash("sha256").update(raw).digest("hex"), FIXTURE_SHA256);
  const events = raw.trim().split(/\\r?\\n/u).map((line) => JSON.parse(line));
  const critical = events.find((event) => event.stepId === FIRST_CRITICAL_STEP);
  assert.ok(critical, "critical causal event is preserved");
  assert.ok(critical.fault || critical.type === "safety_violation" || critical.type === "run_failed");
  assert.equal(events.at(-1)?.type, "run_failed", "the minimized replay reproduces failure");
  assert.match(SOURCE_TRACE_SHA256, /^[a-f0-9]{64}$/u);
});
`;
}

export function identifyFirstCriticalEvent(events: readonly TraceEvent[]): TraceEvent {
  if (events.length === 0) throw new Error("Cannot compile an empty trace");
  const metrics = calculateMetrics(events);
  const byMetric = metrics.firstCriticalStep
    ? events.find((event) => event.stepId === metrics.firstCriticalStep)
    : undefined;
  return (
    byMetric ??
    events.find((event) => event.fault) ??
    events.find((event) => event.type === "safety_violation") ??
    events.find((event) => event.type === "run_failed") ??
    events.at(-1)!
  );
}

export async function compileRegression(
  source: readonly TraceEvent[],
  outputDirectoryInput: string,
  options: CompileRegressionOptions = {},
): Promise<RegressionArtifacts> {
  const sourceSerialized = serializeTrace(source);
  const sourceTraceHash = sha256(sourceSerialized);
  const critical = identifyFirstCriticalEvent(source);
  const sliced = causalSlice(source, critical);
  const terminal = sliced.at(-1);
  if (terminal?.type !== "run_failed") {
    throw new Error("Trace-to-regression requires a failed trace ending in run_failed");
  }

  const outputDirectory = resolve(outputDirectoryInput);
  const allowedRoot = resolve(options.allowedRoot ?? dirname(outputDirectory));
  await prepareContainedOutputDirectory(allowedRoot, outputDirectory);
  const scenarioPath = safeOutputPath(outputDirectory, "scenario.yaml");
  const fixturePath = safeOutputPath(outputDirectory, "replay.fixture.jsonl");
  const testPath = safeOutputPath(outputDirectory, "regression.test.mjs");
  const manifestPath = safeOutputPath(outputDirectory, "manifest.json");

  const fixture = serializeTrace(sliced);
  const fixtureHash = sha256(fixture);
  const fault = (critical.fault?.faultType ?? "false-intermediate-result") as FaultType;
  const scenario = stringify({
    schemaVersion: "1.0",
    id: `regression-${sourceTraceHash.slice(0, 12)}`,
    description: `Generated from ${basename(outputDirectory)}; first critical step ${critical.stepId}`,
    seed: critical.fault?.seed ?? 42,
    sourceTraceSha256: sourceTraceHash,
    expected: {
      outcome: "failed",
      firstCriticalStep: critical.stepId,
    },
    rules: [
      {
        fault,
        event: critical.type,
        occurrence: 1,
        parameters: critical.fault?.details ?? {},
      },
    ],
  });
  const testSource = generatedTest(
    basename(fixturePath),
    fixtureHash,
    sourceTraceHash,
    critical.stepId,
  );
  const testHash = sha256(testSource);
  const scenarioHash = sha256(scenario);
  const manifest = {
    schemaVersion: "1.0",
    status: "complete",
    product: "ResiliReplay",
    productVersion: PRODUCT_VERSION,
    sourceTraceSha256: sourceTraceHash,
    fixtureSha256: fixtureHash,
    testSha256: testHash,
    firstCriticalStep: critical.stepId,
    sourceEventCount: source.length,
    minimizedEventCount: sliced.length,
    causalStepIds: sliced.map((event) => event.stepId),
    scenarioSha256: scenarioHash,
  };

  const stagingDirectory = await mkdtemp(join(outputDirectory, ".resilireplay-regression-"));
  const staged = [
    { name: basename(scenarioPath), finalPath: scenarioPath, content: scenario },
    { name: basename(fixturePath), finalPath: fixturePath, content: fixture },
    { name: basename(testPath), finalPath: testPath, content: testSource },
    {
      name: basename(manifestPath),
      finalPath: manifestPath,
      content: `${stableStringify(manifest)}\n`,
    },
  ];
  const published: string[] = [];
  try {
    await Promise.all(
      staged.map((artifact) =>
        writeFile(join(stagingDirectory, artifact.name), artifact.content, {
          encoding: "utf8",
          flag: "wx",
          flush: true,
        }),
      ),
    );
    for (const artifact of staged) {
      try {
        await link(join(stagingDirectory, artifact.name), artifact.finalPath);
        published.push(artifact.finalPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          const existing = await readFile(artifact.finalPath, "utf8").catch(() => undefined);
          if (existing === artifact.content) continue;
          throw new Error(
            `Regression artifact conflict; refusing to overwrite: ${artifact.finalPath}`,
            {
              cause: error,
            },
          );
        }
        throw error;
      }
    }
  } catch (error) {
    await Promise.all(published.map((path) => rm(path, { force: true })));
    throw error;
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
  return {
    outputDirectory,
    scenarioPath,
    fixturePath,
    testPath,
    manifestPath,
    sourceTraceHash,
    fixtureHash,
    scenarioHash,
    testHash,
    firstCriticalStep: critical.stepId,
    minimizedEventCount: sliced.length,
    sourceEventCount: source.length,
  };
}
