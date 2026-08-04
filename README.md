# ResiliReplay

[![CI](https://github.com/aliengineering-byte/resilireplay/actions/workflows/ci.yml/badge.svg)](https://github.com/aliengineering-byte/resilireplay/actions/workflows/ci.yml)
[![Secret scan](https://github.com/aliengineering-byte/resilireplay/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/aliengineering-byte/resilireplay/actions/workflows/secret-scan.yml)
[![Field validation](https://github.com/aliengineering-byte/resilireplay/actions/workflows/field-validation.yml/badge.svg)](https://github.com/aliengineering-byte/resilireplay/actions/workflows/field-validation.yml)
[![Pages](https://github.com/aliengineering-byte/resilireplay/actions/workflows/pages.yml/badge.svg)](https://aliengineering-byte.github.io/resilireplay/)
[![npm](https://img.shields.io/npm/v/resilireplay)](https://www.npmjs.com/package/resilireplay)
[![Release](https://img.shields.io/github/v/release/aliengineering-byte/resilireplay?display_name=tag&sort=semver)](https://github.com/aliengineering-byte/resilireplay/releases/tag/v0.3.0)
[![License](https://img.shields.io/github/license/aliengineering-byte/resilireplay)](LICENSE)

**MCP Inspector shows what a server does. ResiliReplay proves what happens when it fails, whether it recovers safely, and whether that recovery remains fixed.**

ResiliReplay Studio & Campaigns is a local-first reliability lab for AI agents and MCP servers. Import a reviewed Inspector-shaped target, inject deterministic faults, watch the causal timeline, approve a baseline, block regressions in CI, and export an executable test. The verified path needs no API key, Docker, external account, telemetry, or LLM judge.

[Open the product page](https://aliengineering-byte.github.io/resilireplay/) | [Run a five-minute field test](docs/FIELD_TEST_GUIDE.md) | [Inspect three reproducible external cases](docs/field-validation/FIELD_RESULTS.md)

![Verified ResiliReplay Studio campaign](docs/assets/studio-campaign.png)

[Watch the verified Studio workflow](docs/assets/studio-campaign.gif) · [Read its captured transcript](docs/assets/studio-demo-transcript.txt)

> ResiliReplay is defensive testing software, not an OS sandbox or security certification. Audit only local or user-owned targets. MCP tool calls may have server-side effects; review the target and exact allowlist before confirming them.

## Five-minute verified workflow

Requirements: Node.js 22 or 24. The repository workflow uses pnpm 10.14.0 and bundled local fixtures so every result is reproducible.

```console
git clone https://github.com/aliengineering-byte/resilireplay.git
cd resilireplay
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm demo:studio
pnpm exec resilireplay studio --open
```

The demo runs four real stdio scenarios, a real authenticated Streamable HTTP negative control and retry, generated regressions, baseline approval/comparison, and a Studio lifecycle check. On the measured release workstation it completed in 2.4 seconds. All targets are repository-owned toy fixtures and are labeled as such.

Install the self-contained CLI:

```console
npm install --global resilireplay@0.3.0
resilireplay --version
resilireplay --help
```

## Field evidence

The immutable public `resilireplay@0.3.0` package was independently installed into each case and
used against three actively maintained external MCP projects over their documented local stdio path:

| Project                  | Reviewed operation            | Declared campaign result                                 | Reproduce                                                |
| ------------------------ | ----------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| MCP Everything Server    | `echo`                        | 3/3 expectations; one bounded retry; regression verified | [case study](docs/case-studies/mcp-everything/README.md) |
| Microsoft Playwright MCP | blank-page `browser_snapshot` | 3/3 expectations; one bounded retry; regression verified | [case study](docs/case-studies/playwright-mcp/README.md) |
| UI5 MCP Server           | `get_guidelines`              | 3/3 expectations; one bounded retry; regression verified | [case study](docs/case-studies/ui5-mcp/README.md)        |

Each case pins the public package and upstream source revision, declares its authorization and
side-effect boundary, preserves actual and expected results separately, provides SHA-256 manifests,
and includes an executable sanitized regression. These maintainer-run tests are bounded evidence,
not upstream endorsements, adopter claims, rankings, or security certifications. Read the
[selection record](docs/field-validation/SERVER_SELECTION.md) and
[complete results](docs/field-validation/FIELD_RESULTS.md).

## Studio

```console
resilireplay studio --open
```

Studio binds only to `127.0.0.1`. It uses an ephemeral HttpOnly session, same-origin and CSRF checks, bounded JSON requests, contained paths, and a one-time confirmation tied to the reviewed campaign hash before any allowlisted tool call. Its nine-screen workflow covers quick start, target review, campaign building, live/cancel state, causal timeline, findings, baseline, regression, and evidence downloads.

Studio does not accept arbitrary browser-supplied shell commands, does not put secrets in URLs, and does not authorize remote targets in v0.3.0. Closing Studio cancels active work and closes child processes, transports, and its listener.

## Campaigns

Campaigns are strict versioned YAML or JSON documents. Start with the schema and a generated template:

```console
resilireplay campaign init campaign.yml
resilireplay campaign validate campaign.yml
```

The reviewed validation output includes the campaign SHA-256. A discovery-only campaign needs no tool confirmation. If `allowTools` is non-empty, pass back the exact reviewed hash:

```console
resilireplay campaign validate examples/studio/campaign.yml
resilireplay campaign run examples/studio/campaign.yml \
  --confirm-tools f4cdf7ea8289253f05c1793fe622e1fd025ce88084b4ebacfd5257deb0974dba \
  --output runs/studio-campaign
```

Approve only a complete expectation-passing run, then compare future evidence:

```console
resilireplay campaign approve runs/studio-campaign --output baselines/studio.json
resilireplay campaign compare runs/studio-campaign --baseline baselines/studio.json
```

The runner preserves stable scenario order under bounded concurrency, uses explicit seeds and retry/time budgets, supports cancellation, and emits terminal, JSON, HTML, Markdown, JUnit, SARIF, and GitHub step-summary evidence. Missing metrics remain `null`; token, cost, latency, side-effect, and coverage values are never invented.

Campaign exit codes are stable: `0` pass, `1` reliability failure/regression, `2` CLI usage, `20` invalid schema, `21` target/authorization, `22` execution, `23` cancelled/incomplete, and `24` integrity failure.

Read the [campaign schema guide](docs/CAMPAIGN_SCHEMA.md), [formal JSON Schema](schemas/campaign.schema.json), and [migration notes](docs/MIGRATION_V0_3.md).

## Existing trace and MCP workflows

The v0.1/v0.2 commands remain supported:

```console
resilireplay record --output runs/agent/trace.jsonl -- node examples/deterministic-agent/dist/index.js
resilireplay inject --trace runs/agent/trace.jsonl --scenario malformed-json --seed 42 --output runs/agent/failed.jsonl
resilireplay replay --trace runs/agent/failed.jsonl --report-dir runs/agent/report
resilireplay generate-test --trace runs/agent/failed.jsonl --output runs/agent/regression
resilireplay mcp audit --inspector-config ./mcp.json --server my-server --dry-run
```

Direct `mcp audit` discovers tools and invokes only a reserved `reliability_probe` by default for backward compatibility. Campaigns are stricter: they call no tool unless its name is in `allowTools` and the exact reviewed campaign hash is confirmed. Non-loopback direct HTTP also requires `--allow-remote`.

See [MCP Inspector integration](docs/MCP_INSPECTOR.md), [MCP chaos](docs/MCP_CHAOS.md), [adapter guidance](docs/ADAPTERS.md), and the [report schema](docs/REPORT_SCHEMA.md).

## Architecture

| Package                   | Responsibility                                                             |
| ------------------------- | -------------------------------------------------------------------------- |
| `@resilireplay/core`      | Versioned events, redaction, deterministic faults and scoring, path safety |
| `@resilireplay/trace`     | Canonical JSONL and failed-trace-to-regression compilation                 |
| `@resilireplay/reporters` | Terminal, JSON, HTML, JUnit, SARIF, manifests, and badges                  |
| `@resilireplay/mcp-chaos` | Authorized MCP discovery, allowlisted calling, mutation, and evidence      |
| `@resilireplay/campaign`  | Strict campaigns, bounded runner, baselines, comparisons, and CI evidence  |
| `@resilireplay/studio`    | Loopback browser workflow over the same campaign APIs                      |
| `@resilireplay/proxy`     | Loopback provider/transport mutation proxy                                 |
| `resilireplay`            | Self-contained cross-platform CLI                                          |

The stable boundary is the provider-neutral `TraceEvent`; Studio and the CLI call the same campaign engine. Read the [architecture](docs/ARCHITECTURE.md) and [product strategy](docs/PRODUCT_STRATEGY.md).

## CI

`campaign run` and `campaign compare` append Markdown to `GITHUB_STEP_SUMMARY` when GitHub Actions provides it. A discovery-only campaign can run through the composite action:

```yaml
- uses: aliengineering-byte/resilireplay@v0.3.0
  with:
    campaign: reliability.campaign.yml
```

For a tool-calling campaign, supply the separately reviewed `campaign-confirmation-hash` and keep target authorization under repository review. The aggregate local gate is:

```console
pnpm quality
pnpm test:e2e
pnpm site:test
pnpm demo:studio
pnpm release:gates
```

## Security, privacy, and limitations

- No telemetry is implemented. Deterministic demos make no external provider calls.
- Commands explicitly passed to `record` or imported from a reviewed Inspector file execute with the current OS account and are not sandboxed.
- Reports are sanitized, but pattern redaction cannot prove removal of every application-specific secret. Omit secrets at the adapter source and treat evidence as potentially sensitive.
- SHA-256 hashes prove artifact linkage and integrity, not signer identity.
- Inspector interactive OAuth, explicit modern protocol-era settings, resumable side-effecting campaigns, hosted dashboards, and arbitrary browser commands are not supported in v0.3.0.
- The supported npm distribution is the self-contained `resilireplay` CLI. Internal workspace packages are not separately published APIs.

Read [SECURITY.md](SECURITY.md), [THREAT_MODEL.md](THREAT_MODEL.md), [Studio security](docs/STUDIO_SECURITY.md), [known limitations](docs/LIMITATIONS.md), and the [roadmap](docs/ROADMAP.md).

## Project

ResiliReplay is Apache-2.0 licensed. Contributions must remain deterministic, bounded, secure by default, and covered by tests. See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), the [field-test guide](docs/FIELD_TEST_GUIDE.md), [adopter policy](ADOPTERS.md), [demo guide](docs/DEMO_60_SECONDS.md), and [v0.3.0 release evidence](RELEASE_EVIDENCE.md).

Built and maintained by **Ali**.
