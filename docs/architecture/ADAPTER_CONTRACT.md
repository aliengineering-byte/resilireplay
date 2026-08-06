# Adapter Contract v1 (v0.6)

## Adapter lifecycle

All adapters MUST implement:

1. `detectRuntime(environment) -> DetectionResult`
2. `capabilityManifest() -> CapabilityManifest`
3. `startCapture(config, context) -> CaptureHandle`
4. `declareFaultBoundary(config) -> FaultBoundary[]`
5. `injectFault(target, fault) -> void`
6. `stopCapture(handle) -> void`
7. `replay(run, trace) -> ReplayReport`
7. `generateRegression(failure, templates) -> RegressionPack`
8. `sanitize(payload) -> SanitizedPayload`
9. `cleanup(handle) -> void`
10. `doctor() -> HealthCheck`

## Capability levels

- `verified`: executable acceptance suite with real runtime fixture passes.
- `supported`: stable public API is available and smoke-tested.
- `experimental`: provisional implementation with documented limitations.
- `documented`: API documented but no runtime smoke coverage yet.
- `unsupported`: not implemented / cannot be implemented safely.

## Machine-readable manifest

Manifest fields:
- `adapterName`
- `adapterVersion`
- `framework`
- `frameworkVersionRange`
- `detection`
- `lifecycleCoverage`
- `support`
- `events`
- `limitations`
- `limitationsHash`
- `createdAt`
- `evidence`

`support` must include all mandatory event classes used by the framework contract.

## Fault boundaries

Adapters MUST declare where failures are injected (boundary enum):
- `wrapper`
- `transport`
- `model`
- `tool`
- `stream`
- `checkpoint`

Each boundary declares recoverability guarantees (`retryable`, `nonRetryable`, `requiresManualCleanup`, `idempotencyRequired`).

## Replay and regression

- Replay uses stored run bundles only.
- Re-run evidence must be produced with same adapter and declared runtime constraints.
- Generated regression artifacts are versioned (`regressionId`, `createdAt`, `sha256`).

## Python/other runtime bridge

A JSONL/OTLP ingest bridge is required for non-TypeScript runtimes. It must publish envelopes compliant with this contract and must reject unsafe/invalid schema values.
