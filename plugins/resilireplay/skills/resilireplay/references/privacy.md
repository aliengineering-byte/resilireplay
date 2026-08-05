# Privacy and security boundary

ResiliReplay is local-first, has no telemetry, and performs no background upload. Capture stores metadata and hashes, not recoverable bodies. Secret-shaped summaries are redacted before persistence and personal paths become `[PATH]`. Installation does not arm capture.

If a normalized artifact still contains unexpected sensitive data, stop capture, do not share the artifact, remove the repository-local `.resilireplay` directory through the user's normal recovery-aware workflow, and report the sanitizer defect privately using the repository security policy.
