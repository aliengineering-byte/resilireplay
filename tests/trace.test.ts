import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { hashValue, injectFaults } from "@resilireplay/core";
import {
  MAX_TRACE_EVENTS,
  compileRegression,
  identifyFirstCriticalEvent,
  parseTrace,
  serializeTrace,
} from "@resilireplay/trace";
import { failedTrace, passingTrace } from "./helpers.js";

describe("trace serialization and regression compiler", () => {
  it("rejects traces above the hard event limit before parsing their payloads", () => {
    expect(() => parseTrace("{}\n".repeat(MAX_TRACE_EVENTS + 1))).toThrow(
      `Trace exceeds ${MAX_TRACE_EVENTS} events`,
    );
  });

  it("round-trips deterministic JSONL", () => {
    const trace = passingTrace();
    expect(serializeTrace(parseTrace(serializeTrace(trace)))).toBe(serializeTrace(trace));
    expect(serializeTrace(parseTrace(serializeTrace(trace).replace(/\n/gu, "\r\n")))).toBe(
      serializeTrace(trace),
    );
  });

  it("reports malformed JSONL line numbers", () => {
    expect(() => parseTrace('{"no":"close"\n')).toThrow("line 1");
  });

  it("rejects a hash-valid credential canary before trace or regression persistence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "resilireplay-regression-secret-"));
    const secret = `sk-${"S".repeat(24)}`;
    const source = failedTrace();
    const payload = { error: secret };
    const hostile = source.map((entry, index) =>
      index === 1 ? { ...entry, payload, payloadHash: hashValue(payload) } : entry,
    );
    try {
      expect(() => serializeTrace(hostile)).toThrow("credential-shaped material");
      await expect(
        compileRegression(hostile, join(directory, "generated"), { allowedRoot: directory }),
      ).rejects.toThrow("credential-shaped material");
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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

  it("rejects a linked regression directory without writing outside the allowed root", async () => {
    const root = await mkdtemp(join(tmpdir(), "resilireplay-regression-root-"));
    const outside = await mkdtemp(join(tmpdir(), "resilireplay-regression-outside-"));
    const linked = join(root, "generated");
    try {
      try {
        await symlink(outside, linked, process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") return;
        throw error;
      }
      await expect(
        compileRegression(failedTrace(), linked, { allowedRoot: root }),
      ).rejects.toMatchObject({ code: "RR_OUTPUT_CONTAINMENT" });
      expect(await readdir(outside)).toEqual([]);

      const ordinary = await compileRegression(failedTrace(), join(root, "ordinary"), {
        allowedRoot: root,
      });
      expect(await readFile(ordinary.manifestPath, "utf8")).toContain('"status":"complete"');
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("publishes one coherent idempotent bundle under 64 concurrent writers", async () => {
    const root = await mkdtemp(join(tmpdir(), "resilireplay-regression-concurrent-"));
    const output = join(root, "generated");
    try {
      const results = await Promise.all(
        Array.from({ length: 64 }, () =>
          compileRegression(failedTrace(), output, { allowedRoot: root }),
        ),
      );
      expect(new Set(results.map((result) => result.sourceTraceHash)).size).toBe(1);
      const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8")) as {
        status: string;
        sourceTraceSha256: string;
      };
      expect(manifest).toMatchObject({
        status: "complete",
        sourceTraceSha256: results[0]?.sourceTraceHash,
      });
      expect((await readdir(output)).filter((name) => name.startsWith(".resilireplay-"))).toEqual(
        [],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("cleans partially published files when the manifest publish stage conflicts", async () => {
    const root = await mkdtemp(join(tmpdir(), "resilireplay-regression-interrupted-"));
    const output = join(root, "generated");
    try {
      await mkdir(output);
      await writeFile(join(output, "manifest.json"), "corrupt-negative-control\n", "utf8");
      await expect(compileRegression(failedTrace(), output, { allowedRoot: root })).rejects.toThrow(
        "refusing to overwrite",
      );
      expect(await readdir(output)).toEqual(["manifest.json"]);
      expect(await readFile(join(output, "manifest.json"), "utf8")).toBe(
        "corrupt-negative-control\n",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
