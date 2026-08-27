# MCP-RES v0.2 conformance kit

The kit evaluates `mcp-res.conformance-bundle/0.2.0` without importing ResiliReplay runtime packages.

```bash
node validate.mjs ../test-vectors/valid/reason-bound-negative.json
```

Exit status is `0` for valid, `1` for a conformant input with a failing diagnostic, and `2` for unreadable/invalid input. Output is one JSON object.

The validator:

- compiles all seven JSON Schema 2020-12 schemas;
- recomputes observation, scenario, execution, evidence, statement, artifact-manifest, and bundle digests;
- derives evidence class, cleanup, privacy, and coverage rather than trusting booleans;
- rejects wrong-reason/vacuous negative controls, cross-run substitutions, parent cycles, impossible time, excess retry attempts, and false stability summaries;
- does not contact a network or execute a subject.

This validator is a project implementation, not an official MCP validator. The independent second-language implementation is intentionally owned by PR 2.
