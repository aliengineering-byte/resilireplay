# ResiliReplay

[![CI](https://github.com/aliengineering-byte/resilireplay/actions/workflows/ci.yml/badge.svg)](https://github.com/aliengineering-byte/resilireplay/actions/workflows/ci.yml)
[![Secret scan](https://github.com/aliengineering-byte/resilireplay/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/aliengineering-byte/resilireplay/actions/workflows/secret-scan.yml)
[![Field validation](https://github.com/aliengineering-byte/resilireplay/actions/workflows/field-validation.yml/badge.svg)](https://github.com/aliengineering-byte/resilireplay/actions/workflows/field-validation.yml)
[![Pages](https://github.com/aliengineering-byte/resilireplay/actions/workflows/pages.yml/badge.svg)](https://aliengineering-byte.github.io/resilireplay/)
[![npm](https://img.shields.io/npm/v/resilireplay)](https://www.npmjs.com/package/resilireplay)
[![Release](https://img.shields.io/github/v/release/aliengineering-byte/resilireplay?display_name=tag&sort=semver)](https://github.com/aliengineering-byte/resilireplay/releases/tag/v0.4.0)
[![License](https://img.shields.io/github/license/aliengineering-byte/resilireplay)](LICENSE)

**Turn an MCP server into a reviewed deterministic recovery test suite and GitHub Action in under five minutes.**

MCP Inspector shows what a server does. ResiliReplay proves what happens when it fails, preserves the
recovery evidence, and turns it into an executable regression. The local path needs no API key,
Docker, account, telemetry, external MCP server, or LLM judge.

```console
npx --yes resilireplay@0.4.0 demo
npx --yes resilireplay@0.4.0 adopt --config ./mcp.json --dry-run
npx --yes resilireplay@0.4.0 adopt --config ./mcp.json
git add .resilireplay tests/resilireplay .github/workflows/resilireplay.yml
```

[![Genuine ResiliReplay v0.4.0 demo showing a recovered tool-result failure and generated regression](docs/assets/adopt-demo.gif)](docs/assets/adopt-demo.png)

[Static fallback](docs/assets/adopt-demo.png) - [genuine packed-package transcript](docs/assets/adopt-demo-transcript.txt) - [adoption guide](docs/ADOPT.md) - [product page](https://aliengineering-byte.github.io/resilireplay/)

| Tool category      | Primary function                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------- |
| MCP Inspector      | Interactive MCP exploration and debugging.                                                   |
| General eval tools | Output quality, security evaluation, or model comparison.                                    |
| ResiliReplay       | Deterministic failure injection, causal recovery evidence, and executable regressions in CI. |

> ResiliReplay is defensive testing software, not an OS sandbox or security certification. Audit only
> local or user-owned targets. MCP tool calls may have server-side effects; review the exact target,
> tool, arguments, and retry suitability before confirming them. Tool annotations are untrusted hints.

## Five-minute adoption workflow

Requirements: Node.js 22 or 24 and an Inspector-compatible `mcp.json`. With no server available, the
packaged demo gives the complete failure-to-regression path in under 30 seconds:

```console
npx --yes resilireplay@0.4.0 demo
npx --yes resilireplay@0.4.0 adopt --config ./mcp.json --dry-run
npx --yes resilireplay@0.4.0 adopt --config ./mcp.json
```

`adopt --dry-run` validates and displays the exact sanitized process/arguments or HTTP origin while
starting no process, opening no connection, calling no tool, and writing no project file. Real
adoption calls only the explicitly reviewed tool and arguments after confirmation, requires a
separate one-duplicate safety confirmation, runs bounded clean/recovery/negative scenarios, verifies
the generated regression, and writes 14 documented artifacts. `--yes` cannot bypass the tool or
retry boundaries.

Install the self-contained CLI if preferred:

```console
npm install --global resilireplay@0.4.0
resilireplay --version
resilireplay --help
```

Read the full [adoption guide](docs/ADOPT.md), including non-interactive flags, stable exit codes,
generated files, cleanup, and safety boundaries.

## Generated recovery CI

The adoption workflow generates a campaign pinned to the selected server, exact allowlisted tool and
arguments, deterministic seed, one-retry maximum, metadata-only evidence, baseline approval
instructions, an executable regression, and this minimal workflow:

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@v6
  - uses: aliengineering-byte/resilireplay@v0.4.0
    with:
      campaign: .resilireplay/campaign.yml
      campaign-confirmation-hash: <reviewed-campaign-sha256>
```

| Action input                 | Required | Default     | Purpose                                                      |
| ---------------------------- | -------- | ----------- | ------------------------------------------------------------ |
| `scenarios`                  | No       | `scenarios` | Directory of deterministic YAML scenarios.                   |
| `campaign`                   | No       | empty       | Campaign path; skips the scenario directory when set.        |
| `campaign-confirmation-hash` | No       | empty       | Exact reviewed hash required for allowlisted tool calls.     |
| `allow-remote`               | No       | `false`     | Explicit acknowledgement for a declared non-loopback target. |

The Action makes no GitHub API calls, requires no credential, and works with read-only repository
permissions. It defines no outputs; reports and the GitHub step summary come from the selected CLI
workflow.

## Studio, campaigns, and existing workflows

The v0.3.x product remains supported and backward compatible:

```console
resilireplay studio --open
resilireplay campaign init campaign.yml
resilireplay campaign validate campaign.yml
resilireplay campaign run campaign.yml --confirm-tools <reviewed-sha256>
resilireplay campaign approve runs/candidate --output baselines/main.json
resilireplay campaign compare runs/current --baseline baselines/main.json

resilireplay record --output runs/agent/trace.jsonl -- node agent.js
resilireplay inject --trace runs/agent/trace.jsonl --scenario malformed-json --seed 42 --output runs/agent/failed.jsonl
resilireplay replay --trace runs/agent/failed.jsonl --report-dir runs/agent/report
resilireplay generate-test --trace runs/agent/failed.jsonl --output runs/agent/regression
resilireplay mcp audit --inspector-config ./mcp.json --server my-server --dry-run
```

Campaign exit codes remain `0` pass, `1` reliability failure/regression, `2` CLI usage, `20` invalid
schema, `21` target/authorization, `22` execution, `23` cancelled/incomplete, and `24` integrity
failure. Read the [campaign schema](docs/CAMPAIGN_SCHEMA.md),
[formal JSON Schema](schemas/campaign.schema.json), [v0.4 migration notes](docs/MIGRATION_V0_4.md),
[MCP Inspector integration](docs/MCP_INSPECTOR.md), and [report schema](docs/REPORT_SCHEMA.md).

## Reproducible field evidence

Three founder-run case studies used the immutable public v0.3.0 package against documented local
stdio paths in independently maintained MCP projects:

| Project                  | Reviewed operation            | Declared result                                          | Evidence                                                 |
| ------------------------ | ----------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| MCP Everything Server    | `echo`                        | 3/3 expectations; one bounded retry; regression verified | [case study](docs/case-studies/mcp-everything/README.md) |
| Microsoft Playwright MCP | blank-page `browser_snapshot` | 3/3 expectations; one bounded retry; regression verified | [case study](docs/case-studies/playwright-mcp/README.md) |
| UI5 MCP Server           | `get_guidelines`              | 3/3 expectations; one bounded retry; regression verified | [case study](docs/case-studies/ui5-mcp/README.md)        |

These are bounded maintainer-run results, not upstream endorsements, independent adopters, rankings,
or security certifications. Each record pins public package and upstream revisions, declares the
side-effect boundary, and includes sanitized hash-linked evidence. See the
[selection record](docs/field-validation/SERVER_SELECTION.md) and
[complete results](docs/field-validation/FIELD_RESULTS.md).

## Architecture

| Package                   | Responsibility                                                             |
| ------------------------- | -------------------------------------------------------------------------- |
| `@resilireplay/core`      | Versioned events, redaction, deterministic faults/scoring, path safety.    |
| `@resilireplay/trace`     | Canonical JSONL and failed-trace-to-regression compilation.                |
| `@resilireplay/reporters` | Terminal, JSON, HTML, JUnit, SARIF, manifests, and badges.                 |
| `@resilireplay/mcp-chaos` | Authorized MCP discovery, allowlisted calling, mutation, and evidence.     |
| `@resilireplay/campaign`  | Strict campaigns, bounded runner, baselines, comparisons, and CI evidence. |
| `@resilireplay/studio`    | Loopback browser workflow over the same campaign APIs.                     |
| `@resilireplay/proxy`     | Loopback provider/transport mutation proxy.                                |
| `resilireplay`            | Self-contained cross-platform CLI.                                         |

The stable provider-neutral boundary is `TraceEvent`; Studio, campaigns, `demo`, and `adopt` reuse
the same fault, evidence, MCP, and regression primitives. Read the [architecture](docs/ARCHITECTURE.md)
and [product strategy](docs/PRODUCT_STRATEGY.md).

## Security, privacy, and limitations

- No telemetry is implemented. The packaged demo makes no network or provider call.
- Default adoption discovery checks only `mcp.json`, `.mcp.json`, and `.vscode/mcp.json` in the
  current project. Home directories, unrelated repositories, browser storage, and credentials are
  not scanned.
- Imported headers/environment values stay in memory. Adoption evidence is metadata-only and omits
  raw tool bodies; credential-shaped arguments and outside/symlinked paths fail closed.
- Commands and reviewed stdio servers execute with the current OS account and are not sandboxed.
- Pattern redaction cannot prove removal of every application-specific secret; omit secrets at the
  source and treat evidence as potentially sensitive.
- SHA-256 proves artifact linkage and integrity, not signer identity.
- Inspector interactive OAuth/modern protocol-era settings, incremental streaming semantics,
  resumable side-effecting campaigns, hosted dashboards, and arbitrary browser commands are not
  supported in v0.4.0.
- The supported npm distribution is the self-contained `resilireplay` CLI. Internal workspace
  packages are not separately published APIs.

Read [SECURITY.md](SECURITY.md), [THREAT_MODEL.md](THREAT_MODEL.md),
[Studio security](docs/STUDIO_SECURITY.md), and [known limitations](docs/LIMITATIONS.md).

## Development and release evidence

```console
corepack enable
pnpm install --frozen-lockfile
pnpm quality
pnpm test:e2e
pnpm site:test
pnpm release:gates
```

ResiliReplay is Apache-2.0 licensed. Contributions must remain deterministic, bounded, secure by
default, and covered by tests. See [CONTRIBUTING.md](CONTRIBUTING.md),
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [adopter policy](ADOPTERS.md),
[verified demos](docs/DEMO.md), and [v0.4.0 release evidence](docs/RELEASE_EVIDENCE_V0_4.md).

Built and maintained by **Ali**.
