import { z } from "zod";
import { FaultTypeSchema, containsLikelySecret } from "@resilireplay/core";

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u;
const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });

export const CampaignIdentifierSchema = z.string().regex(IDENTIFIER);
export const CampaignRelativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !hasControlCharacter(value), "Paths cannot contain control characters")
  .refine((value) => !ABSOLUTE_PATH.test(value), "Persisted campaign paths must be relative")
  .refine(
    (value) => !value.split(/[\\/]/u).includes(".."),
    "Persisted campaign paths cannot contain parent traversal segments",
  );

const hasUnsafeToolArgumentPath = (value: unknown): boolean => {
  if (typeof value === "string") {
    if (value.startsWith("{{PROJECT_ROOT}}/")) {
      return !CampaignRelativePathSchema.safeParse(value.slice("{{PROJECT_ROOT}}/".length)).success;
    }
    return (
      ABSOLUTE_PATH.test(value) ||
      /^(?:~[\\/]|%USERPROFILE%|\$HOME)/iu.test(value) ||
      value.split(/[\\/]/u).includes("..")
    );
  }
  if (Array.isArray(value)) return value.some(hasUnsafeToolArgumentPath);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(hasUnsafeToolArgumentPath);
  }
  return false;
};

export const CampaignFaultSchema = z.union([z.literal("none"), FaultTypeSchema]);

export const CampaignTraceTargetSchema = z
  .object({
    id: CampaignIdentifierSchema,
    kind: z.literal("trace"),
    trace: CampaignRelativePathSchema,
  })
  .strict();

export const CampaignMcpTargetSchema = z
  .object({
    id: CampaignIdentifierSchema,
    kind: z.literal("mcp"),
    inspectorConfig: CampaignRelativePathSchema,
    server: z.string().min(1).max(128),
    allowTools: z.array(z.string().min(1).max(128)).max(32).default([]),
    toolArguments: z.record(z.record(z.unknown())).optional(),
    evidenceMode: z.enum(["full", "metadata-only"]).optional(),
    allowRemote: z.boolean().default(false),
  })
  .strict();

export const CampaignTargetSchema = z.discriminatedUnion("kind", [
  CampaignTraceTargetSchema,
  CampaignMcpTargetSchema,
]);

export const CampaignAssertionsSchema = z
  .object({
    outcome: z.enum(["passed", "failed"]).default("passed"),
    safeRecovery: z.boolean().optional(),
    maxRecoveryLatencyMs: z.number().int().nonnegative().optional(),
    maxRetries: z.number().int().nonnegative().optional(),
    noDuplicateSideEffects: z.boolean().default(true),
    safetyPolicyCompliance: z.boolean().default(true),
    minScore: z.number().int().min(0).max(100).optional(),
  })
  .strict();

export const AdapterEvidenceSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional(),
  })
  .strict();

export const CampaignScenarioSchema = z
  .object({
    id: CampaignIdentifierSchema,
    target: CampaignIdentifierSchema,
    fault: CampaignFaultSchema,
    event: z
      .enum([
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
      ])
      .optional(),
    occurrence: z.number().int().positive().default(1),
    parameters: z.record(z.unknown()).default({}),
    seed: z.number().int().optional(),
    recovery: z.enum(["none", "retry"]).default("none"),
    assertions: CampaignAssertionsSchema.default({ outcome: "passed" }),
    adapterEvidence: AdapterEvidenceSchema.optional(),
  })
  .strict();

export const CampaignThresholdsSchema = z
  .object({
    maxScoreDrop: z.number().int().nonnegative().default(0),
    maxRetryIncrease: z.number().int().nonnegative().default(0),
    maxDuplicateSideEffectIncrease: z.number().int().nonnegative().default(0),
    maxRecoveryLatencyIncreaseMs: z.number().int().nonnegative().optional(),
    maxTokenWasteIncrease: z.number().int().nonnegative().optional(),
    maxCostIncreaseUsd: z.number().nonnegative().optional(),
  })
  .strict();

