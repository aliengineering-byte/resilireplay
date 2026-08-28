# Operational resilience profile

`mcp-res/operational-resilience/v1` is **PROVISIONAL**. It measures a declared workload against declared local budgets; it defines no universal latency, throughput, memory, or availability threshold.

The executable fixture records cold/warm startup, bounded concurrency, queue saturation, backpressure, overload and retry-after, timeout/partial/downstream failures, forced termination/restart, adjacent protocol revisions, deterministic disk/permission failures, malformed/oversized floods, duplicate suppression, graceful/forced shutdown, bounded soak, RSS, handles/listeners/children, and cleanup. Every injected fault is tied to `FAULT_TAXONOMY.json`; ambient failures are never relabeled deterministic injections.

The measurement report binds workload generator identity, scenario, operation mix, concurrency, duration, warmup, `performance.now` clock, min/median/p95/p99, errors by reason, peak RSS, handle snapshots, runtime, platform, architecture, and runner identity. It makes no production-capacity or statistical-confidence claim.

Recovery evidence uses precise bounded language: duplicate suppression observed, idempotency guard observed, compensation observed, or no duplicate effect observed in this bounded case. Client evidence MUST NOT claim exactly-once delivery. Retry attempt, limit, deadline, cancellation, backoff, side-effect model, safety mechanism, operation outcome, and cleanup must be mutually consistent. Lost-response, same/different idempotency key, compensation success/failure, partial transaction, and exactly-once-guard failure belong in the declared side-effect profile when applicable.

MCP-RES v0.2 retains `mcp-res-json-utf16-v1` for historical and v0.2 identity. RFC 8785 is not added as an allegedly equivalent parallel digest because the accepted integer/Unicode domain and cross-language byte agreement are already explicit; a future version may add it only with named, non-equivalent migration semantics and dedicated vectors.
