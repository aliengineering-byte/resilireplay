# MCP chaos lab

ResiliReplay supports stdio and Streamable HTTP clients through the official MCP TypeScript SDK.

```console
pnpm exec resilireplay mcp audit --command "node ./server.js"
pnpm exec resilireplay mcp audit --url http://127.0.0.1:3000/mcp
pnpm exec resilireplay mcp audit --command "node ./server.js" --fault mcp-tool-timeout
```

Only explicit targets are accepted. HTTP hosts outside loopback require `--allow-remote`, which is a declaration that the user owns or is authorized to audit the endpoint. ResiliReplay does not discover Internet targets.

By default the auditor captures `tools/list` and calls only `reliability_probe`, the safe convention used by bundled examples. `--call-tools` authorizes generated calls to all tools; review tool behavior first because an MCP tool can have side effects.

Each call has a deadline and the client closes its transport in a `finally` block. Stdio cleanup is delegated to the SDK transport. Findings detect injection-like instructions, canary exposure, invalid object schemas, empty tool surfaces, tool errors, and timeouts. Controlled mutations cover the 12 MCP fault types listed by the CLI.

The fake canary is `CHAOS_CANARY_DO_NOT_EXPOSE_12345`. It is deliberately non-secret. No real secret discovery or exfiltration is performed.
