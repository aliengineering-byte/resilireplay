import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  ATTESTATION_DIAGNOSTICS,
  createAttestationStatement,
  signAttestationEnvelope,
  signStatementEnvelope,
  validateAttestedBundle,
  wrapAttestations,
} from "../docs/standards/mcp-res/v0.2.0/conformance-kit/attestation-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const standard = join(root, "docs", "standards", "mcp-res", "v0.2.0");
const baseBundle = JSON.parse(
  await readFile(join(standard, "test-vectors", "valid", "reason-bound-negative.json"), "utf8"),
);
const rerunBundle = JSON.parse(
  await readFile(
    join(standard, "test-vectors", "valid", "equivalent-scenario-distinct-run.json"),
    "utf8",
  ),
);
const corpusDirectory = join(root, ".artifacts", "mcp-res-v02", "attestation-corpus");
await mkdir(corpusDirectory, { recursive: true });

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) {
  return structuredClone(value);
}

function keyFingerprint(publicKey) {
  const der = publicKey.export({ format: "der", type: "spki" });
  return createHash("sha256").update(der).digest("hex");
}

function trustPolicy(signers) {
  return {
    schemaVersion: "mcp-res.trust-policy/0.2.0",
    id: "mcp-res/test-policy",
    version: "1.0.0",
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2027-01-01T00:00:00.000Z",
    requiredAlgorithm: "Ed25519",
    trustedSigners: signers,
    revokedKeyFingerprints: [],
  };
}

const keyOne = generateKeyPairSync("ed25519");
const keyTwo = generateKeyPairSync("ed25519");
const signerOne = "test://mcp-res/disposable/signer-one";
const signerTwo = "test://mcp-res/disposable/signer-two";
const signingTime = "2026-08-27T18:00:00.000Z";
const evaluatedAt = "2026-08-27T18:05:00.000Z";
const policy = trustPolicy([
  { keyFingerprint: keyFingerprint(keyOne.publicKey), signerIdentity: signerOne },
  { keyFingerprint: keyFingerprint(keyTwo.publicKey), signerIdentity: signerTwo },
]);
const optionsOne = {
  ...keyOne,
  signerIdentity: signerOne,
  signingTime,
  trustPolicyId: policy.id,
};
const optionsTwo = {
  ...keyTwo,
  signerIdentity: signerTwo,
  signingTime,
  trustPolicyId: policy.id,
};
const envelopeOne = signAttestationEnvelope(baseBundle, optionsOne);
const envelopeTwo = signAttestationEnvelope(baseBundle, optionsTwo);
const transparencyProof = Buffer.from("offline-test-inclusion-proof-v1", "utf8");
const transparencyEnvelope = signAttestationEnvelope(baseBundle, {
  ...optionsOne,
  transparencyReference: {
    logId: "test-log",
    entryUuid: "test-entry-0001",
    inclusionProofBase64: transparencyProof.toString("base64"),
    inclusionProofSha256: createHash("sha256").update(transparencyProof).digest("hex"),
  },
});

const cases = [];
function addCase(id, wrapper, expectedDiagnostics, trust = policy) {
  cases.push({ id, wrapper, expectedDiagnostics, trustPolicy: trust });
}

addCase(
  "unsigned-integrity-only",
  wrapAttestations(baseBundle, "UNSIGNED_INTEGRITY_ONLY"),
  [],
  null,
);
addCase(
  "signed-untrusted-allowed-at-signed-level",
  wrapAttestations(baseBundle, "SIGNED", [envelopeOne]),
  [],
  null,
);
addCase(
  "signed-with-identity",
  wrapAttestations(baseBundle, "SIGNED_WITH_IDENTITY", [envelopeOne]),
  [],
);
addCase("witnessed", wrapAttestations(baseBundle, "WITNESSED", [envelopeOne, envelopeTwo]), []);
addCase(
  "transparency-recorded",
  wrapAttestations(baseBundle, "TRANSPARENCY_RECORDED", [transparencyEnvelope]),
  [],
);

const alteredPayload = clone(envelopeOne);
const alteredBytes = Buffer.from(alteredPayload.payload, "base64");
alteredBytes[alteredBytes.length - 1] ^= 1;
alteredPayload.payload = alteredBytes.toString("base64");
addCase("altered-payload", wrapAttestations(baseBundle, "SIGNED", [alteredPayload]), [
  ATTESTATION_DIAGNOSTICS.SIGNATURE_INVALID,
]);

const alteredSubjectStatement = createAttestationStatement(baseBundle, optionsOne);
alteredSubjectStatement.subject[0].digest.sha256 = "0".repeat(64);
addCase(
  "altered-subject",
  wrapAttestations(baseBundle, "SIGNED", [
    signStatementEnvelope(alteredSubjectStatement, optionsOne),
  ]),
  [ATTESTATION_DIAGNOSTICS.BINDING_MISMATCH],
);

const wrongKey = clone(envelopeOne);
const wrongDer = keyTwo.publicKey.export({ format: "der", type: "spki" });
wrongKey.signatures[0].publicKeySpkiBase64 = wrongDer.toString("base64");
wrongKey.signatures[0].keyid = createHash("sha256").update(wrongDer).digest("hex");
addCase("wrong-key", wrapAttestations(baseBundle, "SIGNED", [wrongKey]), [
  ATTESTATION_DIAGNOSTICS.SIGNATURE_INVALID,
]);

