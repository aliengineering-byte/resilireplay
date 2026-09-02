# Machine-readable capabilities

[`aeb-capabilities.json`](../aeb-capabilities.json) is the repository's machine-discovery record. It
describes only released, evidence-backed ResiliReplay 0.7.0 behavior and links every platform claim
to the CI definition that exercises it. It is not an MCP standard, an AEB-wide evidence envelope,
or a substitute for the runtime schemas emitted by the CLI.

The current contract is `aeb.capabilities/v1` and is defined by the strict JSON Schema at
[`schemas/aeb-capabilities-v1.schema.json`](../schemas/aeb-capabilities-v1.schema.json). Consumers
must inspect `schemaVersion` before validation. The v1 schema rejects unknown properties and unknown
schema revisions; a future incompatible revision will use a new schema identifier and file rather
than silently changing the meaning of v1. Consumers may continue to validate a pinned v1 document,
but must not interpret a future revision using v1 assumptions.

The root manifest is the valid fixture. The test suite also carries an intentionally malformed
fixture with an undeclared field and verifies that both it and a future schema revision fail closed:

```console
pnpm exec vitest run tests/capabilities-manifest.test.ts
```

`currentVersion` must match the root package version. Capability entries use the public claim classes
defined by the project: `directly-tested`, `measured-benchmark`, `external-primary-source`,
`design-intent`, or `hypothesis`. The current record advertises only directly tested behavior.
