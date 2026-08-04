# Security policy

## Supported versions

Security fixes are provided for the latest tagged release. v0.3.0 is the current supported line;
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

## Studio boundary

- v0.3.0 binds only to `127.0.0.1` and validates the exact listener Host to limit DNS-rebinding and
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
- Remote HTTP requires explicit CLI authorization; Studio does not authorize remote targets in
  v0.3.0.
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
