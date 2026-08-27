# Five-minute local conformance check

Requirements: Node.js 22 or 24 and pnpm 10.14.0. The bundled examples are inert JSON; validation does not launch a server, access a credential, or use the network.

```console
pnpm install --frozen-lockfile
node docs/standards/mcp-res/v0.1.0/conformance-kit/validate.mjs docs/standards/mcp-res/v0.1.0/examples/hand-authored-valid.json
```

Expected JSON fields and exit code:

```json
{ "valid": true, "diagnostics": [] }
```

The output also includes the absolute input filename. Exit code is `0`. Now prove the validator rejects a broken claim:

```console
node docs/standards/mcp-res/v0.1.0/conformance-kit/validate.mjs docs/standards/mcp-res/v0.1.0/examples/hand-authored-invalid.json
```

Expected fields are `"valid":false` and `"diagnostics":["MCP_RES_MISSING_CLEAN_CONTROL"]`; exit code is `1`.

Run the complete draft suite:

```console
pnpm mcp-res:generate -- --check
pnpm mcp-res:validate
```

This checks all schema/profile documents, 7 valid vectors, 18 invalid vectors, 13 in-memory mutations, file hashes, byte-for-byte generation, independent/reference agreement, field/reference bundles, links, keywords, and secret patterns. The exact vector file hashes are in [`test-vectors/SHA256SUMS`](test-vectors/SHA256SUMS).
