# MCP Reliability Evidence Standard (MCP-RES)

MCP-RES is a project-defined, vendor-neutral, open reliability-evidence standard for MCP ecosystem participants. ResiliReplay is its initial reference implementation. It is not the MCP specification, an official certification program, or an endorsement by the MCP project.

Draft v0.2.0 is now a prerelease candidate after five sequential review themes. Its [candidate tree](v0.2.0/) includes false-green-resistant evidence semantics, authenticity, a Python validator, deterministic migration, official-conformance attachment, protocol/transport/authorization/operational profiles, a public field corpus, registry, and governance controls. It is not stable or official MCP status; the published v0.1 tree and claims remain unchanged.

The current publication is **Draft v0.1.0**. It defines a small implementation-neutral core, versioned profiles, strict JSON Schema 2020-12 records, valid and invalid vectors, and a black-box validator. “Normative” in this tree means normative only for this project-defined draft.

Draft v0.2.0 is under sequential review and is not yet a published release. Its [development tree](v0.2.0/) currently contains merged PR 1 evidence semantics plus the PR 2 authenticity/validation/migration work, [research ledger](v0.2.0/RESEARCH.md), and [master gap ledger](v0.2.0/GAP_LEDGER.md). The published v0.1 tree and its claims remain unchanged.

- [Draft specification](v0.1.0/MCP_RES.md)
- [Conformance requirements](v0.1.0/CONFORMANCE.md)
- [Schemas](v0.1.0/schemas/)
- [Profiles](v0.1.0/profiles/)
- [Black-box conformance kit](v0.1.0/conformance-kit/)
- [Research and source-status ledger](v0.1.0/RESEARCH.md)
- [Adversarial self-review](v0.1.0/ADVERSARIAL_REVIEW.md)
- [Governance](GOVERNANCE.md)
- [Status and 1.0 criteria](STATUS.md)
- [Five-minute example](v0.1.0/FIVE_MINUTES.md)
- [v0.2 implementer kit](v0.2.0/IMPLEMENTER_KIT.md)

No central certification authority exists in v0.1. A conformance result is reproducible, profile-specific evidence—not a claim that the subject is secure, always available, or approved by MCP maintainers.
