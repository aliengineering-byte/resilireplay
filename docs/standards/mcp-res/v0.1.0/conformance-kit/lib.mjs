import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const STANDARD_VERSION = "0.1.0";
export const VALIDATOR_IDENTITY = Object.freeze({
  name: "mcp-res-black-box-validator",
  version: "0.1.0",
  sha256: "d9e2a71b47b5eabe385fa17fe3c9d0e5898f323933f21654643a54e4f9d50580",
});

export const DIAGNOSTICS = Object.freeze({
  SCHEMA_INVALID: "MCP_RES_SCHEMA_INVALID",
  MISSING_CLEAN_CONTROL: "MCP_RES_MISSING_CLEAN_CONTROL",
  VACUOUS_NEGATIVE_CONTROL: "MCP_RES_VACUOUS_NEGATIVE_CONTROL",
  UNBOUNDED_RETRY: "MCP_RES_UNBOUNDED_RETRY",
  CLEANUP_INCOMPLETE: "MCP_RES_CLEANUP_INCOMPLETE",
  DIGEST_MISMATCH: "MCP_RES_DIGEST_MISMATCH",
  PARTIAL_MANIFEST: "MCP_RES_PARTIAL_MANIFEST",
  SECRET_DETECTED: "MCP_RES_SECRET_DETECTED",
  AUTH_HEADER_FORBIDDEN: "MCP_RES_AUTH_HEADER_FORBIDDEN",
  SUBJECT_AMBIGUOUS: "MCP_RES_SUBJECT_AMBIGUOUS",
  PROFILE_UNSUPPORTED: "MCP_RES_PROFILE_UNSUPPORTED",
  CAUSAL_MISMATCH: "MCP_RES_CAUSAL_MISMATCH",
  SIDE_EFFECT_RETRY_UNSAFE: "MCP_RES_SIDE_EFFECT_RETRY_UNSAFE",
  EVIDENCE_TOO_LARGE: "MCP_RES_EVIDENCE_TOO_LARGE",
  NONDETERMINISTIC_IDENTITY: "MCP_RES_NONDETERMINISTIC_IDENTITY",
  EVIDENCE_CLASS_PROMOTION: "MCP_RES_EVIDENCE_CLASS_PROMOTION",
  REGRESSION_INVALID: "MCP_RES_REGRESSION_INVALID",
});

const PROFILES = new Map([
  ["mcp-res/server-tool-call/v1@1.0.0", { subjectTypes: ["MCP_SERVER"], status: "NORMATIVE" }],
  [
    "mcp-res/client-config-source/v1@1.0.0",
    { subjectTypes: ["MCP_CLIENT", "TEST_HARNESS"], status: "PROVISIONAL" },
  ],
  [
    "mcp-res/agent-tool-recovery/v1@1.0.0",
    { subjectTypes: ["AGENT_RUNTIME", "ADAPTER"], status: "PROVISIONAL" },
  ],
]);

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

export function materializeIntegrity(evidence, statement, additionalArtifacts = []) {
  const evidenceBytes = Buffer.byteLength(canonicalize(evidence));
  const statementBytes = Buffer.byteLength(canonicalize(statement));
  const artifacts = [
    {
      path: "evidence-envelope.json",
      mediaType: "application/json",
      bytes: evidenceBytes,
      sha256: sha256(evidence),
    },
    {
      path: "conformance-statement.json",
      mediaType: "application/json",
      bytes: statementBytes,
      sha256: sha256(statement),
    },
    ...additionalArtifacts,
  ].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return {
    schemaVersion: STANDARD_VERSION,
    canonicalizationAlgorithm: "mcp-res-json-utf16-v1",
    hashAlgorithm: "SHA-256",
    publication: "MANIFEST_LAST",
    complete: true,
    artifacts,
    bundleDigest: sha256({ artifacts }),
  };
}

