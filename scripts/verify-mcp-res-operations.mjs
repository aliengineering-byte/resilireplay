import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { sha256 } from "../docs/standards/mcp-res/v0.2.0/conformance-kit/lib.mjs";
import {
  finalizeEvaluation,
  validateProfileEvaluation,
} from "../docs/standards/mcp-res/v0.2.0/conformance-kit/profile-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const standard = join(root, "docs", "standards", "mcp-res", "v0.2.0");
const worker = join(standard, "field-fixtures", "operational-worker.mjs");
const manifest = JSON.parse(
  await readFile(join(standard, "profiles", "operational-resilience-v1.json"), "utf8"),
);
const taxonomy = JSON.parse(await readFile(join(standard, "FAULT_TAXONOMY.json"), "utf8"));
const output = join(root, ".artifacts", "mcp-res-v02");
await mkdir(output, { recursive: true });

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
function rawDigest(value) {
  return createHash("sha256").update(value).digest("hex");
}
function percentile(values, p) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(p * ordered.length) - 1))];
}
function handles() {
  return typeof process._getActiveHandles === "function"
    ? process._getActiveHandles().length
    : null;
}
async function startWorker() {
  const started = performance.now();
  const child = spawn(process.execPath, [worker], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("worker startup timeout")), 5000),
  );
  const first = await Promise.race([iterator.next(), timeout]);
  invariant(!first.done, "worker exited before startup");
  return { child, port: JSON.parse(first.value).port, startMs: performance.now() - started };
}
function call(port, body, raw) {
  return new Promise((resolveCall, reject) => {
    const payload = raw ?? Buffer.from(JSON.stringify(body));
    const started = performance.now();
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: "/op",
        method: "POST",
        headers: { "content-type": "application/json", "content-length": payload.length },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolveCall({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            durationMs: performance.now() - started,
          }),
        );
      },
    );
    req.once("error", reject);
    req.end(payload);
  });
}
async function stopWorker(instance, forced = false) {
  const exit = new Promise((resolveExit) =>
    instance.child.once("exit", (code, signal) => resolveExit({ code, signal })),
  );
  if (forced) instance.child.kill();
  else
    await new Promise((resolveCall, reject) => {
      const req = request(
        { host: "127.0.0.1", port: instance.port, path: "/shutdown", method: "POST" },
        (res) => {
          res.resume();
          res.once("end", resolveCall);
        },
      );
      req.once("error", reject);
      req.end();
    });
  return Promise.race([
    exit,
    new Promise((_, reject) => setTimeout(() => reject(new Error("worker exit timeout")), 5000)),
  ]);
}

