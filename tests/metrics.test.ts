import { describe, expect, it } from "vitest";
import { calculateMetrics, injectFaults, SAFE_CANARY } from "@resilireplay/core";
import { event, failedTrace, passingTrace } from "./helpers.js";

describe("deterministic recovery metrics", () => {
  it("passes a valid completed trace", () => {
    const metrics = calculateMetrics(passingTrace());
    expect(metrics.passed).toBe(true);
    expect(metrics.deterministicScore).toBe(100);
  });

  it("finds the first unrecovered fault", () => {
    const source = failedTrace();
    const result = injectFaults(source, {
      schemaVersion: "1.0",
      id: "broken",
      description: "unrecovered corruption",
      seed: 2,
      rules: [
        {
          fault: "malformed-json",
          event: "model_response",
          occurrence: 1,
          probability: 1,
          parameters: {},
        },
      ],
    });
    const metrics = calculateMetrics(result.events);
    expect(metrics.recoverySuccess).toBe(false);
    expect(metrics.firstCriticalStep).toBe("step-1");
    expect(metrics.reasons.join(" ")).toMatch(/no successful recovery/i);
  });

  it("enforces retry and loop budgets", () => {
    const trace = [
      event(0, "run_started"),
      event(1, "retry", { same: true }),
      event(2, "retry", { same: true }),
      event(3, "retry", { same: true }),
      event(4, "retry", { same: true }),
      event(5, "run_failed"),
    ];
    const metrics = calculateMetrics(trace, { retryBudget: 3 });
    expect(metrics.retryBudgetCompliant).toBe(false);
    expect(metrics.repeatedCallLoopDetected).toBe(true);
  });

  it("detects duplicate side-effect attempts", () => {
    const trace = [
      event(0, "run_started"),
      event(1, "tool_requested", { amount: 5 }, { tool: "charge" }),
      event(2, "tool_requested", { amount: 5 }, { tool: "charge" }),
      event(3, "run_failed"),
    ];
    const metrics = calculateMetrics(trace);
    expect(metrics.duplicateSideEffectAttempts).toBe(1);
  });

  it("flags outward canary leakage but not an injected inbound tool result", () => {
    const inbound = [
      event(0, "run_started"),
      event(
        1,
        "tool_result",
        { text: SAFE_CANARY },
        {
          fault: {
            scenarioId: "canary",
            faultType: "mcp-malicious-canary-instruction",
            seed: 42,
            applicationIndex: 0,
            originalPayloadHash: "a".repeat(64),
            details: {},
          },
        },
      ),
      event(2, "run_completed"),
    ];
    expect(calculateMetrics(inbound).canaryLeakage).toBe(false);
    const outward = [
      event(0, "run_started"),
      event(1, "model_response", { text: SAFE_CANARY }),
      event(2, "run_completed"),
    ];
    expect(calculateMetrics(outward).canaryLeakage).toBe(true);
  });

  it("accounts for token waste and injected latency", () => {
    const trace = [
      event(0, "run_started"),
      event(1, "retry", {}, { metadata: { inputTokens: 10, outputTokens: 2 } }),
      event(2, "run_failed"),
    ];
    const metrics = calculateMetrics(trace);
    expect(metrics.tokenWaste).toBe(12);
  });
});
