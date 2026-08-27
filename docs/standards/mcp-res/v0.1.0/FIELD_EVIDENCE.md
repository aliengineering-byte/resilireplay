# Draft field evidence

Both rows use the `mcp-res/server-tool-call/v1` profile with `GENUINE_RUNTIME` evidence on Windows x64, Node 24.19.0, local stdio, concurrency one, read-only/inert operations, synthetic deterministic faults, one bounded retry, expected-failure control, executed regression, and zero remaining owned processes/listeners.

| Subject                            | Pin                                                                                                                                        | Operation                  | Evidence                                                                                      | Result | Independence note                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | --------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| ResiliReplay resilient MCP fixture | source SHA-256 `e65bdf619064419629bd5b46a52311ab2fd4d8843a650992c0b0d993cfc27c78`                                                          | `reliability_probe`        | [`resilireplay-mcp-demo.mcp-res.json`](field-evidence/resilireplay-mcp-demo.mcp-res.json)     | PASS   | Reference implementation's own local subject.                                |
| MCP Everything Server              | npm `@modelcontextprotocol/server-everything@2026.7.4`, tarball SHA-256 `ece23eb0e5252fb63449fb2e8b90676062d1344bf47e53417c8e422b4a18b765` | annotated read-only `echo` | [`mcp-everything-2026.7.4.mcp-res.json`](field-evidence/mcp-everything-2026.7.4.mcp-res.json) | PASS   | Independent public subject; evaluated by ResiliReplay, not an adopter claim. |

The integrity-bound sanitized source projections are [`resilireplay-mcp-demo.json`](reference-inputs/resilireplay-mcp-demo.json) and [`mcp-everything-2026.7.4.json`](reference-inputs/mcp-everything-2026.7.4.json). Each records the original run-manifest digest and size without publishing the raw trace or synthetic canary content.

Coverage across the two subjects includes clean controls, bounded successful recovery, expected-failure negative controls, integrity alteration rejection, encoded-secret rejection, and cleanup interruption rejection. The latter three are standard vectors applied to the same profile, not claims of upstream vulnerabilities.

Limitations: two subjects, one tool each, one Windows runtime, and no durable side effect. The evidence does not cover every MCP feature, operating system, protocol revision, server tool, or failure mode.
