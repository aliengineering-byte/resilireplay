# Official MCP conformance result attachment

Status: **normative attachment rules; no certification claim**.

An `mcp-res.official-conformance-attachment/0.2.0` is an inert record of output produced by an exact official MCP conformance tool. It does not execute that tool, reinterpret an official outcome, map the output to an MCP-RES evidence class, or imply certification or endorsement by the MCP project.

## Required identity and preservation

The attachment MUST bind the official package name and version, executable artifact SHA-256, repository and commit, protocol revision, exact requirement-set SHA-256, client/server mode, suite and scenarios, and the status of both test legs. The active leg MUST be `EXECUTED`.

Every emitted check retains its official `SUCCESS`, `FAILURE`, `WARNING`, `SKIPPED`, or `INFO` outcome. A failure named by an expected-failure baseline remains a failure with `baselineExpected: true`; it is never rewritten as success. A baseline entry whose check no longer fails is stale and forces `INCOMPLETE`; a dishonest stale inventory is invalid. Wire-schema checks, warnings, skips, untestable checks, pending checks, and not-scored checks have separate inventories.

`inventories.declared` is the expected check set. Every emitted check MUST be declared. A declared check that was not emitted MUST appear in `pending`, and any pending or not-scored check forces `INCOMPLETE`. Thus absence cannot count as success.

## Result artifact and sanitization

`originalResultArtifact` records the raw original byte length and SHA-256. If a public derivative removes an ephemeral port, session ID, token, user path, or comparable value, it MUST set `sanitization.applied`, list the exact JSON paths changed, and retain the digest and length of the unsanitized original. The sanitized derivative is not claimed to have that digest.

The committed sample came from `@modelcontextprotocol/conformance` `0.2.0-alpha.11` at commit `74edef34d674f563537be8c6587cebaa58e830ca`, running the server-initialize scenario against the official TypeScript Everything server for `2025-11-25`. It emitted three successful checks. After writing them, the Windows process terminated with a libuv assertion, so the attachment is `INCOMPLETE`. See [capture metadata](official-conformance/server-initialize-2025-11-25.capture.json) and the [sanitized output](official-conformance/server-initialize-2025-11-25.sanitized.json).

## Import status

- `COMPLETE` means the declared output inventory was imported, no unexpected failure occurred, the baseline is current, required observation surfaces are observed, and the harness exited successfully.
- `INCOMPLETE` means output is usable but skips, untestable/pending/not-scored work, a stale expected-failure baseline, unobserved surfaces, or harness failure prevents completeness.
- `INVALID` means an unexpected official failure remains or the attachment is internally contradictory.

These are import states, not official pass/fail labels and not MCP-RES results. `mappingBoundary.officialCertificationClaim` is always false. Explicit mapping is reserved for a future separately reviewed specification; v0.2 maps nothing.

Validate with:

```text
node conformance-kit/validate-official-conformance.mjs attachment.json
python conformance-kit/python/mcp_res_validator.py official attachment.json
```
