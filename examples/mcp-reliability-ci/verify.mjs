import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

const SERVER_PACKAGE = "@modelcontextprotocol/server-everything";
const SERVER_VERSION = "2026.8.18";
const SERVER_INTEGRITY =
  "sha512-sBW2l6uMa9ii78QixTKjXgNSv/Ad6LB8cTGBApJMytHe+VCufLQyME55JbLl/0+fcLmcx93wsZ6ce+0aOF8YXA==";
const SDK_VERSION = "1.30.0";
const PROTOCOL_REVISION = "2025-11-25";

async function npmInvocation(args) {
  if (process.platform !== "win32") return { command: "npm", args };
  const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  await access(npmCli);
  return { command: process.execPath, args: [npmCli, ...args] };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectRun(new Error(`${command} exceeded ${options.timeoutMs ?? 120_000}ms`));
    }, options.timeoutMs ?? 120_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectRun(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolveRun({ code: code ?? 1, stdout, stderr });
    });
  });
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function files(directory) {
  const output = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) output.push(path);
    }
  }
  await visit(directory);
  return output;
}

const tarballInput = argument("--tarball");
invariant(tarballInput, "Usage: node verify.mjs --tarball <resilireplay.tgz>");
const tarball = resolve(tarballInput);
invariant(isAbsolute(tarball), "The packed ResiliReplay tarball must resolve to an absolute path");
const workspace = await mkdtemp(join(tmpdir(), "resilireplay-mcp-everything-"));

