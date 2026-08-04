# Maintainer outreach log

Outreach is limited to one personalized, policy-compliant item per selected project. Messages ask for
technical feedback, not stars, and link only to project-specific public evidence. Potential security
issues are not posted publicly.

Evidence commit: `553acd4f8bca7d0d8245a7b8d9f266ddb738d66c`
Review date: 2026-08-04 (America/New_York)

## MCP Everything Server — posted

- Policy reviewed: upstream `CONTRIBUTING.md`, `SECURITY.md`, and `CODE_OF_CONDUCT.md` in full.
- Duplicate search: `ResiliReplay`, `fault injection`, `reliability testing`, `retry`, `recovery`, and
  `tool error` across issues; Discussions are disabled.
- Chosen path: one comment on existing open issue
  [#3401, Add tool annotations to server-everything](https://github.com/modelcontextprotocol/servers/issues/3401),
  because it already proposes `echo` as read-only and idempotent. No new issue was opened.
- Posted item:
  [issue comment 5185222158](https://github.com/modelcontextprotocol/servers/issues/3401#issuecomment-5185222158).
- Response status at publication: awaiting maintainer response.

Exact message:

> A bounded field-test datapoint for the proposed `echo` annotations: I ran public
> `resilireplay@0.3.0` against pinned `@modelcontextprotocol/server-everything@2026.7.4`
> (`gitHead` `6dd0a683e198783e30feabf7abaf42f925bd18b1`) over local stdio, with only `echo`
> allowlisted. The clean call passed; a synthetic result-level tool error recovered on exactly one
> retry; an expected canary failure produced and executed a regression; and the approved baseline
> compared with zero differences.
>
> The sanitized case includes the exact config, declared expectations, actual results, hashes,
> compact evidence, and reproduction commands:
> https://github.com/aliengineering-byte/resilireplay/blob/553acd4f8bca7d0d8245a7b8d9f266ddb738d66c/docs/case-studies/mcp-everything/README.md
>
> This is synthetic reliability evidence, not a vulnerability report, security certification,
> ranking, or upstream endorsement. The case treats `echo` as read-only and idempotent, which matches
> the annotations proposed here. Maintainer question: is one consumer retry after a result-level
> tool error a realistic minimal behavior for this reference tool, or would a different
> failure/recovery boundary be more useful to demonstrate?

## Playwright MCP — prepared, not posted

- Policy reviewed: upstream `CONTRIBUTING.md` and Microsoft `SECURITY.md` in full.
- Duplicate search: `ResiliReplay`, `fault injection`, `reliability testing`, `retry`, `recovery`,
  and `browser_snapshot error` across issues.
- Disposition: Discussions are disabled. The contribution policy directs bugs and feature proposals
  to issues, but this bounded run found neither. The nearest recovery threads were closed and covered
  different browser-disconnect/navigation failures. Posting a new question or attaching an unrelated
  promotional comment would not be a valid project path, so nothing was posted.
- Response status: not applicable.

Prepared message, retained for a future valid maintainer-requested channel:

> I ran public `resilireplay@0.3.0` against pinned `@playwright/mcp@0.0.78` (`gitHead`
> `5f8fc00210b27b4407c375b59cda4838045d429c`) over local stdio. Only
> `browser_snapshot` on a blank, isolated headless page was allowed. The pre-install attempt correctly
> returned an error because Chrome for Testing was absent; after the documented install, the clean
> call passed, one synthetic result-level error recovered on one retry, an expected canary failure
> generated an executable regression, and the baseline compared with zero differences. Reproducible
> case:
> https://github.com/aliengineering-byte/resilireplay/blob/553acd4f8bca7d0d8245a7b8d9f266ddb738d66c/docs/case-studies/playwright-mcp/README.md
> This is bounded reliability evidence, not a vulnerability report, certification, or endorsement.
> Is a blank-page snapshot plus one result-level retry representative of a useful safe minimum, or
> would a different read-only recovery boundary better match real clients?

## UI5 MCP Server — prepared, not posted

- Policy reviewed: upstream `CONTRIBUTING.md`, bug template, feature template, and issue configuration
  in full. The repository security policy link was respected; no security finding was present.
- Duplicate search: `ResiliReplay`, `fault injection`, `reliability testing`, `retry`, `recovery`, and
  `get_guidelines` across issues.
- Disposition: Discussions are disabled. The project explicitly limits issues to current UI5 MCP
  defects or features and says it cannot process questions or consultation requests. This run found
  no current UI5 defect and requested no feature, so nothing was posted.
- Response status: not applicable.

Prepared message, retained for a future valid maintainer-requested channel:

> I ran public `resilireplay@0.3.0` against pinned `@ui5/mcp-server@0.2.17` (`gitHead`
> `46f3ede7a0fa8e3aed3d801b9c5a1e7f340d32ea`) over local stdio, allowing only the annotated
> read-only, idempotent `get_guidelines` operation with empty input. The clean call passed; one
> synthetic result-level error recovered on one retry; an expected canary failure generated and
> executed a regression; and the baseline compared with zero differences. Reproducible case:
> https://github.com/aliengineering-byte/resilireplay/blob/553acd4f8bca7d0d8245a7b8d9f266ddb738d66c/docs/case-studies/ui5-mcp/README.md
> This is bounded reliability evidence, not a vulnerability report, certification, or endorsement.
> Is this bundled-content tool a representative safe minimum for UI5 MCP reliability testing, or
> would maintainers prefer another read-only boundary?
