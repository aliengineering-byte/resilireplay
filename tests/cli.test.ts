import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { recordCommand } from "../packages/cli/src/record.js";
import { readTrace } from "@resilireplay/trace";

const cli = resolve("packages/cli/dist/bin.js");

describe("CLI end to end and subprocess safety", () => {
  it("prints version and the fault catalog", () => {
    const version = spawnSync(process.execPath, [cli, "--version"], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe("0.2.1");
    const faults = spawnSync(process.execPath, [cli, "faults"], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(faults.status).toBe(0);
    expect(faults.stdout).toContain("mcp-malformed-tools-list");
  });

  it("records a real local agent command", async () => {
    const directory = await mkdtemp(join(tmpdir(), "resilireplay-record-"));
    try {
      const output = join(directory, "trace.jsonl");
      const agent = resolve("examples/deterministic-agent/dist/index.js");
      const result = await recordCommand([process.execPath, agent], output, 5_000);
      expect(result.exitCode).toBe(0);
      const trace = await readTrace(output);
      expect(trace.some((entry) => entry.type === "tool_result")).toBe(true);
      expect(trace.at(-1)?.type).toBe("run_completed");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("times out and cleans up a subprocess tree", async () => {
    const directory = await mkdtemp(join(tmpdir(), "resilireplay-timeout-"));
    try {
      const output = join(directory, "trace.jsonl");
      const started = Date.now();
      const result = await recordCommand(
        [process.execPath, "-e", "setInterval(() => {}, 1000)"],
        output,
        250,
      );
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(result.events.at(-1)?.type).toBe("run_failed");
      expect(await readFile(output, "utf8")).toContain('"timedOut":true');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
