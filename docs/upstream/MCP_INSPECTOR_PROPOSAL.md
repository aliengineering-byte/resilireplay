# Prepared MCP Inspector feature request

Status: published upstream as [MCP Inspector issue #1912](https://github.com/modelcontextprotocol/inspector/issues/1912).

## Suggested title

Document read-only `mcp.json` interoperability for external reliability tooling

## Which client does this request relate to?

All / shared configuration documentation.

## Problem

Inspector 2.0.0 documents a familiar top-level `mcpServers` configuration shape plus
Inspector-specific settings. External reliability tools can consume that connection information,
but users currently have to discover the interoperability boundary independently or copy the same
configuration into another format. Copying can change argument boundaries, paths, headers, or
transport selection, and can expose secrets if a tool treats the file as ordinary report data.

This was validated downstream against the exact published Inspector 2.0.0 tag at commit
`7aebf168e6277ea26b1f04a7987a1cd11328ec83`. The documented base shape is also present on
`v2/main` at `07a2b4bdfda06087cbdf8863d990a0c32f8009c3` as of 2026-08-03. The validation does not
claim that Inspector owns or supports third-party importers.

## Proposed solution

Add a short, implementation-neutral note to `docs/mcp-server-configuration.md` stating that
read-only use by external tools is a valid interoperability use case when those tools:

- preserve stdio argument boundaries and do not rewrite the configuration;
- handle or explicitly reject unknown Inspector-specific settings;
- avoid copying credential values into logs, evidence, or generated files; and
- document their own compatibility scope without implying Inspector or MCP endorsement.

No Inspector code, schema, dependency, or UI change is requested.

Possible neutral wording:

> External tools may read an Inspector `mcp.json` to reuse reviewed server connection details. Such
> tools should treat the file as read-only, preserve command argument boundaries, avoid exposing
> environment or header values, and explicitly document which Inspector-specific settings they
> support. Compatibility with an external tool does not imply endorsement by Inspector or the MCP
> project.

## Concrete downstream evidence

The independent ResiliReplay project has a published read-only importer. A value-free dry run makes
no server connection:

```console
npx --yes resilireplay@0.2.1 mcp audit --inspector-config ./mcp.json --server my-server --dry-run
```

After reviewing that plan, a user can explicitly authorize a controlled audit:

```console
npx --yes resilireplay@0.2.1 mcp audit --inspector-config ./mcp.json --server my-server --fault mcp-tool-error --recovery retry --output runs/mcp-inspector
```

Public references:

- Package: https://www.npmjs.com/package/resilireplay
- Release: https://github.com/aliengineering-byte/resilireplay/releases/tag/v0.2.1
- Integration guide: https://github.com/aliengineering-byte/resilireplay/blob/v0.2.1/docs/MCP_INSPECTOR.md
- Release verification: https://github.com/aliengineering-byte/resilireplay/actions/runs/30830557559

The published `0.2.1` package was also installed from the public registry without credentials and
used against Inspector-shaped resilient and intentionally vulnerable fixtures from the reviewed
configuration format. The resilient audit passed; the intentionally vulnerable audit produced the
expected prompt-injection and canary-exposure findings; and a seeded MCP tool error recovered by
retry. These are downstream results, not an Inspector conformance claim.

## Compatibility and security boundaries

The demonstrated importer recognizes the documented top-level `mcpServers` object and documented
stdio, HTTP/Streamable HTTP, and deprecated SSE connection fields. It explicitly rejects unsupported
Inspector-only runtime settings rather than silently changing their meaning.

The downstream safety boundary is intentionally narrow:

- configuration files are never migrated, seeded, or rewritten;
- stdio commands are launched without a shell and keep argument boundaries intact;
- environment and header values are redacted from plans and evidence;
- non-loopback HTTP targets require explicit authorization;
- tool calls can have side effects and therefore require review; and
- compatibility is pinned to a reviewed Inspector release until revalidated.

Fault injection, recovery scoring, evidence storage, regression generation, and importer maintenance
remain downstream responsibilities.

## Alternatives considered

1. Keep this guidance only in each downstream tool. This requires every user and tool author to
   rediscover the same safety boundary.
2. Wait for a canonical, versioned MCP client-configuration schema or export format. That would be a
   larger cross-project effort and is not required for this documentation-only clarification.

## Duplicate search performed 2026-08-03

Open and closed issues and pull requests were searched for `ResiliReplay`, resilience/fault/chaos
testing, deterministic regression, configuration export/import, external tooling, and plugins. No
direct request for this documentation clarification was found. The closest related work is:

- [#1432, Inspector CLI v2](https://github.com/modelcontextprotocol/inspector/issues/1432), which
  concerns Inspector's own automation surface;
- [#1857, Rich server configuration experience](https://github.com/modelcontextprotocol/inspector/issues/1857),
  which concerns Inspector configuration UX;
- [#1346, Export current server list as a JSON download](https://github.com/modelcontextprotocol/inspector/issues/1346)
  and its implementation [PR #1351](https://github.com/modelcontextprotocol/inspector/pull/1351),
  which concern Inspector-produced configuration downloads;
- [#1034, MCP Server Interface Diff Tool](https://github.com/modelcontextprotocol/inspector/issues/1034),
  which concerns interface comparison; and
- [PR #1511, import client configs and registry `server.json`](https://github.com/modelcontextprotocol/inspector/pull/1511),
  which broadened Inspector's accepted input formats.

These are related but do not cover read-only external reliability-tool interoperability or its
security boundary. Re-run this search immediately before submission and join a newer canonical issue
if one appears.

## Maintainer question

Would maintainers accept this small neutral documentation note, or do you prefer compatibility
guidance for external tooling to remain entirely downstream?
