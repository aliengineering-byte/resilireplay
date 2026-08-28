# MCP-RES v0.2 conformance kit

The kit evaluates `mcp-res.conformance-bundle/0.2.0` without importing ResiliReplay runtime packages.

```bash
node validate.mjs ../test-vectors/valid/reason-bound-negative.json
```

Exit status is `0` for valid, `1` for a conformant input with a failing diagnostic, and `2` for unreadable/invalid input. Output is one JSON object.

The JavaScript and dependency-free Python validators:

- compile all sixteen JSON Schema 2020-12 schemas;
- recomputes observation, scenario, execution, evidence, statement, artifact-manifest, and bundle digests;
- derives evidence class, cleanup, privacy, and coverage rather than trusting booleans;
- rejects wrong-reason/vacuous negative controls, cross-run substitutions, parent cycles, impossible time, excess retry attempts, and false stability summaries;
- does not contact a network or execute a subject.

Additional entry points validate the optional DSSE/in-toto-informed attestation wrapper and deterministic migration result:

```bash
node validate-attestation.mjs attested.json --trust-policy policy.json
node validate-migration.mjs migrated.json
python python/mcp_res_validator.py validate ../test-vectors/valid/reason-bound-negative.json
node validate-official-conformance.mjs official-attachment.json
node validate-profile.mjs profile-evaluation.json
python python/mcp_res_validator.py official official-attachment.json
python python/mcp_res_validator.py profile profile-evaluation.json
```

Attestation tests create disposable Ed25519 keys only in memory. The dependency-free Python implementation contains its own schema evaluator, canonicalizer, semantic rules, and Ed25519 verifier. CI requires exact JavaScript/Python decision, diagnostic-family, canonical-byte, and digest agreement.

These validators are project implementations, not official MCP validators. The Python implementation is a second implementation maintained by this project; it is not an independent external implementation/adopter for the 1.0 criterion.
