# Portable MCP reliability result schema

This document defines the `mcp-reliability-result/0.1` contribution profile. It is a portable summary
of existing ResiliReplay evidence, not a new runtime output format. The immutable
`campaign-run.json`, generated regression manifest, and their hashes remain authoritative.

## Required document

```json
{
  "schema": "mcp-reliability-result/0.1",
  "profile": "PUBLIC_LOCAL_SERVER",
  "level": "REGRESSION_VERIFIED",
  "transport": "stdio",
  "producer": {
    "name": "ResiliReplay",
    "version": "0.6.0"
  },
  "target": {
    "name": "Example server",
    "package": "@scope/server@1.2.3",
    "revision": "40-hex-commit-or-null",
    "registryIntegrity": "sha512-base64-or-null",
    "license": "SPDX-or-reviewed-license-note"
  },
  "boundary": {
    "authorization": "public-local-no-key",
    "operation": "safe_read",
    "operationClass": "READ_ONLY_IDEMPOTENT",
    "dataClass": "synthetic-public-fixture",
    "remoteNetworkTarget": false,
    "credentials": "none",
    "expectedSideEffects": "none"
  },
  "campaign": {
    "id": "example-field-test",
    "campaignSha256": "64-lowercase-hex",
    "targetConfigSha256": "64-lowercase-hex",
    "seed": 42,
    "status": "complete",
    "runSha256": "64-lowercase-hex"
  },
  "outcome": {
    "expectationsMatched": 3,
    "expectationsTotal": 3,
    "cleanControl": "passed",
    "faultApplied": true,
    "boundedRecovery": true,
    "retryCount": 1,
    "timeToRecoveryMs": 2,
    "duplicateSideEffectAttempts": 0,
    "safetyPolicyCompliance": true,
    "expectedFailureObserved": true
  },
  "regression": {
    "status": "generated",
    "verified": true,
    "fixtureSha256": "64-lowercase-hex",
    "testSha256": "64-lowercase-hex"
  },
  "cleanup": {
    "serverProcessesRemaining": 0,
    "listenersRemaining": 0,
    "disposableStateRemoved": true
  },
  "limitations": [
    "Exact pinned operation only",
    "Synthetic injected failures are not vulnerabilities"
  ]
}
```

## Validation rules

- `schema` MUST equal `mcp-reliability-result/0.1`; unknown revisions fail closed.
- `profile`, `level`, and `operationClass` MUST use values defined by the standard.
- Hashes MUST be lowercase SHA-256 hex. `registryIntegrity` retains the registry algorithm prefix.
- A result with `campaign.status` other than `complete` MUST NOT claim `EXECUTED_CONTROL` or higher.
- `expectationsMatched` MUST equal `expectationsTotal` for a passing campaign claim.
- `expectedFailureObserved: true` means the declared negative scenario produced an underlying failed
  outcome; it does not mean recovery succeeded.
- `timeToRecoveryMs` and any unavailable numeric metric MUST be `null`, never zero or estimated.
- `REGRESSION_VERIFIED` requires `status: generated`, `verified: true`, and matching fixture/test
  hashes.
- Paths, tokens, raw headers, tool bodies, usernames, and personal data are forbidden.

## Mapping from `campaign-run.json`

| Portable field                 | Source                                                               |
| ------------------------------ | -------------------------------------------------------------------- |
| `campaign.status`, `runSha256` | `status`, `runHash`                                                  |
| matched/total                  | `summary.passedCount`, `summary.total`                               |
| fault and retry fields         | selected `results[].faultApplied` and `results[].metrics`            |
| expected failure               | declared `assertions.outcome: failed` plus `observedOutcome: failed` |
| target config hash             | `results[].targetSourceSha256` in the derived campaign report        |
| regression state               | failing scenario `regression` plus generated `manifest.json`         |

Keep the original campaign and machine output beside the portable result so reviewers can verify the
mapping rather than trusting a prose claim.
