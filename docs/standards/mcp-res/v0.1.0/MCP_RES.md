# MCP Reliability Evidence Standard — Draft v0.1.0

Status: **project-defined public draft**. Updated: `2026-08-27`.

MCP-RES is a project-defined, vendor-neutral, open reliability-evidence standard for MCP ecosystem participants. ResiliReplay is its initial reference implementation. It is not the MCP specification, an official certification program, or an endorsement by the MCP project.

## 1. Scope and non-goals

MCP-RES specifies portable evidence that a bounded reliability scenario was run, detected a deliberate failure, applied only an authorized recovery, preserved privacy and integrity, and cleaned up. The core can identify MCP servers, clients, agent runtimes, gateways/proxies, adapters, transport implementations, and test harnesses.

It does not redefine MCP messages or transports; certify security; prove general availability; authorize arbitrary execution; imply MCP-project endorsement; or turn a test performed by ResiliReplay into adoption by the tested package author.

## 2. Conformance unit

A conformance claim MUST bind all of these values: standard version, profile identifier and version, subject type, exact subject identity and version, evidence class, result, evidence SHA-256, and validator identity/version/digest. The portable display grammar is:

```text
MCP-RES v0.1.0
Profile: mcp-res/server-tool-call/v1 @ 1.0.0
Subject: MCP_SERVER independent-mcp-fixture @ 1.0.0
Evidence class: FIXTURE_BACKED_PROTOCOL
Result: PASS
Evidence SHA-256: c8e9fa553f86c5b96eef9276d57f9bccdba602d5aa91f00dafd9ef618ee32690
Validator: mcp-res-black-box-validator @ 0.1.0
```

“MCP-RES compliant” without this qualification is not a conforming claim.

## 3. Core requirements

### 3.1 Identity and provenance

**MCPRES-ID-001**: Evidence MUST identify the subject name, exact version, subject type, package/image/executable/source identifier and SHA-256, transport class, configuration-profile identity/version/digest, harness identity/version/digest, validator identity/version/digest, and relevant runtime versions/digests. Secret values, environment-dependent working directories, host names, personal paths, and random temporary paths MUST NOT be identity fields.

**MCPRES-ID-002**: Transport identity MUST distinguish stdio, Streamable HTTP, SSE, in-process, or other; and local, loopback, or remote endpoint class. This identity describes the evaluated boundary and does not alter official MCP transport requirements.

### 3.2 Controls and causal fault

**MCPRES-CTRL-001**: A `PASS` claim MUST include an uninjected `CLEAN_CONTROL` with outcome `PASS` for the same pinned subject, configuration profile, harness, and relevant operation class.

**MCPRES-FAULT-001**: Every injected fault MUST have an identifier, version, method, seed, exact target operation, bounded trigger/application count, expected effect, and reproducibility digest. An ambient failure MUST NOT be relabeled as deterministic without this evidence.

**MCPRES-NEG-001**: A `PASS` claim MUST include a `NEGATIVE_CONTROL` attached to a deliberate fault and observed as `EXPECTED_FAILURE`. Passing, ignoring, or losing the broken case is `MCP_RES_VACUOUS_NEGATIVE_CONTROL`.

**MCPRES-CAUSE-001**: Every operation MUST name one run and operation identity. Parent identities MUST resolve within that run. Fault and recovery-policy references MUST resolve, and each fault target MUST equal the causal operation. Evidence MUST NOT attach a failure to another run or call.

### 3.3 Bounded recovery and side effects

**MCPRES-REC-001**: A recovery policy MUST declare a finite retry limit, time limit, cancellation boundary, bounded backoff, side-effect model, terminal outcomes, and any safety mechanism. Unbounded retry is non-conformant.

**MCPRES-REC-002**: The side-effect model MUST be `READ_ONLY`, `IDEMPOTENT`, `SIDE_EFFECTING`, or `UNKNOWN`. Automatic retry of `SIDE_EFFECTING` or `UNKNOWN` with retry limit greater than zero MUST include testable evidence of an idempotency key, transaction, compensation, or exactly-once guard. Human confidence or prose alone is insufficient.

### 3.4 Privacy and sanitization

**MCPRES-PRIV-001**: Published evidence MUST omit at source raw credentials, authorization headers, environment values, private prompts/transcripts, unrestricted tool bodies, and personal absolute paths. Summaries MUST be bounded. Linkable identities SHOULD use one-way projections where raw identifiers are not necessary.

**MCPRES-PRIV-002**: Redaction MAY be used as defense in depth but MUST NOT replace source omission. Encoded secret-shaped material and raw authorization headers MUST be rejected before completion publication.

### 3.5 Integrity and publication

