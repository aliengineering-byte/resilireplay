# Real MCP reliability CI

This standalone example tests the official MCP Everything reference server with the packed
ResiliReplay npm package. It is product-owned validation, not an independent adopter claim.

## Pinned subject

| Boundary          | Pinned value                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| Server            | `@modelcontextprotocol/server-everything@2026.8.18`                                               |
| npm integrity     | `sha512-sBW2l6uMa9ii78QixTKjXgNSv/Ad6LB8cTGBApJMytHe+VCufLQyME55JbLl/0+fcLmcx93wsZ6ce+0aOF8YXA==` |
| MCP SDK/runtime   | `@modelcontextprotocol/sdk@1.30.0` on supported Node.js                                           |
| Protocol revision | `2025-11-25`                                                                                      |
| Transport         | local stdio, spawned without a shell                                                              |
| Operation         | `echo`                                                                                            |
| Side effects      | inert; returns its reviewed input and owns no external state                                      |

The server is the official reference/test server. ResiliReplay is the real MCP client for this
example: it connects over the SDK transport, discovers `echo`, calls it cleanly, injects one
`mcp-tool-error` at the result boundary, retries once, records duplicate-effect evidence, generates
an executable regression, runs it, and closes the client and child process.

## Run from a packed package

Build the repository package, then pass only its tarball to the standalone verifier:

```sh
pnpm build
npm pack ./packages/cli --pack-destination .artifacts/packed
node examples/mcp-reliability-ci/verify.mjs --tarball .artifacts/packed/resilireplay-0.7.0.tgz
```

The verifier creates a clean temporary npm project, installs the tarball plus the exact server and
SDK versions, and deletes the project after the checks. It never imports a private workspace
package. See [expected-output.txt](expected-output.txt) for the concise result shape and
[github-actions.yml](github-actions.yml) for a minimal CI job. The
[regression example](regression-example/) is copied directly from a successful packed-package run.

## What the verifier proves

1. The ResiliReplay tarball and pinned public MCP package install in a clean directory.
2. A real SDK client starts the real stdio server directly and negotiates MCP.
3. Tool discovery and a clean inert `echo` call succeed.
4. A deterministic tool-result fault is observed and recovery is bounded to one retry.
5. Duplicate effects are counted as zero for the inert operation.
6. The packed CLI generates and executes a causal regression in isolation.
7. The client closes, the child exits, listener counts return to baseline, and temporary state is removed.
8. Persisted evidence contains metadata and hashes, not tool bodies, credentials, or private paths.

Limitations: this is one local stdio reference server and one inert operation. It does not establish
remote transport behavior, authenticated production behavior, load characteristics, vendor
endorsement, or independent adoption.
