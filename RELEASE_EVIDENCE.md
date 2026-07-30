# v0.1.0 release evidence

Evidence date: 2026-07-30  
Workstation: Windows, local verification runtime Node 24.14.0 and pnpm 11.9.0  
Supported/CI matrix: Node 20 and 22 on Ubuntu and Windows

## Quality gate

Command:

```console
pnpm quality
```

Result: PASS (exit 0).

The aggregate command preserved these exact subcommands and results:

| Command              | Result                                                                    |
| -------------------- | ------------------------------------------------------------------------- |
| `pnpm format:check`  | PASS; all matched files use Prettier style                                |
| `pnpm lint`          | PASS; zero ESLint findings                                                |
| `pnpm typecheck`     | PASS; 12 workspace projects plus strict test/config typecheck             |
| `pnpm build`         | PASS; all 12 non-root workspace projects built                            |
| `pnpm test`          | PASS; 8 test files, 34 tests, 0 failed/skipped/flaky                      |
| `pnpm package:smoke` | PASS; five tarballs installed into a clean project; CLI returned `0.1.0`  |
| `pnpm secret:scan`   | PASS; no recognized credentials in working files or reachable Git history |
| `pnpm peers check`   | PASS; no peer-dependency issues                                           |

The 34 tests cover:

- event/schema/hash validation and deterministic JSONL;
- every declared generic and MCP fault;
- seed-stable injection and scenario hashing;
- deterministic replay/recovery metrics;
- first-critical-step selection;
- trace-to-regression generation and execution;
- terminal, JSON, HTML, JUnit, SARIF, manifest, and badge reports;
- MCP stdio discovery/calls against vulnerable and resilient servers;
- process timeout and process-tree cleanup;
- secret redaction and canary leakage;
- output path traversal;
- retry/loop budgets and duplicate side effects;
- Windows path/command quoting;
- no-network demo source invariant;
- CLI end-to-end recording and packed installation.

## Scenario and demo evidence

```console
pnpm exec resilireplay test scenarios
```

Result: PASS; 3/3 repository scenarios passed or validated.

```console
pnpm demo
```

Result: PASS.

- Recorded eight events from the real deterministic local subprocess.
- Injected three faults: HTTP 429, delayed tool result, wrong-recipient handoff.
- Recovered run: PASS, 100/100, retry budget 1/3.
- Unrecovered malformed-response run: expected FAIL, 67/100, first critical step `demo-failure-step-2`.
- Generated regression test: 1 passed, 0 failed.
- Source trace SHA-256 prefix: `084eab656dd0`.
- Minimized fixture SHA-256 prefix: `4694db8a3285`.

```console
pnpm demo:mcp
```

Result: PASS.

- Intentionally vulnerable toy server: two expected safe findings; certification failed as designed.
- Resilient toy server: zero findings; certification passed.
- Both servers used official-SDK stdio transport, bounded calls, and no model key.

```console
pnpm exec resilireplay record --output runs/cli-check/trace.jsonl -- node examples/deterministic-agent/dist/index.js
```

Result: PASS; eight validated events recorded and subprocess exit code 0.

## Security review

- No telemetry implementation.
- Deterministic agent demo has no network client or URL.
- Real secret patterns are redacted before trace storage.
- Only the explicit fake canary `CHAOS_CANARY_DO_NOT_EXPOSE_12345` is used.
- Output containment, temporary fixture ownership, subprocess deadlines, process cleanup, MCP ownership acknowledgement, and loopback defaults are tested or documented.
- MCP tools other than the reserved safe probe require explicit `--call-tools`.
- Final pre-commit secret scan: PASS.

## CI and publication

Workflow definitions cover Ubuntu/Windows, Node 20/22, format, lint, strict typecheck, tests, build, scenario execution, package smoke, no-network demo, MCP stdio demo, SARIF upload, Dependabot, and two secret scanners.

Public repository: `https://github.com/alivvvvvvvvvvvvveng-coder/resilireplay`.

The first clean GitHub Actions run exposed two publication-only portability defects. The packed-package smoke workspace incorrectly required dependency metadata to be available offline from a separate workspace, and the third-party Gitleaks v2 action generated an invalid parent range for the repository's first push. The repository's own full-tree and reachable-history secret scanner passed that run, and all Ubuntu/Windows Node 20/22 platform jobs passed.

The release correction permits registry resolution for external dependencies while continuing to install every ResiliReplay workspace package from its packed local tarball, updates the Gitleaks action runtime, and makes SARIF upload conditional on the report being present. No product feature or architecture changed. The complete local release gate, demos, and scenarios passed again before the still-unpublished annotated tag was moved to this correction commit.

## Known limitations

- Streamable HTTP client support is implemented, but the v0.1.0 integration suite exercises stdio; a dedicated HTTP server fixture is post-v0.1 work.
- Causal minimization is strongest when adapters supply `parentId` and `causeId`; unstructured traces retain explicit fault/validation/recovery evidence conservatively.
- `record` is not a sandbox. It runs only the command a user explicitly supplies.
- MCP `--call-tools` can invoke server side effects and must be used only after review.
- v0.1.0 aggregates streaming provider output into response events and does not sign report manifests.
- npm publication is intentionally not performed.
