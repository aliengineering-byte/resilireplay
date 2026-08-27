# Conformance

## Validation order

A validator MUST apply, in order:

1. an input-byte ceiling and JSON parse;
2. forbidden credential/header/identity checks that can safely run on malformed records;
3. all referenced JSON Schema 2020-12 documents;
4. profile/version and subject-type registry checks;
5. evidence-class derivation;
6. clean and expected-failure controls;
7. causal operation/fault/recovery references;
8. bounded retry and side-effect safety;
9. executable-regression rules when claimed;
10. cleanup completion;
11. canonical byte lengths and SHA-256 values;
12. exact statement-to-envelope binding.

The first stable diagnostic is sufficient for v0.1. A validator MAY report additional diagnostics but MUST preserve the primary code for a published invalid vector.

## Stable diagnostic registry

| Code                                | Meaning                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `MCP_RES_SCHEMA_INVALID`            | A closed schema or bounded field failed.                                             |
| `MCP_RES_MISSING_CLEAN_CONTROL`     | No passing uninjected control exists.                                                |
| `MCP_RES_VACUOUS_NEGATIVE_CONTROL`  | The deliberately broken case did not fail as expected.                               |
| `MCP_RES_UNBOUNDED_RETRY`           | Retry is absent, infinite, or non-numeric.                                           |
| `MCP_RES_CLEANUP_INCOMPLETE`        | Cleanup, owned processes/listeners, target state, or completion is unsafe.           |
| `MCP_RES_DIGEST_MISMATCH`           | Canonical evidence, statement, artifact, or bundle digest differs.                   |
| `MCP_RES_PARTIAL_MANIFEST`          | The manifest is missing, incomplete, or not published last.                          |
| `MCP_RES_SECRET_DETECTED`           | Encoded secret-shaped material was detected.                                         |
| `MCP_RES_AUTH_HEADER_FORBIDDEN`     | A raw authorization header was present.                                              |
| `MCP_RES_SUBJECT_AMBIGUOUS`         | Required subject identity is missing.                                                |
| `MCP_RES_PROFILE_UNSUPPORTED`       | Profile/version or subject type is not registered.                                   |
| `MCP_RES_CAUSAL_MISMATCH`           | Run, parent, fault, policy, statement, or target binding differs.                    |
| `MCP_RES_SIDE_EFFECT_RETRY_UNSAFE`  | A side-effecting/unknown retry lacks testable safety evidence.                       |
| `MCP_RES_EVIDENCE_TOO_LARGE`        | An evidence or declared size ceiling was exceeded.                                   |
| `MCP_RES_NONDETERMINISTIC_IDENTITY` | Environment-dependent identity material was supplied.                                |
| `MCP_RES_EVIDENCE_CLASS_PROMOTION`  | Execution facts do not support the evidence class.                                   |
| `MCP_RES_REGRESSION_INVALID`        | A claimed executable regression lacks required negative/positive or safety evidence. |

## Claim result

`PASS` means every applicable core and profile requirement passed. `FAIL` means a complete bundle records a reliability non-conformance. `INCOMPLETE` means a run or publication did not reach a safe complete state. A manifest with `complete: false` is not a conforming evidence bundle even when retained for diagnosis.

## Reproduction

The authoritative vector catalog records byte SHA-256 values. A consumer SHOULD verify the catalog hashes, run all valid and invalid vectors, and publish validator identity before evaluating a third-party bundle. See [the five-minute procedure](FIVE_MINUTES.md).
