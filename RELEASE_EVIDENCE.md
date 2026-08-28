# v0.3.0 release evidence

Evidence date: 2026-08-04

Release title: **ResiliReplay Studio & Campaigns**

Local verification: Windows, Node.js 24.14.0, pnpm 11.9.0

Supported CI matrix: Ubuntu and Windows; Node.js 22 and 24

## Baseline and frozen scope

- Baseline branch: clean `main` at `52bfcfc441d5044899ff44b335a3564df5dc2533` before
  implementation.
- Previous immutable release: annotated `v0.2.1` tag object
  `489266a5fa0963a9b5b1323a74b65e9e61b78fc2`, resolving to commit
  `b5ea7bdb785bff955d8c6f5e4881aa89654d7085`; the public npm package was 0.2.1.
- Baseline suite: 9 files and 48 tests passed before implementation.
- Scope: exactly four release epics in [`V0_3_SCOPE.md`](V0_3_SCOPE.md): Studio, campaigns,
  baselines/CI gates, and evidence-backed onboarding.
- Product claim: “MCP Inspector shows what a server does. ResiliReplay proves what happens when it
  fails, whether it recovers safely, and whether that recovery remains fixed.”

## Implemented vertical slice

- Loopback-only nine-screen Studio over the same campaign/MCP/trace/report/regression APIs as the CLI.
- Strict campaign schema and stable runner with seeds, bounded concurrency/retries/time, cancellation,
  expectations, allowlisted tools, stdio, Streamable HTTP, and generated causal regressions.
- Integrity-checked approved baselines and fail-closed comparison evidence in terminal, JSON, HTML,
  Markdown, JUnit, SARIF, and GitHub step summary.
- Verified local fixture workflow, real Studio PNG/GIF/transcript, browser acceptance/accessibility,
  adversarial fuzzing, and lifecycle/stress measurement.

## Local release gates

| Gate               | Result                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| Format             | Prettier repository check passed                                                                      |
| Lint               | ESLint passed with zero findings                                                                      |
| Strict types/build | All 15 non-root workspace projects and test/config types passed                                       |
| Functional tests   | 12 Vitest files; 57 tests passed; zero failures or skips                                              |
| Coverage           | 76.54% statements/lines; 72.43% branches; 88.8% functions before the final CLI workflow test          |
| Browser acceptance | 1 Playwright test passed; full Studio flow, keyboard use, axe WCAG A/AA serious/critical findings = 0 |
| Package smoke      | Clean tarball installation passed; CLI reported 0.3.0 and contained exactly five expected files       |
| Supply chain       | Frozen lockfile policy passed; npm package has no runtime dependency on internal workspaces           |
| Security/privacy   | Secret scan and hygiene scan included in aggregate gate                                               |

The aggregate `pnpm quality` command passed after the campaign CLI and cancellation tests were added.

## Real workflow evidence

`pnpm demo:studio` passed with four stdio scenarios plus two authenticated Streamable HTTP scenarios.
The stdio campaign included resilient and deliberately vulnerable negative controls, a recovered
tool-error fault, an unsafe-content expected failure, two generated and executed regressions, baseline
approval, and a passing zero-difference comparison. No external provider was used.

Measured transcript result:

```text
workflow=PASS wall=2412ms under-60s=true
telemetry=false api-keys=false external-provider=false fixture-backed=true
```

The committed static Studio screenshot is 59,219 bytes; the six-frame GIF is 441,459 bytes; the
sanitized transcript is 1,716 bytes.

## Performance and stress

Machine-readable evidence: `.artifacts/release-gates/report.json` (local, ignored).

| Measurement                      |                                                  Result |
| -------------------------------- | ------------------------------------------------------: |
| Studio start/stop cycles         |                                                     100 |
| Orphan listeners after cycles    |                                                       0 |
| Average / maximum Studio startup |                                            1 ms / 14 ms |
| Large trace                      |                          20,000 events; 7,075,709 bytes |
| Large-trace round trip           |                                                  954 ms |
| Peak process RSS                 |                                245.4 MiB (512 MiB gate) |
| Verified quick-start wall time   |                              2,412 ms (<60,000 ms gate) |
| CLI tarball                      | 273,778 bytes packed; 1,356,546 bytes unpacked; 5 files |

The campaign measurement includes four real MCP subprocess audits, artifact/report persistence, and
generated-test execution, so it is not compared as equivalent to a direct single-trace read. This is
the explicit justification for exceeding a raw 20% wrapper-overhead comparison; the measured user
workflow remains far under the 60-second gate.

## Security/adversarial evidence

- Exact Host, Origin, session, CSRF, JSON content type, 64 KiB body, traversal, session-not-in-URL,
  one-time confirmation, and allowlisted download cases are automated.
- Inspector tests cover command/argument separation, Windows/POSIX path classification, header
  injection, URL credentials, auth bypass, remote authorization, config duplicate/unknown fields,
  symlink escape, timeouts, malformed protocols, secret output, and cleanup.
- Campaign tests include 500 hostile/fuzz inputs, YAML alias rejection, stable concurrent ordering,
  repeatability, tampered/incomplete evidence, unavailable adapter metrics, stdio, and authenticated
  Streamable HTTP.
- Trace input is capped at 100,000 events and 32 MiB. Studio sessions expire after 15 minutes or
  immediately on shutdown.

## Release/publication policy

The feature branch is merged only after all required PR checks pass. The annotated `v0.3.0` tag is
created from the verified merge commit, GitHub Release assets are published, and npm Trusted
Publishing must complete before a clean credential-disabled install/CLI/demo verification. Public
run, release, tag, and package URLs are recorded in the final release-leader report.

## Honest limitations

Commands are not OS-sandboxed; allowlisted MCP tools can have side effects; Studio is local rather
than hosted; remote campaigns are CLI-only; Inspector interactive OAuth/explicit modern protocol era
are unsupported; incremental streaming is not yet versioned; redaction is pattern-based; hashes are
unsigned; and internal workspace packages are not separate public APIs. See
[`docs/LIMITATIONS.md`](docs/LIMITATIONS.md).
