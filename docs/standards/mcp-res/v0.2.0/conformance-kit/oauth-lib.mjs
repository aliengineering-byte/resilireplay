import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchemaValidator, sha256 } from "./lib.mjs";
import { applicableCheckIds, loadProfileManifests } from "./profile-lib.mjs";

export const OAUTH_DIAGNOSTICS = Object.freeze({
  SCHEMA_INVALID: "MCP_RES_OAUTH_SCHEMA_INVALID",
  MANIFEST_INVALID: "MCP_RES_OAUTH_MANIFEST_INVALID",
  MANIFEST_DIGEST_MISMATCH: "MCP_RES_OAUTH_MANIFEST_DIGEST_MISMATCH",
  REVISION_UNSUPPORTED: "MCP_RES_OAUTH_REVISION_UNSUPPORTED",
  COVERAGE_MISMATCH: "MCP_RES_OAUTH_COVERAGE_MISMATCH",
  PROPERTY_NOT_REACHED: "MCP_RES_OAUTH_PROPERTY_NOT_REACHED",
  OUTCOME_MISMATCH: "MCP_RES_OAUTH_OUTCOME_MISMATCH",
  WRONG_REASON: "MCP_RES_OAUTH_WRONG_REASON",
  WRONG_REASON_CONTROL_MISSING: "MCP_RES_OAUTH_WRONG_REASON_CONTROL_MISSING",
  EXTERNAL_PROVIDER_CONTACT: "MCP_RES_OAUTH_EXTERNAL_PROVIDER_CONTACT",
  NON_SYNTHETIC_CREDENTIAL: "MCP_RES_OAUTH_NON_SYNTHETIC_CREDENTIAL",
  SECRET_PERSISTED: "MCP_RES_OAUTH_SECRET_PERSISTED",
  UNSANITIZED_ERROR: "MCP_RES_OAUTH_UNSANITIZED_ERROR",
  CLEANUP_INCOMPLETE: "MCP_RES_OAUTH_CLEANUP_INCOMPLETE",
  DIGEST_MISMATCH: "MCP_RES_OAUTH_DIGEST_MISMATCH",
  RESULT_MISMATCH: "MCP_RES_OAUTH_RESULT_MISMATCH",
  TEST_FIXTURE_OVERCLAIM: "MCP_RES_OAUTH_TEST_FIXTURE_OVERCLAIM",
});

function schemaErrors(validate) {
  return (validate.errors ?? []).map(({ instancePath, keyword, message }) => ({
    instancePath,
    keyword,
    message,
  }));
}

export function oauthEvaluationDigest(evaluation) {
  const copy = structuredClone(evaluation);
  delete copy.evaluationSha256;
  return sha256(copy);
}

export function finalizeOAuthEvaluation(evaluation) {
  return { ...evaluation, evaluationSha256: oauthEvaluationDigest(evaluation) };
}

export function oauthReason(checkId, branch) {
  return `MCP_RES_OAUTH_${checkId.replaceAll("-", "_").toUpperCase()}_${branch}`;
}

