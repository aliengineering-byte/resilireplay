import { z } from "zod";
import { EventEnvelopeV1Schema, type EventEnvelopeV1 } from "@resilireplay/core";

export const ADAPTER_SDK_SCHEMA = "resilireplay.adapter-sdk/v1.0.0" as const;
export const ADAPTER_TEMPLATE_SCHEMA = "resilireplay.adapter-template/v1.0.0" as const;

export const CapabilityLevelSchema = z.enum([
  "verified",
  "supported",
  "experimental",
  "documented",
  "unsupported",
]);
export type CapabilityLevel = z.infer<typeof CapabilityLevelSchema>;

export const AdapterKindSchema = z.enum(["typescript", "jsonl", "otlp", "manual"]);
export type AdapterKind = z.infer<typeof AdapterKindSchema>;

export const SafetyClassSchema = z.enum(["safe", "unsafe", "unknown"]);
export type SafetyClass = z.infer<typeof SafetyClassSchema>;

export const AdapterCapabilitySchema = z
  .object({
    name: z.string().min(1),
    level: CapabilityLevelSchema,
    details: z.string().max(2_000).optional(),
    required: z.boolean().default(false),
  })
  .strict();
export type AdapterCapability = z.infer<typeof AdapterCapabilitySchema>;

export const AdapterManifestSchema = z
  .object({
    schemaVersion: z.literal(ADAPTER_SDK_SCHEMA),
    adapterId: z.string().min(1),
    adapterName: z.string().min(1),
    adapterVersion: z.string().min(1),
    framework: z.string().min(1),
    frameworkVersionRange: z.string().min(1),
    kind: AdapterKindSchema,
    capabilities: z.array(AdapterCapabilitySchema).default([]),
    evidence: z.array(z.string().min(1)).default([]),
    limitations: z.array(z.string().min(1)).default([]),
    limitationsHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type AdapterManifest = z.infer<typeof AdapterManifestSchema>;

export const FaultBoundarySchema = z
  .object({
    name: z.string().min(1),
    recoverable: z.boolean(),
    retryable: z.boolean(),
    requiresCleanup: z.boolean(),
    idempotent: z.boolean(),
  })
  .strict();
export type FaultBoundary = z.infer<typeof FaultBoundarySchema>;

export const FrameworkDetectionContextSchema = z
  .object({
    frameworkHint: z.string().max(256).optional(),
    packageName: z.string().max(256).optional(),
    command: z.string().max(512).optional(),
    version: z.string().max(64).optional(),
    rootDirectory: z.string().min(1).max(1_024).default(process.cwd()),
  })
  .strict();
export type FrameworkDetectionContext = z.infer<typeof FrameworkDetectionContextSchema>;

export interface DetectResult {
  framework: string;
  frameworkVersion?: string;
  confidence: "low" | "medium" | "high";
  evidence: string[];
  reason: string;
}

export interface FaultInjectionRequest {
  faultType: string;
  targetBoundary: string;
  occurrence: number;
  parameters?: Record<string, unknown>;
  seed: number;
}

export interface FaultInjectionResult {
  events: EventEnvelopeV1[];
  injected: number;
  skipped: string[];
  seed: number;
}

export interface RegressionArtifact {
  scenario: Record<string, unknown>;
  fixture: string[];
  evidenceHash: string;
  fixtureHash: string;
  firstCriticalSequence: number;
}

export interface ReplayResult {
  passed: boolean;
  finalSequence: number;
  duplicateSideEffects: number;
  metricsDigest: string;
}

export interface HealthStatus {
  status: "ok" | "degraded" | "blocked";
  messages: string[];
}

export interface AdapterHooks<TEvent extends EventEnvelopeV1 = EventEnvelopeV1> {
  onRunStart?(event: TEvent): Promise<void> | void;
  onEvent?(event: TEvent): Promise<void> | void;
  onFaultInjected?(event: TEvent): Promise<void> | void;
  onError?(error: Error): Promise<void> | void;
}

export interface FrameworkAdapter {
  manifest: AdapterManifest;
  detect(
    context: FrameworkDetectionContext,
  ): Promise<DetectResult | undefined> | DetectResult | undefined;
  capabilities(): AdapterCapability[];
  faultBoundaries(): FaultBoundary[];
  captureEvents(
    context: FrameworkDetectionContext,
    hooks?: AdapterHooks,
  ): Promise<EventEnvelopeV1[]>;
  injectFaults(
    events: readonly EventEnvelopeV1[],
    request: FaultInjectionRequest,
  ): Promise<FaultInjectionResult>;
  replay(
    events: readonly EventEnvelopeV1[],
    context?: FrameworkDetectionContext,
  ): Promise<ReplayResult>;
  generateRegression(
    events: readonly EventEnvelopeV1[],
    destinationDirectory: string,
  ): Promise<RegressionArtifact>;
  sanitizeEvents(events: readonly EventEnvelopeV1[]): EventEnvelopeV1[];
  cleanup(context: FrameworkDetectionContext): Promise<void>;
  doctor(context?: FrameworkDetectionContext): Promise<HealthStatus>;
}

export const TemplateSchemaVersionSchema = z.literal("1.0");
export type TemplateSchemaVersion = z.infer<typeof TemplateSchemaVersionSchema>;

export const TemplateModeSchema = z.enum(["campaign", "fixture", "scenario"]);
export type TemplateMode = z.infer<typeof TemplateModeSchema>;

export const AdapterTemplateSchema = z
  .object({
    schemaVersion: z.literal(ADAPTER_TEMPLATE_SCHEMA),
    templateVersion: TemplateSchemaVersionSchema,
    id: z.string().min(1),
    name: z.string().min(1).max(180),
    description: z.string().min(1).max(1_000),
    framework: z.string().min(1),
    frameworkVersionRange: z.string().min(1),
    compatibility: CapabilityLevelSchema,
    safetyClass: SafetyClassSchema,
    mode: TemplateModeSchema,
    source: z
      .object({
        repository: z.string().min(1),
        version: z.string().min(1),
      })
      .strict(),
    license: z.literal("Apache-2.0"),
    expectedEvidence: z.array(z.string().min(1)),
    scenarioFixture: z.record(z.unknown()),
    campaignFixture: z.record(z.unknown()).optional(),
    schemaValidation: z.object({ requiredEvidenceFields: z.array(z.string()) }).strict(),
    limitations: z.array(z.string().max(1_000)).default([]),
  })
  .strict();

export type AdapterTemplate = z.infer<typeof AdapterTemplateSchema>;

export function parseAdapterManifest(value: unknown): AdapterManifest {
  return AdapterManifestSchema.parse(value);
}

export function parseAdapterTemplate(value: unknown): AdapterTemplate {
  const template = AdapterTemplateSchema.parse(value);
  if (!isSafeTemplateId(template.id)) throw new Error(`Unsafe template id: ${template.id}`);
  const payload = stableStringifyForSafetyCheck(template.scenarioFixture);
  if (payload.includes("..") || /\$?\{\{.*\}\}/.test(payload)) {
    throw new Error(`Template contains unsafe scenario fixture content: ${template.id}`);
  }
  return template;
}

export function validateEvents(value: readonly unknown[]): EventEnvelopeV1[] {
  return value.map((entry) => EventEnvelopeV1Schema.parse(entry));
}

export function capabilityGate(manifest: AdapterManifest, expected: string[]): void {
  const levels = new Map(manifest.capabilities.map((item) => [item.name, item.level]));
  for (const required of expected) {
    const level = levels.get(required);
    if (level === undefined || level === "unsupported") {
      throw new Error(`Unsupported required capability: ${required}`);
    }
  }
}

const TEMPLATE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;

function isSafeTemplateId(value: string): boolean {
  return TEMPLATE_ID.test(value);
}

function stableStringifyForSafetyCheck(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stableStringifyForSafetyCheck).join("|");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${key}:${stableStringifyForSafetyCheck(entry)}`)
      .join("|");
  }
  return String(value);
}
