import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const artifacts = join(root, ".artifacts");
await mkdir(artifacts, { recursive: true });

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function packageOnce(prefix) {
  const parent = await mkdtemp(join(artifacts, prefix));
  const output = join(parent, "release");
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts", "package-mcp-res-v02-release.mjs"), output],
    { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
  );
  invariant(result.status === 0, `Release packaging failed: ${result.stderr || result.stdout}`);
  return output;
}

async function manifest(directory) {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile()) result[entry.name] = digest(await readFile(join(directory, entry.name)));
  }
  return result;
}

async function verifyReleaseDirectory(directory) {
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const checksumLines = (await readFile(join(directory, "SHA256SUMS"), "utf8"))
    .trimEnd()
    .split("\n");
  const checksummedNames = [];
  for (const line of checksumLines) {
    const match = /^([a-f0-9]{64}) {2}([^/\\]+)$/u.exec(line);
    invariant(Boolean(match), `Malformed SHA256SUMS line: ${line}`);
    const [, expected, name] = match;
    checksummedNames.push(name);
    invariant(
      digest(await readFile(join(directory, name))) === expected,
      `Release checksum mismatch: ${name}`,
    );
  }
  invariant(
    JSON.stringify(checksummedNames.sort()) ===
      JSON.stringify(names.filter((name) => name !== "SHA256SUMS")),
    "SHA256SUMS does not cover every non-manifest release asset exactly once",
  );

  const sbom = JSON.parse(await readFile(join(directory, "mcp-res-v0.2.0.spdx.json"), "utf8"));
  invariant(sbom.spdxVersion === "SPDX-2.3", "Unexpected SBOM version");
  invariant(
    JSON.stringify(sbom.documentDescribes) === JSON.stringify(["SPDXRef-Package-MCP-RES-v0.2.0"]),
    "SBOM does not describe the MCP-RES package",
  );
  const sbomNames = sbom.files.map((file) => file.fileName.replace(/^\.\//u, "")).sort();
  const expectedSbomNames = names
    .filter((name) => !["SHA256SUMS", "mcp-res-v0.2.0.spdx.json"].includes(name))
    .sort();
  invariant(
    JSON.stringify(sbomNames) === JSON.stringify(expectedSbomNames),
    "SBOM file inventory is incomplete",
  );
  for (const file of sbom.files) {
    const name = file.fileName.replace(/^\.\//u, "");
    const checksum = file.checksums.find((entry) => entry.algorithm === "SHA256")?.checksumValue;
    invariant(
      checksum === digest(await readFile(join(directory, name))),
      `SBOM checksum mismatch: ${name}`,
    );
  }
  invariant(
    /^[a-f0-9]{40}$/u.test(
      sbom.packages[0]?.packageVerificationCode?.packageVerificationCodeValue ?? "",
    ),
    "SBOM package verification code is missing",
  );
}

const first = await packageOnce("mcp-res-provenance-a-");
const second = await packageOnce("mcp-res-provenance-b-");
await verifyReleaseDirectory(first);
await verifyReleaseDirectory(second);
invariant(
  JSON.stringify(await manifest(first)) === JSON.stringify(await manifest(second)),
  "v0.2 release assets are not byte-reproducible",
);
const metadata = JSON.parse(await readFile(join(first, "release-metadata.json"), "utf8"));
const head = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
}).stdout.trim();
invariant(metadata.sourceCommit === head, "Release metadata is not bound to HEAD");
invariant(
  metadata.npmPublishAllowed === false,
  "Standards release metadata permits npm publishing",
);
invariant(metadata.slsaLevelClaim === null, "Release metadata claims an unmeasured SLSA level");
const npmWorkflow = await readFile(join(root, ".github", "workflows", "npm-publish.yml"), "utf8");
invariant(
  npmWorkflow.includes("startsWith(github.event.release.tag_name, 'v')") &&
    !npmWorkflow.includes("startsWith(github.event.release.tag_name, 'mcp-res-v')"),
  "Standards tags can enter the npm publish job",
);
const provenanceWorkflow = await readFile(
  join(root, ".github", "workflows", "mcp-res-release.yml"),
  "utf8",
);
for (const requirement of [
  'tags: ["mcp-res-v*"]',
  "id-token: write",
  "attestations: write",
  "actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8",
  "actions/attest@508db95dd578ae2727ebd6217d5ba78e4fbda05d",
  "pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86",
  "gh attestation verify",
]) {
  invariant(
    provenanceWorkflow.includes(requirement),
    `Missing provenance workflow control: ${requirement}`,
  );
}
console.log(
  JSON.stringify({
    reproducibleReleaseAssets: true,
    sourceCommitBound: head,
    sbomGenerated: true,
    githubProvenanceConfigured: true,
    cleanJobVerificationConfigured: true,
    standardsTagNpmIsolation: true,
    slsaLevelClaim: null,
  }),
);