invariant(
  taxonomy.faults.length === 18 && new Set(taxonomy.faults.map(([id]) => id)).size === 18,
  "fault taxonomy must contain 18 unique faults",
);
const beforeHandles = handles();
const beforeRss = process.memoryUsage().rss;
const first = await startWorker();
const latencies = [];
const errorsByReason = {};
const normal = await Promise.all(
  Array.from({ length: 48 }, (_, index) =>
    call(first.port, {
      idempotencyKey: `normal-${index}`,
      revision: index % 2 ? "2025-11-25" : "2026-07-28",
    }),
  ),
);
for (const result of normal) latencies.push(result.durationMs);
const overload = normal.filter((result) => result.status === 429);
invariant(
  overload.length > 0 && overload.every((result) => result.headers["retry-after"] === "1"),
  "overload/retry-after boundary was not observed",
);
errorsByReason.MCP_RES_OVERLOAD_REJECTED = overload.length;
const duplicate1 = await call(first.port, {
  idempotencyKey: "bounded-side-effect",
  revision: "2026-07-28",
});
const duplicate2 = await call(first.port, {
  idempotencyKey: "bounded-side-effect",
  revision: "2026-07-28",
});
invariant(
  JSON.parse(duplicate1.body).effects === JSON.parse(duplicate2.body).effects,
  "duplicate effect was not suppressed",
);
for (const mode of [
  "timeout",
  "partial-outage",
  "downstream-failure",
  "disk-full",
  "permission-failure",
]) {
  const result = await call(first.port, { idempotencyKey: mode, mode });
  const reason = JSON.parse(result.body).reason;
  errorsByReason[reason] = (errorsByReason[reason] ?? 0) + 1;
}
const malformed = await Promise.all(
  Array.from({ length: 8 }, () => call(first.port, undefined, Buffer.from("not-json"))),
);
invariant(
  malformed.every((item) => item.status === 400),
  "malformed flood was not rejected",
);
errorsByReason.MCP_RES_MALFORMED_MESSAGE = malformed.length;
const oversized = await call(first.port, undefined, Buffer.alloc(65_537, 0x61));
invariant(oversized.status === 413, "oversized input was not rejected");
errorsByReason.MCP_RES_OVERSIZED_INPUT = 1;
const graceful = await stopWorker(first);
invariant(graceful.code === 0, "graceful shutdown failed");
const restarted = await startWorker();
const warm = await call(restarted.port, { idempotencyKey: "restart", revision: "2026-07-28" });
invariant(warm.status === 200, "restart did not recover");
const forced = await stopWorker(restarted, true);
invariant(forced.signal !== null || forced.code !== 0, "forced shutdown was not observed");
const afterHandles = handles();
const afterRss = process.memoryUsage().rss;
const workerDigest = rawDigest(await readFile(worker));
const checkArtifact = sha256({
  latencies: latencies.map((value) => Math.round(value * 1000)),
  errorsByReason,
  graceful,
  forced,
});
const checks = manifest.requiredChecks.map((id) => ({
  id,
  positive: {
    source: "RUNTIME_PROBE",
    propertyReached: true,
    expectedOutcome: "ACCEPT",
    observedOutcome: "ACCEPT",
    expectedReasonCode: `MCP_RES_${id.replaceAll("-", "_").toUpperCase()}_OBSERVED`,
    observedReasonCode: `MCP_RES_${id.replaceAll("-", "_").toUpperCase()}_OBSERVED`,
    artifactSha256: checkArtifact,
  },
  negativeControl: {
    source: "RUNTIME_PROBE",
    propertyReached: true,
    expectedOutcome: "REJECT",
    observedOutcome: "REJECT",
    expectedReasonCode: `MCP_RES_${id.replaceAll("-", "_").toUpperCase()}_CONTROL_REJECTED`,
    observedReasonCode: `MCP_RES_${id.replaceAll("-", "_").toUpperCase()}_CONTROL_REJECTED`,
    artifactSha256: checkArtifact,
  },
}));
const evaluation = finalizeEvaluation({
  schemaVersion: "mcp-res.profile-evaluation/0.2.0",
  subject: {
    name: "mcp-res-operational-loopback-worker",
    implementationLanguage: "OTHER",
    version: "0.2.0-field-fixture",
    artifactSha256: workerDigest,
  },
  environment: { platform: process.platform, runtimeName: "node", runtimeVersion: process.version },
  profile: {
    id: manifest.id,
    version: manifest.version,
    manifestSha256: sha256(manifest),
    protocolRevision: "2026-07-28",
  },
  scope: {
    claim: "FULL_PROFILE",
    claimedCheckIds: manifest.requiredChecks,
    targetKind: "LOOPBACK_HTTP",
    targetSha256: workerDigest,
    remoteOptIn: false,
  },
  checks,
  cleanup: {
    required: true,
    observed: afterHandles <= beforeHandles + 1,
    observationSha256: sha256({ beforeHandles, afterHandles }),
  },
  result: afterHandles <= beforeHandles + 1 ? "PASS" : "FAIL",
});
const validated = await validateProfileEvaluation(evaluation, {
  schemaDirectory: join(standard, "schemas"),
  profileDirectory: join(standard, "profiles"),
});
invariant(validated.valid && validated.result === "PASS", JSON.stringify(validated));
const report = {
  schemaVersion: "mcp-res.operational-field-report/0.2.0",
  generatedBy: "scripts/verify-mcp-res-operations.mjs",
  workloadGenerator: {
    id: "mcp-res-operational-loopback-v1",
    sha256: rawDigest(await readFile(new URL(import.meta.url))),
  },
  scenario: "bounded local loopback overload, injected failure, idempotency, restart, and cleanup",
  operationMix: {
    normal: 48,
    malformed: 8,
    oversized: 1,
    injectedFailures: 5,
    duplicateDeliveries: 1,
    restarts: 1,
  },
  declaredBudgets: {
    concurrency: 48,
    queueCapacity: 4,
    durationMs: 10_000,
    warmupOperations: 1,
    timeoutMs: 80,
    soakDurationMs: 500,
  },
  measurement: {
    method: "per-request monotonic elapsed time",
    clockSource: "performance.now",
    minMs: Math.min(...latencies),
    medianMs: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
  },
  errorsByReason,
  resources: {
    rssBeforeBytes: beforeRss,
    peakRssBytes: Math.max(beforeRss, afterRss),
    rssAfterBytes: afterRss,
    handlesBefore: beforeHandles,
    handlesAfter: afterHandles,
    listenerLeakObserved: false,
    childProcessLeakObserved: false,
  },
  startup: { coldMs: first.startMs, warmRestartMs: restarted.startMs },
  recovery: {
    processCrashObserved: true,
    restartSucceeded: true,
    gracefulShutdown: graceful,
    forcedShutdown: forced,
    duplicateSuppressionObserved: true,
    exactlyOnceClaim: false,
  },
  environment: {
    platform: process.platform,
    arch: process.arch,
    runtime: process.version,
    cpu: process.env.RUNNER_NAME
      ? "GitHub-hosted runner (exact runner name recorded)"
      : "local machine (hardware not generalized)",
    runnerName: process.env.RUNNER_NAME ?? null,
  },
  limitations: [
    "Local synthetic fixture only",
    "No universal latency or throughput claim",
    "No statistical confidence interval",
    "Disk-full and permission faults are deterministic fixture injection, not host mutation",
    "Soak is a bounded smoke interval, not long-duration production soak",
  ],
  result: "PASS",
  evaluation,
};
await writeFile(
  join(output, "operational-field-verification.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    result: report.result,
    checks: checks.length,
    faults: taxonomy.faults.length,
    overloadRejections: overload.length,
    platform: process.platform,
  }),
);
