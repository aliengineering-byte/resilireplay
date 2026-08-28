# Future identity extension register

Observation date: **2026-08-27**. Future identity behavior never enters the provisional OAuth boundary implicitly.

| MCP-RES profile                               | Upstream basis                                                                           | Status here                     | Known boundary                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `mcp-res/oauth-client-credentials/v1`         | official MCP authorization-extension draft at `fb374c7db2b34f18ca9183882e0beecdf661892b` | `EXPERIMENTAL`                  | Not released core MCP behavior; negotiation and SDK coverage vary.                              |
| `mcp-res/enterprise-managed-authorization/v1` | official 2026-07-28 authorization extension at the same pinned commit                    | `EXPERIMENTAL`                  | Separate negotiated extension; deployment trust roots are external.                             |
| `mcp-res/dpop/v1`                             | RFC 9449                                                                                 | `EXPERIMENTAL`                  | Published OAuth behavior, but no released core MCP DPoP negotiation and incomplete SDK support. |
| `mcp-res/token-exchange/v1`                   | RFC 8693                                                                                 | `EXPERIMENTAL`                  | Published OAuth behavior, but no released core MCP token-exchange/delegated-agent profile.      |
| Workload identity                             | MCP roadmap only                                                                         | `DEFERRED_NORMATIVE_DEPENDENCY` | No sufficiently stable official MCP profile to test as released behavior.                       |
| Delegated agent identity                      | MCP roadmap only                                                                         | `DEFERRED_NORMATIVE_DEPENDENCY` | Agent-to-agent authority semantics remain moving.                                               |
| Human-presence attestation                    | no released MCP mechanism observed                                                       | `DEFERRED_NORMATIVE_DEPENDENCY` | No released negotiation, evidence, or verifier contract.                                        |

Every experimental manifest records its exact proposal/version, upstream status, immutable source, observation time, incompatibilities, and removal/migration path. Removing or superseding one requires a new profile version or explicit retirement record; experimental evidence is never promoted in place.