export async function validateOAuthEvaluation(evaluation, options = {}) {
  const schemaDirectory =
    options.schemaDirectory ?? join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
  const profileDirectory =
    options.profileDirectory ?? join(dirname(fileURLToPath(import.meta.url)), "..", "profiles");
  const { ajv } = await loadSchemaValidator(schemaDirectory);
  const validate = ajv.getSchema(
    "https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/v0.2.0/schemas/oauth-boundary-evaluation.schema.json",
  );
  if (!validate(evaluation)) {
    return {
      valid: false,
      diagnostics: [OAUTH_DIAGNOSTICS.SCHEMA_INVALID],
      schemaErrors: schemaErrors(validate),
    };
  }
  let manifest;
  try {
    manifest = (await loadProfileManifests(profileDirectory, { schemaDirectory })).get(
      "mcp-res/oauth-boundary/v1",
    );
  } catch {
    return { valid: false, diagnostics: [OAUTH_DIAGNOSTICS.MANIFEST_INVALID], schemaErrors: [] };
  }
  if (!manifest || manifest.status !== "PROVISIONAL") {
    return { valid: false, diagnostics: [OAUTH_DIAGNOSTICS.MANIFEST_INVALID], schemaErrors: [] };
  }
  if (!manifest.protocolRevisions.includes(evaluation.profile.protocolRevision)) {
    return {
      valid: false,
      diagnostics: [OAUTH_DIAGNOSTICS.REVISION_UNSUPPORTED],
      schemaErrors: [],
    };
  }
  if (sha256(manifest) !== evaluation.profile.manifestSha256) {
    return {
      valid: false,
      diagnostics: [OAUTH_DIAGNOSTICS.MANIFEST_DIGEST_MISMATCH],
      schemaErrors: [],
    };
  }
  if (oauthEvaluationDigest(evaluation) !== evaluation.evaluationSha256) {
    return { valid: false, diagnostics: [OAUTH_DIAGNOSTICS.DIGEST_MISMATCH], schemaErrors: [] };
  }
  const required = applicableCheckIds(manifest, evaluation.profile.protocolRevision);
  const observed = evaluation.cases.map(({ id }) => id).sort();
  if (
    new Set(observed).size !== observed.length ||
    JSON.stringify(observed) !== JSON.stringify(required)
  ) {
    return {
      valid: false,
      diagnostics: [OAUTH_DIAGNOSTICS.COVERAGE_MISMATCH],
      schemaErrors: [],
    };
  }
  if (
    !evaluation.fixture.loopbackOnly ||
    evaluation.fixture.realAuthorizationProvidersContacted !== 0 ||
    evaluation.fixture.externalNetworkRequests !== 0
  ) {
    return {
      valid: false,
      diagnostics: [OAUTH_DIAGNOSTICS.EXTERNAL_PROVIDER_CONTACT],
      schemaErrors: [],
    };
  }
  if (!evaluation.fixture.syntheticCredentials) {
    return {
      valid: false,
      diagnostics: [OAUTH_DIAGNOSTICS.NON_SYNTHETIC_CREDENTIAL],
      schemaErrors: [],
    };
  }
  for (const entry of evaluation.cases) {
    if (
      entry.positive.expectedReasonCode !== oauthReason(entry.id, "ACCEPTED") ||
      entry.negative.expectedReasonCode !== oauthReason(entry.id, "REJECTED")
    ) {
      return {
        valid: false,
        diagnostics: [OAUTH_DIAGNOSTICS.WRONG_REASON],
        schemaErrors: [],
      };
    }
    for (const observation of [entry.positive, entry.negative]) {
      if (!observation.propertyReached) {
        return {
          valid: false,
          diagnostics: [OAUTH_DIAGNOSTICS.PROPERTY_NOT_REACHED],
          schemaErrors: [],
        };
      }
      if (
        observation.observedOutcome === "NOT_OBSERVED" ||
        observation.observedOutcome !== observation.expectedOutcome
      ) {
        return {
          valid: false,
          diagnostics: [OAUTH_DIAGNOSTICS.OUTCOME_MISMATCH],
          schemaErrors: [],
        };
      }
      if (observation.expectedReasonCode !== observation.observedReasonCode) {
        return {
          valid: false,
          diagnostics: [OAUTH_DIAGNOSTICS.WRONG_REASON],
          schemaErrors: [],
        };
      }
    }
    if (
      !entry.wrongReasonMutant.propertyReached ||
      entry.wrongReasonMutant.observedReasonCode === entry.negative.expectedReasonCode ||
      entry.wrongReasonMutant.observedReasonCode !== "MCP_RES_OAUTH_EARLY_SYNTAX_REJECTION" ||
      entry.wrongReasonMutant.expectedDiagnostic !== OAUTH_DIAGNOSTICS.WRONG_REASON
    ) {
      return {
        valid: false,
        diagnostics: [OAUTH_DIAGNOSTICS.WRONG_REASON_CONTROL_MISSING],
        schemaErrors: [],
      };
    }
  }
  if (
    evaluation.privacy.tokenMaterialPersisted ||
    evaluation.privacy.evidenceContainsCredentialMaterial
  ) {
    return { valid: false, diagnostics: [OAUTH_DIAGNOSTICS.SECRET_PERSISTED], schemaErrors: [] };
  }
  if (!evaluation.privacy.authorizationErrorsSanitized) {
    return { valid: false, diagnostics: [OAUTH_DIAGNOSTICS.UNSANITIZED_ERROR], schemaErrors: [] };
  }
  if (!evaluation.cleanup.listenerClosed || !evaluation.cleanup.redirectListenerReleased) {
    return {
      valid: false,
      diagnostics: [OAUTH_DIAGNOSTICS.CLEANUP_INCOMPLETE],
      schemaErrors: [],
    };
  }
  const fixtureOnly = evaluation.cases.some(
    ({ evidenceSource }) => evidenceSource === "TEST_FIXTURE",
  );
  const derived = fixtureOnly ? "INCOMPLETE" : "PASS";
  if (derived !== evaluation.result) {
    return {
      valid: false,
      diagnostics: [
        fixtureOnly && evaluation.result === "PASS"
          ? OAUTH_DIAGNOSTICS.TEST_FIXTURE_OVERCLAIM
          : OAUTH_DIAGNOSTICS.RESULT_MISMATCH,
      ],
      schemaErrors: [],
    };
  }
  return {
    valid: true,
    diagnostics: [],
    schemaErrors: [],
    result: derived,
    securityCertificationClaim: false,
    realAuthorizationProvidersContacted: 0,
  };
}
