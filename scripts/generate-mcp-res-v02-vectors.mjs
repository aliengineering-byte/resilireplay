import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { format as prettierFormat } from "prettier";
import {
  VALIDATOR_IDENTITY,
  canonicalize,
  executionInstanceDigest,
  materializeIntegrity,
  observationDigest,
  scenarioFingerprint,
  sha256,
  supportingArtifactManifestDigest,
} from "../docs/standards/mcp-res/v0.2.0/conformance-kit/lib.mjs";

const root = resolve(import.meta.dirname, "..");
const standard = join(root, "docs", "standards", "mcp-res", "v0.2.0");
const vectors = join(standard, "test-vectors");
const check = process.argv.includes("--check");

function clone(value) {
  return structuredClone(value);
}

function digestText(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function makeObservation({ id, type, operationRef, reasonCode, durationMs = 5 }) {
  const observation = {
    schemaVersion: "mcp-res.observation/0.2.0",
    id,
    type,
    strength: "INTEGRITY_BOUND",
    producer: { ...VALIDATOR_IDENTITY },
    subjectRef: "",
    operationRef,
    startedOffsetMs: 10,
    durationMs,
    outcome: "PASS",
    reasonCode,
    artifactRefs: [`observations/${id}.json`],
    observationSha256: "0".repeat(64),
  };
  return observation;
}

const ALL_SURFACES = [
  "MCP_WIRE_MESSAGES",
  "RAW_HTTP_REQUESTS",
  "RAW_HTTP_RESPONSES",
  "STDIO_INPUT_OUTPUT",
  "CHILD_PROCESS_LIFECYCLE",
  "TRANSPORT_DISCONNECTS",
  "RETRIES",
  "FILESYSTEM_OUTPUTS",
  "CLEANUP",
  "GENERATED_REGRESSION_EXECUTION",
  "AUTHORIZATION_REDIRECTS",
  "TOKEN_ENDPOINT",
  "CACHE_BEHAVIOR",
  "SOURCE_EVIDENCE",
];

function baseEvidence(runId = "run-v02-example-0001") {
  const subjectCore = {
    subjectType: "MCP_SERVER",
    name: "reason-bound-fixture",
    version: "1.0.0",
    artifactSha256: digestText("reason-bound-fixture@1.0.0\n"),
  };
  const subject = { ...subjectCore, identityDigest: sha256(subjectCore) };
  const fault = {
    id: "fault/invalid-result-shape",
    version: "1.0.0",
    method: "FIXTURE_MUTATION",
    seed: 1702,
    targetOperationClass: "tools/call",
    expectedEffect: "INVALID_RESULT_SHAPE",
    reproducibilitySha256: digestText("fault/invalid-result-shape@1.0.0:1702\n"),
  };
  const policy = {
    id: "policy/read-only-once",
    retryLimit: 1,
    maxBackoffMs: 10,
    timeLimitMs: 1000,
    cancellationBoundary: "operation",
    sideEffectModel: "READ_ONLY",
    safetyMechanism: null,
  };
  const descriptor = {
    standardVersion: "0.2.0",
    profileId: "mcp-res/server-tool-call/v1",
    profileVersion: "2.0.0",
    protocolRevision: "2026-07-28",
    subjectIdentityDigest: subject.identityDigest,
    configurationProfileDigest: digestText("mcp-res/reason-bound-fixture-config@1.0.0\n"),
    operationClass: "tools/call",
    faults: [fault],
    recoveryPolicies: [policy],
    sideEffectModel: "READ_ONLY",
    resourceLimits: {
      inputBytes: 1048576,
      events: 1000,
      retries: 1,
      concurrency: 1,
      scenarioDurationMs: 10000,
    },
    validatorPolicy: { ...VALIDATOR_IDENTITY },
    deterministicSeed: 1702,
  };
  const observations = [
    makeObservation({
      id: "obs-process",
      type: "PROCESS_EXECUTION",
      operationRef: "op-clean",
      reasonCode: "PROCESS_EXITED_CLEANLY",
    }),
    makeObservation({
      id: "obs-protocol",
      type: "PROTOCOL_EXCHANGE",
      operationRef: "op-clean",
      reasonCode: "MCP_MESSAGES_EXCHANGED",
    }),
    makeObservation({
      id: "obs-fixture",
      type: "FIXTURE_EXECUTION",
      operationRef: "op-negative",
      reasonCode: "FIXTURE_MUTANT_EXECUTED",
    }),
    makeObservation({
      id: "obs-negative-oracle",
      type: "VALIDATOR_CHECK",
      operationRef: "op-negative",
      reasonCode: "INVALID_RESULT_SHAPE_REJECTED",
    }),
    makeObservation({
      id: "obs-privacy",
      type: "PRIVACY_SCAN",
      operationRef: null,
      reasonCode: "PRIVACY_SCAN_CLEAR",
    }),
    makeObservation({
      id: "obs-cleanup",
      type: "CLEANUP_CHECK",
      operationRef: null,
      reasonCode: "CLEANUP_COMPLETE",
    }),
  ];
  for (const observation of observations) observation.subjectRef = subject.identityDigest;
  return {
    schemaVersion: "mcp-res.evidence-envelope/0.2.0",
    standardVersion: "0.2.0",
    profile: { id: "mcp-res/server-tool-call/v1", version: "2.0.0" },
    protocolRevision: "2026-07-28",
    evidenceClassClaim: "FIXTURE_BACKED_PROTOCOL",
    subject,
    scenario: { fingerprint: scenarioFingerprint(descriptor), descriptor },
    run: {
      id: runId,
      startedAt: "2026-08-27T12:00:00.000Z",
      finishedAt: "2026-08-27T12:00:01.000Z",
      monotonicDurationMs: 1000,
      environment: {
        runner: { ...VALIDATOR_IDENTITY },
        os: "synthetic",
        architecture: "portable",
        environmentDigest: digestText("synthetic-portable-environment-v1\n"),
      },
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
        faultId: fault.id,
        recoveryPolicyId: policy.id,
        attempt: 0,
        outcome: "EXPECTED_FAILURE",
        startedOffsetMs: 100,
        durationMs: 25,
        negativeObservation: {
          propertyUnderTest: "tools/call result shape validation",
          propertyReached: true,
          expectedVerdict: "REJECT",
          observedVerdict: "REJECT",
          expectedStopReason: "INVALID_RESULT_SHAPE",
          observedStopReason: "INVALID_RESULT_SHAPE",
          oracleEvidenceRef: "observations/obs-negative-oracle.json",
          prerequisitesReached: ["INITIALIZED", "TOOLS_LISTED", "TOOL_CALLED"],
        },
      },
    ],
    observations,
    coverage: {
      schemaVersion: "mcp-res.observation-coverage/0.2.0",
      surfaces: ALL_SURFACES.map((surface) => {
        const mapping = {
          MCP_WIRE_MESSAGES: "obs-protocol",
          STDIO_INPUT_OUTPUT: "obs-protocol",
          CHILD_PROCESS_LIFECYCLE: "obs-process",
          CLEANUP: "obs-cleanup",
        };
        const reference = mapping[surface];
        return {
          surface,
          required: Boolean(reference),
          status: reference ? "INSTRUMENTED" : "NOT_APPLICABLE",
          observationRefs: reference ? [reference] : [],
        };
      }),
    },
    trialSummary: {
      schemaVersion: "mcp-res.trial-summary/0.2.0",
      plannedTrials: 1,
      completedTrials: 1,
      seeds: [1702],
      processCount: 1,
      counts: { success: 1, failure: 0, incomplete: 0 },
      distinctOutcomeHashes: [digestText("PASS:INVALID_RESULT_SHAPE\n")],
      durationMs: { minimum: 1000, median: 1000, p95: 1000 },
      environments: ["synthetic-portable-environment-v1"],
      stopRule: "exactly one bounded trial",
      classification: "SINGLE_OBSERVATION",
    },
    supportingArtifactManifestDigest: "0".repeat(64),
  };
}

