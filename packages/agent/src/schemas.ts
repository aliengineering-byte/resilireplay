import { z } from "zod";

export const AGENT_EVENT_SCHEMA = "resilireplay.agent-event/v1" as const;
export const CAPTURE_SESSION_SCHEMA = "resilireplay.capture-session/v1" as const;
export const FAILURE_EVIDENCE_SCHEMA = "resilireplay.failure-evidence/v1" as const;
export const ADAPTER_MANIFEST_SCHEMA = "resilireplay.adapter-manifest/v1" as const;

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const BoundedText = z.string().max(512);

export const AgentSourceSchema = z.enum(["claude-code", "codex", "hermes", "generic"]);
export type AgentSource = z.infer<typeof AgentSourceSchema>;

export const AgentEventSchema = z
  .object({
    schemaVersion: z.literal(AGENT_EVENT_SCHEMA),
    eventId: Sha256,
    source: AgentSourceSchema,
    sessionId: Sha256,
    eventType: z.enum(["tool-result", "session-end", "turn-end"]),
    toolName: BoundedText.optional(),
    toolCallId: Sha256.optional(),
    parentId: Sha256.optional(),
    outcome: z.enum(["succeeded", "failed", "interrupted", "unknown"]),
    durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
    errorClass: z
      .enum([
        "none",
        "process-exit",
        "timeout",
        "permission",
        "not-found",
        "protocol",
        "validation",
        "interrupted",
        "unknown",
      ])
      .optional(),
    inputSha256: Sha256.optional(),
    outputSha256: Sha256.optional(),
    summary: BoundedText.optional(),
    capturedAt: z.string().datetime(),
  })
  .strict();
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const CaptureSessionSchema = z
  .object({
    schemaVersion: z.literal(CAPTURE_SESSION_SCHEMA),
    sessionId: Sha256,
    status: z.enum(["armed", "stopped"]),
    startedAt: z.string().datetime(),
    stoppedAt: z.string().datetime().optional(),
    eventCount: z.number().int().nonnegative().max(20_000),
    failureCount: z.number().int().nonnegative().max(20_000),
    limits: z.object({ maxEvents: z.literal(20_000), maxEventBytes: z.literal(32_768) }).strict(),
  })
  .strict();
export type CaptureSession = z.infer<typeof CaptureSessionSchema>;

export const FailureEvidenceSchema = z
  .object({
    schemaVersion: z.literal(FAILURE_EVIDENCE_SCHEMA),
    evidenceId: Sha256,
    source: AgentSourceSchema,
    sessionId: Sha256,
    failureEventId: Sha256,
    toolName: BoundedText.optional(),
    errorClass: BoundedText,
    summary: BoundedText.optional(),
    inputSha256: Sha256.optional(),
    outputSha256: Sha256.optional(),
    causalEventIds: z.array(Sha256).max(16),
    deterministic: z.literal(true),
  })
  .strict();
export type FailureEvidence = z.infer<typeof FailureEvidenceSchema>;

export const AdapterManifestSchema = z
  .object({
    schemaVersion: z.literal(ADAPTER_MANIFEST_SCHEMA),
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/u),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
    license: z.literal("Apache-2.0"),
    source: AgentSourceSchema,
    entrypoint: z.string().max(240),
    events: z.array(z.enum(["tool-result", "session-end", "turn-end"])).min(1),
    privacy: z
      .object({
        rawPromptsPersisted: z.literal(false),
        rawTranscriptsPersisted: z.literal(false),
        environmentValuesPersisted: z.literal(false),
      })
      .strict(),
  })
  .strict();
export type AdapterManifest = z.infer<typeof AdapterManifestSchema>;
