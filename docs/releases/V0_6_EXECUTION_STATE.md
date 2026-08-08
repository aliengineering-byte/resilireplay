# ResiliReplay v0.6.0 execution state

Updated: 2026-08-07 (America/New_York)

## Status

- Outcome: `V0_6_LOCAL_RELEASE_CANDIDATE_READY`.
- Canonical repository: the required `E:` repository root (absolute workstation path intentionally omitted from public artifacts).
- Branch: `codex/resilireplay-framework-layer-v060`.
- Current phase: complete.

## Completed: workspace reconciliation

- The unexpected `C:` workspace and canonical `E:` workspace are independent ordinary clones with distinct Git and common directories.
- Both use the same `origin`, but their branch tips differ. `C:` is at `3c87f09655778ff287d8581eda3e64f75330dc37`; `E:` is at `2d4b2c5c360289021691c0bf5391baf255e5efb9`.
- Commits `33a8211` and `3c87f09` exist only in `C:` and are ancestors of its HEAD. Neither object exists in `E:`.
- `E:` commit `2d4b2c5` is not patch-equivalent to `C:` commit `33a8211`: stable patch IDs differ, and `E:` contains a substantially broader framework contract/product foundation.
- `C:` has four modified LangGraph files. `E:` has its own uncommitted LangGraph manifests, lockfile changes, and six runtime discovery probes. Overlapping manifests differ; no conflicting files were overwritten.
- Reconciliation method: preserve `C:` unchanged; retain the richer `E:` foundation and all `E:` user work; port compatible LangGraph behavior as explicit reviewed patches against the canonical `E:` APIs.

## Completed: Phase 1 - dependency graph

- Canonical hashing is exported by `packages/core/src/stable.ts`; the v1 contract imports it from that canonical module.
- Internal package manifests expose `dist` JavaScript and declarations, declare workspace dependencies, and build in dependency order.
- LangGraph v3 tests now request only valid base `streamMode` values; synthesized `lifecycle` and `tools` protocol channels are consumed from the public event stream.
- A clean synthetic checkout started with zero `node_modules` and zero `dist` directories. On Node `v24.14.0`, `pnpm install --frozen-lockfile`, `pnpm build`, all four required package typechecks, and the focused contract/SDK/OTEL test command passed.
- Clean-checkout focused result: 3 files passed; 15 tests passed.
- The first clean attempt exposed a Windows OTEL absolute-input path bug. The input boundary was fixed without weakening relative traversal or symlink checks; the clean checkout then passed.

## Completed: Phase 2 - LangGraph checkpoint

- Pinned packages: `@langchain/langgraph@1.4.9`, `@langchain/core@1.2.4` for local tool construction.
- Required adapter typecheck passed.
- Required adapter test command passed: 1 file, 12 tests.
- `GENUINE_RUNTIME`: clean lifecycle, node lifecycle, tool success/error, bounded retry, node timeout, ordered stream chunks, redaction, interrupt/resume, nested identity, deterministic replay, executable regression, and cleanup.
- `FIXTURE_BACKED_PROTOCOL`: malformed `tool-finished` without output.
- `DOCUMENTED_ONLY`: remote hosted transports.
- `UNSUPPORTED`: provider-backed model semantics.

## Completed: Phase 3 - OpenAI Agents SDK checkpoint

- Pinned package: `@openai/agents@0.14.3`; deterministic public `Model` implementation; no API key or network model call.
- Required adapter typecheck passed.
- Adapter checkpoint passed: 1 file, 12 tests.
- `GENUINE_RUNTIME`: Agent/Runner lifecycle, tool success/error/timeout, exactly one retry, handoff identity, input guardrail tripwire, ordered redacted stream evidence, AbortSignal cancellation, public trace/span processor mapping, executable regression, and cleanup.
- `DOCUMENTED_ONLY`: hosted OpenAI model transports.
- `UNSUPPORTED`: provider latency, billing, quota, remote retry, and server-side semantics.