function finalize(evidence, result = "PASS") {
  const materializedEvidence = clone(evidence);
  const supportingArtifacts = materializedEvidence.observations.map((observation) => {
    observation.observationSha256 = observationDigest(observation);
    const material = { ...observation };
    delete material.observationSha256;
    return {
      path: observation.artifactRefs[0],
      mediaType: "application/vnd.mcp-res.observation+json",
      bytes: Buffer.byteLength(canonicalize(material)),
      sha256: observation.observationSha256,
    };
  });
  materializedEvidence.supportingArtifactManifestDigest = supportingArtifactManifestDigest([
    ...supportingArtifacts,
  ]);
  const statement = {
    schemaVersion: "mcp-res.conformance-statement/0.2.0",
    standardVersion: "0.2.0",
    profileId: materializedEvidence.profile.id,
    profileVersion: materializedEvidence.profile.version,
    protocolRevision: materializedEvidence.protocolRevision,
    subjectType: materializedEvidence.subject.subjectType,
    subjectName: materializedEvidence.subject.name,
    subjectVersion: materializedEvidence.subject.version,
    evidenceClass: materializedEvidence.evidenceClassClaim,
    result,
    scenarioFingerprint: materializedEvidence.scenario.fingerprint,
    executionInstanceDigest: "0".repeat(64),
    stabilityClassification: materializedEvidence.trialSummary.classification,
    evidenceSha256: "0".repeat(64),
    validator: { ...VALIDATOR_IDENTITY },
    verifiedAt: "2026-08-27T12:01:00.000Z",
  };
  statement.executionInstanceDigest = executionInstanceDigest(materializedEvidence, result);
  statement.evidenceSha256 = sha256(materializedEvidence);
  const integrity = materializeIntegrity(materializedEvidence, statement, supportingArtifacts);
  return {
    schemaVersion: "mcp-res.conformance-bundle/0.2.0",
    evidence: materializedEvidence,
    statement,
    integrity,
  };
}

