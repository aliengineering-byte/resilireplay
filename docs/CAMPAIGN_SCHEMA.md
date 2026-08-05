# Campaign and baseline schemas

ResiliReplay v0.5.0 accepts JSON or YAML campaign documents with the same strict runtime model. The normative machine-readable definition is [`schemas/campaign.schema.json`](../schemas/campaign.schema.json); runtime parsing additionally enforces unique target/scenario identifiers, valid target references, argument allowlist alignment, and credential-safe arguments. Existing v0.4.0 documents remain valid.

## Minimal workflow

```bash
resilireplay campaign init campaign.yml
resilireplay campaign validate campaign.yml
resilireplay campaign run campaign.yml
resilireplay campaign approve runs/campaign-id-hash --output baselines/main.json
resilireplay campaign compare runs/campaign-id-hash --baseline baselines/main.json
```

If any MCP target has a non-empty `allowTools`, validation prints the canonical SHA-256 campaign hash. Execution then requires `--confirm-tools <that-hash>`. This binds consent to the exact campaign definition instead of a mutable filename.

## Campaign 1.0

Every document starts with:

```yaml
schemaVersion: "1.0"
kind: resilireplay-campaign
id: checkout-recovery
description: Bounded MCP recovery checks.
seed: 42
```

Unknown fields and unsupported versions are rejected. Identifiers are lowercase, path-safe text. Persisted paths are repository-relative and may not contain an absolute prefix, parent traversal, or control characters.

### Budgets

`budgets` defines `concurrency` (1–8), `retries` (0–10), per-scenario timeout (100–300,000 ms), and total timeout (100–900,000 ms). Work is scheduled in declaration order and results are always stored in that order. Cancellation or a missing/invalid target produces non-passing incomplete/invalid evidence.

### Targets

- `kind: trace` references an existing sanitized JSONL trace.
- `kind: mcp` references one named server in a reviewed Inspector-shaped `mcp.json`.

MCP targets declare `allowTools`. An empty list is discovery-only. A non-empty list is the complete callable set; a returned tool outside it is never invoked. Studio additionally requires a single-use confirmation after displaying the redacted execution plan. `allowRemote` defaults to false and Studio rejects remote targets.

`toolArguments` is an optional object keyed by tool name. Every key must also appear in `allowTools`,
and each value must be an object containing the exact reviewed arguments. Sensitive keys,
credential-shaped values, and out-of-project paths fail validation. `resilireplay adopt` may persist
contained paths with a `{{PROJECT_ROOT}}/` prefix, which the campaign runner expands inside the
current repository.

`evidenceMode` is optional. `full` preserves the prior sanitized evidence behavior.
`metadata-only` removes raw MCP tool request/result bodies and retains tool names, deterministic
faults, causal links, recovery/validation events, and hashes. Omission preserves v0.3.x behavior and
campaign hashes.

### Scenarios and controls

Each scenario names a target, fault, optional deterministic seed, retry recovery mode, and assertions. `fault: none` is the negative-control form. Trace scenarios may select an event and occurrence. MCP scenarios accept the MCP fault catalog.

Assertions can require the observed pass/fail outcome, safe recovery, a recovery-latency ceiling, retry ceiling, no duplicated side effects, safety-policy compliance, and a minimum deterministic score. An assertion over unavailable evidence fails with an explicit “unavailable” reason; ResiliReplay does not synthesize a value.

`adapterEvidence` may declare non-negative input/output tokens or USD cost. Those fields appear only when supplied. They are not estimated by ResiliReplay.

### Baseline thresholds

Default gates allow no score drop, retry increase, or duplicate-side-effect increase. Recovery latency, token waste, and cost are compared only when the corresponding threshold is declared and both baseline/current evidence values exist.

## Persisted evidence

The runner writes `campaign-run.json` with:

- `kind: resilireplay-campaign-run` and `schemaVersion: "1.0"`;
- terminal `complete`, `invalid`, `cancelled`, or `incomplete` status;
- ordered scenario evidence, nullable evidence-backed metrics, target/config hash, first causal step, and generated-regression status;
- `runHash`, calculated over canonical sanitized content excluding only the hash field itself.

Baseline approval writes `kind: resilireplay-baseline`, the campaign/run hashes, explicit thresholds, and comparable scenario snapshots. Only a complete run whose declared expectations all passed can be approved.

Comparison writes `kind: resilireplay-comparison` with `pass`, `regression`, `invalid`, or `incomplete`. Campaign mismatch, target-config mismatch, missing scenario, malformed integrity hash, unavailable evidence, and incomplete execution can never become a pass. JSON, HTML, JUnit, SARIF, terminal, Markdown, and GitHub step-summary views are derived from the same comparison object.

Run output directories and approved baseline files are immutable-by-default: creation fails if the
selected path already exists. Choose a new run path or explicitly archive/remove stale local evidence
after review; ResiliReplay does not silently overwrite it.

All persisted documents reject unsupported versions rather than migrating implicitly. `TraceEvent` remains at schema 1.0 and is unchanged by this release.
