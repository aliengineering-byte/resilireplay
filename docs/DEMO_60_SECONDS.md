# Verified sub-60-second product demo

The current Studio demo is generated from a real local run. It imports a reviewed Inspector-shaped
configuration, runs a clean baseline and controlled fault, displays recovery/failure in Studio,
compares an approved baseline, and generates and executes causal regressions. It is understandable
without narration and completed in 2,412 ms on the recorded v0.3.0 workstation.

![Static fallback for the verified Studio demo](assets/studio-campaign.png)

[Watch the real GIF](assets/studio-campaign.gif) ·
[Read the terminal transcript](assets/studio-demo-transcript.txt)

## Reproduce

```console
git clone https://github.com/aliengineering-byte/resilireplay.git
cd resilireplay
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm demo:studio
pnpm capture:studio
python scripts/generate-studio-gif.py
```

`scripts/studio-demo.mjs` performs the genuine campaign/baseline/regression lifecycle and writes the
sanitized transcript. `scripts/capture-studio-demo.mjs` drives the real loopback Studio with
Playwright and captures six frames. The GIF script assembles those frames; it does not invent UI or
terminal output.

## Artifact hashes

```text
18afe7e811258d031604f4ccb70f8459dada6b7d3100b30aa14e5f6c99a30ade  docs/assets/studio-campaign.gif
98fcd3e3eef620f3504241e8aa39bd425b0c95849ba511b6e0c0c5cc0d242716  docs/assets/studio-campaign.png
a169a244c4e6a58b6da478d9f0048f80b3729bc9d2c4ae506a755ce4a493758  docs/assets/studio-demo-transcript.txt
915d0c4094cd48e9933beb91d61ea73774718d020bb38eccdc2c2249d9f6add7  scripts/studio-demo.mjs
cb9fda4849fe941727d401f385cd68b1f33fc3dc079ad6ebaf226a689dac1301  scripts/capture-studio-demo.mjs
```

The demo uses repository-owned fixtures, not any tested external project. It sends no telemetry and
needs no API key or provider. A passing demo is bounded reliability evidence, not certification.
