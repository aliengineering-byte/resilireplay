import { readFile, writeFile } from "node:fs/promises";
import { stableStringify, sha256 } from "@resilireplay/core";
import {
  CAMPAIGN_EXIT_CODES,
  CampaignBaselineSchema,
  CampaignComparisonSchema,
  CampaignError,
  type CampaignBaseline,
  type CampaignComparison,
  type CampaignRun,
} from "./schemas.js";
import { verifyCampaignRun } from "./runner.js";

function baselineContent(value: Omit<CampaignBaseline, "baselineHash">): string {
  return stableStringify(value);
}

export function verifyCampaignBaseline(value: unknown): CampaignBaseline {
  const baseline = CampaignBaselineSchema.parse(value);
  const { baselineHash: stored, ...withoutHash } = baseline;
  const actual = sha256(baselineContent(withoutHash as Omit<CampaignBaseline, "baselineHash">));
  if (actual !== stored) {
    throw new CampaignError(
      "Campaign baseline integrity hash mismatch",
      CAMPAIGN_EXIT_CODES.INTEGRITY,
    );
  }
  return baseline;
}

export function approveCampaignBaseline(runInput: CampaignRun): CampaignBaseline {
  const run = verifyCampaignRun(runInput);
  if (run.status !== "complete" || !run.summary.passed) {
    throw new CampaignError(
      "Only a complete, expectation-passing campaign run can be approved as a baseline.",
      run.status === "complete" ? CAMPAIGN_EXIT_CODES.REGRESSION : CAMPAIGN_EXIT_CODES.INCOMPLETE,
    );
  }
  const scenarios = run.results.map((result) => {
    if (
      result.metrics === null ||
      result.observedOutcome === "unavailable" ||
      (result.status !== "passed" && result.status !== "failed")
    ) {
      throw new CampaignError(
        `Scenario ${result.id} does not contain complete baseline evidence.`,
        CAMPAIGN_EXIT_CODES.INCOMPLETE,
      );
    }
    return {
      id: result.id,
      target: result.target,
      status: result.status,
      observedOutcome: result.observedOutcome,
      metrics: result.metrics,
      ...(result.targetSourceSha256 ? { targetSourceSha256: result.targetSourceSha256 } : {}),
      ...(result.adapterEvidence ? { adapterEvidence: result.adapterEvidence } : {}),
      regressionStatus: result.regression.status,
    };
  });
  const withoutHash: Omit<CampaignBaseline, "baselineHash"> = {
    schemaVersion: "1.0",
    kind: "resilireplay-baseline",
    productVersion: "0.4.0",
    campaignId: run.campaignId,
    campaignHash: run.campaignHash,
    approvedAt: new Date().toISOString(),
    sourceRunHash: run.runHash,
    thresholds: run.thresholds,
    scenarios,
  };
  return CampaignBaselineSchema.parse({
    ...withoutHash,
    baselineHash: sha256(baselineContent(withoutHash)),
  });
}

export async function writeCampaignBaseline(
  baselineInput: CampaignBaseline,
  path: string,
): Promise<void> {
  const baseline = verifyCampaignBaseline(baselineInput);
  await writeFile(path, `${stableStringify(baseline)}\n`, { encoding: "utf8", flag: "wx" });
}

export async function loadCampaignBaseline(path: string): Promise<CampaignBaseline> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new CampaignError(
      `Unable to read campaign baseline: ${error instanceof Error ? error.message : String(error)}`,
      CAMPAIGN_EXIT_CODES.INVALID_SCHEMA,
      { cause: error },
    );
  }
  return verifyCampaignBaseline(value);
}

type Difference = CampaignComparison["differences"][number];

function regression(
  differences: Difference[],
  scenarioId: string,
  metric: string,
  baseline: unknown,
  current: unknown,
  message: string,
  causeStep: string | null,
  threshold?: number,
): void {
  differences.push({
    scenarioId,
    metric,
    baseline,
    current,
    ...(threshold === undefined ? {} : { threshold }),
    severity: "regression",
    causeStep,
    message,
  });
}

function invalid(
  differences: Difference[],
  metric: string,
  baseline: unknown,
  current: unknown,
  message: string,
  scenarioId?: string,
): void {
  differences.push({
    ...(scenarioId ? { scenarioId } : {}),
    metric,
    baseline,
    current,
    severity: "invalid",
    message,
  });
}

function comparisonContent(value: Omit<CampaignComparison, "comparisonHash">): string {
  return stableStringify(value);
}

