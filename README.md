# ResiliReplay

[![CI](https://github.com/aliengineering-byte/resilireplay/actions/workflows/ci.yml/badge.svg)](https://github.com/aliengineering-byte/resilireplay/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/resilireplay)](https://www.npmjs.com/package/resilireplay)
[![License](https://img.shields.io/github/license/aliengineering-byte/resilireplay)](LICENSE)

ResiliReplay injects deterministic MCP failures, verifies bounded recovery, and turns failures into
executable regression tests.

```console
npx --yes resilireplay@latest mcp demo
```

```text
ResiliReplay MCP demo

✓ Clean MCP tool call
✓ Deterministic failure reproduced
✓ Recovery bounded to one retry
✓ Duplicate effects observed: 0
✓ Regression generated
✓ Regression executed

MCP reliability check passed.
Evidence: sha256:4d2479b98453732d6011c699c061d023353c8d5cf4159bdf6c5b096961f94c06
```

The demo is local, deterministic, credential-free, and cleaned up after it runs. It needs Node.js
22 or 24—no repository checkout, configuration, account, API key, paid model, or remote MCP server.

[Product site](https://aliengineering-byte.github.io/resilireplay/) ·
[npm package](https://www.npmjs.com/package/resilireplay) ·
[real MCP CI example](examples/mcp-reliability-ci/README.md) ·
[machine-readable capabilities](aeb-capabilities.json)

## Ten-second before and after

| Before                      | After ResiliReplay                  |
| --------------------------- | ----------------------------------- |
| ✓ Clean tool call           | ✓ Clean control                     |
| ? Recovery behavior unknown | ✓ Deterministic failure reproduced  |
| ? Duplicate effect unknown  | ✓ Recovery bounded                  |
| ? No regression             | ✓ Duplicate effects: 0              |
|                             | ✓ Regression generated and executed |

## What it does

- Inject deterministic MCP failures.
- Verify bounded recovery and duplicate-effect behavior.
- Generate executable regressions for CI.

## Try your MCP server

Start with an Inspector-compatible `mcp.json`. A dry-run reads and sanitizes the selected entry but
starts no process, opens no socket, calls no tool, and writes nothing.

```console
npx --yes resilireplay@latest mcp test --config ./mcp.json --server my-server --tool echo --safety inert --dry-run
```

Review the selected server, transport, tool, fault, retry/time bounds, and plan SHA-256. Execution
requires that exact digest:

```console
npx --yes resilireplay@latest mcp test --config ./mcp.json --server my-server --tool echo --safety inert --approve <plan-sha256>
```

Use the same approved plan in CI and request concise machine-readable evidence:

```console
npx --yes resilireplay@latest mcp test --config ./mcp.json --server my-server --tool echo --safety inert --approve <plan-sha256> --json
```

`mcp test` connects with the MCP SDK, discovers only the reviewed operation, runs a clean call,
injects one declared result-boundary fault, applies the bounded retry, counts duplicate effects,
generates a causal regression, executes it, and closes owned resources. `mcp audit` remains available
with its existing options for compatibility.

## CI

The repository contains a complete packed-package example using the official MCP Everything
reference server:

```yaml
name: MCP reliability
on: [pull_request]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          package-manager-cache: false
      - run: node scripts/verify-packed-mcp-example.mjs
```

See [the standalone example](examples/mcp-reliability-ci/README.md) for its exact package integrity,
SDK/runtime, protocol revision, inert `echo` operation, expected output, and generated regression.
It installs the packed CLI in a clean temporary npm project on Windows and Linux CI. This is
product-owned field validation, not an independent adopter claim.

## Safety boundaries

- Local demo: no network target, telemetry, credentials, account, or paid model.
- Real targets: one reviewed config entry and one explicit tool allowlist entry.
- Execution: an exact plan digest, finite timeouts, and at most 10 retries; examples use one.
- Evidence: metadata and hashes replace tool arguments and result bodies before persistence.
- Filesystem: contained paths, link-escape rejection, exclusive regression publication, and cleanup.

ResiliReplay is a reliability tester, not a security certification, sandbox, authorization layer, or
claim that every recovery is safe. Only invoke tools whose effects and retry semantics you own and
understand. Remote targets require the existing explicit ownership controls.

## MCP support

| MCP surface                                         | Evidence                                  | Boundary                                                                   |
| --------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| Bundled deterministic fixture                       | `FIXTURE_VERIFIED`                        | Local, zero-network demo; clean call, fault, retry, regression, cleanup    |
| Inspector-compatible stdio config                   | `LIVE_VERIFIED`                           | Real SDK transport, allowlisted tool call, bounded recovery                |
| Streamable HTTP config                              | `LIVE_VERIFIED`                           | Loopback/authenticated fixture coverage; remote ownership remains explicit |
| SSE config                                          | `PROTOCOL_VERIFIED`                       | Imported and audited through the supported SDK transport                   |
| `@modelcontextprotocol/server-everything@2026.8.18` | `INSTALLATION_VERIFIED` + `LIVE_VERIFIED` | Pinned local stdio package, inert `echo`, packed ResiliReplay CLI          |
| ResiliReplay MCP server                             | `LIVE_VERIFIED`                           | Local stdio server with annotated reliability tools                        |

Evidence labels describe what was executed; they do not imply vendor endorsement. Read the
[MCP test guide](docs/mcp-reliability/FIVE_MINUTE_MCP_TEST.md),
[Inspector compatibility guide](docs/MCP_INSPECTOR.md), and
[limitations](docs/LIMITATIONS.md).

## MCP-RES v0.2

[MCP-RES v0.2](docs/standards/mcp-res/v0.2.0/MCP_RES.md) is the project-defined, open reliability
evidence standard behind the result vocabulary. Its versioned profiles cover identity, bounded
recovery, duplicate effects, cleanup, integrity, and executable causal evidence. ResiliReplay is a
reference implementation, not a required dependency.

MCP-RES is independent of the official MCP specification. It is not an official MCP standard,
security certification, or endorsement. The immutable [v0.1](docs/standards/mcp-res/v0.1.0/) and
[v0.2](docs/standards/mcp-res/v0.2.0/) trees, schemas, vectors, conformance tools, governance, and
limitations remain available from the [standards landing page](docs/standards/mcp-res/README.md).

## Secondary agent-runtime support

ResiliReplay can also capture sanitized failures from supported agent runtimes and compile them into
regressions. This is a secondary workflow; it does not change the MCP-first product path.

Genuine local runtime coverage exists for LangGraph 1.4.9 and OpenAI Agents SDK 0.14.3 using
deterministic, no-key models. Claude Code and Codex integrations are installation- and
fixture-verified; Hermes is installation-verified. Other named surfaces are documented only.
No authenticated hosted model, billed provider call, production API behavior, or vendor endorsement
is claimed.

Read [framework evidence](docs/FRAMEWORKS.md), [agent compatibility](docs/COMPATIBILITY.md),
[plugin operations](docs/PLUGINS.md), and the [framework support policy](docs/product/FRAMEWORK_SUPPORT_POLICY.md).

## CLI map

MCP reliability appears first in `resilireplay --help`:

```text
mcp demo       Try a deterministic local MCP reliability test
mcp test       Test one reviewed MCP tool with bounded recovery
mcp validate   Validate a test configuration without starting it
mcp serve      Run ResiliReplay as a local stdio MCP server
mcp audit      Preserve the existing lower-level audit workflow
```

Existing campaign, replay, reporting, adapter, agent capture, and Studio commands remain available.
The root `demo` command is retained as a hidden compatibility alias for `mcp demo`; `mcp audit` is
not removed or weakened.

## Artifact behavior

By default, `mcp demo` runs in an isolated temporary directory, executes its regression, removes the
directory, and prints one evidence digest. Retain a deterministic bundle only when requested:

```console
npx --yes resilireplay@latest mcp demo --keep
npx --yes resilireplay@latest mcp demo --output ./my-evidence
npx --yes resilireplay@latest mcp demo --json
```

`--keep` writes `.resilireplay/demo/`. Explicit output must stay inside the current project. An
identical existing bundle is accepted; a mismatch fails without changing it. The completion manifest
is written last, and JSON output contains only relative artifact paths.

## Exit codes

| Code | Meaning                                                     |
| ---: | ----------------------------------------------------------- |
|  `0` | Reliability check or side-effect-free validation passed     |
|  `1` | Reliability findings or a failed regression                 |
|  `2` | Invalid command use or missing approval                     |
| `10` | Invalid MCP configuration                                   |
| `11` | Remote target lacks explicit authorization                  |
| `12` | MCP connection or protocol failure                          |
| `13` | Credential-shaped output detected                           |
| `30` | Demo execution failure                                      |
| `31` | Demo artifact containment, conflict, or publication failure |

Campaign-specific codes remain documented in the [campaign schema guide](docs/CAMPAIGN_SCHEMA.md).

## Installation

Run without a global install:

```console
npx --yes resilireplay@latest --version
```

Supported runtimes are Node.js 22 and 24 on current Ubuntu and Windows GitHub-hosted runners. The npm
package is Apache-2.0 licensed and published from a protected GitHub release through npm trusted
publishing with OIDC and provenance; no long-lived npm token is accepted by the release workflow.

## Security and privacy

Capture is off by default. ResiliReplay sends no telemetry and persists no raw prompt, transcript,
environment value, authorization header, token, or unrestricted tool body by default. Review
[SECURITY.md](SECURITY.md), [THREAT_MODEL.md](THREAT_MODEL.md), and
[docs/LIMITATIONS.md](docs/LIMITATIONS.md) before testing a stateful tool.

Please report vulnerabilities through the repository's private security-reporting path, not a public
issue. Reliability failures and compatibility gaps can use the public issue templates.

## Contributing

Focused bug fixes, MCP compatibility evidence, and bounded reliability cases are welcome. Read
[CONTRIBUTING.md](CONTRIBUTING.md) and the
[case contribution rules](docs/mcp-reliability/CONTRIBUTING_CASES.md). Do not submit credentials,
private traces, production tool bodies, or evidence you are not authorized to publish.

## Development

Maintainer development uses the repository-pinned toolchain:

```console
pnpm install --frozen-lockfile
pnpm quality
pnpm mcp:example:verify
```

The first-time user path never requires a checkout or pnpm. Release gates additionally inspect the
packed tarball, test clean installs, scan generated evidence, exercise the cross-platform matrix, and
verify immutable MCP-RES v0.1/v0.2 content.

## License

Apache-2.0. See [LICENSE](LICENSE).
