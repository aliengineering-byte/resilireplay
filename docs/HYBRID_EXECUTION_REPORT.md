# Hybrid execution report

Release: ResiliReplay v0.3.0 Studio & Campaigns

Date: 2026-08-04

This report records model roles and dispositions without implying consensus or hiding provider
failures. Codex remained the accountable release leader and performed all implementation, testing,
security decisions, repository changes, and publication work.

## Capability audit (H0)

Only the four explicitly approved launcher surfaces were inspected. No configuration, source, or
secret store in the neighboring launcher repository was read or modified.

| Route             | Ordinary response          | Streaming         | Continuation    | Read/edit boundary                       | Disposition                                             |
| ----------------- | -------------------------- | ----------------- | --------------- | ---------------------------------------- | ------------------------------------------------------- |
| GLM launcher      | Pass                       | Pass              | Pass            | Read/edit requests denied by role policy | Eligible for advisory text only; not needed after audit |
| DeepSeek launcher | Pass                       | Pass              | Pass            | Read-only                                | Strongest eligible architecture/security advisor        |
| Qwen launcher     | Timed out                  | Timed out         | Not established | Not established                          | Excluded from critical path; no fallback claim          |
| Hybrid menu       | Launcher surface confirmed | Not a model route | Not applicable  | Not used for repository work             | Audit only                                              |

Retry behavior internal to provider gateways was not observable through the approved launcher
surface and is reported as unverifiable rather than inferred. No custom-provider section was found in
the local Codex configuration available to the release leader.

## Delegated advisory

DeepSeek received a read-only architecture/security assignment. Two attempts to inspect the full file
set did not produce an advisory: one used the provider environment's wrong working-root assumption,
and one exhausted its turn bound while reading. A final bounded attempt read one compact brief, made
no tool calls beyond that file, made no edits, and returned five hypotheses. Fallback was disabled.

Independent disposition:

| Advisory hypothesis                       | Decision              | Evidence/action                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loopback HTTP Host check is forgeable     | Rejected as stated    | Studio requires exact `127.0.0.1:<port>` Host; a rebinding hostname fails. Every presented Origin is checked and all state changes require the exact Studio Origin plus CSRF. Bootstrap GET is not state-changing and creates, rather than accepts, the session ID. Same-user malware is an explicit residual risk. |
| Session lifetime is unbounded             | Accepted as hardening | Added a 15-minute server-side expiry and cookie `Max-Age`; shutdown still invalidates the in-memory session immediately.                                                                                                                                                                                            |
| Campaign confirmation hash collision      | Rejected              | The implementation uses canonical SHA-256; a practical chosen collision is not a release threat. Confirmation remains single-use and bound to the reviewed canonical campaign.                                                                                                                                      |
| Baseline can outlive/lose source evidence | Rejected as stated    | Baseline embeds the verified source run hash and its own canonical SHA-256; compare reparses and recomputes run/baseline hashes before use. The baseline is intentionally standalone evidence.                                                                                                                      |
| Trace size has no hard production bound   | Accepted              | Added 100,000-event and 32 MiB limits before parse/write, plus a pre-parse over-limit test.                                                                                                                                                                                                                         |

No delegated model authored or approved code. The accepted recommendations were implemented and
verified by Codex; rejected recommendations are retained here so the review record is not laundered
into false agreement.

## Codex gap scan

After advisory disposition, Codex rechecked cancellation propagation, tool confirmation reuse,
remote authorization, path and symlink containment, header/control input, body caps, secret
non-persistence, invalid/incomplete comparisons, retry-budget consumption, generated regression
execution, browser accessibility, and cleanup. The final release gates and any remaining limitations
are recorded in [`RELEASE_EVIDENCE.md`](../RELEASE_EVIDENCE.md) and
[`LIMITATIONS.md`](LIMITATIONS.md).
