# Field-validation baseline

Evidence date: 2026-08-04 (America/New_York)

## Repository and release state

- Repository root: `E:/AI-Workbench/AgentReliabilityLab` (local evidence only; no private path is
  embedded in published run artifacts).
- Public repository: `https://github.com/aliengineering-byte/resilireplay`.
- Starting branch: clean `main` at `a243bde3920d9044b065bc99792cf952b52bc6f0`.
- Working branch: `codex/resilireplay-field-validation`.
- Remote: `origin` fetch/push points to the public repository above.
- Required public identity: `Ali <268342250+aliengineering-byte@users.noreply.github.com>`; local Git
  configuration matched.
- Annotated tag object: `48029e09aa131421eacf435bc8ff3e2ecb78bc83`.
- `v0.3.0` peeled commit: `b0cff6e1aaa8969a1b67736d640666a8f2aee28c`.
- Remote annotated tag and peeled commit matched the local objects. The tag was not moved, recreated,
  or modified.
- Public release: [ResiliReplay v0.3.0](https://github.com/aliengineering-byte/resilireplay/releases/tag/v0.3.0),
  published and neither draft nor prerelease.
- The two commits after the tag were already merged packaging/report changes; this mission did not
  rewrite release history.

## Public npm package

- Package: `resilireplay@0.3.0`.
- Tarball: `https://registry.npmjs.org/resilireplay/-/resilireplay-0.3.0.tgz`.
- Registry integrity:
  `sha512-0dxa4mkMdFX4vg3do3xw0osevZ7bBFcFx/Ma1aq/+svhwcA2GoRTx9rEf99PLkq3ri/xMA0pt+xOxKpETQlMRA==`.
- Registry SHA-1: `b5a4e725f4f29f06290ccacaa3bae9f3415f63fe`.
- Published: `2026-08-04T20:43:30.066Z`.

The package was installed from the public registry into an ignored isolated project with user/global
npm configuration redirected to `NUL` and common package/provider credential variables cleared. The
installed CLI reported `0.3.0`; its help, campaign, MCP, regression, and Studio commands were present.
No workspace import was used.

## Public quick-start reproduction

The public package binary ran the reviewed repository fixture campaign:

- validation hash: `f4cdf7ea8289253f05c1793fe622e1fd025ce88084b4ebacfd5257deb0974dba`;
- four of four scenarios matched expectations;
- clean stdio control passed;
- one tool-error fault recovered on one retry;
- two declared failures generated and executed causal regressions;
- campaign duration: 1,998 ms; measured command sequence: 2,642 ms;
- run hash: `135ffee060cdd61b1eb6bdb5c22f58fc37014e5de75e7f9daa02ef7b6aa8f91f`;
- approved baseline hash: `082a6fb642d4d287c87f295dce6b8f1733eb86937629f5e0796e1c24451b06a4`;
- baseline comparison: pass, zero differences.

Studio started from the public package in 14 ms on an ephemeral loopback port, returned HTTP 200 with
the expected title, then closed. Its process and listener were absent after shutdown verification.

## CI baseline

The most recent `main` CI and secret-scan runs were green before this branch:

- [CI run 30950167337](https://github.com/aliengineering-byte/resilireplay/actions/runs/30950167337)
- [Secret scan 30950164215](https://github.com/aliengineering-byte/resilireplay/actions/runs/30950164215)

The existing matrix covers Ubuntu and Windows on Node 22 and 24, plus a Windows package smoke test and
an Ubuntu Studio browser/accessibility test. GitHub Pages and Discussions were not enabled at the
baseline. The repository had no Pages site and no homepage URL.

## Preservation statement

The worktree was clean before the branch was created. One initial pnpm isolation attempt touched the
root lock/workspace files; those exact tool-created changes were reversed immediately, returning the
worktree to clean before tracked mission edits began. No existing tag, release, credential, Git
history, neighboring repository, or unrelated user change was altered.
