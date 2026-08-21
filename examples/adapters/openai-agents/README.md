# Offline OpenAI Agents SDK adapter

This example normalizes a bounded, already-captured subset of
`@openai/agents@0.14.3` events into the ResiliReplay agent-event contract. It is intentionally
offline: it does not import or execute the SDK, call an API, inspect credentials, execute tools,
start a run, trigger a handoff, retry, or persist raw prompts, transcripts, or tool bodies.

## Capture envelope

The adapter accepts JSON shaped like this:

```json
{
  "sdk": "@openai/agents",
  "sdk_version": "0.14.3",
  "run_id": "run-123",
  "session_id": "session-123",
  "events": [
    {
      "type": "run_item_stream_event",
      "name": "tool_output",
      "runId": "run-123",
      "item": {
        "type": "tool_call_output_item",
        "rawItem": {
          "type": "function_call_result",
          "name": "lookup_fixture",
          "callId": "call-123",
          "status": "completed",
          "output": "fixture-only"
        },
        "output": "fixture-only",
        "executionStatus": "executed"
      }
    }
  ]
}
```

Supported records are:

- `run_item_stream_event` with `tool_output` or the bounded `tool_error` capture marker;
- `run_item_stream_event` with `handoff_requested` or `handoff_occurred`;
- a completion record with `type` `run_completed`, `run_failed`, or `run_cancelled`.

When a capture contains interleaved runs, `run_id` selects the matching event. Repeated delivery
is deterministic because the first matching record is normalized and unknown fields are ignored.
Tool arguments and outputs are passed only to the canonicalizer for hashing; they are never copied
into the canonical event. Latency and usage are omitted unless the capture explicitly provides a
bounded duration field.

## Verification

From the repository root:

```console
resilireplay adapter verify examples/adapters/openai-agents
```

The checked-in evidence is `FIXTURE VERIFIED` only. It is not a live-client compatibility claim,
security certification, endorsement, or support for undocumented SDK payloads.
