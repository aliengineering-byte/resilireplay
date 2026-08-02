# Launch reference

This document keeps the public launch copy aligned with verified repository behavior. It does not
record a Hacker News submission as completed; submission status and the final public thread URL are
verified separately at launch time.

## Repository

- Public URL: https://github.com/aliengineering-byte/resilireplay
- Release: https://github.com/aliengineering-byte/resilireplay/releases/tag/v0.2.0
- No-key path: `pnpm install --frozen-lockfile && pnpm build && pnpm demo`
- MCP path: `pnpm demo:mcp`
- Scenario path: `pnpm exec resilireplay test scenarios`

## Show HN title

> Show HN: ResiliReplay – Chaos testing for AI agents and MCP servers

## First comment

> I built ResiliReplay because most agent demos show the happy path, while real failures happen after
> a tool times out, returns malformed data, loses a file, or corrupts state halfway through a
> workflow.
>
> ResiliReplay is a model-agnostic TypeScript toolkit for chaos-testing AI agents and MCP servers. It
> records canonical JSONL traces, injects deterministic faults, measures recovery, and turns
> minimized causal traces into regression tests.
>
> The current version includes agent and MCP fault injection, MCP Inspector configuration import,
> real authenticated Streamable HTTP coverage, terminal/JSON/HTML/JUnit/SARIF reports, a loopback
> provider-fault proxy, and deterministic demos that require no model API key.
>
> The quickest way to try it is the no-key demo in the README. I also included vulnerable and
> resilient MCP examples so the findings can be reproduced locally.
>
> The main limitations today are that Inspector interactive OAuth and modern protocol-era extensions
> are not imported, `record` is not an OS sandbox, MCP tool calls may have server-side effects, and
> causal minimization works best when adapters provide parent/cause IDs.
>
> I would especially value criticism of the fault model, recovery scoring, trace-to-test format, and
> which agent-framework integrations would make this useful in real CI.

This copy makes no benchmark, novelty, adoption, or universal security claim and does not ask for
votes, stars, or coordinated promotion.

## Local launch verification

The v0.2.0 release evidence is maintained in [`RELEASE_EVIDENCE.md`](../RELEASE_EVIDENCE.md). The
release gate covers Windows and Linux, Node 20 and 22, real stdio and Streamable HTTP, generated
regression execution, clean package installation, and repository hygiene.

The `v0.1.0` tag remains immutable. The Inspector integration is released separately as `v0.2.0`.