function invalid(name, diagnostic, mutate, source = finalize(baseEvidence())) {
  const bundle = clone(source);
  mutate(bundle);
  return [name, bundle, diagnostic];
}

const reasonBound = finalize(baseEvidence());
const mutantEvidence = baseEvidence("run-v02-example-0002");
mutantEvidence.operations[1].negativeObservation.mutantId = "mutant/wrong-reason-guard";
mutantEvidence.operations[1].negativeObservation.mutantKilled = true;
const mutantKilled = finalize(mutantEvidence);
const repeatedEvidence = baseEvidence("run-v02-example-0003");
repeatedEvidence.trialSummary = {
  ...repeatedEvidence.trialSummary,
  plannedTrials: 3,
  completedTrials: 3,
  seeds: [1702, 1703, 1704],
  counts: { success: 3, failure: 0, incomplete: 0 },
  durationMs: { minimum: 980, median: 1000, p95: 1040 },
  stopRule: "complete three deterministic seeds",
  classification: "REPEATED_STABLE",
};
const repeatedStable = finalize(repeatedEvidence);
const equivalentRerun = baseEvidence("run-v02-example-0004");
equivalentRerun.run.startedAt = "2026-08-27T13:00:00.000Z";
equivalentRerun.run.finishedAt = "2026-08-27T13:00:01.000Z";
equivalentRerun.run.environment.os = "synthetic-rerun";
const rerunBundle = finalize(equivalentRerun);

const valid = [
  ["reason-bound-negative", reasonBound],
  ["correct-validator-kills-mutant", mutantKilled],
  ["repeated-stable", repeatedStable],
  ["equivalent-scenario-distinct-run", rerunBundle],
];

