# Test your MCP server in about five minutes

This guide uses public `resilireplay@0.3.0`. ResiliReplay is defensive reliability software, not an
OS sandbox or security certification. Test only a local or user-owned server. Read every tool's side
effects before allowlisting it.

## 1. Install and import a reviewed target

Requirements: Node.js 22 or 24.

```console
npm install --save-dev resilireplay@0.3.0
npx resilireplay --version
```

Create `mcp.json` in the same shape used by MCP Inspector:

```json
{
  "mcpServers": {
    "my-server": {
      "type": "stdio",
      "command": "node",
      "args": ["./dist/server.js"],
      "cwd": ".",
      "connectionTimeout": 5000,
      "requestTimeout": 5000
    }
  }
}
```

Never put a token directly in the file. Use a referenced environment variable only when the server
truly needs one, and omit that variable from shared evidence.

## 2. Dry-run before contact

```console
npx resilireplay mcp audit --inspector-config ./mcp.json --server my-server --dry-run
```

Confirm the executable, argument array, working directory, transport, timeout, and environment names.
A dry run does not start the server or call a tool.

## 3. Start with a minimal campaign

Save this as `reliability.campaign.yml` and replace only the server/tool names. Use a read-only,
idempotent tool with harmless schema-generated arguments. An empty `allowTools` list performs
discovery only and needs no tool confirmation.

```yaml
schemaVersion: "1.0"
kind: resilireplay-campaign
id: my-server-smoke
description: Bounded local recovery smoke test.
seed: 42
budgets:
  concurrency: 1
  retries: 1
  scenarioTimeoutMs: 10000
  totalTimeoutMs: 60000
targets:
  - id: target
    kind: mcp
    inspectorConfig: mcp.json
    server: my-server
    allowTools: [safe_read_tool]
    allowRemote: false
scenarios:
  - id: clean-control
    target: target
    fault: none
    recovery: none
    assertions:
      outcome: passed
      maxRetries: 0
      noDuplicateSideEffects: true
      safetyPolicyCompliance: true
  - id: bounded-retry
    target: target
    fault: mcp-tool-error
    recovery: retry
    assertions:
      outcome: passed
      safeRecovery: true
      maxRetries: 1
      noDuplicateSideEffects: true
      safetyPolicyCompliance: true
  - id: expected-failure
    target: target
    fault: mcp-malicious-canary-instruction
    recovery: none
    assertions:
      outcome: failed
      safeRecovery: false
      noDuplicateSideEffects: true
      safetyPolicyCompliance: true
thresholds:
  maxScoreDrop: 0
  maxRetryIncrease: 0
  maxDuplicateSideEffectIncrease: 0
```

## 4. Validate, review, and run

```console
npx resilireplay campaign validate reliability.campaign.yml
```

The command prints a SHA-256 confirmation hash. Review the canonical target and scenarios, then pass
that exact hash back only if the allowlisted call is authorized:

```console
npx resilireplay campaign run reliability.campaign.yml --confirm-tools <reviewed-hash> --output runs/field-test
```

A clean control is mandatory. Keep concurrency `1` until behavior and cleanup are understood. Do not
use a destructive operation just to provoke a failure.

## 5. Approve and compare a baseline

Approve only a complete run whose expectations match:

```console
npx resilireplay campaign approve runs/field-test --output baselines/field-test.json
npx resilireplay campaign compare runs/field-test --baseline baselines/field-test.json --output runs/comparison
```

The comparison fails closed if evidence is incomplete, changed, or hash-invalid. Generated regression
tests live below failed scenario directories and are executed by the campaign runner when generated.

## 6. Share a sanitized result

Before filing an issue or PR:

- keep the pinned public version/commit, campaign, config, compact report, and hashes;
- remove trace payloads that contain application data;
- replace personal paths with repository-relative paths;
- remove tokens, cookies, authorization headers, usernames, customer data, and browser profiles;
- describe injected faults as synthetic reliability conditions, never vulnerabilities;
- say what was not tested.

Reports are local files. ResiliReplay implements no telemetry, account, hosted backend, or upload.
Pattern redaction is defense in depth; it cannot prove removal of every application-specific secret.
Treat all source traces and reports as potentially sensitive.

Use the repository's bug template for a ResiliReplay defect, compatibility template for a server or
transport mismatch, and field-test template for a sanitized result. Report possible vulnerabilities
through [private security reporting](https://github.com/aliengineering-byte/resilireplay/security/advisories/new),
not a public issue.

## Remove all generated state

Stop Studio/server processes first. Then delete only the paths you created: the selected `runs` output,
baseline, local case `node_modules`, and any explicitly configured disposable browser/database data.
Do not use a broad home-directory or repository-root deletion.

POSIX example:

```console
rm -r -- runs/field-test runs/comparison baselines/field-test.json
```

PowerShell example:

```powershell
Remove-Item -Recurse -Force -LiteralPath 'runs/field-test'
Remove-Item -Recurse -Force -LiteralPath 'runs/comparison'
Remove-Item -Force -LiteralPath 'baselines/field-test.json'
```

Verify that the server process exited and that no listener remains before declaring the field test
complete.
