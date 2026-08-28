import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
    expect(version.stdout.trim()).toBe("0.7.0");
    const faults = spawnSync(process.execPath, [cli, "faults"], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(faults.status).toBe(0);
    expect(faults.stdout).toContain("mcp-malformed-tools-list");
  });

  it("manages deterministic template artifacts", async () => {
    const list = spawnSync(process.execPath, [cli, "template", "list"], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(list.status).toBe(0);
    const entries = JSON.parse(list.stdout) as Array<{ id: string; compatibility: string }>;
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const show = spawnSync(process.execPath, [cli, "template", "show", "tool-timeout"], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(show.status).toBe(0);
    const template = JSON.parse(show.stdout) as { id: string; expectedEvidence: string[] };
    expect(template.id).toBe("tool-timeout");
    expect(template.expectedEvidence.length).toBeGreaterThan(0);

    const artifactRoot = resolve(".artifacts");
    await mkdir(artifactRoot, { recursive: true });
    const directory = await mkdtemp(join(artifactRoot, "resilireplay-template-"));
    const outputFile = join(directory, "tool-timeout.template.json");
    try {
      const copy = spawnSync(
        process.execPath,
        [cli, "template", "copy", "tool-timeout", "--output", outputFile],
        { encoding: "utf8", windowsHide: true },
      );
      expect(copy.status).toBe(0);
      expect(copy.stdout.trim()).toContain("Wrote template");
      const written = await readFile(outputFile, "utf8");
      const parsed = JSON.parse(written) as { id?: string };
      expect(parsed.id).toBe("tool-timeout");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("lists, detects, overrides, and diagnoses framework adapters", () => {
    const list = spawnSync(process.execPath, [cli, "adapter", "list"], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(list.status, list.stderr).toBe(0);
    const profiles = JSON.parse(list.stdout) as Array<{ id: string; evidenceClass: string }>;
    expect(profiles.find((profile) => profile.id === "langgraph")?.evidenceClass).toBe(
      "GENUINE_RUNTIME",
    );
    expect(profiles.find((profile) => profile.id === "crewai")?.evidenceClass).toBe(
      "DOCUMENTED_ONLY",
    );

    const detected = spawnSync(
      process.execPath,
      [cli, "adapter", "detect", "--package", "@openai/agents"],
      { encoding: "utf8", windowsHide: true },
    );
    expect(detected.status, detected.stderr).toBe(0);
    expect((JSON.parse(detected.stdout) as { profile: { id: string } }).profile.id).toBe(
      "openai-agents",
    );

    const overridden = spawnSync(
      process.execPath,
      [cli, "adapter", "detect", "--package", "@openai/agents", "--framework", "crewai"],
      { encoding: "utf8", windowsHide: true },
    );
    expect(overridden.status, overridden.stderr).toBe(0);
    expect((JSON.parse(overridden.stdout) as { profile: { id: string } }).profile.id).toBe(
      "crewai",
    );

    const doctor = spawnSync(process.execPath, [cli, "adapter", "doctor", "autogen"], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(doctor.status, doctor.stderr).toBe(0);
    expect((JSON.parse(doctor.stdout) as { status: string }).status).toBe("degraded");
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

  it("validates, runs, approves, and compares a reviewed campaign", async () => {
    const output = resolve(".artifacts", "tests", `cli-campaign-${process.pid}`);
    try {
      const validate = spawnSync(
        process.execPath,
        [cli, "campaign", "validate", "examples/studio/campaign.yml"],
        { encoding: "utf8", windowsHide: true },
      );
      expect(validate.status, validate.stderr).toBe(0);
      const hash = /Campaign hash ([a-f0-9]{64})/u.exec(validate.stdout)?.[1];
      expect(hash).toBeTruthy();

      const run = spawnSync(
        process.execPath,
        [
          cli,
          "campaign",
          "run",
          "examples/studio/campaign.yml",
          "--confirm-tools",
          hash!,
          "--output",
          output,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 30_000 },
      );
      expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
      expect(run.stdout).toContain("ResiliReplay Campaign v0.7.0");
      expect(run.stdout).toContain("Scenarios       4/4");

      const baseline = join(output, "baseline.json");
      const approve = spawnSync(
        process.execPath,
        [cli, "campaign", "approve", output, "--output", baseline],
        { encoding: "utf8", windowsHide: true },
      );
      expect(approve.status, approve.stderr).toBe(0);

      const compare = spawnSync(
        process.execPath,
        [cli, "campaign", "compare", output, "--baseline", baseline],
        { encoding: "utf8", windowsHide: true },
      );
      expect(compare.status, `${compare.stdout}\n${compare.stderr}`).toBe(0);
      expect(compare.stdout).toContain("No reliability regressions detected.");
    } finally {
      await rm(output, { recursive: true, force: true });
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
