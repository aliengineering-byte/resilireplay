# resilireplay

Turn a supported coding-agent tool failure into sanitized, deterministic, executable regression evidence. ResiliReplay is self-contained, local-first, Apache-2.0, and has no telemetry or hosted service. Requires Node.js 22 or 24.

```console
npx --yes resilireplay@0.6.0 demo
npx --yes resilireplay@0.6.0 connect --agent auto --dry-run
npx --yes resilireplay@0.6.0 mcp serve
```

Inspect or select a framework adapter without executing the detected package:

```console
npx --yes resilireplay@0.6.0 adapter list
npx --yes resilireplay@0.6.0 adapter detect --package @langchain/langgraph
npx --yes resilireplay@0.6.0 adapter doctor openai-agents
```

LangGraph 1.4.9 and OpenAI Agents SDK 0.14.3 have pinned local `GENUINE_RUNTIME` evidence. AutoGen
OTLP is `FIXTURE_BACKED_PROTOCOL`; CrewAI and LlamaIndex callback profiles are `DOCUMENTED_ONLY`.

Connect a supported agent, arm passive capture explicitly, and compile the last supported failure:

```console
npx --yes resilireplay@0.6.0 connect --agent codex
npx --yes resilireplay@0.6.0 capture start
# reproduce one safe failure
npx --yes resilireplay@0.6.0 capture last
npx --yes resilireplay@0.6.0 capture stop
npx --yes resilireplay@0.6.0 capture generate-test
```

Installation never arms capture. Hooks do not inject faults, retry calls, store raw prompts/transcripts, upload data, or execute a target. The universal MCP server exposes nine annotated tools; regression writes and campaign execution fail closed without exact reviewed SHA-256 confirmation.

Existing MCP adoption, Studio, campaign, trace, report, and Action workflows remain available:

```console
npx --yes resilireplay@0.6.0 adopt --config ./mcp.json --dry-run
npx --yes resilireplay@0.6.0 adopt --config ./mcp.json
resilireplay studio --open
resilireplay campaign --help
resilireplay mcp audit --inspector-config ./mcp.json --server my-server --dry-run
```

Audit only local or user-owned targets. ResiliReplay is not an OS sandbox or security certification. Full documentation, plugin installation, compatibility evidence, schemas, and real demos: [github.com/aliengineering-byte/resilireplay](https://github.com/aliengineering-byte/resilireplay).
