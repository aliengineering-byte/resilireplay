# Distribution and license consistency audit

Audit date: 2026-08-04 (America/New_York)

This is a repository consistency audit, not legal advice.

## Conclusion

ResiliReplay remains licensed only under the Apache License 2.0. The root license text was not
modified. Repository, package, README, GitHub detection, Action, and release-facing declarations are
consistent with `Apache-2.0`, subject to the manual npm profile correction noted below.

## Verified surfaces

| Surface                            | Result                                                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root `LICENSE`                     | The Apache License 2.0 text remains unchanged by this mission.                                                                                                                                                            |
| Root manifest                      | `package.json` declares `Apache-2.0` and the public author identity `Ali` with the approved GitHub noreply address.                                                                                                       |
| Workspace package manifests        | Every manifest under `packages/` declares `Apache-2.0`; an automated distribution-metadata test enforces this.                                                                                                            |
| Published CLI manifest and tarball | The CLI manifest declares `Apache-2.0`; the package smoke gate verifies that the tarball contains the manifest and Apache license and no unexpected files.                                                                |
| npm registry                       | Public `resilireplay@0.3.0` reports `Apache-2.0`. The synchronized `0.3.1` manifest retains the same license.                                                                                                             |
| README and product site            | The README states that ResiliReplay is Apache-2.0 licensed and links to the root license; the public site identifies the project as Apache-2.0.                                                                           |
| GitHub repository                  | The repository is public and GitHub detects “Apache License 2.0.”                                                                                                                                                         |
| GitHub Action                      | The Marketplace Action is served from the single root `action.yml`; Marketplace license display is inherited from the Apache-2.0 repository. The subdirectory metadata is not an automatically listed Marketplace Action. |
| Release/package notices            | The changelog describes the Apache-2.0 package boundary, the release evidence points to repository limitations, and the CLI package includes its Apache license.                                                          |

No CLA, dual-license agreement, trademark policy, custom restriction, or alternate software license
was introduced.

## Privacy and distribution corrections

- The disposable package-smoke install had entered the workspace lockfile with an absolute local
  path. The generated importer and package snapshot were removed, and the smoke installer now runs
  without writing a workspace lockfile.
- The root and published package manifests now declare only the approved public author identity.
- npm derives the `maintainers` contact from the npm account profile. The existing registry profile
  still requires a manual security-key or password confirmation before its email can be changed to
  the approved GitHub noreply address. No credential or private address is recorded here.
- The `v0.3.0` annotated tag object and its peeled commit remain unchanged. Historical tag contents
  were not rewritten to remove the earlier generated lockfile entry, because the mission explicitly
  requires preserving that immutable release.

## Verification commands and evidence

- `git diff -- LICENSE` — no change.
- `pnpm exec vitest run tests/distribution-metadata.test.ts` — root Action structure, metadata,
  caller/action path separation, and Apache-2.0 declarations.
- `pnpm package:smoke` — clean install, package contents, manifest, version/help/fault commands.
- `pnpm secret:scan` and `pnpm hygiene:scan` — repository credential and privacy gates.
- `npm view resilireplay@0.3.0 ...` (via the configured package runtime) — public registry license and
  package metadata.
- GitHub repository API and release/tag APIs — public visibility, detected license, release, and
  annotated tag object.

The final distribution log records the publication-specific checks and any manual platform steps.
