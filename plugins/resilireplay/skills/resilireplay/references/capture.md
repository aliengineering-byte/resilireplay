# Passive capture

Capture is repository-local and off by default. `capture start` creates `.resilireplay/capture/session.json`; hooks then accept bounded stdin payloads and persist only normalized event metadata. The journal is capped at 20,000 events and 32 KiB per normalized event. Duplicate tool-call outcomes are ignored. `capture stop` disarms hooks without deleting evidence.

Supported v1 fields include source, hashed session/tool-call IDs, event type, tool name, outcome, duration, normalized error class, content hashes, a redacted 512-character summary, and timestamp. Raw prompts, transcripts, bodies, environment values, credentials, and personal paths are excluded.
