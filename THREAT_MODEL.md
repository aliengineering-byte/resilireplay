# Threat model

## Assets

- Credentials and authorization material present in a developer environment.
- Source files and other host data outside disposable fixtures.
- Integrity of captured traces, scenarios, generated tests, and reports.
- Availability of the workstation and CI runner.
- MCP server data and side effects.

## Trust boundaries

The ResiliReplay libraries and checked-in scenarios are trusted. Recorded subprocesses, provider responses, MCP descriptions/results, YAML scenarios, and output paths are untrusted inputs. A user-supplied command is explicitly authorized code execution but is not sandboxed.

## Threats and controls

| Threat                                                               | Control                                                                                                                 |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Credential capture in headers, metadata, payloads, stdout, or stderr | Recursive key redaction and token-shape redaction; tests for authorization, API key, GitHub, cloud, and model-key forms |
| Trace tampering                                                      | Per-payload SHA-256 plus strict validation; source/fixture/scenario/test hashes in compiler manifests                   |
| Path traversal and arbitrary overwrite                               | Output containment validation; caller-selected output root                                                              |
| Destructive filesystem injection                                     | Missing-file/permission scenarios are modeled and disposable fixture helpers create owned temporary roots               |
| Runaway subprocess or MCP call                                       | Bounded timeout, Windows process-tree termination, POSIX process-group termination, transport closure                   |
| Tool prompt injection or secret request                              | Pattern findings and fake canary detection; no agent follows returned instructions during audit                         |
| Arbitrary Internet scanning                                          | Exactly one explicit target required; non-loopback HTTP requires `--allow-remote`; no discovery                         |
| Ambiguous or malicious Inspector config                              | Duplicate keys, conflicts, unknown fields, malformed types, and multi-server ambiguity fail closed                      |
| Shell injection through imported command/arguments                   | Executable and argument array are passed directly without a shell; boundaries are never concatenated                    |
| Imported path traversal or symlink escape                            | Config, cwd, executable, and script paths are repository-contained after lexical and real-path checks                   |
| Imported environment/header credential persistence                   | Values remain memory-only; dry-run exposes names/source only; artifacts never receive imported values                   |
| Header injection or URL credential smuggling                         | Header grammar and CR/LF checks; controlled headers and URL userinfo/credential queries rejected                        |
| Inspector authentication weakening                                   | `DANGEROUSLY_OMIT_AUTH` and Inspector proxy session-token declarations are rejected                                     |
| Encoded credential persistence                                       | Sensitive keys plus bearer/basic, URL-encoded, provider-token, and labelled-base64 patterns are redacted                |
| Accidental tool side effects                                         | Default MCP audit lists tools and invokes only the reserved `reliability_probe`; all-tool calls need `--call-tools`     |
| Memory/disk denial through content                                   | Recorder output cap, proxy request cap, generated oversized fault cap, subprocess deadlines                             |
| Telemetry or deterministic-test network drift                        | No telemetry implementation; deterministic demo contains no network client; CI test enforces that invariant             |
| False certification claims                                           | Badge and report explicitly limit evidence to one declared suite and version                                            |

## Residual risks

- A command explicitly passed to `record` can do anything the current OS account can do. Use an OS/container sandbox for untrusted code.
- `--call-tools` can trigger side effects exposed by the server. Read schemas and server code first.
- Pattern-based redaction cannot prove every secret format is covered. Avoid emitting secrets at the adapter source.
- Literal commands in a reviewed Inspector file remain authorized code execution. Configuration review and OS-level sandboxing remain the user's responsibility.
- ResiliReplay 0.2.1 does not implement Inspector's interactive OAuth/keychain flows or modern protocol era. It rejects those execution-affecting fields instead of silently weakening or downgrading them.
- Hashes prove artifact linkage and integrity, not authenticity. v0.2.1 does not sign reports.
- An authorized remote MCP server can behave differently across requests; record server version and environment with the report.

## Non-goals

ResiliReplay is not an exploit framework, malware sandbox, DLP product, universal security scanner, or formal certification authority.
