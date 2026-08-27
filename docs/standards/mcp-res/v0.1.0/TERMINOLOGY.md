# Terminology

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **NOT RECOMMENDED**, **MAY**, and **OPTIONAL** in normative MCP-RES documents are to be interpreted as described in BCP 14, [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174), when, and only when, they appear in all capitals.

**Subject**: the exact MCP server, client, agent runtime, gateway/proxy, adapter, transport implementation, or test harness evaluated.

**Evidence bundle**: a closed JSON object containing an evidence envelope, conformance statement, and integrity manifest.

**Profile**: versioned, subject-specific requirements layered on the core. A subject is never simply “MCP-RES compliant” without a profile and version.

**Clean control**: an uninjected operation proving the reviewed baseline can perform the operation under test.

**Deterministic fault**: a bounded, versioned, seeded injection attached to one causal operation and distinguishable from ambient failure.

**Expected-failure negative control**: a deliberately broken case that the suite must reject or observe as `EXPECTED_FAILURE`.

**Recovery attempt**: a bounded operation performed after the causal fault according to a named policy.

**Complete evidence**: evidence whose cleanup succeeded and whose manifest was exclusively published last. A marked incomplete artifact is not complete evidence.

**Validator**: a named, versioned implementation applying the schemas and cross-record conformance rules.

**Reference implementation**: an implementation used to demonstrate the standard. It does not own the standard's wire format and is not required by independent implementations.
