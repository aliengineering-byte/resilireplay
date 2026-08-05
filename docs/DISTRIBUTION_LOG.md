# Distribution log

All times use ISO 8601. No password, cookie, token, session identifier, private account detail, or
browser artifact is recorded here.

## GitHub Marketplace

- **Applicable rules:** public repository; one root `action.yml`/`action.yaml`; unique Action name;
  valid metadata and branding; release publication with a primary and optional secondary category;
  Marketplace terms accepted by the repository owner; 2FA for publication.
- **Intended name:** ResiliReplay — Agent and MCP Reliability Tests
- **Release:** `v0.3.1` is required. The existing `v0.3.0` tag is unchanged.
- **Reason for patch:** a clean external repository proved that `v0.3.0` ran `pnpm install` in the
  caller workspace on Ubuntu and Windows with Node.js 22 and 24. The corrected Action builds in
  `github.action_path` and keeps inputs caller-relative.
- **External smoke repository:** https://github.com/aliengineering-byte/resilireplay-action-smoke
- **Initial failing run:** https://github.com/aliengineering-byte/resilireplay-action-smoke/actions/runs/30962409218
- **Successful `v0.3.1` run:** https://github.com/aliengineering-byte/resilireplay-action-smoke/actions/runs/30963916108
- **Final public URL:** pending publication immediately after this PR places the unique `v0.3.1`
  metadata on the default branch.
- **Publication time:** pending.
- **Categories:** Continuous integration (primary) and Testing (secondary), selected from the current
  Marketplace category list.
- **Manual user steps:** accepted the GitHub Marketplace Developer Agreement and enabled GitHub 2FA.
- **Visibility:** not yet listed. GitHub enabled the Marketplace form after both manual steps, but its
  pre-merge preview still reads the old Action metadata from `main`; publishing that stale preview
  would use the wrong name and description.
- **Feedback/status:** no Marketplace review or rejection.
- **Objective lesson:** test a composite Action from a caller repository; an in-repository smoke test
  does not expose caller/action working-directory confusion.

## Reddit — r/modelcontextprotocol

- **Applicable rules observed:** the current configured community-rules page is empty; the community
  description adds no project-release restriction; the composer exposes `new-release`; and recent
  technical project releases use that flair. A subreddit search found no ResiliReplay duplicate.
- **Final title:** I built a deterministic chaos and recovery tester for MCP servers — validated
  against MCP Everything, Playwright MCP, and UI5 MCP
- **Flair:** `new-release`.
- **Content summary:** maintainer disclosure, Inspector distinction, one dry-run command, three
  bounded public field validations, explicit non-vulnerability/non-certification language, and one
  question about the most useful failure boundary.
- **Final public URL:** https://www.reddit.com/r/modelcontextprotocol/comments/1vfsijo/i_built_a_deterministic_chaos_and_recovery_tester/
- **Publication time:** `2026-08-05T00:53:11.959Z`.
- **Manual user step:** completed Reddit's human-verification challenge and authenticated the existing
  account; no credential was shared.
- **Visibility:** public. The permalink returned HTTP 200 without authentication, and Reddit's public
  oEmbed endpoint returned the exact title and author.
- **Feedback/status:** zero comments at the initial check; no rejection, removal, filter, or moderation
  action was visible.
- **Objective lesson:** lead with a concrete reliability problem, disclose maintainership, and pair a
  copyable dry run with narrow evidence and explicit limitations.

## Durable article — DEV Community

- **Platform choice:** DEV Community; no Hashnode duplicate will be created.
- **Final title:** What Happens When an MCP Tool Fails Halfway? Turning Failures into Regression Tests
- **Content summary:** a 1,047-word technical article covering the control/fault/retry/canary model,
  baseline comparison, executable regression generation, three field cases, safety boundaries, and
  limitations, with the verified Studio image and descriptive alt text.
- **Canonical status:** self-canonical DEV original; no Hashnode duplicate was created.
- **Final public URL:** https://dev.to/aliengineering_byte/what-happens-when-an-mcp-tool-fails-halfway-turning-failures-into-regression-tests-5c0d
- **Publication time:** `2026-08-05T00:54:26Z`.
- **Manual user step:** completed DEV's one-time login flow; no credential was shared. Initial profile
  onboarding used the display name `Ali`, declined optional follows and newsletters, and added no
  private identity data.
- **Visibility:** public. The signed-out page returned HTTP 200 and exposed the self-canonical URL,
  `Ali` byline, four tags, descriptive image alt text, code blocks, and working public links.
- **Feedback/status:** zero comments and reactions at the initial check; no rejection or moderation
  action was visible.
- **Objective lesson:** keep the article evidence-first and use the product site as the primary next
  step instead of duplicating the article across platforms.

## Optional community showcase

Skipped. No specific, rule-confirmed MCP showcase channel was available without entering a general
support/development channel, so no optional community message was posted.
