import { hashValue, sanitize } from "@resilireplay/core";
import { z } from "zod";

export const DeterministicStatusSchema = z.enum(["passed", "failed", "error"]);
export type DeterministicStatus = z.infer<typeof DeterministicStatusSchema>;

export const SemanticAdvisoryResultSchema = z
  .object({
    providerId: z.string().min(1),
    rubricVersion: z.string().min(1),
    evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    status: z.enum(["disabled", "completed", "error"]),
    score: z.number().finite().optional(),
    notes: z.string().max(2_000).optional(),
  })
  .strict();
export type SemanticAdvisoryResult = z.infer<typeof SemanticAdvisoryResultSchema>;

export interface SemanticAdvisorInput {
  rubricVersion: string;
  evidenceDigest: string;
  sanitizedEvidence: unknown;
}

export interface SemanticAdvisor {
  readonly providerId: string;
  evaluate(input: SemanticAdvisorInput): Promise<Omit<SemanticAdvisoryResult, "providerId">>;
}

export interface PolicyDecision {
  deterministicStatus: DeterministicStatus;
  semanticAdvisory: SemanticAdvisoryResult;
  finalPolicyStatus: DeterministicStatus;
}

export interface SemanticAdvisoryOptions {
  enabled?: boolean;
  rubricVersion?: string;
  advisor?: SemanticAdvisor;
}

export async function evaluateSemanticAdvisory(
  deterministicStatusInput: DeterministicStatus,
  evidence: unknown,
  options: SemanticAdvisoryOptions = {},
): Promise<PolicyDecision> {
  const deterministicStatus = DeterministicStatusSchema.parse(deterministicStatusInput);
  const sanitizedEvidence = sanitize(evidence);
  const evidenceDigest = hashValue(sanitizedEvidence);
  if (options.enabled !== true) {
    return {
      deterministicStatus,
      semanticAdvisory: {
        providerId: "disabled",
        rubricVersion: options.rubricVersion ?? "none",
        evidenceDigest,
        status: "disabled",
      },
      finalPolicyStatus: deterministicStatus,
    };
  }
  if (options.advisor === undefined) {
    throw new Error("Semantic advisory was enabled without an advisor plugin.");
  }
  const rubricVersion = options.rubricVersion ?? "1";
  const result = SemanticAdvisoryResultSchema.parse({
    providerId: options.advisor.providerId,
    ...(await options.advisor.evaluate({ rubricVersion, evidenceDigest, sanitizedEvidence })),
  });
  return {
    deterministicStatus,
    semanticAdvisory: result,
    finalPolicyStatus: deterministicStatus,
  };
}
