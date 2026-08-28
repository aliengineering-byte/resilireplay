# Changelog

## 0.2.0 — development

- PR 1 ([#50](https://github.com/aliengineering-byte/resilireplay/pull/50)): added reason-bound negative observations, integrity-bound observation derivation, scenario fingerprints, execution instance digests, observation-coverage manifests, trial summaries, and false-green/mutation/migration tests.
- PR 2 ([#51](https://github.com/aliengineering-byte/resilireplay/pull/51)): separated integrity/authenticity/trust, added offline Ed25519 DSSE/in-toto-informed attestations, reproducible SBOM/provenance packaging, a dependency-free Python validator, and deterministic non-promoting v0.1 migration.
- Preserved the v0.1.0 normative tree and digest semantics unchanged.

## 0.1.0 — 2026-08-27

- Initial project-defined public draft.
- Added an implementation-neutral core and three versioned profiles.
- Added nine JSON Schema 2020-12 schemas, a black-box validator, positive/negative vectors, mutation tests, and reference evidence.
- Defined evidence classes, bounded recovery, causal identity, privacy omission, integrity, executable regression, resource limits, cleanup, claim grammar, and governance.
