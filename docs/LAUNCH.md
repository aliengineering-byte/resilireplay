# Launch reference

This document keeps the public launch copy aligned with verified repository behavior. It does not record a Hacker News submission as completed; submission status and the final public thread URL are verified separately at launch time.

## Repository

- Public URL: https://github.com/aliengineering-byte/resilireplay
- Release: https://github.com/aliengineering-byte/resilireplay/releases/tag/v0.1.0
- No-key path: `pnpm install --frozen-lockfile && pnpm build && pnpm demo`
- MCP path: `pnpm demo:mcp`
- Scenario path: `pnpm exec resilireplay test scenarios`

## Show HN title

> Show HN: ResiliReplay – Chaos testing for AI agents and MCP servers

## First comment

> I built ResiliReplay because most agent demos show the happy path, while real failures happen after a tool times out, returns malformed data, loses a file, or corrupts state halfway through a workflow.
>
> ResiliReplay is a model-agnostic TypeScript toolkit for chaos-testing AI agents and MCP servers. It records canonical JSONL traces, injects deterministic faults, measures recovery, and turns minimized causal traces into regression tests.
>
> The current version includes agent and MCP fault injection, terminal/JSON/HTML/JUnit/SARIF reports, a loopback provider-fault proxy, an MCP auditor built with the official SDK, and deterministic demos that require no API key.
>
> The quickest way to try it is the no-key demo in the README. I also included vulnerable and resilient MCP examples so the findings can be reproduced locally.
>
> The main limitations today are that Streamable HTTP support has less integration coverage than stdio, `record` is not an OS sandbox, MCP tool calls may have server-side effects, and causal minimization works best when adapters provide parent/cause IDs.
>
> I would especially value criticism of the fault model, recovery scoring, trace-to-test format, and which agent-framework integrations would make this useful in real CI.

This copy makes no benchmark, novelty, adoption, or universal security claim and does not ask for votes, stars, or coordinated promotion.

## Local launch verification

Verified on 2026-07-30:

- frozen dependency installation: pass;
- format, lint, strict typecheck, build, and 34/34 automated tests: pass;
- package installation smoke: pass, installed CLI reported `0.1.0`;
- repository scenarios: 3/3 pass or validate as declared;
- no-key agent demo and generated regression: pass;
- vulnerable/resilient MCP demo: two expected safe findings / zero findings;
- report JSON, standalone HTML, JUnit XML, SARIF 2.1.0, and manifest hashes: pass;
- repository secret scan, Gitleaks reachable-history scan, and tracked/generated hygiene scan: pass;
- demo GIF: 1000×630, five frames, 87,961 bytes;
- social preview: 1280×640 PNG with committed SVG source.

The launch work does not change package API or fault semantics. The existing `v0.1.0` tag remains the current release and must not be moved.
