import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(".");
const artifacts = join(root, ".artifacts", "package-smoke");
const packageDirectory = join(root, "packages", "cli");
const project = join(artifacts, "installed");
const npmCandidates = [
  join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  resolve(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
];
let npmCli;
for (const candidate of npmCandidates) {
  try {
    await access(candidate);
    npmCli = candidate;
    break;
  } catch {
    // Try the next official Node distribution layout.
  }
}
const packageManagerCli = process.env.npm_execpath;
if (!npmCli && !packageManagerCli) {
  throw new Error("Neither npm nor the invoking package manager could be located");
}

await rm(artifacts, { recursive: true, force: true });
await mkdir(project, { recursive: true });

function runNpm(arguments_, cwd) {
  const cleanEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("npm_config_")),
  );
  const result = spawnSync(process.execPath, [npmCli, ...arguments_], {
    cwd,
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...cleanEnvironment,
      npm_config_cache: join(artifacts, "npm-cache"),
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
  });
  if (result.status !== 0) {
    throw new Error(
      `npm ${arguments_.join(" ")} failed: ${result.error?.message ?? `exit ${result.status}`}`,
    );
  }
}

function runInvokingPackageManager(arguments_, cwd) {
  const result = spawnSync(process.execPath, [packageManagerCli, ...arguments_], {
    cwd,
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      PNPM_HOME: process.env.PNPM_HOME,
    },
  });
  if (result.status !== 0) {
    throw new Error(
      `package manager ${arguments_.join(" ")} failed: ${result.error?.message ?? `exit ${result.status}`}`,
    );
  }
}

if (npmCli) runNpm(["pack", packageDirectory, "--pack-destination", artifacts], root);
else runInvokingPackageManager(["pack", "--pack-destination", artifacts], packageDirectory);

const sourceManifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
const tarballName = (await readdir(artifacts)).find(
  (name) => name === `resilireplay-${sourceManifest.version}.tgz`,
);
if (!tarballName) throw new Error("Packed resilireplay tarball was not created");

