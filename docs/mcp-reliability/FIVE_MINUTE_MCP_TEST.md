# Test an MCP reliability boundary in about five minutes

This path uses public `resilireplay@0.6.0`, a repository-owned synthetic stdio server, one inert tool,
one bounded retry, and one expected failure. It needs Node.js 22 or 24 and no API key.

## 1. Prepare the fixture

```console
git clone https://github.com/aliengineering-byte/resilireplay.git
cd resilireplay
corepack enable
pnpm install --frozen-lockfile
pnpm build
npx --yes resilireplay@0.6.0 --version
```

The last command MUST print `0.6.0`. The fixture returns a bounded inert echo and is labeled
synthetic; it is not evidence about another server.

## 2. Preview without contact

```console
npx --yes resilireplay@0.6.0 mcp audit \
  --inspector-config examples/mcp-reliability/mcp.json \
  --server resilient-stdio \
  --dry-run
```

Confirm stdio, the repository-local fixture path, environment variable name only, and no remote
authorization. A dry run starts no server and calls no tool.

## 3. Validate and bind consent

```console
npx --yes resilireplay@0.6.0 campaign validate \
  examples/mcp-reliability/stdio.campaign.yml
```

For the checked-in campaign, validation prints:

```text
Campaign hash 84b64fd60ced0089603e2e66efeff2cf00cf8577756a70b6e816ee3ba4849b06
```

If your hash differs, review the printed plan and use the hash from your own validation. Do not reuse
the documented hash after changing the campaign.

## 4. Run the minimum standard

```console
npx --yes resilireplay@0.6.0 campaign run \
  examples/mcp-reliability/stdio.campaign.yml \
  --confirm-tools 84b64fd60ced0089603e2e66efeff2cf00cf8577756a70b6e816ee3ba4849b06 \
  --output runs/mcp-reliability-stdio
```

Expected terminal result:

```text
Run status      complete
Scenarios       3/3 matched expectations
PASSED    clean-control (fixture; none)
PASSED    bounded-tool-error-recovery (fixture; mcp-tool-error)
PASSED    canary-expected-failure (fixture; mcp-malicious-canary-instruction)
```

The campaign is a pass because the negative control stayed failed exactly as declared. Its recovery
metric remains false; the harness did not turn failure into success.

## 5. Execute the generated regression

The run writes a generated regression below the third scenario. Run the test path printed in your
evidence, or execute the checked-in copy from the verified public run:

```console
node --test examples/mcp-reliability/generated-regression/regression.test.mjs
```

Expected: one test, one pass, zero failures. The manifest binds the six-event source trace to the
three-event minimized fixture, scenario, and test hashes.

## Read the result honestly

This proves the exact synthetic operation met the exact campaign under this environment. It does not
prove production availability, security, every MCP method, every client, or another server version.
The raw tool bodies were omitted with `metadata-only` evidence.

Stop any process you started and remove only `runs/mcp-reliability-stdio` when finished. Verify no
fixture process or listener remains. For a real local server, follow
[CONTRIBUTING_CASES.md](CONTRIBUTING_CASES.md) before replacing the target.
