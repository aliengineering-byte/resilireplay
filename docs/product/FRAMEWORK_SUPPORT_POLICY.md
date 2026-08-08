# Framework support policy (v0.6)

Framework claims use one of four exact evidence labels:

- `GENUINE_RUNTIME`: a pinned public framework runtime executed locally and produced the behavior.
- `FIXTURE_BACKED_PROTOCOL`: protocol-shaped fixtures passed, but the named framework did not run.
- `DOCUMENTED_ONLY`: a public callback or instrumentation mapping is supplied without runtime proof.
- `UNSUPPORTED`: the behavior cannot be captured safely through the supported public boundary.

| Framework                 | v0.6 evidence             | Public boundary                                                       |
| ------------------------- | ------------------------- | --------------------------------------------------------------------- |
| LangGraph 1.4.9           | `GENUINE_RUNTIME`         | v3 event stream, tasks/updates/custom channels, checkpoint APIs       |
| OpenAI Agents SDK 0.14.3  | `GENUINE_RUNTIME`         | provider-neutral model, Runner, stream, guardrails, handoffs, tracing |
| AutoGen >=0.4 profile     | `FIXTURE_BACKED_PROTOCOL` | documented OpenTelemetry spans                                        |
| CrewAI >=0.100 profile    | `DOCUMENTED_ONLY`         | documented event-listener event types                                 |
| LlamaIndex >=0.12 profile | `DOCUMENTED_ONLY`         | documented dispatcher events and span handlers                        |

“Verified” is reserved for `GENUINE_RUNTIME`. It requires pinned deterministic execution, failure and
recovery evidence, a passing generated regression, redaction checks, and cleanup. A fixture that
resembles a vendor event cannot satisfy that definition.

Adapters must use stable public interfaces and the neutral framework-event contract. Private
monkey-patching, credential use, network inference, telemetry export, or inferred token/cost data are
outside the v0.6 release claim. Missing evidence remains unavailable rather than estimated.

The public registry, [adapter guide](../ADAPTERS.md), [framework quick starts](../FRAMEWORKS.md), and
each adapter README must preserve these labels and limitations.
