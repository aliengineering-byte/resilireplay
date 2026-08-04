# Product strategy: reliability evidence for agents and MCP

Verified against primary product/specification sources on 2026-08-04.

ResiliReplay is not another general MCP console. Its narrow category is deterministic recovery testing: introduce a declared failure, measure what the agent or server does next, retain sanitized causal evidence, compare that behavior with an approved baseline, and turn the failure into an executable regression.

## Honest capability matrix

| Product/category                                                                                                              | Primary job                                                                             | Visual/manual inspection                                              | Fault injection                                                                                                      | Recovery-quality measurement                                                                                            | Baseline/CI gate                                                                            | Failure-to-test export                                                                     | Local/no-key path                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| [MCP Inspector](https://github.com/modelcontextprotocol/inspector) v2                                                         | Inspect and debug MCP servers through web, CLI, or TUI using shared MCP client logic    | Strong: requests, responses, capabilities, apps, OAuth-oriented flows | No deterministic campaign system documented in the reviewed primary README                                           | Not its documented focus                                                                                                | CLI automation exists; no recovery baseline model documented in the reviewed primary README | Not documented                                                                             | Yes for local servers; its web backend is authenticated and supports stdio/HTTP                     |
| [MCPJam](https://docs.mcpjam.com/)                                                                                            | MCP/app development, manual debugging, OAuth conformance, model evals, SDK, and CI      | Strong: playground, raw traces, widgets, model/host comparison        | Expected-call evals and probes; no deterministic transport/tool failure campaign documented on the reviewed overview | Eval metrics, not a documented recovery-safety score after injected faults                                              | Yes, eval/check regression gates with JSON/JUnit                                            | Dataset/eval workflows rather than causal trace-to-executable-fault regression export      | Local Inspector/CLI exists; hosted/team surfaces also exist; model evals may require providers      |
| [WireMock fault simulation](https://wiremock.org/docs/simulating-faults/) / [Toxiproxy](https://github.com/Shopify/toxiproxy) | Mock HTTP services or perturb TCP/network conditions                                    | Configuration and traffic tooling, not agent causal UX                | Strong at delay, error, malformed response, reset, timeout, bandwidth, and connection faults                         | Leaves agent/MCP recovery semantics to the test author                                                                  | Integrates with ordinary tests/CI                                                           | No agent-trace reduction/export                                                            | Yes, but additional proxy/mock infrastructure is required                                           |
| [LangSmith](https://docs.langchain.com/langsmith/evaluation) as representative agent observability/evaluation                 | Trace applications, curate datasets, run offline/online evaluators, compare experiments | Strong trace/experiment UI                                            | Dataset cases and evaluators; not a documented deterministic MCP fault engine                                        | Can score runs with code, human, pairwise, or LLM evaluators                                                            | Yes                                                                                         | Failing traces can feed datasets; not the same as local causal fault-regression generation | Account and API key are part of the documented hosted quick start; hybrid/self-hosted options exist |
| **ResiliReplay v0.3.0**                                                                                                       | Prove bounded failure recovery and preserve verifiable local evidence                   | Focused Studio timeline, findings, baseline delta, downloads          | Deterministic trace and MCP fault scenarios with seeds and budgets                                                   | Deterministic completion, safe recovery, latency, retries, duplicates, policy, and evidence-supplied token/cost metrics | Versioned local baselines, explicit thresholds, CI exit codes, JUnit/SARIF/HTML/JSON        | Causal reduction to scenario, fixture, executable test, and hash manifest                  | Yes: no login, API key, Docker, telemetry, or hosted backend                                        |

The comparisons above describe documented capabilities, not popularity, quality, or endorsement. ResiliReplay is not endorsed by MCP Inspector, MCP maintainers, MCPJam, WireMock, Shopify, LangChain, or LangSmith.

## Defensible wedge

The durable sequence is:

```text
reviewed target -> deterministic fault -> observed recovery -> causal reduction
                -> approved baseline -> CI regression gate -> executable regression
```

Individual pieces exist elsewhere: Inspectors make protocol behavior visible, chaos proxies perturb dependencies, and observability products compare traces or evaluations. ResiliReplay’s product boundary is the verifiable connection among all seven steps without requiring an LLM judge or hosted control plane.

## Design consequences

1. Studio is an evidence navigator and safe campaign launcher, not a clone of Inspector’s general request composer.
2. Campaign and baseline documents are first-class, versioned product APIs; UI state is not the source of truth.
3. Metrics stay evidence-backed and nullable. A visually pleasing number is never substituted for missing adapter evidence.
4. Local fixtures and negative controls are part of product trust, not marketing decoration.
5. Security defaults follow the current MCP transport warning: validate Origin, bind local servers to `127.0.0.1`, and treat arbitrary tool execution as consent-requiring. See the [MCP 2025-11-25 transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) and [MCP security guidance](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices).

## Buyer/user and immediate use case

The initial user is an engineer who owns an MCP server or an agent integration and already has a reproducible local target. Their urgent question is not “can I call this tool?” but “will a timeout, malformed result, or retryable error cause an unsafe retry, a duplicate side effect, a loop, or a silent reliability regression?” The five-minute workflow must answer that question with artifacts they can review locally and enforce in CI.

## Honest limitations

- v0.3.0 does not infer business side effects; it reports duplicates only from observable calls and declared expectations.
- It does not prove correctness for faults or tools outside the declared campaign.
- Deterministic injection does not make a nondeterministic target deterministic.
- Remote production testing remains an explicit CLI-only authorization path, not a Studio default.
- It is complementary to Inspector/debugger and observability products, not a replacement for manual protocol debugging or production monitoring.
