# Competitive Positioning

ResiliReplay complements, not replaces, existing agent observability tools.

| Tool          | Relationship                    | What ResiliReplay adds                                                       |
| ------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| MCP Inspector | Runtime visibility              | Causal failure/recovery scenarios and regression generation                  |
| Promptfoo     | Prompt regression               | Deterministic failure-injection and side-effect-safe replay                  |
| LangSmith     | Tracing and evaluation          | Framework neutrality across multiple runtimes + structured recovery evidence |
| Phoenix       | Observatory and traces          | Failure boundary assertions and policy gates                                 |
| Braintrust    | Evaluation and workflow quality | Deterministic-first replay and duplicate-side-effect controls                |

## Differentiation principles

1. Every evidence claim is replayable offline.
2. Deterministic safety policy is primary; semantic scoring is advisory.
3. Framework neutrality is enforced by adapter contracts and event semantics.
4. Recovery is as important as detection; no-fail no-regression is not enough.

## Non-goals

- Replacing framework trace UIs.
- Operating as a hosted SaaS.
- Collecting telemetry beyond local evidence stores.
