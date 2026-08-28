# Migrating MCP-RES v0.1 evidence to v0.2

Migration is deterministic and deliberately non-promoting. It preserves historical evidence; it cannot manufacture observations that were never recorded.

```bash
pnpm mcp-res:migrate -- \
  --from 0.1.0 \
  --to 0.2.0 \
  --input old.mcp-res.json \
  --output migrated.mcp-res.json
```

Use `--dry-run` to emit the report and prospective output digest without writing a file.

## Output contract

The command emits `mcp-res.migration-result/0.2.0`, not a v0.2 conformance `PASS`. It embeds the validated original bundle and records:

- the exact original evidence SHA-256;
- the exact input-file SHA-256;
- migration tool name/version and SHA-256 of the executed script;
- the unchanged evidence class;
- all producer booleans as `LEGACY_SELF_ASSERTED`;
- `UNSIGNED_INTEGRITY_ONLY` authenticity;
- `SINGLE_OBSERVATION` stability;
- an `INCOMPLETE` status and every unresolved v0.2 requirement;
- an explicit non-fabrication report.

The migrator never overwrites its input or an existing output, confines output to the current workspace, follows no output-parent symlink escape, and writes with exclusive creation. Re-migrating a migration result is byte-idempotent. A v0.2 conformance bundle is rejected as already migrated.

## What migration cannot do

Migration MUST NOT fabricate reason-bound reachability, observation artifacts, scenario/execution digests, signatures, signer identities, source evidence, observation coverage, or repeated trials. A fresh v0.2 run is required to resolve those gaps.

The v0.1 bundle is validated before migration. Invalid, secret-bearing, unsupported-version, or malformed input fails closed.
