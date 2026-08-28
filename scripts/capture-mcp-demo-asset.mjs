import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

async function npmInvocation(args) {
  if (process.platform !== "win32") return { command: "npm", args };
  const executableDirectory = dirname(process.execPath);
  const candidates = [
    ...(process.env.RESILIREPLAY_NPM_CLI_PATH
      ? [resolve(process.env.RESILIREPLAY_NPM_CLI_PATH)]
      : []),
    join(executableDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    join(dirname(executableDirectory), "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const npmCli of candidates) {
    try {
      await access(npmCli);
      return { command: process.execPath, args: [npmCli, ...args] };
    } catch {
      // Try the next supported Node installation layout.
    }
  }
  throw new Error("npm CLI was not found next to the active Node.js runtime");
}

function run(command, args, cwd, timeoutMs = 60_000) {
  return new Promise((resolveRun, rejectRun) => {
    const started = performance.now();
    const child = spawn(command, args, {
      cwd,
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
      rejectRun(new Error(`${command} exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectRun(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolveRun({
        code: code ?? 1,
        stdout,
        stderr,
        durationMs: Math.round(performance.now() - started),
      });
    });
  });
}

const root = resolve(import.meta.dirname, "..");
const staging = await mkdtemp(join(tmpdir(), "resilireplay-demo-asset-"));
try {
  const packInvocation = await npmInvocation([
    "pack",
    join(root, "packages", "cli"),
    "--pack-destination",
    staging,
    "--json",
  ]);
  const packed = await run(packInvocation.command, packInvocation.args, root);
  if (packed.code !== 0) throw new Error(`npm pack failed: ${packed.stderr}`);
  const filename = JSON.parse(packed.stdout)[0]?.filename;
  if (typeof filename !== "string") throw new Error("npm pack returned no filename");
  const tarball = join(staging, filename);

  await writeFile(
    join(staging, "package.json"),
    `${JSON.stringify({ name: "mcp-demo-asset", private: true }, null, 2)}\n`,
    "utf8",
  );
  const installInvocation = await npmInvocation([
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--save-exact",
    tarball,
  ]);
  const installed = await run(installInvocation.command, installInvocation.args, staging, 120_000);
  if (installed.code !== 0) throw new Error(`Packed install failed: ${installed.stderr}`);
  const cli = join(staging, "node_modules", "resilireplay", "bin", "resilireplay.mjs");
  const demo = await run(process.execPath, [cli, "mcp", "demo", "--no-color"], staging, 15_000);
  if (demo.code !== 0 || !demo.stdout.includes("MCP reliability check passed.")) {
    throw new Error(`Packed MCP demo failed: ${demo.stderr}`);
  }
  const command = "npx --yes resilireplay@latest mcp demo";
  const transcript = `$ ${command}\n\n${demo.stdout.trim()}\n`;
  const assetRoot = join(root, "docs", "assets");
  await writeFile(join(assetRoot, "mcp-demo-v0.7.0-transcript.txt"), transcript, "utf8");
  const tarballSha256 = createHash("sha256")
    .update(await readFile(tarball))
    .digest("hex");
  const outputSha256 = createHash("sha256").update(demo.stdout).digest("hex");
  await writeFile(
    join(assetRoot, "mcp-demo-v0.7.0.json"),
    `${JSON.stringify(
      {
        schemaVersion: "1.0",
        command,
        package: filename,
        tarballSha256,
        outputSha256,
        durationMs: demo.durationMs,
        source: "packed-npm-tarball",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`Captured ${filename} MCP demo in ${demo.durationMs}ms (${tarballSha256})`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
