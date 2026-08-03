# resilireplay

The ResiliReplay CLI. Record, mutate, replay, score, report, generate regression tests, and audit authorized MCP servers.

Requires Node.js 22 or 24.

```console
npm install --global resilireplay
resilireplay --help
```

Or run a pinned version without installing globally:

```console
npx --yes resilireplay@0.2.1 --version
```

Audit only local or user-owned MCP targets. Dry-run an existing MCP Inspector configuration before
allowing any tool calls:

```console
resilireplay mcp audit --inspector-config ./mcp.json --server my-server --dry-run
```

Documentation, source, and deterministic demos:
[github.com/aliengineering-byte/resilireplay](https://github.com/aliengineering-byte/resilireplay)
