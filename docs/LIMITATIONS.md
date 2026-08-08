# Known limitations

ResiliReplay v0.6.0 has these explicit boundaries:

- **Agent evidence scope:** agent hooks preserve normalized outcomes, classifications, summaries, and hashes. They
  cannot reconstruct prompts, transcripts, tool bodies, environment values, or personal paths.
- **Hook authenticity:** vendor hook payloads are trusted as local observations, not cryptographically attested facts.
- **Live verification:** Claude Code and Codex have official installation plus installed-runtime fixture evidence, not
  model-authenticated live turns. Hermes has installation, skill, and MCP evidence without a model flow.
- **Hermes capture:** Hermes uses the portable skill and ResiliReplay MCP server. Native passive hook capture is not
  claimed for Hermes v0.6.0.
- **Hosted tools:** Codex hosted tools do not emit the supported local PostToolUse surface and are ignored.
- **Connection scope:** Claude and Codex direct hooks use repository-local configuration. Hermes’ official MCP command
  writes its configured `HERMES_HOME`; review and back that configuration up before using the documented command.
- **Public MCP directory:** the shipped default is local stdio. ResiliReplay does not operate a public HTTPS MCP
  service, so the OpenAI directory submission is skills-only where the portal permits it.
- **Hugging Face MCP:** the public static demo has no arbitrary command execution and is not advertised as an MCP
  endpoint. Community MCP Spaces can require a user HF token.

- **Execution isolation:** reviewed commands execute directly without a shell, but ResiliReplay is not
  an OS sandbox.
- **MCP side effects:** discovery is read-only; an explicitly allowlisted and confirmed tool can still
  change server state.
- **Studio exposure:** Studio is loopback-only and assumes the local browser/user account is trusted.
  It is not a hosted multi-user service or a boundary against same-user malware.
- **Remote campaigns:** the CLI and Action can explicitly authorize declared remote MCP targets;
  Studio cannot. Authorization is asserted by the user and is not independently proven.
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
- **Metadata-only evidence:** adoption omits raw MCP request/result bodies, so it cannot make semantic
  assertions about private output content. It preserves failure/recovery metadata and integrity
  hashes, not a recoverable copy of the body.
- **Adoption safety:** annotations are untrusted hints. A user must still determine that the exact
  operation and arguments are safe and suitable for one duplicate attempt.
- **Metrics:** deterministic scoring evaluates declared evidence, not open-ended semantic quality.
  Latency, tokens, cost, side effects, and coverage remain unavailable unless measured.
- **Trace scale:** one trace is capped at 100,000 events and 32 MiB to bound memory use. Split larger
  workloads into scenarios or campaigns.
- **Distribution:** npm publishes the self-contained `resilireplay` CLI. Internal workspace packages
  are not separate public APIs.

See the [roadmap](ROADMAP.md), [security policy](../SECURITY.md), and
[Studio security](STUDIO_SECURITY.md).
