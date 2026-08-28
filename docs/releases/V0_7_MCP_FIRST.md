# ResiliReplay 0.7.0 — MCP First

ResiliReplay now presents one primary product: deterministic MCP failure injection, bounded recovery
verification, duplicate-effect evidence, and executable regression generation.

## User-visible changes

- One-command, zero-configuration `mcp demo` from the npm package.
- Direct `mcp test` workflow with side-effect-free planning and exact digest approval.
- MCP-first README, website, CLI help, package description, and repository metadata.
- Standalone CI against the pinned official MCP Everything server using the packed CLI.
- Exact terminal transcript plus accessible PNG and animated demo asset.
- Clearer secondary documentation for agent runtimes and plugins.
- Monthly, grouped patch/minor dependency maintenance with one open PR per ecosystem.
- npm-first onboarding and OIDC trusted-publishing release gates.

## Compatibility

`mcp audit` is unchanged as a supported lower-level command. Campaign, replay, report, Studio,
adapter, connect, and capture commands remain available. The old root `demo` command remains a hidden
alias of `mcp demo`. Existing v0.3–v0.6 campaign evidence continues to validate. MCP-RES v0.1 and
v0.2 normative content is immutable and was not redefined for this product release.

## Safety and limits

The bundled demo uses a project-owned fixture, no network target, no credentials, and no telemetry.
Real-server execution requires a reviewed config entry, one tool allowlist entry, a safety
classification, finite time/resource bounds, and the exact dry-run plan digest. Persisted MCP
evidence is metadata-only.

The official Everything example is product-owned field validation, not an adopter claim. It proves
one inert operation over local stdio; it does not prove remote, authenticated production, load,
vendor endorsement, or security-certification behavior.

## First command

```console
npx --yes resilireplay@latest mcp demo
```
