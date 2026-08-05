# Adopt an MCP server in under five minutes

`resilireplay adopt` turns one reviewed server entry from a repository-local,
Inspector-compatible MCP configuration into a deterministic recovery campaign, sanitized evidence,
an executable regression, and a pinned GitHub Actions workflow.

Requirements: Node.js 22 or 24, a project containing `mcp.json`, `.mcp.json`, or
`.vscode/mcp.json`, and a safe operation on a server you own or are authorized to test.

## Fast path

See the product work without an MCP server:

```console
npx --yes resilireplay@0.4.0 demo
```

Review a configuration without starting a process, opening a connection, calling a tool, or writing
files:

```console
npx --yes resilireplay@0.4.0 adopt --config ./mcp.json --dry-run
```

Then run the short interactive review:

```console
npx --yes resilireplay@0.4.0 adopt --config ./mcp.json
git add .resilireplay tests/resilireplay .github/workflows/resilireplay.yml
```

The command displays the exact process/argument boundary or HTTP origin before connecting. Values of
environment variables and credential-bearing headers are redacted. Tool annotations such as
`readOnlyHint` are displayed only as untrusted hints: no tool is selected or called automatically.
The selected tool, exact arguments, and suitability for one duplicate attempt require separate
review. `--yes` can confirm setup choices but cannot confirm tool execution or retry safety.

## Non-interactive use

Every safety-critical choice must be explicit:

```console
resilireplay adopt \
  --config ./mcp.json \
  --server fixture \
  --tool read_fixture \
  --arguments '{"path":"fixtures/public.json"}' \
  --safety read-only-idempotent \
  --confirm-target \
  --confirm-tool-execution \
  --confirm-retry-safe \
  --non-interactive \
  --json
```

Use `--allow-remote` only for a declared non-loopback endpoint you own or are authorized to audit.
It is an acknowledgement, not proof of ownership. For a reviewed operation that is idempotent but
not read-only, use `--safety reviewed-idempotent`; ResiliReplay never infers that classification from
server metadata.

## Discovery boundary

Without `--config`, adoption checks only these current-project paths:

- `mcp.json`
- `.mcp.json`
- `.vscode/mcp.json`

It does not search the home directory, other repositories, browser storage, keychains, or application
configuration. No home-discovery mode is implemented. Configuration and artifact symlinks that
resolve outside the project fail closed. Absolute tool-argument paths must resolve inside the project
and are persisted as `{{PROJECT_ROOT}}/...`; home and outside paths are rejected.

## Default campaign and artifacts

The bounded default campaign runs a clean control, an injected MCP tool error with at most one retry,
a timeout negative control, and a malicious-canary negative control. It verifies the generated
regression before committing any artifact transaction.

```text
.resilireplay/
  campaign.yml
  README.md
  baseline/
    README.md
    candidate.json
  evidence/
    clean-control.jsonl
    tool-error-recovery.jsonl
    timeout-negative.jsonl
    safety-negative.jsonl
    adoption-summary.json
tests/resilireplay/
  regression.test.mjs
  replay.fixture.jsonl
  scenario.yaml
  manifest.json
.github/workflows/
  resilireplay.yml
```

Persisted MCP evidence defaults to `metadata-only`: tool names, fault/recovery events, hashes, and
causal links remain, while raw tool request/result bodies, headers, environment values, and
credentials do not. If arguments or destinations cannot be sanitized and contained, adoption fails
without writing a partial setup. Inspect `.resilireplay/README.md` for local reproduction, baseline
approval, and removal commands.

## Stable exit codes

| Code | Meaning                                                                          |
| ---: | -------------------------------------------------------------------------------- |
|  `0` | Demo/adoption completed or dry-run plan validated.                               |
|  `2` | CLI usage or a missing non-interactive choice.                                   |
| `30` | Demo execution or generated-regression failure.                                  |
| `31` | Demo artifact failure.                                                           |
| `40` | Adoption configuration discovery/containment failure.                            |
| `41` | Required target, tool, or retry authorization missing.                           |
| `42` | Target/tool/campaign behavior did not satisfy the bounded expectations.          |
| `43` | Arguments or evidence could not be safely sanitized.                             |
| `44` | Artifact generation, containment, collision, or regression verification failure. |

With `--json`, success is written as one JSON object to stdout and errors are written as a stable JSON
diagnostic to stderr.

## Security boundary

ResiliReplay is defensive test software, not an OS sandbox, DLP system, or security certification.
An authorized stdio server runs with the current OS account, and an allowlisted MCP operation can
still have server-side effects. Use disposable data, prefer genuinely read-only operations, inspect
the generated campaign hash, and isolate untrusted programs with an external OS/container boundary.
See [SECURITY.md](../SECURITY.md), the [threat model](../THREAT_MODEL.md), and
[known limitations](LIMITATIONS.md).
