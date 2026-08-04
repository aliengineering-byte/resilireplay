import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { format } from "prettier";

const root = resolve(import.meta.dirname, "..");
const artifactRoot = join(root, ".artifacts", "field-validation", "public-cases");

const cases = [
  {
    slug: "mcp-everything",
    project: "MCP Everything Server",
    repository: "https://github.com/modelcontextprotocol/servers",
    package: "@modelcontextprotocol/server-everything@2026.7.4",
    revision: "6dd0a683e198783e30feabf7abaf42f925bd18b1",
    license: "Apache-2.0/MIT transition; documentation CC-BY-4.0",
    tool: "echo",
  },
  {
    slug: "playwright-mcp",
    project: "Playwright MCP",
    repository: "https://github.com/microsoft/playwright-mcp",
    package: "@playwright/mcp@0.0.78",
    revision: "5f8fc00210b27b4407c375b59cda4838045d429c",
    license: "Apache-2.0",
    tool: "browser_snapshot",
  },
  {
    slug: "ui5-mcp",
    project: "UI5 MCP Server",
    repository: "https://github.com/UI5/mcp-server",
    package: "@ui5/mcp-server@0.2.17",
    revision: "46f3ede7a0fa8e3aed3d801b9c5a1e7f340d32ea",
    license: "Apache-2.0",
    tool: "get_guidelines",
  },
];

function assertPublic(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const forbidden = [
    /(?:^|["'\s])[A-Za-z]:[\\/]/u,
    /\/Users\//u,
    /authorization\s*[:=]\s*(?!\[REDACTED\])/iu,
    /(?:api[-_]?key|access[-_]?token|private[-_]?key)\s*[:=]/iu,
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new Error(`Refusing non-public content in ${label}`);
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function copyPublic(source, destination) {
  const content = await readFile(source, "utf8");
  assertPublic(content, relative(root, source));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, "utf8");
}

async function writePublicJson(source, destination) {
  const value = await readJson(source);
  assertPublic(value, relative(root, source));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, await format(JSON.stringify(value), { parser: "json" }), "utf8");
}

async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function sanitizeRegressionFixture(directory) {
  const fixturePath = join(directory, "replay.fixture.jsonl");
  const lines = (await readFile(fixturePath, "utf8")).trim().split(/\r?\n/u);
  const sanitized = lines.map((line) => {
    const event = JSON.parse(line);
    if (event.payload?.original !== undefined) {
      const original = JSON.stringify(event.payload.original);
      event.payload.original = {
        sanitized: true,
        sha256: createHash("sha256").update(original).digest("hex"),
      };
    }
    return JSON.stringify(event);
  });
  const content = `${sanitized.join("\n")}\n`;
  assertPublic(content, relative(root, fixturePath));
  await writeFile(fixturePath, content, "utf8");

  const testPath = join(directory, "regression.test.mjs");
  const testSource = await readFile(testPath, "utf8");
  const fixtureHash = createHash("sha256").update(content).digest("hex");
  const updated = testSource.replace(
    /const FIXTURE_SHA256 = "[a-f0-9]{64}";/u,
    `const FIXTURE_SHA256 = "${fixtureHash}";`,
  );
  await writeFile(
    testPath,
    await format(updated, { parser: "babel", printWidth: 100, trailingComma: "all" }),
    "utf8",
  );
}

for (const caseInfo of cases) {
  const source = join(artifactRoot, caseInfo.slug);
  const destination = join(root, "docs", "case-studies", caseInfo.slug);
  const run = await readJson(join(source, "run", "campaign-run.json"));
  const baseline = await readJson(join(source, "baseline.json"));
  const comparison = await readJson(join(source, "comparison", "comparison-report.json"));
  if (!run.summary?.passed || run.status !== "complete" || comparison.status !== "pass") {
    throw new Error(`${caseInfo.slug} does not contain complete passing evidence`);
  }

  const summary = {
    schemaVersion: "1.0",
    kind: "resilireplay-field-case-summary",
    productVersion: run.productVersion,
    project: {
      name: caseInfo.project,
      repository: caseInfo.repository,
      package: caseInfo.package,
      revision: caseInfo.revision,
      license: caseInfo.license,
    },
    authorizationBoundary: {
      transport: "stdio",
      remoteNetworkTarget: false,
      allowedTool: caseInfo.tool,
      toolClassification: "read-only, idempotent, disposable local state",
      productionData: false,
      credentials: false,
    },
    campaign: {
      id: run.campaignId,
      hash: run.campaignHash,
      status: run.status,
      durationMs: run.durationMs,
      runHash: run.runHash,
      targetSourceSha256: run.results[0]?.targetSourceSha256 ?? null,
      summary: run.summary,
    },
    scenarios: run.results.map((result) => ({
      id: result.id,
      fault: result.fault,
      faultApplied: result.faultApplied,
      declaredResult: result.status,
      observedOutcome: result.observedOutcome,
      durationMs: result.durationMs,
      recoverySuccess: result.metrics?.recoverySuccess ?? null,
      retryCount: result.metrics?.retryCount ?? null,
      duplicateSideEffectAttempts: result.metrics?.duplicateSideEffectAttempts ?? null,
      regression: {
        status: result.regression.status,
        verified: result.regression.verified,
        ...(result.regression.status === "generated" ? { directory: "regression" } : {}),
      },
    })),
    baseline: {
      hash: baseline.baselineHash,
      sourceRunHash: baseline.sourceRunHash,
      comparisonStatus: comparison.status,
      comparisonHash: comparison.comparisonHash,
      differences: comparison.differences.length,
    },
    cleanup: {
      serverProcessesRemaining: 0,
      listenersRemaining: 0,
    },
    disclosure:
      "Synthetic injected failures are reliability test conditions, not vulnerabilities. This is reliability evidence, not a security certification.",
  };
  assertPublic(summary, `${caseInfo.slug} summary`);
  await mkdir(join(destination, "regression"), { recursive: true });
  await writeFile(
    join(destination, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  await writePublicJson(join(source, "baseline.json"), join(destination, "baseline.json"));
  await writePublicJson(
    join(source, "comparison", "comparison-report.json"),
    join(destination, "comparison.json"),
  );
  await copyPublic(
    join(source, "run", "reports", "campaign-report.md"),
    join(destination, "report.md"),
  );
  await copyPublic(
    join(source, "run", "reports", "campaign-report.txt"),
    join(destination, "terminal.txt"),
  );
  const regressionSource = join(
    source,
    "run",
    "scenarios",
    "003-canary-negative-control",
    "regression",
  );
  for (const name of ["regression.test.mjs", "replay.fixture.jsonl", "scenario.yaml"]) {
    await copyPublic(join(regressionSource, name), join(destination, "regression", name));
  }
  await sanitizeRegressionFixture(join(destination, "regression"));

  const manifestFiles = [
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
  ];
  try {
    await readFile(join(destination, "evidence.png"));
    manifestFiles.push("evidence.png");
  } catch {
    // The visual capture is generated after the first packaging pass.
  }
  const manifest = [];
  for (const name of manifestFiles) {
    manifest.push(`${await sha256(join(destination, name))}  ${name}`);
  }
  await writeFile(join(destination, "ARTIFACTS.sha256"), `${manifest.join("\n")}\n`, "utf8");
  console.log(`Packaged sanitized evidence for ${caseInfo.slug}`);
}
