# Definitive MCP reliability demo

This 32-second silent demo is rendered from a real local run of the public npm
`resilireplay@0.6.0` package. It shows one synthetic stdio fixture, a clean control, one recovered
tool error, one expected failure, the integrity-bound campaign result, and the generated regression
executing with one pass and zero failures.

![Terminal demo of the MCP Reliability Standard: clean control, bounded recovery, expected failure, and passing generated regression](../assets/mcp-reliability-standard-demo.gif)

[Static PNG](../assets/mcp-reliability-standard-demo.png) ·
[verified transcript](../assets/mcp-reliability-standard-demo-transcript.txt) ·
[campaign](../../examples/mcp-reliability/stdio.campaign.yml) ·
[generated regression](../../examples/mcp-reliability/generated-regression/README.md)

The tool operation is an inert bounded echo owned by this repository. The injected canary is
synthetic and the evidence is `metadata-only`. The demo is reliability evidence for this exact
fixture and campaign, not security testing, certification, or proof about another server.

## Reproduce

Follow [the five-minute test](FIVE_MINUTE_MCP_TEST.md), then render the assets from the checked-in
sanitized transcript:

```console
python scripts/generate-mcp-standard-demo.py
```

The renderer fails if required verified lines are missing or a private Windows path appears. It
formats existing terminal output; it does not invent server behavior or test results.

## Artifact hashes

```text
f7fd36130bd32d9b9c37f7c1fea9bfa616ed8720d224a0c4a2183801e859fefd  docs/assets/mcp-reliability-standard-demo.gif
f19cfd5eee587c904b26702d4f902743d9cac405d27b120fa15e1fd2d2af4d17  docs/assets/mcp-reliability-standard-demo.png
8b498d10320ebec648157f0bc9f53d16d00accc21cf2f103afbae853c6f35cb3  docs/assets/mcp-reliability-standard-demo-transcript.txt
1e478c2321c8f31023ad9fd152002954459ecce77f69e568d173b7f69bbfc4ac  scripts/generate-mcp-standard-demo.py
```