const missingSignature = clone(envelopeOne);
missingSignature.signatures = [];
addCase("missing-signature", wrapAttestations(baseBundle, "SIGNED", [missingSignature]), [
  ATTESTATION_DIAGNOSTICS.SIGNATURE_MISSING,
]);

const unsupportedAlgorithm = clone(envelopeOne);
unsupportedAlgorithm.signatures[0].algorithm = "RSA-PSS";
addCase("unsupported-algorithm", wrapAttestations(baseBundle, "SIGNED", [unsupportedAlgorithm]), [
  ATTESTATION_DIAGNOSTICS.UNSUPPORTED_ALGORITHM,
]);

addCase(
  "signature-over-different-bundle",
  wrapAttestations(baseBundle, "SIGNED", [signAttestationEnvelope(rerunBundle, optionsOne)]),
  [ATTESTATION_DIAGNOSTICS.BINDING_MISMATCH],
);

const expiredPolicy = clone(policy);
expiredPolicy.validUntil = "2026-01-02T00:00:00.000Z";
addCase(
  "expired-trust-policy",
  wrapAttestations(baseBundle, "SIGNED_WITH_IDENTITY", [envelopeOne]),
  [ATTESTATION_DIAGNOSTICS.TRUST_POLICY_EXPIRED],
  expiredPolicy,
);

const revokedPolicy = clone(policy);
revokedPolicy.revokedKeyFingerprints = [keyFingerprint(keyOne.publicKey)];
addCase(
  "revoked-test-key",
  wrapAttestations(baseBundle, "SIGNED_WITH_IDENTITY", [envelopeOne]),
  [ATTESTATION_DIAGNOSTICS.KEY_REVOKED],
  revokedPolicy,
);

addCase(
  "duplicate-signer",
  wrapAttestations(baseBundle, "WITNESSED", [envelopeOne, clone(envelopeOne)]),
  [ATTESTATION_DIAGNOSTICS.DUPLICATE_SIGNER],
);

const identityMismatch = clone(envelopeOne);
identityMismatch.signatures[0].signerIdentity = "test://mcp-res/disposable/different";
addCase(
  "signer-identity-mismatch",
  wrapAttestations(baseBundle, "SIGNED_WITH_IDENTITY", [identityMismatch]),
  [ATTESTATION_DIAGNOSTICS.IDENTITY_MISMATCH],
);

addCase(
  "valid-signature-untrusted-key",
  wrapAttestations(baseBundle, "SIGNED_WITH_IDENTITY", [envelopeOne]),
  [ATTESTATION_DIAGNOSTICS.UNTRUSTED_SIGNER],
  trustPolicy([]),
);

const invalidEvidence = clone(baseBundle);
invalidEvidence.evidence.operations[1].negativeObservation.observedStopReason = "WRONG_REASON";
addCase(
  "valid-signature-invalid-evidence",
  wrapAttestations(invalidEvidence, "SIGNED_WITH_IDENTITY", [
    signAttestationEnvelope(invalidEvidence, optionsOne),
  ]),
  [ATTESTATION_DIAGNOSTICS.EVIDENCE_INVALID, "MCP_RES_WRONG_STOP_REASON"],
);

const manifest = {
  schemaVersion: "mcp-res.attestation-test-corpus/0.2.0",
  evaluatedAt,
  cases: [],
};
let validCount = 0;
let invalidCount = 0;
for (const entry of cases) {
  const result = await validateAttestedBundle(entry.wrapper, {
    trustPolicy: entry.trustPolicy,
    evaluatedAt,
  });
  invariant(
    JSON.stringify(result.diagnostics) === JSON.stringify(entry.expectedDiagnostics),
    `Attestation diagnostic mismatch for ${entry.id}: ${JSON.stringify(result)}`,
  );
  invariant(
    result.valid === (entry.expectedDiagnostics.length === 0),
    `Attestation decision mismatch: ${entry.id}`,
  );
  if (result.valid) {
    invariant(
      result.evidenceClass === undefined ||
        result.evidenceClass === baseBundle.statement.evidenceClass,
      `Authenticity changed evidence class for ${entry.id}`,
    );
    validCount += 1;
  } else {
    invalidCount += 1;
  }
  const wrapperName = `${entry.id}.json`;
  const policyName = entry.trustPolicy ? `${entry.id}.trust-policy.json` : null;
  await writeFile(
    join(corpusDirectory, wrapperName),
    `${JSON.stringify(entry.wrapper, null, 2)}\n`,
    "utf8",
  );
  if (entry.trustPolicy) {
    await writeFile(
      join(corpusDirectory, policyName),
      `${JSON.stringify(entry.trustPolicy, null, 2)}\n`,
      "utf8",
    );
  }
  manifest.cases.push({
    id: entry.id,
    wrapper: wrapperName,
    trustPolicy: policyName,
    expectedDiagnostics: entry.expectedDiagnostics,
  });
}
await writeFile(
  join(corpusDirectory, "catalog.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
console.log(
  JSON.stringify({
    attestationCases: cases.length,
    validAttestations: validCount,
    invalidAttestations: invalidCount,
    privateKeysPersisted: false,
    offlineValidation: true,
    evidenceClassUnchanged: true,
    corpusDirectory,
  }),
);
