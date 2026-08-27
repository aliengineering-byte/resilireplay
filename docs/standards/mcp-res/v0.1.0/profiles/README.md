# MCP-RES v0.1.0 profiles

| Profile                           | Status        | Narrow claim                                                                                                                                                               |
| --------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp-res/server-tool-call/v1`     | `NORMATIVE`   | A bounded MCP server tool call has clean, fault, negative-control, recovery, privacy, integrity, and cleanup evidence. “Normative” means normative within this draft only. |
| `mcp-res/client-config-source/v1` | `PROVISIONAL` | A versioned client configuration source was parsed read-only under explicit budgets and privacy rules. It does not prove launch or connection.                             |
| `mcp-res/agent-tool-recovery/v1`  | `PROVISIONAL` | An agent or adapter exposed enough causal evidence to evaluate bounded tool recovery without promoting fixtures to runtime proof.                                          |

Gateway/proxy behavior, transport implementations, subscriptions, sampling, elicitation, and long-running tasks remain future profile work. A claim MUST identify exactly one profile version, subject type, evidence class, validator, and evidence digest.
