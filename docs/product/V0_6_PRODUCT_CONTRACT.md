# V0.6 Product Contract

## Positioning

ResiliReplay is not another tracer. It is an execution safety layer for AI agents and MCP systems.

### Descriptor

Chaos and recovery testing for AI agents and MCP servers.

### Positioning statement

Your framework runs the agent. ResiliReplay proves how it fails, whether it recovers safely, and whether the fix stays fixed.

## Mandatory capabilities

- Framework-neutral event contract.
- Verifiable adapters (Tier 1: LangGraph, OpenAI Agents SDK).
- Streaming-first event capture with causal chunk ordering.
- No-key, no-cloud first runs.
- Deterministic replay and regression generation.
- Campaign templates and baseline comparisons.

## Guarantees

- Backward-compatible API for v0.5.0 for non-breaking paths.
- Offline-first operation by default.
- No external keys required for default demos.
- No hidden network egress in verification mode.

## Acceptance criteria for v0.6.0

1. Event contract v1 complete and versioned.
2. LangGraph + OpenAI Agents adapters validated through pinned runtime.
3. Framework-neutral OTLP/JSONL bridge available.
4. Streaming and partial-completion evidence first-class.
5. Studio command/verification UX includes dry-run, confirmation hashes, and campaign status.
