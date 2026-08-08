# MCP reliability campaign catalog

Start with the smallest campaign that can answer the question. All catalog campaigns use a clean
control, deterministic seed, one target, concurrency `1`, explicit budgets, and fail-closed
assertions. Copying a campaign does not authorize its target or tool.

## Core campaigns

| Campaign                | Question                                                       | Required operation class        | Expected result                                          |
| ----------------------- | -------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------- |
| Discovery control       | Can the pinned server initialize and list capabilities?        | Any; `allowTools: []`           | Complete discovery without a tool call                   |
| Clean operation         | Does one reviewed operation work without a fault?              | Prefer `READ_ONLY_IDEMPOTENT`   | Clean control passes                                     |
| Tool-error recovery     | Does one synthetic tool error recover within one retry?        | `READ_ONLY_IDEMPOTENT`          | Retry count `1`, recovery true, duplicates `0`           |
| Tool-timeout boundary   | Does a timeout terminate within the declared budget?           | Read-only or disposable         | Declared recovery/failure matches; no loop               |
| Schema incompatibility  | Does a changed argument schema fail closed?                    | Read-only or discovery          | No unreviewed call; declared failure matches             |
| Canary expected failure | Can the harness prove an unsafe result does not become a pass? | Inert local/synthetic operation | Observed failure, no canary leakage, verified regression |

The canonical stdio campaign combines clean operation, tool-error recovery, and the canary negative
control: [`stdio.campaign.yml`](../../examples/mcp-reliability/stdio.campaign.yml). The smaller
[`expected-failure.campaign.yml`](../../examples/mcp-reliability/expected-failure.campaign.yml) is
useful when checking the negative control alone.

## Fault selection

| Boundary                | ResiliReplay fault                                          | Use when                                              |
| ----------------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| Discovery payload       | `mcp-malformed-tools-list`                                  | The client must reject malformed discovery            |
| Tool identity           | `mcp-renamed-tool` or `mcp-missing-tool`                    | Tool selection drift is the risk                      |
| Input contract          | `mcp-incompatible-argument-schema`                          | Schema changes must fail before unsafe invocation     |
| Tool execution          | `mcp-tool-error`                                            | A bounded, retry-safe read is available               |
| Timing                  | `mcp-tool-timeout`                                          | Termination and retry budgets are explicit            |
| Protocol                | `mcp-protocol-version-mismatch` or `mcp-invalid-jsonrpc-id` | Client/server protocol handling is under test         |
| Content bounds          | `mcp-oversized-content`                                     | Size limits and graceful failure are the question     |
| Safety negative control | `mcp-malicious-canary-instruction`                          | The target is local/synthetic and the canary is inert |
| Capability/permission   | `mcp-permission-capability-mismatch`                        | Declared capability enforcement is under test         |

Do not run every fault for coverage theater. Choose the smallest fault set tied to a real release
boundary and publish why each fault matters.

## Stdio reproduction

```console
npx --yes resilireplay@0.6.0 campaign validate examples/mcp-reliability/stdio.campaign.yml
npx --yes resilireplay@0.6.0 campaign run examples/mcp-reliability/stdio.campaign.yml \
  --confirm-tools 84b64fd60ced0089603e2e66efeff2cf00cf8577756a70b6e816ee3ba4849b06 \
  --output runs/mcp-reliability-stdio
```

The reviewed campaign hash applies to the file in this revision. Re-run validation after every edit
and use the new printed hash.

## Authenticated loopback Streamable HTTP reproduction

Build the repository, then start the synthetic fixture in one terminal:

```console
RESILIREPLAY_FIXTURE_HTTP_TOKEN=synthetic-reliability-token \
RESILIREPLAY_FIXTURE_MODE=resilient \
RESILIREPLAY_FIXTURE_PORT=43119 \
node examples/mcp-http-fixture-server/dist/index.js
```

In a second terminal:

```console
export RESILIREPLAY_FIXTURE_AUTHORIZATION="$(printf 'Bearer%s' ' synthetic-reliability-token')"
npx --yes resilireplay@0.6.0 campaign run \
  examples/mcp-reliability/streamable-http.campaign.yml \
  --confirm-tools c6ee77307fa37dfaa02b62ac6c67b866ffcf027d37cf0c7c55abe0a9aae28537 \
  --output runs/mcp-reliability-http
```

The endpoint is bound to `127.0.0.1`; the checked-in value is synthetic. Stop the fixture and verify
port `43119` is closed. Never commit a real authorization value.

## Promotion rule

Promote a campaign into CI only after the clean control and expected failure both match locally, the
operation is classified, evidence is sanitized, and cleanup is repeatable. Approve a baseline only
from a complete run. Compare against the exact campaign/config hashes; configuration mismatch must
not become a pass.
