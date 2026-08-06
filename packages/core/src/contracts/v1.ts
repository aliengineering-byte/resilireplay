import { z } from "zod";
import { sanitize } from "../sanitize.js";
import { hashValue, stableStringify } from "../stable.js";
import { type EventType as LegacyEventType, type TraceEvent as LegacyTraceEvent } from "../events.js";

export const V1_SCHEMA_VERSIONS = ["1.0.0"] as const;
export type V1SchemaVersion = (typeof V1_SCHEMA_VERSIONS)[number];

export const EventClassSchema = z.enum([
  "run",
  "agent",
  "turn",
  "model",
  "tool",
  "stream",
  "handoff",
  "guardrail",
  "checkpoint",
  "state",
  "interrupt",
  "retry",
  "side_effect",
  "recovery",
  "custom",
]);

export const BoundarySchema = z.enum([
  "framework",
  "model",
  "tool",
  "transport",
  "stream",
  "checkpoint",
  "state",
  "side_effect",
  "unknown",
]);

export const PhaseSchema = z.enum([
  "start",
  "running",
  "error",
  "retry",
  "succeeded",
  "cancelled",
  "skipped",
  "abort",
  "unknown",
]);

export const SafetyClassSchema = z.enum(["safe", "unsafe", "unknown"]);

export const SideEffectStateSchema = z.enum(["pending", "applied", "rolled-back", "blocked", "failed"]);

export const SideEffectSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    status: SideEffectStateSchema,
    classification: z.string().min(1),
    deterministic: z.boolean().default(true),
    reversible: z.boolean().default(false),
  })
  .strict();

export const RedactionSchema = z
  .object({
    strategy: z.enum(["redacted", "masked", "none"]),
    fieldsRemoved: z.array(z.string()),
    fieldsMasked: z.array(z.string()),
    version: z.string().default("1"),
  })
  .strict();

export const EventV1IdSchema = z.string().min(1);
export const FrameworkSchema = z.string().min(1);
export const FrameworkVersionSchema = z.string().min(1);
export const AdapterSchema = z.string().min(1);
export const AdapterVersionSchema = z.string().min(1);
export const OperationSchema = z.string().min(1);
export const ActorIdSchema = z.string().min(1);

export const EventKindSchema = z.enum([
  "run.start",
  "run.end",
  "run.error",
  "agent.start",
  "agent.end",
  "agent.error",
  "turn.start",
  "turn.end",
  "model.request",
  "model.response",
  "model.error",
  "model.retry",
  "tool.start",
  "tool.result",
  "tool.error",
  "tool.timeout",
  "tool.cancelled",
  "tool.retry",
  "stream.chunk",
  "stream.truncated",
  "stream.completed",
  "stream.cancelled",
  "stream.outOfOrder",
  "stream.duplicate",
  "stream.missing",
  "handoff.requested",
  "handoff.accepted",
  "handoff.rejected",
  "handoff.failed",
  "handoff.completed",
  "guardrail.start",
  "guardrail.pass",
  "guardrail.fail",
  "guardrail.error",
  "checkpoint.write",
  "checkpoint.read",
  "checkpoint.resume",
  "interrupt",
  "resume",
  "partial.completion",
  "state.read",
  "state.write",
  "state.update",
  "state.rollback",
  "recovery.decision",
  "recovery.result",
  "custom",
]);

export type EventKind = z.infer<typeof EventKindSchema>;

export const EventEnvelopeV1Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    envelopeVersion: z.literal(1),
    eventId: EventV1IdSchema,
    runId: EventV1IdSchema,
    traceId: z.string().min(1),
    spanId: z.string().min(1),
    parentSpanId: z.string().min(1).optional(),
    sequence: z.number().int().nonnegative(),
    turnId: z.string().min(1),
    actorId: ActorIdSchema,
    framework: FrameworkSchema,
    frameworkVersion: FrameworkVersionSchema,
    adapter: AdapterSchema,
    adapterVersion: AdapterVersionSchema,
    operation: OperationSchema,
    boundary: BoundarySchema,
    phase: PhaseSchema,
    eventKind: EventKindSchema,
    attempt: z.number().int().nonnegative(),
    eventClass: EventClassSchema,
    safetyClass: SafetyClassSchema,
    payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
    redaction: RedactionSchema,
    wallClock: z.string().datetime({ offset: true }),
    payload: z.unknown(),
    sideEffect: SideEffectSchema.optional(),
    metadata: z.record(z.unknown()).default({}),
    deterministicSeed: z.number().int().optional(),
    causeId: EventV1IdSchema.optional(),
    parentEventId: EventV1IdSchema.optional(),
  })
  .strict();

export type EventEnvelopeV1 = z.infer<typeof EventEnvelopeV1Schema>;
export type EventEnvelopeInput = Omit<
  EventEnvelopeV1,
  | "schemaVersion"
  | "envelopeVersion"
  | "eventId"
  | "payloadDigest"
  | "metadata"
  | "redaction"
  | "wallClock"
