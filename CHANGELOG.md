# Changelog

All notable changes follow Keep a Changelog principles. The project uses semantic versioning.

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
