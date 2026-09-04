# Changelog

All notable changes follow Keep a Changelog principles. The project uses semantic versioning.

## [0.7.1] - 2026-09-02

### Added

- Official MCP Registry metadata for the existing safe stdio server, including npm ownership metadata.
- Agent-discoverable, attributed evidence verification with project-root containment and bounded results.
- `campaign verify` and `mcp verify-evidence` fail-closed commands for portable campaign and deterministic MCP demo receipts.

### Changed

- MCP tool results now carry machine-readable repository, version, capability, evidence, reproduction, and documentation attribution.
- The public npm smoke publishes Registry metadata only after the exact provenance-backed package is installable.

## [0.7.0] - 2026-08-28

### Added

- MCP-first `mcp demo`, `mcp test`, and `mcp validate` workflows with stable JSON evidence,
  reviewed plan digests, bounded retries, duplicate-effect counts, and generated regressions.
- Standalone packed-package CI against the pinned official MCP Everything server, including clean
  installation, real stdio discovery/call, deterministic failure, cleanup, and privacy checks.
- Packed-package terminal transcript, accessible static image, and animated product demo.

### Changed

- README, website, CLI help, npm metadata, and repository positioning now lead with MCP reliability.
- MCP evidence persistence removes tool arguments and result bodies before reports are written.
- Dependabot runs monthly with one grouped patch/minor PR per ecosystem.
- npm release publishing verifies an annotated tag and exact tarball before OIDC trusted publishing.

### Compatibility

- `mcp audit`, campaigns, replay, reports, Studio, agent capture, adapters, and the hidden root
  `demo` alias remain available. MCP-RES v0.1 and v0.2 normative trees are unchanged.

### Security

- Persistent demo output is contained, idempotent for byte-identical bundles, conflict-safe for
  mismatches, and completion-manifest-last.
- Real MCP execution requires one explicit tool, a safety classification, finite bounds, and the
  exact SHA-256 of the reviewed dry-run plan.
- Current registry advisories are resolved with patch-only Vitest, YAML, and transitive dependency
  updates; the published CLI API and supported runtime range are unchanged.

## [0.6.0] - 2026-08-07

### Added

- Versioned framework event contract, neutral OTLP/JSONL bridge, public adapter registry, and
  deterministic framework campaign templates.
- Genuine local runtime adapters for LangGraph 1.4.9 and OpenAI Agents SDK 0.14.3.
- AutoGen OTLP bridge profile plus documented-only CrewAI and LlamaIndex callback mappings.
- Explicit framework detection/override/doctor CLI commands and a no-key framework-layer demo.
- Optional semantic advisor plugin boundary that is disabled by default and cannot override
  deterministic policy.

### Changed

- Product, package, CLI, Studio, campaign, report, and schema artifact release identity is 0.6.0.
- Framework support claims now carry explicit runtime, fixture, documented, or unsupported evidence.

## [0.5.0] - 2026-08-05

### Added

- One bounded, sanitized agent-event core with versioned capture-session, failure-evidence, and
  adapter-manifest schemas.
- Opt-in passive capture, evidence inspection, regression generation, safe repository-local agent
  connection with dry-run/backup/rollback, and adapter init/verification commands.
- A nine-tool annotated stdio MCP server and a validated portable Agent Skill shipped inside the
  npm package.
- Installable Claude Code and Codex plugins backed by one shared hook runtime, plus documented and
  isolated Hermes Agent skill/MCP integration.
- A conformance-tested minimal adapter, compatibility badge rules, synthetic Hugging Face dataset,
  and no-key static demonstration Space source.
- A genuine controlled-failure-to-passing-regression demo with transcript, PNG, GIF, and standalone
  artifacts.

### Security

- Capture remains off by default and excludes raw prompts, transcripts, credentials, environment
  values, personal paths, and unrestricted tool bodies.
- Bounded stdin, events, summaries, journals, and generated artifacts; deterministic deduplication;
  atomic writes; corruption recovery; and symlink/junction containment.
- Passive hooks never retry operations, and MCP execution paths require exact reviewed hashes before
  running a target or writing a regression.

### Changed

- All current product, package, Action, Studio, campaign, and report versions are aligned at 0.5.0
  while v0.4 campaign inputs and CLI workflows remain backward compatible.

## [0.4.0] - 2026-08-05

### Added

- Zero-configuration `resilireplay demo` with deterministic clean, recovered-failure, and expected
  negative controls plus a generated and executed regression in under 30 seconds.
- Reviewed `resilireplay adopt` flow for repository-local Inspector-compatible configurations,
  including side-effect-free dry-run, explicit tool/argument/retry boundaries, stdio and Streamable
  HTTP fixtures, metadata-only evidence, and 14 commit-ready campaign/regression/Action artifacts.
- Optional campaign `toolArguments` and `evidenceMode`, with project-root expansion, allowlist
  alignment, credential rejection, and v0.3.x-compatible omission semantics.
- GitHub Action `allow-remote` input, defaulting to false, for explicitly authorized non-loopback MCP
  campaigns.

### Security

- Pre-connection artifact realpath checks reject output symlink escape; project-only configuration
  discovery rejects external links and performs no home, browser, credential, or unrelated-repository
  scanning.
- `--yes` cannot authorize a tool call or duplicate attempt. Credential-shaped/encoded arguments,
  sensitive keys, home/outside paths, raw private tool bodies, environment values, and authorization
  headers fail closed or are omitted from persisted adoption evidence.

### Changed

- All shipped product/report/package version labels are aligned at 0.4.0 while existing v0.3.x
  commands, campaign defaults, and historical evidence remain compatible.

## [0.3.1] - 2026-08-04

### Fixed

- Run the composite GitHub Action's installation and build from the immutable Action checkout while
  keeping scenario and campaign inputs relative to the caller repository.
- Cover Marketplace metadata, input defaults, branding, and caller/action path separation with an
  automated metadata regression test.
- Keep the package smoke test from adding its disposable install path to the workspace lockfile.

### Changed

- Position the Marketplace listing as “ResiliReplay — Agent and MCP Reliability Tests,” document its
  read-only permissions and inputs, and align workspace/package version labels at 0.3.1.

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
