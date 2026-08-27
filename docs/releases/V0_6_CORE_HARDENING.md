# v0.6 core-hardening evidence record

Status: implementation and local verification complete on
`codex/hardening-v0.6-core-invariants`.

This record distinguishes observations made against the untouched starting commit from evidence
obtained after the hardening changes. It is a release-engineering record, not a security
certification or an MCP conformance claim.

## Baseline

- Starting commit: `54a96a9dd87ad034e7523be37221c0a30f5532ef` (`origin/main`, observed
  2026-08-27).
- Local platform: Windows 10 Pro 10.0.19045 x64, Node 24.19.0, pnpm 11.19.0.
- Repository-declared package manager: pnpm 10.14.0; that exact pnpm version was not locally
  available.
- `pnpm install --frozen-lockfile`: passed in 9,591 ms.
- `pnpm format:check`: failed on pre-existing formatting drift in `docs/site.js`.
- `pnpm lint`: passed in 31,572 ms.
- `pnpm typecheck`: passed in 56,637 ms.
- `pnpm build`: passed in 16,514 ms.
- `pnpm test`: 21 files and 143 tests passed in 59,390 ms (Vitest execution 37.48 s).
- `pnpm quality`: stopped at the same pre-existing `docs/site.js` formatting failure in 6,026 ms.
- `pnpm agent:gates`: passed in 4,384 ms; 20,000 events in 1,089 ms, 0 owned processes, and 0
  owned listeners.
- `pnpm release:gates`: passed in 5,956 ms; 20,000 events in 963 ms, demo in 3,331 ms, and 15
  packed files.

## Claim-to-evidence matrix

| Public claim                                     | Implementation                                                 | Test/evidence and gate                                                               | Confidence and counterexample                                                                                               | Baseline status       |
| ------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Deterministic replay and hashes                  | `core/stable.ts`, `core/events.ts`, `trace/jsonl.ts`           | `events.test.ts`, `trace.test.ts`, `pnpm test`                                       | Object ordering is tested only with ASCII keys; `localeCompare` makes non-ASCII ordering locale-sensitive.                  | `PARTIALLY_SUPPORTED` |
| Sanitized evidence                               | `core/sanitize.ts`; all event creation sanitizes               | `security.test.ts`, Inspector secret-output test, `secret:scan` in quality           | Recognized plain and explicitly labelled encodings are covered; unlabelled base64 of a recognized token survives.           | `PARTIALLY_SUPPORTED` |
| Executable regression generation                 | `trace/compiler.ts`                                            | `trace.test.ts`, framework runtime tests, package smoke                              | Generated tests execute, but a linked output directory escapes lexical containment and existing files are overwritten.      | `PARTIALLY_SUPPORTED` |
| Side-effect-free `adopt --dry-run`               | early return in `cli/adopt.ts` before execution/writes         | instrumented process, HTTP request, and directory assertions in `demo-adopt.test.ts` | Proven for the tested stdio and loopback HTTP paths; no OS-level sandbox is claimed.                                        | `SUPPORTED`           |
| Local-first and no telemetry                     | no telemetry client; local fixtures and loopback Studio        | `security.test.ts`, site/package/secret gates                                        | Remote MCP is available only after explicit authorization, so “local-only” would be too strong; “local-first” is supported. | `SUPPORTED`           |
| No credential persistence                        | value-free Inspector plans and pre-event sanitization          | `mcp-inspector.test.ts`, `security.test.ts`, `secret:scan`                           | Pattern redaction is explicitly limited; encoded-token counterexample confirmed.                                            | `PARTIALLY_SUPPORTED` |
| Cross-platform CLI                               | argument-array spawning and path classification                | CI matrix declares Ubuntu/Windows with Node 22/24                                    | Only Windows/Node 24 was executed locally in this pass; other cells are CI pending.                                         | `PARTIALLY_SUPPORTED` |
| Inspector interoperability                       | isolated read-only importer in `mcp-chaos/inspector-config.ts` | 13 Inspector integration tests; official Inspector 2.1.0 gate                        | Public plan still labels compatibility as only Inspector 2.0.0 and has no explicit source-profile version.                  | `PARTIALLY_SUPPORTED` |
| Genuine LangGraph/OpenAI Agents runtime support  | pinned adapter packages and manifests                          | pinned public-runtime suites                                                         | Runtime and fixture labels are separated mechanically in the registry; hosted provider behavior remains unverified.         | `SUPPORTED`           |
| Public server validation                         | versioned case-study artifacts and hashes                      | `field:verify`                                                                       | Release-scoped evidence only; no universal compatibility or adoption claim is justified.                                    | `SUPPORTED`           |
| Demo under 60 seconds / adopt under five minutes | bounded demo/adopt workflows                                   | demo release gate and `demo-adopt.test.ts`                                           | Local measurements satisfy the thresholds; they are not universal performance guarantees.                                   | `SUPPORTED`           |
| Fail-closed configuration                        | strict Inspector and campaign parsers                          | malformed/ambiguous/unknown-field tests                                              | Inspector JSON is read without a byte limit and the duplicate-key scanner has no explicit depth bound.                      | `PARTIALLY_SUPPORTED` |
| “MCP Reliability Standard”                       | project documentation only                                     | explicit non-endorsement wording                                                     | The unqualified heading can still be mistaken for an official MCP standard while official client-config work is active.     | `PARTIALLY_SUPPORTED` |

