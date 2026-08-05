# Ecosystem

ResiliReplay v0.5.0 provides one local-first reliability core across coding-agent hooks, Agent Skills, MCP clients, and outside adapters.

## Integration paths

| Ecosystem            | Path                                             | Release evidence                |
| -------------------- | ------------------------------------------------ | ------------------------------- |
| Claude Code          | Marketplace plugin with stable hooks, skill, MCP | Installation + fixture verified |
| Codex                | Repo marketplace plugin with hooks, skill, MCP   | Installation + fixture verified |
| Hermes Agent         | Local skill plus stdio MCP registration          | Installation verified           |
| Agent Skills clients | `plugins/resilireplay/skills/resilireplay`       | Official format validated       |
| MCP clients          | `npx --yes resilireplay@0.5.0 mcp serve`         | Live SDK/Inspector verified     |
| New agents           | `adapter init` / `adapter verify`                | Contract fixture verified       |

Hermes’ current contribution policy routes specialized community skills to the Skills Hub rather than the upstream core/optional bundle. ResiliReplay therefore publishes the downstream skill and MCP integration and does not open a promotional upstream PR.

## Candidate adapters

Scoped public issues track [LangGraph #29](https://github.com/aliengineering-byte/resilireplay/issues/29), [OpenAI Agents SDK #30](https://github.com/aliengineering-byte/resilireplay/issues/30), [Gemini CLI #33](https://github.com/aliengineering-byte/resilireplay/issues/33), [OpenCode #34](https://github.com/aliengineering-byte/resilireplay/issues/34), [Goose #35](https://github.com/aliengineering-byte/resilireplay/issues/35), and [Cursor #36](https://github.com/aliengineering-byte/resilireplay/issues/36). A candidate is complete only when documented stable events can map to the public schema, privacy fixtures pass, installation is reproducible, and the evidence level is public. Existing issues #29–#31 were updated rather than duplicated; #31 remains the separate bounded streaming-fault experiment.

## Sustainable adoption

The bird-seed loop is one reproducible failure or compatibility result per week, followed by one conformance improvement. Maintainer outreach must be personal, policy-valid, and backed by relevant public evidence. There is no automated promotion, mass messaging, purchased engagement, or counting of owner/CI activity as adoption.

The append-only [adoption ledger](../ADOPTION_LEDGER.md) accepts only public external installs voluntarily reported, external field reports/issues/PRs, directory or marketplace decisions, maintainer responses, and public compatibility runs.