> & {
  schemaVersion?: V1SchemaVersion;
  eventId?: string;
  metadata?: Record<string, unknown>;
  redaction?: z.input<typeof RedactionSchema>;
  wallClock?: string;
};

export const MigrationValidationResultSchema = z
  .object({
    from: z.string(),
    to: z.literal("1.0.0"),
    eventId: EventV1IdSchema,
    redacted: z.boolean(),
  })
  .strict();

export const AdapterManifestSchema = z
  .object({
    schemaVersion: z.literal("adapter-manifest/1.0"),
    adapterName: z.string().min(1),
    adapterVersion: z.string().min(1),
    framework: z.string().min(1),
    frameworkVersionRange: z.string().min(1),
    capabilities: z.array(
      z
        .object({
          name: z.string().min(1),
          level: z.enum(["verified", "supported", "experimental", "documented", "unsupported"]),
          reason: z.string().default(""),
          required: z.boolean().default(false),
        })
        .strict(),
    ).default([]),
    limitations: z.array(z.string()),
    createdAt: z.string().datetime({ offset: true }),
    evidence: z.array(z.string()).default([]),
    limitationsHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type AdapterManifest = z.infer<typeof AdapterManifestSchema>;

export const FaultBoundarySchema = z
  .object({
    name: z.string().min(1),
    recoverable: z.boolean(),
    retryable: z.boolean(),
    idempotentRequired: z.boolean(),
    supportsManualCleanup: z.boolean().default(false),
  })
  .strict();

export type FaultBoundary = z.infer<typeof FaultBoundarySchema>;

export function stripUnstableValues(value: unknown): unknown {
  const pathPattern = /([a-zA-Z]:\\|\/)[^\s"]+/g;
  const pidPattern = /(?:pid|processId|process_id|threadId)/i;
  const tempPattern = /(tmp|temp)[\\/][A-Za-z0-9._-]+/i;

  const visit = (next: unknown, keyHint?: string): unknown => {
    if (typeof next === "string") {
      if (pathPattern.test(next) || tempPattern.test(next)) return "[redacted-path]";
      return next;
    }
    if (typeof next === "number") {
      if (keyHint && pidPattern.test(keyHint)) return 0;
      return Number.isFinite(next) ? next : 0;
    }
    if (Array.isArray(next)) return next.map((entry) => visit(entry));
    if (next && typeof next === "object") {
      const entries = Object.entries(next as Record<string, unknown>);
      return Object.fromEntries(
        entries
          .filter(([, candidate]) => candidate !== undefined)
          .map(([k, v]) => [k, visit(v, k)]),
      );
    }
    return next;
  };

  return visit(value);
}

export function createCanonicalReplayDigest(event: Omit<EventEnvelopeV1, "payloadDigest">): string {
  const canonicalized = {
    ...event,
    payloadDigest: undefined,
    wallClock: undefined,
    payload: stripUnstableValues(event.payload),
    metadata: stripUnstableValues(event.metadata),
  };
  return hashValue(stableStringify(canonicalized));
}

export function validateV1Event(value: unknown): EventEnvelopeV1 {
  const parsed = EventEnvelopeV1Schema.parse(value);
  if (createCanonicalReplayDigest(parsed) !== parsed.payloadDigest) {
    throw new Error(`Payload digest mismatch at sequence ${parsed.sequence}`);
  }
  return parsed;
}

export function createV1Event(input: EventEnvelopeInput): EventEnvelopeV1 {
  const wallClock = input.wallClock ?? new Date().toISOString();
  const redaction = RedactionSchema.parse(
    input.redaction ?? { strategy: "none", fieldsRemoved: [], fieldsMasked: [] },
  );
  const metadata = sanitize(input.metadata ?? {});
  const payload = sanitize(input.payload);
  const draft: Omit<EventEnvelopeV1, "payloadDigest"> = {
    schemaVersion: "1.0.0",
    envelopeVersion: 1,
    eventId: input.eventId ?? `${input.eventKind}/${input.sequence}`,
    runId: input.runId,
    traceId: input.traceId,
    spanId: input.spanId,
    parentSpanId: input.parentSpanId,
    sequence: input.sequence,
    turnId: input.turnId,
    actorId: input.actorId,
    framework: input.framework,
    frameworkVersion: input.frameworkVersion,
    adapter: input.adapter,
    adapterVersion: input.adapterVersion,
    operation: input.operation,
    boundary: input.boundary,
    phase: input.phase,
    eventKind: input.eventKind,
    attempt: input.attempt,
    eventClass: input.eventClass,
    safetyClass: input.safetyClass,
    sideEffect: input.sideEffect,
    wallClock,
    payload,
    redaction,
    metadata,
    deterministicSeed: input.deterministicSeed,
    causeId: input.causeId,
    parentEventId: input.parentEventId,
  };

  return EventEnvelopeV1Schema.parse({
    ...draft,
    payloadDigest: createCanonicalReplayDigest(draft),
  });
}

function legacyBoundary(event: LegacyEventType): z.infer<typeof BoundarySchema> {
  if (event.startsWith("tool_")) return "tool";
  if (event.startsWith("model_")) return "model";
  if (event.startsWith("agent_")) return "framework";
  if (event.startsWith("shared_state_")) return "checkpoint";
  if (event === "safety_violation" || event === "validation_result") return "framework";
  return "framework";
}

function legacyClass(event: LegacyEventType): z.infer<typeof EventClassSchema> {
  if (event === "run_started" || event === "run_completed" || event === "run_failed") return "run";
  if (event === "agent_handoff") return "handoff";
  if (event.startsWith("tool_")) return "tool";
  if (event.startsWith("model_")) return "model";
  if (event.startsWith("shared_state_")) return "state";
  if (event === "retry" || event === "recovery_action") return "recovery";
  if (event === "validation_result" || event === "safety_violation") return "guardrail";
  return "custom";
}

function legacyKind(event: LegacyEventType): z.infer<typeof EventKindSchema> {
  const map: Partial<Record<LegacyEventType, z.infer<typeof EventKindSchema>>> = {
    run_started: "run.start",
    model_request: "model.request",
    model_response: "model.response",
    tool_discovered: "tool.start",
    tool_requested: "tool.start",
    tool_result: "tool.result",
    agent_handoff: "handoff.requested",
    shared_state_read: "state.read",
    shared_state_write: "state.write",
    retry: "recovery.decision",
    recovery_action: "recovery.result",
    validation_result: "guardrail.pass",
    safety_violation: "guardrail.fail",
    run_completed: "run.end",
    run_failed: "run.error",
  };
  return map[event] ?? "custom";
}

export function migrateLegacyEvent(event: LegacyTraceEvent): EventEnvelopeV1 {
  const boundary = legacyBoundary(event.type);
  const phase: z.infer<typeof PhaseSchema> = event.type.endsWith("failed")
    ? "error"
    : event.type.includes("completed") || event.type === "safety_violation"
      ? "succeeded"
      : "running";
  const operation = event.type === "agent_handoff" ? "handoff" : boundary;
  const safetyClass = event.type === "safety_violation" ? "unsafe" : "unknown";

  return createV1Event({
    runId: event.runId,
    traceId: event.runId,
    spanId: event.stepId,
    parentSpanId: event.parentId,
    sequence: event.sequence,
    turnId: `${event.runId}-${event.sequence}`,
    actorId: event.actor,
    framework: "resilireplay-legacy",
    frameworkVersion: "1.0.0",
    adapter: "legacy-migrator",
    adapterVersion: "0.5.0",
    operation,
    boundary,
    phase,
    eventKind: legacyKind(event.type),
    attempt: 0,
    eventClass: legacyClass(event.type),
    safetyClass,
    metadata: event.metadata,
    payload: sanitize(event.payload),
    redaction: {
      strategy: "none",
      fieldsRemoved: [],
      fieldsMasked: [],
    },
  });
}

export function migrateLegacyTrace(trace: readonly LegacyTraceEvent[]): EventEnvelopeV1[] {
  return trace.map((event) =>
    EventEnvelopeV1Schema.parse({
      ...migrateLegacyEvent(event),
      metadata: { ...event.metadata, migratedFromLegacySequence: event.sequence },
    }),
  );
}

export function validateCapabilityRequirement(
  manifest: AdapterManifest,
  requiredEvents: readonly string[],
): void {
  const seen = new Set(manifest.capabilities.map((capability) => capability.name));
  for (const requiredEvent of requiredEvents) {
    if (!seen.has(requiredEvent)) {
      throw new Error(`Unsupported required capability: ${requiredEvent}`);
    }
    const entry = manifest.capabilities.find((capability) => capability.name === requiredEvent);
    if (!entry || entry.level === "unsupported") {
      throw new Error(`Capability not supported: ${requiredEvent}`);
    }
  }
}

export const REQUIRED_EVENT_KIND_FOR_SCHEMA = [
  "run.start",
  "run.end",
  "agent.start",
  "agent.end",
  "turn.start",
  "model.request",
  "model.response",
  "model.error",
  "model.retry",
  "tool.start",
  "tool.result",
  "tool.error",
  "tool.timeout",
  "tool.cancelled",
  "tool.retry",
  "stream.chunk",
  "stream.truncated",
  "stream.completed",
  "stream.cancelled",
  "handoff.requested",
  "handoff.accepted",
  "handoff.failed",
  "guardrail.start",
  "guardrail.pass",
  "guardrail.fail",
  "guardrail.error",
  "checkpoint.write",
  "checkpoint.read",
  "checkpoint.resume",
  "interrupt",
  "resume",
  "partial.completion",
  "recovery.decision",
  "recovery.result",
] as const;

export type RequiredEventKind = (typeof REQUIRED_EVENT_KIND_FOR_SCHEMA)[number];
