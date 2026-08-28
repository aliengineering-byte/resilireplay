import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256 } from "../docs/standards/mcp-res/v0.2.0/conformance-kit/lib.mjs";
import {
  applicableCheckIds,
  finalizeEvaluation,
  loadProfileManifests,
  PROFILE_DIAGNOSTICS,
  validateProfileEvaluation,
} from "../docs/standards/mcp-res/v0.2.0/conformance-kit/profile-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const standard = join(root, "docs", "standards", "mcp-res", "v0.2.0");
const schemas = join(standard, "schemas");
const profiles = join(standard, "profiles");
const output = join(root, ".artifacts", "mcp-res-v02", "profile-corpus");
await mkdir(output, { recursive: true });

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function reason(id, suffix) {
  return `MCP_RES_${id.replaceAll("-", "_").toUpperCase()}_${suffix}`;
}

function fixtureEvaluation(
  manifest,
  protocolRevision,
  checkIds = applicableCheckIds(manifest, protocolRevision),
) {
  return finalizeEvaluation({
    schemaVersion: "mcp-res.profile-evaluation/0.2.0",
    subject: {
      name: "mcp-res-profile-fixture",
      implementationLanguage: "OTHER",
      version: "0.2.0-draft.1",
      artifactSha256: sha256({ fixture: manifest.id }),
    },
    environment: {
      platform: process.platform,
      runtimeName: "node",
      runtimeVersion: process.version,
    },
    profile: {
      id: manifest.id,
      version: manifest.version,
      manifestSha256: sha256(manifest),
      protocolRevision,
    },
    scope: {
      claim:
        checkIds.length === applicableCheckIds(manifest, protocolRevision).length
          ? "FULL_PROFILE"
          : "BOUNDED_CHECK_SET",
      claimedCheckIds: checkIds,
      targetKind: "OFFLINE_MODEL",
      targetSha256: sha256({ profile: manifest.id, protocolRevision }),
      remoteOptIn: false,
    },
    checks: checkIds.map((id) => ({
      id,
      positive: {
        source: "TEST_FIXTURE",
        propertyReached: true,
        expectedOutcome: "ACCEPT",
        observedOutcome: "ACCEPT",
        expectedReasonCode: reason(id, "ACCEPTED"),
        observedReasonCode: reason(id, "ACCEPTED"),
        artifactSha256: sha256({ id, branch: "positive" }),
      },
      negativeControl: {
        source: "TEST_FIXTURE",
        propertyReached: true,
        expectedOutcome: "REJECT",
        observedOutcome: "REJECT",
        expectedReasonCode: reason(id, "REJECTED"),
        observedReasonCode: reason(id, "REJECTED"),
        artifactSha256: sha256({ id, branch: "negative" }),
      },
    })),
    cleanup: {
      required: true,
      observed: true,
      observationSha256: sha256({ cleanup: true, profile: manifest.id }),
    },
    result: "INCOMPLETE",
  });
}

const manifests = await loadProfileManifests(profiles, { schemaDirectory: schemas });
invariant(manifests.size === 12, `Expected twelve profile manifests, got ${manifests.size}`);
const valid = [];
let fullProfileChecks = 0;
for (const manifest of manifests.values()) {
  for (const revision of manifest.protocolRevisions) {
    const evaluation = fixtureEvaluation(manifest, revision);
    const result = await validateProfileEvaluation(evaluation, {
      schemaDirectory: schemas,
      profileDirectory: profiles,
    });
    invariant(result.valid && result.result === "INCOMPLETE", JSON.stringify(result));
    const file = `${manifest.id.split("/")[1]}-${revision}.json`;
    await writeFile(join(output, file), `${JSON.stringify(evaluation, null, 2)}\n`, "utf8");
    valid.push({ id: `${manifest.id}@${revision}`, file, expectedResult: "INCOMPLETE" });
    fullProfileChecks += evaluation.checks.length;
  }
}

