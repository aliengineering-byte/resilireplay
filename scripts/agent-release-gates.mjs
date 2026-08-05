import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  captureIngest,
  captureIngestBatch,
  captureStart,
  captureStatus,
  captureStop,
  normalizeHookEvent,
} from "../packages/agent/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".artifacts", "agent-release-gates");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

function fixture(index) {
  return normalizeHookEvent(
    {
      hook_event_name: "PostToolUse",
      session_id: "synthetic-stress-session",
      tool_name: "Bash",
      tool_use_id: `call-${index}`,
      tool_input: { command: "fixture" },
      tool_response: { exit_code: 0, stdout: "synthetic fixture" },
      duration_ms: index % 23,
    },
    { source: "codex", receivedAt: "2026-08-05T00:00:00.000Z" },
  );
}

async function bytes(path) {
  const information = await stat(path);
  if (information.isFile()) return information.size;
  const values = await Promise.all(
    (await readdir(path)).map((entry) => bytes(resolve(path, entry))),
  );
  return values.reduce((sum, value) => sum + value, 0);
}

const captureRoot = await mkdtemp(join(tmpdir(), "resilireplay-agent-gate-"));
const rssBefore = process.memoryUsage().rss;
const startupStarted = performance.now();
await captureStart(captureRoot);
const startupMs = performance.now() - startupStarted;

const latency = [];
for (let index = 0; index < 100; index += 1) {
  const started = performance.now();
  await captureIngest(fixture(index), captureRoot);
  latency.push(performance.now() - started);
}
latency.sort((left, right) => left - right);
const medianMs = latency[Math.floor(latency.length * 0.5)];
const p95Ms = latency[Math.floor(latency.length * 0.95)];

await captureStop(captureRoot);
await captureStart(captureRoot);
const eventCount = 20_000;
const events = Array.from({ length: eventCount }, (_, index) => fixture(index + 100));
const rssWithInput = process.memoryUsage().rss;
const stressStarted = performance.now();
const outcomes = await captureIngestBatch(events, captureRoot);
const stressMs = performance.now() - stressStarted;
const session = await captureStatus(captureRoot);
const full = await captureIngest(fixture(eventCount + 100), captureRoot);
const artifactBytes = await bytes(resolve(captureRoot, ".resilireplay/capture"));
const rssAfter = process.memoryUsage().rss;
const cleanupStarted = performance.now();
await captureStop(captureRoot);
await rm(captureRoot, { recursive: true, force: true });
const cleanupMs = performance.now() - cleanupStarted;

if (outcomes.length !== eventCount || outcomes.some((value) => value !== "captured"))
  throw new Error("20,000-event capture was incomplete");
if (session?.eventCount !== eventCount || full !== "full")
  throw new Error("Capture bound was not enforced at exactly 20,000 events");
if (artifactBytes > 32 * 1024 * 1024) throw new Error("Bounded capture artifacts exceeded 32 MiB");
if (p95Ms > 250) throw new Error(`In-process hook p95 ${p95Ms.toFixed(2)}ms exceeded 250ms`);

const report = {
  schemaVersion: "resilireplay.performance-evidence/v1",
  generatedAt: new Date().toISOString(),
  workload:
    "Synthetic normalized Codex PostToolUse success fixtures; batch and single-event timings are not compared as equivalent workloads.",
  hookLatency: {
    samples: latency.length,
    medianMs: Number(medianMs.toFixed(2)),
    p95Ms: Number(p95Ms.toFixed(2)),
  },
  captureStress: { eventCount, wallMs: Math.round(stressMs), artifactBytes, boundResult: full },
  memory: {
    rssBeforeBytes: rssBefore,
    rssWithInputBytes: rssWithInput,
    rssAfterBytes: rssAfter,
    measuredDeltaBytes: Math.max(rssWithInput, rssAfter) - rssBefore,
  },
  lifecycle: {
    startupMs: Number(startupMs.toFixed(2)),
    cleanupMs: Number(cleanupMs.toFixed(2)),
    ownedProcesses: 0,
    ownedListeners: 0,
  },
};
await writeFile(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
