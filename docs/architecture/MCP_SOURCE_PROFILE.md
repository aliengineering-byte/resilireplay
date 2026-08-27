# ADR: Inspector configuration as a versioned source profile

Status: accepted for the v0.6 core-hardening tranche.

## Problem

ResiliReplay accepts a reviewed Inspector-shaped `mcp.json`, but Inspector's file includes
Inspector-specific settings and is changing while an official client-configuration proposal is
still unresolved. Treating the current shape as ResiliReplay's universal schema would create an
unofficial competing standard and couple campaign semantics to Inspector churn.

## Observed coupling

The repository already confines Inspector fields to `@resilireplay/mcp-chaos` and maps a selected
entry into a neutral stdio or HTTP connection description before campaign execution. Core traces,
fault injection, scoring, reports, and regression compilation do not read `mcpServers` or
Inspector-specific settings. The missing pieces are an explicit source-profile identity/version,
resource bounds, and current compatibility evidence in the sanitized plan.

## Decision

Retain and harden the existing minimal adapter boundary as a read-only source profile:

- identify the profile and its ResiliReplay profile version explicitly;
- state the reviewed Inspector release range rather than implying a universal `mcp.json` schema;
- never rewrite, seed, migrate, or normalize the source file in place;
- preserve stdio command/argument boundaries and never introduce a shell;
- map supported transport fields into the neutral imported connection types;
- reject unknown, ambiguous, conflicting, oversized, and execution-affecting unsupported fields;
- keep credential values out of the sanitized plan and derived evidence;
- hash the exact non-secret source bytes for provenance; and
- allow a future source profile to be added without changing campaign semantics.

## Alternatives

1. Continue implicit Inspector coupling. Rejected because a hard-coded compatibility string does not
   make the supported source contract falsifiable and encourages accidental schema drift.
2. Define a universal ResiliReplay client-config schema. Rejected because official SEP-2633 is still
   a draft and its envelope, secret references, authentication, and versioning remain unresolved.
3. Remove Inspector import. Rejected because the existing read-only workflow is useful, bounded, and
   backward compatible when accurately scoped.

## Compatibility, migration, and rollback

Existing supported Inspector 2.0.0 and 2.1.0 stdio, HTTP, and legacy SSE inputs retain their CLI
behavior. The sanitized dry-run plan gains explicit profile metadata. Unsupported fields continue to
fail closed. Future official client-config support should be a new profile identifier/version that
maps to the same neutral connection description; it must not silently reinterpret this profile.

Rollback is deletion of the profile metadata and bounds while retaining the existing importer. No
source files, public commands, campaign schemas, or trace schemas are migrated by this decision.

## Official research record (observed 2026-08-27)

- Normative: MCP specification release `2026-07-28`, commit
  `5f5440bb26a62e2cf3440b92da5a667efa03b267`, defines protocol transports but not a universal client
  configuration file.
- Released upstream behavior: MCP Inspector `2.1.0`, commit
  `c7bccd477d38c2c17afb4878bcca8ee5f563c5d2`, documents a top-level `mcpServers` map plus
  Inspector-specific fields and distinguishes writable `--catalog` from read-only `--config`.
- Proposed: modelcontextprotocol/modelcontextprotocol draft PR #2633 at head
  `6f108877fd8a858cd7e066a37009d33536b9ca2f` proposes a standard client-side `mcp.json`; it is not
  normative or merged.
- Unresolved: modelcontextprotocol/inspector issue #1912 remains open. A project member's
  2026-08-27 comment warns that documenting the present Inspector layout for external integration may
  be premature and subject to near-term standards change.
