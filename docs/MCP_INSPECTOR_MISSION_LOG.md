# MCP Inspector integration mission log

This file is append-only evidence for the MCP Inspector compatibility mission. Times are UTC.
Workstation-specific paths, credentials, and private provider configuration are intentionally
excluded.

## 2026-08-02 - baseline freeze

- Repository state: clean `main`, commit `053f2dfac4c515f04377c9756ab2934e0c3c3347`, aligned with
  `origin/main` before implementation.
- Tracked repository inventory: 96 files across CLI, core, MCP, proxy, reporter, trace, examples,
  scenarios, tests, scripts, documentation, and GitHub workflow areas. No repository `AGENTS.md`
  instructions were present.
- Published tag: `v0.1.0`, annotated tag object
  `724ee89ccc1c34d34242d35b01852c1f7cd22f57`, resolving to
  `0d78460c80176a04809b3f947e355fdc4753539f`. Remote tag verification matched the local refs.
- Release decision: the latest public release is `v0.1.0`, so this mission targets `v0.2.0`.
- Package state: lockfile package manager `pnpm@10.14.0`; installed runner `pnpm 11.9.0`;
  bundled Node.js `v24.14.0`; MCP SDK `1.30.0`; TypeScript `5.8.3`; Vitest `3.2.4`.
- Focused baseline: `pnpm exec vitest run tests/mcp.test.ts tests/security.test.ts
tests/cli.test.ts` passed 12/12 tests across 3/3 files. Measured wall time: 17.305 seconds.
- Complete baseline: `pnpm quality` passed formatting, lint, strict type checking, 34/34 tests
  across 8/8 files, package/build and packed-install smoke, secret scan, and hygiene scan. Measured
  wall time: 116.862 seconds. Vitest reported 3.24 seconds for the complete test run. Peak memory
  was not available from the existing instrumentation.
- Baseline transport behavior: real stdio tests passed against both resilient and deliberately
  vulnerable local MCP fixtures. Streamable HTTP validated the non-loopback authorization gate,
  but had no real successful or controlled-failure server coverage; closing that gap is required.
- Baseline safety model reviewed: subprocesses execute without a shell; output containment,
  recursive redaction, token-shape redaction, bounded MCP deadlines, loopback defaults, and the
  explicit remote authorization gate were present.
- Environment note: the first focused command could not start because the initial shell `PATH`
  lacked Node.js. It was not counted as a test run. The command was rerun with the bundled runtime
  and passed as recorded above.

## 2026-08-02 - official upstream audit

- MCP Inspector stable release reviewed: `2.0.0`, tag/commit
  `7aebf168e6277ea26b1f04a7987a1cd11328ec83`. The npm `latest` dist-tag resolved to `2.0.0`.
  Inspector `main` was also observed at `fb1b0cb41c7b19e08334025ce118d48af1394967`; compatibility
  is intentionally frozen to the stable tag rather than unreleased `main` behavior.
- MCP specification reviewed: protocol revision `2026-07-28`, whose standard bindings are stdio and
  Streamable HTTP. Legacy HTTP+SSE remains relevant only for backwards compatibility.
- Inspector v2 file shape: a complete file has a top-level `mcpServers` object keyed by server name.
  A single server entry is the corresponding object value. Missing `type` means stdio; explicit
  `stdio`, `http`, `streamable-http`, and deprecated `sse` forms are recognized by Inspector.
- Stdio execution fields reviewed: `command`, boundary-preserving string-array `args`, string-map
  `env`, and optional `cwd`.
- HTTP execution fields reviewed: `url` plus object-form `headers`. Inspector-specific
  `connectionTimeout` and `requestTimeout` are millisecond values.
- Selection behavior reviewed: exactly one file entry is auto-selected in Inspector CLI mode;
  multiple entries require `--server <name>`. ResiliReplay will use the same unambiguous rule.
- Inspector CLI source reviewed: `mcp-inspector --cli --config <path> --server <name>` consumes a
  read-only session file. Inspector v2 also has a writable `--catalog` workflow; ResiliReplay only
  reads files and never seeds, migrates, or writes the imported configuration.
- Security posture reviewed: Inspector authentication remains enabled by default. ResiliReplay will
  reject `DANGEROUSLY_OMIT_AUTH` and Inspector proxy session-token declarations, will preserve its
  non-loopback authorization gate, and will never serialize imported environment/header values.
- Compatibility language is limited to: "Compatible with reviewed MCP Inspector mcp.json exports."
  No partnership, endorsement, certification, or upstream ownership is claimed.

## 2026-08-02 - implementation and local release gate

- Added a strict read-only Inspector configuration importer and `mcp audit --inspector-config`,
  `--server`, and `--dry-run`. Complete files require top-level `mcpServers`; one entry auto-selects,
  while multiple entries require a name. Stdio, Streamable HTTP, and deprecated SSE are typed.
- Direct stdio execution preserves argument boundaries and uses no shell. Relative paths, working
  directories, realpaths, and links are constrained to the repository root. Remote HTTP keeps the
  explicit authorization gate.
- Execution plans include names, transport, timeouts, reference/literal provenance, and config hash,
  but every imported environment/header value is `[REDACTED]`. Authentication bypass, proxy session
  tokens, URL credentials, header injection, duplicate keys, ambiguous fields, and unsafe paths fail
  closed with stable identifiers.
- Added real authenticated Streamable HTTP resilient and controlled-failure coverage on ephemeral
  loopback listeners, plus malformed HTTP, startup, malformed stdio, timeout, spaces-in-path,
  Windows/POSIX classification, secret-output, and process/listener cleanup fixtures.
- MCP findings now participate in deterministic recovery scoring. A bounded retry can recover a
  retryable tool fault; unsafe or unrecovered faults remain failed. Certifications persist trace
  evidence, and causal regressions execute before success is reported.
- Expanded redaction for credential-shaped keys, URL-encoded tokens, Basic/base64 credentials, and
  adversarial MCP output. Secret-shaped output is detected before artifacts are written and maps to
  exit code 13.
- The first aggregate release attempt stopped at lint on three control-character regex rules and two
  test cleanup findings. Those static issues were corrected; no functional test failed in that
  attempt.
- Final `pnpm quality`: PASS in 69.8 seconds. Formatting, lint, strict types, all 13 non-root builds,
  48/48 tests across 9/9 files, five-package clean installation at v0.2.0, secret scan, and hygiene
  scan passed. Focused Inspector/MCP/security coverage passed 23/23 tests.
- Release-facing rerun: 3/3 repository scenarios passed or validated; the no-key demo passed; the
  Inspector demo passed real stdio, authenticated Streamable HTTP, bounded recovery, expected
  failure, regression execution, and five-hash manifest checks.
- Generated and visually reviewed a 1000×630 Inspector GIF plus a 1000×630 static PNG fallback from
  verified, path-free output. `RELEASE_EVIDENCE.md` records exact current manifest hashes and asset
  byte sizes.
- Peak memory was not available from existing repository instrumentation. No unsupported numerical
  claim is made.
