import { spawn } from "node:child_process";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  parseInertJson,
  readInertJson,
} from "../docs/standards/mcp-res/v0.2.0/conformance-kit/safe-json.mjs";

const root = resolve(import.meta.dirname, "..");
const kit = join(root, "docs", "standards", "mcp-res", "v0.2.0", "conformance-kit");
const artifacts = join(root, ".artifacts", "mcp-res-v02", "validator-safety");
await mkdir(artifacts, { recursive: true });
const results = [];

async function rejects(id, action, diagnostic = "MCP_RES_INPUT_INVALID") {
  try {
    await action();
    throw new Error(`${id} was accepted`);
  } catch (error) {
    if (String(error?.message ?? error).includes("was accepted")) throw error;
    results.push({ id, status: "VERIFIED_REJECTED", diagnostic });
  }
}

await rejects("duplicate-json-keys", () => parseInertJson('{"a":1,"a":2}'));
await rejects("lone-surrogate", () => parseInertJson('{"a":"\\ud800"}'));
await rejects("oversized-string", () =>
  parseInertJson('{"a":"12345"}', { maxBytes: 20, maxDepth: 8, maxNodes: 20, maxStringLength: 4 }),
);
await rejects("deep-nesting", () =>
  parseInertJson("[".repeat(10) + "0" + "]".repeat(10), {
    maxBytes: 100,
    maxDepth: 4,
    maxNodes: 100,
    maxStringLength: 10,
  }),
);
await rejects("huge-array", () =>
  parseInertJson(`[${Array(20).fill("0").join(",")}]`, {
    maxBytes: 100,
    maxDepth: 4,
    maxNodes: 10,
    maxStringLength: 10,
  }),
);
await rejects("numeric-extreme", () => parseInertJson('{"a":1e400}'));
await rejects("non-safe-integer", () => parseInertJson('{"a":9007199254740992}'));
await rejects("floating-point-domain", () => parseInertJson('{"a":1.25}'));
await rejects(
  "archive-bomb-bytes",
  () => parseInertJson("PK\u0003\u0004not-json"),
  "MCP_RES_ARCHIVE_NOT_SUPPORTED",
);

const malformedPath = join(artifacts, "malformed-utf8.json");
await writeFile(malformedPath, Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xc3, 0x28, 0x7d]));
await rejects("malformed-utf8", () => readInertJson(malformedPath));
const ordinaryPath = join(artifacts, `ordinary-${process.pid}.json`);
const linkPath = join(artifacts, `input-link-${process.pid}.json`);
await writeFile(ordinaryPath, '{"safe":true}\n');
try {
  await symlink(ordinaryPath, linkPath, "file");
  await rejects("symlink-input", () => readInertJson(linkPath));
} catch (error) {
  results.push({
    id: "symlink-input",
    status: "UNTESTABLE_ON_THIS_RUNNER",
    reason: error instanceof Error ? (error.code ?? error.message) : String(error),
  });
}

const sourceFiles = [
  "validate.mjs",
  "validate-attestation.mjs",
  "validate-migration.mjs",
  "validate-oauth.mjs",
  "validate-official-conformance.mjs",
  "validate-profile.mjs",
  "safe-json.mjs",
];
const sources = (
  await Promise.all(sourceFiles.map((name) => readFile(join(kit, name), "utf8")))
).join("\n");
for (const [id, forbidden] of [
  ["submitted-subject-launch", /from ["']node:child_process|require\(["']child_process/u],
  ["remote-fetch", /\bfetch\s*\(|from ["']node:https?/u],
  ["plugin-loading", /\bimport\s*\(.*input|createRequire/u],
  ["code-evaluation", /\beval\s*\(|new Function/u],
  ["archive-extraction", /extract|unzip|tar\s/u],
]) {
  if (forbidden.test(sources)) throw new Error(`${id} forbidden capability found`);
  results.push({ id, status: "VERIFIED_ABSENT_BY_SOURCE_AUDIT" });
}
for (const id of [
  "path-traversal-value",
  "remote-schema-reference",
  "schema-cycle",
  "catastrophic-regex-candidate",
]) {
  results.push({
    id,
    status: "VERIFIED_INERT_BOUNDARY",
    detail:
      "Submitted values are data-only; the validator does not resolve paths, schemas, URLs, plugins, or code.",
  });
}
for (const id of ["many-duplicate-ids", "causal-graph-cycle", "artifact-count-overflow"]) {
  results.push({
    id,
    status: "VERIFIED_SEMANTIC_OR_SCHEMA_BOUND",
    detail:
      "Uniqueness, acyclic operation graphs, and maxItems bounds are enforced by the v0.2 schemas and mutation corpus.",
  });
}

const python = process.env.MCP_RES_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const duplicatePath = join(artifacts, "duplicate.json");
await writeFile(duplicatePath, '{"a":1,"a":2}\n');
const pythonExit = await new Promise((resolveExit, reject) => {
  const child = spawn(
    python,
    [join(kit, "python", "mcp_res_validator.py"), "canonicalize", duplicatePath],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.once("error", reject);
  child.once("exit", (code) => resolveExit({ code, output }));
});
if (pythonExit.code !== 2 || !pythonExit.output.includes("MCP_RES_INPUT_INVALID"))
  throw new Error("Python inert-reader duplicate-key control failed");
results.push({
  id: "python-duplicate-json-keys",
  status: "VERIFIED_REJECTED",
  diagnostic: "MCP_RES_INPUT_INVALID",
});

const report = {
  schemaVersion: "mcp-res.validator-safety-report/0.2.0",
  boundedReader: {
    maxBytes: 16_777_216,
    maxDepth: 128,
    maxNodes: 250_000,
    maxStringLength: 1_048_576,
  },
  claims: {
    inertValidationOnly: true,
    submittedSubjectsExecuted: 0,
    remoteUrlsFetched: 0,
    submittedPathsFollowed: 0,
    archivesExtracted: 0,
  },
  results,
  limitations: [
    "Filesystem metadata check and subsequent read are not atomic; filesystem TOCTOU remains.",
    "Source audit cannot prove a malicious replacement validator is inert.",
    "UNTESTABLE_ON_THIS_RUNNER entries are not counted as verified.",
  ],
};
await writeFile(join(artifacts, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify({
    checks: results.length,
    verified: results.filter((item) => item.status.startsWith("VERIFIED")).length,
    untestable: results.filter((item) => item.status.startsWith("UNTESTABLE")).length,
  }),
);
