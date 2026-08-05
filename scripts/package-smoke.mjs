import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

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
  "package.json",
];
if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error(`Unexpected package contents: ${actualFiles.join(", ")}`);
}

const cli = join(installedRoot, "bin", "resilireplay.mjs");
for (const [arguments_, expectation] of [
  [["--version"], sourceManifest.version],
  [["--help"], "Usage: resilireplay"],
  [["faults"], "malformed-json"],
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

console.log(`Single-package npm installation smoke passed: resilireplay ${sourceManifest.version}`);
