# Contributing

Thank you for improving ResiliReplay.

1. Open an issue for behavior changes or new fault semantics.
2. Create a focused branch and keep the core provider-agnostic.
3. Add deterministic tests for every behavior. Never include real secrets or production traces.
4. Run `pnpm quality`, `pnpm test:e2e`, and `pnpm release:gates` on Node 22 or 24.
5. Update schema documentation and `CHANGELOG.md` when contracts change.

Faults must have a bounded effect, stable seed behavior, and a safety analysis. Filesystem tests may
operate only in owned temporary directories. MCP fixtures must be local toy servers. Tests may not
contact external services. Studio changes must preserve loopback-only binding, Host/Origin/CSRF
checks, contained downloads, explicit tool confirmation, cancellation, and listener/process cleanup.

Campaign schema changes require formal schema updates, migration notes, hostile-input tests, and a
clear decision about backward compatibility. Never infer token, cost, latency, side-effect, or
coverage metrics when the adapter did not provide evidence.

Commits should be reviewable and use the Developer Certificate of Origin sign-off (`git commit -s`) when required by the maintainers. By contributing, you agree that your contribution is licensed under Apache-2.0.
