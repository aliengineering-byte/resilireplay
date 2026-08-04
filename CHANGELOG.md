# Changelog

All notable changes follow Keep a Changelog principles. The project uses semantic versioning.

## [0.3.0] - 2026-08-04

### Added

- Loopback-only ResiliReplay Studio with target review, campaign builder, cancellable live runs,
  causal timeline, findings, baseline comparison, generated regressions, and evidence downloads.
- Strict versioned YAML/JSON campaign schema, stable ordered runner, bounded concurrency/retries/time,
  explicit expectations, safe tool allowlists, and real stdio plus Streamable HTTP coverage.
- Versioned approved baselines and fail-closed comparisons with terminal, JSON, HTML, Markdown, JUnit,
  SARIF, and GitHub step-summary reports.
- Verified no-key Studio demo, real PNG/GIF/transcript, browser acceptance and WCAG A/AA checks,
  hostile-input fuzzing, 100-cycle listener cleanup, and a 20,000-event stress gate.

### Changed

- The self-contained CLI now includes `studio` and `campaign init|validate|run|approve|compare`.
- MCP recovery honors retry budgets from 0 through 10 and campaigns require an exact reviewed hash
  before invoking explicitly allowlisted tools.
- All workspace package versions and generated report version labels are aligned at 0.3.0.

### Security

- Studio enforces exact loopback Host/Origin, ephemeral HttpOnly SameSite sessions, CSRF tokens,
  JSON/content-size limits, contained real paths, allowlisted downloads, CSP, and graceful cleanup.
- Campaign input rejects aliases, unknown fields, absolute/traversing paths, symlink escapes, unsafe
  remote targets, and unverifiable or incomplete baseline evidence.
- Repeated object references are sanitized faithfully while actual cycles remain safely marked.

## [0.2.1] - 2026-08-03

### Fixed

- Publish the supported `resilireplay` CLI as one self-contained npm package instead of exposing
  unresolved monorepo `workspace:*` runtime dependencies.
- Limit the npm tarball to the executable bundle, package documentation, manifest, and Apache-2.0
  license, with repository, homepage, bugs, engine, and public-access metadata.
- Verify an npm-packed tarball in a clean project and exercise its version, help, and fault-catalog
  commands without installing internal workspace packages.

### Changed

- Support maintained Node.js 22 and 24 releases in the package metadata and cross-platform CI.

## [0.2.0] - 2026-08-02

### Added

- Read-only, typed import of reviewed MCP Inspector 2.0.0 `mcp.json` files with single-entry
  auto-selection, named multi-server selection, stdio, Streamable HTTP, and legacy SSE support.
- Value-free `--dry-run` execution plans, stable MCP exit codes, strict path/URL/header/environment
  validation, and narrow `${env:NAME}` references.
- Authenticated real Streamable HTTP resilient, controlled-failure, and malformed-response coverage.
- Recovery-aware MCP fault evaluation, persisted audit traces, and an Inspector-config-to-executed-
  regression demo with source/config/scenario/fixture/test hashes.

### Security

- Duplicate JSON keys, transport conflicts, path/symlink escapes, URL credentials, header injection,
  Inspector authentication bypass settings, and proxy session-token declarations fail closed.
- Imported environment/header values never enter artifacts; credential-shaped and encoded server
  output is redacted before persistence and receives a dedicated safety exit code.

## [0.1.0] - 2026-07-30

### Added

- Strict versioned event model and deterministic JSONL traces.
- Seed-controlled provider, tool, workflow, and MCP fault engine.
- Deterministic recovery and safety scoring.
- Failed-trace causal minimization and executable regression generation.
- Terminal, JSON, standalone HTML, JUnit, SARIF, manifests, and badges.
- stdio and Streamable HTTP MCP auditing through the official SDK.
- No-key deterministic agent and MCP demos.
- Cross-platform CLI, GitHub Action, CI, security boundaries, and 34 automated tests.
