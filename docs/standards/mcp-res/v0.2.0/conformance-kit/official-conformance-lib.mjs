import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, loadSchemaValidator, sha256 } from "./lib.mjs";

function bytesSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export const OFFICIAL_DIAGNOSTICS = Object.freeze({
  INPUT_INVALID: "MCP_RES_OFFICIAL_INPUT_INVALID",
  SCHEMA_INVALID: "MCP_RES_OFFICIAL_ATTACHMENT_SCHEMA_INVALID",
  REVISION_MISMATCH: "MCP_RES_OFFICIAL_REQUIREMENT_REVISION_MISMATCH",
  LEG_NOT_EXECUTED: "MCP_RES_OFFICIAL_LEG_NOT_EXECUTED",
  INVENTORY_MISMATCH: "MCP_RES_OFFICIAL_INVENTORY_MISMATCH",
  EXPECTED_FAILURE_REWRITTEN: "MCP_RES_OFFICIAL_EXPECTED_FAILURE_REWRITTEN",
  STALE_BASELINE_MISMATCH: "MCP_RES_OFFICIAL_STALE_BASELINE_MISMATCH",
  COVERAGE_INCOMPLETE: "MCP_RES_OFFICIAL_COVERAGE_INCOMPLETE",
  RESULT_DIGEST_MISMATCH: "MCP_RES_OFFICIAL_RESULT_DIGEST_MISMATCH",
  STATUS_MISMATCH: "MCP_RES_OFFICIAL_STATUS_MISMATCH",
  MAPPING_OVERCLAIM: "MCP_RES_OFFICIAL_MAPPING_OVERCLAIM",
});

