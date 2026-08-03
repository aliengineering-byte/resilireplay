# ResiliReplay

[![CI](https://github.com/aliengineering-byte/resilireplay/actions/workflows/ci.yml/badge.svg)](https://github.com/aliengineering-byte/resilireplay/actions/workflows/ci.yml)
[![Secret scan](https://github.com/aliengineering-byte/resilireplay/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/aliengineering-byte/resilireplay/actions/workflows/secret-scan.yml)
[![npm](https://img.shields.io/npm/v/resilireplay)](https://www.npmjs.com/package/resilireplay)
[![Release](https://img.shields.io/github/v/release/aliengineering-byte/resilireplay?display_name=tag&sort=semver)](https://github.com/aliengineering-byte/resilireplay/releases/tag/v0.2.1)
[![License](https://img.shields.io/github/license/aliengineering-byte/resilireplay)](LICENSE)

**ResiliReplay crash-tests AI agents and MCP servers, replays failures deterministically, and converts broken traces into regression tests.**

It is a model-agnostic, local-first TypeScript toolkit: record versioned events, inject seed-controlled faults, score recovery from declared evidence, and compile the first causal failure into an editable scenario plus an executable Node test. The deterministic path needs no API key, paid model, Docker, external account, telemetry, or LLM judge.

![ResiliReplay no-key deterministic demo](docs/assets/resilireplay-demo.gif)

> ResiliReplay is defensive testing software. Audit only local or user-owned MCP targets. A report or badge is evidence for one declared suite and version, not a universal security certification.

## Install from npm

Requirements: a supported Node.js release (22 or 24) and npm.

```console
npm install --global resilireplay@0.2.1
resilireplay --help
resilireplay faults
```

For a one-off run without a global install:

```console
npx --yes resilireplay@0.2.1 --version
```

## Run the verified no-key demos

The repository supplies deterministic agent and MCP fixtures; the globally installed `resilireplay`
command is the same self-contained CLI distributed by npm. Contributors also need pnpm 10.14.0.

```console
git clone https://github.com/aliengineering-byte/resilireplay.git
cd resilireplay
pnpm install --frozen-lockfile
pnpm build
pnpm demo
```

The demo runs a real deterministic local subprocess, injects three faults, scores a successful recovery and an unrecovered failure, writes every report format, compiles the failed trace, and executes the generated regression test.

Continue the local tour:

```console
pnpm demo:mcp
resilireplay test scenarios
```

The MCP demo imports real Inspector-shaped configs, exercises resilient and intentionally vulnerable
stdio servers plus authenticated Streamable HTTP, recovers one injected fault, detects one expected
failure, and executes its generated regression. Open `runs/demo/recovered-report/report.html` in a
browser to inspect the general recovery report.

See the [demo guide and verified transcript](docs/DEMO.md) for expected output and asset reproduction.

## Practical agent example

Record the bundled deterministic agent and emit a passing baseline report:

```console
resilireplay record --output runs/agent/trace.jsonl -- node examples/deterministic-agent/dist/index.js
resilireplay replay --trace runs/agent/trace.jsonl --report-dir runs/agent/report
```

Adapters for a real agent framework emit the same versioned `TraceEvent` objects. See the [adapter guide](docs/ADAPTERS.md); the OpenAI-compatible example is a translation fixture and does not claim to call a live provider.

## Practical MCP audit

Already use MCP Inspector? Reuse the same reviewed `mcp.json` without rewriting its server command,
argument array, environment declarations, URL, or headers:

```console
resilireplay mcp audit --inspector-config ./mcp.json --server my-server --dry-run
resilireplay mcp audit --inspector-config ./mcp.json --server my-server --output runs/mcp-inspector
```

MCP Inspector interactively tests and debugs servers. ResiliReplay introduces controlled failures,
scores recovery, and creates executable regressions. The tools are complementary; compatibility with
reviewed MCP Inspector exports does not imply endorsement or certification. See the
[integration guide](docs/MCP_INSPECTOR.md) and [compatibility matrix](docs/MCP_INSPECTOR_COMPATIBILITY.md).

Audit the bundled resilient server over stdio:

```console
resilireplay mcp audit --command "node examples/resilient-mcp-server/dist/index.js" --output runs/mcp-audit
```

`mcp audit` captures `tools/list` schemas and calls only a tool named `reliability_probe` by default. Pass `--call-tools` only after reviewing tool behavior, because MCP calls may have server-side effects. Non-loopback Streamable HTTP targets also require `--allow-remote`.

The [MCP chaos guide](docs/MCP_CHAOS.md) covers controlled faults, transports, authorization, and safe-canary behavior.

## Fault injection

Apply a built-in fault or reviewable YAML scenario. The same trace plus scenario plus seed produces the same mutation:

```console
resilireplay inject --trace runs/agent/trace.jsonl --scenario malformed-json --seed 42 --output runs/agent/failed.jsonl
resilireplay replay --trace runs/agent/failed.jsonl --report-dir runs/agent/failed-report
resilireplay faults
```

The replay command above intentionally exits 1: the minimal baseline has no recovery event after the injected malformed response. It still writes the failed report bundle for review. Use `resilireplay test scenarios` when a CI command should verify both expected-pass and expected-failure scenarios with exit 0.

Provider and transport faults include bounded latency, timeout, 429/5xx, reset, truncation, malformed JSON, duplicates, and stale responses. Tool and workflow faults cover errors, permissions, disposable missing files, corrupt results, side-effect duplication, handoff loss, wrong recipients, stale state, conflicting instructions, and loops.

See [custom fault scenarios](docs/CUSTOM_FAULTS.md) for the YAML contract and safety rules.

## Trace to regression

`pnpm demo` creates a failed trace. Convert it into a minimized fixture, scenario, manifest, and executable `node:test`:

```console
resilireplay generate-test --trace runs/demo/failed.jsonl --output runs/generated-regression
```

The generated test executes immediately by default. `manifest.json` links the source trace, minimized fixture, scenario, and test with SHA-256 hashes.

```mermaid
flowchart LR
    A["Record JSONL trace"] --> B["Inject deterministic fault"]
    B --> C["Replay"]
    C --> D["Score recovery"]
    D --> E["Minimize causal failure"]
    E --> F["Generate regression"]
    F --> C
```

## Sample recovery report

This excerpt is captured from the no-key demo:

```text
ResiliReplay v0.2.1  PASS
Recovery score  100/100
Completion      yes
Recovery        safe
Retries         1/3
Safety          compliant
```

Each run can emit:

| Format      | File                | Intended use                    |
| ----------- | ------------------- | ------------------------------- |
| Terminal    | `terminal.txt`      | Local and CI logs               |
| JSON        | `report.json`       | Automation and dashboards       |
| HTML        | `report.html`       | Standalone human review         |
| JUnit       | `junit.xml`         | Test runners and CI annotations |
| SARIF 2.1.0 | `report.sarif`      | Code-scanning ingestion         |
| Manifest    | `run-manifest.json` | Artifact and metrics hashes     |
| SVG         | `badge.svg`         | Scope-limited run status        |

See the [report schema](docs/REPORT_SCHEMA.md).

## Architecture

The stable boundary is a strict, provider-neutral `TraceEvent`, not a model SDK:

| Package                       | Responsibility                                                      |
| ----------------------------- | ------------------------------------------------------------------- |
| `@resilireplay/core`          | Events, redaction, fault engine, deterministic scoring, path safety |
| `@resilireplay/trace`         | Canonical JSONL and failed-trace-to-regression compiler             |
| `@resilireplay/reporters`     | Terminal, JSON, HTML, JUnit, SARIF, manifests, badges               |
| `@resilireplay/mcp-chaos`     | Authorized MCP discovery, calling, mutation, canaries, evidence     |
| `@resilireplay/proxy`         | Loopback provider/transport mutation proxy                          |
| `resilireplay`                | Cross-platform CLI, recording, replay, scenarios, cleanup           |
| `@resilireplay/github-action` | Repository-native CI integration                                    |

Read the [architecture](docs/ARCHITECTURE.md) for invariants and package dependencies.

## Security and privacy

- `record` executes the exact command you supply; it is not an OS sandbox.
- Audit only MCP servers you own or are authorized to test.
- Review MCP schemas before `--call-tools`; tools can have side effects.
- Omit secrets at the adapter source even though credential-shaped values and sensitive keys are redacted before trace storage.
- Treat reports as sensitive test evidence if source traces contain private application data.

Filesystem faults use owned temporary directories, output paths are containment-checked, spawned processes have deadlines and cleanup, and listeners bind to loopback unless a caller deliberately chooses another host.

Read [SECURITY.md](SECURITY.md) and [THREAT_MODEL.md](THREAT_MODEL.md) before running untrusted commands or remote MCP targets.

## Honest limitations

- Inspector `protocolEra: "modern"`, interactive OAuth, and extended Inspector-only runtime settings are not yet supported and fail explicitly.
- `record` is not an OS sandbox.
- MCP tool calls may have server-side effects.
- Causal minimization is strongest when adapters provide `parentId` and `causeId`.
- Streaming provider output is aggregated into response events in v0.2.1.
- Report hashes prove linkage and integrity, not authenticity; manifests are unsigned.
- The supported npm distribution is the `resilireplay` CLI; internal workspace packages are not public API.

See [known limitations](docs/LIMITATIONS.md) and the [roadmap](docs/ROADMAP.md).

## CI, release, and contributing

Run the complete local gate:

```console
pnpm quality
```

Use the composite action:

```yaml
- uses: aliengineering-byte/resilireplay@v0.2.1
  with:
    scenarios: scenarios
```

ResiliReplay is Apache-2.0 licensed. Contributions should be deterministic, bounded, and covered by tests. See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), the [launch reference](docs/LAUNCH.md), [release evidence](RELEASE_EVIDENCE.md), and the [v0.2.1 release](https://github.com/aliengineering-byte/resilireplay/releases/tag/v0.2.1).

Built and maintained by **Ali**.
