import {
  createHash,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, loadSchemaValidator, validateBundle } from "./lib.mjs";

export const AUTHENTICITY_CLASSIFICATIONS = Object.freeze([
  "UNSIGNED_INTEGRITY_ONLY",
  "SIGNED",
  "SIGNED_WITH_IDENTITY",
  "WITNESSED",
  "TRANSPARENCY_RECORDED",
]);

export const ATTESTATION_DIAGNOSTICS = Object.freeze({
  SCHEMA_INVALID: "MCP_RES_ATTESTATION_SCHEMA_INVALID",
  SIGNATURE_MISSING: "MCP_RES_ATTESTATION_SIGNATURE_MISSING",
  UNSUPPORTED_ALGORITHM: "MCP_RES_ATTESTATION_ALGORITHM_UNSUPPORTED",
  SIGNATURE_INVALID: "MCP_RES_ATTESTATION_SIGNATURE_INVALID",
  BINDING_MISMATCH: "MCP_RES_ATTESTATION_BINDING_MISMATCH",
  TRUST_POLICY_EXPIRED: "MCP_RES_TRUST_POLICY_EXPIRED",
  KEY_REVOKED: "MCP_RES_ATTESTATION_KEY_REVOKED",
  DUPLICATE_SIGNER: "MCP_RES_ATTESTATION_DUPLICATE_SIGNER",
  IDENTITY_MISMATCH: "MCP_RES_ATTESTATION_IDENTITY_MISMATCH",
  UNTRUSTED_SIGNER: "MCP_RES_ATTESTATION_UNTRUSTED_SIGNER",
  CLASSIFICATION_OVERCLAIM: "MCP_RES_AUTHENTICITY_CLASSIFICATION_OVERCLAIM",
  EVIDENCE_INVALID: "MCP_RES_ATTESTED_EVIDENCE_INVALID",
  TRANSPARENCY_INVALID: "MCP_RES_TRANSPARENCY_REFERENCE_INVALID",
});

