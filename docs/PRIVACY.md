# Privacy notice

Effective: 2026-08-05

ResiliReplay is local-first software. The project operator does not provide a ResiliReplay account,
hosted capture service, analytics endpoint, advertising system, or background uploader. Installing
the CLI, Agent Skill, or plugin does not arm capture.

When a user explicitly starts capture, ResiliReplay writes bounded artifacts only inside that
user-selected repository. By default these include hashed session/tool-call identifiers, event type,
tool name, outcome, duration, normalized error class, content hashes, bounded redacted summaries,
and capture time. Raw prompts, full transcripts, authorization headers, credentials, environment
values, unrestricted tool bodies, and personal paths are not persisted by default.

Repository-local evidence remains under the user's control and retention policy. Direct connection
backups may contain the exact prior local configuration required for rollback; they are stored below
the gitignored `.resilireplay/backups/` directory, are never printed, and should not be committed or
shared. Removing ResiliReplay does not silently delete evidence or backups.

The static Hugging Face demonstration accepts no input and sends no data. Public synthetic fixtures
contain no real user or third-party trace data.

Security and privacy reports use the private process in
[SECURITY.md](https://github.com/aliengineering-byte/resilireplay/security/policy). General support
uses [GitHub Issues](https://github.com/aliengineering-byte/resilireplay/issues). Repository hosting,
npm, marketplaces, and Hugging Face apply their own privacy policies to visits and downloads.
