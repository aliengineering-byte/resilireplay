import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { BUILTIN_SCENARIOS, createEvent, injectFaults } from "../packages/core/dist/index.js";
import { recordCommand } from "../packages/cli/dist/index.js";
import { writeReportBundle } from "../packages/reporters/dist/index.js";
import { compileRegression, writeTrace } from "../packages/trace/dist/index.js";

const root = resolve(".");
const output = join(root, "runs", "demo");
await mkdir(output, { recursive: true });

const deterministicAgent = join(root, "examples", "deterministic-agent", "dist", "index.js");
console.log("\n1/5 Recording the no-key deterministic agent");
const recorded = await recordCommand(
  [process.execPath, deterministicAgent],
  join(output, "recorded.jsonl"),
  5_000,
);
console.log(`Recorded ${recorded.events.length} sanitized events.`);

const timestamp = (sequence) => new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString();
const event = (runId, sequence, type, payload, extra = {}) =>
  createEvent({
    runId,
    stepId: `${runId}-step-${sequence}`,
    sequence,
    timestamp: timestamp(sequence),
    type,
    actor: "demo-agent",
    payload,
    ...extra,
  });

const recoverySource = [
  event("demo-recovery", 0, "run_started", { task: "local deterministic demo" }),
  event("demo-recovery", 1, "model_request", { prompt: "plan" }, { model: "local" }),
  event("demo-recovery", 2, "model_response", { plan: "use tool" }, { model: "local" }),
  event("demo-recovery", 3, "retry", { attempt: 1, budget: 3 }),
  event("demo-recovery", 4, "recovery_action", { correct: true, action: "backoff" }),
  event("demo-recovery", 5, "tool_requested", { value: 4 }, { tool: "calculator" }),
  event("demo-recovery", 6, "tool_result", { value: 4 }, { tool: "calculator" }),
  event("demo-recovery", 7, "recovery_action", { correct: true, action: "validate result" }),
  event("demo-recovery", 8, "agent_handoff", { to: "reviewer" }),
  event("demo-recovery", 9, "recovery_action", { correct: true, action: "reroute handoff" }),
  event("demo-recovery", 10, "validation_result", { valid: true }),
  event("demo-recovery", 11, "run_completed", { answer: 4 }),
];

console.log("\n2/5 Injecting three deterministic faults (429, delayed tool, wrong recipient)");
const recovered = injectFaults(recoverySource, BUILTIN_SCENARIOS["triple-fault-demo"]);
await writeTrace(join(output, "recovered.jsonl"), recovered.events);
const recoveredReport = await writeReportBundle(recovered.events, join(output, "recovered-report"));
console.log(recoveredReport.terminal);

const failedSource = [
  event("demo-failure", 0, "run_started", { task: "parse local response" }),
  event("demo-failure", 1, "model_request", { prompt: "return JSON" }, { model: "local" }),
  event("demo-failure", 2, "model_response", { answer: 4 }, { model: "local" }),
  event("demo-failure", 3, "validation_result", { valid: false, reason: "parse failed" }),
  event("demo-failure", 4, "run_failed", { reason: "unrecovered malformed response" }),
];
console.log("\n3/5 Demonstrating an unrecovered malformed response");
const failed = injectFaults(failedSource, BUILTIN_SCENARIOS["malformed-json"]);
await writeTrace(join(output, "failed.jsonl"), failed.events);
const failedReport = await writeReportBundle(failed.events, join(output, "failed-report"));
console.log(failedReport.terminal);

console.log("\n4/5 Compiling the failed trace into an editable regression");
const regression = await compileRegression(failed.events, join(output, "generated-regression"));
const test = spawn(process.execPath, ["--test", regression.testPath], {
  cwd: regression.outputDirectory,
  stdio: "inherit",
  windowsHide: true,
});
const testCode = await new Promise((resolveCode, reject) => {
  test.once("error", reject);
  test.once("exit", (code) => resolveCode(code ?? 1));
});
if (testCode !== 0) throw new Error(`Generated regression test failed with ${testCode}`);

console.log("\n5/5 Demo complete");
console.log(`Successful recovery report: ${recoveredReport.htmlPath}`);
console.log(`Failed recovery report:     ${failedReport.htmlPath}`);
console.log(`Generated regression:       ${regression.outputDirectory}`);
console.log(
  `Source → fixture hash:       ${regression.sourceTraceHash.slice(0, 12)} → ${regression.fixtureHash.slice(0, 12)}`,
);
