# Prepared MCP Inspector ecosystem-integration proposal

Status: prepared for human review; not posted upstream.

## Suggested upstream title

Ecosystem integration: reuse Inspector `mcp.json` configs for deterministic resilience testing

## Concise problem

MCP Inspector gives developers an excellent interactive view of server behavior and exports reusable
server configurations. Teams that want to test timeout, malformed-result, tool-error, and unsafe-
instruction recovery currently have to translate those connection details into a separate harness.
That translation can alter argument boundaries, paths, headers, or transport settings and makes the
resilience evidence harder to relate to the configuration already reviewed in Inspector.

## Why the tools are complementary

Inspector interactively connects, discovers, calls, and debugs. ResiliReplay reads the same reviewed
configuration, introduces controlled failures, scores recovery, persists sanitized evidence, and
turns a failed trace into an executable regression. It does not replace Inspector's UI, protocol
exploration, OAuth experience, or server-debugging workflow.

## Exact integration command

From a ResiliReplay source checkout after the documented frozen install and build:

```console
pnpm exec resilireplay mcp audit --inspector-config ./mcp.json --server my-server --dry-run
pnpm exec resilireplay mcp audit --inspector-config ./mcp.json --server my-server --fault mcp-tool-error --recovery retry --output runs/mcp-inspector
```

The first command prints a sanitized, value-free execution plan and makes no server call. The second
performs the authorized audit and writes resilience evidence.

## Demo and release

- Release: https://github.com/aliengineering-byte/resilireplay/releases/tag/v0.2.0
- Animated demo:
  https://github.com/aliengineering-byte/resilireplay/blob/v0.2.0/docs/assets/mcp-inspector-demo.gif
- Static fallback:
  https://github.com/aliengineering-byte/resilireplay/blob/v0.2.0/docs/assets/mcp-inspector-demo.png
- Integration guide:
  https://github.com/aliengineering-byte/resilireplay/blob/v0.2.0/docs/MCP_INSPECTOR.md

## Compatibility scope

The released importer is intentionally frozen to the reviewed MCP Inspector 2.0.0 tag at commit
`7aebf168e6277ea26b1f04a7987a1cd11328ec83`.

- Complete files use a top-level `mcpServers` object.
- One entry auto-selects; multiple entries require `--server`.
- Missing/`stdio`, `http`/`streamable-http`, and deprecated `sse` transports are recognized.
- `command`, boundary-preserving `args`, `env`, `cwd`, `url`, `headers`,
  `connectionTimeout`, and `requestTimeout` have documented interpretations.
- Interactive OAuth, `protocolEra: "modern"`, and Inspector-only extended runtime settings fail
  explicitly. No compatibility claim is made for a newer Inspector release until it is reviewed.

Compatibility means the documented export can be read. It does not imply partnership, endorsement,
upstream ownership, or certification by the MCP project.

## Security boundaries

- Configuration files are read-only and are never seeded, migrated, or rewritten.
- Stdio execution does not use a shell and preserves every argument boundary.
- Relative paths and realpaths must remain inside the allowed repository root.
- Environment and header values stay in memory and appear only as `[REDACTED]` in plans and evidence.
- URL credentials, header injection, duplicate keys, ambiguous transports, Inspector authentication
  bypass, and Inspector proxy session-token declarations fail closed.
- Non-loopback HTTP targets require explicit `--allow-remote` authorization.
- Only the reserved `reliability_probe` tool is called by default; broader calls require explicit
  review and `--call-tools`.

## Test evidence

- Integration PR: https://github.com/aliengineering-byte/resilireplay/pull/11
- PR CI: https://github.com/aliengineering-byte/resilireplay/actions/runs/30757640713
- Post-merge CI: https://github.com/aliengineering-byte/resilireplay/actions/runs/30757707076
- Tag verification: https://github.com/aliengineering-byte/resilireplay/actions/runs/30757721587

The release gate passed 48/48 tests on the repository suite. Dedicated coverage includes real stdio,
authenticated Streamable HTTP on an ephemeral loopback listener, controlled failure, malformed
responses, timeouts, spaces in paths, Windows/POSIX classification, stable exit codes, secret-output
redaction, cleanup, recovery scoring, five evidence hashes, and execution of the generated
regression. A credential-disabled public clone of `v0.2.0` independently passed frozen install, the
full quality gate, packed-install smoke, scans, and both demos.

## Duplicate search performed 2026-08-02

Searches covered open issues, all pull requests, and indexed Discussions using `mcp.json`, config
export, configuration schema, third-party integration, resilience, chaos, and ResiliReplay terms. No
direct proposal for documenting this resilience-tool integration was found. Related upstream work:

- [#1432, Inspector CLI v2](https://github.com/modelcontextprotocol/inspector/issues/1432) expands
  Inspector's own automation surface and remains complementary.
- [#1857, Rich server configuration experience](https://github.com/modelcontextprotocol/inspector/issues/1857)
  concerns Inspector configuration UX.
- [#1034, MCP Server Interface Diff Tool](https://github.com/modelcontextprotocol/inspector/issues/1034)
  concerns interface change comparison, not runtime fault recovery.
- [PR #1511, import client configs and registry server.json](https://github.com/modelcontextprotocol/inspector/pull/1511)
  broadens Inspector input compatibility.
- [MCP Discussion #2547](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/2547)
  discusses a future standard client configuration and secret handling; ResiliReplay's released
  compatibility remains narrowly tied to the reviewed Inspector export.

If this message is posted later, re-run the duplicate search immediately beforehand and link or join
any newer canonical thread.

## Short human-editable message

> MCP Inspector's exported `mcp.json` is now directly reusable by ResiliReplay v0.2.0 for authorized,
> deterministic resilience audits. Inspector remains the interactive debugging experience;
> ResiliReplay adds controlled failure, recovery scoring, sanitized evidence, and executable
> regression generation. Would maintainers be open to a short ecosystem/docs mention of this
> complementary workflow? The integration is read-only, has real stdio and authenticated Streamable
> HTTP coverage, and does not require any Inspector code or schema change.

## Upstream change requirement

No upstream code change is required. At most, a maintainer-approved Discussion or documentation
reference could make the optional ecosystem workflow discoverable. This file is preparation only and
must not be posted without separate user authorization.