## Completed: Phase 4 - broader framework layer

- The public registry provides deterministic list/detect/doctor behavior, exact framework/version
  capability manifests, explicit override, and application-owned runtime factory registration.
- AutoGen uses the neutral OTLP bridge and is classified `FIXTURE_BACKED_PROTOCOL`; the test passes
  an AutoGen-compatible OTLP fixture and makes no runtime claim.
- CrewAI and LlamaIndex use stable documented callback/instrumentation event names and remain
  `DOCUMENTED_ONLY`.
- The neutral callback mapper preserves causal identity, bounded payloads, and redaction. No private
  monkey-patching, hosted inference, API key, or telemetry exporter is used.
- Seven required campaign templates are present: tool error, timeout, malformed result, partial
  completion recovery, duplicated call, handoff failure, and stream corruption.
- Focused framework/CLI checkpoint passed after a full build: 5 files, 46 tests.

## Completed: Phase 5 - product usability

- `pnpm demo:frameworks` passed locally and exercised registry detection, AutoGen OTLP fixture
  ingestion, CrewAI documented callbacks, redaction, and disabled semantic advice.
- CLI `adapter list`, package detection, explicit override, and doctor paths execute from the bundled
  product. Unknown detection fails without a silent fallback.
- README, architecture, compatibility, support policy, adapter guide, and framework-specific quick
  starts publish the same capability and limitation labels.
- OpenAI Agents turn identity now follows actual SDK model invocations, while handoffs retain distinct
  actor identities under one trace. The genuine runtime suite proves a two-turn tool loop.
- Version-to-version campaign comparison remains hash-verified and passed in the CLI checkpoint.
- Semantic evaluation is an optional advisory interface, disabled by default; deterministic policy
  status remains authoritative.

## Completed: Phase 6 - release-candidate verification

- The final code tree passed, in order: `pnpm format`, `pnpm format:check`, `pnpm lint`,
  `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm quality`, and `pnpm release:gates`.
- Final full test result: 21 files, 143 tests. Genuine LangGraph and OpenAI Agents failures each
  generated and executed a passing regression.
- `pnpm quality` passed plugin/skill validation, official MCP Inspector discovery, field evidence,
  site checks, packed installation, adoption smoke, secret scan, hygiene scan, and agent stress gates.
- The packed `resilireplay@0.6.0` CLI installed in an isolated single-package project; help, MCP,
  capture-off, connect dry-run, demo, and adoption smoke passed. The explicit CLI help and demo also
  passed from the workspace bundle.
- Release gates passed 100 Studio start/stop iterations with zero orphan listeners, a 20,000-event
  trace, four real local campaign scenarios, an under-60-second demo, and a 332,086-byte CLI tarball
  containing 15 files (1,633,045 bytes unpacked).
- Framework package boundaries were packed and inspected. Core, adapter SDK, OTLP bridge, LangGraph,
  and OpenAI Agents tarballs contain `dist` output and no `src` files; adapter tarballs contain no
  compiled tests. Their packed sizes were 28,730, 21,258, 17,108, 18,541, and 22,934 bytes,
  respectively.
- Plugin runtime generation is byte-identical from root and filtered-package builds
  (`3F49E9A2A2C9372833A9AD1D67FADE7380A3B9E8A6AC18B27BA8973A6A7566BE`).
- A final committed-tree archive began with zero `node_modules` and `dist` directories. Frozen
  install, full build, five package typechecks, and five focused contract/framework files with 44
  tests passed from that archive.
- Secret and hygiene scans passed. An independent source scan found zero workstation paths in public
  artifacts, and the final process audit found zero repository-owned processes.
- Local commits: `af96627` (framework layer), `0cf094f` (package boundaries), and `454f54e`
  (reproducible runtime bundle). Nothing was pushed, tagged, published, or submitted externally.

## Handoff

The canonical branch is ready for local review. Publication remains intentionally unperformed.