function checkRef(scenarioId, checkId) {
  return `${scenarioId}:${checkId}`;
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function failingOutcome(outcome) {
  return outcome === "FAILURE" || outcome === "WARNING";
}

function deriveStatus(attachment) {
  if (attachment.checks.some((check) => failingOutcome(check.outcome) && !check.baselineExpected)) {
    return "INVALID";
  }
  if (
    attachment.staleExpectedFailures.length > 0 ||
    attachment.inventories.skipped.length > 0 ||
    attachment.inventories.untestable.length > 0 ||
    attachment.inventories.pending.length > 0 ||
    attachment.inventories.notScored.length > 0 ||
    attachment.harness.exitCode !== 0 ||
    attachment.observationCoverage.some(({ status }) =>
      ["UNINSTRUMENTED", "UNKNOWN"].includes(status),
    )
  ) {
    return "INCOMPLETE";
  }
  return "COMPLETE";
}

export function importOfficialConformance(originalBytes, options) {
  const importedBytes = Buffer.from(originalBytes);
  let rawChecks;
  try {
    rawChecks = JSON.parse(Buffer.from(originalBytes).toString("utf8"));
  } catch {
    throw new Error(OFFICIAL_DIAGNOSTICS.INPUT_INVALID);
  }
  if (!Array.isArray(rawChecks) || rawChecks.length > 4096) {
    throw new Error(OFFICIAL_DIAGNOSTICS.INPUT_INVALID);
  }
  const baseline = sortedUnique(options.expectedFailureEntries ?? []);
  const checks = rawChecks.map((check) => {
    if (
      !check ||
      typeof check !== "object" ||
      typeof check.id !== "string" ||
      !["SUCCESS", "FAILURE", "WARNING", "SKIPPED", "INFO"].includes(check.status)
    ) {
      throw new Error(OFFICIAL_DIAGNOSTICS.INPUT_INVALID);
    }
    const scenarioId =
      typeof check.metadata?.scenario === "string" ? check.metadata.scenario : options.scenarioId;
    const ref = checkRef(scenarioId, check.id);
    return {
      scenarioId,
      checkId: check.id,
      outcome: check.status,
      wireSchema: check.id.startsWith("wire-schema-"),
      baselineExpected: baseline.includes(ref) && failingOutcome(check.status),
      ...(check.details?.untestable === true ? { untestable: true } : {}),
      ...(typeof check.errorMessage === "string" ? { errorMessage: check.errorMessage } : {}),
      detailsSha256: sha256(check.details ?? {}),
    };
  });
  const refs = checks.map((check) => checkRef(check.scenarioId, check.checkId));
  if (new Set(refs).size !== refs.length) throw new Error(OFFICIAL_DIAGNOSTICS.INPUT_INVALID);
  const failureRefs = new Set(
    checks
      .filter((check) => failingOutcome(check.outcome))
      .map((check) => checkRef(check.scenarioId, check.checkId)),
  );
  const declared = sortedUnique(options.expectedCheckRefs ?? refs);
  if (refs.some((ref) => !declared.includes(ref))) {
    throw new Error(OFFICIAL_DIAGNOSTICS.COVERAGE_INCOMPLETE);
  }
  const absent = declared.filter((ref) => !refs.includes(ref));
  const attachment = {
    schemaVersion: "mcp-res.official-conformance-attachment/0.2.0",
    source: options.source,
    protocolRevision: options.protocolRevision,
    requirementSet: options.requirementSet,
    mode: options.mode,
    suite: options.suite,
    legs: options.legs,
    scenarios: sortedUnique(options.scenarios ?? [options.scenarioId]),
    checks,
    inventories: {
      declared,
      executed: sortedUnique(refs),
      wireSchema: sortedUnique(
        checks
          .filter((check) => check.wireSchema)
          .map((check) => checkRef(check.scenarioId, check.checkId)),
      ),
      warnings: sortedUnique(
        checks
          .filter((check) => check.outcome === "WARNING")
          .map((check) => checkRef(check.scenarioId, check.checkId)),
      ),
      skipped: sortedUnique(
        checks
          .filter((check) => check.outcome === "SKIPPED")
          .map((check) => checkRef(check.scenarioId, check.checkId)),
      ),
      untestable: sortedUnique(
        checks
          .filter((check) => check.untestable)
          .map((check) => checkRef(check.scenarioId, check.checkId)),
      ),
      pending: sortedUnique([...(options.pendingCheckRefs ?? []), ...absent]),
      notScored: sortedUnique(options.notScoredCheckRefs ?? []),
    },
    expectedFailureBaseline: { entries: baseline, sha256: sha256(baseline) },
    staleExpectedFailures: baseline.filter((ref) => !failureRefs.has(ref)),
    observationCoverage: options.observationCoverage,
    originalResultArtifact: {
      sha256: options.originalArtifactSha256 ?? bytesSha256(importedBytes),
      bytes: options.originalArtifactBytes ?? importedBytes.length,
      sanitization: options.sanitization ?? { applied: false, fields: [] },
    },
    harness: {
      exitCode: options.harnessExitCode,
      warnings: [...(options.harnessWarnings ?? [])],
    },
    mappingBoundary: {
      officialResultPreserved: true,
      explicitMapping: false,
      mcpResEvidenceClass: null,
      officialCertificationClaim: false,
    },
    importStatus: "COMPLETE",
  };
  attachment.importStatus = deriveStatus(attachment);
  return attachment;
}

function schemaErrors(validate) {
  return (validate.errors ?? []).map(({ instancePath, keyword, message }) => ({
    instancePath,
    keyword,
    message,
  }));
}

export async function validateOfficialConformanceAttachment(attachment, options = {}) {
  const schemaDirectory =
    options.schemaDirectory ?? join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
  const { ajv } = await loadSchemaValidator(schemaDirectory);
  const validate = ajv.getSchema(
    "https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/v0.2.0/schemas/official-conformance-attachment.schema.json",
  );
  if (!validate(attachment)) {
    return {
      valid: false,
      diagnostics: [OFFICIAL_DIAGNOSTICS.SCHEMA_INVALID],
      schemaErrors: schemaErrors(validate),
    };
  }
  if (attachment.protocolRevision !== attachment.requirementSet.revision) {
    return {
      valid: false,
      diagnostics: [OFFICIAL_DIAGNOSTICS.REVISION_MISMATCH],
      schemaErrors: [],
    };
  }
  if (attachment.legs[attachment.mode] !== "EXECUTED") {
    return { valid: false, diagnostics: [OFFICIAL_DIAGNOSTICS.LEG_NOT_EXECUTED], schemaErrors: [] };
  }
  const refs = attachment.checks.map((check) => checkRef(check.scenarioId, check.checkId));
  const expectedWire = sortedUnique(
    attachment.checks
      .filter((check) => check.wireSchema)
      .map((check) => checkRef(check.scenarioId, check.checkId)),
  );
  const expectedWarnings = sortedUnique(
    attachment.checks
      .filter((check) => check.outcome === "WARNING")
      .map((check) => checkRef(check.scenarioId, check.checkId)),
  );
  const expectedSkipped = sortedUnique(
    attachment.checks
      .filter((check) => check.outcome === "SKIPPED")
      .map((check) => checkRef(check.scenarioId, check.checkId)),
  );
  const expectedUntestable = sortedUnique(
    attachment.checks
      .filter((check) => check.untestable)
      .map((check) => checkRef(check.scenarioId, check.checkId)),
  );
  const expectedPending = attachment.inventories.declared.filter((ref) => !refs.includes(ref));
  if (
    new Set(refs).size !== refs.length ||
    canonicalize(sortedUnique(refs)) !== canonicalize(attachment.inventories.executed) ||
    refs.some((ref) => !attachment.inventories.declared.includes(ref)) ||
    canonicalize(expectedWire) !== canonicalize(attachment.inventories.wireSchema) ||
    canonicalize(expectedWarnings) !== canonicalize(attachment.inventories.warnings) ||
    canonicalize(expectedSkipped) !== canonicalize(attachment.inventories.skipped) ||
    canonicalize(expectedUntestable) !== canonicalize(attachment.inventories.untestable) ||
    canonicalize(expectedPending) !== canonicalize(attachment.inventories.pending)
  ) {
    return {
      valid: false,
      diagnostics: [OFFICIAL_DIAGNOSTICS.INVENTORY_MISMATCH],
      schemaErrors: [],
    };
  }
  const baseline = attachment.expectedFailureBaseline.entries;
  if (sha256(baseline) !== attachment.expectedFailureBaseline.sha256) {
    return {
      valid: false,
      diagnostics: [OFFICIAL_DIAGNOSTICS.INVENTORY_MISMATCH],
      schemaErrors: [],
    };
  }
  for (const check of attachment.checks) {
    const ref = checkRef(check.scenarioId, check.checkId);
    if (check.baselineExpected !== (baseline.includes(ref) && failingOutcome(check.outcome))) {
      return {
        valid: false,
        diagnostics: [OFFICIAL_DIAGNOSTICS.EXPECTED_FAILURE_REWRITTEN],
        schemaErrors: [],
      };
    }
  }
  const failures = new Set(
    attachment.checks
      .filter((check) => failingOutcome(check.outcome))
      .map((check) => checkRef(check.scenarioId, check.checkId)),
  );
  const stale = baseline.filter((ref) => !failures.has(ref));
  if (canonicalize(stale) !== canonicalize(attachment.staleExpectedFailures)) {
    return {
      valid: false,
      diagnostics: [OFFICIAL_DIAGNOSTICS.STALE_BASELINE_MISMATCH],
      schemaErrors: [],
    };
  }
  if (options.originalBytes) {
    if (
      bytesSha256(Buffer.from(options.originalBytes)) !==
        attachment.originalResultArtifact.sha256 ||
      Buffer.from(options.originalBytes).length !== attachment.originalResultArtifact.bytes
    ) {
      return {
        valid: false,
        diagnostics: [OFFICIAL_DIAGNOSTICS.RESULT_DIGEST_MISMATCH],
        schemaErrors: [],
      };
    }
  }
  if (
    !attachment.mappingBoundary.explicitMapping &&
    attachment.mappingBoundary.mcpResEvidenceClass !== null
  ) {
    return {
      valid: false,
      diagnostics: [OFFICIAL_DIAGNOSTICS.MAPPING_OVERCLAIM],
      schemaErrors: [],
    };
  }
  if (deriveStatus(attachment) !== attachment.importStatus) {
    return { valid: false, diagnostics: [OFFICIAL_DIAGNOSTICS.STATUS_MISMATCH], schemaErrors: [] };
  }
  return {
    valid: true,
    diagnostics: [],
    schemaErrors: [],
    importStatus: attachment.importStatus,
    officialCertificationClaim: false,
  };
}
