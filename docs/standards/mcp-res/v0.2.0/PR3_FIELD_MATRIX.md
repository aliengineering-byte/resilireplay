# PR 3 protocol field matrix

The executable matrix is produced by `scripts/verify-mcp-res-protocol-field.mjs` on every MCP-RES CI leg: Ubuntu and Windows, Node 22 and 24, with Python 3.12. It uses two committed subject implementations (TypeScript executed with Node's type stripping and Python stdlib), both released protocol revisions, and stdio plus authenticated loopback Streamable HTTP.

| Dimension               | Executed values                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| OS / JavaScript runtime | Ubuntu and Windows × Node 22 and 24                                                                             |
| Subject language        | TypeScript and Python                                                                                           |
| Protocol revision       | `2025-11-25`, `2026-07-28`                                                                                      |
| Transport               | shell-free stdio; authenticated `127.0.0.1` HTTP with JSON and SSE                                              |
| Positive paths          | accepted revision-bound request, valid framing/content type, process/listener cleanup                           |
| Negative paths          | unsupported revision, missing HTTP authorization, malformed stdio input, redirect exposure without following it |
| Fault paths             | interrupted HTTP body, diagnostic separation, bounded child/listener shutdown                                   |
| Integrity               | exact subject SHA-256, profile-manifest SHA-256, reason-bound evaluation SHA-256                                |

Each CI leg emits eight bounded runtime evaluations. The field artifact records the exact platform and runtime versions supplied by that leg. No remote server is contacted and no public third-party package is described as an adopter. These fixture subjects establish validator portability and transport behavior only; they are not independent implementations for the stable-1.0 criterion.
