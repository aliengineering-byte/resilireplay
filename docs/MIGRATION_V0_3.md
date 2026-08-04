# Migrating to v0.3.0

v0.3.0 is backward compatible with v0.2.1 trace, replay, report, generated-test, and direct MCP audit
workflows. It adds Studio, campaigns, and baseline documents; it does not change `TraceEvent` schema
`1.0`.

## Package and runtime

Upgrade the supported CLI and keep Node.js 22 or 24:

```console
npm install --global resilireplay@0.3.0
resilireplay --version
```

The npm package remains self-contained and has no runtime dependency on unpublished workspace
packages.

## Move repeated commands into a campaign

Generate a strict template with `resilireplay campaign init campaign.yml`, then declare targets,
budgets, scenarios, expectations, and comparison thresholds. Existing Inspector-shaped config files
are read, never migrated or overwritten.

Direct `mcp audit` preserves its legacy behavior of calling a tool named `reliability_probe` by
default. Campaigns intentionally differ: `allowTools: []` means discovery-only. A non-empty allowlist
requires confirmation of the exact hash printed by `campaign validate` or Studio review.

## Baselines

Baselines are new persisted schema `1.0` documents. Create them only from complete expectation-passing
campaign runs:

```console
resilireplay campaign approve runs/campaign --output baselines/campaign.json
resilireplay campaign compare runs/campaign --baseline baselines/campaign.json
```

Do not hand-edit hashes. A changed campaign identity, malformed evidence, missing scenario, cancelled
run, or unsupported schema fails closed. Re-approve intentionally after reviewing a legitimate
behavior or threshold change.

## CI

Existing `scenarios` input for the composite action remains supported. The new `campaign` input runs a
campaign and writes the shared Markdown summary. Tool-calling campaigns additionally require the
reviewed `campaign-confirmation-hash` input; discovery-only campaigns do not.

Stable campaign exit codes occupy 20–24 for invalid schema, target authorization, execution,
cancelled/incomplete, and integrity failures. Existing MCP exit codes are unchanged.
