import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CampaignSchema, campaignHash, runCampaign } from "@resilireplay/campaign";

const root = resolve(".");
const fixture = resolve("examples", "mcp-http-fixture-server", "dist", "index.js");

async function startFixture(): Promise<{
  url: string;
  token: string;
  close: () => Promise<void>;
}> {
  const token = `fixture-${randomUUID()}`;
  const child = spawn(process.execPath, [fixture], {
    env: {
      ...process.env,
      RESILIREPLAY_FIXTURE_HTTP_TOKEN: token,
      RESILIREPLAY_FIXTURE_MODE: "resilient",
      RESILIREPLAY_FIXTURE_PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const url = await new Promise<string>((resolveUrl, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`HTTP fixture startup timed out: ${stderr}`)),
      5_000,
    );
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`HTTP fixture exited ${code}: ${stderr}`)));
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      resolveUrl((JSON.parse(stdout.slice(0, newline)) as { url: string }).url);
    });
  });
  return {
    url,
    token,
    close: async () => {
      if (child.exitCode !== null) return;
      child.kill();
      await Promise.race([
        once(child, "exit"),
        new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}

describe("campaign Streamable HTTP integration", () => {
  it("runs a negative control and bounded retry through the real local HTTP transport", async () => {
    const server = await startFixture();
    const artifactsRoot = resolve(".artifacts");
    await mkdir(artifactsRoot, { recursive: true });
    const directory = await mkdtemp(join(artifactsRoot, "campaign-http-"));
    const environmentName = "RESILIREPLAY_CAMPAIGN_HTTP_TEST_TOKEN";
    process.env[environmentName] = `Bearer ${server.token}`;
    try {
      const configPath = join(directory, "mcp.json");
      await writeFile(
        configPath,
        `${JSON.stringify({
          mcpServers: {
            "resilient-http": {
              type: "streamable-http",
              url: server.url,
              headers: { Authorization: `\${env:${environmentName}}` },
              connectionTimeout: 5_000,
              requestTimeout: 5_000,
            },
          },
        })}\n`,
        "utf8",
      );
      const configRelative = relative(root, configPath).replaceAll("\\", "/");
      const campaign = CampaignSchema.parse({
        schemaVersion: "1.0",
        kind: "resilireplay-campaign",
        id: "streamable-http-integration",
        description: "Real local Streamable HTTP campaign integration.",
        seed: 42,
        budgets: {
          concurrency: 1,
          retries: 1,
          scenarioTimeoutMs: 10_000,
          totalTimeoutMs: 30_000,
        },
        targets: [
          {
            id: "http",
            kind: "mcp",
            inspectorConfig: configRelative,
            server: "resilient-http",
            allowTools: ["reliability_probe"],
            allowRemote: false,
          },
        ],
        scenarios: [
          {
            id: "http-negative-control",
            target: "http",
            fault: "none",
            assertions: { outcome: "passed", maxRetries: 0 },
          },
          {
            id: "http-recovery",
            target: "http",
            fault: "mcp-tool-error",
            recovery: "retry",
            assertions: { outcome: "passed", safeRecovery: true, maxRetries: 1 },
          },
        ],
        thresholds: {
          maxScoreDrop: 0,
          maxRetryIncrease: 0,
          maxDuplicateSideEffectIncrease: 0,
        },
      });
      const run = await runCampaign(campaign, {
        rootDirectory: root,
        outputDirectory: relative(root, join(directory, "run")),
        confirmedToolCampaignHash: campaignHash(campaign),
      });
      expect(run.run, JSON.stringify(run.run.results, null, 2)).toMatchObject({
        status: "complete",
        summary: { passed: true, passedCount: 2, faultCoverage: 1 },
      });
      expect(run.run.results[1]?.metrics).toMatchObject({
        recoverySuccess: true,
        retryCount: 1,
      });
      expect(JSON.stringify(run.run)).not.toContain(server.token);
    } finally {
      delete process.env[environmentName];
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
