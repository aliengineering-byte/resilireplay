# Second-implementation Python validator

`mcp_res_validator.py` is a second implementation of MCP-RES v0.2. It uses only the Python standard library, public MCP-RES schemas, vectors, and bundles. It imports no JavaScript, ResiliReplay package, generated JavaScript decision, or private monorepo function.

```bash
python mcp_res_validator.py validate ../../test-vectors/valid/reason-bound-negative.json
python mcp_res_validator.py canonicalize ../../test-vectors/valid/reason-bound-negative.json
python mcp_res_validator.py official official-attachment.json
python mcp_res_validator.py profile profile-evaluation.json
python mcp_res_validator.py attestation attested.json --trust-policy policy.json
python mcp_res_validator.py migration migration-result.json
```

The schema evaluator intentionally implements the JSON Schema 2020-12 vocabulary used by the published schemas; it is not a general-purpose JSON Schema package. The Ed25519 verifier is a dependency-free RFC 8032 reference path cross-checked in CI against ephemeral signatures produced by the platform crypto implementation.

This implementation is authored and shipped by the ResiliReplay project. It is a second-language implementation, **not an independent external implementation or adopter** for the MCP-RES 1.0 entry criterion.