## Confirmed pre-fix findings

### RR-HARDEN-001 — linked output escapes the selected root

- Severity: `HIGH`; confidence: high.
- Invariant: generated and report artifacts remain under the selected output root.
- Reproduction: create a directory junction named `generated` below a temporary root that targets a
  second temporary directory, then call `compileRegression(failedTrace, generated)`. Untouched main
  writes `manifest.json`, `regression.test.mjs`, `replay.fixture.jsonl`, and `scenario.yaml` to the
  external directory while reporting the lexical linked path as its output.
- Negative control: the same call with an ordinary directory writes only below that directory.
- Root cause: `safeOutputPath` performs lexical containment only; writers create/follow directories
  without verifying real paths at the write boundary.
- Realistic impact: a repository-controlled link at a documented output location can redirect fixed
  artifact filenames outside the project and overwrite files accessible to the invoking user.

### RR-HARDEN-002 — encoded recognized credentials survive sanitization

- Severity: `HIGH`; confidence: high.
- Invariant: recognized credential material must not persist merely because it is encoded.
- Reproduction: base64-encode `sk-` followed by 24 ASCII characters and place the result in a
  non-sensitive field. Both `containsLikelySecret` and `sanitize` on untouched main preserve it.
- Negative control: the same token in plain text, URL-encoded `sk%2D` form, or `base64:`-labelled
  form is detected/redacted.
- Root cause: token patterns cover only plain and explicitly labelled base64 forms.
- Realistic impact: server/tool diagnostics containing a simply encoded recognized token can enter
  traces and every derived report.

### RR-HARDEN-003 — canonical ordering depends on the ambient locale

- Severity: `MEDIUM`; confidence: high.
- Invariant: stable identity must not depend on host locale or ICU collation behavior.
- Reproduction: compare the `localeCompare` ordering used by `stableStringify` with code-unit order
  for non-ASCII and case-distinct keys; the order differs. Locale-sensitive comparison also permits
  the host default locale to select a different collation.
- Negative control: ASCII `a`/`z` ordering happens to match the existing test.
- Root cause: canonicalization calls `String.prototype.localeCompare` without a fixed locale or
  options instead of using locale-independent code-unit ordering.
- Realistic impact: canonically equivalent evidence can acquire a different byte representation and
  SHA-256 identity across runtimes/locales.

### RR-HARDEN-004 — Inspector configuration parsing is not resource bounded

- Severity: `MEDIUM`; confidence: high.
- Invariant: malformed or oversized client configuration fails with a stable bounded diagnostic.
- Reproduction: `listInspectorServers` and `loadInspectorConfig` call `readFile(..., "utf8")`
  without checking `stat.size`; the recursive duplicate-key scanner has no depth budget.
- Negative control: ordinary one-server Inspector 2.0/2.1 layouts parse and retain argument
  boundaries.
- Root cause: strict field validation was implemented without byte, depth, collection, or string
  budgets at the external-format boundary.
- Realistic impact: a malicious or accidentally huge repository configuration can consume
  disproportionate memory/CPU or terminate with an unstable recursion error before failing closed.

## Selected tranche

The selected tranche hardens evidence-producing boundaries: realpath-aware output containment,
exclusive/complete regression bundles, encoded recognized-token redaction, locale-independent
canonical ordering, and bounded/versioned read-only Inspector profile parsing. These changes share
one invariant: external bytes and paths cannot silently alter, escape, or weaken stable evidence.

