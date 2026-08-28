import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sources = process.argv.slice(2).map((item) => resolve(item));
if (!sources.length) sources.push(join(root, ".artifacts"));
const output = join(
  root,
  "docs",
  "standards",
  "mcp-res",
  "v0.2.0",
  "field-evidence",
  "FIELD_CORPUS.json",
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function walk(path, found = []) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await walk(child, found);
    else if (
      [
        "pr3-field-verification.json",
        "oauth-field-verification.json",
        "operational-field-verification.json",
      ].includes(entry.name)
    )
      found.push(child);
  }
  return found;
}
const paths = (await Promise.all(sources.map((source) => walk(source)))).flat();
const rows = [];
const sourceArtifacts = [];
for (const path of paths.sort()) {
  const bytes = await readFile(path);
  const value = JSON.parse(bytes);
  const artifactSha256 = sha(bytes);
  const pathText = path.replaceAll("\\", "/");
  const runId = pathText.includes("/pr3/")
    ? 33132671751
    : pathText.includes("/pr4/")
      ? 33133786355
      : null;
  sourceArtifacts.push({
    name: basename(path),
    sha256: artifactSha256,
    workflowRunId: runId,
    source: runId
      ? `https://github.com/aliengineering-byte/resilireplay/actions/runs/${runId}`
      : "current verification run",
  });
  if (value.schemaVersion === "mcp-res.protocol-field-matrix/0.2.0") {
    for (const row of value.rows)
      rows.push({
        subjectId: `${row.language.toLowerCase()}-loopback-field-subject@sha256:${row.subjectSha256}`,
        subjectSha256: row.subjectSha256,
        testedBy: "ResiliReplay project CI",
        adopter: false,
        language: row.language,
        platform: row.platform,
        runtime: row.language === "PYTHON" ? row.pythonVersion : row.nodeVersion,
        protocolRevision: row.protocolRevision,
        transport: row.transport,
        operation:
          row.transport === "stdio"
            ? "framed initialize, revision rejection, malformed input, shutdown"
            : "authenticated initialize, JSON/SSE selection, interruption, shutdown",
        sideEffectModel: "READ_ONLY",
        evidenceClass: "GENUINE_RUNTIME",
        result: row.result,
        evidenceSha256: row.integrity,
        artifactSha256,
        limitations:
          "Project-owned synthetic subject; bounded local fixture; testing is evaluation, not adoption.",
      });
  } else if (value.schemaVersion === "mcp-res.oauth-field-verification/0.2.0") {
    rows.push({
      subjectId: `oauth-loopback-fixture@sha256:${value.subjectSha256}`,
      subjectSha256: value.subjectSha256,
      testedBy: "ResiliReplay project CI",
      adopter: false,
      language: "TYPESCRIPT",
      platform: value.platform,
      runtime: value.runtimeVersion,
      protocolRevision: value.protocolRevisions.join(" + "),
      transport: "authenticated-loopback-http",
      operation:
        "synthetic authorization-code, PKCE, audience/resource, redirect/state, SSRF and cleanup boundaries",
      sideEffectModel: "SYNTHETIC_CREDENTIAL_STATE",
      evidenceClass: "GENUINE_RUNTIME",
      result: "PASS",
      evidenceSha256: artifactSha256,
      artifactSha256,
      limitations:
        "Synthetic credentials and loopback provider only; not security certification; no real provider contacted.",
    });
  } else if (value.schemaVersion === "mcp-res.operational-field-report/0.2.0") {
    rows.push({
      subjectId: `operational-loopback-worker@sha256:${value.evaluation.subject.artifactSha256}`,
      subjectSha256: value.evaluation.subject.artifactSha256,
      testedBy: "ResiliReplay project CI",
      adopter: false,
      language: "JAVASCRIPT",
      platform: value.environment.platform,
      runtime: value.environment.runtime,
      protocolRevision: "2026-07-28",
      transport: "loopback-http",
      operation:
        "bounded concurrent calls, overload, timeout, fault injection, interruption by process termination, restart, duplicate delivery and shutdown",
      sideEffectModel: "IDEMPOTENCY_GUARDED_SYNTHETIC_EFFECT",
      evidenceClass: "GENUINE_RUNTIME",
      result: value.result,
      evidenceSha256: value.evaluation.evaluationSha256,
      artifactSha256,
      limitations: value.limitations.join("; "),
    });
  }
}

const unique = new Map();
for (const row of rows)
  unique.set(
    [row.subjectId, row.platform, row.runtime, row.protocolRevision, row.transport].join("|"),
    row,
  );
const corpus = {
  schemaVersion: "mcp-res.field-corpus/0.2.0",
  generatedBy: "scripts/aggregate-mcp-res-field-corpus.mjs",
  claimBoundary:
    "Every subject was tested by ResiliReplay. No subject is an adopter absent voluntary independently published evidence.",
  sourceArtifacts: [
    ...new Map(
      sourceArtifacts.map((entry) => [`${entry.sha256}|${entry.workflowRunId}`, entry]),
    ).values(),
  ],
  rows: [...unique.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  supplementalBoundaries: [
    {
      operation: "MRTR input_required transition",
      source: ".artifacts/mcp-res-v02/profile-corpus/async-operation-2026-07-28.json",
      evidenceClass: "SIMULATED",
      result: "INCOMPLETE",
      limitation: "Offline model only; not promoted to field PASS.",
    },
    {
      operation: "Tasks lifecycle and subscription/progress/cancellation",
      source: ".artifacts/mcp-res-v02/profile-corpus/async-operation-2026-07-28.json",
      evidenceClass: "SIMULATED",
      result: "INCOMPLETE",
      limitation: "Official extension model fixture only; no external server was safely launched.",
    },
    {
      operation: "Repeated trial",
      source: "operational-field-verification.json",
      evidenceClass: "GENUINE_RUNTIME",
      result: "PASS",
      limitation: "48 bounded operations; no population-level statistical claim.",
    },
  ],
  summary: {
    distinctSubjectArtifacts: new Set([...unique.values()].map((row) => row.subjectSha256)).size,
    languages: [...new Set([...unique.values()].map((row) => row.language))].sort(),
    platforms: [...new Set([...unique.values()].map((row) => row.platform))].sort(),
    transports: [...new Set([...unique.values()].map((row) => row.transport))].sort(),
    externalAdopters: 0,
    externalTargetsContacted: 0,
  },
};
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, `${JSON.stringify(corpus, null, 2)}\n`, "utf8");
console.log(JSON.stringify(corpus.summary));
