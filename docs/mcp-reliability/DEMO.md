# Definitive MCP reliability demo

This 32-second silent demo is rendered from a real local run of the public npm
`resilireplay@0.6.0` package. It shows one synthetic stdio fixture, a clean control, one recovered
tool error, one expected failure, the integrity-bound campaign result, and the generated regression
executing with one pass and zero failures.

![Terminal demo of the ResiliReplay MCP reliability evidence profile: clean control, bounded recovery, expected failure, and passing generated regression](../assets/mcp-reliability-standard-demo.gif)

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
de5caeaf6ef6540a0b598b9876ec8a85d707074ad8b29e58446ae9b3142709fd  docs/assets/mcp-reliability-standard-demo.gif
4100ddf2f5c8e4da37139e80d6dd3bbba6e26acf3a06f4fb6f7a82645942e0ff  docs/assets/mcp-reliability-standard-demo.png
8b498d10320ebec648157f0bc9f53d16d00accc21cf2f103afbae853c6f35cb3  docs/assets/mcp-reliability-standard-demo-transcript.txt
3a2ad8521a72e7e9ca251fc2bfcd5ab7e6d82e64c2151b28366fdd5ea5be2fb7  scripts/generate-mcp-standard-demo.py
```
