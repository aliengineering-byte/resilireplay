import { randomUUID } from "node:crypto";
import { z } from "zod";
import { hashValue } from "./stable.js";
import { sanitize } from "./sanitize.js";

export const EVENT_TYPES = [
  "run_started",
  "model_request",
  "model_response",
  "tool_discovered",
  "tool_requested",
  "tool_result",
  "agent_handoff",
  "shared_state_read",
  "shared_state_write",
  "retry",
  "recovery_action",
  "validation_result",
  "safety_violation",
  "run_completed",
  "run_failed",
] as const;

export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

export const FaultMetadataSchema = z
  .object({
    scenarioId: z.string().min(1),
    faultType: z.string().min(1),
    seed: z.number().int(),
    applicationIndex: z.number().int().nonnegative(),
    originalPayloadHash: z.string().regex(/^[a-f0-9]{64}$/),
    details: z.record(z.unknown()).default({}),
  })
  .strict();

export const TraceEventSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    runId: z.string().min(1),
    stepId: z.string().min(1),
    parentId: z.string().min(1).optional(),
    causeId: z.string().min(1).optional(),
    sequence: z.number().int().nonnegative(),
    timestamp: z.string().datetime({ offset: true }),
    type: EventTypeSchema,
    actor: z.string().min(1),
    tool: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    metadata: z.record(z.unknown()).default({}),
    payload: z.unknown(),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
    fault: FaultMetadataSchema.optional(),
  })
  .strict();

export type TraceEvent = z.infer<typeof TraceEventSchema>;

export type EventInput = Omit<
  TraceEvent,
  "schemaVersion" | "stepId" | "timestamp" | "metadata" | "payloadHash"
> & {
  stepId?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
};

export function createEvent(input: EventInput): TraceEvent {
  const payload = sanitize(input.payload);
  return TraceEventSchema.parse({
    ...input,
    schemaVersion: "1.0",
    stepId: input.stepId ?? randomUUID(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    metadata: sanitize(input.metadata ?? {}),
    payload,
    payloadHash: hashValue(payload),
  });
}

export function validateEvent(value: unknown): TraceEvent {
  const event = TraceEventSchema.parse(value);
  if (hashValue(event.payload) !== event.payloadHash) {
    throw new Error(`Payload hash mismatch at sequence ${event.sequence}`);
  }
  return event;
}

export function validateTrace(values: readonly unknown[]): TraceEvent[] {
  const events = values.map(validateEvent);
  let runId: string | undefined;
  let previous = -1;
  const ids = new Set<string>();
  for (const event of events) {
    runId ??= event.runId;
    if (event.runId !== runId) throw new Error("Trace contains more than one run ID");
    if (event.sequence <= previous) throw new Error("Trace sequences must be strictly monotonic");
    if (ids.has(event.stepId)) throw new Error(`Duplicate step ID: ${event.stepId}`);
    previous = event.sequence;
    ids.add(event.stepId);
  }
  return events;
}
