# Naming audit

Audit date: 2026-07-30. Exact-name checks covered GitHub repository search, npm registry responses, PyPI JSON responses, and normal web search. Results are factual collision checks, not trademark guarantees.

| Candidate               | GitHub exact repositories | npm exact package  | PyPI exact package | Normal web                                       | Decision                                              |
| ----------------------- | ------------------------: | ------------------ | ------------------ | ------------------------------------------------ | ----------------------------------------------------- |
| `resilireplay`          |                         0 | 404 / unregistered | 404 / unregistered | No exact product result                          | Selected: distinctive and describes resilience replay |
| `faultscript`           |                         0 | 404 / unregistered | 404 / unregistered | No exact product result                          | Clear but overly generic                              |
| `traceproof`            |  Multiple public products | Not decisive       | Not decisive       | Multiple active products, including AI workflows | Rejected as confusing                                 |
| `agent-reliability-lab` | 12 exact repository names | 404 / unregistered | 404 / unregistered | Crowded phrase                                   | Rejected as the fallback is no longer clear           |

The occupied or confusing names specified in the project brief—AgentChaos, AgentFuzz, AgentBreak, AgentCrash, AgentGauntlet, and FaultForge—were excluded before shortlisting.

Final product name: **ResiliReplay**. Package scope: `@resilireplay/*`. CLI and intended repository: `resilireplay`.

The repository remains in the mandated isolated workstation directory `E:\AI-Workbench\AgentReliabilityLab`; renaming that directory would conflict with the explicit isolation boundary.
