import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
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

function run(command, args, cwd, timeoutMs = 120_000) {
  return new Promise((resolveRun, rejectRun) => {
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
      resolveRun({ code: code ?? 1, stdout, stderr });
    });
  });
}

const root = resolve(import.meta.dirname, "..");
const staging = await mkdtemp(join(tmpdir(), "resilireplay-pack-"));
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
  const manifest = JSON.parse(packed.stdout);
  const filename = manifest[0]?.filename;
  if (typeof filename !== "string") throw new Error("npm pack did not return a tarball filename");
  const verified = await run(
    process.execPath,
    [
      join(root, "examples", "mcp-reliability-ci", "verify.mjs"),
      "--tarball",
      join(staging, filename),
      ...(process.argv.includes("--export-regression")
        ? ["--export-regression", process.argv[process.argv.indexOf("--export-regression") + 1]]
        : []),
    ],
    root,
    180_000,
  );
  process.stdout.write(verified.stdout);
  process.stderr.write(verified.stderr);
  if (verified.code !== 0) process.exitCode = verified.code;
} finally {
  await rm(staging, { recursive: true, force: true });
}
