import { describe, expect, it } from "vitest";
import {
  BUILTIN_SCENARIOS,
  FAULT_TYPES,
  FaultScenarioSchema,
  injectFaults,
  scenarioHash,
  validateTrace,
  withDisposableMissingFileFixture,
} from "@resilireplay/core";
import { event, passingTrace } from "./helpers.js";

describe("deterministic fault engine", () => {
  it("repeats byte-identical mutations for the same seed", () => {
    const first = injectFaults(passingTrace(), BUILTIN_SCENARIOS["rate-limit"]!);
    const second = injectFaults(passingTrace(), BUILTIN_SCENARIOS["rate-limit"]!);
    expect(first.traceHash).toBe(second.traceHash);
    expect(first.events).toEqual(second.events);
  });

  it("supports every declared generic and MCP fault type", () => {
    for (const fault of FAULT_TYPES) {
      const source = [event(0, "model_response", { answer: "original" })];
      const scenario = FaultScenarioSchema.parse({
        id: `test-${fault}`,
        description: `Exercise ${fault}`,
        seed: 7,
        rules: [{ fault, event: "model_response" }],
      });
      const result = injectFaults(source, scenario);
      expect(result.applied, fault).toHaveLength(1);
      expect(
        result.events.some((entry) => entry.fault?.faultType === fault),
        fault,
      ).toBe(true);
      expect(() => validateTrace(result.events), fault).not.toThrow();
    }
  });

  it("respects occurrence selectors", () => {
    const source = [
      event(0, "model_response", { value: 1 }),
      event(1, "model_response", { value: 2 }),
    ];
    const scenario = FaultScenarioSchema.parse({
      id: "second",
      description: "second occurrence",
      rules: [{ fault: "malformed-json", event: "model_response", occurrence: 2 }],
    });
    const result = injectFaults(source, scenario);
    expect(result.events[0]?.fault).toBeUndefined();
    expect(result.events[1]?.fault?.faultType).toBe("malformed-json");
  });

  it("creates only disposable missing-file fixtures", async () => {
    let root = "";
    await withDisposableMissingFileFixture(async (missing, fixtureRoot) => {
      root = fixtureRoot;
      expect(missing.startsWith(fixtureRoot)).toBe(true);
      await expect(
        import("node:fs/promises").then(({ access }) => access(missing)),
      ).rejects.toThrow();
    });
    await expect(import("node:fs/promises").then(({ access }) => access(root))).rejects.toThrow();
  });

  it("hashes scenarios deterministically", () => {
    expect(scenarioHash(BUILTIN_SCENARIOS["rate-limit"]!)).toMatch(/^[a-f0-9]{64}$/u);
  });
});
