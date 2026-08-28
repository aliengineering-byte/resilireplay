# MCP-RES v0.2 release provenance

The project supports two distinct verification paths:

1. reproducible local SHA-256/SPDX packaging with no account; and
2. optional GitHub-hosted artifact attestations for official repository tags matching `mcp-res-v*`.

The tag workflow packages all draft assets, records the exact source commit/tree, generates an SPDX 2.3 SBOM, publishes `SHA256SUMS`, creates GitHub build-provenance and SBOM attestations, then downloads and verifies every asset in a separate clean job.

The release includes the migration script as reviewed source, named `mcp-res-v0.1-to-v0.2-migrate.source.mjs`. It intentionally is not described as a standalone binary: execution uses `pnpm mcp-res:migrate` from an exact repository checkout so the pinned v0.1 validator dependencies are present.

Standards tags do not match the npm release prefix and cannot enter the npm publish job. Release metadata sets `npmPublishAllowed` to `false`.

No SLSA level is claimed. GitHub-hosted provenance is useful origin evidence, not proof that every requirement of a SLSA level is satisfied. It is also optional: the MCP-RES attestation envelope and Python/JavaScript verification remain offline-capable.
