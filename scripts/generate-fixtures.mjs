import { join, resolve } from "node:path";
import { createEvent } from "../packages/core/dist/index.js";
import { writeTrace } from "../packages/trace/dist/index.js";

const target = join(resolve("."), "scenarios");
const timestamp = (sequence) => new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString();
const event = (runId, sequence, type, payload = {}, extra = {}) =>
  createEvent({
    runId,
    stepId: `${runId}-step-${sequence}`,
    sequence,
    timestamp: timestamp(sequence),
    type,
    actor: "fixture-agent",
    payload,
    ...extra,
  });

await writeTrace(join(target, "rate-limit-recovery.fixture.jsonl"), [
  event("fixture-recovery", 0, "run_started"),
  event("fixture-recovery", 1, "model_response", { answer: "ok" }, { model: "local" }),
  event("fixture-recovery", 2, "retry", { attempt: 1, budget: 3 }),
  event("fixture-recovery", 3, "recovery_action", { correct: true, action: "backoff" }),
  event("fixture-recovery", 4, "validation_result", { valid: true }),
  event("fixture-recovery", 5, "run_completed", { answer: "ok" }),
]);

await writeTrace(join(target, "malformed-failure.fixture.jsonl"), [
  event("fixture-failure", 0, "run_started"),
  event("fixture-failure", 1, "model_response", { answer: "ok" }, { model: "local" }),
  event("fixture-failure", 2, "validation_result", { valid: false }),
  event("fixture-failure", 3, "run_failed", { reason: "unrecovered parse failure" }),
]);

console.log("Scenario fixtures regenerated deterministically.");
