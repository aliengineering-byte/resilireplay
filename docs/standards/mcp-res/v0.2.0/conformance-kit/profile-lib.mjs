import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, readdir } from "node:fs/promises";
import { canonicalize, loadSchemaValidator, sha256 } from "./lib.mjs";

export const PROFILE_DIAGNOSTICS = Object.freeze({
  SCHEMA_INVALID: "MCP_RES_PROFILE_SCHEMA_INVALID",
  MANIFEST_UNKNOWN: "MCP_RES_PROFILE_MANIFEST_UNKNOWN",
  MANIFEST_INVALID: "MCP_RES_PROFILE_MANIFEST_INVALID",
  MANIFEST_DIGEST_MISMATCH: "MCP_RES_PROFILE_MANIFEST_DIGEST_MISMATCH",
  REVISION_UNSUPPORTED: "MCP_RES_PROFILE_REVISION_UNSUPPORTED",
  COVERAGE_MISMATCH: "MCP_RES_PROFILE_COVERAGE_MISMATCH",
  PROPERTY_NOT_REACHED: "MCP_RES_PROFILE_PROPERTY_NOT_REACHED",
  OUTCOME_MISMATCH: "MCP_RES_PROFILE_OUTCOME_MISMATCH",
  WRONG_REASON: "MCP_RES_PROFILE_WRONG_REASON",
  NEGATIVE_CONTROL_MISSING: "MCP_RES_PROFILE_NEGATIVE_CONTROL_MISSING",
  REMOTE_TARGET_UNREVIEWED: "MCP_RES_PROFILE_REMOTE_TARGET_UNREVIEWED",
  CLEANUP_INCOMPLETE: "MCP_RES_PROFILE_CLEANUP_INCOMPLETE",
  RESULT_MISMATCH: "MCP_RES_PROFILE_RESULT_MISMATCH",
  DIGEST_MISMATCH: "MCP_RES_PROFILE_DIGEST_MISMATCH",
  TEST_FIXTURE_OVERCLAIM: "MCP_RES_PROFILE_TEST_FIXTURE_OVERCLAIM",
});

function schemaErrors(validate) {
  return (validate.errors ?? []).map(({ instancePath, keyword, message }) => ({
    instancePath,
    keyword,
    message,
  }));
}

export function applicableCheckIds(manifest, protocolRevision) {
  return [
    ...manifest.requiredChecks,
    ...manifest.conditionalChecks
      .filter((entry) => entry.protocolRevisions.includes(protocolRevision))
      .map((entry) => entry.id),
  ].sort();
}

export function registeredCheckIds(manifest) {
  return [
    ...manifest.requiredChecks,
    ...manifest.conditionalChecks.map((entry) => entry.id),
    ...manifest.experimentalChecks,
  ].sort();
}

export async function loadProfileManifests(profileDirectory, options = {}) {
  const schemaDirectory =
    options.schemaDirectory ?? join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
  const { ajv } = await loadSchemaValidator(schemaDirectory);
  const validate = ajv.getSchema(
    "https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/v0.2.0/schemas/reliability-profile-manifest.schema.json",
  );
  const manifests = new Map();
  for (const name of (await readdir(profileDirectory))
    .filter((entry) => entry.endsWith(".json"))
    .sort()) {
    const manifest = JSON.parse(await readFile(join(profileDirectory, name), "utf8"));
    if (!validate(manifest)) {
      const error = new Error(`Invalid profile manifest ${name}`);
      error.schemaErrors = schemaErrors(validate);
      throw error;
    }
    if ((manifest.status === "EXPERIMENTAL") !== Boolean(manifest.experimentalProvenance)) {
      throw new Error(`Experimental provenance/status mismatch in ${name}`);
    }
    const registered = registeredCheckIds(manifest);
    if (new Set(registered).size !== registered.length || manifests.has(manifest.id)) {
      throw new Error(`Duplicate profile/check identity in ${name}`);
    }
    manifests.set(manifest.id, manifest);
  }
  return manifests;
}

export function evaluationDigest(evaluation) {
  const copy = structuredClone(evaluation);
  delete copy.evaluationSha256;
  return sha256(copy);
}

export function finalizeEvaluation(evaluation) {
  return { ...evaluation, evaluationSha256: evaluationDigest(evaluation) };
}

function observationDiagnostic(observation, negative) {
  if (!observation.propertyReached) return PROFILE_DIAGNOSTICS.PROPERTY_NOT_REACHED;
  if (
    observation.observedOutcome === "NOT_OBSERVED" ||
    observation.expectedOutcome !== observation.observedOutcome
  ) {
    return negative
      ? PROFILE_DIAGNOSTICS.NEGATIVE_CONTROL_MISSING
      : PROFILE_DIAGNOSTICS.OUTCOME_MISMATCH;
  }
  if (observation.expectedReasonCode !== observation.observedReasonCode) {
    return PROFILE_DIAGNOSTICS.WRONG_REASON;
  }
  return undefined;
}

