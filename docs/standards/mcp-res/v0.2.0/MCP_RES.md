# MCP Reliability Evidence Standard — Draft v0.2.0

Status: **project-defined development draft**. Updated: `2026-08-27`.

MCP-RES describes portable evidence for bounded MCP reliability experiments. It does not redefine MCP, confer security certification, or turn one tested case into a general product claim. Normative terms are interpreted as in RFC 2119 and RFC 8174.

## 1. Version boundary

`mcp-res.conformance-bundle/0.2.0` is a new conformance unit. A v0.1 bundle remains a v0.1 bundle and MUST be evaluated with v0.1 semantics. A converter MUST mark producer-written v0.1 assertions `LEGACY_SELF_ASSERTED`; it MUST NOT promote them into integrity-bound v0.2 observations.

## 2. Reason-bound negative observations

**MCPRES-NEG-002 — Reason-Bound Negative Observation.** A `PASS` claim MUST contain a negative control that binds `propertyUnderTest`, `propertyReached`, `expectedVerdict`, `observedVerdict`, `expectedStopReason`, `observedStopReason`, `oracleEvidenceRef`, and `prerequisitesReached`. A mutation experiment MAY also bind `mutantId` and `mutantKilled`.

The validator MUST reject an unqualified `PASS` when the target property was not reached, a prerequisite was not reached, the observed verdict differs, the stop reason differs, causal reachability cannot be observed, or a declared mutant survives. Verdict equality alone is insufficient.

The stable diagnostics are:

- `MCP_RES_PROPERTY_NOT_REACHED`;
- `MCP_RES_WRONG_STOP_REASON`;
- `MCP_RES_NEGATIVE_MUTANT_SURVIVED`;
- `MCP_RES_NEGATIVE_PREREQUISITE_MISSING`;
- `MCP_RES_VACUOUS_NEGATIVE_CONTROL`.

The reason codes are evidence vocabulary, not new MCP wire fields. A harness, fixture, or auditor MAY produce them, but its observation and oracle artifacts MUST be integrity-bound.

## 3. Integrity-bound observation model

**MCPRES-OBS-001.** Every consequential claim MUST be derived from observations conforming to `mcp-res.observation/0.2.0`. Each observation identifies its producer, subject, optional operation, monotonic timing, outcome, reason code, artifact references, and a digest of the observation with `observationSha256` omitted.

Every `artifactRef` MUST resolve to the integrity manifest. At least one referenced artifact MUST carry the observation digest. Missing, altered, cross-subject, or cross-operation observation evidence is non-conformant.

**MCPRES-OBS-002.** The validator derives evidence class as follows:

| Derived class             | Required passing observations                                             |
| ------------------------- | ------------------------------------------------------------------------- |
| `GENUINE_RUNTIME`         | process execution, protocol exchange, and integrity-bound source evidence |
| `FIXTURE_BACKED_PROTOCOL` | protocol exchange and fixture execution                                   |
| `FIXTURE_VERIFIED`        | fixture execution                                                         |
| `INSTALLATION_VERIFIED`   | installation execution                                                    |
| `DOCUMENTED_ONLY`         | none of the execution observations above                                  |

A declared class that is stronger or different from the derived class fails with `MCP_RES_EVIDENCE_CLASS_PROMOTION`. Cleanup completion and privacy scanning are likewise derived from passing `CLEANUP_CHECK` and `PRIVACY_SCAN` observations; producer booleans are neither accepted nor inferred.

## 4. Scenario and execution identity

**MCPRES-ID-003 — Scenario fingerprint.** `scenarioFingerprint` is the SHA-256 of the canonical scenario descriptor. The descriptor includes standard and profile versions, protocol revision, subject and configuration digests, operation class, fault definitions, recovery policies, side-effect model, resource limits, validator policy, and deterministic seed. It excludes timestamps, run IDs, temporary paths, host/user names, PIDs, CI identifiers, and ambient environment ordering.

**MCPRES-ID-004 — Execution instance digest.** `executionInstanceDigest` binds the scenario fingerprint, run identity, runner/environment identity, start and finish timestamps, monotonic duration, ordered observation digests, actual result, and supporting-artifact manifest digest. Equivalent reruns therefore share a scenario fingerprint but have distinct execution digests.

A digest mismatch is `MCP_RES_SCENARIO_FINGERPRINT_MISMATCH` or `MCP_RES_EXECUTION_DIGEST_MISMATCH`. Reusing an operation or observation under another run is `MCP_RES_CROSS_RUN_SUBSTITUTION`. Parent-operation cycles are `MCP_RES_OPERATION_PARENT_CYCLE`.

## 5. Observation coverage

