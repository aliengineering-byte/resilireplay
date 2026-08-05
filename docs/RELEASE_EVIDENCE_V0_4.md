# v0.4.0 release evidence

Evidence date: 2026-08-05

Release title: **ResiliReplay v0.4.0 - Adopt**

This record is completed from automated local/CI evidence and public artifact verification. Values
that depend on the final merge, tag, npm publication, and external Action run are filled only after
those events succeed; documentation does not substitute for those gates.

## Verified starting state

- Starting `main`: `03ec2fc25fa9fcc7cea8a98e8cab285ce76107aa`, clean and synchronized with
  `origin/main`.
- Previous release: public annotated `v0.3.1`; public npm `resilireplay@0.3.1`; Marketplace Action
  listing returned HTTP 200.
- Unchanged baseline: `pnpm quality` passed 13 test files / 60 tests; Playwright E2E passed 1 test.
- v0.3.0 and v0.3.1 evidence remains historical and immutable.

## Bounded product hypothesis

The dated amendment in [V0_4_ADMISSION.md](V0_4_ADMISSION.md) authorizes one experiment: setup
friction and unclear time-to-value may be the primary adoption blocker. The product surfaces are
limited to `demo`, `adopt`, reviewed argument fixtures, metadata-only evidence, and the generated CI
path. No hosted service, account, telemetry, billing, or autonomous unreviewed tool execution was
added.

## Candidate evidence

- Empty-directory demo: clean control, deterministic tool-result failure, one bounded recovery,
  expected negative control, generated regression, and successful regression execution.
- Adoption: real local stdio and authenticated loopback Streamable HTTP fixtures; generated campaign
  and regression both execute; 14 commit-ready artifacts.
- Safety: process and HTTP dry-run side effects measured at zero; `--yes` cannot cross the tool-call
  boundary; credential-shaped and encoded canaries, outside paths, and escaping config/output links
  fail closed; persisted evidence contains no raw tool body or authorization value.
- Compatibility: v0.3.x campaign evidence versions remain accepted and optional new campaign fields
  do not alter old defaults.

## Final local candidate gates

Verification host: Windows, Node.js 24.14.0. Supported CI matrix: Ubuntu and Windows on Node.js 22
and 24.

| Gate              | Result                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Aggregate quality | Format, lint, strict build/types, 14 test files / 75 tests, three historical field manifests, site contract, package smoke, secret scan, and hygiene scan passed.                                                        |
| Coverage          | 75.16% statements/lines; 69.20% branches; 85.79% functions.                                                                                                                                                              |
| Browser           | Desktop/mobile Pages responsive and WCAG A/AA serious/critical checks passed; 1 complete Studio Playwright E2E passed.                                                                                                   |
| Packed demo       | 262 ms CLI / 490 ms capture wall; stable canonical evidence `8d96b2198e8cb038b7386bdd7ceebe7a02ec4e3904c375828631f2be3a17d08f`; empty project after execution.                                                           |
| Packed adoption   | 804 ms in the final aggregate run; 14 artifacts; generated regression and generated four-scenario campaign passed; campaign `a404054db2573aff505c354851aa4b37a5ddf18e7023172f74dcd347623b9cbd`.                          |
| Dry-run/privacy   | Process starts, network requests, tool calls, and project writes measured at zero; private fixture bodies, credential canaries, headers, environment values, outside/home paths, and symlink escapes absent or rejected. |
| Lifecycle/stress  | 100 Studio cycles; 0 orphan listeners; 3 ms average / 40 ms maximum startup; 20,000 events / 7,075,709 bytes round-tripped in 2,122 ms at 245.4 MiB RSS.                                                                 |
| Existing workflow | Studio/fixture workflow passed in 3,331 ms; legacy trace and Inspector demos passed.                                                                                                                                     |
| Package           | Exactly 5 public files; 284,170 bytes packed; 1,403,895 bytes unpacked. The local npm-pack archive hash is not treated as public registry integrity; final npm SHA-512 integrity is recorded only after download.        |
| Media             | Genuine packed CLI transcript plus 94,881-byte GIF and 53,047-byte static PNG; site reference and privacy checks passed.                                                                                                 |

## Final release measurements

The final commit, annotated tag object, CI URLs, npm integrity/provenance, credential-disabled public
package smoke, Pages/Marketplace verification, external Action matrix, and historical-artifact
integrity checks are recorded here after the corresponding public release gates. No public success is
claimed by this local candidate record.
