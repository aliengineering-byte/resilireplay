# Framework Support Policy (v0.6)

## Tiering

### Tier 1 (verified)
- **LangGraph**: adapter implemented with real runtime fixtures.
- **OpenAI Agents SDK**: adapter implemented with real runtime fixtures.

### Tier 2 (targeted)
- **AutoGen**: bridge verified only where stable public instrumentation is sufficient.

### Tier 3 (documented)
- **CrewAI**: documented integration status based on public callback/tracing capabilities.
- **LlamaIndex**: documented integration status based on public callback API behavior.

## Verification language

A framework is called **verified** only when:
- Required scenarios are executed against pinned, deterministic fixtures.
- At least one failure scenario produces passing regression evidence.
- Replay and baseline comparison are deterministic.

A framework is **documented** when:
- API references are stable and integration is safe but lacks deterministic, executable proof.

A framework is **unsupported** when:
- No stable public causal trace contract exists.
- Required data cannot be captured without private monkey-patching.

## Status publication

`docs/ARCHITECTURE.md`, `docs/ADAPTERS.md`, and each adapter README must use the same tier language and include explicit limitations.
