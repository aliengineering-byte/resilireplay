# Adapter guide

Adapters translate framework/provider callbacks into the common event model. They do not implement scoring.

```ts
import { createEvent } from "@resilireplay/core";

const event = createEvent({
  runId,
  sequence,
  type: "model_response",
  actor: "planner",
  model: providerResponse.model,
  metadata: {
    inputTokens: providerResponse.usage?.prompt_tokens ?? 0,
    outputTokens: providerResponse.usage?.completion_tokens ?? 0,
  },
  payload: providerResponse.choices[0]?.message,
});
```

Emit the original causal order. Set `parentId` for structural ownership and `causeId` for the event that directly caused this event. Tool and model identity belong in the dedicated fields, not only in payloads.

Never place authorization headers, cookies, credentials, or raw environment variables in payload or metadata. `createEvent` performs defense-in-depth redaction, but adapters should omit secrets at the source.

For streaming, emit one `model_response` after deterministic aggregation in v0.2.0. Record provider usage metadata only when it exists; missing token data is reported as unavailable rather than estimated.

The OpenAI-compatible example is a translation function and does not make a network call. Other providers should wrap the same model without changing core schemas.
