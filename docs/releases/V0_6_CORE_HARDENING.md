# v0.6 core-hardening evidence record

Status: local verification complete; GitHub CI pending on
`codex/hardening-v0.6-core-invariants`.

This is a release-engineering record, not a security certification, an MCP conformance claim, or
evidence that unexecuted CI cells passed. It separates observations against the untouched starting
commit from observations against the hardened branch.

## Reproducible baseline

- Starting commit: `54a96a9dd87ad034e7523be37221c0a30f5532ef`.
- Baseline audit environment: Windows 10 Pro 10.0.19045 x64, Node 24.19.0, pnpm 10.14.0.
- `pnpm install --frozen-lockfile`: passed in 9.3 seconds with 348 packages.
- `pnpm build`: passed.
- The baseline was checked in a detached clean worktree. No hardened module was imported by a
  baseline reproduction.

| Finding                               | Untouched-base reproduction                                                                                                                    | Negative control                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Junction output escape                | A `generated` junction below the selected root redirected all four regression files to a second temporary directory. The call succeeded.       | An ordinary directory received the same four files below the selected root.  |
| Encoded credential persistence        | An unlabelled base64 encoding of a recognized `sk-` token returned `false` from `containsLikelySecret`.                                        | Base64 for ordinary diagnostic text also returned `false`.                   |
| Locale-sensitive canonicalization     | Keys with code points `[233,122,65,97]` serialized in locale order `[97,65,233,122]`, not code-unit order `[65,97,122,233]`.                   | The previous ASCII-only `a`/`z` control passed.                              |
| Unbounded Inspector input             | A valid 1,048,694-byte configuration with a 1,048,640-character argument was accepted. Its plan had no source-profile identity.                | An ordinary one-server configuration was accepted.                           |
| Existing-output overwrite             | A pre-existing mismatched `scenario.yaml` was silently replaced and the call succeeded.                                                        | Generation into an empty directory succeeded.                                |
| Partial regression bundle             | Making `manifest.json` a directory caused `EISDIR`, but `scenario.yaml`, `replay.fixture.jsonl`, and `regression.test.mjs` remained beside it. | A complete ordinary bundle contained all four coherent files.                |
| Unversioned Inspector source behavior | The imported execution plan contained no `sourceProfile`.                                                                                      | Argument boundaries were otherwise preserved for the ordinary configuration. |
| Ambiguous reliability terminology     | README used the unqualified heading “The MCP Reliability Standard.”                                                                            | Nearby text denied official MCP status, but the heading remained ambiguous.  |

## Confirmed findings and resolutions

### RR-HARDEN-001 — linked output can escape the selected root

- Severity: `HIGH`.
- Fix: real-path ancestor/target validation, linked-target rejection, Windows alias checks, and
  revalidation at output preparation.
- Hardened result: `RR_OUTPUT_CONTAINMENT`; zero files appeared outside the selected root.
- Tests: traversal, absolute and drive-relative paths, device names, junction/symlink, dangling
  link, file/directory confusion, parent replacement, and ordinary-directory control.
- Residual risk: Node path validation is not an `openat(2)`-style capability and cannot eliminate
  every hostile filesystem time-of-check/time-of-use race.

### RR-HARDEN-002 — recognized encoded credentials can persist

- Severity: `HIGH`.
- Fix: bounded base64/base64url and percent-decoding recognition, sensitive-key rejection,
  pre-persistence trace rejection, and sanitized uncaught CLI diagnostics.
- Hardened result: the recognized encoded token is detected; ordinary base64 remains usable.
- Tests: plain, quoted, mixed-case, multiline, percent, base64, base64url, split sensitive keys,
  hostile hash-valid traces, and benign controls.
- Residual risk: pattern-based secret recognition cannot identify every possible credential.

### RR-HARDEN-003 — canonical identity depends on ambient collation

- Severity: `MEDIUM`.
- Fix: locale-independent UTF-16 code-unit key ordering in core and the bundled hook runtime.
- Hardened result: the reproduction serializes in code-point sequence `[65,97,122,233]`.
- Tests: non-ASCII and case-distinct keys, 128 concurrent calls, separate processes and working
  directories, and a changed-input negative control.
- Residual risk: this preserves ResiliReplay's version-1 algorithm; it is not RFC 8785 JCS.

### RR-HARDEN-004 — Inspector configuration parsing is resource-unbounded

- Severity: `MEDIUM`.
- Fix: strict UTF-8 plus byte, nesting, server, argument, collection, and string budgets with stable
  `RR_MCP_CONFIG_*` diagnostics.
- Hardened result: the oversized reproduction fails with `RR_MCP_CONFIG_TOO_LARGE`; an ordinary
  configuration still loads.
- Tests: 1 MiB overflow, 32-level overflow, malformed UTF-8, BOM, lone surrogate, duplicate keys,
  129 servers, 257 arguments, unknown/conflicting fields, ambiguous selection, and inert arguments.
- Residual risk: the profile deliberately covers a bounded reviewed subset of Inspector JSON.

### RR-HARDEN-005 — no portable exclusive-publication fallback

- Severity: `MEDIUM`.
- Fix: use hard-link publication first, then `COPYFILE_EXCL` only for known unsupported-link errors;
  verify source/destination size and SHA-256 before continuing.
- Tests: unsupported hard link, successful exclusive copy, conflict, partial-copy failure,
  manifest-stage failure, cleanup failure, 64 concurrent fallback writers, identical existing
  bundle, and mismatched existing bundle.
- Residual risk: filesystems without either safe primitive fail closed; remote filesystems may have
  weaker semantics than their APIs advertise.

### RR-HARDEN-006 — baseline publication can overwrite or leave a partial bundle

