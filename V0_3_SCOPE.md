# ResiliReplay v0.3.0 Scope Freeze

Status: frozen on 2026-08-04

Release title: **ResiliReplay Studio & Campaigns**

Differentiated product claim:

> MCP Inspector shows what a server does. ResiliReplay proves what happens when it fails, whether it recovers safely, and whether that recovery remains fixed.

This release is one local-first vertical slice: import a reviewed target, run a deterministic bounded fault campaign, inspect causal evidence, compare it with an approved baseline, and export a regression test. It does not add a hosted product or a second fault engine.

## Frozen epics

### 1. ResiliReplay Studio

A loopback-only `resilireplay studio` application over the shared campaign, MCP, trace, reporter, and regression APIs. The single-page workflow includes welcome/quick start, Inspector-shaped config import, reviewed target, campaign builder, live state, causal timeline, run findings, baseline comparison, regression export, and report/evidence downloads.

Required boundary: the browser may select a reviewed repository-contained config or campaign, but it may not submit an arbitrary executable plus shell text. Any tool invocation requires a non-empty allowlist and an explicit, single-use confirmation bound to the reviewed campaign hash.

### 2. Campaign specification and runner

A versioned JSON/YAML schema and CLI workflow:

```text
resilireplay campaign init [path]
resilireplay campaign run <campaign.yml>
resilireplay campaign compare <run> --baseline <baseline.json>
resilireplay campaign approve <run> --output <baseline.json>
```

Campaigns execute in stable target/scenario order with bounded concurrency, deterministic seeds, per-scenario and total deadlines, cancellation, safe tool allowlists, sanitized artifacts, and explicit expectations. A run is never resumable when it can contain tool calls; trace-only scenarios may be rerun deterministically instead of checkpointed.

### 3. Baselines and CI reliability gates

Versioned approved baselines and deterministic comparison results distinguish `pass`, `regression`, `invalid`, and `incomplete`. Missing, malformed, cancelled, mismatched-campaign, or incomplete runs can never compare as passing. Terminal, JSON, HTML, JUnit, SARIF, and GitHub step-summary evidence are emitted from the same comparison.

Stable campaign exit codes:

| Code | Meaning                                                           |
| ---: | ----------------------------------------------------------------- |
|    0 | complete campaign/comparison passed                               |
|    1 | valid campaign completed with a reliability failure or regression |
|    2 | command usage error                                               |
|   20 | invalid campaign, baseline, or persisted schema                   |
|   21 | target/configuration authorization failure                        |
|   22 | target connection or execution failure                            |
|   23 | campaign cancelled or incomplete                                  |
|   24 | evidence integrity failure                                        |

Existing MCP exit codes remain unchanged.

### 4. Evidence-backed onboarding

One no-key, real-process workflow covers Inspector config import, resilient and deliberately vulnerable fixtures, stdio and Streamable HTTP, deterministic injected failure, recovery measurement, an approved baseline, comparison, generated regression execution, and sanitized downloads. The verified Studio capture supplies a real PNG, GIF, and transcript. Fixture results are always labeled as local fixtures.

## Persisted schema decisions

All new persisted documents use `schemaVersion: "1.0"` and a fixed `kind` discriminator:

- `resilireplay-campaign`
- `resilireplay-campaign-run`
- `resilireplay-baseline`
- `resilireplay-comparison`

Unsupported versions are rejected explicitly. JSON evidence uses canonical key ordering. Hashes cover the canonical sanitized content identified in each manifest; timestamps and randomly generated run identifiers are not described as deterministic. `TraceEvent` remains schema `1.0` and backward compatible.

A campaign target is either a repository-contained trace or one named server in an Inspector-shaped `mcp.json`. Direct CLI MCP auditing remains supported, but Studio campaigns never accept an unrestricted browser-supplied command. Metrics are nullable when evidence is unavailable; no token, cost, latency, side-effect, or coverage value is inferred without source evidence.

## Security and threat boundaries

- Studio binds to `127.0.0.1` by default and rejects non-loopback bind requests in v0.3.0.
- Every start creates an in-memory session secret. It is delivered in a strict same-site HttpOnly cookie after the local bootstrap response, never in a URL or artifact.
- Host must equal the actual `127.0.0.1:<port>` listener. State-changing API requests require an allowed Origin, JSON content type, the session cookie, and a matching CSRF header token.
- State-changing requests are size-bounded. Newline/control-character header injection, traversal, symlink escape, foreign absolute paths, and shell interpretation are rejected.
- Imported stdio commands retain direct `spawn(command, args, { shell: false })` boundaries and existing containment. HTTP targets are loopback unless the CLI user explicitly authorizes remote access; Studio v0.3.0 does not authorize remote targets.
- Tool descriptions are untrusted. Discovery-only runs need no confirmation; tool calls require a reviewed allowlist plus explicit confirmation. Generated safe arguments do not make a tool intrinsically safe.
- Secrets are held only in memory, redacted by key and value patterns, omitted from plans/evidence, and never logged as authorization headers or URL parameters.
- Shutdown cancels active work, closes MCP clients, terminates spawned process trees through existing transports, closes the Studio listener, and waits for cleanup.

## Mandatory release gates

- Existing v0.2.1 behavior and 48-test baseline remain compatible.
- Campaign parsing, deterministic ordering, comparison, invalid/incomplete handling, cancellation, stdio, Streamable HTTP, generated regression execution, and Studio APIs have automated coverage.
- Adversarial tests cover Host/Origin/CSRF, DNS-rebinding assumptions, traversal, symlink escape, headers, command/argument separation, secret redaction, and lifecycle cleanup.
- Browser smoke covers the complete Studio flow and keyboard/accessibility essentials.
- Linux/Windows and Node 22/24 CI, coverage, package install, secret/privacy scans, and no-key demo pass.
- Studio startup is under 5 seconds locally, the installed quick start is under 60 seconds, artifacts/package sizes are recorded, and no relevant listener/process remains after stress and final shutdown.
- Public release/tag/npm publication occurs only after PR CI and fresh-install verification pass.

## Explicitly cut from v0.3.0

Accounts, teams, cloud storage, telemetry, a database, hosted dashboards, Docker requirements, framework-marketing adapters, arbitrary browser command execution, automatic provider fallback, a generic OAuth client, long-running task resumability with side effects, GitHub Pages, and more than the single verified onboarding workflow are roadmap items, not release blockers.
