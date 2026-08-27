# ResiliReplay reference implementation mapping

ResiliReplay is the initial reference implementation, not a required dependency. The boundary exporter reads a sanitized projection of an already completed run and writes only the published MCP-RES fields.

| ResiliReplay concept          | MCP-RES field                                   |
| ----------------------------- | ----------------------------------------------- |
| campaign/run manifest         | evidence envelope and run identity              |
| uninjected scenario           | `CLEAN_CONTROL`                                 |
| fault catalog entry + seed    | deterministic fault description                 |
| recovery declaration          | bounded recovery policy                         |
| causal trace event IDs        | run/operation/parent/fault bindings             |
| generated regression          | executable-regression evidence                  |
| report/trace hashes           | integrity artifact entries                      |
| owned process/listener checks | cleanup result                                  |
| support labels                | evidence class, never promoted by fixture shape |

The exporter does not rename or rewrite the campaign, trace, agent, or MCP audit engines. It imports only the public standard canonicalization/integrity module and consumes a sanitized JSON boundary record. The black-box validator imports no ResiliReplay package.

Reproduce the two committed reference bundles into new paths:

```console
node scripts/export-mcp-res-reference.mjs docs/standards/mcp-res/v0.1.0/reference-inputs/resilireplay-mcp-demo.json .artifacts/resilireplay-mcp-demo.mcp-res.json
node scripts/export-mcp-res-reference.mjs docs/standards/mcp-res/v0.1.0/reference-inputs/mcp-everything-2026.7.4.json .artifacts/mcp-everything.mcp-res.json
```

Publication is exclusive (`wx`): an existing output is never overwritten. Generation does not launch either subject. Runtime execution happened before export and is identified by the source evidence digest.

Each committed bundle binds the exact adjacent sanitized input projection in `reference-inputs/` by path, byte count, and SHA-256. That projection separately records the original run-manifest byte count and SHA-256, so an independent verifier can validate the published projection without requiring the privacy-sensitive raw trace.

The Everything Server statement means only: “MCP-RES was evaluated against this pinned public subject by the ResiliReplay project.” It does not mean that the package author implemented, adopted, approved, or endorsed MCP-RES.
