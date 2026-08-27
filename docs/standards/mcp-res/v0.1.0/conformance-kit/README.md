# MCP-RES black-box conformance kit

This validator consumes only this directory's published schemas, published vectors, and a submitted JSON bundle. It imports no ResiliReplay package or private function.

```console
pnpm install --frozen-lockfile
node docs/standards/mcp-res/v0.1.0/conformance-kit/validate.mjs docs/standards/mcp-res/v0.1.0/examples/hand-authored-valid.json
```

Exit `0` means valid, `1` means a stable conformance diagnostic was produced, and `2` means the input could not be read or parsed. Output is one JSON line. Ajv 8.20.0 validates JSON Schema 2020-12; `lib.mjs` then applies cross-record, causality, privacy, integrity, and evidence-class rules that JSON Schema cannot express.

The implementation is intentionally separate from the ResiliReplay packages. Validator identity SHA-256 `d9e2a71b47b5eabe385fa17fe3c9d0e5898f323933f21654643a54e4f9d50580` is the exact byte hash of [`validator-release.json`](validator-release.json). That immutable descriptor binds the entrypoint, schema dialect, semantic rule set, and implementation boundary without creating an impossible executable self-hash.
