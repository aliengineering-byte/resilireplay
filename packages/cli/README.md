# resilireplay

The self-contained ResiliReplay CLI. Turn a reviewed MCP server into deterministic recovery evidence,
an executable regression, and a pinned GitHub Action without an account or hosted service.

Requires Node.js 22 or 24.

```console
npm install --global resilireplay
resilireplay --help
```

Or run a pinned version without installing globally:

```console
npx --yes resilireplay@0.4.0 demo
```

Review an existing repository-local Inspector-compatible MCP configuration without side effects,
then create commit-ready recovery CI:

```console
npx --yes resilireplay@0.4.0 adopt --config ./mcp.json --dry-run
npx --yes resilireplay@0.4.0 adopt --config ./mcp.json
git add .resilireplay tests/resilireplay .github/workflows/resilireplay.yml
```

Or start Studio and inspect campaign commands:

```console
resilireplay studio --open
resilireplay campaign --help
```

Audit only local or user-owned MCP targets. Dry-run an existing MCP Inspector configuration before
allowing any tool calls:

```console
resilireplay mcp audit --inspector-config ./mcp.json --server my-server --dry-run
```

`adopt` searches only the current project allowlist and never trusts MCP tool annotations as
authorization. The exact tool, arguments, and one-duplicate safety boundary require review;
`--yes` cannot bypass them. Generated evidence is metadata-only and omits raw MCP bodies, headers,
and environment values. Studio binds only to loopback. ResiliReplay is not an OS sandbox.

Documentation, source, and deterministic demos:
[github.com/aliengineering-byte/resilireplay](https://github.com/aliengineering-byte/resilireplay)
