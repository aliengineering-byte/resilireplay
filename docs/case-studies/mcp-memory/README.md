# MCP Memory: bounded reliability evidence

Result: `PUBLIC_LOCAL_SERVER / M4 REGRESSION_VERIFIED / stdio` with public
`resilireplay@0.6.0`. All three declared expectations matched in 6,051 ms.

## Pinned source and selection

- Repository: [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)
- Package: `@modelcontextprotocol/server-memory@2026.7.4`
- npm `gitHead`: `6dd0a683e198783e30feabf7abaf42f925bd18b1`
- npm integrity: `sha512-D+NNzChsOHN72y58ngDmO+TzjJijGi/sSY/gBydhB3TJCcm1XQEozVWwEpruHeXt/HSkMV3Z/BpHDhdt1MLD5w==`
- License: official repository Apache-2.0/MIT transition; documentation CC-BY-4.0

`read_graph` was selected because the public server documents it as a no-input read of the graph and
marks it read-only/idempotent in the shipped tool definition. The isolated installed package had no
default graph file, so the clean result was an empty graph and no persistence write was made.

## Boundary

Local stdio only; no credential, remote endpoint, production data, or mutation tool. The campaign
allowlist contained only `read_graph`. Concurrency was `1`, retry ceiling `1`, and raw tool bodies were
omitted with `metadata-only`.

## Actual result

- Clean control passed.
- One injected `mcp-tool-error` recovered in one retry and 1 ms, with zero duplicate-side-effect
  attempts and safety-policy compliance.
- The synthetic canary scenario produced the declared failed underlying outcome, did not leak the
  canary, and generated a regression that executed successfully.
- Campaign hash: `64024d11804aac90cfd9a20bf142ddd77f87413a303250a1b0044eeac918493c`.
- Config hash: `232dcfc4de0744b2c0250d3e3f9238c4bab17a0f7c718f12727e15657864f71f`.
- Run hash: `573e924c776bdda4d40f9f65d699bccd64bce8473a08c60ca25f5af242ae3ae0`.

## Reproduce

```console
pnpm install --ignore-workspace --frozen-lockfile --dir docs/case-studies/mcp-memory
npx --yes resilireplay@0.6.0 campaign validate docs/case-studies/mcp-memory/campaign.yml
npx --yes resilireplay@0.6.0 campaign run docs/case-studies/mcp-memory/campaign.yml \
  --confirm-tools 64024d11804aac90cfd9a20bf142ddd77f87413a303250a1b0044eeac918493c \
  --output runs/mcp-memory-field-test
node --test docs/case-studies/mcp-memory/regression/regression.test.mjs
```

The reviewed hash applies to this campaign revision. Validate again after any edit.

## Limitations and cleanup

This does not test graph mutation, non-empty state, other tools, another package version, load, or
production behavior. The campaign transport closed all target processes; a post-run process check
found no matching server process and no listener was opened. Remove only the selected run directory
and local `node_modules` when finished.

Synthetic injected failures are reliability test conditions, not discovered vulnerabilities. This is
bounded reliability evidence, not certification, adoption, endorsement, or a security audit.
