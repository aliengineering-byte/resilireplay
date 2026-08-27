# Adversarial self-review

Performed `2026-08-27` before publication.

| Reviewer stance                          | Question                                                                | Finding and resolution                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP protocol maintainer                  | Does this redefine protocol conformance or draft proposals?             | The core was kept orthogonal to MCP messages/transports. Released specification, SDK behavior, Inspector behavior, and proposed client configuration are separately labeled. The client profile remains provisional.                                                                                                                  |
| Independent tool implementer             | Can I implement this without ResiliReplay internals?                    | Yes: the contract is the schemas, profile manifest, vectors, canonicalization rule, and bundle. The black-box kit imports no ResiliReplay package. The exporter is an optional example, not a required pipeline.                                                                                                                      |
| Security reviewer                        | Can secrets, unsafe retry, partial output, or causal substitution pass? | Closed schemas omit raw bodies/headers/environments; pre-schema checks catch raw and encoded credential shapes; side-effecting/unknown retries require safety evidence; cleanup and manifest-last are mandatory; cross-record IDs and digests are checked. Residual pattern-scan, TOCTOU, and dishonest-validator risks are explicit. |
| Skeptical standards reviewer             | Can a producer promote a fixture by changing a label?                   | No label alone is sufficient. `GENUINE_RUNTIME` requires runtime/protocol execution fields plus a `source-evidence/` artifact digest. A dedicated invalid vector self-asserts execution without source evidence and fails. Independent adoption is explicitly unsatisfied.                                                            |
| Maintainer who does not use ResiliReplay | Does adoption force product commands, packages, or schema names?        | No. No ResiliReplay field is required. A consumer can run a separate Ajv-based validator over inert JSON. Existing product commands and package versions are unchanged.                                                                                                                                                               |

Additional corrections from review:

- duplicate integrity-manifest paths are rejected;
- artifact ordering uses the declared UTF-16/code-unit order, not locale collation;
- validator identity hashes an immutable release descriptor rather than pretending an executable can self-hash;
- draft tag automation is isolated from `v*` product releases, and npm publication ignores non-`v` release tags;
- the standards page is tested on desktop/mobile for serious WCAG A/AA findings and horizontal overflow.

Remaining objections are limitations, not silently accepted claims: only one profile is normative within the draft, only two field subjects are published, both recorded runs used one Windows/Node runtime, no independent implementation/adopter exists, and canonicalization is not RFC 8785.
