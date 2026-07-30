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
| Accidental tool side effects                                         | Default MCP audit lists tools and invokes only the reserved `reliability_probe`; all-tool calls need `--call-tools`     |
| Memory/disk denial through content                                   | Recorder output cap, proxy request cap, generated oversized fault cap, subprocess deadlines                             |
| Telemetry or deterministic-test network drift                        | No telemetry implementation; deterministic demo contains no network client; CI test enforces that invariant             |
| False certification claims                                           | Badge and report explicitly limit evidence to one declared suite and version                                            |

## Residual risks

- A command explicitly passed to `record` can do anything the current OS account can do. Use an OS/container sandbox for untrusted code.
- `--call-tools` can trigger side effects exposed by the server. Read schemas and server code first.
- Pattern-based redaction cannot prove every secret format is covered. Avoid emitting secrets at the adapter source.
- Hashes prove artifact linkage and integrity, not authenticity. v0.1.0 does not sign reports.
- An authorized remote MCP server can behave differently across requests; record server version and environment with the report.

## Non-goals

ResiliReplay is not an exploit framework, malware sandbox, DLP product, universal security scanner, or formal certification authority.
