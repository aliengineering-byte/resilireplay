# Fault Boundary Policy (v0.6)

## Design intent

Fault boundaries are where failure is injected and where resilience guarantees are measured.

## Boundary classes

1. `framework` boundary
   - Wrapper-level orchestration failures.
   - Typical faults: run abort, framework startup failure.

2. `transport` boundary
   - Model transport/network/runtime call simulation, API quota exhaustion, dropped/duplicated packets.

3. `model` boundary
   - Provider errors, malformed responses, incomplete token streams.

4. `tool` boundary
   - Tool result error, timeout, malformed output, dropped callback, duplicate execution.

5. `state` boundary
   - Checkpointing read/write integrity, resume mismatch, shared-state races.

6. `stream` boundary
   - Missing chunk, duplicate chunk, out-of-order chunk, truncated stream.

7. `side_effect` boundary
   - Side-effect ownership and duplicate prevention.

## Recovery policy

Every boundary must define:
- retry budget
- timeout policy
- whether side effects are allowed before retry
- mandatory idempotency keys
- deterministic outcome requirements

## Mandatory boundary coverage

- LangGraph and OpenAI Agents must implement `tool`, `model`, and `stream` boundaries.
- AutoGen (bridge mode) must prove `tool`, `tool.timeout`, `handoff`, `stream` coverage where available.
- CrewAI and LlamaIndex may be `documented` until stable causal hooks are proven.

## Evidence mapping

Failure evidence must map to boundary + attempt + phase + causal IDs and produce deterministic status for replay.
