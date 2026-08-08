# v0.6.0 LangGraph checkpoint

Verified locally against the pinned public package `@langchain/langgraph@1.4.9` with no API key, hosted inference, or network model.

## Executed evidence

| Scenario                                                                      | Classification            |
| ----------------------------------------------------------------------------- | ------------------------- |
| Clean graph and real node lifecycle                                           | `GENUINE_RUNTIME`         |
| Real `ToolNode` start and result identity                                     | `GENUINE_RUNTIME`         |
| Controlled tool error                                                         | `GENUINE_RUNTIME`         |
| Exactly one bounded retry and recovery                                        | `GENUINE_RUNTIME`         |
| Public node timeout boundary                                                  | `GENUINE_RUNTIME`         |
| Ordered custom chunks and secret redaction                                    | `GENUINE_RUNTIME`         |
| `MemorySaver` interrupt/resume without duplicated side effects                | `GENUINE_RUNTIME`         |
| Nested graph namespace and parent-span identity                               | `GENUINE_RUNTIME`         |
| Malformed `tool-finished` payload                                             | `FIXTURE_BACKED_PROTOCOL` |
| Stable bounded replay comparison                                              | `GENUINE_RUNTIME`         |
| Regression generated from a real failed graph and executed with `node --test` | `GENUINE_RUNTIME`         |
| Adapter cleanup and process-listener invariance                               | `GENUINE_RUNTIME`         |
| Remote LangGraph Platform transports                                          | `DOCUMENTED_ONLY`         |
| Provider-backed model semantics                                               | `UNSUPPORTED`             |

## Commands

```powershell
pnpm --filter @resilireplay/adapter-langgraph typecheck
pnpm exec vitest run packages/adapter-langgraph/src/adapter-langgraph.test.ts
```

Current result: 1 test file passed; 12 tests passed. The regression scenario created a temporary artifact from genuine runtime failure evidence and successfully executed its generated Node test before removing only its isolated temporary directory.
