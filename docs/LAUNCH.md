# v0.3.0 launch reference

This copy stays inside verified product behavior. It does not claim that a community submission was
made; any external submission status must be checked separately.

## Public links

- Repository: https://github.com/aliengineering-byte/resilireplay
- Release: https://github.com/aliengineering-byte/resilireplay/releases/tag/v0.3.0
- npm: https://www.npmjs.com/package/resilireplay/v/0.3.0
- Verified path: `pnpm install --frozen-lockfile && pnpm build && pnpm demo:studio`

## Suggested Show HN title

> Show HN: ResiliReplay Studio – prove MCP recovery and keep it fixed

## Suggested first comment

> I built ResiliReplay because interactive MCP debugging shows the happy path well, but it does not
> answer whether a server recovers safely from a timeout, error, malformed response, or unsafe tool
> output—and whether that recovery stays fixed.
>
> v0.3.0 adds a loopback Studio and versioned campaigns over the existing deterministic fault, trace,
> MCP, reporting, and regression engines. A campaign imports a reviewed Inspector-shaped config,
> declares seeds/budgets/expectations, runs resilient and intentionally vulnerable controls, compares
> an approved baseline, and exports an executable causal regression.
>
> The quick start uses local repository fixtures, needs no model key or external account, and covers
> stdio plus authenticated Streamable HTTP. Tool calls require an explicit allowlist and confirmation
> of the reviewed campaign hash.
>
> The sharp edges are documented: commands are not OS-sandboxed, allowlisted MCP tools can have side
> effects, Studio is local rather than hosted, Inspector OAuth/modern protocol-era settings are not
> imported, and hashes provide integrity rather than signer identity.
>
> I would value criticism of the campaign schema, baseline thresholds, causal evidence, and whether
> this is useful in real MCP CI.

This copy makes no novelty, adoption, benchmark, or universal security claim and asks for no votes or
coordinated promotion.
