# MCP-RES status

Version `0.1.0` is a public project draft. Schemas and profile identifiers can change before 1.0 through the RFC process. A profile marked `NORMATIVE` has executable positive and negative vectors in this draft; that label does not make it part of the official MCP specification.

Version `0.2.0` is a draft prerelease candidate built through five sequential pull requests. It MUST NOT be represented as stable or official MCP status. Publication and residual risks are tracked in the [v0.2 gap ledger](v0.2.0/GAP_LEDGER.md).

Current 1.0 assessment: criteria 2, 3, and 7 have bounded project evidence; criterion 6 remains provisional; criteria 1, 4, and 5 are unmet. In particular, the JavaScript and Python validators have separate code but the same project authorship, so they do not satisfy independent external implementation or adoption.

## Stable 1.0 entry criteria

All of these criteria MUST be met before a stable 1.0 proposal:

1. A public draft period and published disposition of substantive feedback.
2. No unresolved critical defect in the standard, privacy boundary, canonicalization, or conformance kit.
3. The conformance kit passes supported Windows and Linux environments.
4. Two independent implementations produce interoperable bundles.
5. At least one implementation or adopter is independent of the ResiliReplay project and publishes verifiable evidence voluntarily.
6. Profile identifiers, evidence-class semantics, and canonicalization are stable.
7. A tested migration policy exists from every supported draft line.

None of the independent-implementation or adoption criteria is satisfied by ResiliReplay testing a third-party public package. Such a test is project evaluation, not adoption.
