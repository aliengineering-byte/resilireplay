# `@resilireplay/adapter-langgraph`

Local, no-key normalization and reliability evidence for `@langchain/langgraph@1.4.9`.

```ts
import { createLangGraphAdapter } from "@resilireplay/adapter-langgraph";

const adapter = createLangGraphAdapter();
const capture = await adapter.captureProtocolStream(
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

## Evidence classification

| Capability                      | Classification            | Evidence                                                 |
| ------------------------------- | ------------------------- | -------------------------------------------------------- |
| Graph and node lifecycle        | `GENUINE_RUNTIME`         | Compiled `StateGraph` v3 protocol stream                 |
| Tool start/result/error         | `GENUINE_RUNTIME`         | Local `ToolNode` with deterministic tools                |
| Retry and recovery              | `GENUINE_RUNTIME`         | Two-attempt public retry policy                          |
| Timeout                         | `GENUINE_RUNTIME`         | Public node timeout and `NodeTimeoutError`               |
| Stream order and redaction      | `GENUINE_RUNTIME`         | Three local custom chunks with secret-shaped input       |
| Interrupt/resume                | `GENUINE_RUNTIME`         | `MemorySaver`, `interrupt`, and `Command`                |
| Nested identity                 | `GENUINE_RUNTIME`         | Compiled child graph namespaces and parent spans         |
| Malformed tool result           | `FIXTURE_BACKED_PROTOCOL` | Invalid `tool-finished` payload rejected as `tool.error` |
| Remote hosted transports        | `DOCUMENTED_ONLY`         | Not executed in the local checkpoint                     |
| Provider-backed model semantics | `UNSUPPORTED`             | Deliberately outside this no-key adapter claim           |

The adapter owns no child processes or global listeners. `cleanup()` releases its per-run normalization state.
