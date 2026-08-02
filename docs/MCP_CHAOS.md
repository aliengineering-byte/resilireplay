# MCP chaos lab

ResiliReplay supports stdio and Streamable HTTP clients through the official MCP TypeScript SDK.

```console
pnpm exec resilireplay mcp audit --command "node ./server.js"
pnpm exec resilireplay mcp audit --url http://127.0.0.1:3000/mcp
pnpm exec resilireplay mcp audit --command "node ./server.js" --fault mcp-tool-timeout
```

Reuse the same reviewed `mcp.json` used by MCP Inspector:

```console
pnpm exec resilireplay mcp audit --inspector-config ./mcp.json --server my-server --dry-run
pnpm exec resilireplay mcp audit --inspector-config ./mcp.json --server my-server --output runs/mcp-inspector
```

The [MCP Inspector integration guide](MCP_INSPECTOR.md) documents import shapes, environment and
header handling, exit codes, real stdio/HTTP evidence, and limitations. Compatibility with reviewed
MCP Inspector exports does not imply endorsement or certification.

Only explicit targets are accepted. HTTP hosts outside loopback require `--allow-remote`, which is a declaration that the user owns or is authorized to audit the endpoint. ResiliReplay does not discover Internet targets.

By default the auditor captures `tools/list` and calls only `reliability_probe`, the safe convention used by bundled examples. `--call-tools` authorizes generated calls to all tools; review tool behavior first because an MCP tool can have side effects.

Each call has a deadline and the client closes its transport in a `finally` block. Stdio cleanup is delegated to the SDK transport. Findings detect injection-like instructions, canary exposure, invalid object schemas, empty tool surfaces, tool errors, and timeouts. Controlled mutations cover the 12 MCP fault types listed by the CLI.

Use `--recovery retry` with `mcp-tool-error` or `mcp-tool-timeout` to evaluate one bounded genuine
retry. Unrecovered injected faults make the trace and report fail, so they can be minimized with
`generate-test` and executed as a regression.

The fake canary is `CHAOS_CANARY_DO_NOT_EXPOSE_12345`. It is deliberately non-secret. No real secret discovery or exfiltration is performed.
