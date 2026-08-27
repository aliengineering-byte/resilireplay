# Contributing to MCP-RES

Start with a GitHub Discussion or repository issue for a behavioral change. A complete pull request includes a narrow requirement, schema impact, positive vector, expected-failure vector, stable diagnostic, privacy analysis, compatibility note, and documentation. Run:

```console
pnpm install --frozen-lockfile
pnpm mcp-res:generate -- --check
pnpm mcp-res:validate
pnpm site:check
```

Never commit a credential, authorization header, environment value, private prompt/transcript, unrestricted tool body, or personal absolute path. Use synthetic inert subjects and synthetic fault markers. Third-party package evidence MUST use exact public versions and MUST say that MCP-RES was evaluated by this project; it MUST NOT call the package an adopter.

Normative requirements use BCP 14 uppercase terms. Informative examples do not add requirements. All new execution-affecting JSON fields MUST be closed and bounded.
