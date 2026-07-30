# Bounded landscape audit

Audit date: 2026-07-30. Scope was limited to public product pages, package registries, papers, and repository descriptions; no competitor source code was copied or imported.

## Existing tools

- [`agent-chaos` / related AgentChaos packages](https://pypi.org/project/agent-chaos/) inject LLM, tool, timeout, rate-limit, and mutation failures and produce reliability observations. The exact `agentchaos-tools` query did not identify a distinct authoritative package in the checked GitHub, npm, or PyPI results; the adjacent public AgentChaos packages were reviewed instead.
- [AgentBreak](https://pypi.org/project/agentbreak/) concentrates on adversarial and workflow security testing, including proxy modes.
- [AgentFuzz](https://www.usenix.org/conference/usenixsecurity25/presentation/liu-fengyu) is research on automatically finding taint-style vulnerabilities in LLM agents.
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is the official interactive visual/CLI testing and debugging tool for MCP transports and methods.
- [mcpserver-audit](https://github.com/ModelContextProtocol-Security/mcpserver-audit) examines MCP servers for security problems and supports public audit/vulnerability databases.
- [MCP Safety Scanner](https://github.com/johnhalloran321/mcpSafetyScanner) and other MCP scanners focus on tool poisoning, prompt injection, configuration, source, or runtime security findings.
- [Cisco MCP Scanner](https://github.com/cisco-ai-defense/mcp-scanner) scans MCP tools, prompts, resources, and server instructions for security threats.

## Overlap

ResiliReplay overlaps on controlled failure injection, agent traces, MCP discovery, schema capture, security canaries, and machine-readable CI output. These capabilities are necessary context for reliability testing and are not claimed as novel.

## Concrete differentiation

The product is organized around an artifact pipeline:

`captured trace → deterministic fault mutation → replay → deterministic recovery score → causal minimization → executable regression`

A failed trace is not only summarized. ResiliReplay finds the first critical event, walks explicit parent/cause dependencies, removes unrelated prefix events, writes an editable YAML scenario and minimized fixture, emits an executable `node:test`, runs it immediately, and records hashes linking all artifacts.

Multi-agent handoffs and shared-state events use the same causal replay model as provider and tool failures. This matters because a lost handoff, stale shared state, or false intermediate result may fail far from the final output; preserving the first divergence and causal chain makes the defect reviewable and repeatable in CI.

MCP testing is a first-class module in the same repository, but it is intentionally not a general Internet scanner or a replacement for Inspector. It tests an explicitly authorized target under deterministic reliability and safe-canary faults, then emits the same evidence formats as agent tests.

No claim is made that ResiliReplay is the first tool in any category.
