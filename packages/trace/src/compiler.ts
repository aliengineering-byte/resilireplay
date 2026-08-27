import { constants } from "node:fs";
import { copyFile, link, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  /** @internal Dependency injection for deterministic publication-failure tests. */
  publicationOperations?: Partial<RegressionPublicationOperations>;
}

export interface RegressionPublicationOperations {
  link(source: string, destination: string): Promise<void>;
  copyFileExclusive(source: string, destination: string): Promise<void>;
  readText(path: string): Promise<string>;
  remove(path: string): Promise<void>;
  size(path: string): Promise<number>;
}

export class RegressionPublicationError extends Error {
  readonly code:
    | "RR_REGRESSION_CONFLICT"
    | "RR_REGRESSION_INTEGRITY"
    | "RR_REGRESSION_PUBLISH"
    | "RR_REGRESSION_CLEANUP";

  constructor(code: RegressionPublicationError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RegressionPublicationError";
    this.code = code;
  }
}

const DEFAULT_PUBLICATION_OPERATIONS: RegressionPublicationOperations = {
  link,
  copyFileExclusive: async (source, destination) =>
    copyFile(source, destination, constants.COPYFILE_EXCL),
  readText: (path) => readFile(path, "utf8"),
  remove: (path) => rm(path, { force: true }),
  size: async (path) => (await stat(path)).size,
};

const HARD_LINK_UNAVAILABLE = new Set([
  "EACCES",
  "EPERM",
  "EXDEV",
  "ENOSYS",
  "ENOTSUP",
  "EOPNOTSUPP",
]);

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

async function acceptIdenticalExisting(
  artifact: { finalPath: string; content: string },
  operations: RegressionPublicationOperations,
  cause: unknown,
): Promise<void> {
  const existing = await operations.readText(artifact.finalPath).catch(() => undefined);
  if (existing === artifact.content) return;
  throw new RegressionPublicationError(
    "RR_REGRESSION_CONFLICT",
    `Regression artifact conflict; refusing to overwrite: ${artifact.finalPath}`,
    { cause },
  );
}

async function verifyExclusiveCopy(
  source: string,
  artifact: { finalPath: string; content: string },
  operations: RegressionPublicationOperations,
): Promise<void> {
  const [sourceSize, destinationSize, destination] = await Promise.all([
    operations.size(source),
    operations.size(artifact.finalPath),
    operations.readText(artifact.finalPath),
  ]);
  const expectedSize = Buffer.byteLength(artifact.content, "utf8");
  if (
    sourceSize !== expectedSize ||
    destinationSize !== expectedSize ||
    sha256(destination) !== sha256(artifact.content)
  ) {
    throw new RegressionPublicationError(
      "RR_REGRESSION_INTEGRITY",
      `Exclusive-copy verification failed: ${artifact.finalPath}`,
    );
  }
}

async function publishArtifact(
  source: string,
  artifact: { finalPath: string; content: string },
  operations: RegressionPublicationOperations,
  published: string[],
): Promise<void> {
  try {
    await operations.link(source, artifact.finalPath);
    published.push(artifact.finalPath);
    return;
  } catch (error) {
    if (errno(error) === "EEXIST") {
      await acceptIdenticalExisting(artifact, operations, error);
      return;
    }
    if (!HARD_LINK_UNAVAILABLE.has(errno(error) ?? "")) {
      throw new RegressionPublicationError(
        "RR_REGRESSION_PUBLISH",
        `Unable to publish regression artifact exclusively: ${artifact.finalPath}`,
        { cause: error },
      );
    }
  }

  try {
    await operations.copyFileExclusive(source, artifact.finalPath);
    published.push(artifact.finalPath);
    await verifyExclusiveCopy(source, artifact, operations);
  } catch (error) {
    if (errno(error) === "EEXIST") {
      await acceptIdenticalExisting(artifact, operations, error);
      return;
    }
    // COPYFILE_EXCL proves the destination was absent when the operation began. A failing
    // implementation may still leave a partial destination, so record it for guarded cleanup.
    if (!published.includes(artifact.finalPath)) published.push(artifact.finalPath);
    if (error instanceof RegressionPublicationError) throw error;
    throw new RegressionPublicationError(
      "RR_REGRESSION_PUBLISH",
      `Exclusive-copy publication failed: ${artifact.finalPath}`,
      { cause: error },
    );
  }
}

async function cleanupPublished(
  paths: readonly string[],
  operations: RegressionPublicationOperations,
): Promise<unknown[]> {
  const results = await Promise.allSettled(paths.map((path) => operations.remove(path)));
  return results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
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
  const operations: RegressionPublicationOperations = {
    ...DEFAULT_PUBLICATION_OPERATIONS,
    ...options.publicationOperations,
  };
  const published: string[] = [];
  let publicationError: unknown;
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
      await publishArtifact(join(stagingDirectory, artifact.name), artifact, operations, published);
    }
  } catch (error) {
    publicationError = error;
    const cleanupErrors = await cleanupPublished(published, operations);
    if (cleanupErrors.length > 0) {
      publicationError = new RegressionPublicationError(
        "RR_REGRESSION_CLEANUP",
        `Regression publication failed and cleanup could not remove ${cleanupErrors.length} artifact(s)`,
        { cause: new AggregateError([error, ...cleanupErrors]) },
      );
    }
  }
  try {
    await rm(stagingDirectory, { recursive: true, force: true });
  } catch (error) {
    if (!publicationError) {
      publicationError = new RegressionPublicationError(
        "RR_REGRESSION_CLEANUP",
        "Regression staging cleanup failed",
        { cause: error },
      );
    }
  }
  if (publicationError) throw publicationError;
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
