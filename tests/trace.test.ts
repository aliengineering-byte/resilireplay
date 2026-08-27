import { constants } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { hashValue, injectFaults } from "@resilireplay/core";
import {
  MAX_TRACE_EVENTS,
  MAX_TRACE_NESTING_DEPTH,
  compileRegression,
  identifyFirstCriticalEvent,
  parseTrace,
  serializeTrace,
} from "@resilireplay/trace";
import { event, failedTrace, passingTrace } from "./helpers.js";

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
    try {
      parseTrace('{"no":"close"\n');
      throw new Error("expected invalid JSONL to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "RR_TRACE_INVALID_JSONL" });
      expect((error as Error).message).toContain("line 1");
    }
  });

  it("accepts the trace nesting boundary and rejects one level beyond it", () => {
    const nestedPayload = (levels: number): unknown => {
      let value: unknown = "leaf";
      for (let level = 0; level < levels; level += 1) value = { child: value };
      return value;
    };
    const accepted = event(0, "run_started", nestedPayload(MAX_TRACE_NESTING_DEPTH - 1));
    expect(parseTrace(serializeTrace([accepted]))).toHaveLength(1);

    const rejected = event(0, "run_started", nestedPayload(MAX_TRACE_NESTING_DEPTH));
    expect(() => parseTrace(serializeTrace([rejected]))).toThrow(
      `Trace exceeds nesting depth ${MAX_TRACE_NESTING_DEPTH}`,
    );
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

  it("publishes one coherent idempotent bundle under 64 fallback-copy writers", async () => {
    const root = await mkdtemp(join(tmpdir(), "resilireplay-regression-concurrent-"));
    const output = join(root, "generated");
    try {
      const results = await Promise.all(
        Array.from({ length: 64 }, () =>
          compileRegression(failedTrace(), output, {
            allowedRoot: root,
            publicationOperations: {
              link: async () => {
                throw Object.assign(new Error("hard links unsupported"), { code: "EXDEV" });
              },
            },
          }),
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

  it("falls back from unsupported hard links to verified exclusive copies", async () => {
    const root = await mkdtemp(join(tmpdir(), "resilireplay-regression-copy-"));
    try {
      const result = await compileRegression(failedTrace(), join(root, "generated"), {
        allowedRoot: root,
        publicationOperations: {
          link: async () => {
            throw Object.assign(new Error("hard links unsupported"), { code: "ENOTSUP" });
          },
        },
      });
      expect(await readFile(result.manifestPath, "utf8")).toContain('"status":"complete"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses an exclusive-copy conflict without changing the existing artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "resilireplay-regression-copy-conflict-"));
    const output = join(root, "generated");
    const scenario = join(output, "scenario.yaml");
    try {
      await mkdir(output);
      await writeFile(scenario, "existing-mismatch\n", "utf8");
      await expect(
        compileRegression(failedTrace(), output, {
          allowedRoot: root,
          publicationOperations: {
            link: async () => {
              throw Object.assign(new Error("hard links unsupported"), { code: "EXDEV" });
            },
          },
        }),
      ).rejects.toMatchObject({ code: "RR_REGRESSION_CONFLICT" });
      expect(await readFile(scenario, "utf8")).toBe("existing-mismatch\n");
      expect(await readdir(output)).toEqual(["scenario.yaml"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes a partial exclusive copy after an injected copy failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "resilireplay-regression-copy-partial-"));
    const output = join(root, "generated");
    try {
      await expect(
        compileRegression(failedTrace(), output, {
          allowedRoot: root,
          publicationOperations: {
            link: async () => {
              throw Object.assign(new Error("hard links unsupported"), { code: "EXDEV" });
            },
            copyFileExclusive: async (_source, destination) => {
              await writeFile(destination, "partial", { flag: "wx" });
              throw Object.assign(new Error("injected partial copy failure"), { code: "EIO" });
            },
          },
        }),
      ).rejects.toMatchObject({ code: "RR_REGRESSION_PUBLISH" });
      expect(await readdir(output)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes copied artifacts when manifest-last publication fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "resilireplay-regression-manifest-failure-"));
    const output = join(root, "generated");
    try {
      await expect(
        compileRegression(failedTrace(), output, {
          allowedRoot: root,
          publicationOperations: {
            link: async () => {
              throw Object.assign(new Error("hard links unsupported"), { code: "EXDEV" });
            },
            copyFileExclusive: async (source, destination) => {
              if (destination.endsWith("manifest.json")) {
                throw Object.assign(new Error("injected manifest failure"), { code: "EIO" });
              }
              await copyFile(source, destination, constants.COPYFILE_EXCL);
            },
          },
        }),
      ).rejects.toMatchObject({ code: "RR_REGRESSION_PUBLISH" });
      expect(await readdir(output)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports cleanup failure without publishing a completion manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "resilireplay-regression-cleanup-failure-"));
    const output = join(root, "generated");
    try {
      await expect(
        compileRegression(failedTrace(), output, {
          allowedRoot: root,
          publicationOperations: {
            link: async () => {
              throw Object.assign(new Error("hard links unsupported"), { code: "EXDEV" });
            },
            copyFileExclusive: async (source, destination) => {
              if (destination.endsWith("manifest.json")) {
                throw Object.assign(new Error("injected manifest failure"), { code: "EIO" });
              }
              await copyFile(source, destination, constants.COPYFILE_EXCL);
            },
            remove: async (path) => {
              if (path.endsWith("scenario.yaml")) {
                throw Object.assign(new Error("injected cleanup failure"), { code: "EACCES" });
              }
              await rm(path, { force: true });
            },
          },
        }),
      ).rejects.toMatchObject({ code: "RR_REGRESSION_CLEANUP" });
      expect(await readdir(output)).toEqual(["scenario.yaml"]);
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
