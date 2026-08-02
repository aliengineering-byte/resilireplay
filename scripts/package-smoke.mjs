import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(".");
const artifacts = join(root, ".artifacts", "package-smoke");
const pnpmEntry = process.env.npm_execpath;
if (!pnpmEntry) throw new Error("pnpm executable entrypoint is unavailable");
await rm(artifacts, { recursive: true, force: true });
await mkdir(artifacts, { recursive: true });

const packages = ["core", "trace", "reporters", "mcp-chaos", "cli"];
for (const name of packages) {
  const result = spawnSync(process.execPath, [pnpmEntry, "pack", "--pack-destination", artifacts], {
    cwd: join(root, "packages", name),
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(
      `pnpm pack failed for ${name}: ${result.error?.message ?? `exit ${result.status}`}`,
    );
}

const tarballNames = (await readdir(artifacts)).filter((name) => name.endsWith(".tgz"));
const tarballs = packages.map((packageName) => {
  const prefix = packageName === "cli" ? "resilireplay-0.2.0" : `resilireplay-${packageName}-0.2.0`;
  const name = tarballNames.find((candidate) => candidate.startsWith(prefix));
  if (!name) throw new Error(`Packed tarball not found for ${packageName}`);
  return `file:${join(artifacts, name)}`;
});
const project = join(artifacts, "installed");
await mkdir(project, { recursive: true });
const packageNames = [
  "@resilireplay/core",
  "@resilireplay/trace",
  "@resilireplay/reporters",
  "@resilireplay/mcp-chaos",
  "resilireplay",
];
const localPackages = Object.fromEntries(
  packageNames.map((packageName, index) => [packageName, tarballs[index]]),
);
await writeFile(
  join(project, "package.json"),
  `${JSON.stringify(
    {
      name: "resilireplay-package-smoke",
      version: "1.0.0",
      private: true,
      type: "module",
      dependencies: localPackages,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
await writeFile(
  join(project, "pnpm-workspace.yaml"),
  `packages: []\noverrides:\n${Object.entries(localPackages)
    .map(
      ([name, specifier]) =>
        `  ${JSON.stringify(name)}: ${JSON.stringify(specifier.replaceAll("\\", "/"))}`,
    )
    .join("\n")}\n`,
  "utf8",
);
const install = spawnSync(process.execPath, [pnpmEntry, "install"], {
  cwd: project,
  stdio: "inherit",
  windowsHide: true,
});
if (install.status !== 0) throw new Error("Installing packed workspaces failed");
const cli = join(project, "node_modules", "resilireplay", "bin", "resilireplay.mjs");
const smoke = spawnSync(process.execPath, [cli, "--version"], {
  cwd: project,
  encoding: "utf8",
  windowsHide: true,
});
if (smoke.status !== 0 || smoke.stdout.trim() !== "0.2.0") {
  throw new Error(`Installed CLI smoke failed: ${smoke.stdout} ${smoke.stderr}`);
}
console.log(`Package installation smoke passed: ${smoke.stdout.trim()}`);
