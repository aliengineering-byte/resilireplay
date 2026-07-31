# Deterministic demo

The ResiliReplay demo is a real, local execution path. It uses the bundled deterministic agent and toy MCP servers; it does not use an API key, paid model, network service, external account, or prerecorded result fixture.

## Run it

From a fresh clone:

```console
pnpm install --frozen-lockfile
pnpm build
pnpm demo
pnpm demo:mcp
pnpm exec resilireplay test scenarios
```

`pnpm demo` performs five steps:

1. records a baseline run from `examples/deterministic-agent`;
2. injects an HTTP 429, delayed tool result, and wrong-recipient handoff;
3. scores the recovered run and a separate unrecovered malformed response;
4. compiles the failed trace into a minimized fixture and executable regression;
5. runs the generated regression with `node:test`.

`pnpm demo:mcp` starts each bundled toy server over stdio and audits it with the official MCP TypeScript SDK. The vulnerable server intentionally produces two safe findings. The resilient server produces none.

Generated evidence is written below `runs/demo/` and `runs/mcp-demo/`. Open `runs/demo/recovered-report/report.html` or `runs/mcp-demo/resilient/mcp-certification.html` in a browser. These HTML files are standalone and load no remote assets.

## Captured transcript

The concise transcript used for the animation is committed at [`docs/assets/demo-transcript.txt`](assets/demo-transcript.txt). Its expected milestones are:

```text
1/5 Recording the no-key deterministic agent
Recorded 8 sanitized events.
2/5 Injecting three deterministic faults (429, delayed tool, wrong recipient)
ResiliReplay v0.1.0  PASS
Recovery score  100/100
3/5 Demonstrating an unrecovered malformed response
ResiliReplay v0.1.0  FAIL
Recovery score  67/100
4/5 Compiling the failed trace into an editable regression
ℹ pass 1
ℹ fail 0
5/5 Demo complete
```

The animation is a selected, path-free rendering of output captured from a successful `pnpm demo` run. It does not invent terminal lines or present fixture-backed provider output as live.

## Reproduce the assets

Python 3 and Pillow are required only to regenerate the committed launch assets, not to use ResiliReplay:

```console
python -m pip install Pillow
python scripts/generate-demo-assets.py
```

The script runs `pnpm demo` itself, verifies the expected recovery and regression milestones, writes the concise transcript, renders `docs/assets/resilireplay-demo.gif`, and creates the 1280×640 social preview PNG plus its SVG source.

The generator deliberately omits absolute output paths from the visual transcript. The underlying run remains available under `runs/` for inspection.