await writeFile(
  join(project, "package.json"),
  `${JSON.stringify(
    {
      name: "resilireplay-package-smoke",
      version: "1.0.0",
      private: true,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
if (npmCli) {
  runNpm(
    ["install", "--ignore-scripts", "--package-lock=false", join(artifacts, tarballName)],
    project,
  );
} else {
  runInvokingPackageManager(
    ["add", "--ignore-scripts", "--save-exact", "--lockfile=false", join(artifacts, tarballName)],
    project,
  );
}

const installedRoot = join(project, "node_modules", "resilireplay");
const installedManifest = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
if (installedManifest.dependencies && Object.keys(installedManifest.dependencies).length > 0) {
  throw new Error("Published CLI unexpectedly contains runtime dependencies");
}
if (
  installedManifest.repository?.url !== "https://github.com/aliengineering-byte/resilireplay.git"
) {
  throw new Error("Published CLI repository metadata does not match the GitHub repository");
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else files.push(relative(installedRoot, path).replaceAll("\\", "/"));
  }
  return files;
}

const actualFiles = (await listFiles(installedRoot)).sort();
const expectedFiles = [
  "LICENSE",
  "README.md",
  "bin/resilireplay.mjs",
  "dist/resilireplay.js",
  "fixtures/demo-mcp-server.mjs",
  "package.json",
  "portable-skill/SKILL.md",
  "portable-skill/agents/openai.yaml",
  "portable-skill/assets/adapter-template.json",
  "portable-skill/references/campaigns.md",
  "portable-skill/references/capture.md",
  "portable-skill/references/compatibility.md",
  "portable-skill/references/privacy.md",
  "portable-skill/references/regressions.md",
  "portable-skill/scripts/detect.mjs",
  "portable-skill/scripts/install.mjs",
].sort();
if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error(`Unexpected package contents: ${actualFiles.join(", ")}`);
}

const cli = join(installedRoot, "bin", "resilireplay.mjs");
for (const [arguments_, expectation] of [
  [["--version"], sourceManifest.version],
  [["--help"], "Usage: resilireplay"],
  [["faults"], "malformed-json"],
  [["capture", "status"], '"status":"off"'],
]) {
  const result = spawnSync(process.execPath, [cli, ...arguments_], {
    cwd: project,
    encoding: "utf8",
    windowsHide: true,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0 || !output.includes(expectation)) {
    throw new Error(`Installed CLI smoke failed for ${arguments_.join(" ")}: ${output}`);
  }
}

const connectProject = join(artifacts, "connect-dry-run");
await mkdir(connectProject, { recursive: true });
const connect = spawnSync(process.execPath, [cli, "connect", "--agent", "auto", "--dry-run"], {
  cwd: connectProject,
  encoding: "utf8",
  windowsHide: true,
  timeout: 10_000,
});
if (connect.status !== 0) {
  throw new Error(`Packed connect dry-run failed: ${connect.stdout ?? ""}${connect.stderr ?? ""}`);
}
const connectPlan = JSON.parse(connect.stdout);
if (
  connectPlan.captureArmed !== false ||
  connectPlan.dryRun !== true ||
  connectPlan.changes.length !== 10 ||
  (await readdir(connectProject)).length !== 0
) {
  throw new Error(`Packed connect dry-run had unexpected effects: ${connect.stdout}`);
}

const mcpTransport = new StdioClientTransport({
  command: process.execPath,
  args: [cli, "mcp", "serve"],
  cwd: project,
  stderr: "pipe",
});
const mcpClient = new Client({ name: "resilireplay-package-smoke", version: "1.0.0" });
try {
  await mcpClient.connect(mcpTransport);
  const listed = await mcpClient.listTools();
  if (
    listed.tools.length !== 9 ||
    listed.tools.some(
      (tool) =>
        !tool.annotations ||
        !["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"].every(
          (name) => typeof tool.annotations?.[name] === "boolean",
        ),
    )
  ) {
    throw new Error("Packed MCP server did not expose nine fully annotated tools");
  }
} finally {
  await mcpClient.close();
}

const demoProject = join(artifacts, "demo-empty");
await mkdir(demoProject, { recursive: true });
const demo = spawnSync(process.execPath, [cli, "mcp", "demo", "--json", "--no-color"], {
  cwd: demoProject,
  encoding: "utf8",
  windowsHide: true,
  timeout: 30_000,
});
if (demo.status !== 0) {
  throw new Error(`Packed demo failed: ${demo.stdout ?? ""}${demo.stderr ?? ""}`);
}
const demoResult = JSON.parse(demo.stdout);
if (
  demoResult.result !== "PASS" ||
  demoResult.cleanControl !== "PASS" ||
  demoResult.recoveryAttempts !== 1 ||
  demoResult.duplicateEffects !== 0 ||
  demoResult.regressionExecuted !== true ||
  demoResult.cleanupComplete !== true ||
  demoResult.durationMs >= 30_000 ||
  demoResult.outputDirectory !== null ||
  (await readdir(demoProject)).length !== 0
) {
  throw new Error(`Packed demo acceptance failed: ${demo.stdout}`);
}

const adoptProject = join(artifacts, "adopt-dry-run");
await mkdir(adoptProject, { recursive: true });
await writeFile(
  join(adoptProject, "mcp.json"),
  `${JSON.stringify({ mcpServers: { fixture: { command: "node", args: ["never-started.mjs"] } } })}\n`,
  "utf8",
);
const adopt = spawnSync(
  process.execPath,
  [cli, "adopt", "--config", "mcp.json", "--server", "fixture", "--dry-run", "--json"],
  { cwd: adoptProject, encoding: "utf8", windowsHide: true, timeout: 10_000 },
);
if (adopt.status !== 0) {
  throw new Error(`Packed adopt dry-run failed: ${adopt.stdout ?? ""}${adopt.stderr ?? ""}`);
}
const adoptResult = JSON.parse(adopt.stdout);
if (
  adoptResult.status !== "dry-run" ||
  Object.values(adoptResult.plan.sideEffects).some(Boolean) ||
  JSON.stringify(await readdir(adoptProject)) !== JSON.stringify(["mcp.json"])
) {
  throw new Error(`Packed adopt dry-run acceptance failed: ${adopt.stdout}`);
}

const fullAdoptProject = join(artifacts, "adopt-full");
await mkdir(fullAdoptProject, { recursive: true });
await writeFile(
  join(fullAdoptProject, "server.mjs"),
  `import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.id === undefined) continue;
  let result;
  if (message.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "packed-adopt-fixture", version: "1.0.0" } };
  else if (message.method === "tools/list") result = { tools: [{ name: "read_fixture", description: "Read an inert fixture.", inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] }, annotations: { readOnlyHint: true } }] };
  else if (message.method === "tools/call") result = { content: [{ type: "text", text: "PACKED_PRIVATE_BODY_MUST_NOT_PERSIST" }] };
  else { console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "not found" } })); continue; }
  console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
}
`,
  "utf8",
);
await writeFile(
  join(fullAdoptProject, "mcp.json"),
  `${JSON.stringify({ mcpServers: { fixture: { command: "node", args: ["server.mjs"] } } })}\n`,
  "utf8",
);
const fullAdopt = spawnSync(
  process.execPath,
  [
    cli,
    "adopt",
    "--config",
    "mcp.json",
    "--server",
    "fixture",
    "--tool",
    "read_fixture",
    "--arguments",
    JSON.stringify({ message: "reviewed-packed-fixture" }),
    "--safety",
    "read-only-idempotent",
    "--confirm-target",
    "--confirm-tool-execution",
    "--confirm-retry-safe",
    "--non-interactive",
    "--json",
  ],
  { cwd: fullAdoptProject, encoding: "utf8", windowsHide: true, timeout: 300_000 },
);
if (fullAdopt.status !== 0) {
  throw new Error(
    `Packed full adoption failed: ${fullAdopt.stdout ?? ""}${fullAdopt.stderr ?? ""}`,
  );
}
const fullAdoptResult = JSON.parse(fullAdopt.stdout);
if (
  fullAdoptResult.status !== "adopted" ||
  fullAdoptResult.durationMs >= 300_000 ||
  fullAdoptResult.createdFiles.length !== 14
) {
  throw new Error(`Packed full adoption acceptance failed: ${fullAdopt.stdout}`);
}
const persistedAdoption = (
  await Promise.all(
    fullAdoptResult.createdFiles.map((path) => readFile(join(fullAdoptProject, path), "utf8")),
  )
).join("\n");
if (
  persistedAdoption.includes("PACKED_PRIVATE_BODY_MUST_NOT_PERSIST") ||
  /[A-Za-z]:\\Users\\|\/home\//u.test(persistedAdoption)
) {
  throw new Error("Packed adoption persisted a private body or personal path");
}
for (const arguments_ of [
  ["--test", join(fullAdoptProject, "tests", "resilireplay", "regression.test.mjs")],
  [
    cli,
    "campaign",
    "run",
    ".resilireplay/campaign.yml",
    "--confirm-tools",
    fullAdoptResult.campaignHash,
    "--output",
    ".resilireplay/runs/package-verification",
  ],
]) {
  const verification = spawnSync(process.execPath, arguments_, {
    cwd: fullAdoptProject,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  if (verification.status !== 0) {
    throw new Error(
      `Packed adoption verification failed: ${verification.stdout ?? ""}${verification.stderr ?? ""}`,
    );
  }
}

console.log(
  `Single-package npm installation, capture-off, connect dry-run, MCP, demo, and adopt smoke passed: resilireplay ${sourceManifest.version}`,
);
console.log(
  `Packed full adoption passed: ${fullAdoptResult.durationMs}ms, ${fullAdoptResult.createdFiles.length} artifacts, campaign ${fullAdoptResult.campaignHash}`,
);