try {
  await writeFile(
    join(workspace, "package.json"),
    `${JSON.stringify({ name: "packed-mcp-verification", private: true, type: "module" }, null, 2)}\n`,
    "utf8",
  );
  const installInvocation = await npmInvocation([
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--save-exact",
    tarball,
    `${SERVER_PACKAGE}@${SERVER_VERSION}`,
    `@modelcontextprotocol/sdk@${SDK_VERSION}`,
  ]);
  const install = await run(installInvocation.command, installInvocation.args, { cwd: workspace });
  invariant(install.code === 0, `Clean package installation failed: ${install.stderr}`);

  const lock = JSON.parse(await readFile(join(workspace, "package-lock.json"), "utf8"));
  const serverLock = lock.packages?.[`node_modules/${SERVER_PACKAGE}`];
  invariant(serverLock?.version === SERVER_VERSION, "Unexpected MCP Everything version");
  invariant(serverLock?.integrity === SERVER_INTEGRITY, "MCP Everything integrity mismatch");
  const sdkPackage = JSON.parse(
    await readFile(
      join(workspace, "node_modules", "@modelcontextprotocol", "sdk", "package.json"),
      "utf8",
    ),
  );
  invariant(sdkPackage.version === SDK_VERSION, "Unexpected MCP SDK runtime version");

  const cli = join(workspace, "node_modules", "resilireplay", "bin", "resilireplay.mjs");
  const packageManifest = JSON.parse(
    await readFile(join(workspace, "node_modules", "resilireplay", "package.json"), "utf8"),
  );
  const version = await run(process.execPath, [cli, "--version"], {
    cwd: workspace,
    timeoutMs: 10_000,
  });
  invariant(
    version.code === 0 && version.stdout.trim() === packageManifest.version,
    "Packed CLI version mismatch",
  );
  const help = await run(process.execPath, [cli, "--help"], { cwd: workspace, timeoutMs: 10_000 });
  invariant(
    help.code === 0 && help.stdout.indexOf("mcp") < help.stdout.indexOf("connect"),
    "CLI help is not MCP-first",
  );
  const demo = await run(process.execPath, [cli, "mcp", "demo", "--no-color"], {
    cwd: workspace,
    timeoutMs: 15_000,
  });
  invariant(
    demo.code === 0 && demo.stdout.includes("MCP reliability check passed."),
    "Packed MCP demo failed",
  );
  const demoJson = await run(process.execPath, [cli, "mcp", "demo", "--json", "--no-color"], {
    cwd: workspace,
    timeoutMs: 15_000,
  });
  const demoResult = JSON.parse(demoJson.stdout);
  invariant(demoJson.code === 0 && demoResult.result === "PASS", "Packed MCP JSON demo failed");
  invariant(
    !(await readdir(workspace)).includes(".resilireplay"),
    "Default MCP demo wrote project state",
  );

  await writeFile(
    join(workspace, "mcp.json"),
    `${JSON.stringify(
      {
        mcpServers: {
          everything: {
            type: "stdio",
            command: "node",
            args: ["node_modules/@modelcontextprotocol/server-everything/dist/index.js", "stdio"],
            cwd: ".",
            connectionTimeout: 10_000,
            requestTimeout: 10_000,
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const reviewed = [
    cli,
    "mcp",
    "test",
    "--config",
    "mcp.json",
    "--server",
    "everything",
    "--tool",
    "echo",
    "--safety",
    "inert",
    "--output",
    "evidence",
    "--dry-run",
    "--json",
  ];
  const dryRun = await run(process.execPath, reviewed, { cwd: workspace, timeoutMs: 30_000 });
  invariant(dryRun.code === 0, `Dry-run failed: ${dryRun.stderr}`);
  const plan = JSON.parse(dryRun.stdout);
  invariant(plan.server === "everything", "Dry-run selected the wrong server");
  invariant(plan.transport === "stdio", "Dry-run selected the wrong transport");
  invariant(
    plan.allowedTools?.length === 1 && plan.allowedTools[0] === "echo",
    "Tool allowlist drift",
  );
  invariant(plan.retryBudget === 1, "Recovery was not bounded to one retry");

  const approved = reviewed.filter((value) => value !== "--dry-run");
  approved.push("--approve", plan.planSha256);
  const execution = await run(process.execPath, approved, { cwd: workspace, timeoutMs: 60_000 });
  invariant(execution.code === 0, `Approved MCP test failed: ${execution.stderr}`);
  const result = JSON.parse(execution.stdout);
  invariant(result.result === "PASS", "MCP reliability result did not pass");
  invariant(result.cleanControl === "PASS", "Clean MCP tool call did not pass");
  invariant(result.faultObserved === true, "Controlled MCP fault was not observed");
  invariant(
    result.recoveryAttempts === 1 && result.recoverySucceeded,
    "Recovery was not bounded and successful",
  );
  invariant(result.duplicateEffects === 0, "Duplicate-effect evidence was not zero");
  invariant(
    result.regressionGenerated && result.regressionExecuted,
    "Regression was not generated and executed",
  );
  invariant(result.cleanupComplete, "Owned MCP resources were not cleaned up");

  const regression = await run(
    process.execPath,
    ["--test", join(workspace, "evidence", "regression", "regression.test.mjs")],
    { cwd: workspace, timeoutMs: 30_000 },
  );
  invariant(
    regression.code === 0,
    `Generated regression did not pass in isolation: ${regression.stderr}`,
  );

  const evidenceFiles = await files(join(workspace, "evidence"));
  const persisted = (
    await Promise.all(evidenceFiles.map((path) => readFile(path, "utf8").catch(() => "")))
  ).join("\n");
  invariant(!persisted.includes(workspace), "A private temporary path was persisted");
  invariant(
    !/(?:api[-_]?key|authorization|bearer|password)\s*[:=]\s*[^\s"']+/iu.test(persisted),
    "Credential-shaped data was persisted",
  );

  const exportInput = argument("--export-regression");
  if (exportInput) {
    const exportPath = resolve(exportInput);
    const allowedRoot = resolve(process.cwd());
    invariant(
      exportPath.startsWith(`${allowedRoot}${process.platform === "win32" ? "\\" : "/"}`),
      "Regression export must stay inside the current project",
    );
    await rm(exportPath, { recursive: true, force: true });
    await cp(join(workspace, "evidence", "regression"), exportPath, { recursive: true });
  }

  const tarballSha256 = createHash("sha256")
    .update(await readFile(tarball))
    .digest("hex");
  console.log("Official MCP Everything verification: PASS");
  console.log(`Server: ${SERVER_PACKAGE}@${SERVER_VERSION}`);
  console.log(`Server integrity: ${SERVER_INTEGRITY}`);
  console.log(`Packed ResiliReplay SHA-256: ${tarballSha256}`);
  console.log(`MCP SDK: ${SDK_VERSION}`);
  console.log(`Protocol revision: ${PROTOCOL_REVISION}`);
  console.log("Transport: stdio");
  console.log("Tool: echo (inert)");
  console.log("Clean tool call: PASS");
  console.log("Fault: mcp-tool-error");
  console.log("Recovery attempts: 1");
  console.log("Duplicate effects: 0");
  console.log("Regression: generated and passed");
  console.log("Cleanup: complete");
  console.log(`Evidence: sha256:${result.evidenceSha256}`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}
