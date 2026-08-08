# Framework adapters

Framework adapters translate public runtime, telemetry, or callback events into
`resilireplay.framework-event/v1`. They do not change deterministic fault injection, recovery
scoring, or regression compilation.

## v0.6 support

| Framework         | Tested version or range      | Integration                                                          | Evidence                  | Boundary                                                                           |
| ----------------- | ---------------------------- | -------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------- |
| LangGraph         | `@langchain/langgraph@1.4.9` | Native event stream                                                  | `GENUINE_RUNTIME`         | Local graph, tool, retry, timeout, stream, interrupt/resume, and subgraph behavior |
| OpenAI Agents SDK | `@openai/agents@0.14.3`      | Public `Model`, runner, stream, guardrail, handoff, and tracing APIs | `GENUINE_RUNTIME`         | Deterministic local/no-key model; hosted provider behavior is not claimed          |
| AutoGen           | `>=0.4` protocol profile     | Neutral OTLP bridge                                                  | `FIXTURE_BACKED_PROTOCOL` | Compatible OTLP spans are verified; no AutoGen runtime was executed                |
| CrewAI            | `>=0.100` profile            | Public event-listener names                                          | `DOCUMENTED_ONLY`         | Stable callback mapping is supplied, but no CrewAI runtime claim is made           |
| LlamaIndex        | `>=0.12` profile             | Public instrumentation names                                         | `DOCUMENTED_ONLY`         | Stable callback/span mapping is supplied, but no LlamaIndex runtime claim is made  |

These exact evidence labels are part of the adapter registry. Fixture-shaped events never become a
runtime-verification claim.

## Registry and doctor

```console
resilireplay adapter list
resilireplay adapter detect --package @langchain/langgraph
resilireplay adapter detect --framework openai-agents
resilireplay adapter doctor autogen
```

Detection is deterministic and advisory. An explicit framework override wins, and an unknown
framework fails without silently selecting a generic adapter. Runtime factories are registered by
the application; registry detection never dynamically executes a detected package.

See the [framework quick starts](FRAMEWORKS.md), [support policy](product/FRAMEWORK_SUPPORT_POLICY.md),
and the [neutral adapter contract](ADAPTER_CONTRACT.md).
