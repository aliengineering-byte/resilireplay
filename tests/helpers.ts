import { createEvent, type EventType, type TraceEvent } from "@resilireplay/core";

export function event(
  sequence: number,
  type: EventType,
  payload: unknown = {},
  extra: Partial<TraceEvent> = {},
): TraceEvent {
  return createEvent({
    runId: "test-run",
    stepId: `step-${sequence}`,
    sequence,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(),
    type,
    actor: "test-agent",
    payload,
    ...extra,
  });
}

export function passingTrace(): TraceEvent[] {
  return [
    event(0, "run_started"),
    event(1, "model_request", { prompt: "test" }),
    event(2, "model_response", { answer: "ok" }),
    event(3, "validation_result", { valid: true }),
    event(4, "run_completed", { answer: "ok" }),
  ];
}

export function failedTrace(): TraceEvent[] {
  return [
    event(0, "run_started"),
    event(1, "model_response", { answer: "ok" }),
    event(2, "validation_result", { valid: false }),
    event(3, "run_failed", { reason: "test" }),
  ];
}
