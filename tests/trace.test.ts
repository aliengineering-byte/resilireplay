import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { injectFaults } from "@resilireplay/core";
import {
  compileRegression,
  identifyFirstCriticalEvent,
  parseTrace,
  serializeTrace,
} from "@resilireplay/trace";
import { failedTrace, passingTrace } from "./helpers.js";

describe("trace serialization and regression compiler", () => {
  it("round-trips deterministic JSONL", () => {
    const trace = passingTrace();
    expect(serializeTrace(parseTrace(serializeTrace(trace)))).toBe(serializeTrace(trace));
  });

  it("reports malformed JSONL line numbers", () => {
    expect(() => parseTrace('{"no":"close"\n')).toThrow("line 1");
  });

  it("identifies the first injected divergence", () => {
    const result = injectFaults(failedTrace(), {
      schemaVersion: "1.0",
      id: "first",
      description: "first divergence",
      seed: 42,
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
    expect(identifyFirstCriticalEvent(result.events).stepId).toBe("step-1");
  });

  it("generates and verifies an executable minimized regression", async () => {
    const directory = await mkdtemp(join(tmpdir(), "resilireplay-regression-"));
    try {
      const result = injectFaults(failedTrace(), {
        schemaVersion: "1.0",
        id: "compile",
        description: "compile this failure",
        seed: 42,
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
      const artifacts = await compileRegression(result.events, directory);
      expect(artifacts.minimizedEventCount).toBeLessThan(artifacts.sourceEventCount);
      expect(artifacts.sourceTraceHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(await readFile(artifacts.scenarioPath, "utf8")).toContain("sourceTraceSha256");
      const execution = spawnSync(process.execPath, ["--test", artifacts.testPath], {
        cwd: directory,
        encoding: "utf8",
        windowsHide: true,
      });
      expect(execution.status, execution.stderr).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
