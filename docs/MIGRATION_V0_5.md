# Migrating from v0.4.0 to v0.5.0

v0.5.0 is additive. Existing `demo`, `adopt`, Studio, campaign, record/inject/replay, trace regression, MCP audit, reports, and GitHub Action inputs remain available with the same safety confirmations and stable exit codes.

## New surfaces

- `connect --agent auto|claude-code|codex|hermes [--dry-run]`
- `connect --rollback [backup-id]`
- `capture start|status|stop|last|generate-test`
- `adapter init|verify`
- `mcp serve`
- Claude Code and Codex plugins plus one portable Agent Skill
- Four public v1 agent/capture/evidence/adapter schemas

## Data boundary

Agent capture is separate from v0.4 trace recording. It is off by default and stores only normalized metadata and hashes under `.resilireplay/capture`. It does not import old traces automatically and never changes campaign retry behavior.

## Action pin

Update workflows from `aliengineering-byte/resilireplay@v0.4.0` to `@v0.5.0` only after reviewing this release. Existing v0.4 pins remain immutable.

## Rollback

Direct connection changes have exact recoverable backups. Run `resilireplay connect --rollback`, then keep using the v0.4.0 npm or Action pin. v0.5 agent schemas use new namespaces and do not rewrite v0.4 artifacts.