**MCPRES-COV-001.** A bundle MUST contain `mcp-res.observation-coverage/0.2.0` entries for MCP wire messages, raw HTTP request and response paths, stdio input/output, child processes, disconnects, retries, filesystem output, cleanup, regression execution, authorization redirects, token endpoint behavior, and cache behavior.

Each surface is `INSTRUMENTED`, `OBSERVED_INDIRECTLY`, `BYPASSED_INTENTIONALLY`, `UNINSTRUMENTED`, `UNKNOWN`, or `NOT_APPLICABLE`. A required surface marked `UNINSTRUMENTED` or `UNKNOWN`, or an instrumented surface without a resolving observation, prevents `PASS` and emits `MCP_RES_REQUIRED_SURFACE_UNOBSERVED`. This makes observation bypass explicit even when the behavioral outcome appears successful.

## 6. Trial summaries

**MCPRES-TRIAL-001.** A claim described as stable across repeated trials MUST include `mcp-res.trial-summary/0.2.0`: planned/completed counts, exact seeds, process count, result counts, distinct outcome hashes, valid minimum/median/p95 durations, environment matrix, stop rule, and classification.

Valid classifications are `SINGLE_OBSERVATION`, `REPEATED_STABLE`, `FLAKY`, `INCOMPLETE`, and `ENVIRONMENT_DEPENDENT`. One completed run is `SINGLE_OBSERVATION`, never `REPEATED_STABLE`. Counts and hashes MUST agree; inconsistent summaries fail with `MCP_RES_TRIAL_SUMMARY_INCONSISTENT` or `MCP_RES_FALSE_STABILITY_CLAIM`.

## 7. Causality and bounded recovery

All operation IDs MUST be unique. Every operation MUST name the current run. Parent, fault, and recovery-policy references MUST resolve without cycles. Retry attempts MUST NOT exceed the referenced finite policy limit. Wall-clock finish MUST NOT precede start, and monotonic duration MUST fit the declared run interval.

## 8. Conformance statement and integrity

A conformance statement binds the standard/profile/protocol versions, exact subject, derived evidence class, result, scenario fingerprint, execution digest, stability classification, evidence digest, and validator identity. The integrity manifest lists canonical byte length and SHA-256 for the evidence and statement plus all supporting artifacts, rejects duplicate paths, and binds the sorted artifact list in `bundleDigest`.

Draft v0.2 deliberately continues to use the explicit `mcp-res-json-utf16-v1` algorithm so scenario, execution, and evidence digests remain reproducible across the two implementations. Both validators reject unsafe integers and lone surrogates instead of silently normalizing language differences. RFC 8785 remains a candidate for a future, separately versioned dual-hash profile; no v0.1 digest is rewritten.

## 9. Limits of a result

`PASS` means only that the exact pinned subject and scenario satisfied this version and profile with the recorded coverage. It does not prove unobserved paths, unrelated protocol behavior, security, production availability, interoperability outside the matrix, or independent adoption.

## 10. Authenticity and trust

**MCPRES-AUTHN-001.** Content integrity, producer authenticity, trust in the producer, the reliability result, and security certification are separate dimensions. An implementation MUST NOT upgrade evidence class or change a failing reliability result because an attestation is present.

**MCPRES-AUTHN-002.** An optional `mcp-res.attested-conformance-bundle/0.2.0` MAY classify authenticity as `UNSIGNED_INTEGRITY_ONLY`, `SIGNED`, `SIGNED_WITH_IDENTITY`, `WITNESSED`, or `TRANSPARENCY_RECORDED`. A claimed level MUST NOT exceed the validator-derived level. Trust evaluation MUST name an explicit policy and MUST fail for expired policy, revoked key, duplicate witness, or signer/key identity mismatch.

**MCPRES-AUTHN-003.** A signed envelope MUST bind the in-toto statement/predicate types, subject digest, evidence bundle digest, scenario fingerprint, execution digest, profile, validator, signer/key identity, signature algorithm, signing time, trust-policy ID, and any transparency reference through DSSE pre-authentication encoding. Draft v0.2 supports Ed25519. Offline validation MUST NOT require a network or cloud account.

The detailed classification and envelope rules are in [AUTHENTICITY.md](AUTHENTICITY.md).

## 11. Migration

**MCPRES-MIG-001.** A v0.1-to-v0.2 migration MUST preserve the original bundle and evidence digest, record the migration tool digest, preserve evidence class, label producer assertions `LEGACY_SELF_ASSERTED`, emit `INCOMPLETE`, and MUST NOT fabricate observations, reason-bound failures, signatures, trial repetition, scenario identity, or execution identity.

Migration output is a `mcp-res.migration-result/0.2.0` report, not a v0.2 conformance result. [MIGRATION.md](MIGRATION.md) defines the command, containment, conflict, dry-run, and idempotency behavior.
