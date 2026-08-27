import { constants, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const standard = join(root, "docs", "standards", "mcp-res");
const version = join(standard, "v0.1.0");
const output = resolve(process.argv[2] ?? join(root, ".artifacts", "mcp-res-release"));
if (!output.startsWith(`${root}${sep}`))
  throw new Error("Release output must stay inside the repository");
await mkdir(output, { recursive: true });

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function collect(directory, predicate = () => true) {
  const result = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (predicate(path)) result.push(path);
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
      sha256: sha256(bytes),
      contentUtf8: bytes.toString("utf8"),
    });
  }
  return `${JSON.stringify({ schemaVersion: "mcp-res.release-bundle/0.1.0", standardVersion: "0.1.0", files }, null, 2)}\n`;
}

const normativePaths = [
  join(standard, "README.md"),
  join(standard, "STATUS.md"),
  join(standard, "GOVERNANCE.md"),
  join(standard, "CONTRIBUTING.md"),
  join(standard, "CHANGELOG.md"),
  join(standard, "NAMING.md"),
  join(version, "MCP_RES.md"),
  join(version, "TERMINOLOGY.md"),
  join(version, "CONFORMANCE.md"),
  join(version, "SECURITY_CONSIDERATIONS.md"),
  join(version, "RESEARCH.md"),
  join(version, "ADVERSARIAL_REVIEW.md"),
  join(version, "REFERENCE_IMPLEMENTATION.md"),
  join(version, "FIELD_EVIDENCE.md"),
];
let markdown = "# MCP Reliability Evidence Standard v0.1.0 — Draft 1\n\n";
for (const path of normativePaths) {
  markdown += `\n---\n\n<!-- ${relative(root, path).replaceAll("\\", "/")} -->\n\n${await readFile(path, "utf8")}`;
}

const attachments = new Map([
  ["MCP-RES-v0.1.0-draft.1.md", markdown],
  [
    "mcp-res-v0.1.0-schemas.json",
    await aggregate(join(version, "schemas"), (path) => path.endsWith(".json")),
  ],
  ["mcp-res-v0.1.0-test-vectors.json", await aggregate(join(version, "test-vectors"))],
  ["mcp-res-v0.1.0-conformance-kit.json", await aggregate(join(version, "conformance-kit"))],
]);
for (const [name, content] of attachments) {
  await writeFile(join(output, name), content, { encoding: "utf8", flag: "wx" });
}

for (const name of ["resilireplay-mcp-demo.mcp-res.json", "mcp-everything-2026.7.4.mcp-res.json"]) {
  await copyFile(
    join(version, "field-evidence", name),
    join(output, name),
    constants.COPYFILE_EXCL,
  );
}
await copyFile(
  join(root, ".artifacts", "mcp-res", "verification.json"),
  join(output, "verification.json"),
  constants.COPYFILE_EXCL,
);

const releaseFiles = (await readdir(output, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();
const sums = [];
for (const name of releaseFiles)
  sums.push(`${sha256(await readFile(join(output, name)))}  ${name}`);
await writeFile(join(output, "SHA256SUMS"), `${sums.join("\n")}\n`, {
  encoding: "utf8",
  flag: "wx",
});
console.log(`MCP-RES release bundle created: ${output} (${releaseFiles.length + 1} files)`);
