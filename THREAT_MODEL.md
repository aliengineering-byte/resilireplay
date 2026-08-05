# Threat model

## Assets and trust boundaries

Protected assets are credentials, host files outside disposable fixtures, workstation/CI availability,
MCP server data and side effects, and the integrity of campaigns, traces, baselines, generated tests,
and reports.

ResiliReplay libraries and reviewed repository scenarios are trusted. Browser requests, YAML/JSON,
recorded subprocesses, provider responses, MCP descriptions/results, imported configs, paths, and
remote servers are untrusted inputs. A user-supplied command is explicitly authorized code execution
but is not sandboxed.

## Threats and controls

| Threat                                       | Primary controls                                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Cross-site or DNS-rebinding access to Studio | Loopback-only bind; exact Host; allowed Origin; HttpOnly SameSite session; CSRF token                                 |
| Studio session leakage                       | Random in-memory identifier in cookie only; no URL token; session cleared at shutdown                                 |
| Arbitrary browser command execution          | No command endpoint; only repository-contained reviewed campaign/config selection                                     |
| Accidental MCP side effects                  | Discovery-only default in campaigns; explicit allowlist; exact-hash, single-use confirmation                          |
| Adoption of an unintended target             | Project-only allowlist; exact sanitized target review; pre-connection confirmation; remote ownership acknowledgement  |
| Tool annotation over-trust                   | Annotations labeled untrusted; exact tool/arguments and retry suitability confirmed separately; `--yes` is bounded    |
| Credential persistence                       | Recursive key/value redaction; imported headers/env remain memory-only; secret-output failure                         |
| Path traversal or symlink escape             | Lexical containment plus realpath checks for input, output, executable/script, and downloads                          |
| Shell/header/URL injection                   | Direct spawn arrays with `shell: false`; header grammar and CR/LF checks; URL userinfo rejection                      |
| Runaway work or denial of service            | Body/content caps; concurrency/retry/time budgets; abort propagation; process-tree cleanup                            |
| Trace or baseline tampering                  | Strict schemas and canonical SHA-256 integrity hashes; fail-closed comparison                                         |
| False reliability evidence                   | Explicit expectations; real negative controls; generated regression execution; unavailable metrics remain unavailable |
| Prompt injection or malicious MCP text       | Content treated as evidence, never instructions; safe canary detection; no agent follows tool text                    |
| Duplicate side effects or loops              | Deterministic retry budget, duplicate-call and repeated-step detection, assertions and baseline thresholds            |
| False certification claims                   | Reports and badges are limited to one declared campaign/version and are not universal certification                   |

## Residual risks

- Explicitly launched programs have the current OS account's authority. Use an OS/container sandbox for
  untrusted code.
- An allowlisted MCP tool can still have side effects. Read its implementation/schema and use test
  environments.
- `--allow-remote` is a user assertion, and a remote server can change behavior between requests.
- Pattern redaction cannot recognize every application-specific secret format.
- Hashes prove linkage and integrity, not signer identity; v0.4.0 evidence is unsigned.
- Metadata-only adoption evidence cannot support later semantic inspection of omitted private tool
  bodies; rerun only after reviewing the same target and side-effect boundary.
- Inspector interactive OAuth/keychain flows and explicit modern protocol-era settings are rejected,
  not silently downgraded.
- The browser is local, not a security boundary against other code already running as the same user.

## Non-goals

ResiliReplay is not an exploit framework, malware sandbox, DLP product, universal security scanner,
formal certification authority, hosted control plane, or arbitrary network discovery system.
