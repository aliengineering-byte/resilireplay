# MCP-RES v0.2 authenticity and trust

Status: **development draft**. This is a project-defined layer informed by DSSE and the in-toto Attestation Framework. It is not a security certification or a claim that a signer is trustworthy.

## 1. Separate dimensions

MCP-RES keeps these dimensions independent:

- **content integrity**: digests detect byte changes;
- **producer authenticity**: a signature proves possession of a private key for the signed payload;
- **trust in producer**: a caller-supplied policy decides whether a key/identity is trusted;
- **reliability result**: the core evidence validator decides whether the bounded scenario passed;
- **security certification**: MCP-RES does not provide one.

Signing MUST NOT change `evidenceClass`. `GENUINE_RUNTIME + UNSIGNED_INTEGRITY_ONLY` and `FIXTURE_BACKED_PROTOCOL + SIGNED_WITH_IDENTITY` are both valid combinations. A signature over invalid evidence remains invalid.

## 2. Authenticity classifications

| Classification            | Minimum meaning                                                                                                                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNSIGNED_INTEGRITY_ONLY` | Core digest integrity only; no signature.                                                                                                                                                                                                       |
| `SIGNED`                  | At least one valid signature. The key need not be trusted.                                                                                                                                                                                      |
| `SIGNED_WITH_IDENTITY`    | A valid signature whose key fingerprint and signer identity match an explicit, unexpired, non-revoked trust policy.                                                                                                                             |
| `WITNESSED`               | At least two distinct trusted signer keys bind the same evidence bundle.                                                                                                                                                                        |
| `TRANSPARENCY_RECORDED`   | A trusted signature also binds a transparency-log identifier, entry identifier, and digest-matching embedded inclusion-proof bytes. This records the supplied reference; it does not independently certify the log or promise online inclusion. |

A validator MAY derive a stronger level than the producer claims, but MUST reject an overclaim. Duplicate key fingerprints do not count as witnesses.

## 3. Wrapper and signed payload

Attestations use an outer `mcp-res.attested-conformance-bundle/0.2.0` wrapper. The already-integrity-bound conformance bundle remains unchanged inside it, preventing circular digests.

Each `mcp-res.dsse-envelope/0.2.0` uses DSSE pre-authentication encoding and signs canonical UTF-8 bytes of an in-toto Statement v1-shaped record. The predicate binds:

- statement and predicate types;
- subject name and SHA-256;
- evidence bundle digest;
- scenario fingerprint;
- execution instance digest;
- profile ID/version;
- validator identity/version/digest;
- signer identity and public-key fingerprint;
- `Ed25519` algorithm;
- signing time;
- trust-policy identifier;
- optional transparency reference.

PR 2 supports `Ed25519` only. Other algorithms fail explicitly; they are not normalized or guessed.

## 4. Offline trust evaluation

Verification uses only the wrapper, public key material, public schemas, and an optional caller-supplied `mcp-res.trust-policy/0.2.0`. It requires no network, cloud account, transparency service, or ResiliReplay runtime. Trust policy validity dates, key revocation, key fingerprint, and signer identity are evaluated offline.

The committed test corpus contains no private key. Tests generate disposable Ed25519 keypairs in memory, persist only public material/signatures, and cross-check the JavaScript and Python verifiers.

## 5. Required failures

Stable diagnostics cover missing/invalid signatures, unsupported algorithms, subject/bundle binding mismatch, expired policy, revoked key, duplicate signer, identity mismatch, untrusted signer, classification overclaim, bad transparency reference, and valid signature over invalid evidence.

Authenticity answers “who possessed this key when these bytes were signed?” Trust remains a policy decision, and neither answer expands the bounded reliability claim.