export function dssePAE(payloadType, payloadBytes) {
  const typeBytes = Buffer.from(payloadType, "utf8");
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${typeBytes.length} `, "utf8"),
    typeBytes,
    Buffer.from(` ${payloadBytes.length} `, "utf8"),
    payloadBytes,
  ]);
}

function publicKeyDer(publicKey) {
  const key = publicKey?.type === "public" ? publicKey : createPublicKey(publicKey);
  return key.export({ format: "der", type: "spki" });
}

function fingerprint(publicKey) {
  return createHash("sha256").update(publicKeyDer(publicKey)).digest("hex");
}

function strictBase64(value) {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    throw new Error("INVALID_BASE64");
  }
  return Buffer.from(value, "base64");
}

export function createAttestationStatement(bundle, options) {
  const keyFingerprint = fingerprint(options.publicKey);
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: [
      {
        name: bundle.evidence.subject.name,
        digest: { sha256: bundle.evidence.subject.artifactSha256 },
      },
    ],
    predicateType:
      "https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/attestation/v0.2",
    predicate: {
      evidenceBundleDigest: bundle.integrity.bundleDigest,
      scenarioFingerprint: bundle.evidence.scenario.fingerprint,
      executionInstanceDigest: bundle.statement.executionInstanceDigest,
      profile: { ...bundle.evidence.profile },
      validator: { ...bundle.statement.validator },
      signerIdentity: options.signerIdentity,
      signerKeyFingerprint: keyFingerprint,
      signatureAlgorithm: "Ed25519",
      signingTime: options.signingTime,
      trustPolicyId: options.trustPolicyId,
      ...(options.transparencyReference
        ? { transparencyReference: options.transparencyReference }
        : {}),
    },
  };
}

export function signAttestationEnvelope(bundle, options) {
  const statement = createAttestationStatement(bundle, options);
  return signStatementEnvelope(statement, options);
}

export function signStatementEnvelope(statement, options) {
  const payloadBytes = Buffer.from(canonicalize(statement), "utf8");
  const payloadType = "application/vnd.in-toto+json";
  const signature = cryptoSign(null, dssePAE(payloadType, payloadBytes), options.privateKey);
  const der = publicKeyDer(options.publicKey);
  const keyid = createHash("sha256").update(der).digest("hex");
  return {
    schemaVersion: "mcp-res.dsse-envelope/0.2.0",
    payloadType,
    payload: payloadBytes.toString("base64"),
    signatures: [
      {
        keyid,
        sig: signature.toString("base64"),
        algorithm: "Ed25519",
        publicKeySpkiBase64: der.toString("base64"),
        signerIdentity: options.signerIdentity,
      },
    ],
  };
}

export function wrapAttestations(bundle, claimedClassification, envelopes = []) {
  return {
    schemaVersion: "mcp-res.attested-conformance-bundle/0.2.0",
    bundle,
    authenticity: {
      schemaVersion: "mcp-res.authenticity/0.2.0",
      claimedClassification,
      envelopes,
    },
  };
}

function schemaResult(validate, value) {
  if (validate(value)) return undefined;
  return (validate.errors ?? []).map(({ instancePath, keyword, message }) => ({
    instancePath,
    keyword,
    message,
  }));
}

function attestationPreSchemaDiagnostic(wrapper) {
  for (const envelope of wrapper?.authenticity?.envelopes ?? []) {
    if (!Array.isArray(envelope.signatures) || envelope.signatures.length === 0) {
      return ATTESTATION_DIAGNOSTICS.SIGNATURE_MISSING;
    }
    if (envelope.signatures.some((signature) => signature.algorithm !== "Ed25519")) {
      return ATTESTATION_DIAGNOSTICS.UNSUPPORTED_ALGORITHM;
    }
  }
  return undefined;
}

export async function validateAttestedBundle(wrapper, options = {}) {
  const early = attestationPreSchemaDiagnostic(wrapper);
  if (early) return { valid: false, diagnostics: [early], schemaErrors: [] };
  const schemaDirectory =
    options.schemaDirectory ?? join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
  const { ajv } = await loadSchemaValidator(schemaDirectory);
  const wrapperValidate = ajv.getSchema(
    "https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/v0.2.0/schemas/attested-conformance-bundle.schema.json",
  );
  const wrapperErrors = schemaResult(wrapperValidate, wrapper);
  if (wrapperErrors) {
    return {
      valid: false,
      diagnostics: [ATTESTATION_DIAGNOSTICS.SCHEMA_INVALID],
      schemaErrors: wrapperErrors,
    };
  }
  const evidenceResult = await validateBundle(wrapper.bundle, { schemaDirectory });
  if (!evidenceResult.valid) {
    return {
      valid: false,
      diagnostics: [ATTESTATION_DIAGNOSTICS.EVIDENCE_INVALID, ...evidenceResult.diagnostics],
      schemaErrors: evidenceResult.schemaErrors,
    };
  }

  const claimed = wrapper.authenticity.claimedClassification;
  const envelopes = wrapper.authenticity.envelopes;
  if (envelopes.length === 0) {
    return claimed === "UNSIGNED_INTEGRITY_ONLY"
      ? {
          valid: true,
          diagnostics: [],
          schemaErrors: [],
          authenticityClassification: "UNSIGNED_INTEGRITY_ONLY",
        }
      : {
          valid: false,
          diagnostics: [ATTESTATION_DIAGNOSTICS.SIGNATURE_MISSING],
          schemaErrors: [],
        };
  }
  if (claimed === "UNSIGNED_INTEGRITY_ONLY") {
    return {
      valid: false,
      diagnostics: [ATTESTATION_DIAGNOSTICS.CLASSIFICATION_OVERCLAIM],
      schemaErrors: [],
    };
  }

  let trustPolicy = options.trustPolicy;
  if (trustPolicy) {
    const trustValidate = ajv.getSchema(
      "https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/v0.2.0/schemas/trust-policy.schema.json",
    );
    const trustErrors = schemaResult(trustValidate, trustPolicy);
    if (trustErrors) {
      return {
        valid: false,
        diagnostics: [ATTESTATION_DIAGNOSTICS.SCHEMA_INVALID],
        schemaErrors: trustErrors,
      };
    }
    const evaluatedAt = Date.parse(options.evaluatedAt ?? new Date().toISOString());
    if (
      evaluatedAt < Date.parse(trustPolicy.validFrom) ||
      evaluatedAt > Date.parse(trustPolicy.validUntil)
    ) {
      return {
        valid: false,
        diagnostics: [ATTESTATION_DIAGNOSTICS.TRUST_POLICY_EXPIRED],
        schemaErrors: [],
      };
    }
  }

  const statementValidate = ajv.getSchema(
    "https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/v0.2.0/schemas/attestation-statement.schema.json",
  );
  const seenSigners = new Set();
  let allTrusted = Boolean(trustPolicy);
  let hasTransparency = false;
  for (const envelope of envelopes) {
    if (envelope.signatures.length !== 1) {
      return {
        valid: false,
        diagnostics: [ATTESTATION_DIAGNOSTICS.DUPLICATE_SIGNER],
        schemaErrors: [],
      };
    }
    const signature = envelope.signatures[0];
    if (seenSigners.has(signature.keyid)) {
      return {
        valid: false,
        diagnostics: [ATTESTATION_DIAGNOSTICS.DUPLICATE_SIGNER],
        schemaErrors: [],
      };
    }
    seenSigners.add(signature.keyid);
    let payloadBytes;
    let der;
    let signatureBytes;
    try {
      payloadBytes = strictBase64(envelope.payload);
      der = strictBase64(signature.publicKeySpkiBase64);
      signatureBytes = strictBase64(signature.sig);
    } catch {
      return {
        valid: false,
        diagnostics: [ATTESTATION_DIAGNOSTICS.SIGNATURE_INVALID],
        schemaErrors: [],
      };
    }
    const keyFingerprint = createHash("sha256").update(der).digest("hex");
    if (keyFingerprint !== signature.keyid) {
      return {
        valid: false,
        diagnostics: [ATTESTATION_DIAGNOSTICS.IDENTITY_MISMATCH],
        schemaErrors: [],
      };
    }
    let publicKey;
    try {
      const ed25519SpkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
      if (
        der.length !== ed25519SpkiPrefix.length + 32 ||
        !der.subarray(0, ed25519SpkiPrefix.length).equals(ed25519SpkiPrefix)
      ) {
        throw new Error("INVALID_ED25519_SPKI");
      }
      publicKey = createPublicKey({ key: der, format: "der", type: "spki" });
    } catch {
      return {
        valid: false,
        diagnostics: [ATTESTATION_DIAGNOSTICS.SIGNATURE_INVALID],
        schemaErrors: [],
      };
    }
    if (
      !cryptoVerify(null, dssePAE(envelope.payloadType, payloadBytes), publicKey, signatureBytes)
    ) {
      return {
        valid: false,
        diagnostics: [ATTESTATION_DIAGNOSTICS.SIGNATURE_INVALID],
        schemaErrors: [],
      };
    }
    let statement;
    try {
      statement = JSON.parse(payloadBytes.toString("utf8"));
    } catch {
      return {
        valid: false,
        diagnostics: [ATTESTATION_DIAGNOSTICS.SCHEMA_INVALID],
        schemaErrors: [],
      };
    }
    if (!payloadBytes.equals(Buffer.from(canonicalize(statement), "utf8"))) {
      return {
        valid: false,
        diagnostics: [ATTESTATION_DIAGNOSTICS.SCHEMA_INVALID],
        schemaErrors: [],
      };
    }
    const statementErrors = schemaResult(statementValidate, statement);
    if (statementErrors) {
      return {
        valid: false,
        diagnostics: [ATTESTATION_DIAGNOSTICS.SCHEMA_INVALID],
        schemaErrors: statementErrors,
      };
    }
    const predicate = statement.predicate;
    if (
      statement.subject.length !== 1 ||
      statement.subject[0].name !== wrapper.bundle.evidence.subject.name ||
      statement.subject[0].digest.sha256 !== wrapper.bundle.evidence.subject.artifactSha256 ||
      predicate.evidenceBundleDigest !== wrapper.bundle.integrity.bundleDigest ||
      predicate.scenarioFingerprint !== wrapper.bundle.evidence.scenario.fingerprint ||
      predicate.executionInstanceDigest !== wrapper.bundle.statement.executionInstanceDigest ||
      canonicalize(predicate.profile) !== canonicalize(wrapper.bundle.evidence.profile) ||
      canonicalize(predicate.validator) !== canonicalize(wrapper.bundle.statement.validator)
    ) {
      return {
        valid: false,
        diagnostics: [ATTESTATION_DIAGNOSTICS.BINDING_MISMATCH],
        schemaErrors: [],
      };
    }
    if (
      predicate.signerIdentity !== signature.signerIdentity ||
      predicate.signerKeyFingerprint !== signature.keyid
    ) {
      return {
        valid: false,
        diagnostics: [ATTESTATION_DIAGNOSTICS.IDENTITY_MISMATCH],
        schemaErrors: [],
      };
    }
    if (predicate.signatureAlgorithm !== "Ed25519") {
      return {
        valid: false,
        diagnostics: [ATTESTATION_DIAGNOSTICS.UNSUPPORTED_ALGORITHM],
        schemaErrors: [],
      };
    }
    if (trustPolicy) {
      if (predicate.trustPolicyId !== trustPolicy.id) {
        return {
          valid: false,
          diagnostics: [ATTESTATION_DIAGNOSTICS.IDENTITY_MISMATCH],
          schemaErrors: [],
        };
      }
      if (
        Date.parse(predicate.signingTime) < Date.parse(trustPolicy.validFrom) ||
        Date.parse(predicate.signingTime) > Date.parse(trustPolicy.validUntil) ||
        Date.parse(predicate.signingTime) >
          Date.parse(options.evaluatedAt ?? new Date().toISOString())
      ) {
        return {
          valid: false,
          diagnostics: [ATTESTATION_DIAGNOSTICS.TRUST_POLICY_EXPIRED],
          schemaErrors: [],
        };
      }
      if (trustPolicy.revokedKeyFingerprints.includes(signature.keyid)) {
        return {
          valid: false,
          diagnostics: [ATTESTATION_DIAGNOSTICS.KEY_REVOKED],
          schemaErrors: [],
        };
      }
      const trusted = trustPolicy.trustedSigners.some(
        (entry) =>
          entry.keyFingerprint === signature.keyid &&
          entry.signerIdentity === signature.signerIdentity,
      );
      allTrusted &&= trusted;
    }
    if (predicate.transparencyReference) {
      let proof;
      try {
        proof = strictBase64(predicate.transparencyReference.inclusionProofBase64);
      } catch {
        return {
          valid: false,
          diagnostics: [ATTESTATION_DIAGNOSTICS.TRANSPARENCY_INVALID],
          schemaErrors: [],
        };
      }
      const proofDigest = createHash("sha256").update(proof).digest("hex");
      if (proofDigest !== predicate.transparencyReference.inclusionProofSha256) {
        return {
          valid: false,
          diagnostics: [ATTESTATION_DIAGNOSTICS.TRANSPARENCY_INVALID],
          schemaErrors: [],
        };
      }
      hasTransparency = true;
    }
  }

  let derived = "SIGNED";
  if (allTrusted) derived = "SIGNED_WITH_IDENTITY";
  if (allTrusted && seenSigners.size >= 2) derived = "WITNESSED";
  if (allTrusted && hasTransparency) derived = "TRANSPARENCY_RECORDED";
  const claimedIndex = AUTHENTICITY_CLASSIFICATIONS.indexOf(claimed);
  const derivedIndex = AUTHENTICITY_CLASSIFICATIONS.indexOf(derived);
  if (claimedIndex >= 2 && !allTrusted) {
    return {
      valid: false,
      diagnostics: [ATTESTATION_DIAGNOSTICS.UNTRUSTED_SIGNER],
      schemaErrors: [],
    };
  }
  if (claimedIndex > derivedIndex) {
    return {
      valid: false,
      diagnostics: [ATTESTATION_DIAGNOSTICS.CLASSIFICATION_OVERCLAIM],
      schemaErrors: [],
    };
  }
  return {
    valid: true,
    diagnostics: [],
    schemaErrors: [],
    authenticityClassification: derived,
    evidenceClass: wrapper.bundle.statement.evidenceClass,
  };
}
