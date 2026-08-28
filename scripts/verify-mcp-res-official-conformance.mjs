import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  importOfficialConformance,
  OFFICIAL_DIAGNOSTICS,
  validateOfficialConformanceAttachment,
} from "../docs/standards/mcp-res/v0.2.0/conformance-kit/official-conformance-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const standard = join(root, "docs", "standards", "mcp-res", "v0.2.0");
const fixtureDirectory = join(standard, "official-conformance");
const schemas = join(standard, "schemas");
const output = join(root, ".artifacts", "mcp-res-v02", "official-conformance-corpus");
await mkdir(output, { recursive: true });

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

const sanitizedBytes = await readFile(
  join(fixtureDirectory, "server-initialize-2025-11-25.sanitized.json"),
);
const capture = JSON.parse(
  await readFile(join(fixtureDirectory, "server-initialize-2025-11-25.capture.json"), "utf8"),
);
const common = {
  source: capture.source,
  protocolRevision: capture.protocolRevision,
  requirementSet: capture.requirementSet,
  mode: capture.execution.mode,
  suite: capture.execution.suite,
  scenarioId: capture.execution.scenario,
  scenarios: [capture.execution.scenario],
  legs: { client: "NOT_EXECUTED", server: "EXECUTED" },
  expectedCheckRefs: [
    "server-initialize:server-initialize",
    "server-initialize:server-session-id-visible-ascii",
    "server-initialize:wire-schema-valid",
  ],
  observationCoverage: [
    { surface: "official-client-harness", status: "INSTRUMENTED" },
    { surface: "server-wire-messages", status: "INSTRUMENTED" },
    { surface: "server-process-cleanup", status: "UNINSTRUMENTED" },
  ],
  originalArtifactSha256: capture.originalResultArtifact.sha256,
  originalArtifactBytes: capture.originalResultArtifact.bytes,
  sanitization: capture.sanitization,
  harnessExitCode: capture.execution.harnessExitCode,
  harnessWarnings: capture.execution.warnings,
};

const capturedAttachment = importOfficialConformance(sanitizedBytes, common);
const capturedValidation = await validateOfficialConformanceAttachment(capturedAttachment, {
  schemaDirectory: schemas,
});
invariant(capturedValidation.valid, JSON.stringify(capturedValidation));
invariant(
  capturedAttachment.importStatus === "INCOMPLETE",
  "The non-zero harness exit or uninstrumented cleanup was incorrectly promoted",
);
invariant(
  capturedAttachment.mappingBoundary.officialCertificationClaim === false &&
    capturedAttachment.mappingBoundary.mcpResEvidenceClass === null,
  "Official output was reinterpreted as MCP certification or MCP-RES evidence",
);
await writeFile(
  join(output, "sanitized-official-capture.attachment.json"),
  `${JSON.stringify(capturedAttachment, null, 2)}\n`,
  "utf8",
);

const cleanChecks = Buffer.from(
  JSON.stringify([
    {
      id: "clean-check",
      status: "SUCCESS",
      metadata: { scenario: "clean-scenario" },
      details: { observed: true },
    },
  ]),
);
const cleanOptions = {
  ...common,
  scenarioId: "clean-scenario",
  scenarios: ["clean-scenario"],
  expectedCheckRefs: ["clean-scenario:clean-check"],
  observationCoverage: [{ surface: "wire", status: "INSTRUMENTED" }],
  harnessExitCode: 0,
  harnessWarnings: [],
  sanitization: { applied: false, fields: [] },
};
delete cleanOptions.originalArtifactSha256;
delete cleanOptions.originalArtifactBytes;
const clean = importOfficialConformance(cleanChecks, cleanOptions);
invariant(clean.importStatus === "COMPLETE", "Complete synthetic import did not remain complete");

const failureBytes = Buffer.from(
  JSON.stringify([
    {
      id: "known-failure",
      status: "FAILURE",
      metadata: { scenario: "failure-scenario" },
      errorMessage: "expected incompatibility",
      details: { reason: "released rule" },
    },
  ]),
);
const failure = importOfficialConformance(failureBytes, {
  ...cleanOptions,
  scenarioId: "failure-scenario",
  scenarios: ["failure-scenario"],
  expectedCheckRefs: ["failure-scenario:known-failure"],
  expectedFailureEntries: ["failure-scenario:known-failure"],
});
invariant(
  failure.checks[0].outcome === "FAILURE" && failure.checks[0].baselineExpected,
  "Expected failure was rewritten as success",
);

