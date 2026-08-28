# Provisional protocol reliability profiles

All six v1 manifests in this draft are **PROVISIONAL**. They describe bounded, reason-bound reliability observations for named released MCP revisions and extensions. They are not official MCP profiles, interoperability certification, security certification, or evidence of independent adoption.

| Profile                         | Revisions                  | Scope boundary                                                                                                                                                                                                                                                                                                                     |
| ------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp-res/protocol-revision/v1`  | `2025-11-25`, `2026-07-28` | Version advertisement/skew, modern versus legacy behavior, request/result identity metadata, capabilities/extensions, schema identity, safe integers, unrelated interleaving, and the prohibition on treating a connection as a conversation; 2026-only stateless, discovery, session-ID, and `resultType` checks are conditional. |
| `mcp-res/async-operation/v1`    | `2026-07-28`               | MRTR, the negotiated Tasks extension, subscriptions, progress, and cancellation retain separate primitives and causality. The profile does not invent one lifecycle.                                                                                                                                                               |
| `mcp-res/streamable-http/v1`    | both                       | Authenticated loopback JSON/SSE behavior, interruption, bounded consumption, timeouts, retry/duplication, cancellation, malformed/oversized input, slow consumers/backpressure, redirects, listener/socket cleanup.                                                                                                                |
| `mcp-res/stdio-transport/v1`    | both                       | Released line framing, stdout purity, stderr diagnostics, shell-free arguments, executable identity, bounded startup/output, concurrency/interruption, exit and child-tree cleanup. Process lifetime is not conversation identity.                                                                                                 |
| `mcp-res/cache-behavior/v1`     | `2026-07-28`               | Released `ttlMs`/`cacheScope` identity, expiry, invalidation, isolation, negative caching, and poisoning boundaries. ETag revalidation is roadmap-derived, `EXPERIMENTAL`, and unscored.                                                                                                                                           |
| `mcp-res/extension-boundary/v1` | both                       | Extension identity/version/capability negotiation and core/extension schema separation. MCP Apps observations are `EXPERIMENTAL` and cannot certify browser, UI, sandbox, or application security.                                                                                                                                 |

## Evaluation semantics

An evaluation binds an exact subject artifact digest, environment, manifest digest, protocol revision, target digest, claim scope, positive observation, negative control, cleanup observation, and evaluation digest. Every observation MUST show that the property was reached and MUST match both the expected outcome and the exact reason code. A wrong-reason or earlier rejection fails.

`FULL_PROFILE` requires every required and revision-applicable conditional check. `BOUNDED_CHECK_SET` names only the reached checks and cannot be generalized. Experimental checks are never silently pulled into a full provisional claim.

A remote HTTP target is denied by default. It requires explicit opt-in, an allowlist digest, and a reviewed target digest identical to the executed target digest. The v0.2 CI and committed field fixtures contact loopback only.

Any `TEST_FIXTURE` observation forces `INCOMPLETE`, even if its modeled outcome matches. Only reached runtime or sanitized official observations can contribute to `PASS`, and a pass remains bounded to its exact check set and subject.

## Version-skew rule

Results from different protocol revisions are never equivalent by default. The protocol revision is part of the profile identity, target scenario, and evaluation digest. A revision unsupported by the selected manifest is `MCP_RES_PROFILE_REVISION_UNSUPPORTED`; conditional 2026 behavior cannot be inferred from a 2025 result.
