# Migrating from v0.3.x to v0.4.0

v0.4.0 is backward compatible with the v0.3.x Studio, campaign, baseline, comparison, trace,
generated-test, report, and direct MCP audit commands. Campaign and trace schema versions remain
`1.0`; existing v0.3.0/v0.3.1 run, baseline, and comparison evidence remains readable.

## New commands

- `resilireplay demo` is a zero-configuration, packaged deterministic recovery demonstration.
- `resilireplay adopt` imports the existing Inspector-compatible parser and generates a reviewed,
  commit-ready recovery setup.

No existing command is renamed. The supported Node.js versions remain 22 and 24, the license remains
Apache-2.0, and the public distribution remains the single self-contained `resilireplay` package.

## Campaign additions

MCP targets may now declare:

```yaml
allowTools: [read_fixture]
toolArguments:
  read_fixture:
    path: "{{PROJECT_ROOT}}/fixtures/public.json"
evidenceMode: metadata-only
```

`toolArguments` keys must exactly match `allowTools`. Credential-shaped values and sensitive keys are
rejected. The `{{PROJECT_ROOT}}/` prefix is expanded only to the current campaign root and cannot
escape it. `metadata-only` retains causal fault/recovery metadata and hashes while omitting raw MCP
request and result bodies from persisted evidence.

Omitting both fields preserves v0.3.x semantics and canonical campaign hashes. Existing campaigns do
not need edits.

## GitHub Action

Pin new workflows to `aliengineering-byte/resilireplay@v0.4.0`. The optional `allow-remote` input
defaults to `false`; set it only for a reviewed non-loopback target you are authorized to test. The
existing `scenarios`, `campaign`, and `campaign-confirmation-hash` inputs are unchanged.

## Rollback

Revert generated adoption files and return the Action pin or CLI version to `v0.3.1`. No data
migration, account change, hosted state, or telemetry cleanup is required.
