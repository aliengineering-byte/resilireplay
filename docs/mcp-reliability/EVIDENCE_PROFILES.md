# MCP reliability evidence profiles

Profiles describe where evidence came from. Levels in the
[ResiliReplay MCP Reliability Evidence Profile](MCP_RELIABILITY_STANDARD.md) describe how far a
result progressed. Always
publish both; for example, `PUBLIC_LOCAL_SERVER / M4 REGRESSION_VERIFIED / stdio`.

## Profiles

| Profile                   | Target boundary                                                             | What it can establish                                                 | Mandatory disclosure                                                               |
| ------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `SYNTHETIC_LOCAL_FIXTURE` | Repository-owned inert fixture on stdio or loopback HTTP                    | Harness, transport, fault, recovery, and regression behavior          | Label synthetic; fixture source and mode; no server-generalization claim           |
| `PUBLIC_LOCAL_SERVER`     | Pinned license-compatible public server launched locally with no credential | Behavior of the exact allowlisted operation and pinned package        | Repository, package, revision/integrity, operation semantics, local data, cleanup  |
| `OWNED_REMOTE_SANDBOX`    | User-owned disposable remote endpoint with explicit authorization           | Exact endpoint profile and auth/transport behavior under the campaign | Ownership, region/data boundary, synthetic account/data, costs, retention, cleanup |
| `PRIVATE_LOCAL_SERVER`    | User-owned local code or data that cannot be published                      | Local decision support                                                | State that evidence is private; do not claim public reproducibility                |
| `DOCUMENTED_MAPPING`      | No executed target                                                          | Candidate campaign, adapter, or boundary for review                   | Clearly mark unexecuted and list the blocker                                       |

`THIRD_PARTY_REMOTE` is intentionally absent. Do not fault-test a remote service merely because its
endpoint is public.

## Operation classes

Classify the allowlisted operation before contact:

| Class                    | First-run policy                                                                   | Retry policy                                                  |
| ------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `READ_ONLY_IDEMPOTENT`   | Permitted on local/owned disposable data after schema review                       | At most one retry in the minimum campaign                     |
| `LOCAL_DISPOSABLE_WRITE` | Permitted only with explicit fixture, rollback, and cleanup                        | Default no retry; justify any retry with idempotency evidence |
| `EXTERNAL_SIDE_EFFECT`   | Excluded from public field cases unless an owned sandbox makes the effect harmless | No retry by default                                           |
| `DESTRUCTIVE_OR_UNKNOWN` | Do not invoke; discovery/config validation only                                    | Never retry                                                   |

Tool annotations inform classification but do not replace source, documentation, and argument review.

## Profile checklist

A shareable profile records:

- ResiliReplay version, server version, source revision or package integrity;
- transport and whether the endpoint was local, loopback, or owned remote;
- tool name, reviewed arguments, operation class, data class, expected effect;
- credentials as `none`, `environment-reference`, or `owned-sandbox` without values;
- campaign and target-config hashes;
- result level, limitations, failed setup attempts, and cleanup verification.

Use `metadata-only` evidence for public results. A screenshot may accompany a result but cannot
replace the machine-readable record, exact commands, and hashes.

## Current public examples

- Repository-owned stdio and authenticated loopback Streamable HTTP fixtures are
  `SYNTHETIC_LOCAL_FIXTURE`.
- MCP Everything, Playwright MCP, UI5 MCP Server, MCP Filesystem, and MCP Memory are
  `PUBLIC_LOCAL_SERVER` cases. Each claim is limited to its pinned version and allowlisted operation.

No case is a security audit, compatibility certification, adoption claim, or maintainer endorsement.
