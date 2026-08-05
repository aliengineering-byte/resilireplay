---
license: apache-2.0
language:
  - en
pretty_name: ResiliReplay Synthetic Failure Fixtures
tags:
  - agents
  - mcp
  - reliability
  - synthetic
task_categories:
  - other
size_categories:
  - n<1K
---

# ResiliReplay Synthetic Failure Fixtures

Twelve synthetic, sanitized coding-agent tool-result fixtures whose `event` field conforms to `resilireplay.agent-event/v1`. They exercise deterministic failure classification and privacy boundaries for ResiliReplay adapters.

## Intended use

- Adapter conformance examples
- Reliability-tool unit tests
- Schema and redaction demonstrations

## Not intended for

- Training on real users or conversations
- Vulnerability claims, security certification, model ranking, or provider evaluation
- Reconstructing prompts, transcripts, source code, credentials, or personal data

All records are generated locally by `scripts/generate-hf-fixtures.mjs`. Session/tool-call identifiers and bodies are SHA-256 projections. Summaries are bounded and contain only synthetic text. There are no third-party responses, personal paths, credentials, copyrighted source, or fabricated user records.

Fields follow the public schema at https://github.com/aliengineering-byte/resilireplay/blob/v0.5.0/schemas/agent-event.v1.schema.json. License: Apache-2.0.
