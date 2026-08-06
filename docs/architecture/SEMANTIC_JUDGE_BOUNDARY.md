# Semantic Judge Boundary

ResiliReplay is deterministic first. Semantic judging is advisory.

## Rule

- Deterministic status is authoritative for all release gates.
- Semantic judge output can never override safety failures.

## Advisor output shape

`Decision` object:
- `deterministic_status`: `passed|failed|error`
- `semantic_advisory`: `{ providerId, rubricVersion, promptHash, sampling, evidenceDigest, status, score?, notes? }`
- `final_policy_status`: derived from deterministic policy only, with optional semantic annotation.

## Invocation constraints

- Off by default.
- Must require explicit opt-in config.
- Must never run in `demo`, `test`, or `ci` unless explicitly requested.
- Inputs passed to judge providers must be sanitized and redacted.
- Outputs cannot generate “correct”, “safe”, or “true” claims.

## Prompt hardening

- Provider prompt and system prompt must be fixed-schema and not include untrusted trace data.
- Reject prompt injection patterns with explicit allow-list model for redacted fragments.

## Offline fixture

Deterministic judge fixture is required for tests. Default CI MUST use only fixture outputs.
