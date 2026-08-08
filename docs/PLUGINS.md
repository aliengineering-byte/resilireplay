# Agent plugin operations

## Trust boundary

Installing either plugin registers local commands and an MCP server. Review `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `.mcp.json`, and `hooks/` before trusting the package. Installation alone does not arm capture. Hooks accept JSON from stdin, emit no stdout, and call one bundled runtime produced from `@resilireplay/agent`.

The immutable runtime is resolved through `PLUGIN_ROOT` or `CLAUDE_PLUGIN_ROOT`. Vendor-owned writable paths use `PLUGIN_DATA` or `CLAUDE_PLUGIN_DATA`; capture artifacts remain in the current repository. Compatibility environment names are handled only in the shared adapter launcher.

## Claude Code

```text
/plugin marketplace add aliengineering-byte/resilireplay
/plugin install resilireplay@resilireplay
```

Upgrade the marketplace before reinstalling a new version. Remove the plugin with Claude Code’s plugin manager; remove the marketplace only if no other entry is needed. Plugin removal does not delete repository evidence. Use `resilireplay connect --rollback` for direct connection files.

## Codex

```console
codex plugin marketplace add aliengineering-byte/resilireplay
codex plugin add resilireplay@resilireplay
codex plugin list --json
```

Remove with `codex plugin remove resilireplay@resilireplay --json`. The repo marketplace is `.agents/plugins/marketplace.json` and the plugin manifest is `.codex-plugin/plugin.json`.

## Direct connection backup

`resilireplay connect` previews SHA-256 before/after values, preserves existing JSON keys, and writes a private repository-local backup beneath `.resilireplay/backups/`. This directory is gitignored. Restore the latest backup with:

```console
resilireplay connect --rollback
```

Backups may contain the original configuration bytes required for exact recovery. They are mode-restricted where the OS supports it, never printed, and must not be committed or shared.

## Hermes Agent

`resilireplay connect --agent hermes` stages the portable skill under `.agents/skills` and a
reviewable `.mcp.json`; it deliberately does not edit `~/.hermes`. Hermes 0.20.0 does not
auto-discover those repository files. After reviewing the staged command, register the MCP server
through Hermes's supported interface:

```console
hermes mcp add resilireplay --command npx --args --yes resilireplay@0.6.0 mcp serve
hermes mcp test resilireplay
```

Install/copy the staged skill into the active Hermes profile's `skills/` directory through the
profile's normal reviewed workflow, then reload skills. Use `hermes mcp remove resilireplay` to
remove the MCP registration. ResiliReplay's direct rollback removes only repository-local staged
files; Hermes profile changes remain under Hermes's own backup/removal controls.

## Clean capture removal

Stop capture first. Repository evidence is intentionally retained because removal without review is destructive. Delete `.resilireplay/capture` only through the user’s normal recovery-aware workflow after deciding the evidence is no longer needed. No background process or listener is installed.
