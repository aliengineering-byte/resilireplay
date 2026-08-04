# Known limitations

ResiliReplay v0.3.0 has these explicit boundaries:

- **Execution isolation:** reviewed commands execute directly without a shell, but ResiliReplay is not
  an OS sandbox.
- **MCP side effects:** discovery is read-only; an explicitly allowlisted and confirmed tool can still
  change server state.
- **Studio exposure:** Studio is loopback-only and assumes the local browser/user account is trusted.
  It is not a hosted multi-user service or a boundary against same-user malware.
- **Remote campaigns:** the CLI can authorize declared remote MCP targets; Studio v0.3.0 cannot.
- **Resumability:** tool-calling campaigns cannot resume after interruption because replaying side
  effects is unsafe. Rerun trace-only campaigns from deterministic inputs.
- **Causal minimization:** explicit `parentId` and `causeId` links produce the strongest minimal slice.
- **Streaming:** adapters aggregate streaming provider responses into response events; incremental
  stream semantics are not yet versioned.
- **Inspector compatibility:** stdio, Streamable HTTP, and legacy SSE configurations are supported
  within the documented subset. Interactive OAuth/keychain flows, explicit modern protocol-era
  settings, and extended Inspector-only runtime settings fail explicitly.
- **Authenticity:** SHA-256 detects artifact changes and links evidence; it does not identify the
  producer. Manifests are unsigned.
- **Redaction:** patterns are defense in depth, not proof that every application-specific secret was
  removed. Omit secrets at the source.
- **Metrics:** deterministic scoring evaluates declared evidence, not open-ended semantic quality.
  Latency, tokens, cost, side effects, and coverage remain unavailable unless measured.
- **Trace scale:** one trace is capped at 100,000 events and 32 MiB to bound memory use. Split larger
  workloads into scenarios or campaigns.
- **Distribution:** npm publishes the self-contained `resilireplay` CLI. Internal workspace packages
  are not separate public APIs.

See the [roadmap](ROADMAP.md), [security policy](../SECURITY.md), and
[Studio security](STUDIO_SECURITY.md).
