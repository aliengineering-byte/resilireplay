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

| Directory or surface                         | Verified at (UTC)    | Public artifact submitted                                                                                                                                                                                                                               | Confirmation or identifier                                                                                                                   | State                                                                                                                                                                                                                 |
| -------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hugging Face Space                           | 2026-08-06T01:25:30Z | https://huggingface.co/spaces/ali110v/resilireplay-everywhere                                                                                                                                                                                           | [`f183b27`](https://huggingface.co/spaces/ali110v/resilireplay-everywhere/commit/f183b27fc2e84858f94482734a88bcfc28b65e8e)                   | Published and publicly readable. The no-key static fixture is running.                                                                                                                                                |
| Hugging Face dataset                         | 2026-08-06T01:25:30Z | https://huggingface.co/datasets/ali110v/resilireplay-synthetic-failure-fixtures                                                                                                                                                                         | [`252b732`](https://huggingface.co/datasets/ali110v/resilireplay-synthetic-failure-fixtures/commit/252b73292ca2484f4b7cff603d6accd6720c4c57) | Published and publicly readable; the viewer returns 12 synthetic rows.                                                                                                                                                |
| Hugging Face Agent Skill                     | 2026-08-06T01:25:30Z | [`SKILL.md`](https://huggingface.co/spaces/ali110v/resilireplay-everywhere/blob/main/SKILL.md) and [`resilireplay-agent-skill-v0.5.0.zip`](https://huggingface.co/spaces/ali110v/resilireplay-everywhere/blob/main/resilireplay-agent-skill-v0.5.0.zip) | [`f183b27`](https://huggingface.co/spaces/ali110v/resilireplay-everywhere/commit/f183b27fc2e84858f94482734a88bcfc28b65e8e)                   | Published; the public bundle SHA-256 is `E2A0F6786657E5C56162FEFAE87895FF33283518DD052E6D0346EE52CA3EBFDF`.                                                                                                           |
| Claude Plugin Directory                      | 2026-08-06T01:25:30Z | https://github.com/aliengineering-byte/resilireplay with path `plugins/resilireplay`                                                                                                                                                                    | https://platform.claude.com/plugins/submissions (authentication required)                                                                    | `SUBMITTED_PENDING_REVIEW`; submitted once for the installation-verified Claude Code surface.                                                                                                                         |
| OpenAI shared ChatGPT/Codex plugin directory | 2026-08-06T01:25:30Z | Intended skills-only artifact: [`resilireplay-agent-skill-v0.5.0.zip`](https://huggingface.co/spaces/ali110v/resilireplay-everywhere/blob/main/resilireplay-agent-skill-v0.5.0.zip)                                                                     | https://platform.openai.com/plugins (authentication required)                                                                                | `BLOCKED_NO_BILLING`; individual verification requires activating API billing and adding a default payment method. No payment method, billing plan, trial, credit purchase, charge, or plugin submission was created. |
| OpenAI Developer Showcase                    | 2026-08-06T01:40:44Z | https://aliengineering-byte.github.io/resilireplay/ and https://github.com/aliengineering-byte/resilireplay                                                                                                                                             | https://openai.com/form/showcase-submission/                                                                                                 | `SUBMITTED_PENDING_SELECTION`; the one-time confirmation says entries are reviewed weekly and only selected projects receive a response.                                                                              |
| Glama MCP server directory                   | 2026-08-06T01:43:25Z | https://github.com/aliengineering-byte/resilireplay                                                                                                                                                                                                     | https://glama.ai/mcp/servers                                                                                                                 | `SUBMITTED_PENDING_REVIEW`; the one-time confirmation says the server was submitted for review. No Glama hosting deployment, payment method, paid plan, or charge was created.                                        |

`BLOCKED_NO_BILLING` is a deliberate external-gate disposition, not an implementation failure. Do
not retry the OpenAI directory submission unless the maintainer separately authorizes billing. Do
not resubmit any entry while review is pending.

## Directory audit exclusions

- **Official MCP Registry:** not submitted. The registry requires an npm package's `mcpName` to
  match the published server name. Immutable `resilireplay@0.5.0` does not contain that field, so a
  valid submission would require a new package release rather than a post-release metadata claim.
  See the official [registry quickstart](https://modelcontextprotocol.io/registry/quickstart).
- **Smithery:** not submitted. Its current local-server path requires a pre-built MCPB bundle, while
  its URL path requires a public Streamable HTTP endpoint. ResiliReplay v0.5.0 intentionally ships a
  local stdio default and neither of those distribution artifacts. See Smithery's
  [publishing requirements](https://smithery.ai/docs/build/publish).

Glama was the only additional free MCP directory submission. The audit therefore stayed below the
mission limit of at most two directory submissions and did not manufacture an incompatible hosted
surface or package release.
