# Studio security model

ResiliReplay Studio is a local interface over the same campaign, MCP, trace, reporter, and regression engines used by the CLI. It is not a hosted service and it does not make browser input a shell.

## Network and session boundary

- Studio v0.3.0 binds only to `127.0.0.1`; `0.0.0.0`, IPv6 wildcard, LAN, and remote bind requests are rejected.
- The actual `127.0.0.1:<port>` Host header is required. A hostile DNS name resolving to loopback is rejected before routing.
- Every presented `Origin` must exactly match the listener origin. State-changing requests require that Origin, `application/json`, an HttpOnly `SameSite=Strict` session cookie, and a separate CSRF header token.
- The 256-bit session secret is generated at startup, held only in memory, expires after 15 minutes,
  and is never placed in the URL, HTML, logs, or evidence.
- Responses disable caching, framing, MIME sniffing, and referrers; the Content Security Policy permits only same-origin scripts/styles/connects and no base URI or framing.
- Request bodies are capped at 64 KiB. Routes, methods, identifiers, and content types are allowlisted.

These defaults align with the MCP Streamable HTTP specification’s warning to validate Origin and bind local servers to `127.0.0.1` to resist DNS rebinding.

## Execution boundary

Studio accepts a repository-contained campaign path. Its builder can write a campaign only from a reviewed Inspector-shaped configuration, named server, supported fault, bounded seed/budgets, and explicit tool allowlist. It has no endpoint for an arbitrary command string.

Before execution Studio displays the exact sanitized target plan: named server, transport, config hash, command and argument boundaries, timeouts, working directory, environment/header names, remote status, and allowlisted tools. Values are redacted.

Discovery-only targets invoke no tool through the campaign API. Tool-calling targets require:

1. a non-empty allowlist in the hashed campaign;
2. a recent review of that exact hash;
3. an explicit risk acknowledgement; and
4. a short-lived, single-use confirmation token held in response state, not a URL.

The MCP transport retains direct `spawn(command, args, { shell: false })` behavior, repository containment, realpath/symlink checks, bounded timeouts, controlled headers, no URL credentials, and loopback-only Studio HTTP targets. Tool descriptions and schemas remain untrusted.

## Evidence and downloads

Core sanitization redacts sensitive keys and credential-shaped values before events are constructed. Imported environment/header values stay in memory and become `[REDACTED]` in plans. Studio API responses are sanitized again.

Download IDs are derived from files produced beneath one completed run directory. Directory walks skip symlinks; each download repeats the realpath containment check and serves only the stored allowlist entry. Absolute workstation paths are not returned to the browser.

Hashes link campaign, source target/config, run, baseline, comparison, trace, report, and generated-regression artifacts. They establish integrity/linkage, not author identity or external certification.

## Cleanup and limitations

Closing Studio aborts active campaign signals, waits for run cleanup, closes MCP clients/processes through their transports, closes the listener and live connections, and clears in-memory sessions/reviews/confirmations. Lifecycle tests exercise repeated starts; the release stress gate exercises 100 cycles.

Studio does not sandbox an authorized MCP tool inside a new OS security boundary. A reviewed allowlist and safe generated arguments reduce accidental reach but cannot make an inherently destructive tool safe. Run untrusted servers with ordinary OS/container isolation and least privilege. Remote production targets remain CLI-only and require explicit ownership authorization.
