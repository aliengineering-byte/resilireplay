# Independent MCP server selection

Selection was performed on 2026-08-04 from public npm metadata, public repositories, current
documentation, licenses, and project policies. The three included projects have separate upstream
organizations and repositories; no two are fixtures from one source tree.

## Included projects

| Project               | Pinned public source                                                                                     | Activity evidence                                    | License                                               | Transport | Safe operation                         | Authorization boundary                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- | --------- | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| MCP Everything Server | `@modelcontextprotocol/server-everything@2026.7.4`; `gitHead` `6dd0a683e198783e30feabf7abaf42f925bd18b1` | npm release 2026-07-04; repository pushed 2026-08-04 | Repository transition: Apache-2.0/MIT; docs CC-BY-4.0 | stdio     | `echo`, read-only/idempotent           | Local child process; generated text only; every other tool excluded                      |
| Playwright MCP        | `@playwright/mcp@0.0.78`; `gitHead` `5f8fc00210b27b4407c375b59cda4838045d429c`                           | npm release 2026-07-09; repository pushed 2026-08-04 | Apache-2.0                                            | stdio     | `browser_snapshot`, read-only          | Blank isolated headless page; no navigation, profile, file, credential, or remote target |
| UI5 MCP Server        | `@ui5/mcp-server@0.2.17`; `gitHead` `46f3ede7a0fa8e3aed3d801b9c5a1e7f340d32ea`                           | npm release 2026-07-27; repository pushed 2026-08-04 | Apache-2.0                                            | stdio     | `get_guidelines`, read-only/idempotent | Bundled guidance only; no project, lint, generation, file write, or remote data          |

Installation is from the exact public npm releases in each case-study lockfile. All three primary
runs use `resilireplay@0.3.0` installed in that case directory, not a workspace import.

### Why these three

- **Everything** provides a maintained official protocol surface and a minimal harmless echo oracle.
- **Playwright MCP** represents a stateful developer tool from a separate maintainer while allowing a
  disposable, non-navigating read-only operation.
- **UI5 MCP** represents an independent framework/tooling project and exposes bundled documentation
  without a user project or service credential.

Each project publishes an issue path. Everything and Playwright publish `SECURITY.md` and
`CONTRIBUTING.md`; UI5 publishes `CONTRIBUTING.md` but had no repository `SECURITY.md` at selection
time. Security-sensitive findings would use a private upstream route rather than a public issue.

## Rejected operations within selected servers

- Everything: sampling, elicitation, environment inspection, resource/file compression, and all
  non-echo tools.
- Playwright: navigation, clicks, form input, scripts, file upload, screenshots, storage, network
  inspection, and unsafe code execution.
- UI5: project inspection, linter execution, manifest validation, app/card generation, API lookups,
  and writable tools.

These exclusions prevent remote side effects, access to personal data, uncontrolled filesystem use,
and ambiguous authorization.

## Rejected candidates

| Candidate         | Pinned source                                                                                                   | License / transport | Safe operation considered              | Rejection reason                                                                                                                                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESLint MCP        | `@eslint/mcp@0.3.10`; `gitHead` `484e5917f77e744931918962a5852704ca6a4c69` in `eslint/rewrite`                  | Apache-2.0 / stdio  | `lint-files` on a disposable file      | The tool requires a non-empty array of absolute paths. ResiliReplay v0.3.0 intentionally generates schema-shaped placeholder arguments and cannot express that reviewed path without a new argument-override capability. A product feature was not added when safe alternatives existed. |
| MCP SQLite Server | `mcp-sqlite-server@1.0.1`; `gitHead` `5568ba9e46d8a75a4af258e20c258b533b2d9f38` in `ofershap/mcp-server-sqlite` | MIT / stdio         | Read schema from a disposable database | Its `better-sqlite3@11.10.0` dependency had no Node 24 Windows prebuild and required an unavailable C++ build toolchain. That failed the clean-install criterion on a supported ResiliReplay runtime.                                                                                    |

The rejected candidates were not characterized as defective. They were unsuitable for this bounded,
credential-free, cross-platform mission configuration.
