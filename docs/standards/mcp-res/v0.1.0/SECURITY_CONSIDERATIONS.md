# Security and privacy considerations

MCP-RES is reliability evidence, not a security certification. A passing bundle can still describe vulnerable software, a weak harness, an incomplete threat model, or an operation outside the tested scope.

## Threats addressed

- **Vacuous tests:** clean and deliberately failing controls show that the baseline works and the harness can detect breakage.
- **Causal substitution:** run, operation, parent, fault, policy, subject, and statement bindings prevent evidence from silently moving to another call.
- **Retry harm:** finite limits and side-effect classification reject unsafe automatic retries.
- **Disclosure:** source omission is required for credentials, authorization, environment values, private prompts/transcripts, unrestricted bodies, and personal paths; encoded secret-shaped content is rejected.
- **Partial publication:** per-artifact hashes and manifest-last completion prevent staging output from appearing complete.
- **Claim inflation:** evidence classes are derived from execution facts; fixtures and installations cannot self-promote to genuine runtime proof.
- **Resource exhaustion:** schemas and the kit bound bytes, arrays, strings, nesting-related declarations, retries, concurrency, and time.
- **Cleanup leakage:** a passing claim requires zero owned child processes/listeners and no unapproved state.

## Residual threats

SHA-256 integrity does not prove who produced evidence. Local filesystem checks remain subject to platform permissions and TOCTOU races outside an implementation's containment root. A malicious validator can lie about results or its own digest. A subject can change after evaluation if the identity digest is not actually pinned. Omitted data can limit diagnosis. Pattern-based secret scanning cannot detect every secret and is not a substitute for omission.

The v0.1 canonicalizer is intentionally narrower than RFC 8785 and rejects non-safe-integer numbers. Different Unicode-normalization forms remain distinct values. Implementers MUST hash the exact accepted strings and MUST NOT normalize silently.

## Safe evaluation boundary

Conformance-kit validation is read-only. It MUST NOT launch the subject, replay arbitrary commands, resolve remote references, load executable content, or follow submitted paths. Runtime collection belongs to a separately authorized harness. Public field evidence SHOULD use local stdio, authenticated loopback HTTP, no-key fixtures, read-only or inert operations, deterministic synthetic faults, and concurrency one unless concurrency is the test.

Report validator or schema vulnerabilities privately through [SECURITY.md](../../../../SECURITY.md). Do not attach sensitive evidence to a public report.
