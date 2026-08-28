# Five-minute implementer kit

An implementation needs no ResiliReplay package. Download the draft release bundle, verify `SHA256SUMS`, then use the normative `MCP_RES.md`, closed Draft 2020-12 schemas, `PROFILE_REGISTRY.json`, and test-vector catalog. Run either inert validator:

```console
node conformance-kit/validate.mjs evidence.json
python conformance-kit/python/mcp_res_validator.py validate evidence.json --schemas schemas
```

From a repository checkout, `pnpm mcp-res:validate` runs the shared valid, invalid, mutation, migration, attestation, official-conformance, profile, authorization, operations, safety, and cross-language comparison suites. Both implementations consume public artifacts only; Python imports no JavaScript or ResiliReplay package. Same-maintainer agreement is correlated implementation evidence, not an independent adopter.

The release includes the concise core, schemas, registry, valid/invalid/mutation/canonicalization/migration/attestation vectors, official-conformance attachment examples, JavaScript and Python validators, field corpus, contribution guide, review checklist, and badge rules. Rust is not supplied; Python is the required second-language implementation.

A badge MUST link to the exact standard/profile version, subject digest, evidence class, validator identity/version, result, and evidence digest. It MUST NOT say “Official MCP Certified,” “MCP Approved,” “Security Certified,” or “Guaranteed Reliable.” Contributions follow `CONTRIBUTING.md`; sensitive reports follow `SECURITY.md`.
