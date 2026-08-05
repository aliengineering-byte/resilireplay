# resilireplay

The self-contained ResiliReplay CLI. Run the loopback Studio, execute deterministic reliability
campaigns, compare approved baselines, record/mutate/replay traces, generate regression tests, and
audit authorized MCP servers.

Requires Node.js 22 or 24.

```console
npm install --global resilireplay
resilireplay --help
```

Or run a pinned version without installing globally:

```console
npx --yes resilireplay@0.3.1 --version
```

Start Studio or inspect campaign commands:

```console
resilireplay studio --open
resilireplay campaign --help
```

Audit only local or user-owned MCP targets. Dry-run an existing MCP Inspector configuration before
allowing any tool calls:

```console
resilireplay mcp audit --inspector-config ./mcp.json --server my-server --dry-run
```

Studio binds only to loopback. Campaign tool calls require an explicit allowlist and confirmation of
the exact reviewed campaign hash. Audit only local or user-owned targets.

Documentation, source, and deterministic demos:
[github.com/aliengineering-byte/resilireplay](https://github.com/aliengineering-byte/resilireplay)
