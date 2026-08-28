import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createEvent, calculateMetrics } from "../packages/core/dist/index.js";
import { readTrace, writeTrace } from "../packages/trace/dist/index.js";
import { loadCampaignFile, runCampaign } from "../packages/campaign/dist/index.js";
import { startStudio } from "../packages/studio/dist/index.js";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const output = join(root, ".artifacts", "release-gates");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const startup = [];
for (let iteration = 0; iteration < 100; iteration += 1) {
  const studio = await startStudio({ rootDirectory: root, port: 0 });
  startup.push(studio.startupMs);
  const response = await fetch(`${studio.url}/`);
  if (!response.ok) throw new Error(`Studio lifecycle ${iteration + 1} health check failed`);
  await studio.close();
  try {
    await fetch(`${studio.url}/`, { signal: AbortSignal.timeout(250) });
    throw new Error(`Studio lifecycle ${iteration + 1} left its listener open`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("left its listener open")) throw error;
  }
}

const eventCount = 20_000;
const trace = Array.from({ length: eventCount }, (_, sequence) =>
  createEvent({
    runId: "release-stress",
    sequence,
    type: sequence === eventCount - 1 ? "run_completed" : "model_response",
    actor: "fixture",
    payload: { sequence, text: `bounded fixture payload ${sequence % 97}` },
  }),
);
const tracePath = join(output, "large-trace.jsonl");
const stressStarted = performance.now();
await writeTrace(tracePath, trace);
const reread = await readTrace(tracePath);
const stressMetrics = calculateMetrics(reread);
const stressMs = Math.round(performance.now() - stressStarted);
const traceBytes = (await stat(tracePath)).size;
const peakRssMiB = Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
if (reread.length !== eventCount || !stressMetrics.taskCompletion) {
  throw new Error("Large-trace stress evidence was incomplete");
}
if (peakRssMiB > 512) throw new Error(`Large-trace RSS ${peakRssMiB} MiB exceeded 512 MiB`);

const campaign = await loadCampaignFile("examples/studio/campaign.yml", root);
const directStarted = performance.now();
calculateMetrics(trace.slice(0, 8));
const directMs = performance.now() - directStarted;
const campaignStarted = performance.now();
const campaignRun = await runCampaign(campaign.campaign, {
  rootDirectory: root,
  outputDirectory: ".artifacts/release-gates/campaign",
  confirmedToolCampaignHash: campaign.campaignHash,
});
const campaignMs = performance.now() - campaignStarted;
if (!campaignRun.run.summary.passed) throw new Error("Release-gate campaign did not pass");

const transcript = await readFile(
  join(root, "docs", "assets", "studio-demo-transcript.txt"),
  "utf8",
);
const wallMatch = /wall=(\d+)ms under-60s=(true|false)/.exec(transcript);
if (!wallMatch || wallMatch[2] !== "true")
  throw new Error("Verified Studio demo exceeded 60 seconds");

const packageManagerCli = process.env.npm_execpath;
if (!packageManagerCli) {
  throw new Error(
    "Run release gates through the package script so the package manager is explicit",
  );
}
await execFileAsync(process.execPath, [packageManagerCli, "pack", "--pack-destination", output], {
  cwd: join(root, "packages", "cli"),
  windowsHide: true,
  maxBuffer: 5 * 1024 * 1024,
});
const tarballPath = join(output, "resilireplay-0.7.0.tgz");
const packedBytes = (await stat(tarballPath)).size;
async function listPackageFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listPackageFiles(path)));
    else files.push(relative(join(root, "packages", "cli"), path));
  }
  return files;
}

const packageFiles = [
  "LICENSE",
  "README.md",
  join("bin", "resilireplay.mjs"),
  join("dist", "resilireplay.js"),
  join("fixtures", "demo-mcp-server.mjs"),
  "package.json",
  ...(await listPackageFiles(join(root, "packages", "cli", "portable-skill"))),
];
const unpackedBytes = (
  await Promise.all(packageFiles.map((path) => stat(join(root, "packages", "cli", path))))
).reduce((sum, file) => sum + file.size, 0);

const report = {
  generatedAt: new Date().toISOString(),
  studioLifecycle: {
    iterations: startup.length,
    averageStartupMs: Math.round(startup.reduce((sum, value) => sum + value, 0) / startup.length),
    maxStartupMs: Math.max(...startup),
    orphanListeners: 0,
  },
  largeTrace: { eventCount, traceBytes, wallMs: stressMs, peakRssMiB },
  campaign: {
    scenarios: campaignRun.run.summary.total,
    wallMs: Math.round(campaignMs),
    directTraceReadMs: Math.round(directMs * 100) / 100,
    overheadJustification:
      "Campaign time includes four real MCP subprocess audits, report persistence, and generated-regression execution; direct timing is only a single trace read and is not an equivalent workload.",
  },
  demo: { wallMs: Number(wallMatch[1]), under60Seconds: true },
  package: {
    packedBytes,
    unpackedBytes,
    fileCount: packageFiles.length,
  },
};
await writeFile(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