const cases = [];
async function record(id, value, diagnostic, validationOptions = {}) {
  const file = `${id}.json`;
  await writeFile(join(output, file), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  const result = await validateOfficialConformanceAttachment(value, {
    schemaDirectory: schemas,
    ...validationOptions,
  });
  invariant(
    result.diagnostics[0] === diagnostic,
    `${id}: expected ${diagnostic}, got ${JSON.stringify(result)}`,
  );
  cases.push({ id, file, expectedDiagnostics: [diagnostic] });
}

const rewritten = structuredClone(failure);
rewritten.checks[0].outcome = "SUCCESS";
await record(
  "expected-failure-rewritten",
  rewritten,
  OFFICIAL_DIAGNOSTICS.EXPECTED_FAILURE_REWRITTEN,
);

const absent = importOfficialConformance(cleanChecks, {
  ...cleanOptions,
  expectedCheckRefs: ["clean-scenario:clean-check", "clean-scenario:absent-check"],
});
invariant(
  absent.importStatus === "INCOMPLETE" &&
    absent.inventories.pending.includes("clean-scenario:absent-check"),
  "An absent official check was counted as complete",
);

const stale = structuredClone(failure);
stale.staleExpectedFailures = ["failure-scenario:known-failure"];
await record("stale-baseline", stale, OFFICIAL_DIAGNOSTICS.STALE_BASELINE_MISMATCH);

await record("altered-output", capturedAttachment, OFFICIAL_DIAGNOSTICS.RESULT_DIGEST_MISMATCH, {
  originalBytes: Buffer.from(`${sanitizedBytes.toString("utf8")} `),
});

const revision = structuredClone(clean);
revision.requirementSet.revision = "2026-07-28";
await record("revision-mismatch", revision, OFFICIAL_DIAGNOSTICS.REVISION_MISMATCH);

const leg = structuredClone(clean);
leg.legs.server = "NOT_EXECUTED";
await record("leg-not-executed", leg, OFFICIAL_DIAGNOSTICS.LEG_NOT_EXECUTED);

const inventory = structuredClone(clean);
inventory.inventories.warnings = ["clean-scenario:clean-check"];
await record("warning-inventory-mutant", inventory, OFFICIAL_DIAGNOSTICS.INVENTORY_MISMATCH);

const mapping = structuredClone(clean);
mapping.mappingBoundary.mcpResEvidenceClass = "GENUINE_RUNTIME";
await record("mapping-overclaim", mapping, OFFICIAL_DIAGNOSTICS.MAPPING_OVERCLAIM);

const invalidFailure = importOfficialConformance(failureBytes, {
  ...cleanOptions,
  scenarioId: "failure-scenario",
  scenarios: ["failure-scenario"],
  expectedCheckRefs: ["failure-scenario:known-failure"],
});
invariant(
  invalidFailure.importStatus === "INVALID" && invalidFailure.checks[0].outcome === "FAILURE",
  "Unexpected official failure did not remain an invalid failure",
);

await writeFile(join(output, "valid-clean.json"), `${JSON.stringify(clean, null, 2)}\n`, "utf8");
await writeFile(
  join(output, "valid-baselined-failure.json"),
  `${JSON.stringify(failure, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(output, "valid-absent-incomplete.json"),
  `${JSON.stringify(absent, null, 2)}\n`,
  "utf8",
);
const catalog = {
  schemaVersion: "mcp-res.official-conformance-test-catalog/0.2.0",
  valid: [
    { id: "clean", file: "valid-clean.json", expectedStatus: "COMPLETE" },
    {
      id: "baselined-failure-preserved",
      file: "valid-baselined-failure.json",
      expectedStatus: "COMPLETE",
    },
    {
      id: "absent-check-incomplete",
      file: "valid-absent-incomplete.json",
      expectedStatus: "INCOMPLETE",
    },
    {
      id: "sanitized-real-output",
      file: "sanitized-official-capture.attachment.json",
      expectedStatus: "INCOMPLETE",
    },
  ],
  invalid: cases,
};
await writeFile(join(output, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify({
    realOfficialChecksPreserved: capturedAttachment.checks.length,
    originalResultSha256: capturedAttachment.originalResultArtifact.sha256,
    realCaptureStatus: capturedAttachment.importStatus,
    completeSyntheticImports: 2,
    incompleteSyntheticImports: 1,
    invalidMutants: cases.length,
    officialCertificationClaim: false,
  }),
);
