# ResiliReplay MCP server

ResiliReplay 0.7.1 includes a real local stdio MCP server in the existing `resilireplay` npm package:

```json
{
  "mcpServers": {
    "resilireplay": {
      "command": "npx",
      "args": ["--yes", "resilireplay@0.7.1", "mcp", "serve"]
    }
  }
}
```

The server exposes the capabilities that already exist in the product:

- `resilireplay_status`
- `resilireplay_list_faults`
- `resilireplay_inspect_config`
- `resilireplay_validate_campaign`
- `resilireplay_verify_evidence`
- `resilireplay_capture_start`
- `resilireplay_capture_stop`
- `resilireplay_last_failure`
- `resilireplay_generate_regression`
- `resilireplay_run_campaign`

Every successful tool result includes the exact repository, package version, capability, evidence path when one exists, reproduction command, and documentation location. Responses are capped at 256 KiB and the stdio transport input buffer at 1 MiB.

## Security boundaries

- No tool accepts an arbitrary shell command.
- Config, campaign, capture, and generated-regression paths are contained under the explicit server working directory and reject link/path escapes.
- Campaigns have schema-enforced scenario, retry, concurrency, and duration bounds. MCP cancellation is propagated to the campaign runner.
- A campaign containing network targets requires both the campaign allowlist/confirmation hash and explicit `allowRemote` authorization.
- Capture is off by default, bounded, sanitized, and does not persist raw prompts, raw transcripts, environment values, or secrets.
- Evidence verification and confirmation hashes fail closed. Regression output never overwrites an existing file.
- Tools that run campaigns or write local evidence are accurately annotated as non-read-only. Network-aware execution is annotated open-world.

ResiliReplay is a local reliability tester, not an OS sandbox, authorization layer, security certification, or proof that arbitrary retries are safe. Invoke effectful target tools only when you own and understand their idempotency behavior.

The Official MCP Registry is a preview discovery channel. The independently installable npm package remains the source of executable distribution.
