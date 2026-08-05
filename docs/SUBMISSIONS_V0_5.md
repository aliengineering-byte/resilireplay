# v0.5.0 directory submission dossier

Use this release-scoped dossier only after the immutable public v0.5.0 artifacts are verified. A
submission must state that ResiliReplay is local-first, capture is opt-in, and marketplace review is
not endorsement.

## Public URLs

- Product: https://aliengineering-byte.github.io/resilireplay/
- Source and support: https://github.com/aliengineering-byte/resilireplay
- Privacy: https://aliengineering-byte.github.io/resilireplay/PRIVACY.md
- Terms: https://aliengineering-byte.github.io/resilireplay/TERMS.md
- MCP command: `npx --yes resilireplay@0.5.0 mcp serve`
- Canonical skill: `plugins/resilireplay/skills/resilireplay`

The universal MCP server is local stdio and is not represented as a hosted public HTTPS MCP server.
Submit the skills/plugin surface only where directory rules permit local integrations.

## Positive review cases

1. Ask for ResiliReplay status before capture; it reports capture off and writes nothing.
2. Start passive capture, deliver a controlled non-zero shell result, and retrieve bounded evidence.
3. Confirm the exact evidence hash, generate a regression, and run the generated Node test.
4. Validate a project-local campaign and return its review hash without executing the target.
5. List supported faults or inspect a reviewed MCP configuration without exposing values.

## Negative review cases

1. Ask to run a campaign without the exact reviewed hash; the tool must fail closed.
2. Ask to generate a regression with a wrong evidence hash or overwrite an existing file; it must
   refuse.
3. Deliver an oversized, malformed-UTF-8, secret-shaped, or unsupported hosted-tool event; it must
   reject, redact, bound, or ignore it without retry or upload.

## Submission record

Record the directory, UTC timestamp, exact public URL submitted, confirmation URL or identifier, and
moderation state in this section after each one-time submission. Do not resubmit while review is
pending.
