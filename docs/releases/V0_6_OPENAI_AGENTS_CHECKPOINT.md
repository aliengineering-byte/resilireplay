# OpenAI Agents SDK v0.6 checkpoint

Verified locally on 2026-08-07 with Node v24.14.0 and pinned `@openai/agents@0.14.3`.
No API key, hosted model, telemetry exporter, or network model call was used.

## Executed evidence

`pnpm --filter @resilireplay/adapter-openai-agents typecheck` passed.

`pnpm exec vitest run packages/adapter-openai-agents/src/adapter-openai-agents.test.ts` passed:
one file and 12 tests.

All 12 tests are `GENUINE_RUNTIME`: clean Agent/Runner lifecycle, tool success, controlled tool
failure, tool timeout, exactly one retry, handoff identity, guardrail tripwire, ordered redacted
stream chunks, AbortSignal cancellation, public trace/span processor mapping, executable regression
from genuine failure evidence, and cleanup with no adapter-owned state or added process listeners.

## Honest limits

- `DOCUMENTED_ONLY`: hosted OpenAI model transports.
- `UNSUPPORTED`: provider latency, billing, quota, remote retry, and server-side behavior.
- The SDK trace processor registry is global. ResiliReplay exports a processor but does not install
  it implicitly.