- Severity: `HIGH`.
- Fix: contained staging, exclusive publication, manifest last, identical-content idempotence,
  conflict refusal, and removal limited to artifacts created by the failed transaction.
- Hardened result: a mismatched scenario remains byte-for-byte unchanged; manifest failure leaves no
  newly created artifact, and cleanup failure cannot create a completion manifest.
- Tests: direct old/new reproductions plus dependency-injected publication and cleanup failures.
- Residual risk: a cleanup failure can leave explicitly incomplete files; absence of a valid
  completion manifest prevents acceptance as a complete bundle.

### RR-HARDEN-007 — source compatibility has no versioned identity

- Severity: `MEDIUM`.
- Fix: read-only profile `mcp-inspector/mcp-json` version `1.0.0`, reviewed Inspector range
  `>=2.0.0 <2.2.0`, and profile identity in every imported plan.
- Hardened result: Inspector 2.1.0 discovery passes and ordinary imported plans carry the profile.
- Residual risk: future official MCP client-configuration work may require a new, separately
  versioned profile.

### RR-HARDEN-008 — project-defined behavior can be mistaken for an official standard

- Severity: `MEDIUM`.
- Fix: public name changed to “ResiliReplay MCP Reliability Evidence Profile” with explicit project
  ownership, non-certification, and non-endorsement language.
- Hardened result: the prior unqualified README heading is absent.
- Residual risk: old links and asset filenames remain for compatibility and historical continuity.

## Additional boundary finding

The 32 MiB trace test exposed regex-engine stack exhaustion while scanning one oversized benign
base64-like string. The encoded-candidate detector now uses a linear scanner that ignores candidates
above 4,096 characters before decoding. A 1 MiB benign-run regression test and the full 32 MiB gate
both pass.

## Trace-boundary evidence

Generated dynamically by `pnpm test:trace-boundaries`; no large fixture is committed.

| Case                           | Result                                        |              Wall time | Observed RSS delta |                 Output/input size |
| ------------------------------ | --------------------------------------------- | ---------------------: | -----------------: | --------------------------------: |
| Valid byte limit minus one     | `PASS`                                        |              301.84 ms |  100,634,624 bytes |                  33,554,431 bytes |
| Valid byte limit               | `PASS`                                        |              322.83 ms |      356,352 bytes |                  33,554,432 bytes |
| One byte over                  | `EXPECTED_FAILURE` / `RR_TRACE_BYTE_LIMIT`    |      bounded pre-parse |       not material |                  33,554,433 bytes |
| Valid nesting limit            | `PASS`                                        |                0.31 ms |        4,096 bytes |                          depth 64 |
| One nesting level over         | `EXPECTED_FAILURE` / `RR_TRACE_NESTING_LIMIT` | bounded pre-validation |       not material |                          depth 65 |
| Redaction-heavy near limit     | `PASS`; 2,048 fields; zero canaries           |              322.13 ms |  100,868,096 bytes |                  33,553,408 bytes |
| Duplicate-event flood at limit | `PASS`                                        |            2,064.18 ms |  136,716,288 bytes | 100,000 events / 32,477,776 bytes |
| One event over                 | `EXPECTED_FAILURE` / `RR_TRACE_EVENT_LIMIT`   | bounded pre-validation |       not material |                    100,001 events |

RSS deltas are process snapshots around each synchronous case, not isolated peak measurements. The
release gate separately measured a 20,000-event peak RSS of 248.6 MiB.

## Exact local verification

Environment: Windows 10 x64, Node 24.19.0, pnpm 10.14.0 invoked through Corepack 0.34.0 because the
bundled Node runtime has no standalone `corepack` executable.

- Frozen install: 348 packages, 60.9 seconds, pnpm 10.14.0.
- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `pnpm build`: passed.
- `pnpm test`: 21 files and 162 tests passed; Vitest duration 24.70 seconds.
- `pnpm package:smoke`: passed using pnpm 10.14.0 for the packed-package install.
- `pnpm quality`: passed in 113,843 ms.
- `pnpm test:trace-boundaries`: passed in 22,787 ms.
- `pnpm agent:gates`: passed in 4,065 ms; 20,000 events in 588 ms, 13,414,112 artifact bytes,
  98,488,320 measured RSS delta, zero owned processes, and zero owned listeners.
- `pnpm test:e2e`: one Playwright test passed in 21,910 ms including build.
- `pnpm site:test`: desktop/mobile responsive and WCAG A/AA checks passed in 4,817 ms.
- `pnpm release:gates`: passed in 6,943 ms; 20,000 events in 1,427 ms, 248.6 MiB peak RSS,
  3,331 ms demo, and 15 packed files.
- `pnpm secret:scan`: passed.
- `pnpm hygiene:scan`: passed.

## GitHub CI matrix

`.github/workflows/ci.yml` defines Ubuntu and Windows cells for Node 22 and Node 24 with pnpm
10.14.0. Every cell performs frozen install, format, lint, typecheck, build, all tests, package smoke,
and focused hardening controls. Both Node 24 cells additionally run the full trace, quality, agent,
browser, site, release, secret, and hygiene gates and upload bounded evidence artifacts.

All GitHub cells remain `CI PENDING` until the branch is pushed and the actual Actions runs pass.

## Verification limitations

- Ubuntu and Node 22 are not locally available; GitHub Actions is the evidence source for those
  cells.
- No live hosted provider, production credential, non-loopback server, or writable Inspector catalog
  is used.
- Cross-volume fallback is dependency-injected locally; GitHub-hosted filesystems provide the real
  Ubuntu/Windows execution evidence.
- No npm package was published and no package version was changed.
