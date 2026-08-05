---
name: resilireplay
description: Capture a supported coding-agent tool failure as bounded, sanitized evidence and generate an executable deterministic regression. Use when a user asks to capture, explain, reproduce, or prevent recurrence of a Claude Code, Codex, Hermes, or MCP tool failure, or to validate a ResiliReplay adapter or campaign.
---

# ResiliReplay

Use the installed `resilireplay` CLI or its registered MCP tools. Keep passive capture off until the user explicitly asks to arm it.

## Failure-to-regression workflow

1. Run `resilireplay capture status` and explain that only normalized metadata is stored.
2. If capture is off, obtain explicit user intent and run `resilireplay capture start`.
3. Let the user reproduce one safe failure. Never inject a fault, retry a failed operation, or expand permissions in an ordinary coding session.
4. Run `resilireplay capture last`. Explain the tool boundary, normalized error class, and hashes without reconstructing raw inputs.
5. Run `resilireplay capture stop` when the requested observation is complete.
6. With user approval, run `resilireplay capture generate-test`; report both the evidence ID and passing test result.

For controlled fault campaigns, read [campaigns.md](references/campaigns.md). For data boundaries and incident handling, read [privacy.md](references/privacy.md). For generated artifacts, read [regressions.md](references/regressions.md). For platform evidence levels, read [compatibility.md](references/compatibility.md).

## Safety boundaries

- Treat hooks as passive observers.
- Do not store or quote prompts, transcripts, authorization headers, tokens, environment values, unrestricted bodies, or personal paths.
- Do not automatically retry side-effecting tools.
- Require exact reviewed hashes for tool execution, campaign runs, or regression writes exposed through MCP.
- Keep files inside the current repository and preserve any connection backup needed for rollback.
- Say “ResiliReplay Compatible” only when `resilireplay adapter verify` passes; it is not a security certification or endorsement.

Use `scripts/detect.mjs` for value-free project detection. Use `scripts/install.mjs --target <directory>` only after previewing the destination.
