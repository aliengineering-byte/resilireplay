import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const caseRoot = join(root, "docs", "case-studies");
const cases = [
  ["mcp-everything", "@modelcontextprotocol/server-everything@2026.7.4", "echo"],
  ["playwright-mcp", "@playwright/mcp@0.0.78", "browser_snapshot"],
  ["ui5-mcp", "@ui5/mcp-server@0.2.17", "get_guidelines"],
];
const required = [
  "README.md",
  "package.json",
  "pnpm-lock.yaml",
  "mcp.json",
  "campaign.yml",
  "summary.json",
  "baseline.json",
  "comparison.json",
  "report.md",
  "terminal.txt",
  "regression/regression.test.mjs",
  "regression/replay.fixture.jsonl",
  "regression/scenario.yaml",
  "evidence.png",
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

for (const [slug, packageVersion, allowedTool] of cases) {
  const directory = join(caseRoot, slug);
  const manifestText = await readFile(join(directory, "ARTIFACTS.sha256"), "utf8");
  const manifest = new Map();
  for (const line of manifestText.trim().split(/\r?\n/u)) {
    const match = /^([a-f0-9]{64}) {2}(.+)$/u.exec(line);
    invariant(match, `${slug}: invalid manifest line`);
    const candidate = resolve(directory, match[2]);
    invariant(
      candidate === directory || candidate.startsWith(`${directory}${sep}`),
      `${slug}: manifest path escapes its case directory`,
    );
    invariant(!manifest.has(match[2]), `${slug}: duplicate manifest path ${match[2]}`);
    manifest.set(match[2], match[1]);
  }
  invariant(
    required.every((name) => manifest.has(name)) && manifest.size === required.length,
    `${slug}: manifest does not cover the exact public evidence set`,
  );
  for (const [name, expected] of manifest) {
    const actual = await sha256(join(directory, name));
    invariant(actual === expected, `${slug}: SHA-256 mismatch for ${name}`);
  }

  const summary = JSON.parse(await readFile(join(directory, "summary.json"), "utf8"));
  const baseline = JSON.parse(await readFile(join(directory, "baseline.json"), "utf8"));
  const comparison = JSON.parse(await readFile(join(directory, "comparison.json"), "utf8"));
  invariant(summary.productVersion === "0.3.0", `${slug}: unexpected product version`);
  invariant(summary.project.package === packageVersion, `${slug}: package pin changed`);
  invariant(summary.authorizationBoundary.transport === "stdio", `${slug}: transport changed`);
  invariant(
    summary.authorizationBoundary.allowedTool === allowedTool,
    `${slug}: allowlist changed`,
  );
  invariant(
    summary.authorizationBoundary.remoteNetworkTarget === false,
    `${slug}: remote target enabled`,
  );
  invariant(summary.authorizationBoundary.credentials === false, `${slug}: credentials enabled`);
  invariant(summary.campaign.status === "complete", `${slug}: campaign is incomplete`);
  invariant(
    summary.campaign.targetSourceSha256 === (await sha256(join(directory, "mcp.json"))),
    `${slug}: committed target config differs from executed evidence`,
  );
  invariant(summary.campaign.summary.passed === true, `${slug}: expectations did not pass`);
  invariant(summary.campaign.summary.total === 3, `${slug}: scenario count changed`);
  invariant(summary.campaign.summary.passedCount === 3, `${slug}: not all scenarios passed`);
  invariant(summary.baseline.hash === baseline.baselineHash, `${slug}: baseline hash disagrees`);
  invariant(comparison.status === "pass", `${slug}: comparison failed`);
  invariant(comparison.differences.length === 0, `${slug}: comparison has differences`);
  invariant(
    summary.baseline.comparisonHash === comparison.comparisonHash,
    `${slug}: comparison hash disagrees`,
  );
  invariant(
    summary.scenarios.filter((scenario) => scenario.recoverySuccess && scenario.retryCount === 1)
      .length === 1,
    `${slug}: expected exactly one bounded recovery`,
  );
  invariant(
    summary.scenarios.filter(
      (scenario) => scenario.regression.status === "generated" && scenario.regression.verified,
    ).length === 1,
    `${slug}: expected exactly one verified generated regression`,
  );

  const files = await readdir(directory, { recursive: true, withFileTypes: true });
  for (const entry of files) {
    if (!entry.isFile() || ["evidence.png"].includes(entry.name)) continue;
    const path = join(entry.parentPath ?? entry.path, entry.name);
    if (path.includes(`${sep}node_modules${sep}`) || path.includes(`${sep}browsers${sep}`))
      continue;
    const content = await readFile(path, "utf8");
    invariant(
      !/(?:^|["'\s])[A-Za-z]:[\\/]/u.test(content),
      `${slug}: private Windows path in ${relative(root, path)}`,
    );
    invariant(!/\/Users\//u.test(content), `${slug}: private home path in ${relative(root, path)}`);
    invariant(
      !/\.artifacts\/field-validation/u.test(content),
      `${slug}: staging path in ${relative(root, path)}`,
    );
  }

  const regression = join(directory, "regression", "regression.test.mjs");
  const result = spawnSync(process.execPath, [regression], { cwd: root, encoding: "utf8" });
  invariant(
    result.status === 0,
    `${slug}: committed regression failed\n${result.stdout}\n${result.stderr}`,
  );
  console.log(`${slug}: hashes, claims, privacy boundary, and regression verified`);
}
