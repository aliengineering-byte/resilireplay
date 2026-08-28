import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBundle as validateV01Bundle } from "../../v0.1.0/conformance-kit/lib.mjs";
import { canonicalize, loadSchemaValidator } from "./lib.mjs";

export const MIGRATION_DIAGNOSTICS = Object.freeze({
  SCHEMA_INVALID: "MCP_RES_MIGRATION_SCHEMA_INVALID",
  SOURCE_INVALID: "MCP_RES_MIGRATION_SOURCE_INVALID",
  DIGEST_MISMATCH: "MCP_RES_MIGRATION_DIGEST_MISMATCH",
  CLASS_PROMOTION: "MCP_RES_MIGRATION_CLASS_PROMOTION",
  FABRICATION: "MCP_RES_MIGRATION_FABRICATION",
});

export async function validateMigrationResult(result, options = {}) {
  const schemaDirectory =
    options.schemaDirectory ?? join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
  const { ajv } = await loadSchemaValidator(schemaDirectory);
  const validate = ajv.getSchema(
    "https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/v0.2.0/schemas/migration-result.schema.json",
  );
  if (!validate(result)) {
    return {
      valid: false,
      diagnostics: [MIGRATION_DIAGNOSTICS.SCHEMA_INVALID],
      schemaErrors: (validate.errors ?? []).map(({ instancePath, keyword, message }) => ({
        instancePath,
        keyword,
        message,
      })),
    };
  }
  const source = await validateV01Bundle(result.originalBundle);
  if (!source.valid) {
    return {
      valid: false,
      diagnostics: [MIGRATION_DIAGNOSTICS.SOURCE_INVALID],
      schemaErrors: [],
    };
  }
  if (
    result.source.evidenceSha256 !== result.originalBundle.statement.evidenceSha256 ||
    result.report.preservedEvidenceSha256 !== result.source.evidenceSha256
  ) {
    return {
      valid: false,
      diagnostics: [MIGRATION_DIAGNOSTICS.DIGEST_MISMATCH],
      schemaErrors: [],
    };
  }
  if (
    result.target.evidenceClass !== result.originalBundle.evidence.evidenceClass ||
    result.report.preservedEvidenceClass !== result.originalBundle.evidence.evidenceClass
  ) {
    return {
      valid: false,
      diagnostics: [MIGRATION_DIAGNOSTICS.CLASS_PROMOTION],
      schemaErrors: [],
    };
  }
  if (
    result.migration.fabricatedEvidence !== false ||
    result.target.authenticityClassification !== "UNSIGNED_INTEGRITY_ONLY" ||
    result.target.stabilityClassification !== "SINGLE_OBSERVATION" ||
    result.target.status !== "INCOMPLETE" ||
    result.target.legacyAssertions.some(
      (assertion) => assertion.strength !== "LEGACY_SELF_ASSERTED",
    ) ||
    result.report.legacyAssertionCount !== result.target.legacyAssertions.length ||
    canonicalize(result.report.unresolvedRequirements) !==
      canonicalize(result.target.unresolvedRequirements)
  ) {
    return {
      valid: false,
      diagnostics: [MIGRATION_DIAGNOSTICS.FABRICATION],
      schemaErrors: [],
    };
  }
  return { valid: true, diagnostics: [], schemaErrors: [] };
}
