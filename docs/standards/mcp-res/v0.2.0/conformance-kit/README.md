# MCP-RES v0.2 conformance kit

All public CLI entry points use a strict UTF-8, duplicate-key-aware, non-symlink reader bounded to 16 MiB, depth 128, 250,000 nodes, and 1,048,576 code units per string. Unsafe integers, floating-point values, lone surrogates, malformed UTF-8, and trailing data fail closed. Submitted values remain inert data: the validators do not launch subjects, execute regressions, follow submitted paths, fetch remote references, load plugins, evaluate code, or extract archives.

The filesystem metadata check and subsequent read are not atomic, so filesystem TOCTOU remains a documented residual risk. Run `node scripts/verify-mcp-res-validator-safety.mjs` from a checkout for the executable safety controls; any platform-skipped symlink cell is reported as untestable, not verified.

The kit evaluates `mcp-res.conformance-bundle/0.2.0` without importing ResiliReplay runtime packages.

```bash
node validate.mjs ../test-vectors/valid/reason-bound-negative.json
```

Exit status is `0` for valid, `1` for a conformant input with a failing diagnostic, and `2` for unreadable/invalid input. Output is one JSON object.

The JavaScript and dependency-free Python validators:

- compile all seventeen JSON Schema 2020-12 schemas;
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
node validate-oauth.mjs oauth-evaluation.json
python python/mcp_res_validator.py oauth oauth-evaluation.json
```

Attestation tests create disposable Ed25519 keys only in memory. The dependency-free Python implementation contains its own schema evaluator, canonicalizer, semantic rules, and Ed25519 verifier. CI requires exact JavaScript/Python decision, diagnostic-family, canonical-byte, and digest agreement.

These validators are project implementations, not official MCP validators. The Python implementation is a second implementation maintained by this project; it is not an independent external implementation/adopter for the 1.0 criterion.
