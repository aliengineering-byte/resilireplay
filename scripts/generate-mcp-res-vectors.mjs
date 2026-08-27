import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { format as prettierFormat } from "prettier";
import {
  VALIDATOR_IDENTITY,
  materializeIntegrity,
  sha256,
} from "../docs/standards/mcp-res/v0.1.0/conformance-kit/lib.mjs";

const root = resolve(import.meta.dirname, "..");
const standard = join(root, "docs", "standards", "mcp-res", "v0.1.0");
const vectorsDirectory = join(standard, "test-vectors");
const examplesDirectory = join(standard, "examples");
const check = process.argv.includes("--check");
const ZERO = "0".repeat(64);

function digestText(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function baseEvidence(overrides = {}) {
  const runId = overrides.runId ?? "run-example-0001";
  const subject = overrides.subject ?? {
    schemaVersion: "0.1.0",
    subjectType: "MCP_SERVER",
    name: "independent-mcp-fixture",
    version: "1.0.0",
    artifact: {
      kind: "SOURCE",
      identifier: "example/independent-mcp-fixture@1.0.0",
      sha256: digestText("example/independent-mcp-fixture@1.0.0\n"),
    },
    transport: { kind: "STDIO", endpointClass: "LOCAL", authenticated: false },
    configurationProfile: {
      id: "mcp-res/example-config",
      version: "1.0.0",
      sha256: digestText("mcp-res/example-config@1.0.0\n"),
    },
    harness: {
      name: "independent-example-harness",
      version: "1.0.0",
      sha256: digestText("independent-example-harness@1.0.0\n"),
    },
    runtimes: [{ name: "node", version: "24.6.0", sha256: digestText("node@24.6.0\n") }],
  };
  const negativeFault = {
    id: "fault/expected-invalid-result",
    version: "1.0.0",
    method: "FIXTURE_MUTATION",
    seed: 1702,
    targetOperationId: "op-negative",
    activation: { trigger: "AFTER_OPERATION", maxApplications: 1 },
    expectedEffect: "INVALID_RESULT",
    reproducibilitySha256: digestText("fault/expected-invalid-result@1.0.0:1702\n"),
  };
  return {
    schemaVersion: "mcp-res.evidence-envelope/0.1.0",
    standardVersion: "0.1.0",
    profile: { id: "mcp-res/server-tool-call/v1", version: "1.0.0" },
    evidenceClass: "FIXTURE_BACKED_PROTOCOL",
    run: {
      id: runId,
      startedAt: "2026-08-27T12:00:00.000Z",
      finishedAt: "2026-08-27T12:00:01.000Z",
    },
    subject,
    validator: { ...VALIDATOR_IDENTITY },
    execution: {
      actualRuntime: false,
      protocolMessagesExchanged: true,
      fixtureUsed: true,
      installationExecuted: false,
      regressionExecuted: false,
    },
    limits: {
      inputBytes: 1048576,
      eventCount: 1000,
      nestingDepth: 32,
      stringBytes: 65536,
      retryCount: 2,
      concurrency: 1,
      scenarioDurationMs: 10000,
      totalDurationMs: 30000,
      generatedOutputBytes: 1048576,
    },
    operations: [
      {
        runId,
        operationId: "op-clean",
        parentOperationId: null,
        kind: "CLEAN_CONTROL",
        faultId: null,
        recoveryPolicyId: null,
        attempt: 0,
        outcome: "PASS",
        startedOffsetMs: 0,
        durationMs: 25,
      },
      {
        runId,
        operationId: "op-negative",
        parentOperationId: null,
        kind: "NEGATIVE_CONTROL",
        faultId: negativeFault.id,
        recoveryPolicyId: null,
        attempt: 0,
        outcome: "EXPECTED_FAILURE",
        startedOffsetMs: 100,
        durationMs: 25,
      },
    ],
    faults: [negativeFault],
    recoveryPolicies: [],
    cleanup: {
      complete: true,
      childProcessesRemaining: 0,
      listenersRemaining: 0,
      temporaryArtifacts: "REMOVED",
      targetState: "CLEAN",
      partialOutput: "COMPLETE",
      durationMs: 5,
    },
    privacy: {
      credentialsOmitted: true,
      authorizationHeadersOmitted: true,
      environmentValuesOmitted: true,
      promptsOmitted: true,
      toolBodiesOmitted: true,
      personalPathsOmitted: true,
      summariesBounded: true,
      oneWayIdentities: true,
      scanPassed: true,
    },
  };
}

function finalize(evidence, result = "PASS") {
  const statement = {
    schemaVersion: "mcp-res.conformance-statement/0.1.0",
    standardVersion: evidence.standardVersion,
    profileId: evidence.profile.id,
    profileVersion: evidence.profile.version,
    subjectType: evidence.subject.subjectType,
    subjectName: evidence.subject.name ?? "missing",
    subjectVersion: evidence.subject.version ?? "missing",
    evidenceClass: evidence.evidenceClass,
    result,
    evidenceSha256: sha256(evidence),
    validatorName: evidence.validator.name,
    validatorVersion: evidence.validator.version,
    validatorSha256: evidence.validator.sha256,
    verifiedAt: "2026-08-27T12:05:00.000Z",
  };
  return {
    schemaVersion: "mcp-res.conformance-bundle/0.1.0",
    evidence,
    statement,
    integrity: materializeIntegrity(evidence, statement),
  };
}

function clone(value) {
  return structuredClone(value);
}

function addBoundedFailure(evidence, recovered) {
  const fault = {
    id: "fault/tool-error",
    version: "1.0.0",
    method: "RETURN_ERROR",
    seed: 42,
    targetOperationId: "op-fault",
    activation: { trigger: "DURING_OPERATION", maxApplications: 1 },
    expectedEffect: "FAILURE",
    reproducibilitySha256: digestText("fault/tool-error@1.0.0:42\n"),
  };
  const policy = {
    id: "recovery/bounded-read",
    retryLimit: recovered ? 1 : 0,
    timeLimitMs: 2000,
    cancellationBoundary: "PER_OPERATION",
    backoff: { kind: recovered ? "FIXED" : "NONE", maxDelayMs: recovered ? 10 : 0 },
    sideEffectModel: "READ_ONLY",
    safetyMechanism: null,
    terminalOutcomes: recovered ? ["PASS", "FAIL"] : ["EXPECTED_FAILURE"],
  };
  evidence.operations.splice(1, 0, {
    runId: evidence.run.id,
    operationId: "op-fault",
    parentOperationId: null,
    kind: "FAULT_CASE",
    faultId: fault.id,
    recoveryPolicyId: policy.id,
    attempt: 0,
    outcome: "EXPECTED_FAILURE",
    startedOffsetMs: 40,
    durationMs: 20,
  });
  if (recovered) {
    evidence.operations.splice(2, 0, {
      runId: evidence.run.id,
      operationId: "op-recovery",
      parentOperationId: "op-fault",
      kind: "RECOVERY_ATTEMPT",
      faultId: null,
      recoveryPolicyId: policy.id,
      attempt: 1,
      outcome: "PASS",
      startedOffsetMs: 65,
      durationMs: 20,
    });
  }
  evidence.faults.push(fault);
  evidence.recoveryPolicies.push(policy);
}

const minimal = finalize(baseEvidence());
const failureEvidence = baseEvidence({ runId: "run-example-0002" });
addBoundedFailure(failureEvidence, false);
const recoveredEvidence = baseEvidence({ runId: "run-example-0003" });
addBoundedFailure(recoveredEvidence, true);
const regressionEvidence = baseEvidence({ runId: "run-example-0004" });
addBoundedFailure(regressionEvidence, true);
regressionEvidence.execution.regressionExecuted = true;
regressionEvidence.regression = {
  provided: true,
  generatedWithoutExecution: true,
  containedOutput: true,
  deterministicDependencies: true,
  brokenConditionFails: true,
  fixedConditionPasses: true,
  secretScanPassed: true,
  runtimeRequirements: ["Node.js 22 or 24"],
};
const stdioEvidence = baseEvidence({ runId: "run-example-0005" });
stdioEvidence.subject.name = "sanitized-local-stdio-server";
stdioEvidence.subject.artifact.identifier = "example/sanitized-local-stdio-server@1.0.0";
stdioEvidence.subject.artifact.sha256 = digestText("sanitized-local-stdio-server@1.0.0\n");
const httpEvidence = baseEvidence({ runId: "run-example-0006" });
httpEvidence.subject.name = "sanitized-loopback-http-server";
httpEvidence.subject.artifact.identifier = "example/sanitized-loopback-http-server@1.0.0";
httpEvidence.subject.artifact.sha256 = digestText("sanitized-loopback-http-server@1.0.0\n");
httpEvidence.subject.transport = {
  kind: "STREAMABLE_HTTP",
  endpointClass: "LOOPBACK",
  authenticated: true,
};
const negativeEvidence = baseEvidence({ runId: "run-example-0007" });
negativeEvidence.run.finishedAt = "2026-08-27T12:00:00.500Z";

const valid = [
  ["minimal-valid-clean-control", minimal],
  ["bounded-failure-without-recovery", finalize(failureEvidence)],
  ["bounded-successful-recovery", finalize(recoveredEvidence)],
  ["expected-failure-negative-control", finalize(negativeEvidence)],
  ["executable-regression-profile", finalize(regressionEvidence)],
  ["sanitized-local-stdio", finalize(stdioEvidence)],
  ["sanitized-loopback-http", finalize(httpEvidence)],
];

function invalidFrom(name, diagnostic, mutate, options = {}) {
  const bundle = clone(options.source ?? minimal);
  mutate(bundle);
  if (options.refinalize !== false) {
    const rebuilt = finalize(bundle.evidence, bundle.statement?.result ?? "PASS");
    bundle.statement = rebuilt.statement;
    bundle.integrity = rebuilt.integrity;
  }
  return [name, bundle, diagnostic];
}

const invalid = [
  invalidFrom("missing-clean-control", "MCP_RES_MISSING_CLEAN_CONTROL", (bundle) => {
    bundle.evidence.operations = bundle.evidence.operations.filter(
      (operation) => operation.kind !== "CLEAN_CONTROL",
    );
  }),
  invalidFrom("vacuous-negative-control", "MCP_RES_VACUOUS_NEGATIVE_CONTROL", (bundle) => {
    bundle.evidence.operations.find((operation) => operation.kind === "NEGATIVE_CONTROL").outcome =
      "PASS";
  }),
  invalidFrom("unbounded-retry", "MCP_RES_UNBOUNDED_RETRY", (bundle) => {
    const evidence = clone(recoveredEvidence);
    evidence.recoveryPolicies[0].retryLimit = "unbounded";
    bundle.evidence = evidence;
  }),
  invalidFrom("missing-cleanup", "MCP_RES_CLEANUP_INCOMPLETE", (bundle) => {
    delete bundle.evidence.cleanup;
  }),
  invalidFrom(
    "altered-evidence-hash",
    "MCP_RES_DIGEST_MISMATCH",
    (bundle) => {
      bundle.integrity.artifacts.find(
        (artifact) => artifact.path === "evidence-envelope.json",
      ).sha256 = ZERO;
    },
    { refinalize: false },
  ),
  invalidFrom(
    "partial-manifest",
    "MCP_RES_PARTIAL_MANIFEST",
    (bundle) => {
      bundle.integrity.complete = false;
      bundle.integrity.publication = "STAGING";
    },
    { refinalize: false },
  ),
  invalidFrom("encoded-secret", "MCP_RES_SECRET_DETECTED", (bundle) => {
    bundle.evidence.subject.name = "QXV0aG9yaXphdGlvbjogQmVhcmVyIFRFU1RfT05MWV9OT1RfQV9TRUNSRVQ=";
  }),
  invalidFrom("raw-authorization-header", "MCP_RES_AUTH_HEADER_FORBIDDEN", (bundle) => {
    bundle.evidence.subject.authorizationHeader = "Authorization: Bearer TEST_ONLY_NOT_A_SECRET";
  }),
  invalidFrom("ambiguous-subject-identity", "MCP_RES_SUBJECT_AMBIGUOUS", (bundle) => {
    delete bundle.evidence.subject.version;
  }),
  invalidFrom("unsupported-profile-version", "MCP_RES_PROFILE_UNSUPPORTED", (bundle) => {
    bundle.evidence.profile.version = "2.0.0";
  }),
  invalidFrom("causal-mismatch", "MCP_RES_CAUSAL_MISMATCH", (bundle) => {
    bundle.evidence.operations.find((operation) => operation.kind === "NEGATIVE_CONTROL").runId =
      "run-wrong-9999";
  }),
  invalidFrom(
    "side-effecting-retry-without-safety",
    "MCP_RES_SIDE_EFFECT_RETRY_UNSAFE",
    (bundle) => {
      const evidence = clone(recoveredEvidence);
      evidence.recoveryPolicies[0].sideEffectModel = "SIDE_EFFECTING";
      evidence.recoveryPolicies[0].safetyMechanism = null;
      bundle.evidence = evidence;
    },
  ),
  invalidFrom("oversized-evidence", "MCP_RES_EVIDENCE_TOO_LARGE", (bundle) => {
    bundle.evidence.limits.stringBytes = 1048577;
  }),
  invalidFrom("nondeterministic-identity-field", "MCP_RES_NONDETERMINISTIC_IDENTITY", (bundle) => {
    bundle.evidence.subject.absolutePath = "/tmp/build-123/subject";
  }),
  invalidFrom("invalid-evidence-class-promotion", "MCP_RES_EVIDENCE_CLASS_PROMOTION", (bundle) => {
    bundle.evidence.evidenceClass = "GENUINE_RUNTIME";
    bundle.evidence.execution.actualRuntime = true;
  }),
  invalidFrom("cleanup-interruption", "MCP_RES_CLEANUP_INCOMPLETE", (bundle) => {
    bundle.evidence.cleanup.complete = false;
    bundle.evidence.cleanup.childProcessesRemaining = 1;
    bundle.evidence.cleanup.partialOutput = "INCOMPLETE_MARKED";
  }),
  invalidFrom("unknown-execution-field", "MCP_RES_SCHEMA_INVALID", (bundle) => {
    bundle.evidence.execution.networkCapture = false;
  }),
  invalidFrom("invalid-executable-regression", "MCP_RES_REGRESSION_INVALID", (bundle) => {
    const evidence = clone(regressionEvidence);
    evidence.regression.brokenConditionFails = false;
    bundle.evidence = evidence;
  }),
];

const files = new Map();
for (const [name, bundle] of valid) {
  files.set(`valid/${name}.json`, await prettierFormat(JSON.stringify(bundle), { parser: "json" }));
}
for (const [name, bundle] of invalid) {
  files.set(
    `invalid/${name}.json`,
    await prettierFormat(JSON.stringify(bundle), { parser: "json" }),
  );
}

const catalog = {
  schemaVersion: "mcp-res.test-vector-catalog/0.1.0",
  canonicalizationAlgorithm: "mcp-res-json-utf16-v1",
  valid: valid.map(([name]) => ({
    id: name,
    path: `valid/${name}.json`,
    expectedDiagnostics: [],
    fileSha256: digestText(files.get(`valid/${name}.json`)),
  })),
  invalid: invalid.map(([name, , diagnostic]) => ({
    id: name,
    path: `invalid/${name}.json`,
    expectedDiagnostics: [diagnostic],
    fileSha256: digestText(files.get(`invalid/${name}.json`)),
  })),
};
files.set("catalog.json", await prettierFormat(JSON.stringify(catalog), { parser: "json" }));
files.set(
  "SHA256SUMS",
  `${[...files.entries()]
    .map(([path, bytes]) => `${digestText(bytes)}  ${path.replaceAll("\\", "/")}`)
    .sort()
    .join("\n")}\n`,
);

const examples = new Map([
  ["hand-authored-valid.json", files.get("valid/minimal-valid-clean-control.json")],
  ["hand-authored-invalid.json", files.get("invalid/missing-clean-control.json")],
]);

async function emit(path, content) {
  if (check) {
    let current;
    try {
      current = await readFile(path, "utf8");
    } catch {
      throw new Error(`Missing generated file: ${path}`);
    }
    if (current !== content) throw new Error(`Generated file is stale: ${path}`);
    return;
  }
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
}

for (const [relative, content] of files) await emit(join(vectorsDirectory, relative), content);
for (const [relative, content] of examples) await emit(join(examplesDirectory, relative), content);

console.log(
  `MCP-RES vectors ${check ? "verified" : "generated"}: ${valid.length} valid, ${invalid.length} invalid, canonical sample ${sha256(JSON.parse(files.get("valid/minimal-valid-clean-control.json")))}`,
);
