# MCP Reliability Standard examples

These examples are the smallest executable path through the public working standard. Every target is
repository-owned, local, synthetic, credential-free or uses a clearly synthetic loopback token, and
limited to the inert `reliability_probe` tool.

| File                            | Purpose                                                   | Verified public-package result                |
| ------------------------------- | --------------------------------------------------------- | --------------------------------------------- |
| `mcp.json`                      | Safe Inspector-shaped stdio config                        | Value-free dry run; config hash `3ea2540c...` |
| `stdio.campaign.yml`            | Clean control, bounded tool-error retry, expected failure | 3/3; run hash `8a20705b...`                   |
| `expected-failure.campaign.yml` | Negative control alone                                    | 1/1; run hash `84faad3d...`                   |
| `mcp.http.example.json`         | Authenticated `127.0.0.1` Streamable HTTP config          | Header value resolved only from environment   |
| `streamable-http.campaign.yml`  | Clean and bounded retry over loopback HTTP                | 2/2; run hash `2b8b49c...`                    |
| `generated-regression/`         | Actual minimized causal regression from the stdio canary  | One test passed; hashes match manifest        |

Start with [the five-minute guide](../../docs/mcp-reliability/FIVE_MINUTE_MCP_TEST.md). The checked-in
campaign hashes bind consent only to these exact campaign revisions; validate again after any edit.

The HTTP fixture is a transport example, not an M3/M4 standard result because its campaign does not
include an expected-failure scenario. The stdio campaign reaches M4. No result generalizes to an
external server.