const invalidVectors = [
  invalid("wrong-stop-reason", "MCP_RES_WRONG_STOP_REASON", (bundle) => {
    bundle.evidence.operations[1].negativeObservation.observedStopReason = "VERSION_UNSUPPORTED";
  }),
  invalid("earlier-version-guard", "MCP_RES_PROPERTY_NOT_REACHED", (bundle) => {
    bundle.evidence.operations[1].negativeObservation.propertyReached = false;
    bundle.evidence.operations[1].negativeObservation.observedStopReason = "VERSION_UNSUPPORTED";
  }),
  invalid("target-property-not-reached", "MCP_RES_PROPERTY_NOT_REACHED", (bundle) => {
    bundle.evidence.operations[1].negativeObservation.propertyReached = "UNKNOWN";
  }),
  invalid("negative-prerequisite-missing", "MCP_RES_NEGATIVE_PREREQUISITE_MISSING", (bundle) => {
    bundle.evidence.operations[1].negativeObservation.prerequisitesReached = [];
  }),
  invalid("verdict-only-false-green", "MCP_RES_WRONG_STOP_REASON", (bundle) => {
    bundle.evidence.operations[1].negativeObservation.observedStopReason = "EARLY_SCHEMA_GUARD";
  }),
  invalid("negative-mutant-survived", "MCP_RES_NEGATIVE_MUTANT_SURVIVED", (bundle) => {
    bundle.evidence.operations[1].negativeObservation.mutantId = "mutant/verdict-only";
    bundle.evidence.operations[1].negativeObservation.mutantKilled = false;
  }),
  invalid("stale-expected-failure-after-fix", "MCP_RES_VACUOUS_NEGATIVE_CONTROL", (bundle) => {
    bundle.evidence.operations[1].negativeObservation.observedVerdict = "PASS";
  }),
  invalid("false-runtime-boolean", "MCP_RES_SELF_ASSERTED_CLAIM", (bundle) => {
    bundle.evidence.execution = { actualRuntime: true };
  }),
  invalid("missing-observation-artifact", "MCP_RES_MISSING_OBSERVATION_ARTIFACT", (bundle) => {
    bundle.integrity.artifacts = bundle.integrity.artifacts.filter(
      (artifact) => artifact.path !== "observations/obs-protocol.json",
    );
  }),
  invalid("mismatched-observation-hash", "MCP_RES_OBSERVATION_HASH_MISMATCH", (bundle) => {
    bundle.evidence.observations[1].observationSha256 = "0".repeat(64);
  }),
  invalid("cross-run-substitution", "MCP_RES_CROSS_RUN_SUBSTITUTION", (bundle) => {
    bundle.evidence.operations[0].runId = "run-v02-foreign-9999";
  }),
  invalid(
    "scenario-fingerprint-collision-attempt",
    "MCP_RES_SCENARIO_FINGERPRINT_MISMATCH",
    (bundle) => {
      bundle.evidence.scenario.descriptor.faults[0].expectedEffect = "DIFFERENT_EFFECT";
    },
  ),
  invalid("uninstrumented-required-surface", "MCP_RES_REQUIRED_SURFACE_UNOBSERVED", (bundle) => {
    const surface = bundle.evidence.coverage.surfaces.find(
      (entry) => entry.surface === "MCP_WIRE_MESSAGES",
    );
    surface.status = "UNINSTRUMENTED";
    surface.observationRefs = [];
  }),
  invalid("falsely-claimed-repeated-stability", "MCP_RES_FALSE_STABILITY_CLAIM", (bundle) => {
    bundle.evidence.trialSummary.classification = "REPEATED_STABLE";
    bundle.statement.stabilityClassification = "REPEATED_STABLE";
  }),
  invalid("inconsistent-trial-counts", "MCP_RES_TRIAL_SUMMARY_INCONSISTENT", (bundle) => {
    bundle.evidence.trialSummary.counts.success = 2;
  }),
  invalid("wall-clock-reversal", "MCP_RES_WALL_CLOCK_REVERSAL", (bundle) => {
    bundle.evidence.run.finishedAt = "2026-08-27T11:59:59.000Z";
  }),
  invalid("operation-parent-cycle", "MCP_RES_OPERATION_PARENT_CYCLE", (bundle) => {
    bundle.evidence.operations[0].parentOperationId = "op-negative";
    bundle.evidence.operations[1].parentOperationId = "op-clean";
  }),
  invalid("retry-attempt-exceeds-policy", "MCP_RES_RETRY_LIMIT_EXCEEDED", (bundle) => {
    bundle.evidence.operations[1].attempt = 2;
  }),
];

const files = new Map();
for (const [name, bundle] of valid) {
  files.set(
    `valid/${name}.json`,
    await prettierFormat(JSON.stringify(bundle), { parser: "json", printWidth: 100 }),
  );
}
for (const [name, bundle] of invalidVectors) {
  files.set(
    `invalid/${name}.json`,
    await prettierFormat(JSON.stringify(bundle), { parser: "json", printWidth: 100 }),
  );
}
const catalog = {
  schemaVersion: "mcp-res.test-vector-catalog/0.2.0",
  canonicalizationAlgorithm: "mcp-res-json-utf16-v1",
  valid: valid.map(([name]) => ({
    id: name,
    path: `valid/${name}.json`,
    expectedDiagnostics: [],
    fileSha256: digestText(files.get(`valid/${name}.json`)),
  })),
  invalid: invalidVectors.map(([name, , diagnostic]) => ({
    id: name,
    path: `invalid/${name}.json`,
    expectedDiagnostics: [diagnostic],
    fileSha256: digestText(files.get(`invalid/${name}.json`)),
  })),
};
files.set(
  "catalog.json",
  await prettierFormat(JSON.stringify(catalog), { parser: "json", printWidth: 100 }),
);
files.set(
  "SHA256SUMS",
  `${[...files.entries()]
    .map(([path, contents]) => `${digestText(contents)}  ${path.replaceAll("\\", "/")}`)
    .sort()
    .join("\n")}\n`,
);

async function emit(relative, content) {
  const path = join(vectors, relative);
  if (check) {
    const current = await readFile(path, "utf8");
    if (current !== content) throw new Error(`Generated v0.2 vector is stale: ${relative}`);
    return;
  }
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
}

for (const [relative, content] of files) await emit(relative, content);
console.log(
  `MCP-RES v0.2 vectors ${check ? "verified" : "generated"}: ${valid.length} valid, ${invalidVectors.length} invalid`,
);
