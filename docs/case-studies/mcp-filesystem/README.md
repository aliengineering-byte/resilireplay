# MCP Filesystem: bounded reliability evidence

Result: `PUBLIC_LOCAL_SERVER / M4 REGRESSION_VERIFIED / stdio` with public
`resilireplay@0.6.0`. All three declared expectations matched in 6,286 ms.

## Pinned source and selection

- Repository: [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)
- Package: `@modelcontextprotocol/server-filesystem@2026.7.10`
- npm `gitHead`: `9a96ea6e5913736f92b88345bf51caeaaa8e719f`
- npm integrity: `sha512-Mmjg4anFBD5OzbPnGJOA0jPPN8645ERhQk38HQLpSenx1ox9bfdPkmAzUnNjeQtqQGFLtKe13J20RtLBmUKMZA==`
- License: official repository Apache-2.0/MIT transition; documentation CC-BY-4.0

`list_directory` was selected because the reviewed operation is read-only and idempotent. Its only
argument was the checked-in `examples/mcp-reliability/fixtures/filesystem-root` directory containing
one synthetic public text file.

## Boundary

Local stdio only; no credential, remote endpoint, production data, or write tool. The server allowroot
was the one fixture directory and the campaign allowlist contained only `list_directory`.
Concurrency was `1`, retry ceiling `1`, and raw tool bodies were omitted with `metadata-only`.

## Actual result

- Clean control passed.
- One injected `mcp-tool-error` recovered in one retry and 2 ms, with zero duplicate-side-effect
  attempts and safety-policy compliance.
- The synthetic canary scenario produced the declared failed underlying outcome, did not leak the
  canary, and generated a regression that executed successfully.
- Campaign hash: `4a297a7a2047439c9b3443c7fdb8f228e6c32498a21da83aa633560cd3602810`.
- Config hash: `f8dc5615af0f9c775789a8a9c2eff959a95fda3e1e7d438ed244d54c04ca3fa8`.
- Run hash: `bd64d1c1440a32734981e891bd07867de95223f491357f762941e374f7e103d5`.

## Reproduce

```console
pnpm install --ignore-workspace --frozen-lockfile --dir docs/case-studies/mcp-filesystem
npx --yes resilireplay@0.6.0 campaign validate docs/case-studies/mcp-filesystem/campaign.yml
npx --yes resilireplay@0.6.0 campaign run docs/case-studies/mcp-filesystem/campaign.yml \
  --confirm-tools 4a297a7a2047439c9b3443c7fdb8f228e6c32498a21da83aa633560cd3602810 \
  --output runs/mcp-filesystem-field-test
node --test docs/case-studies/mcp-filesystem/regression/regression.test.mjs
```

The reviewed hash applies to this campaign revision. Validate again after any edit.

## Limitations and cleanup

This does not test writes, other filesystem tools, another directory, another package version, load,
or production behavior. The campaign transport closed all target processes; a post-run process check
found no matching server process and no network listener was opened. Remove only the selected run
directory and local `node_modules` when finished.

Synthetic injected failures are reliability test conditions, not discovered vulnerabilities. This is
bounded reliability evidence, not certification, adoption, endorsement, or a security audit.
