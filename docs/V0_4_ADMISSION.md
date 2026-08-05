# v0.4 admission gate

Do not begin v0.4 feature implementation until at least three of these evidence classes exist:

- three independent external users;
- one outside bug or compatibility issue;
- one outside pull request;
- one real third-party CI adoption;
- repeated evidence of the same missing capability across at least two independent projects.

## Current disposition: gate not met

| Evidence class                                  | Current count | Admission credit |
| ----------------------------------------------- | ------------: | ---------------: |
| Independent external users                      |             0 |                0 |
| Outside bugs or compatibility issues            |             0 |                0 |
| Outside pull requests                           |             0 |                0 |
| Third-party CI adoptions                        |             0 |                0 |
| Repeated missing capability across two projects |             0 |                0 |

The three case studies are founder-run validation against external servers. They are not external
users, adopters, or upstream endorsements.

## Verified demand

None yet. Maintainer responses and independent reproductions have not been received at publication
time.

## Weak signals

- Three independently maintained MCP servers can be tested through the existing v0.3.0 public package.
- Playwright MCP required its documented browser-install step before a real snapshot could recover.
- ESLint MCP exposed a need for reviewed explicit tool arguments, but that is one compatibility
  example, not repeated demand.

## Founder hypotheses

- Declarative per-tool argument fixtures may unlock servers whose safe tools require paths or
  structured inputs.
- More third-party Streamable HTTP campaigns may reveal transport-specific recovery gaps.
- A lighter evidence export may reduce the effort required for outside field-test PRs.

These are hypotheses, not admitted scope.

## Rejected ideas for this gate

Signed attestations, incremental streaming, cloud mode, accounts, telemetry, hosted backends,
framework adapters, fake adopter records, and a universal cross-project score remain outside this
mission. No `v0.4.0` work or tag is created.

## 2026-08-05 authorized amendment: adoption-friction experiment

The original gate and its evidence above remain an accurate historical record. A leadership override
authorizes one bounded v0.4 experiment to test a different product hypothesis:

> Adoption is being blocked primarily by setup friction and unclear time-to-value.

The admitted scope is limited to a zero-configuration deterministic `demo`, a reviewed `adopt` path
from an existing repository-local Inspector-compatible MCP configuration to sanitized evidence,
executable regression, and pinned GitHub Action, plus the exact argument/evidence-mode schema support
needed by that path. Success is measured by a genuine demo under 30 seconds and fixture adoption
under five minutes with all security, compatibility, package, and cross-platform gates intact.

This amendment does not reinterpret the founder-run case studies as demand and does not admit cloud,
accounts, telemetry, billing, autonomous unreviewed tool execution, generic evaluation, or an MCP
Inspector replacement. If the bounded workflow cannot pass its gates, v0.4.0 is not released.