Lower-value adapter expansion, dependency upgrades, dashboard work, and unrelated cleanup are
excluded.

## Post-hardening resolution

| Baseline mismatch                                   | Resolution                                                                                                                                                                                               | Post-hardening evidence                                                                                                                                                                                                                                           | Status                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Locale-sensitive canonical keys                     | Replaced ambient collation with code-unit comparison in source and the bundled hook runtime.                                                                                                             | Non-ASCII/case-distinct order; 128 concurrent calls; two separate processes and working directories; changed-input negative control.                                                                                                                              | `SUPPORTED`                |
| Encoded credentials and unsafe persistence boundary | Added bounded standard/base64url and percent-decoding checks, sensitive-key detection, sanitized CLI errors, and value-free rejection in trace serialization.                                            | Plain, quoted, mixed-case, multiline, split-key, percent, base64, base64url, raw sensitive-key, ordinary-base64 negative control, and hash-valid hostile trace.                                                                                                   | `STRENGTHENED`             |
| Lexical-only output containment and overwrite       | Added Windows alias checks, real-path ancestor/target checks, pre-launch output validation, contained staging, exclusive hard-link publication, manifest-last completion, conflict refusal, and cleanup. | Traversal, absolute/drive-relative/device names, junction, dangling link, file/directory confusion, parent swap/revalidation, ordinary-directory negative control, 64 concurrent writers, manifest-stage conflict, and executable regression.                     | `STRENGTHENED`             |
| Unbounded implicit Inspector layout                 | Added read-only profile `mcp-inspector/mcp-json` version `1.0.0`, a reviewed Inspector range, strict UTF-8, byte/depth/collection/string budgets, and stable fail-closed diagnostics.                    | Inspector 2.1.0 discovery; malformed UTF-8, BOM, lone surrogate, 1 MiB overflow, 32-level overflow, 129 servers, 257 args, duplicate keys, unknown/conflicting fields, foreign paths, ambiguous selection, unauthorized remote target, and inert stdio arguments. | `SUPPORTED_WITHIN_PROFILE` |
| Unqualified “MCP Reliability Standard” terminology  | Kept existing links but changed the public name to “ResiliReplay MCP Reliability Evidence Profile” and made project ownership/non-certification explicit.                                                | README, profile document, demo copy/assets, and link/site checks.                                                                                                                                                                                                 | `DOWNGRADED_TO_EVIDENCE`   |
| Windows formatting gate drift                       | Added LF checkout rules for JavaScript and Python rather than relying on a locally rewritten working file.                                                                                               | `pnpm format:check` passes on the Windows checkout.                                                                                                                                                                                                               | `FIXED`                    |

## Post-hardening local measurements

Implementation commit tested: `470bbb599c2715ed7063943a7f47caee821d61dc` on Windows 10 x64,
Node 24.19.0, pnpm 11.19.0.

- `pnpm test`: 21 files and 155 tests passed in 39,994 ms; Vitest execution 25.69 s.
- `pnpm quality`: passed in 90,021 ms, including Inspector 2.1.0 discovery, three field
  evidence sets, the 15-file packed-package install/smoke, secret and hygiene scans, and agent
  lifecycle evidence.
- Redaction-heavy measurement: 20,000 base64url credential candidates in 94.17 ms, zero retained,
  with 7,913,472 bytes RSS delta.
- Concurrent canonicalization measurement: 1,024 calls in 3.48 ms with the expected two distinct
  outputs for two distinct semantic inputs.
- Agent lifecycle measurement inside the final quality run: 20,000 events in 704 ms, 13,414,112
  artifact bytes, 98,668,544 bytes measured RSS delta, and zero owned processes/listeners.
- Limits exercised: Inspector input 1 MiB, trace input 32 MiB/100,000 events, Studio request body
  65,536 bytes, proxy body 4 MiB, and OTLP/hook input 1 MiB.

## Verification limitations

- Ubuntu, Node 22, and Windows Node 22 are not locally available and remain `CI PENDING`.
- No live hosted provider, production credential, non-loopback server, or writable Inspector catalog
  is used.
- Node.js path checks reduce link and replacement risk but do not constitute an OS sandbox or an
  `openat(2)`-style race-free capability system.