export async function validateProfileEvaluation(evaluation, options = {}) {
  const schemaDirectory =
    options.schemaDirectory ?? join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
  const profileDirectory =
    options.profileDirectory ?? join(dirname(fileURLToPath(import.meta.url)), "..", "profiles");
  const { ajv } = await loadSchemaValidator(schemaDirectory);
  const validate = ajv.getSchema(
    "https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/v0.2.0/schemas/profile-evaluation.schema.json",
  );
  if (!validate(evaluation)) {
    return {
      valid: false,
      diagnostics: [PROFILE_DIAGNOSTICS.SCHEMA_INVALID],
      schemaErrors: schemaErrors(validate),
    };
  }
  let manifests;
  try {
    manifests = await loadProfileManifests(profileDirectory, { schemaDirectory });
  } catch {
    return {
      valid: false,
      diagnostics: [PROFILE_DIAGNOSTICS.MANIFEST_INVALID],
      schemaErrors: [],
    };
  }
  const manifest = manifests.get(evaluation.profile.id);
  if (!manifest || manifest.version !== evaluation.profile.version) {
    return {
      valid: false,
      diagnostics: [PROFILE_DIAGNOSTICS.MANIFEST_UNKNOWN],
      schemaErrors: [],
    };
  }
  if (!manifest.protocolRevisions.includes(evaluation.profile.protocolRevision)) {
    return {
      valid: false,
      diagnostics: [PROFILE_DIAGNOSTICS.REVISION_UNSUPPORTED],
      schemaErrors: [],
    };
  }
  if (sha256(manifest) !== evaluation.profile.manifestSha256) {
    return {
      valid: false,
      diagnostics: [PROFILE_DIAGNOSTICS.MANIFEST_DIGEST_MISMATCH],
      schemaErrors: [],
    };
  }
  if (evaluationDigest(evaluation) !== evaluation.evaluationSha256) {
    return {
      valid: false,
      diagnostics: [PROFILE_DIAGNOSTICS.DIGEST_MISMATCH],
      schemaErrors: [],
    };
  }

  const claimed = [...evaluation.scope.claimedCheckIds].sort();
  const observed = evaluation.checks.map((entry) => entry.id).sort();
  const registered = new Set(registeredCheckIds(manifest));
  const applicable = applicableCheckIds(manifest, evaluation.profile.protocolRevision);
  if (
    new Set(observed).size !== observed.length ||
    canonicalize(claimed) !== canonicalize(observed) ||
    claimed.some((id) => !registered.has(id)) ||
    (evaluation.scope.claim === "FULL_PROFILE" &&
      canonicalize(claimed) !== canonicalize(applicable))
  ) {
    return {
      valid: false,
      diagnostics: [PROFILE_DIAGNOSTICS.COVERAGE_MISMATCH],
      schemaErrors: [],
    };
  }
  if (
    evaluation.scope.targetKind === "REMOTE_HTTP" &&
    (!evaluation.scope.remoteOptIn ||
      !evaluation.scope.allowlistSha256 ||
      !evaluation.scope.reviewedTargetSha256 ||
      evaluation.scope.reviewedTargetSha256 !== evaluation.scope.targetSha256)
  ) {
    return {
      valid: false,
      diagnostics: [PROFILE_DIAGNOSTICS.REMOTE_TARGET_UNREVIEWED],
      schemaErrors: [],
    };
  }
  for (const check of evaluation.checks) {
    const positiveDiagnostic = observationDiagnostic(check.positive, false);
    if (positiveDiagnostic) {
      return { valid: false, diagnostics: [positiveDiagnostic], schemaErrors: [] };
    }
    const negativeDiagnostic = observationDiagnostic(check.negativeControl, true);
    if (negativeDiagnostic) {
      return { valid: false, diagnostics: [negativeDiagnostic], schemaErrors: [] };
    }
  }
  if (evaluation.cleanup.required && !evaluation.cleanup.observed) {
    return {
      valid: false,
      diagnostics: [PROFILE_DIAGNOSTICS.CLEANUP_INCOMPLETE],
      schemaErrors: [],
    };
  }
  const fixtureOnly = evaluation.checks.some(
    (check) =>
      check.positive.source === "TEST_FIXTURE" || check.negativeControl.source === "TEST_FIXTURE",
  );
  const derivedResult = fixtureOnly ? "INCOMPLETE" : "PASS";
  if (evaluation.result !== derivedResult) {
    return {
      valid: false,
      diagnostics: [
        fixtureOnly && evaluation.result === "PASS"
          ? PROFILE_DIAGNOSTICS.TEST_FIXTURE_OVERCLAIM
          : PROFILE_DIAGNOSTICS.RESULT_MISMATCH,
      ],
      schemaErrors: [],
    };
  }
  return {
    valid: true,
    diagnostics: [],
    schemaErrors: [],
    result: derivedResult,
    profileStatus: manifest.status,
    claimScope: evaluation.scope.claim,
  };
}
