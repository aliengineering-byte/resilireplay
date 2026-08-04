import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  approveCampaignBaseline,
  campaignHash,
  compareCampaignRun,
  loadCampaignFile,
  runCampaign,
  writeCampaignBaseline,
  writeCampaignComparisonReports,
  writeCampaignRunReports,
} from "../packages/campaign/dist/index.js";
import { startStudio } from "../packages/studio/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const artifacts = join(root, ".artifacts", "studio-demo");
const transcriptPath = join(root, "docs", "assets", "studio-demo-transcript.txt");
const lines = [];
const log = (value) => {
  const text = String(value);
  lines.push(text);
  console.log(text);
};

async function startHttpFixture() {
  const token = `fixture-${randomUUID()}`;
  const child = spawn(
    process.execPath,
    [join(root, "examples", "mcp-http-fixture-server", "dist", "index.js")],
    {
      env: {
        ...process.env,
        RESILIREPLAY_FIXTURE_HTTP_TOKEN: token,
        RESILIREPLAY_FIXTURE_MODE: "resilient",
        RESILIREPLAY_FIXTURE_PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const url = await new Promise((resolveUrl, reject) => {
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
      resolveUrl(JSON.parse(stdout.slice(0, newline)).url);
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

const started = performance.now();
await rm(artifacts, { recursive: true, force: true });
await mkdir(artifacts, { recursive: true });

log("ResiliReplay v0.3.0 verified local fixture demo");
log(
  "Fixture disclosure: resilient/vulnerable stdio and Streamable HTTP are repository-owned local processes; no external provider is used.",
);
log("");

log("1/7 Inspector-shaped config -> reviewed deterministic campaign");
const stdio = await loadCampaignFile("examples/studio/campaign.yml", root);
log(`campaign=${stdio.campaign.id} hash=${stdio.campaignHash}`);
log(
  "targets=resilient-stdio,vulnerable-stdio; allowTools=reliability_probe; secret values redacted",
);

log("2/7 Running resilient and vulnerable stdio controls with injected recovery/failure");
const stdioRun = await runCampaign(stdio.campaign, {
  rootDirectory: root,
  outputDirectory: ".artifacts/studio-demo/stdio-run",
  confirmedToolCampaignHash: stdio.campaignHash,
});
await writeCampaignRunReports(stdioRun.run, join(stdioRun.outputDirectory, "reports"));
for (const result of stdioRun.run.results) {
  log(
    `${result.status.toUpperCase()} ${result.id} observed=${result.observedOutcome} fault=${result.fault} recovery=${result.metrics?.recoverySuccess ?? "unavailable"} regression=${result.regression.status}`,
  );
}
log(`stdio evidence=${stdioRun.run.runHash}`);

log("3/7 Approving and comparing a reliability baseline");
const baseline = approveCampaignBaseline(stdioRun.run);
const baselinePath = join(artifacts, "stdio-baseline.json");
await writeCampaignBaseline(baseline, baselinePath);
const comparison = compareCampaignRun(stdioRun.run, baseline);
await writeCampaignComparisonReports(comparison, join(artifacts, "comparison"));
log(
  `comparison=${comparison.status} differences=${comparison.differences.length} baseline=${baseline.baselineHash}`,
);

log("4/7 Verifying generated causal regression tests");
const generated = stdioRun.run.results.filter((result) => result.regression.status === "generated");
log(
  `generated=${generated.length} verified=${generated.every((result) => result.regression.verified)}`,
);

log("5/7 Running the real local Streamable HTTP negative control and bounded retry");
const http = await startHttpFixture();
const environmentName = "RESILIREPLAY_STUDIO_DEMO_HTTP_TOKEN";
process.env[environmentName] = `Bearer ${http.token}`;
try {
  await writeFile(
    join(artifacts, "http-mcp.json"),
    `${JSON.stringify(
      {
        mcpServers: {
          "resilient-http": {
            type: "streamable-http",
            url: http.url,
            headers: { Authorization: `\${env:${environmentName}}` },
            connectionTimeout: 5_000,
            requestTimeout: 5_000,
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const httpCampaign = await loadCampaignFile("examples/studio/http-campaign.template.yml", root);
  const httpRun = await runCampaign(httpCampaign.campaign, {
    rootDirectory: root,
    outputDirectory: ".artifacts/studio-demo/http-run",
    confirmedToolCampaignHash: campaignHash(httpCampaign.campaign),
  });
  await writeCampaignRunReports(httpRun.run, join(httpRun.outputDirectory, "reports"));
  log(
    `http=${httpRun.run.summary.passed ? "PASS" : "FAIL"} scenarios=${httpRun.run.summary.passedCount}/${httpRun.run.summary.total} hash=${httpRun.run.runHash}`,
  );
  const persisted = await readFile(join(httpRun.outputDirectory, "campaign-run.json"), "utf8");
  if (persisted.includes(http.token)) throw new Error("HTTP fixture token leaked into evidence");
} finally {
  delete process.env[environmentName];
  await http.close();
}

log("6/7 Measuring Studio startup and graceful shutdown");
const studio = await startStudio({ rootDirectory: root, port: 0 });
log(`studio startup=${studio.startupMs}ms bind=${studio.host} session=ephemeral url-secret=false`);
await studio.close();
log("studio listener closed=true");

log("7/7 Final result");
const wallMs = Math.round(performance.now() - started);
log(`workflow=PASS wall=${wallMs}ms under-60s=${wallMs < 60_000}`);
log("telemetry=false api-keys=false external-provider=false fixture-backed=true");
await writeFile(transcriptPath, `${lines.join("\n")}\n`, "utf8");
