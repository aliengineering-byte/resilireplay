# Framework quick starts

ResiliReplay v0.6 keeps framework capture local and provider-neutral. Build once, then run the
one-command framework demo:

```console
pnpm install --frozen-lockfile
pnpm build
pnpm demo:frameworks
```

The demo exercises deterministic registry detection, an AutoGen-compatible OTLP fixture, a
documented CrewAI callback mapping, redaction, and the disabled-by-default semantic advisor. It uses
no API key, hosted inference, telemetry exporter, or network model call.

## LangGraph 1.4.9

```ts
import { createLangGraphAdapter } from "@resilireplay/adapter-langgraph";

const capture = await createLangGraphAdapter().captureProtocolStream(
  graph.streamEvents(input, { version: "v3", streamMode: ["tasks", "updates"] }),
  {
    runId: "run-1",
    traceId: "trace-1",
    turnId: "turn-1",
    actorId: "graph",
    evidenceClass: "GENUINE_RUNTIME",
  },
);
```

The release checkpoint executes real local graphs for lifecycle, tools, retry, timeout, ordered
streaming, interrupt/resume, nested identity, redaction, replay, and regression generation.

## OpenAI Agents SDK 0.14.3

```ts
import { Agent } from "@openai/agents";
import {
  ScriptedModel,
  createOpenAIAgentsAdapter,
  textResponse,
} from "@resilireplay/adapter-openai-agents";

const model = new ScriptedModel([textResponse("offline result")]);
const agent = new Agent({ name: "offline", instructions: "Stay deterministic." });
const capture = await createOpenAIAgentsAdapter().captureRun({
  agent,
  input: "run locally",
  model,
  context: {
    runId: "run-1",
    traceId: "trace-1",
    turnId: "turn-1",
    evidenceClass: "GENUINE_RUNTIME",
  },
});
```

`ScriptedModel` implements the SDK's public provider-neutral model interface. Hosted OpenAI behavior,
billing, quota, and remote retries remain outside this no-key claim.

## AutoGen OTLP bridge

AutoGen documents native OpenTelemetry traces for runtimes, agents, and tools. Send compatible OTLP
JSON through `@resilireplay/otel-bridge`; v0.6 verifies that protocol path with fixtures and labels it
`FIXTURE_BACKED_PROTOCOL`, not runtime verified. See the
[AutoGen telemetry documentation](https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/framework/telemetry.html).

## CrewAI callbacks

Feed public event-listener events such as `CrewKickoffStartedEvent`, `AgentExecutionCompletedEvent`,
and `ToolUsageErrorEvent` to `normalizeDocumentedCallbackEvent`. The mapping is
`DOCUMENTED_ONLY`; see the [CrewAI event-listener documentation](https://docs.crewai.com/en/concepts/event-listener).

## LlamaIndex instrumentation

Feed public dispatcher/instrumentation events and span lifecycle callbacks to
`normalizeDocumentedCallbackEvent`. The mapping is `DOCUMENTED_ONLY`; see the
[LlamaIndex instrumentation documentation](https://developers.llamaindex.ai/python/framework/module_guides/observability/instrumentation/).

## Deterministic comparison

Framework events retain run, trace, turn, actor, span, parent, and causal identity. Campaign baselines
remain versioned and hash-verified:

```console
resilireplay campaign approve runs/candidate --output baselines/main.json
resilireplay campaign compare runs/current --baseline baselines/main.json
```

An optional semantic advisor can annotate evidence, but it is disabled by default and cannot replace
or override the deterministic policy status.
