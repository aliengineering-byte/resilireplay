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
- **Final public URL:** pending release and Marketplace agreement acceptance.
- **Publication time:** pending.
- **Categories:** pending Marketplace form.
- **Manual user step:** accept the GitHub Marketplace Developer Agreement; GitHub may also require
  the account's publication 2FA flow.
- **Visibility:** not yet listed.
- **Feedback/status:** no Marketplace review or rejection; the release edit form is blocked only by
  the unaccepted agreement.
- **Objective lesson:** test a composite Action from a caller repository; an in-repository smoke test
  does not expose caller/action working-directory confusion.

## Reddit — r/modelcontextprotocol

- **Applicable rules observed:** the community exposes a `new-release` flair and recent project
  release posts; public subreddit analytics showed that flair as the most-used current flair. The
  official rules page must still be confirmed after Reddit's human-verification challenge.
- **Final title:** I built a deterministic chaos and recovery tester for MCP servers — validated
  against MCP Everything, Playwright MCP, and UI5 MCP
- **Flair:** intended `new-release`, pending confirmation in the composer.
- **Content summary:** maintainer disclosure, Inspector distinction, one dry-run command, three
  bounded public field validations, explicit non-vulnerability/non-certification language, and one
  question about the most useful failure boundary.
- **Final public URL:** none; no post has been submitted.
- **Publication time:** pending.
- **Manual user step:** complete Reddit's human-verification challenge in the open browser session.
- **Visibility:** not published.
- **Feedback/status:** no rejection or moderation action; posting is blocked before the composer by
  Reddit's human-verification screen.
- **Objective lesson:** preserve one complete technical draft and do not retry through another
  account when eligibility or human verification blocks posting.

## Durable article — DEV Community

- **Platform choice:** DEV Community; no Hashnode duplicate will be created.
- **Final title:** What Happens When an MCP Tool Fails Halfway? Turning Failures into Regression Tests
- **Content summary:** a 1,047-word technical article covering the control/fault/retry/canary model,
  baseline comparison, executable regression generation, three field cases, safety boundaries, and
  limitations, with the verified Studio image and descriptive alt text.
- **Canonical status:** pending; DEV will be the original publication, not a cross-post.
- **Final public URL:** none; no article has been submitted.
- **Publication time:** pending.
- **Manual user step:** sign in to the existing DEV account, or complete DEV's one-time email code if
  no active session exists.
- **Visibility:** not published.
- **Feedback/status:** no rejection or moderation action; publication is blocked at DEV sign-in.
- **Objective lesson:** keep the article evidence-first and use the product site as the primary next
  step instead of duplicating the article across platforms.

## Optional community showcase

Skipped. No specific, rule-confirmed MCP showcase channel was available without entering a general
support/development channel, so no optional community message was posted.