export const CampaignSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    kind: z.literal("resilireplay-campaign"),
    id: CampaignIdentifierSchema,
    description: z.string().min(1).max(500),
    seed: z.number().int().default(42),
    budgets: z
      .object({
        concurrency: z.number().int().min(1).max(8).default(1),
        retries: z.number().int().min(0).max(10).default(1),
        scenarioTimeoutMs: z.number().int().min(100).max(300_000).default(10_000),
        totalTimeoutMs: z.number().int().min(100).max(900_000).default(60_000),
      })
      .strict()
      .default({}),
    targets: z.array(CampaignTargetSchema).min(1).max(32),
    scenarios: z.array(CampaignScenarioSchema).min(1).max(256),
    thresholds: CampaignThresholdsSchema.default({}),
  })
  .strict()
  .superRefine((campaign, context) => {
    const targetIds = new Set<string>();
    for (const [index, target] of campaign.targets.entries()) {
      if (targetIds.has(target.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targets", index, "id"],
          message: `Duplicate target id: ${target.id}`,
        });
      }
      targetIds.add(target.id);
      if (target.kind === "mcp") {
        for (const toolName of Object.keys(target.toolArguments ?? {})) {
          if (!target.allowTools.includes(toolName)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["targets", index, "toolArguments", toolName],
              message: "Tool arguments require a matching explicit allowTools entry",
            });
          }
        }
        if (containsLikelySecret(target.toolArguments ?? {})) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["targets", index, "toolArguments"],
            message: "Credential-shaped tool arguments are not permitted in campaign files",
          });
        }
        if (hasUnsafeToolArgumentPath(target.toolArguments ?? {})) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["targets", index, "toolArguments"],
            message:
              "Tool argument paths must be repository-relative or a contained {{PROJECT_ROOT}} path",
          });
        }
      }
    }
    const scenarioIds = new Set<string>();
    for (const [index, scenario] of campaign.scenarios.entries()) {
      if (scenarioIds.has(scenario.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenarios", index, "id"],
          message: `Duplicate scenario id: ${scenario.id}`,
        });
      }
      scenarioIds.add(scenario.id);
      if (!targetIds.has(scenario.target)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenarios", index, "target"],
          message: `Unknown target: ${scenario.target}`,
        });
      }
    }
  });

export type Campaign = z.infer<typeof CampaignSchema>;
export type CampaignTarget = z.infer<typeof CampaignTargetSchema>;
export type CampaignScenario = z.infer<typeof CampaignScenarioSchema>;
export type CampaignThresholds = z.infer<typeof CampaignThresholdsSchema>;
export type AdapterEvidence = z.infer<typeof AdapterEvidenceSchema>;

export const RecoveryMetricsDocumentSchema = z
  .object({
    taskCompletion: z.boolean(),
    recoverySuccess: z.boolean(),
    timeToRecoveryMs: z.number().nonnegative().nullable(),
    stepsToRecovery: z.number().int().nonnegative().nullable(),
    retryCount: z.number().int().nonnegative(),
    retryBudget: z.number().int().nonnegative(),
    retryBudgetCompliant: z.boolean(),
    repeatedCallLoopDetected: z.boolean(),
    duplicateSideEffectAttempts: z.number().int().nonnegative(),
    gracefulTermination: z.boolean(),
    fallbackCorrectness: z.boolean(),
    schemaCompliance: z.boolean(),
    safetyPolicyCompliance: z.boolean(),
    canaryLeakage: z.boolean(),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    tokenWaste: z.number().int().nonnegative().nullable(),
    latencyOverheadMs: z.number().nonnegative(),
    firstCriticalStep: z.string().nullable(),
    deterministicScore: z.number().int().min(0).max(100),
    passed: z.boolean(),
    reasons: z.array(z.string()),
  })
  .strict();

export const CampaignScenarioResultSchema = z
  .object({
    id: CampaignIdentifierSchema,
    target: CampaignIdentifierSchema,
    status: z.enum(["passed", "failed", "invalid", "cancelled"]),
    observedOutcome: z.enum(["passed", "failed", "unavailable"]),
    seed: z.number().int(),
    fault: CampaignFaultSchema,
    faultApplied: z.boolean(),
    durationMs: z.number().int().nonnegative(),
    metrics: RecoveryMetricsDocumentSchema.nullable(),
    assertionFailures: z.array(z.string()),
    targetSourceSha256: z.string().regex(SHA256).optional(),
    adapterEvidence: AdapterEvidenceSchema.optional(),
    artifactDirectory: CampaignRelativePathSchema.optional(),
    tracePath: CampaignRelativePathSchema.optional(),
    firstCriticalStep: z.string().nullable(),
    regression: z
      .object({
        status: z.enum(["not-applicable", "generated", "generation-failed"]),
        verified: z.boolean(),
        directory: CampaignRelativePathSchema.optional(),
      })
      .strict(),
    error: z.string().max(1_000).optional(),
  })
  .strict();

