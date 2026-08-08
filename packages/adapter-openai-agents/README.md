# `@resilireplay/adapter-openai-agents`

Local reliability evidence for `@openai/agents@0.14.3` through its public provider-neutral APIs.

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

The supplied model is installed on a clone of the starting agent, and sensitive model input/output
is omitted from evidence. Stream chunks retain order, item identity, digest, and length without raw
delta text.

## Evidence boundary

- `GENUINE_RUNTIME`: Agent/Runner lifecycle, provider-neutral model calls, function tools,
  tool failure and timeout, SDK retry policy, handoffs, input guardrails, streaming and
  cancellation, trace processors, regression execution, and cleanup.
- `DOCUMENTED_ONLY`: hosted OpenAI model transport behavior.
- `UNSUPPORTED`: provider billing, quota, latency, remote retry, and server-side semantics.

Tracing remains an explicit SDK-global operation. Install `OpenAIAgentsTraceProcessor` with the
SDK's `setTraceProcessors` only when the application owns that global setting; no exporter is
installed by the adapter.
