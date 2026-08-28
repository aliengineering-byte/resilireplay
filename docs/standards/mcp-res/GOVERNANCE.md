# Governance

MCP-RES is maintained in `aliengineering-byte/resilireplay` under the repository license. It does not create a central certification authority.

## Versions and compatibility

The standard uses semantic versioning. Before 1.0, a minor version MAY make a schema-breaking change if it includes migration notes and new negative vectors. Patch versions MUST preserve valid bundles and diagnostic meaning. At 1.0 and later, breaking core, profile, schema, canonicalization, or claim-grammar changes require a major version. Profile versions advance independently inside their stable identifiers.

Profiles progress `EXPERIMENTAL` → `PROVISIONAL` → `NORMATIVE`. Promotion requires executable positive evidence, at least one expected-failure control, integrity mutation coverage, privacy review, cleanup coverage, and an explicit limitations section. Deprecation requires a replacement or rationale, one minor-version notice period after 1.0, and retained validation guidance for historical evidence.

The machine-readable profile registry, promotion history, mutation guard, deprecation process, and errata boundary are defined in [PROFILE_LIFECYCLE.md](PROFILE_LIFECYCLE.md). The [licensing/IPR statement](LICENSE.md) describes the Apache-2.0 boundary without inventing additional legal protections.

## Changes

Anyone may propose a change through a repository issue, GitHub Discussion, and pull request. Substantive changes require:

- a problem statement and non-goals;
- compatibility and privacy analysis;
- schemas and migration notes when machine fields change;
- valid and invalid vectors with stable diagnostics;
- conformance-kit implementation and four-cell CI;
- declared conflicts of interest where the proposer could benefit from a vendor-specific requirement;
- maintainer review and a recorded disposition of material objections.

Maintainers SHOULD prefer the smallest implementation-neutral rule supported by executable evidence. Vendor-specific behavior belongs in a profile or adapter, not the core.

The repository uses documented squash merges for standards PRs. Protected-branch and tag rules are audited by ruleset ID; administrator bypass, if platform policy permits it, remains a residual risk and never counts as independent review.

## Security and conduct

Potential vulnerabilities in the schemas, validator, or reference implementation follow [the repository security policy](../../../SECURITY.md). Do not publish credentials or sensitive evidence in an issue. Standards disagreements follow the repository code of conduct.

## Claims and badges

Conformance may be self-declared or independently verified. A badge, if used, MUST link to a conformance statement, evidence bundle, validator identity/version, and evidence digest. It MUST name the exact profile and evidence class.

The following language is forbidden: “Official MCP Certified,” “MCP Approved,” “Security Certified,” and “Guaranteed Reliable.” No adopter list may be updated without a public statement or evidence from that adopter.
