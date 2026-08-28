import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const STANDARD_VERSION = "0.2.0";

export const DIAGNOSTICS = Object.freeze({
  SCHEMA_INVALID: "MCP_RES_SCHEMA_INVALID",
  SELF_ASSERTED_CLAIM: "MCP_RES_SELF_ASSERTED_CLAIM",
  VACUOUS_NEGATIVE_CONTROL: "MCP_RES_VACUOUS_NEGATIVE_CONTROL",
  PROPERTY_NOT_REACHED: "MCP_RES_PROPERTY_NOT_REACHED",
  WRONG_STOP_REASON: "MCP_RES_WRONG_STOP_REASON",
  NEGATIVE_MUTANT_SURVIVED: "MCP_RES_NEGATIVE_MUTANT_SURVIVED",
  NEGATIVE_PREREQUISITE_MISSING: "MCP_RES_NEGATIVE_PREREQUISITE_MISSING",
  MISSING_OBSERVATION_ARTIFACT: "MCP_RES_MISSING_OBSERVATION_ARTIFACT",
  OBSERVATION_HASH_MISMATCH: "MCP_RES_OBSERVATION_HASH_MISMATCH",
  OBSERVATION_CAUSAL_MISMATCH: "MCP_RES_OBSERVATION_CAUSAL_MISMATCH",
  EVIDENCE_CLASS_PROMOTION: "MCP_RES_EVIDENCE_CLASS_PROMOTION",
  COMPLETION_UNOBSERVED: "MCP_RES_COMPLETION_UNOBSERVED",
  REQUIRED_SURFACE_UNOBSERVED: "MCP_RES_REQUIRED_SURFACE_UNOBSERVED",
  SCENARIO_FINGERPRINT_MISMATCH: "MCP_RES_SCENARIO_FINGERPRINT_MISMATCH",
  EXECUTION_DIGEST_MISMATCH: "MCP_RES_EXECUTION_DIGEST_MISMATCH",
  CROSS_RUN_SUBSTITUTION: "MCP_RES_CROSS_RUN_SUBSTITUTION",
  OPERATION_PARENT_CYCLE: "MCP_RES_OPERATION_PARENT_CYCLE",
  RETRY_LIMIT_EXCEEDED: "MCP_RES_RETRY_LIMIT_EXCEEDED",
  WALL_CLOCK_REVERSAL: "MCP_RES_WALL_CLOCK_REVERSAL",
  TRIAL_SUMMARY_INCONSISTENT: "MCP_RES_TRIAL_SUMMARY_INCONSISTENT",
  FALSE_STABILITY_CLAIM: "MCP_RES_FALSE_STABILITY_CLAIM",
  DIGEST_MISMATCH: "MCP_RES_DIGEST_MISMATCH",
  CAUSAL_MISMATCH: "MCP_RES_CAUSAL_MISMATCH",
});

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "string" && hasLoneSurrogate(value)) {
      throw new Error("MCP_RES_INVALID_UNICODE");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("MCP_RES_NON_CANONICAL_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    if (keys.some(hasLoneSurrogate)) throw new Error("MCP_RES_INVALID_UNICODE");
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("MCP_RES_UNSUPPORTED_CANONICAL_VALUE");
}

export function sha256(value) {
  const bytes = typeof value === "string" ? value : canonicalize(value);
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}

export const VALIDATOR_IDENTITY = Object.freeze({
  name: "mcp-res-black-box-validator",
  version: "0.2.0-pr1",
  sha256: sha256("mcp-res-black-box-validator@0.2.0-pr1\n"),
});

const SCHEMA_NAMES = [
  "observation.schema.json",
  "observation-coverage.schema.json",
  "trial-summary.schema.json",
  "integrity-manifest.schema.json",
  "evidence-envelope.schema.json",
  "conformance-statement.schema.json",
  "conformance-bundle.schema.json",
  "attestation-statement.schema.json",
  "dsse-envelope.schema.json",
  "authenticity-record.schema.json",
  "trust-policy.schema.json",
  "attested-conformance-bundle.schema.json",
  "migration-result.schema.json",
  "official-conformance-attachment.schema.json",
  "profile-evaluation.schema.json",
  "reliability-profile-manifest.schema.json",
  "oauth-boundary-evaluation.schema.json",
];

async function compileSchemas(schemaDirectory) {
  const schemas = await Promise.all(
    SCHEMA_NAMES.map(async (name) =>
      JSON.parse(await readFile(join(schemaDirectory, name), "utf8")),
    ),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const schema of schemas) ajv.addSchema(schema);
  for (const schema of schemas) ajv.getSchema(schema.$id);
  const bundleSchema = schemas.find(
    (schema) => basename(new URL(schema.$id).pathname) === "conformance-bundle.schema.json",
  );
  return { ajv, validate: ajv.getSchema(bundleSchema.$id), count: schemas.length };
}

const compiledByDirectory = new Map();

export function loadSchemaValidator(schemaDirectory) {
  const key = String(schemaDirectory);
  if (!compiledByDirectory.has(key)) compiledByDirectory.set(key, compileSchemas(schemaDirectory));
  return compiledByDirectory.get(key);
}

function sortedArtifacts(artifacts) {
  return [...artifacts].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

export function observationDigest(observation) {
  const material = { ...observation };
  delete material.observationSha256;
  return sha256(material);
}

export function scenarioFingerprint(descriptor) {
  return sha256(descriptor);
}

export function supportingArtifactManifestDigest(artifacts) {
  const supporting = artifacts.filter(
    (artifact) => !["evidence-envelope.json", "conformance-statement.json"].includes(artifact.path),
  );
  return sha256({ artifacts: sortedArtifacts(supporting) });
}

export function executionInstanceDigest(evidence, actualOutcome) {
  return sha256({
    scenarioFingerprint: evidence.scenario.fingerprint,
    run: evidence.run,
    observationDigests: evidence.observations.map((observation) => observation.observationSha256),
    actualOutcome,
    supportingArtifactManifestDigest: evidence.supportingArtifactManifestDigest,
  });
}

export function materializeIntegrity(evidence, statement, supportingArtifacts) {
  const artifacts = sortedArtifacts([
    {
      path: "evidence-envelope.json",
      mediaType: "application/json",
      bytes: Buffer.byteLength(canonicalize(evidence)),
      sha256: sha256(evidence),
    },
    {
      path: "conformance-statement.json",
      mediaType: "application/json",
      bytes: Buffer.byteLength(canonicalize(statement)),
      sha256: sha256(statement),
    },
    ...supportingArtifacts,
  ]);
  return {
    schemaVersion: "mcp-res.integrity-manifest/0.2.0",
    canonicalizationAlgorithm: "mcp-res-json-utf16-v1",
    hashAlgorithm: "SHA-256",
    publication: "MANIFEST_LAST",
    complete: true,
    artifacts,
    bundleDigest: sha256({ artifacts }),
  };
}

function preSchemaDiagnostic(bundle) {
  const evidence = bundle?.evidence;
  const serialized = JSON.stringify(evidence ?? {});
  if (
    /"actualRuntime"\s*:/u.test(serialized) ||
    /"protocolMessagesExchanged"\s*:/u.test(serialized) ||
    /"privacyScanPassed"\s*:/u.test(serialized) ||
    /"cleanupCompleted"\s*:/u.test(serialized)
  ) {
    return DIAGNOSTICS.SELF_ASSERTED_CLAIM;
  }
  const negatives =
    evidence?.operations?.filter((operation) => operation.kind === "NEGATIVE_CONTROL") ?? [];
  if (negatives.length === 0) return DIAGNOSTICS.VACUOUS_NEGATIVE_CONTROL;
  for (const negative of negatives) {
    const reason = negative.negativeObservation;
    if (!reason) return DIAGNOSTICS.VACUOUS_NEGATIVE_CONTROL;
    if (!Array.isArray(reason.prerequisitesReached) || reason.prerequisitesReached.length === 0) {
      return DIAGNOSTICS.NEGATIVE_PREREQUISITE_MISSING;
    }
    if (reason.propertyReached !== true) return DIAGNOSTICS.PROPERTY_NOT_REACHED;
    if (reason.expectedVerdict !== reason.observedVerdict) {
      return DIAGNOSTICS.VACUOUS_NEGATIVE_CONTROL;
    }
    if (reason.expectedStopReason !== reason.observedStopReason) {
      return DIAGNOSTICS.WRONG_STOP_REASON;
    }
    if (reason.mutantId && reason.mutantKilled !== true) {
      return DIAGNOSTICS.NEGATIVE_MUTANT_SURVIVED;
    }
  }
  return undefined;
}

function operationDiagnostic(evidence) {
  const operations = new Map();
  for (const operation of evidence.operations) {
    if (operations.has(operation.operationId)) return DIAGNOSTICS.CAUSAL_MISMATCH;
    operations.set(operation.operationId, operation);
    if (operation.runId !== evidence.run.id) return DIAGNOSTICS.CROSS_RUN_SUBSTITUTION;
    if (operation.startedOffsetMs + operation.durationMs > evidence.run.monotonicDurationMs) {
      return DIAGNOSTICS.CAUSAL_MISMATCH;
    }
  }
  const policies = new Map(
    evidence.scenario.descriptor.recoveryPolicies.map((policy) => [policy.id, policy]),
  );
  const faultIds = new Set(evidence.scenario.descriptor.faults.map((fault) => fault.id));
  for (const operation of evidence.operations) {
    if (operation.parentOperationId !== null && !operations.has(operation.parentOperationId)) {
      return DIAGNOSTICS.CAUSAL_MISMATCH;
    }
    if (operation.faultId !== null && !faultIds.has(operation.faultId)) {
      return DIAGNOSTICS.CAUSAL_MISMATCH;
    }
    if (operation.recoveryPolicyId !== null) {
      const policy = policies.get(operation.recoveryPolicyId);
      if (!policy) return DIAGNOSTICS.CAUSAL_MISMATCH;
      if (operation.attempt > policy.retryLimit) return DIAGNOSTICS.RETRY_LIMIT_EXCEEDED;
    }
  }
  for (const id of operations.keys()) {
    const seen = new Set();
    let cursor = operations.get(id);
    while (cursor?.parentOperationId !== null) {
      if (seen.has(cursor.operationId)) return DIAGNOSTICS.OPERATION_PARENT_CYCLE;
      seen.add(cursor.operationId);
      cursor = operations.get(cursor.parentOperationId);
    }
  }
  return undefined;
}

function observationDiagnostic(evidence, integrity) {
  const artifacts = new Map(integrity.artifacts.map((artifact) => [artifact.path, artifact]));
  const operations = new Set(evidence.operations.map((operation) => operation.operationId));
  const observationIds = new Set();
  for (const observation of evidence.observations) {
    if (observationIds.has(observation.id)) return DIAGNOSTICS.OBSERVATION_CAUSAL_MISMATCH;
    observationIds.add(observation.id);
    if (
      observation.subjectRef !== evidence.subject.identityDigest ||
      (observation.operationRef !== null && !operations.has(observation.operationRef)) ||
      observation.startedOffsetMs + observation.durationMs > evidence.run.monotonicDurationMs
    ) {
      return DIAGNOSTICS.OBSERVATION_CAUSAL_MISMATCH;
    }
    const referenced = observation.artifactRefs.map((path) => artifacts.get(path));
    if (referenced.some((artifact) => !artifact)) {
      return DIAGNOSTICS.MISSING_OBSERVATION_ARTIFACT;
    }
    const material = { ...observation };
    delete material.observationSha256;
    if (
      observation.observationSha256 !== observationDigest(observation) ||
      !referenced.some(
        (artifact) =>
          artifact.sha256 === observation.observationSha256 &&
          artifact.bytes === Buffer.byteLength(canonicalize(material)) &&
          artifact.mediaType === "application/vnd.mcp-res.observation+json",
      )
    ) {
      return DIAGNOSTICS.OBSERVATION_HASH_MISMATCH;
    }
  }
  for (const negative of evidence.operations.filter(
    (operation) => operation.kind === "NEGATIVE_CONTROL",
  )) {
    const oracle = negative.negativeObservation.oracleEvidenceRef;
    if (!artifacts.has(oracle)) {
      return DIAGNOSTICS.MISSING_OBSERVATION_ARTIFACT;
    }
    if (
      !evidence.observations.some(
        (candidate) =>
          candidate.type === "VALIDATOR_CHECK" &&
          candidate.operationRef === negative.operationId &&
          candidate.artifactRefs.includes(oracle),
      )
    ) {
      return DIAGNOSTICS.OBSERVATION_CAUSAL_MISMATCH;
    }
  }
  return undefined;
}

function derivedEvidenceClass(evidence, integrity) {
  const observed = (type) =>
    evidence.observations.some(
      (observation) =>
        observation.type === type &&
        observation.strength === "INTEGRITY_BOUND" &&
        observation.outcome === "PASS",
    );
  const artifactPaths = new Set(integrity.artifacts.map((artifact) => artifact.path));
  const hasSource =
    Array.isArray(evidence.sourceEvidenceRefs) &&
    evidence.sourceEvidenceRefs.length > 0 &&
    evidence.sourceEvidenceRefs.every((reference) => artifactPaths.has(reference));
  if (observed("PROCESS_EXECUTION") && observed("PROTOCOL_EXCHANGE") && hasSource) {
    return "GENUINE_RUNTIME";
  }
  if (observed("PROTOCOL_EXCHANGE") && observed("FIXTURE_EXECUTION")) {
    return "FIXTURE_BACKED_PROTOCOL";
  }
  if (observed("FIXTURE_EXECUTION")) return "FIXTURE_VERIFIED";
  if (observed("INSTALLATION_EXECUTION")) return "INSTALLATION_VERIFIED";
  return "DOCUMENTED_ONLY";
}

function coverageDiagnostic(evidence) {
  const ids = new Set(evidence.observations.map((observation) => observation.id));
  const surfaces = new Set();
  for (const entry of evidence.coverage.surfaces) {
    if (surfaces.has(entry.surface)) return DIAGNOSTICS.REQUIRED_SURFACE_UNOBSERVED;
    surfaces.add(entry.surface);
    if (
      entry.required &&
      (["UNINSTRUMENTED", "UNKNOWN"].includes(entry.status) ||
        (["INSTRUMENTED", "OBSERVED_INDIRECTLY"].includes(entry.status) &&
          (entry.observationRefs.length === 0 ||
            entry.observationRefs.some((reference) => !ids.has(reference)))))
    ) {
      return DIAGNOSTICS.REQUIRED_SURFACE_UNOBSERVED;
    }
  }
  if (surfaces.size !== 14) return DIAGNOSTICS.REQUIRED_SURFACE_UNOBSERVED;
  return undefined;
}

function trialDiagnostic(summary) {
  const total = summary.counts.success + summary.counts.failure + summary.counts.incomplete;
  if (
    total !== summary.completedTrials ||
    summary.completedTrials > summary.plannedTrials ||
    summary.seeds.length !== summary.completedTrials ||
    (summary.completedTrials > 0 && summary.distinctOutcomeHashes.length === 0) ||
    (summary.completedTrials > 0 && summary.durationMs === null) ||
    (summary.durationMs !== null &&
      (summary.durationMs.minimum > summary.durationMs.median ||
        summary.durationMs.median > summary.durationMs.p95))
  ) {
    return DIAGNOSTICS.TRIAL_SUMMARY_INCONSISTENT;
  }
  if (
    summary.classification === "REPEATED_STABLE" &&
    (summary.completedTrials < 2 ||
      summary.counts.success !== summary.completedTrials ||
      summary.distinctOutcomeHashes.length !== 1)
  ) {
    return DIAGNOSTICS.FALSE_STABILITY_CLAIM;
  }
  if (summary.classification === "SINGLE_OBSERVATION" && summary.completedTrials !== 1) {
    return DIAGNOSTICS.TRIAL_SUMMARY_INCONSISTENT;
  }
  if (
    summary.classification === "INCOMPLETE" &&
    summary.counts.incomplete === 0 &&
    summary.completedTrials === summary.plannedTrials
  ) {
    return DIAGNOSTICS.TRIAL_SUMMARY_INCONSISTENT;
  }
  return undefined;
}

function semanticDiagnostic(bundle) {
  const { evidence, statement, integrity } = bundle;
  const descriptor = evidence.scenario.descriptor;
  if (
    descriptor.standardVersion !== evidence.standardVersion ||
    descriptor.profileId !== evidence.profile.id ||
    descriptor.profileVersion !== evidence.profile.version ||
    descriptor.protocolRevision !== evidence.protocolRevision ||
    descriptor.subjectIdentityDigest !== evidence.subject.identityDigest ||
    evidence.scenario.fingerprint !== scenarioFingerprint(descriptor)
  ) {
    return DIAGNOSTICS.SCENARIO_FINGERPRINT_MISMATCH;
  }
  const started = Date.parse(evidence.run.startedAt);
  const finished = Date.parse(evidence.run.finishedAt);
  if (finished < started || evidence.run.monotonicDurationMs > finished - started) {
    return DIAGNOSTICS.WALL_CLOCK_REVERSAL;
  }
  const operation = operationDiagnostic(evidence);
  if (operation) return operation;
  const observation = observationDiagnostic(evidence, integrity);
  if (observation) return observation;
  const coverage = coverageDiagnostic(evidence);
  if (coverage) return coverage;
  const trial = trialDiagnostic(evidence.trialSummary);
  if (trial) return trial;

  const derivedClass = derivedEvidenceClass(evidence, integrity);
  if (evidence.evidenceClassClaim !== derivedClass || statement.evidenceClass !== derivedClass) {
    return DIAGNOSTICS.EVIDENCE_CLASS_PROMOTION;
  }
  const hasPassing = (type) =>
    evidence.observations.some(
      (item) =>
        item.type === type && item.strength === "INTEGRITY_BOUND" && item.outcome === "PASS",
    );
  if (
    statement.result === "PASS" &&
    (!hasPassing("CLEANUP_CHECK") || !hasPassing("PRIVACY_SCAN"))
  ) {
    return DIAGNOSTICS.COMPLETION_UNOBSERVED;
  }

  const artifactPaths = integrity.artifacts.map((artifact) => artifact.path);
  if (new Set(artifactPaths).size !== artifactPaths.length) return DIAGNOSTICS.DIGEST_MISMATCH;
  if (
    evidence.supportingArtifactManifestDigest !==
    supportingArtifactManifestDigest(integrity.artifacts)
  ) {
    return DIAGNOSTICS.DIGEST_MISMATCH;
  }
  const expectedEvidenceHash = sha256(evidence);
  const expectedStatementHash = sha256(statement);
  const evidenceArtifact = integrity.artifacts.find(
    (artifact) => artifact.path === "evidence-envelope.json",
  );
  const statementArtifact = integrity.artifacts.find(
    (artifact) => artifact.path === "conformance-statement.json",
  );
  if (
    evidenceArtifact?.sha256 !== expectedEvidenceHash ||
    evidenceArtifact?.bytes !== Buffer.byteLength(canonicalize(evidence)) ||
    statementArtifact?.sha256 !== expectedStatementHash ||
    statementArtifact?.bytes !== Buffer.byteLength(canonicalize(statement)) ||
    integrity.bundleDigest !== sha256({ artifacts: sortedArtifacts(integrity.artifacts) })
  ) {
    return DIAGNOSTICS.DIGEST_MISMATCH;
  }
  const expectedExecutionDigest = executionInstanceDigest(evidence, statement.result);
  if (statement.executionInstanceDigest !== expectedExecutionDigest) {
    return DIAGNOSTICS.EXECUTION_DIGEST_MISMATCH;
  }
  if (
    statement.standardVersion !== evidence.standardVersion ||
    statement.profileId !== evidence.profile.id ||
    statement.profileVersion !== evidence.profile.version ||
    statement.protocolRevision !== evidence.protocolRevision ||
    statement.subjectType !== evidence.subject.subjectType ||
    statement.subjectName !== evidence.subject.name ||
    statement.subjectVersion !== evidence.subject.version ||
    statement.scenarioFingerprint !== evidence.scenario.fingerprint ||
    statement.stabilityClassification !== evidence.trialSummary.classification ||
    statement.evidenceSha256 !== expectedEvidenceHash ||
    canonicalize(statement.validator) !== canonicalize(descriptor.validatorPolicy)
  ) {
    return DIAGNOSTICS.CAUSAL_MISMATCH;
  }
  return undefined;
}

export async function validateBundle(bundle, options = {}) {
  const schemaDirectory =
    options.schemaDirectory ?? join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
  const early = preSchemaDiagnostic(bundle);
  if (early) return { valid: false, diagnostics: [early], schemaErrors: [] };
  const { validate } = await loadSchemaValidator(schemaDirectory);
  if (!validate(bundle)) {
    return {
      valid: false,
      diagnostics: [DIAGNOSTICS.SCHEMA_INVALID],
      schemaErrors: (validate.errors ?? []).map(({ instancePath, keyword, message }) => ({
        instancePath,
        keyword,
        message,
      })),
    };
  }
  const semantic = semanticDiagnostic(bundle);
  return semantic
    ? { valid: false, diagnostics: [semantic], schemaErrors: [] }
    : { valid: true, diagnostics: [], schemaErrors: [] };
}
