import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CampaignRelativePathSchema,
  CampaignRunSchema,
  CampaignSchema,
  approveCampaignBaseline,
  campaignHash,
  compareCampaignRun,
  loadCampaignFile,
  runCampaign,
  verifyCampaignRun,
  writeCampaignBaseline,
  type Campaign,
  type CampaignRun,
} from "@resilireplay/campaign";
import { createEvent, sanitize, sha256, stableStringify } from "@resilireplay/core";
import { writeTrace } from "@resilireplay/trace";

const root = resolve(".");

async function tempDirectory(prefix: string): Promise<string> {
  const artifacts = resolve(".artifacts");
  await mkdir(artifacts, { recursive: true });
  return mkdtemp(join(artifacts, prefix));
}

function traceCampaign(trace: string): Campaign {
  return CampaignSchema.parse({
    schemaVersion: "1.0",
    kind: "resilireplay-campaign",
    id: "deterministic-trace",
    description: "Deterministic trace campaign test.",
    seed: 17,
    budgets: {
      concurrency: 2,
      retries: 1,
      scenarioTimeoutMs: 5_000,
      totalTimeoutMs: 20_000,
    },
    targets: [{ id: "agent", kind: "trace", trace }],
    scenarios: [
      {
        id: "negative-control",
        target: "agent",
        fault: "none",
        recovery: "none",
        assertions: { outcome: "passed" },
      },
      {
        id: "malformed-response",
        target: "agent",
        fault: "malformed-json",
        event: "model_response",
        recovery: "none",
        assertions: { outcome: "failed" },
      },
    ],
    thresholds: {
      maxScoreDrop: 0,
      maxRetryIncrease: 0,
      maxDuplicateSideEffectIncrease: 0,
    },
  });
}

function rehashRun(run: CampaignRun, changes: Partial<CampaignRun>): CampaignRun {
  const { runHash: _oldHash, ...base } = run;
  const changed = { ...base, ...changes } as Omit<CampaignRun, "runHash">;
  return CampaignRunSchema.parse({ ...changed, runHash: sha256(stableStringify(changed)) });
}

