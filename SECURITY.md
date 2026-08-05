# Security policy

## Supported versions

Security fixes are provided for the latest tagged release. v0.5.0 is the current supported line;
older releases remain immutable historical artifacts.

## Reporting a vulnerability

Use GitHub private vulnerability reporting or open a draft security advisory in this repository. Do
not include real credentials, production traces, personal data, or a destructive proof of concept.
For non-sensitive hardening ideas, open a normal issue.

## Authorized-use scope

ResiliReplay is defensive testing software. Run only commands you trust and audit only local or
user-owned MCP servers. `--allow-remote` states authorization; it does not prove ownership. Do not use
the project to scan arbitrary systems, bypass controls, exfiltrate data, or damage files.

`record` and reviewed Inspector stdio targets execute the exact executable and argument array without
a shell. This is intentional code execution, not an OS sandbox. Isolate untrusted programs with an
OS/container boundary outside ResiliReplay.

## Adoption boundary

- Default discovery checks only `mcp.json`, `.mcp.json`, and `.vscode/mcp.json` in the current
  project. It does not search home directories, other repositories, browser storage, or keychains.
- `adopt --dry-run` parses the selected repository-local configuration but starts no process, opens no
  network connection, calls no tool, and writes no project file.
- The exact process/arguments or HTTP origin is displayed with environment/header values redacted
  before connection. Tool annotations are untrusted hints and never authorize execution.
- Tool name, exact arguments, safety classification, and suitability for one duplicate attempt are
  explicit boundaries. `--yes` cannot confirm tool execution or retry suitability.
- Arguments reject sensitive keys, credential-shaped or encoded values, home/outside paths, and
  symlink escapes. Artifact destinations are realpath-preflighted before any MCP connection.
- Generated evidence uses metadata-only MCP projection. Raw request/result bodies, environment
  values, and authorization headers are not persisted.

## Coding-agent capture boundary

- Plugin installation is inert. Hooks create no capture state until `capture start` arms the current repository.
- Hooks are passive observers: they never inject a fault, execute a target, or retry a failed operation.
- Hook stdin is capped at 1 MiB. Canonical events are strictly validated and capped at 32 KiB; summaries are
  redacted before persistence and capped at 512 characters.
- Raw prompts, full transcripts, unrestricted request/result bodies, authorization headers, token values,
  environment values, and personal paths are excluded by default. Identifiers and bodies become SHA-256 projections.
- Capture is capped at 20,000 events. Concurrent writers use a repository-local lock and exact dedupe shards;
  interrupted trailing journal records are discarded before the next append.
- Generated capture regressions stay inside the repository, reject symlink/junction escapes, and refuse overwrite.
- Direct connection changes require a displayed plan and explicit confirmation. Exact originals are stored in a
  gitignored recovery backup and are never printed; protect that backup like the source configuration.

## Studio boundary

- Studio binds only to `127.0.0.1` and validates the exact listener Host to limit DNS-rebinding and
  confused-deputy paths.
- Each start creates an ephemeral in-memory session. The identifier is set in an HttpOnly, SameSite
  cookie and never placed in a URL, log, or evidence artifact.
- State-changing requests require an allowed Origin, JSON content type, valid session cookie, matching
  CSRF header, and a body no larger than 64 KiB.
- The browser can select repository-contained campaign/config paths but cannot supply arbitrary
  executable shell text. Static content uses a restrictive CSP and no remote assets.
- Tool calls require a reviewed allowlist and one-time confirmation bound to the canonical campaign
  hash. Discovery-only campaigns do not call tools.
- Evidence downloads are server-allowlisted and checked lexically and by realpath against traversal
  and symlink escape.
- Shutdown aborts active work, closes MCP transports and process trees, clears sessions, and awaits
  listener closure.

## Campaign and MCP boundaries

- YAML aliases, duplicate/unknown fields, unsupported schema versions, absolute or traversing relative
  paths, transport conflicts, URL credentials, CR/LF header injection, Inspector auth-bypass fields,
  and proxy session-token declarations fail closed.
- Imported environment/header values stay in memory. Plans show names and sources, never values.
- Remote HTTP requires explicit CLI/Action authorization; Studio does not authorize remote targets.
- Retry, concurrency, scenario timeout, and total timeout budgets have strict upper bounds.
- Missing, malformed, cancelled, mismatched, incomplete, or hash-invalid evidence cannot pass a
  baseline comparison.

## Data handling

Credential-shaped values and sensitive keys are recursively redacted before persistence. Safe
canaries are fake fixtures; ResiliReplay never searches for real credentials. Pattern redaction is
defense in depth, not a proof that every secret format is covered. Avoid emitting secrets at the
adapter source and treat reports as sensitive when the source data is sensitive.

No telemetry is implemented. Deterministic demos use repository-owned local fixtures and no external
provider API.

See [THREAT_MODEL.md](THREAT_MODEL.md) and [Studio security](docs/STUDIO_SECURITY.md).
