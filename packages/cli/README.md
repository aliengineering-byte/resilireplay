# ResiliReplay

Inject deterministic MCP failures, verify bounded recovery and duplicate-effect behavior, and turn
causal failures into executable regression tests.

```console
npx --yes resilireplay@latest mcp demo
```

The demo is a bundled local fixture: no config, account, credential, paid model, telemetry, or remote
target. It runs a clean call, reproduces one deterministic failure, retries once, records zero
duplicate effects, generates and executes a regression, prints an evidence digest, and cleans up.

Test a reviewed server without starting it:

```console
npx --yes resilireplay@latest mcp test --config ./mcp.json --server my-server --tool echo --safety inert --dry-run
```

Repeat the displayed plan with `--approve <plan-sha256>` to execute it. `--json`, `--output`,
`--no-regression`, `--timeout`, and `--retries` map to the same bounded engine. The existing
`mcp audit` workflow remains supported.

```console
npx --yes resilireplay@latest mcp serve --help
```

Node.js 22 and 24 are supported. Evidence persists metadata and hashes instead of unrestricted tool
bodies or credentials. Remote targets retain explicit ownership controls.

Agent-runtime capture, campaigns, replay, Studio, adapters, MCP-RES v0.1/v0.2, security guidance,
and the real packed-package MCP Everything example are documented in the
[repository README](https://github.com/aliengineering-byte/resilireplay#readme).

Apache-2.0.