const protocolManifest = manifests.get("mcp-res/protocol-revision/v1");
invariant(protocolManifest, "Protocol revision manifest missing");
const base = fixtureEvaluation(protocolManifest, "2025-11-25");
const invalid = [];
async function record(id, mutate, diagnostic) {
  const value = structuredClone(base);
  mutate(value);
  const finalized = finalizeEvaluation(value);
  const file = `invalid-${id}.json`;
  await writeFile(join(output, file), `${JSON.stringify(finalized, null, 2)}\n`, "utf8");
  const result = await validateProfileEvaluation(finalized, {
    schemaDirectory: schemas,
    profileDirectory: profiles,
  });
  invariant(
    result.diagnostics[0] === diagnostic,
    `${id}: expected ${diagnostic}, got ${JSON.stringify(result)}`,
  );
  invalid.push({ id, file, expectedDiagnostics: [diagnostic] });
}

await record(
  "property-not-reached",
  (value) => {
    value.checks[0].positive.propertyReached = false;
  },
  PROFILE_DIAGNOSTICS.PROPERTY_NOT_REACHED,
);
await record(
  "wrong-reason",
  (value) => {
    value.checks[0].negativeControl.observedReasonCode = "MCP_RES_WRONG_NEGATIVE_REASON";
  },
  PROFILE_DIAGNOSTICS.WRONG_REASON,
);
await record(
  "negative-control-missing",
  (value) => {
    value.checks[0].negativeControl.observedOutcome = "NOT_OBSERVED";
  },
  PROFILE_DIAGNOSTICS.NEGATIVE_CONTROL_MISSING,
);
await record(
  "remote-target-unreviewed",
  (value) => {
    value.scope.targetKind = "REMOTE_HTTP";
  },
  PROFILE_DIAGNOSTICS.REMOTE_TARGET_UNREVIEWED,
);
await record(
  "cleanup-incomplete",
  (value) => {
    value.cleanup.observed = false;
  },
  PROFILE_DIAGNOSTICS.CLEANUP_INCOMPLETE,
);
await record(
  "fixture-pass-overclaim",
  (value) => {
    value.result = "PASS";
  },
  PROFILE_DIAGNOSTICS.TEST_FIXTURE_OVERCLAIM,
);
await record(
  "coverage-omission",
  (value) => {
    value.scope.claimedCheckIds = value.scope.claimedCheckIds.slice(0, 1);
    value.checks = value.checks.slice(0, 1);
  },
  PROFILE_DIAGNOSTICS.COVERAGE_MISMATCH,
);

const unsupportedManifest = manifests.get("mcp-res/async-operation/v1");
const unsupported = fixtureEvaluation(
  unsupportedManifest,
  "2025-11-25",
  unsupportedManifest.requiredChecks,
);
const unsupportedResult = await validateProfileEvaluation(unsupported, {
  schemaDirectory: schemas,
  profileDirectory: profiles,
});
invariant(
  unsupportedResult.diagnostics[0] === PROFILE_DIAGNOSTICS.REVISION_UNSUPPORTED,
  "Adjacent-revision skew was not rejected",
);
await writeFile(
  join(output, "invalid-version-skew.json"),
  `${JSON.stringify(unsupported, null, 2)}\n`,
);
invalid.push({
  id: "version-skew",
  file: "invalid-version-skew.json",
  expectedDiagnostics: [PROFILE_DIAGNOSTICS.REVISION_UNSUPPORTED],
});

const digestMutant = structuredClone(base);
digestMutant.checks[0].positive.artifactSha256 = "0".repeat(64);
await writeFile(
  join(output, "invalid-evaluation-digest.json"),
  `${JSON.stringify(digestMutant, null, 2)}\n`,
);
const digestResult = await validateProfileEvaluation(digestMutant, {
  schemaDirectory: schemas,
  profileDirectory: profiles,
});
invariant(
  digestResult.diagnostics[0] === PROFILE_DIAGNOSTICS.DIGEST_MISMATCH,
  "Altered profile evaluation was not rejected",
);
invalid.push({
  id: "evaluation-digest",
  file: "invalid-evaluation-digest.json",
  expectedDiagnostics: [PROFILE_DIAGNOSTICS.DIGEST_MISMATCH],
});

const catalog = {
  schemaVersion: "mcp-res.profile-test-catalog/0.2.0",
  valid,
  invalid,
  fixtureResultBoundary: "TEST_FIXTURE observations are always INCOMPLETE",
};
await writeFile(join(output, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify({
    manifests: manifests.size,
    revisionEvaluations: valid.length,
    fullProfileChecks,
    invalidMutants: invalid.length,
    fixturePasses: 0,
  }),
);
