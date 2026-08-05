# ResiliReplay adapter contract

Adapters translate stable vendor hook payloads into the canonical `resilireplay.agent-event/v1` boundary. They do not implement capture, persistence, retry, fault injection, or regression generation.

Create a starting point and run the conformance suite:

```bash
npx --yes resilireplay@0.5.0 adapter init my-agent-adapter
npx --yes resilireplay@0.5.0 adapter verify ./my-agent-adapter
```

## Package contract

An adapter directory contains:

```text
adapter.json
adapter.mjs
fixtures/
  failure.input.json
  failure.expected.json
```

`adapter.json` must validate against [`adapter-manifest.v1.schema.json`](../schemas/adapter-manifest.v1.schema.json). The declared entrypoint must stay inside the adapter directory, must not be a symlink, and must export `normalize(payload)`. Verification executes that entrypoint, so review third-party adapter code before running it.

Each `*.input.json` is passed to the entrypoint. Its paired `*.expected.json` contains the exact canonical fields that must match. The suite also validates entrypoint containment, bounded output, privacy redaction, stable SHA-256 event identity, and 64 concurrent normalizations. The [minimal adapter](../examples/adapters/minimal/adapter.json) is the reference fixture.

## Compatibility badge

“ResiliReplay Compatible” means only that the published adapter version passed `resilireplay adapter verify` against its declared fixtures. It does not mean security certification, endorsement, universal correctness, live-client verification, or support for undocumented payloads. Publishers must link the badge to a public conformance run and state whether their client evidence is LIVE VERIFIED or FIXTURE VERIFIED.

## Contribution checklist

- Use a stable documented event surface; never scrape transcripts.
- Normalize only bounded fields and hash bodies before persistence.
- Include success, failure, interruption, duplicate, oversized, and secret-shaped fixtures where the source can emit them.
- Keep hooks passive and capture off by default.
- Never retry or inject a failure from the adapter.
- Document client and version tested, operating systems, and the honest evidence level.