async function compileSchemas(schemaDirectory) {
  const names = [
    "subject-identity.schema.json",
    "fault-description.schema.json",
    "recovery-policy.schema.json",
    "cleanup-result.schema.json",
    "integrity-manifest.schema.json",
    "evidence-envelope.schema.json",
    "conformance-statement.schema.json",
    "profile-manifest.schema.json",
    "conformance-bundle.schema.json",
  ];
  const schemas = await Promise.all(
    names.map(async (name) => JSON.parse(await readFile(join(schemaDirectory, name), "utf8"))),
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

let compiledPromise;

export async function loadSchemaValidator(schemaDirectory) {
  compiledPromise ??= compileSchemas(schemaDirectory);
  return compiledPromise;
}

function inspectForbiddenText(bundle) {
  const serialized = JSON.stringify(bundle);
  if (/authorization\s*[:=]\s*(?:bearer|basic)\s+[a-z0-9._~+/-]+/iu.test(serialized)) {
    return DIAGNOSTICS.AUTH_HEADER_FORBIDDEN;
  }
  const candidates = serialized.match(/[A-Za-z0-9+/]{24,}={0,2}/gu) ?? [];
  for (const candidate of candidates) {
    try {
      const decoded = Buffer.from(candidate, "base64").toString("utf8");
      if (/(?:authorization\s*:\s*bearer|api[_-]?key\s*[:=]|token\s*[:=])/iu.test(decoded)) {
        return DIAGNOSTICS.SECRET_DETECTED;
      }
    } catch {
      // Invalid Base64 is not itself secret evidence.
    }
  }
  return undefined;
}

function preSchemaDiagnostic(bundle) {
  const evidence = bundle?.evidence;
  if (!evidence?.operations?.some((operation) => operation.kind === "CLEAN_CONTROL")) {
    return DIAGNOSTICS.MISSING_CLEAN_CONTROL;
  }
  const negative = evidence.operations.find((operation) => operation.kind === "NEGATIVE_CONTROL");
  if (!negative || negative.outcome !== "EXPECTED_FAILURE" || !negative.faultId) {
    return DIAGNOSTICS.VACUOUS_NEGATIVE_CONTROL;
  }
  if (
    evidence.recoveryPolicies?.some(
      (policy) => policy.retryLimit === null || policy.retryLimit === "unbounded",
    )
  ) {
    return DIAGNOSTICS.UNBOUNDED_RETRY;
  }
  if (
    !evidence.cleanup ||
    evidence.cleanup.complete !== true ||
    evidence.cleanup.childProcessesRemaining > 0 ||
    evidence.cleanup.listenersRemaining > 0 ||
    evidence.cleanup.targetState === "UNAPPROVED_CHANGE"
  ) {
    return DIAGNOSTICS.CLEANUP_INCOMPLETE;
  }
  if (
    !bundle?.integrity ||
    bundle.integrity.complete !== true ||
    bundle.integrity.publication !== "MANIFEST_LAST"
  ) {
    return DIAGNOSTICS.PARTIAL_MANIFEST;
  }
  if (!evidence?.subject?.name || !evidence.subject.version || !evidence.subject.artifact?.sha256) {
    return DIAGNOSTICS.SUBJECT_AMBIGUOUS;
  }
  if (
    "absolutePath" in evidence.subject ||
    "workingDirectory" in evidence.subject ||
    "hostName" in evidence.subject
  ) {
    return DIAGNOSTICS.NONDETERMINISTIC_IDENTITY;
  }
  if (
    Buffer.byteLength(JSON.stringify(bundle), "utf8") > 1048576 ||
    evidence.limits?.inputBytes > 16777216 ||
    evidence.limits?.stringBytes > 1048576
  ) {
    return DIAGNOSTICS.EVIDENCE_TOO_LARGE;
  }
  return inspectForbiddenText(bundle);
}

function semanticDiagnostic(bundle) {
  const { evidence, integrity, statement } = bundle;
  const profile = PROFILES.get(`${evidence.profile.id}@${evidence.profile.version}`);
  if (!profile || !profile.subjectTypes.includes(evidence.subject.subjectType)) {
    return DIAGNOSTICS.PROFILE_UNSUPPORTED;
  }
  const sourceEvidenceArtifact = integrity.artifacts.find(
    (artifact) => artifact.path === `source-evidence/${evidence.sourceEvidence?.name ?? ""}`,
  );
  const hasSourceEvidence =
    evidence.sourceEvidence?.kind === "SANITIZED_PROJECTION" &&
    sourceEvidenceArtifact?.sha256 === evidence.sourceEvidence.projectionSha256 &&
    sourceEvidenceArtifact?.bytes === evidence.sourceEvidence.projectionBytes;
  const classRequirements = {
    GENUINE_RUNTIME:
      evidence.execution.actualRuntime &&
      evidence.execution.protocolMessagesExchanged &&
      hasSourceEvidence,
    FIXTURE_BACKED_PROTOCOL:
      evidence.execution.protocolMessagesExchanged && evidence.execution.fixtureUsed,
    FIXTURE_VERIFIED: evidence.execution.fixtureUsed,
    INSTALLATION_VERIFIED: evidence.execution.installationExecuted,
    DOCUMENTED_ONLY:
      !evidence.execution.actualRuntime &&
      !evidence.execution.protocolMessagesExchanged &&
      !evidence.execution.fixtureUsed &&
      !evidence.execution.installationExecuted &&
      !evidence.execution.regressionExecuted,
  };
  if (!classRequirements[evidence.evidenceClass]) return DIAGNOSTICS.EVIDENCE_CLASS_PROMOTION;

  const ids = new Set(evidence.operations.map((operation) => operation.operationId));
  const faults = new Map(evidence.faults.map((fault) => [fault.id, fault]));
  const policies = new Map(evidence.recoveryPolicies.map((policy) => [policy.id, policy]));
  for (const operation of evidence.operations) {
    if (
      operation.runId !== evidence.run.id ||
      (operation.parentOperationId && !ids.has(operation.parentOperationId))
    ) {
      return DIAGNOSTICS.CAUSAL_MISMATCH;
    }
    if (operation.faultId) {
      const fault = faults.get(operation.faultId);
      if (!fault || fault.targetOperationId !== operation.operationId)
        return DIAGNOSTICS.CAUSAL_MISMATCH;
    }
    if (operation.recoveryPolicyId && !policies.has(operation.recoveryPolicyId))
      return DIAGNOSTICS.CAUSAL_MISMATCH;
  }
  for (const policy of evidence.recoveryPolicies) {
    if (
      policy.retryLimit > 0 &&
      ["SIDE_EFFECTING", "UNKNOWN"].includes(policy.sideEffectModel) &&
      policy.safetyMechanism === null
    ) {
      return DIAGNOSTICS.SIDE_EFFECT_RETRY_UNSAFE;
    }
  }
  if (evidence.regression?.provided) {
    const regression = evidence.regression;
    if (
      !regression.generatedWithoutExecution ||
      !regression.containedOutput ||
      !regression.deterministicDependencies ||
      !regression.brokenConditionFails ||
      !regression.fixedConditionPasses ||
      !regression.secretScanPassed ||
      !evidence.execution.regressionExecuted
    ) {
      return DIAGNOSTICS.REGRESSION_INVALID;
    }
  }
  const evidenceHash = sha256(evidence);
  const statementHash = sha256(statement);
  const evidenceArtifact = integrity.artifacts.find(
    (artifact) => artifact.path === "evidence-envelope.json",
  );
  const statementArtifact = integrity.artifacts.find(
    (artifact) => artifact.path === "conformance-statement.json",
  );
  const artifactPaths = integrity.artifacts.map((artifact) => artifact.path);
  if (new Set(artifactPaths).size !== artifactPaths.length) {
    return DIAGNOSTICS.PARTIAL_MANIFEST;
  }
  const expectedBundleDigest = sha256({
    artifacts: [...integrity.artifacts].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    ),
  });
  if (
    statement.evidenceSha256 !== evidenceHash ||
    evidenceArtifact?.sha256 !== evidenceHash ||
    evidenceArtifact?.bytes !== Buffer.byteLength(canonicalize(evidence)) ||
    statementArtifact?.sha256 !== statementHash ||
    statementArtifact?.bytes !== Buffer.byteLength(canonicalize(statement)) ||
    integrity.bundleDigest !== expectedBundleDigest
  ) {
    return DIAGNOSTICS.DIGEST_MISMATCH;
  }
  if (
    statement.standardVersion !== evidence.standardVersion ||
    statement.profileId !== evidence.profile.id ||
    statement.profileVersion !== evidence.profile.version ||
    statement.subjectType !== evidence.subject.subjectType ||
    statement.subjectName !== evidence.subject.name ||
    statement.subjectVersion !== evidence.subject.version ||
    statement.evidenceClass !== evidence.evidenceClass ||
    statement.validatorName !== evidence.validator.name ||
    statement.validatorVersion !== evidence.validator.version ||
    statement.validatorSha256 !== evidence.validator.sha256
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
