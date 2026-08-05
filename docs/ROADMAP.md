# Roadmap

## Shipped in v0.4.0

- Zero-configuration packaged recovery demo with stable canonical evidence and executable regression.
- Reviewed project-local adoption from Inspector-compatible MCP configuration to a deterministic
  campaign, metadata-only evidence, regression, baseline instructions, and pinned Action workflow.
- Exact per-tool campaign argument fixtures, project-root path expansion, and metadata-only MCP
  evidence mode without changing v0.3.x defaults.
- Explicit stdio/HTTP target, tool, argument, retry-safety, symlink, credential, and dry-run boundaries.

## Shipped in v0.3.0

- Loopback Studio over the shared engine.
- Strict deterministic campaigns with bounded parallelism and explicit expectations.
- Approved baselines, fail-closed CI comparison, and multi-format evidence.
- Inspector-shaped stdio and Streamable HTTP fixture workflow with causal regression export.

## Plausible next work

- OpenTelemetry trace import/export without changing the deterministic core contract.
- First-party framework adapters chosen from real user demand, with truthful evidence availability.
- Richer causal minimization for concurrent branches and explicit distributed trace links.
- Incremental stream-event semantics in a backward-compatible trace schema.
- Signed local attestations for report bundles and provenance verification.
- Stronger remote-target ownership verification; current CLI/Action acknowledgement remains an
  explicit user assertion and Studio remains loopback-only.
- Optional GitHub Pages documentation and portable evidence browsing.
- Optional non-authoritative natural-language explanations that never affect scoring.

Accounts, teams, hosted storage, telemetry, autonomous Internet discovery, destructive host fault
injection, universal certification, arbitrary browser command execution, and automatic provider
fallback are not implied by this roadmap.
