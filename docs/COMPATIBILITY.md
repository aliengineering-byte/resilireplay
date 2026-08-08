# Compatibility evidence

Evidence levels are release-scoped:

Framework adapters use the stricter labels `GENUINE_RUNTIME`, `FIXTURE_BACKED_PROTOCOL`,
`DOCUMENTED_ONLY`, and `UNSUPPORTED`; these prevent protocol fixtures from being described as a
framework runtime. Coding-agent/plugin evidence below retains its established installation/live
labels.

| Framework         | Version/profile | Framework evidence        | Verified boundary                                                                                |
| ----------------- | --------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| LangGraph         | 1.4.9           | `GENUINE_RUNTIME`         | Pinned local graph and tool execution, recovery, streaming, checkpoints, regression              |
| OpenAI Agents SDK | 0.14.3          | `GENUINE_RUNTIME`         | Pinned public SDK with deterministic local/no-key model, handoff, guardrail, tracing, regression |
| AutoGen           | >=0.4 profile   | `FIXTURE_BACKED_PROTOCOL` | OTLP-compatible fixture only                                                                     |
| CrewAI            | >=0.100 profile | `DOCUMENTED_ONLY`         | Public event-listener mapper only                                                                |
| LlamaIndex        | >=0.12 profile  | `DOCUMENTED_ONLY`         | Public instrumentation mapper only                                                               |

See [framework quick starts](FRAMEWORKS.md) for exact limitations.

- **LIVE VERIFIED:** a real client or protocol implementation emitted/consumed the event and the intended result passed.
- **FIXTURE VERIFIED:** official payload-shaped synthetic fixtures passed the adapter, privacy, and regression suite.
- **INSTALLATION VERIFIED:** an isolated official installer/configuration path and discovery check passed without a live model flow.
- **DOCUMENTED ONLY:** instructions or a portable format exist but no release runtime gate passed.
- **UNSUPPORTED:** the integration is intentionally unavailable or incompatible.

| Surface                    | Version tested                                             | Evidence                        | What passed                                                                                                                           | Not claimed                                 |
| -------------------------- | ---------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Claude Code                | 2.1.222                                                    | INSTALLATION + FIXTURE VERIFIED | Official `plugin validate`, isolated local marketplace install, installed stable-hook adapter, controlled failure, passing regression | Live model-authenticated turn               |
| OpenAI Codex CLI           | 0.146.1                                                    | INSTALLATION + FIXTURE VERIFIED | Isolated repo marketplace install/list, installed documented `PostToolUse` adapter, controlled failure, passing regression            | Live model-authenticated turn; hosted tools |
| Hermes Agent               | 0.20.0 / commit `d1f9e77755b019e3f02a5597c6c7335868cf3ae4` | INSTALLATION VERIFIED           | Isolated editable install, local skill discovery, MCP registration, 9-tool discovery in 578 ms                                        | Model flow; passive native hook capture     |
| MCP TypeScript SDK         | 1.30.0                                                     | LIVE VERIFIED                   | Stdio discovery, annotated tool calls, ResiliReplay self-audit                                                                        | Remote hosting                              |
| Agent Skills reference     | commit `217be548739f21d6008915c29aefe320ea1a90af`          | LIVE VERIFIED                   | Official `skills-ref validate`                                                                                                        | Every consuming client                      |
| Generic adapter            | v1 contract                                                | FIXTURE VERIFIED                | Golden output, classification, redaction, bounds, containment, concurrent determinism                                                 | Vendor payload stability                    |
| Cursor                     | current docs only                                          | DOCUMENTED ONLY                 | Candidate adapter issue                                                                                                               | Runtime compatibility                       |
| Gemini CLI                 | current docs only                                          | DOCUMENTED ONLY                 | Candidate adapter issue                                                                                                               | Runtime compatibility                       |
| OpenCode                   | current docs only                                          | DOCUMENTED ONLY                 | Candidate adapter issue                                                                                                               | Runtime compatibility                       |
| Goose                      | current docs only                                          | DOCUMENTED ONLY                 | Candidate adapter issue                                                                                                               | Runtime compatibility                       |
| VS Code agent integrations | format-level only                                          | DOCUMENTED ONLY                 | Portable skill package                                                                                                                | Specific extension runtime                  |

The Claude and Codex fixture checks use stable documented hook shapes through installed cache copies. No existing user credentials or active configuration were read or copied. Hermes had no safe configured local model, so its honest ceiling is installation/MCP verification. Vendor names imply no endorsement.
