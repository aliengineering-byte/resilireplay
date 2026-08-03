# Security policy

## Supported versions

Security fixes are provided for the latest tagged release. v0.2.1 is the current supported line;
v0.2.0 is retained as an immutable integration release.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting or open a draft security advisory in this repository. Do not include real credentials, production traces, personal data, or a destructive proof of concept. Maintainers will acknowledge a complete report, reproduce it in an isolated fixture, and coordinate a fix and disclosure.

For non-sensitive hardening ideas, open a normal issue.

## Authorized-use scope

ResiliReplay is defensive testing software. Run commands you trust and audit only local or user-owned MCP servers. `--allow-remote` is an explicit statement of authorization, not a technical proof of ownership. Do not use this tool to scan arbitrary systems, bypass security controls, exfiltrate data, or damage files.

`record` executes exactly the user-supplied executable and arguments without a shell. That is intentional functionality, not a sandbox. Treat untrusted commands as untrusted code and isolate them outside ResiliReplay.

The MCP Inspector importer also executes the reviewed `command` plus exact `args` without a shell.
It reads the configuration file but never modifies it. Dry-run is the review boundary: it performs no
server call and prints no environment or header value. Non-loopback URLs still require
`--allow-remote`.

## Built-in boundaries

- Secret-shaped strings and sensitive header/key names are redacted before storage.
- Imported environment and header values are never included in reports, traces, manifests, or
  generated regressions; Inspector proxy tokens and authentication-disable settings are rejected.
- Filesystem faults use temporary directories created and owned by the test process.
- Output paths must remain inside the selected output root.
- Subprocesses and MCP calls have deadlines and cleanup.
- Network listeners bind to loopback by default.
- Deterministic demos have no network calls and telemetry is disabled.
- Safe canaries are fake fixtures; the tool never searches for real credentials.

See [THREAT_MODEL.md](THREAT_MODEL.md) for assumptions and residual risk.
