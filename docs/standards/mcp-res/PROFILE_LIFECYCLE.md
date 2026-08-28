# Profile registry, deprecation, and errata

`v0.2.0/PROFILE_REGISTRY.json` is the machine-readable authority for profile identity in this draft. The registry generator rejects duplicate IDs, stale manifest digests, missing schema/vector digests, and a status that lacks a matching history entry. Incompatible behavior requires a new profile version; released manifest bytes are not silently mutated.

Status promotion requires public positive and reason-bound negative evidence, mutation coverage, both validator implementations, cleanup/privacy review, and a disposition record. Same-maintainer evidence is not external independence.

Deprecation records a date, rationale, successor (or explicit lack of one), migration guidance, and historical validator availability. Before 1.0 there is no guaranteed notice interval; after 1.0 the minimum is one minor release unless an urgent security correction demands otherwise.

Errata are recorded in the root standards changelog and a project-owned disposition issue. An erratum may correct editorial text without changing executable meaning. Any schema, canonicalization, requirement, evidence-class, or diagnostic-meaning change advances the appropriate version and includes migration evidence.
