# Known limitations

ResiliReplay v0.2.0 is useful for deterministic local and CI testing, with these boundaries:

- **Transport coverage:** stdio and authenticated Streamable HTTP MCP behavior are exercised end to end. Legacy SSE is retained for compatibility and has less integration coverage.
- **Execution isolation:** `record` launches only the command a user explicitly supplies, without a shell, but it is not an OS sandbox. Use a container or OS sandbox for untrusted code.
- **MCP side effects:** discovery is read-only, but `reliability_probe` and calls authorized with `--call-tools` can execute server behavior. Review targets and schemas first.
- **Causal minimization:** traces with explicit `parentId` and `causeId` produce the strongest minimal slice. Unstructured traces retain fault, validation, recovery, and terminal evidence conservatively.
- **Streaming:** current adapters aggregate a streaming provider response into one event. Incremental stream-event semantics are not yet versioned.
- **Inspector protocol era:** Inspector 2.0.0 config imports support its default legacy era. Explicit `auto` and `modern` protocol-era settings are rejected until ResiliReplay adopts the v2 wire SDK.
- **Inspector OAuth and extended settings:** OAuth, roots, request metadata, modern logging, tasks, pagination, advertised extensions, and fetch-retention settings are rejected rather than ignored.
- **Authenticity:** SHA-256 hashes link traces, metrics, reports, and generated tests. They detect changes but do not establish who produced an artifact; manifests are unsigned.
- **Redaction:** pattern-based redaction is defense in depth, not a proof that every application-specific secret format is removed. Adapters should omit secrets at the source.
- **Scoring:** the deterministic score evaluates declared trace evidence and safety rules. It is not a semantic judge of open-ended answer quality.
- **Distribution:** packages are not published to npm. Use the repository checkout and workspace scripts.

See the [roadmap](ROADMAP.md) and [security policy](../SECURITY.md) for residual risk.
