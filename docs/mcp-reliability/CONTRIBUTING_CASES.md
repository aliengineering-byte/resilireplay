# Contributing MCP reliability cases

Contributions are welcome for reproducible field cases, compatibility results, missing boundaries,
and generated regressions. A contribution documents evidence; it does not certify, endorse, or
publicly audit a project for security.

## Before execution

1. Select a maintained, license-compatible package and pin its version, registry integrity, source
   revision, and license evidence.
2. Prefer local stdio or authenticated loopback fixtures. Use a remote target only when you own the
   disposable sandbox and can state that authorization publicly.
3. Review source and documentation for one operation. Classify it using
   [EVIDENCE_PROFILES.md](EVIDENCE_PROFILES.md). Reject destructive, credential-bearing, paid,
   production, or unclear operations.
4. Create an Inspector-shaped config and run `mcp audit --dry-run`. No secret value belongs in the
   config; use an environment reference when authentication is genuinely required.
5. Start with concurrency `1`, retries at most `1`, local data, and explicit timeouts. Validation
   prints the exact campaign hash that binds tool-call consent.

## Minimum execution

Run a clean control, one relevant deterministic fault, and one expected-failure negative control.
Never inject a fault into a third-party remote endpoint without explicit authority. Do not select a
write tool merely to make the demo interesting.

Record failed setup attempts honestly. A missing runtime, incompatible schema, failed clean control,
or authorization blocker is `CONFIG_VALIDATED`, `DOCUMENTED_ONLY`, or invalid evidence; it is not a
successful field case.

## Case directory

Create `docs/case-studies/<slug>/` containing:

- `README.md`: pinned source, selection reason, authority, exact operation, results, limitations,
  cleanup, and reproduction;
- `package.json` and lockfile with exact versions;
- `mcp.json` with only value-free environment references;
- `campaign.yml` with exact allowlist, reviewed arguments, seed, and budgets;
- `summary.json` following [RESULT_SCHEMA.md](RESULT_SCHEMA.md);
- `terminal.txt` with ANSI removed and private paths replaced by `<repository>`;
- `regression/` when generated, including manifest, scenario, fixture, and executable test;
- `ARTIFACTS.sha256` generated after the final content is stable.

Screenshots are optional. If included, they MUST be generated from the real sanitized transcript,
remain readable on a phone, include descriptive alt text, and never replace machine evidence.

## Redaction and integrity review

Before committing:

```console
git grep -n -I -E '(Authorization:|Bearer[[:space:]]|sk-[A-Za-z0-9]|gh[opsu]_|AKIA)'
git grep -n -I -E '([A-Z]:\\Users\\|/Users/|/home/)'
node --test docs/case-studies/<slug>/regression/regression.test.mjs
```

Also inspect application-specific data that pattern matching cannot recognize. Do not publish raw
production traces, customer data, browser profiles, cookies, tokens, private hostnames, or usernames.
Recompute hashes after every edit.

## Cleanup

Stop only the process started for the case. Verify that its listener closed, remove its exact run
directory and disposable state, and keep the pinned dependency lockfile. Never use a recursive delete
against a home directory, repository root, unresolved variable, or wildcard.

## Submission paths

Use the repository issue forms for a sanitized field case, compatibility result, missing boundary, or
regression contribution. Possible vulnerabilities go through private security reporting. A public
case MUST include limitations and this disclosure:

> Synthetic injected failures are reliability test conditions, not discovered vulnerabilities. This
> result is bounded reliability evidence, not certification or endorsement.