export function verifyCampaignComparison(value: unknown): CampaignComparison {
  const comparison = CampaignComparisonSchema.parse(value);
  const { comparisonHash: stored, ...withoutHash } = comparison;
  if (
    sha256(comparisonContent(withoutHash as Omit<CampaignComparison, "comparisonHash">)) !== stored
  ) {
    throw new CampaignError(
      "Campaign comparison integrity hash mismatch",
      CAMPAIGN_EXIT_CODES.INTEGRITY,
    );
  }
  return comparison;
}

export function compareCampaignRun(
  runInput: CampaignRun,
  baselineInput: CampaignBaseline,
): CampaignComparison {
  const run = verifyCampaignRun(runInput);
  const baseline = verifyCampaignBaseline(baselineInput);
  const differences: Difference[] = [];
  if (run.campaignHash !== baseline.campaignHash || run.campaignId !== baseline.campaignId) {
    invalid(
      differences,
      "campaignHash",
      baseline.campaignHash,
      run.campaignHash,
      "Run and baseline describe different campaign definitions.",
    );
  }
  if (run.status !== "complete") {
    invalid(
      differences,
      "runStatus",
      "complete",
      run.status,
      "An invalid, cancelled, or incomplete run cannot pass comparison.",
    );
  }

  const currentById = new Map(run.results.map((result) => [result.id, result]));
  for (const expected of baseline.scenarios) {
    const current = currentById.get(expected.id);
    if (!current) {
      invalid(
        differences,
        "scenarioPresence",
        "present",
        "missing",
        "Baseline scenario is missing from the current run.",
        expected.id,
      );
      continue;
    }
    if (current.metrics === null || current.observedOutcome === "unavailable") {
      invalid(
        differences,
        "scenarioEvidence",
        "complete",
        "unavailable",
        "Scenario has no comparable metrics.",
        expected.id,
      );
      continue;
    }
    if (current.status === "invalid" || current.status === "cancelled") {
      invalid(
        differences,
        "scenarioStatus",
        expected.status,
        current.status,
        "Invalid or cancelled scenario evidence cannot pass comparison.",
        expected.id,
      );
      continue;
    }
    if (
      expected.targetSourceSha256 !== undefined &&
      current.targetSourceSha256 !== expected.targetSourceSha256
    ) {
      invalid(
        differences,
        "targetSourceSha256",
        expected.targetSourceSha256,
        current.targetSourceSha256 ?? null,
        "Reviewed target/configuration evidence changed; approve a new baseline deliberately.",
        expected.id,
      );
      continue;
    }
    const cause = current.firstCriticalStep;
    if (current.status !== expected.status) {
      regression(
        differences,
        expected.id,
        "scenarioStatus",
        expected.status,
        current.status,
        "Scenario expectation status regressed.",
        cause,
      );
    }
    if (current.observedOutcome !== expected.observedOutcome) {
      regression(
        differences,
        expected.id,
        "observedOutcome",
        expected.observedOutcome,
        current.observedOutcome,
        "Observed target outcome changed from the approved control.",
        cause,
      );
    }
    for (const metric of [
      "taskCompletion",
      "recoverySuccess",
      "retryBudgetCompliant",
      "gracefulTermination",
      "fallbackCorrectness",
      "schemaCompliance",
      "safetyPolicyCompliance",
    ] as const) {
      if (expected.metrics[metric] && !current.metrics[metric]) {
        regression(
          differences,
          expected.id,
          metric,
          expected.metrics[metric],
          current.metrics[metric],
          `${metric} changed from passing to failing.`,
          cause,
        );
      }
    }
    if (!expected.metrics.repeatedCallLoopDetected && current.metrics.repeatedCallLoopDetected) {
      regression(
        differences,
        expected.id,
        "repeatedCallLoopDetected",
        false,
        true,
        "A repeated call loop appeared.",
        cause,
      );
    }

    const scoreDrop = expected.metrics.deterministicScore - current.metrics.deterministicScore;
    if (scoreDrop > baseline.thresholds.maxScoreDrop) {
      regression(
        differences,
        expected.id,
        "deterministicScore",
        expected.metrics.deterministicScore,
        current.metrics.deterministicScore,
        `Recovery score dropped by ${scoreDrop}.`,
        cause,
        baseline.thresholds.maxScoreDrop,
      );
    }
    const retryIncrease = current.metrics.retryCount - expected.metrics.retryCount;
    if (retryIncrease > baseline.thresholds.maxRetryIncrease) {
      regression(
        differences,
        expected.id,
        "retryCount",
        expected.metrics.retryCount,
        current.metrics.retryCount,
        `Retry count increased by ${retryIncrease}.`,
        cause,
        baseline.thresholds.maxRetryIncrease,
      );
    }
    const duplicateIncrease =
      current.metrics.duplicateSideEffectAttempts - expected.metrics.duplicateSideEffectAttempts;
    if (duplicateIncrease > baseline.thresholds.maxDuplicateSideEffectIncrease) {
      regression(
        differences,
        expected.id,
        "duplicateSideEffectAttempts",
        expected.metrics.duplicateSideEffectAttempts,
        current.metrics.duplicateSideEffectAttempts,
        `Duplicate side-effect attempts increased by ${duplicateIncrease}.`,
        cause,
        baseline.thresholds.maxDuplicateSideEffectIncrease,
      );
    }
    if (
      baseline.thresholds.maxRecoveryLatencyIncreaseMs !== undefined &&
      expected.metrics.timeToRecoveryMs !== null &&
      current.metrics.timeToRecoveryMs !== null
    ) {
      const increase = current.metrics.timeToRecoveryMs - expected.metrics.timeToRecoveryMs;
      if (increase > baseline.thresholds.maxRecoveryLatencyIncreaseMs) {
        regression(
          differences,
          expected.id,
          "timeToRecoveryMs",
          expected.metrics.timeToRecoveryMs,
          current.metrics.timeToRecoveryMs,
          `Recovery latency increased by ${increase}ms.`,
          cause,
          baseline.thresholds.maxRecoveryLatencyIncreaseMs,
        );
      }
    }
    if (
      baseline.thresholds.maxTokenWasteIncrease !== undefined &&
      expected.metrics.tokenWaste !== null &&
      current.metrics.tokenWaste !== null
    ) {
      const increase = current.metrics.tokenWaste - expected.metrics.tokenWaste;
      if (increase > baseline.thresholds.maxTokenWasteIncrease) {
        regression(
          differences,
          expected.id,
          "tokenWaste",
          expected.metrics.tokenWaste,
          current.metrics.tokenWaste,
          `Evidence-supplied token waste increased by ${increase}.`,
          cause,
          baseline.thresholds.maxTokenWasteIncrease,
        );
      }
    }
    if (
      baseline.thresholds.maxCostIncreaseUsd !== undefined &&
      expected.adapterEvidence?.costUsd !== undefined &&
      current.adapterEvidence?.costUsd !== undefined
    ) {
      const increase = current.adapterEvidence.costUsd - expected.adapterEvidence.costUsd;
      if (increase > baseline.thresholds.maxCostIncreaseUsd) {
        regression(
          differences,
          expected.id,
          "costUsd",
          expected.adapterEvidence.costUsd,
          current.adapterEvidence.costUsd,
          `Adapter-supplied cost increased by ${increase}.`,
          cause,
          baseline.thresholds.maxCostIncreaseUsd,
        );
      }
    }
    if (expected.regressionStatus === "generated" && current.regression.status !== "generated") {
      regression(
        differences,
        expected.id,
        "generatedRegressionStatus",
        expected.regressionStatus,
        current.regression.status,
        "A previously generated executable regression is no longer available.",
        cause,
      );
    }
  }

  for (const result of run.results) {
    if (!baseline.scenarios.some((scenario) => scenario.id === result.id)) {
      invalid(
        differences,
        "scenarioPresence",
        "absent",
        "present",
        "Current run contains a scenario not represented by this baseline.",
        result.id,
      );
    }
  }

  const invalidEvidence = differences.some((difference) => difference.severity === "invalid");
  const hasRegression = differences.some((difference) => difference.severity === "regression");
  const status: CampaignComparison["status"] =
    run.status === "cancelled" || run.status === "incomplete"
      ? "incomplete"
      : invalidEvidence
        ? "invalid"
        : hasRegression
          ? "regression"
          : "pass";
  const withoutHash: Omit<CampaignComparison, "comparisonHash"> = {
    schemaVersion: "1.0",
    kind: "resilireplay-comparison",
    productVersion: "0.4.0",
    campaignId: baseline.campaignId,
    campaignHash: run.campaignHash,
    baselineHash: baseline.baselineHash,
    runHash: run.runHash,
    status,
    differences,
    comparedAt: new Date().toISOString(),
  };
  return CampaignComparisonSchema.parse({
    ...withoutHash,
    comparisonHash: sha256(comparisonContent(withoutHash)),
  });
}

export async function writeCampaignComparison(
  comparisonInput: CampaignComparison,
  path: string,
): Promise<void> {
  const comparison = verifyCampaignComparison(comparisonInput);
  await writeFile(path, `${stableStringify(comparison)}\n`, "utf8");
}
