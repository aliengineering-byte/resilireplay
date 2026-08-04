# Field-validation results

All primary executions below used public `resilireplay@0.3.0` and exact public server packages. Every
allowlist contained one reviewed read-only operation. Faults are synthetic ResiliReplay mutations,
not vulnerabilities in the tested servers.

| Project               | Revision                                   | Transport | Faults attempted                   | Recoveries | Expected failures | Invalid or blocked runs                                                                                          | Generated regression |  Runtime | Main limitation                                      |
| --------------------- | ------------------------------------------ | --------- | ---------------------------------- | ---------: | ----------------: | ---------------------------------------------------------------------------------------------------------------- | -------------------- | -------: | ---------------------------------------------------- |
| MCP Everything Server | `6dd0a683e198783e30feabf7abaf42f925bd18b1` | stdio     | none; tool error; malicious canary |        1/1 |               1/1 | Three setup-invalid scenarios before correcting a doubled test `cwd`; no protocol contact                        | pass                 | 2,697 ms | One echo tool on a protocol exercise server          |
| Playwright MCP        | `5f8fc00210b27b4407c375b59cda4838045d429c` | stdio     | none; tool error; malicious canary |        1/1 |               1/1 | One pre-install campaign did not recover because Chrome for Testing was absent; documented installer resolved it | pass                 | 4,790 ms | Blank isolated page; no navigation or browser action |
| UI5 MCP Server        | `46f3ede7a0fa8e3aed3d801b9c5a1e7f340d32ea` | stdio     | none; tool error; malicious canary |        1/1 |               1/1 | none                                                                                                             | pass                 | 4,600 ms | One bundled-guidelines tool; no project analysis     |

## Genuine executions

- **Everything:** the server received `echo({message: "resilireplay-audit"})`; the clean call returned,
  the injected result error recovered after one second call, and the canary mutation produced a
  declared failure with an executed regression.
- **Playwright MCP:** a fresh local server launched an isolated headless Chrome-for-Testing process and
  returned `browser_snapshot({})` for the blank page. The retry succeeded after one injected error.
- **UI5 MCP:** a fresh local server returned bundled UI5 guidelines from `get_guidelines({})`; the
  retry succeeded after one injected error.

All three baselines compared with zero differences. No external server supported Streamable HTTP as
the selected local primary path, so stdio was the relevant transport for all three. ResiliReplay's
real Streamable HTTP path remains covered by the verified local v0.3.0 demo and automated suite; it is
not presented as third-party evidence.

## Evidence and interpretation

- [MCP Everything case](../case-studies/mcp-everything/README.md)
- [Playwright MCP case](../case-studies/playwright-mcp/README.md)
- [UI5 MCP case](../case-studies/ui5-mcp/README.md)

“Pass” means the observed result matched that declared bounded campaign. It is not a universal score,
comparative ranking, upstream endorsement, or security certification. The projects are intentionally
not ranked against one another.

## Cleanup, security, and privacy

After the public case runs, zero repository-owned child server/browser processes and zero
repository-owned listening sockets remained. Compact committed evidence was scanned for credentials,
authorization headers, private paths, and personal information. No real secret, token, personal
data, or production trace was used. One browser installer initially wrote two package-version cache
directories outside the repository; both were moved back under the ignored repository evidence area,
leaving the pre-existing browser cache untouched.
