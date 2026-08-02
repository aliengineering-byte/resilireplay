# v0.2.0 release evidence

Evidence date: 2026-08-02

Local verification: Windows, Node 24.14.0, pnpm 11.9.0

Supported CI matrix: Node 20 and 22 on Ubuntu and Windows

## Baseline and scope

- Frozen baseline: clean `main` at `053f2dfac4c515f04377c9756ab2934e0c3c3347`, aligned with
  `origin/main` before implementation.
- Previous immutable release: `v0.1.0`, annotated tag object
  `724ee89ccc1c34d34242d35b01852c1f7cd22f57`, resolving to
  `0d78460c80176a04809b3f947e355fdc4753539f`.
- Inspector compatibility reference: stable MCP Inspector `2.0.0`, commit
  `7aebf168e6277ea26b1f04a7987a1cd11328ec83`.
- Baseline gate: 34/34 tests passed before implementation. The baseline had real stdio coverage but
  no successful real Streamable HTTP integration test.

## Aggregate local gate

Command:

```console
pnpm quality
```

Result: PASS (exit 0).

| Gate           | Verified result                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Formatting     | Prettier check passed                                                                                              |
| Lint           | ESLint passed with zero findings                                                                                   |
| Strict types   | All 13 non-root workspaces plus test/config typecheck passed                                                       |
| Build          | All 13 non-root workspaces built                                                                                   |
| Tests          | 9/9 files, 48/48 tests, zero failed or skipped                                                                     |
| Packed install | Five v0.2.0 tarballs installed into a clean project; CLI reported `0.2.0`                                          |
| Secret scan    | Working tree and reachable history passed                                                                          |
| Hygiene scan   | Tracked/generated content contained no personal emails, workstation paths, private artifacts, or stale owner links |

The 13 Inspector-specific tests exercise reviewed config import, single/multi-server selection,
stdio argument boundaries and paths with spaces, Windows/POSIX path classification, value-free
environment/header plans, deprecated SSE parsing, authenticated real Streamable HTTP, controlled
failure, malformed HTTP, remote authorization, duplicate-key and unknown-field rejection,
path/symlink containment, startup/protocol/timeout failures, child/listener cleanup, secret-output
redaction, recovery scoring, generated-regression execution, and stable CLI exit codes 10–13.

## Scenario and demo evidence

```console
pnpm exec resilireplay test scenarios
pnpm demo
pnpm demo:mcp
python scripts/generate-demo-assets.py
```

Result: PASS.

- Repository scenarios: 3/3 passed or validated as declared.
- General no-key demo: recovered run PASS at 100/100; expected malformed-response run FAIL at
  67/100; generated `node:test` 1 passed, 0 failed.
- Inspector integration demo: reviewed stdio config imported; resilient server passed; intentionally
  vulnerable server produced the expected failure; bounded retry recovered the retryable fault; the
  unsafe fault failed; the compiled regression executed successfully.
- A real authenticated Streamable HTTP server bound to an ephemeral loopback port and passed. Its
  listener was closed by the demo and cleanup is independently tested.
- The committed Inspector transcript is path-free. The GIF is 1000×630 and 110,998 bytes; its static
  PNG fallback is 1000×630 and 73,789 bytes.

The final demo manifest linked five distinct SHA-256 values:

| Evidence                | SHA-256                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| Inspector source config | `10d4ce1d793e6d041b1ee50b98d1dbe4aab550bf25833ca135b8dfe686ca700c` |
| Failed source trace     | `b2decefe42be3e44e5929d35b65c27dd456ae19b5cf33e4b4250ab87420816ec` |
| Generated scenario      | `31fb2544972481f95993185dffad36c5540c2915a60078327ac9733b89126a3a` |
| Minimized fixture       | `b83b939a54eb709b5efdf1386188f145b1cc8a985be6e0f770ce82ef82cbc30b` |
| Executable test         | `de18bdc89ef14727bf4564afcc550e643c0fe09bf6fab63ebdec30a89e3f3960` |

## Security invariants verified

- Imported Inspector files are read-only and never rewritten or migrated.
- Stdio uses direct executable/argument invocation without a shell.
- Relative executable, argument, and working-directory paths remain inside the allowed repository
  root, including realpath checks against link escapes.
- Imported environment and header values remain in memory and are represented as `[REDACTED]` in
  plans, traces, certifications, reports, badges, and error output.
- Credential-shaped raw, URL-encoded, Basic/base64, and sensitive-key output is detected before
  persistence.
- Remote HTTP requires explicit authorization; URL credentials, header injection, Inspector auth
  bypass, and Inspector proxy session tokens fail closed.
- Dry-run performs no connection and creates no evidence directory.

## CI and release verification

CI definitions run the complete test suite on Ubuntu and Windows with Node 20 and 22. The quality job
also runs the focused Inspector/real-HTTP integration and both demos. The tag workflow reruns the
aggregate gate and demos and uploads `runs/demo` plus `runs/mcp-inspector-demo` as release evidence.
Public run URLs and immutable tag verification are recorded in the append-only mission log after the
remote gates complete.

## Honest limitations

- The compatibility boundary is reviewed MCP Inspector 2.0.0 `mcp.json`; interactive OAuth,
  `protocolEra: "modern"`, and extended Inspector-only runtime settings fail explicitly.
- Legacy SSE is parsed for backwards compatibility but Streamable HTTP is preferred.
- `record` is not an OS sandbox, and explicit MCP tool calls can have server-side effects.
- Report hashes prove integrity and linkage, not signer identity; manifests are unsigned.
- Packages are verified as tarballs but are not published to npm.
