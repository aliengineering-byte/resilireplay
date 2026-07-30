# Writing custom fault scenarios

A scenario is reviewable YAML:

```yaml
schemaVersion: "1.0"
id: rate-limit-recovery
description: Back off once after the first model response is rate-limited.
seed: 42
fixture: rate-limit-recovery.fixture.jsonl
expected:
  outcome: passed
rules:
  - fault: http-429
    event: model_response
    occurrence: 1
    probability: 1
    parameters:
      retryAfterMs: 250
```

Rules run in document order. `occurrence` is one-based within matching event types. `probability` is evaluated with the scenario seed, never ambient randomness. An optional CLI `--seed` overrides the scenario seed.

Use `pnpm exec resilireplay faults` for the accepted fault names. To add a new engine fault:

1. Add its literal to `FAULT_TYPES` in `packages/core/src/faults.ts`.
2. Add a bounded mutation branch that never touches host state.
3. Add a catalog test. The suite asserts every declared fault can be applied and still produces a valid trace.
4. Document safety parameters and report meaning.

Filesystem behaviors must use `withDisposableMissingFileFixture`; never accept a host path for destructive mutation. Oversized outputs are capped at 1 MiB. Delay and timeout behavior must remain bounded.

`resilireplay test scenarios` injects each YAML scenario into its declared fixture and compares deterministic pass/fail scoring with `expected.outcome`.
