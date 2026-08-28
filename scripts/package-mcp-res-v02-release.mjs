import { constants, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { extname, join, relative, resolve, sep } from "node:path";
import { generateSpdx } from "./generate-mcp-res-sbom.mjs";

const root = resolve(import.meta.dirname, "..");
const standardRoot = join(root, "docs", "standards", "mcp-res");
const versionRoot = join(standardRoot, "v0.2.0");
const output = resolve(process.argv[2] ?? join(root, ".artifacts", "mcp-res-v02-release"));
if (!output.startsWith(`${root}${sep}`))
  throw new Error("Release output must stay inside the repository");
await mkdir(output, { recursive: false });

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}

async function collect(directory, predicate = () => true) {
  const result = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Release input contains a symlink: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && predicate(path)) result.push(path);
    }
  }
  await walk(directory);
  return result.sort((left, right) =>
    relative(directory, left).localeCompare(relative(directory, right), "en"),
  );
}

async function aggregate(directory, predicate) {
  const files = [];
  for (const path of await collect(directory, predicate)) {
    const bytes = await readFile(path);
    files.push({
      path: relative(directory, path).replaceAll("\\", "/"),
      bytes: bytes.length,
      sha256: digest(bytes),
      contentUtf8: bytes.toString("utf8"),
    });
  }
  return `${JSON.stringify({ schemaVersion: "mcp-res.release-bundle/0.2.0", standardVersion: "0.2.0", files }, null, 2)}\n`;
}

const sourceCommit = git("rev-parse", "HEAD");
const sourceTree = git("rev-parse", "HEAD^{tree}");
const createdAt = new Date(git("show", "-s", "--format=%cI", "HEAD")).toISOString();
const topLevelMarkdown = [
  "README.md",
  "STATUS.md",
  "GOVERNANCE.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "NAMING.md",
].map((name) => join(standardRoot, name));
const versionMarkdown = await collect(versionRoot, (path) => extname(path) === ".md");
let markdown = "# MCP Reliability Evidence Standard v0.2.0 — Draft 1\n\n";
for (const path of [...topLevelMarkdown, ...versionMarkdown]) {
  markdown += `\n---\n\n<!-- ${relative(root, path).replaceAll("\\", "/")} -->\n\n${await readFile(path, "utf8")}`;
}
const attachments = new Map([
  ["MCP-RES-v0.2.0-draft.1.md", markdown],
  [
    "mcp-res-v0.2.0-schemas.json",
    await aggregate(join(versionRoot, "schemas"), (path) => path.endsWith(".json")),
  ],
  ["mcp-res-v0.2.0-test-vectors.json", await aggregate(join(versionRoot, "test-vectors"))],
  ["mcp-res-v0.2.0-conformance-kit.json", await aggregate(join(versionRoot, "conformance-kit"))],
  ["mcp-res-v0.2.0-profiles.json", await aggregate(join(versionRoot, "profiles"))],
  [
    "mcp-res-v0.2.0-official-conformance-fixtures.json",
    await aggregate(join(versionRoot, "official-conformance")),
  ],
]);
for (const [name, content] of attachments) {
  await writeFile(join(output, name), content, { encoding: "utf8", flag: "wx" });
}
await copyFile(
  join(root, "scripts", "migrate-mcp-res-v01-to-v02.mjs"),
  join(output, "mcp-res-v0.1-to-v0.2-migrate.source.mjs"),
  constants.COPYFILE_EXCL,
);
const metadata = {
  schemaVersion: "mcp-res.release-metadata/0.2.0",
  standardVersion: "0.2.0",
  releaseName: "mcp-res-v0.2.0-draft.1",
  sourceRepository: "https://github.com/aliengineering-byte/resilireplay",
  sourceCommit,
  sourceTree,
  createdAt,
  npmPublishAllowed: false,
  slsaLevelClaim: null,
  migrationTool: {
    asset: "mcp-res-v0.1-to-v0.2-migrate.source.mjs",
    execution: "pnpm mcp-res:migrate from an exact repository checkout",
    standalone: false,
  },
  authenticityBoundary:
    "GitHub-hosted attestations are optional release provenance; local MCP-RES attestations remain offline-capable.",
};
await writeFile(join(output, "release-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
});
await generateSpdx(output, {
  sourceCommit,
  createdAt,
  outputName: "mcp-res-v0.2.0.spdx.json",
});
const releaseFiles = (await readdir(output, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();
const sums = [];
for (const name of releaseFiles)
  sums.push(`${digest(await readFile(join(output, name)))}  ${name}`);
await writeFile(join(output, "SHA256SUMS"), `${sums.join("\n")}\n`, {
  encoding: "utf8",
  flag: "wx",
});
console.log(
  JSON.stringify({
    output,
    releaseAssets: releaseFiles.length + 1,
    sourceCommit,
    sourceTree,
    sbom: "mcp-res-v0.2.0.spdx.json",
    slsaLevelClaim: null,
  }),
);
