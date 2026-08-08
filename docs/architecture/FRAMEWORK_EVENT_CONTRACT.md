# Framework Event Contract v1

ResiliReplay�s contract is framework-neutral and replay-oriented. Every event is represented as a normalized envelope emitted from adapters.

## Envelope purpose

The v1 envelope is designed for deterministic replay, recovery analysis, side-effect safety, and cross-framework evidence comparison. It is not a raw proxy of any framework and never requires framework-specific data at runtime.

## Required envelope fields

- `schemaVersion`: exactly `"1.0.0"` for v1 payload schema.
- `runId`: stable identifier for one logical test run.
- `traceId`: framework/trace level identifier when available.
- `spanId`: event span identifier.
- `parentSpanId`: parent span if present.
- `sequence`: monotonic per-run sequence number (strictly increasing).
- `turnId`: logical turn identifier.
- `framework`: framework name.
- `frameworkVersion`: semantic version detected at runtime.
- `adapter`: adapter package name.
- `adapterVersion`: package version.
- `actorId`: agent/task owner identifier.
- `operation`: framework operation name.
- `boundary`: one of `framework|model|tool|transport|checkpoint|stream|state|side_effect|unknown`.
- `phase`: lifecycle phase (`start|running|error|retry|succeeded|aborted|cancelled|skipped`).
- `attempt`: retry attempt number.
- `safetyClass`: `safe|unsafe|unknown`.
- `sideEffect`: `{ id, kind, status, classification, deterministic, reversible }`.
- `payloadDigest`: deterministic canonical hash of sanitized payload.
- `redaction`: redaction metadata object (`strategy`, `fieldsRemoved`, `fieldsMasked`, `version`).
- `payload`: sanitized event payload object.
- `wallClock`: ISO-8601 timestamp of capture (non-authoritative for replay identity).

## Required event classes

- `run.start`, `run.end`, `run.error`
- `agent.start`, `agent.end`, `agent.error`
- `turn.start`, `turn.end`
- `model.request`, `model.response`, `model.error`, `model.retry`
- `tool.start`, `tool.result`, `tool.error`, `tool.timeout`, `tool.cancelled`, `tool.retry`
- `stream.chunk`, `stream.truncated`, `stream.cancelled`, `stream.completed`, `stream.outOfOrder`, `stream.duplicate`, `stream.missing`
- `handoff.requested`, `handoff.accepted`, `handoff.rejected`, `handoff.failed`, `handoff.completed`
- `checkpoint.write`, `checkpoint.read`, `checkpoint.resume`
- `interrupt`, `resume`
- `partial.completion`
- `guardrail.start`, `guardrail.pass`, `guardrail.fail`, `guardrail.error`
- `recovery.decision`, `recovery.result`
- `state.read`, `state.write`, `state.update`, `state.rollback`
- `custom` (forward-compatible passthrough payload)

## Deterministic replay requirements

- `runId`, `sequence`, causal IDs, `traceId`, and `spanId` must remain stable across replay generation.
- `wallClock` may vary by environment and is excluded from canonical replay hash input.
- Absolute local paths, PID values, hostnames, temporary directories, and process-specific timing must be stripped before hashing.

## Canonical hash policy

`payloadDigest = sha256(stableStringify(normalize(event, redaction=true, removeUnstable=true)))`

`removeUnstable` removes:

- absolute file paths
- process ids
- thread ids
- workstation/CI host names
- temporary folder names
- random request ids not tied to causal graph

`stableStringify` sorts keys and uses RFC 8785 JSON canonical form.

## Validation and migration

- Unknown schema versions are rejected by default.
- Unsupported required capabilities in an event manifest cause adapter bootstrap failure.
- Migration policy: adapters MUST declare source version and translate unknown fields into `framework.custom` while preserving unknown payload under `payload.unmapped` with redaction applied.

## Unknown / malformed input

- Reject invalid event envelopes immediately at parser boundary.
- Capture `adapter.validation.error` and emit deterministic failure state.
- All schema violations are treated as evidence-quality-blocking unless in dry-run mode.

## Canonical schemas

- `schemas/framework-event-v1.schema.json`
- `packages/core/src/contracts/v1.schema.json` (in-repo schema artifact)