**MCPRES-INT-001**: A bundle MUST identify canonicalization and hash algorithms, list each artifact path/media type/byte length/SHA-256, carry a bundle digest, and publish a completion manifest last. Missing, altered, duplicated-path, partial, or inconsistent manifests MUST be rejected.

**MCPRES-INT-002**: Draft v0.1 uses `mcp-res-json-utf16-v1`: UTF-8 JSON with no insignificant whitespace; object keys sorted by ascending UTF-16 code units; original array order; JSON escaping for strings; only finite safe integers; and rejection of lone UTF-16 surrogates, `undefined`, non-finite numbers, and non-JSON values. The hash algorithm is `SHA-256` over those UTF-8 canonical bytes.

RFC 8785 was evaluated. It provides a stronger established JSON canonicalization scheme and informs key ordering and primitive serialization. v0.1 does **not** claim RFC 8785 conformance because the existing ResiliReplay identity algorithm and historical hashes cannot be silently migrated, and this draft deliberately restricts numbers to safe integers. The explicit algorithm identifier prevents accidental equivalence. A future RFC MAY define dual-hash migration or adopt RFC 8785 without changing historical identities.

### 3.6 Executable regression

**MCPRES-REG-001**: A profile claiming regression preservation MUST provide an executable regression that was generated or staged without executing the target during generation; writes only to contained, non-overwriting output; uses deterministic dependencies; fails against the broken condition; passes after the reviewed fix or recovery; passes secret scanning; and documents runtime requirements. Execution results MUST be recorded separately from generation.

### 3.7 Resource limits

**MCPRES-LIMIT-001**: Every bundle MUST declare finite maximum input bytes, event count, nesting depth, string bytes, retries, concurrency, scenario duration, total duration, and generated-output bytes. A validator MUST enforce the schema ceilings and MAY enforce a lower documented local ceiling. v0.1 bundle input is capped at 1 MiB by the black-box kit; artifact declarations are capped at 16 MiB each.

### 3.8 Cleanup

**MCPRES-CLEAN-001**: Complete evidence MUST report zero child processes and listeners remaining, removed or explicitly incomplete temporary artifacts, no unapproved target state, and absent or completed output. Cleanup failure MUST prevent a `PASS` claim. Retained diagnostic material MUST remain marked incomplete and MUST NOT masquerade as a complete bundle.

## 4. Evidence classes

Evidence class is determined from observable execution fields, not a producer label.

| Class                     | Required execution                                                                                                                                                                             | Not proved / forbidden promotion                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GENUINE_RUNTIME`         | The named runtime actually ran, MCP/protocol operations were exchanged, and an integrity-bound sanitized source-evidence projection identifies both its own bytes and the original run digest. | Does not prove operations outside the recorded case; booleans or fixtures alone cannot qualify. |
| `FIXTURE_BACKED_PROTOCOL` | Protocol messages were exchanged and the named fixture participated.                                                                                                                           | Does not prove a vendor's genuine runtime behavior.                                             |
| `FIXTURE_VERIFIED`        | The fixture passed schema/contract execution.                                                                                                                                                  | Does not prove protocol transport or runtime execution.                                         |
| `INSTALLATION_VERIFIED`   | The named artifact was installed/discovered and its installation checks ran.                                                                                                                   | Does not prove an authenticated model session, tool execution, or recovery.                     |
| `DOCUMENTED_ONLY`         | No runtime, protocol, fixture, installation, or regression execution is asserted.                                                                                                              | MUST NOT use execution verbs such as “ran,” “passed runtime,” or “recovered.”                   |

A validator MUST emit `MCP_RES_EVIDENCE_CLASS_PROMOTION` when execution fields do not support the asserted class.

## 5. Profiles

- `mcp-res/server-tool-call/v1` version `1.0.0`: `NORMATIVE` within this draft. It has executable positive, expected-failure, integrity, privacy, side-effect, and cleanup vectors.
- `mcp-res/client-config-source/v1` version `1.0.0`: `PROVISIONAL`. It covers bounded read-only source parsing; the general client configuration proposal is not released normative MCP behavior.
- `mcp-res/agent-tool-recovery/v1` version `1.0.0`: `PROVISIONAL`. It separates genuine runtime, fixture, installation, and documentation evidence.

Gateway/proxy and transport-specific profiles are future work. A core-capable subject type without a published profile cannot make a profile conformance claim.

## 6. Independent implementation

An implementation needs only the published schemas, profile manifest, vectors, canonicalization rule, and submitted bundle. It MUST NOT need a ResiliReplay package, campaign engine, trace model, or private function. The bundled validator demonstrates that boundary with Ajv JSON Schema 2020-12 plus explicit cross-record rules.

## 7. Limits of a result

A `PASS` is true only for the exact pinned subject, profile, evidence class, conditions, validator, and evidence digest. It is not a security certification, official MCP conformance result, guarantee, general benchmark, or adopter statement.