describe("campaign schema, runner, and baselines", () => {
  it("rejects unsupported versions, traversal, duplicates, aliases, and hostile bounded fuzz", async () => {
    expect(
      CampaignSchema.safeParse({
        schemaVersion: "2.0",
        kind: "resilireplay-campaign",
      }).success,
    ).toBe(false);
    for (const hostile of ["../secret", "a/../../secret", "C:\\secret", "/etc/passwd", "x\0y"]) {
      expect(CampaignRelativePathSchema.safeParse(hostile).success).toBe(false);
    }
    const duplicate = traceCampaign("runs/latest/trace.jsonl");
    expect(
      CampaignSchema.safeParse({
        ...duplicate,
        targets: [duplicate.targets[0], duplicate.targets[0]],
      }).success,
    ).toBe(false);

    const mcpCampaign = (argumentPath: string) => ({
      ...duplicate,
      targets: [
        {
          id: "agent",
          kind: "mcp",
          inspectorConfig: "mcp.json",
          server: "fixture",
          allowTools: ["read_fixture"],
          toolArguments: { read_fixture: { path: argumentPath } },
          evidenceMode: "metadata-only",
        },
      ],
    });
    for (const unsafe of ["../secret", "C:\\secret", "/etc/passwd", "$HOME/secret"]) {
      expect(CampaignSchema.safeParse(mcpCampaign(unsafe)).success).toBe(false);
    }
    expect(
      CampaignSchema.safeParse(mcpCampaign("{{PROJECT_ROOT}}/fixtures/public.json")).success,
    ).toBe(true);
    expect(CampaignSchema.safeParse(mcpCampaign("{{PROJECT_ROOT}}/../secret")).success).toBe(false);

    const directory = await tempDirectory("campaign-hostile-");
    try {
      const aliasPath = join(directory, "alias.yml");
      await writeFile(
        aliasPath,
        'schemaVersion: "1.0"\nkind: resilireplay-campaign\nid: aliases\ndescription: aliases\ntargets: &targets [{id: x, kind: trace, trace: x.jsonl}]\nscenarios: *targets\n',
        "utf8",
      );
      await expect(loadCampaignFile(aliasPath, root)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }

    let state = 123_456_789;
    for (let index = 0; index < 500; index += 1) {
      state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
      const candidate = String.fromCharCode(
        ...Array.from({ length: state % 24 }, (_, offset) => (state >>> offset % 16) & 0x7f),
      );
      expect(() => CampaignRelativePathSchema.safeParse(candidate)).not.toThrow();
      const sanitized = sanitize({ authorization: candidate, nested: `Bearer ${"x".repeat(24)}` });
      expect(sanitized.authorization).toBe("[REDACTED]");
      expect(sanitized.nested).toBe("[REDACTED]");
    }
  });

  it("runs in stable order, repeats deterministically, approves a baseline, and detects regression", async () => {
    const directory = await tempDirectory("campaign-repeatability-");
    try {
      const tracePath = join(directory, "source.jsonl");
      const relativeTrace = tracePath.slice(root.length + 1).replaceAll("\\", "/");
      await writeTrace(tracePath, [
        createEvent({
          runId: "repeatable-run",
          stepId: "start",
          sequence: 0,
          timestamp: "2026-01-01T00:00:00.000Z",
          type: "run_started",
          actor: "fixture",
          payload: {},
        }),
        createEvent({
          runId: "repeatable-run",
          stepId: "response",
          parentId: "start",
          sequence: 1,
          timestamp: "2026-01-01T00:00:00.010Z",
          type: "model_response",
          actor: "fixture",
          payload: { answer: 4 },
        }),
        createEvent({
          runId: "repeatable-run",
          stepId: "complete",
          parentId: "response",
          sequence: 2,
          timestamp: "2026-01-01T00:00:00.020Z",
          type: "run_completed",
          actor: "fixture",
          payload: { answer: 4 },
        }),
      ]);
      const campaign = traceCampaign(relativeTrace);
      expect(campaignHash(campaign)).toMatch(/^[a-f0-9]{64}$/u);
      const first = await runCampaign(campaign, {
        rootDirectory: root,
        outputDirectory: `${relativeTrace}.run-one`,
      });
      await expect(
        runCampaign(campaign, {
          rootDirectory: root,
          outputDirectory: `${relativeTrace}.run-one`,
        }),
      ).rejects.toThrow("already exists");
      const second = await runCampaign(campaign, {
        rootDirectory: root,
        outputDirectory: `${relativeTrace}.run-two`,
      });
      expect(first.run.results.map((result) => result.id)).toEqual([
        "negative-control",
        "malformed-response",
      ]);
      expect(
        first.run.results.map(({ id, target, seed, fault, faultApplied, status, metrics }) => ({
          id,
          target,
          seed,
          fault,
          faultApplied,
          status,
          metrics,
        })),
      ).toEqual(
        second.run.results.map(({ id, target, seed, fault, faultApplied, status, metrics }) => ({
          id,
          target,
          seed,
          fault,
          faultApplied,
          status,
          metrics,
        })),
      );
      expect(first.run.summary).toMatchObject({ passed: true, faultCoverage: 1 });
      expect(verifyCampaignRun(first.run)).toEqual(first.run);

      const baseline = approveCampaignBaseline(first.run);
      const baselinePath = join(directory, "baseline.json");
      await writeCampaignBaseline(baseline, baselinePath);
      await expect(writeCampaignBaseline(baseline, baselinePath)).rejects.toMatchObject({
        code: "EEXIST",
      });
      expect(compareCampaignRun(second.run, baseline)).toMatchObject({
        status: "pass",
        differences: [],
      });

      const regressedResult = {
        ...second.run.results[0]!,
        status: "failed" as const,
        assertionFailures: ["synthetic bounded regression"],
        metrics: {
          ...second.run.results[0]!.metrics!,
          deterministicScore: second.run.results[0]!.metrics!.deterministicScore - 10,
        },
      };
      const regressed = rehashRun(second.run, {
        results: [regressedResult, second.run.results[1]!],
        summary: { ...second.run.summary, passed: false, passedCount: 1, failedCount: 1 },
      });
      const comparison = compareCampaignRun(regressed, baseline);
      expect(comparison.status).toBe("regression");
      expect(comparison.differences.map((difference) => difference.metric)).toContain(
        "deterministicScore",
      );

      const incomplete = rehashRun(second.run, { status: "incomplete" });
      expect(compareCampaignRun(incomplete, baseline).status).toBe("incomplete");

      const controller = new AbortController();
      controller.abort(new Error("bounded test cancellation"));
      const cancelled = await runCampaign(campaign, {
        rootDirectory: root,
        outputDirectory: `${relativeTrace}.cancelled`,
        signal: controller.signal,
      });
      expect(cancelled.run.status).toBe("cancelled");
      expect(cancelled.run.summary.cancelledCount).toBe(campaign.scenarios.length);
      expect(() => approveCampaignBaseline(cancelled.run)).toThrow("expectation-passing");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists canonical campaign JSON without unavailable adapter metrics", async () => {
    const raw = await readFile(resolve("examples", "studio", "campaign.yml"), "utf8");
    expect(raw).not.toContain("costUsd");
    const loaded = await loadCampaignFile("examples/studio/campaign.yml", root);
    expect(stableStringify(loaded.campaign)).not.toContain("inputTokens");
  });
});
