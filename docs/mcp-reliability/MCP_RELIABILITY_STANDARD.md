# ResiliReplay MCP Reliability Evidence Profile

Status: project-defined working profile, revision 0.1 (2026-08-08).

This profile defines the minimum evidence ResiliReplay requires for a bounded, reproducible claim
about how an MCP server behaves under failure. It is an open testing convention maintained in the
ResiliReplay repository. It is not part of the Model Context Protocol specification, an official or
community-wide standard, a security standard, a certification program, or an endorsement of any
server.

## Minimum claim

A conforming result says only this:

> A pinned server and operation, inside a declared boundary, produced the recorded clean and faulted
> outcomes under the published campaign, and the sanitized evidence verifies its own integrity.

It does not generalize to other versions, tools, data, transports, hosts, authentication modes, load,
or production conditions. A synthetic injected failure is not a discovered vulnerability.

## Required controls

Every result MUST include all of the following:

1. **Pinned identity.** Name the server package and version plus a source commit or registry
   integrity when available. Pin the ResiliReplay version and campaign schema.
2. **Declared authority and boundary.** State who owns or authorized the target, transport, network
   reach, data class, credentials, exact tool allowlist, reviewed arguments, expected side effects,
   budgets, and cleanup. Remote targets require explicit ownership and CLI authorization.
3. **Clean control.** Run the same operation without an injected fault. If the clean control does not
   pass, fault results are invalid rather than evidence of recovery.
4. **Deterministic fault.** Publish the fault class, seed, target, occurrence, retry policy, timeout,
   and expectations. A result MUST distinguish injected conditions from observed server behavior.
5. **Expected failure.** Include at least one negative control whose correct result is failure. The
   campaign passes only when that failure remains a failure; fail-open scoring is non-conforming.
6. **Bounded recovery.** If recovery is claimed, publish the retry ceiling, actual retries, recovery
   outcome, time to recovery when available, duplicate-side-effect count, and safety-policy result.
7. **Integrity and reproduction.** Publish the canonical campaign hash, target-config hash, run hash,
   exact commands, result status, and a generated executable regression when the run has a causal
   failure. Hash-invalid, incomplete, cancelled, or unavailable evidence cannot pass.
8. **Privacy and cleanup.** Remove credentials, authorization values, private paths, production
   traces, personal data, and application payloads. State what was deleted and verify that spawned
   processes and listeners stopped.

`metadata-only` is the preferred shareable evidence mode. It retains tool names, fault and causal
metadata, metrics, and hashes while omitting raw MCP tool request and result bodies.

## Reliability dimensions

| Dimension          | Minimum evidence                                                     | Non-conforming shortcut                                     |
| ------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Availability       | Successful initialize, discovery, and clean operation                | Treating tool discovery as tool success                     |
| Fault handling     | Seeded fault applied at a named protocol or tool boundary            | Unrepeatable manual interruption                            |
| Recovery           | Explicit retry/fallback policy and observed bounded result           | Calling any eventual success recovery                       |
| Side-effect safety | Tool classification, duplicate count, and single-threaded first run  | Retrying an unknown write operation                         |
| Failure honesty    | Negative control remains failed and the campaign expectation matches | Counting an expected failure as an error in the harness     |
| Causality          | First critical event and minimized regression when available         | Keeping only a screenshot or prose summary                  |
| Integrity          | Campaign, config, run, fixture, and test hashes as applicable        | Mutable latest-version instructions                         |
| Containment        | Local/owned target, data boundary, credential boundary, cleanup      | Testing production or third-party systems without authority |

## Evidence levels

The level is a ceiling, not a score. A result uses the lowest level supported by all of its evidence.

| Level | Name                  | Required evidence                                                               |
| ----- | --------------------- | ------------------------------------------------------------------------------- |
| M0    | `DOCUMENTED_ONLY`     | A proposed mapping or campaign that was not executed                            |
| M1    | `CONFIG_VALIDATED`    | Pinned target and value-free dry-run/validation; no tool operation              |
| M2    | `EXECUTED_CONTROL`    | Authorized clean control with integrity-bound result                            |
| M3    | `FAULT_AND_RECOVERY`  | M2 plus a deterministic fault, bounded recovery assertion, and expected failure |
| M4    | `REGRESSION_VERIFIED` | M3 plus an integrity-bound generated causal regression executed successfully    |

Transport coverage is independent. A stdio M4 result does not imply Streamable HTTP compatibility.
See [evidence profiles](EVIDENCE_PROFILES.md) for target classifications and
[the compatibility matrix](COMPATIBILITY_AND_RECOVERY_MATRIX.md) for the current executed set.

## Result rules

- `complete` with every declared expectation matched is the only campaign status that can support a
  passing reliability result.
- `invalid`, `incomplete`, and `cancelled` are evidence about the test attempt, never a pass.
- An `observedOutcome: failed` can be a matched scenario when the declared outcome was `failed`; the
  underlying recovery metric remains false and MUST NOT be rewritten as successful recovery.
- Missing metrics remain `null` or `unavailable`. They MUST NOT be estimated.
- Scores are deterministic summaries of recorded checks, not probabilities, SLAs, or certification
  grades.

The portable contribution fields are defined in [RESULT_SCHEMA.md](RESULT_SCHEMA.md). ResiliReplay's
machine-readable `campaign-run.json` remains the source of truth.

## Change process

Substantive changes begin in a public GitHub Discussion and identify the new minimum evidence,
compatibility impact, migration path, and negative control. Changes land through reviewed pull
requests. Existing results keep the revision they declared; the profile does not retroactively
upgrade evidence.

Questions for the first RFC:

- Which failure boundaries should every MCP server test before release?
- When is a retry safe enough to count as recovery?
- Which fields make results portable across harnesses without exposing application data?
- Should tool annotations determine a default retry policy, or only inform review?

Apache-2.0 applies to this repository. Vendor and project names identify tested public artifacts and
do not imply endorsement.