export const CampaignRunSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    kind: z.literal("resilireplay-campaign-run"),
    productVersion: z.enum(["0.3.0", "0.3.1", "0.4.0"]),
    campaignId: CampaignIdentifierSchema,
    campaignHash: z.string().regex(SHA256),
    runId: z.string().min(1).max(128),
    status: z.enum(["complete", "invalid", "cancelled", "incomplete"]),
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
    durationMs: z.number().int().nonnegative(),
    results: z.array(CampaignScenarioResultSchema),
    thresholds: CampaignThresholdsSchema,
    summary: z
      .object({
        passed: z.boolean(),
        total: z.number().int().nonnegative(),
        passedCount: z.number().int().nonnegative(),
        failedCount: z.number().int().nonnegative(),
        invalidCount: z.number().int().nonnegative(),
        cancelledCount: z.number().int().nonnegative(),
        faultCoverage: z.number().min(0).max(1).nullable(),
      })
      .strict(),
    telemetry: z.literal(false),
    runHash: z.string().regex(SHA256),
  })
  .strict();

export type CampaignScenarioResult = z.infer<typeof CampaignScenarioResultSchema>;
export type CampaignRun = z.infer<typeof CampaignRunSchema>;

export const CampaignBaselineScenarioSchema = z
  .object({
    id: CampaignIdentifierSchema,
    target: CampaignIdentifierSchema,
    status: z.enum(["passed", "failed"]),
    observedOutcome: z.enum(["passed", "failed"]),
    metrics: RecoveryMetricsDocumentSchema,
    targetSourceSha256: z.string().regex(SHA256).optional(),
    adapterEvidence: AdapterEvidenceSchema.optional(),
    regressionStatus: z.enum(["not-applicable", "generated", "generation-failed"]),
  })
  .strict();

export const CampaignBaselineSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    kind: z.literal("resilireplay-baseline"),
    productVersion: z.enum(["0.3.0", "0.3.1", "0.4.0"]),
    campaignId: CampaignIdentifierSchema,
    campaignHash: z.string().regex(SHA256),
    approvedAt: z.string().datetime({ offset: true }),
    sourceRunHash: z.string().regex(SHA256),
    thresholds: CampaignThresholdsSchema,
    scenarios: z.array(CampaignBaselineScenarioSchema),
    baselineHash: z.string().regex(SHA256),
  })
  .strict();

export type CampaignBaseline = z.infer<typeof CampaignBaselineSchema>;

export const ComparisonDifferenceSchema = z
  .object({
    scenarioId: CampaignIdentifierSchema.optional(),
    metric: z.string().min(1),
    baseline: z.unknown(),
    current: z.unknown(),
    threshold: z.number().nonnegative().optional(),
    severity: z.enum(["regression", "invalid"]),
    causeStep: z.string().nullable().optional(),
    message: z.string().min(1),
  })
  .strict();

export const CampaignComparisonSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    kind: z.literal("resilireplay-comparison"),
    productVersion: z.enum(["0.3.0", "0.3.1", "0.4.0"]),
    campaignId: CampaignIdentifierSchema,
    campaignHash: z.string().regex(SHA256),
    baselineHash: z.string().regex(SHA256),
    runHash: z.string().regex(SHA256),
    status: z.enum(["pass", "regression", "invalid", "incomplete"]),
    differences: z.array(ComparisonDifferenceSchema),
    comparedAt: z.string().datetime({ offset: true }),
    comparisonHash: z.string().regex(SHA256),
  })
  .strict();

export type CampaignComparison = z.infer<typeof CampaignComparisonSchema>;

export const CAMPAIGN_EXIT_CODES = {
  PASS: 0,
  REGRESSION: 1,
  USAGE: 2,
  INVALID_SCHEMA: 20,
  AUTHORIZATION: 21,
  TARGET: 22,
  INCOMPLETE: 23,
  INTEGRITY: 24,
} as const;

export class CampaignError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = CAMPAIGN_EXIT_CODES.INVALID_SCHEMA,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CampaignError";
  }
}
