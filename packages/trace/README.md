# @resilireplay/trace

Canonical JSONL traces and the ResiliReplay failed-trace-to-regression compiler.

Trace input is bounded to 32 MiB, 100,000 events, and 64 JSON nesting levels. Boundary failures use
stable `RR_TRACE_*` diagnostic codes.

Regression bundles are staged below the contained output directory and published without overwrite.
The compiler prefers an exclusive hard link, falls back to a verified `COPYFILE_EXCL` copy when hard
links are unavailable, and publishes `manifest.json` last. Existing identical bundles are
idempotent; mismatches fail with `RR_REGRESSION_CONFLICT`. A bundle without a valid completion
manifest is incomplete.
