# v0.5.0 “Everywhere” release evidence

This document is populated from release-candidate and public verification. It is not a security certification.

## Local release-candidate evidence

- Canonical agent engine: strict TypeScript build passed.
- Universal MCP: nine annotated stdio tools; official MCP Inspector 2.1.0, SDK discovery/call, packed-package discovery, and ResiliReplay self-audit passed.
- Agent Skill: internal validators and official `skills-ref` at `217be548739f21d6008915c29aefe320ea1a90af` passed.
- Claude Code 2.1.222: official manifest validation and disposable marketplace installation passed; installed failure fixture generated a passing regression.
- Codex CLI 0.146.1: disposable repo marketplace installation passed; installed failure fixture generated a passing regression.
- Hermes Agent 0.20.0 at `d1f9e77755b019e3f02a5597c6c7335868cf3ae4`: editable isolated install, portable skill discovery, MCP configuration, connection, and nine-tool discovery passed. No local/model-authenticated flow was available.
- 20,000-event gate: 898 ms; 13,414,112 artifact bytes; hard cap returned `full`; measured RSS delta 100,171,776 bytes including fixture input.
- In-process capture: 100 samples, 14.94 ms median, 18.43 ms p95; startup 20.48 ms; cleanup 31.55 ms.
- Existing Studio/campaign gate: 100 start/stop iterations, zero orphan listeners, 20,000-event trace round trip in 934 ms, four-scenario campaign pass, and 324,611-byte npm tarball with 15 files.
- Demonstration: real controlled exit 7 to passing regression in 1,392 ms; no automatic retry.
- Test suite: 91 tests across 16 Vitest files passed; V8 coverage was 74.63% statements/lines, 68.83% branches, and 86.91% functions.
- Browser gates: desktop and mobile responsive/WCAG A/AA checks passed; the complete Studio Playwright flow passed with no serious axe violations.

## Public verification placeholders

The final commit, tag object, release URL, npm hashes/provenance, Pages deployment, marketplace submissions, Hugging Face artifacts, and signed-out checks are recorded here only after the release gates, PR merge, immutable tag, and public publication succeed.
