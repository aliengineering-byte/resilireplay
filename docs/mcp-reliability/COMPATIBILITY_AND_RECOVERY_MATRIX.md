# MCP compatibility and recovery matrix

Executed evidence is pinned to the listed package, transport, operation, campaign, and ResiliReplay
version. A row does not imply whole-server compatibility, security, certification, or maintainer
endorsement. `M4` means a causal regression was generated and executed; see the
[standard levels](MCP_RELIABILITY_STANDARD.md#evidence-levels).

| Target                         | Profile / level                | Pinned version                                                    | Transport and reviewed operation                            | Clean / retry / expected failure                                          | Run hash                                                           | Limitation                                                    |
| ------------------------------ | ------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| ResiliReplay resilient fixture | `SYNTHETIC_LOCAL_FIXTURE / M4` | fixture built at v0.6.0 source                                    | stdio; `reliability_probe`, inert echo                      | pass / 1 retry recovered / canary failed as declared; regression verified | `8a20705b06ebdd9c649af9a5e4cbc84c9eea6a44c31bec520fcca9c6f0e9bc09` | Harness fixture, not external compatibility evidence          |
| ResiliReplay HTTP fixture      | `SYNTHETIC_LOCAL_FIXTURE / M2` | fixture built at v0.6.0 source                                    | authenticated loopback Streamable HTTP; `reliability_probe` | pass / 1 retry recovered / not run                                        | `2b8b49c76549fa5209ab65d692b573ac78b93bff95f899f836e2e0bf5ecf966d` | No HTTP expected-failure scenario; cannot claim M3            |
| MCP Everything                 | `PUBLIC_LOCAL_SERVER / M4`     | `@modelcontextprotocol/server-everything@2026.7.4`, `6dd0a683...` | stdio; `echo`                                               | pass / 1 retry recovered / canary failed as declared; regression verified | `2c4d3f38b338cb8c82a78840b5e0c820c05fd5cf02fd8c2a4da1c786a2ca56d5` | Product evidence generated with ResiliReplay 0.3.0            |
| Playwright MCP                 | `PUBLIC_LOCAL_SERVER / M4`     | `@playwright/mcp@0.0.78`, `5f8fc...`                              | stdio; `browser_snapshot` on isolated blank page            | pass / 1 retry recovered / canary failed as declared; regression verified | See [case](../case-studies/playwright-mcp/README.md)               | Blank disposable browser only; initial browser setup excluded |
| UI5 MCP Server                 | `PUBLIC_LOCAL_SERVER / M4`     | `@ui5/mcp-server@0.2.17`, `46f3...`                               | stdio; `get_guidelines`                                     | pass / 1 retry recovered / canary failed as declared; regression verified | See [case](../case-studies/ui5-mcp/README.md)                      | One read-only guideline operation only                        |
| MCP Filesystem                 | `PUBLIC_LOCAL_SERVER / M4`     | `@modelcontextprotocol/server-filesystem@2026.7.10`, `9a96ea6...` | stdio; `list_directory` on one public fixture directory     | pass / 1 retry, 2 ms / canary failed as declared; regression verified     | `bd64d1c1440a32734981e891bd07867de95223f491357f762941e374f7e103d5` | No writes and no path outside the fixture allowroot           |
| MCP Memory                     | `PUBLIC_LOCAL_SERVER / M4`     | `@modelcontextprotocol/server-memory@2026.7.4`, `6dd0a683...`     | stdio; `read_graph` with absent disposable graph            | pass / 1 retry, 1 ms / canary failed as declared; regression verified     | `573e924c776bdda4d40f9f65d699bccd64bce8473a08c60ca25f5af242ae3ae0` | Empty graph read only; no persistence mutation tested         |

The first three public-server cases predate v0.6.0 and remain labeled with their generating product
version inside each summary. The two 2026-08-08 additions use the public npm `resilireplay@0.6.0`
package. All public-server runs used local stdio, no API key, concurrency `1`, one read-only operation,
synthetic injected failures, and no production data.

## Candidate audit

The active official `modelcontextprotocol/servers` repository also published
`@modelcontextprotocol/server-sequential-thinking@2026.7.4`. It was reviewed but not executed because
its operation advances internal thought state rather than providing a clearly read-only external
observation. It remains `DOCUMENTED_MAPPING / M0`; no result was manufactured to fill the matrix.

The official repository license at the pinned revisions documents the Apache-2.0/MIT transition and
CC-BY-4.0 documentation boundary. Package names identify public test targets only.
