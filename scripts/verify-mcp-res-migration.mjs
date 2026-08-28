import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  MIGRATION_DIAGNOSTICS,
  validateMigrationResult,
} from "../docs/standards/mcp-res/v0.2.0/conformance-kit/migration-lib.mjs";
import { migrateBundleV01 } from "./migrate-mcp-res-v01-to-v02.mjs";

const root = resolve(import.meta.dirname, "..");
const artifacts = join(root, ".artifacts");
await mkdir(artifacts, { recursive: true });
const temporary = await mkdtemp(join(artifacts, "mcp-res-migration-"));
const corpusDirectory = join(root, ".artifacts", "mcp-res-v02", "migration-corpus");
await mkdir(corpusDirectory, { recursive: true });
const migrationScript = join(root, "scripts", "migrate-mcp-res-v01-to-v02.mjs");
const sourcePath = join(
  root,
  "docs",
  "standards",
  "mcp-res",
  "v0.1.0",
  "test-vectors",
  "valid",
  "minimal-valid-clean-control.json",
);
const sourceBytes = await readFile(sourcePath);
const sourceBundle = JSON.parse(sourceBytes.toString("utf8"));
const toolSha256 = createHash("sha256")
  .update(await readFile(migrationScript))
  .digest("hex");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) {
  return structuredClone(value);
}

async function expectReject(label, operation, pattern) {
  try {
    await operation();
  } catch (error) {
    invariant(pattern.test(String(error)), `${label} returned the wrong error: ${String(error)}`);
    return;
  }
  throw new Error(`${label} did not reject`);
}

const migrated = await migrateBundleV01(sourceBundle, sourceBytes, toolSha256);
invariant((await validateMigrationResult(migrated)).valid, "Valid v0.1 migration failed");
invariant(
  migrated.source.evidenceSha256 === sourceBundle.statement.evidenceSha256,
  "Historical evidence digest was not preserved",
);
invariant(
  migrated.target.evidenceClass === sourceBundle.evidence.evidenceClass,
  "Migration changed evidence class",
);
invariant(
  migrated.target.unresolvedRequirements.includes("SOURCE_EVIDENCE"),
  "Missing source evidence was not marked unresolved",
);
invariant(
  migrated.target.legacyAssertions.some(
    (assertion) =>
      assertion.name === "actualRuntime" && assertion.strength === "LEGACY_SELF_ASSERTED",
  ),
  "Runtime boolean was not downgraded to LEGACY_SELF_ASSERTED",
);
invariant(
  migrated.target.authenticityClassification === "UNSIGNED_INTEGRITY_ONLY" &&
    migrated.target.stabilityClassification === "SINGLE_OBSERVATION",
  "Migration fabricated authenticity or repetition",
);

const migratedBytes = Buffer.from(`${JSON.stringify(migrated, null, 2)}\n`, "utf8");
const migratedAgain = await migrateBundleV01(migrated, migratedBytes, toolSha256);
invariant(
  Buffer.from(`${JSON.stringify(migratedAgain, null, 2)}\n`, "utf8").equals(migratedBytes),
  "Repeated migration was not byte-idempotent",
);

const invalidV01 = clone(sourceBundle);
invalidV01.evidence.operations.find((operation) => operation.kind === "NEGATIVE_CONTROL").outcome =
  "PASS";
await expectReject(
  "invalid v0.1 input",
  () => migrateBundleV01(invalidV01, Buffer.from(JSON.stringify(invalidV01)), toolSha256),
  /MCP_RES_MIGRATION_SOURCE_INVALID/u,
);
const secretV01 = clone(sourceBundle);
secretV01.evidence.subject.authorizationHeader = "Authorization: Bearer TEST_ONLY_NOT_A_SECRET";
await expectReject(
  "secret-bearing v0.1 input",
  () => migrateBundleV01(secretV01, Buffer.from(JSON.stringify(secretV01)), toolSha256),
  /MCP_RES_MIGRATION_SOURCE_INVALID/u,
);
const alreadyV02 = JSON.parse(
  await readFile(
    join(
      root,
      "docs",
      "standards",
      "mcp-res",
      "v0.2.0",
      "test-vectors",
      "valid",
      "reason-bound-negative.json",
    ),
    "utf8",
  ),
);
await expectReject(
  "already-v0.2 input",
  () => migrateBundleV01(alreadyV02, Buffer.from(JSON.stringify(alreadyV02)), toolSha256),
  /MCP_RES_MIGRATION_ALREADY_V02/u,
);

const dryRunOutput = join(temporary, "dry-run-output.json");
const dryRun = spawnSync(
  process.execPath,
  [
    migrationScript,
    "--from",
    "0.1.0",
    "--to",
    "0.2.0",
    "--input",
    sourcePath,
    "--output",
    dryRunOutput,
    "--dry-run",
  ],
  { cwd: root, encoding: "utf8", windowsHide: true },
);
invariant(
  dryRun.status === 0 && JSON.parse(dryRun.stdout).dryRun,
  `Dry run failed: ${dryRun.stderr}`,
);
try {
  await access(dryRunOutput);
  throw new Error("Dry run wrote an output file");
} catch (error) {
  invariant(
    !(error instanceof Error) || error.message !== "Dry run wrote an output file",
    String(error),
  );
}

const conflictOutput = join(temporary, "conflict.json");
await writeFile(conflictOutput, "{}\n", "utf8");
const conflict = spawnSync(
  process.execPath,
  [
    migrationScript,
    "--from",
    "0.1.0",
    "--to",
    "0.2.0",
    "--input",
    sourcePath,
    "--output",
    conflictOutput,
  ],
  { cwd: root, encoding: "utf8", windowsHide: true },
);
invariant(
  conflict.status === 1 && /MCP_RES_MIGRATION_OUTPUT_CONFLICT/u.test(conflict.stderr),
  "Output conflict did not fail closed",
);

const overwrite = spawnSync(
  process.execPath,
  [
    migrationScript,
    "--from",
    "0.1.0",
    "--to",
    "0.2.0",
    "--input",
    sourcePath,
    "--output",
    sourcePath,
  ],
  { cwd: root, encoding: "utf8", windowsHide: true },
);
invariant(
  overwrite.status === 1 && /MCP_RES_MIGRATION_INPUT_OVERWRITE_FORBIDDEN/u.test(overwrite.stderr),
  "Input overwrite did not fail closed",
);

const containedInput = join(temporary, "input.json");
await writeFile(containedInput, sourceBytes);
const escape = spawnSync(
  process.execPath,
  [
    migrationScript,
    "--from",
    "0.1.0",
    "--to",
    "0.2.0",
    "--input",
    containedInput,
    "--output",
    join(temporary, "..", "escape.json"),
  ],
  { cwd: temporary, encoding: "utf8", windowsHide: true },
);
invariant(
  escape.status === 1 && /MCP_RES_MIGRATION_OUTPUT_OUTSIDE_WORKSPACE/u.test(escape.stderr),
  "Output containment did not fail closed",
);

const migrationCases = [
  ["valid-migration", migrated, []],
  [
    "digest-substitution",
    (() => {
      const value = clone(migrated);
      value.source.evidenceSha256 = "0".repeat(64);
      return value;
    })(),
    [MIGRATION_DIAGNOSTICS.DIGEST_MISMATCH],
  ],
  [
    "evidence-class-promotion",
    (() => {
      const value = clone(migrated);
      value.target.evidenceClass = "GENUINE_RUNTIME";
      value.report.preservedEvidenceClass = "GENUINE_RUNTIME";
      return value;
    })(),
    [MIGRATION_DIAGNOSTICS.CLASS_PROMOTION],
  ],
  [
    "fabricated-completion",
    (() => {
      const value = clone(migrated);
      value.report.unresolvedRequirements = value.report.unresolvedRequirements.slice(1);
      return value;
    })(),
    [MIGRATION_DIAGNOSTICS.FABRICATION],
  ],
  [
    "invalid-embedded-source",
    (() => {
      const value = clone(migrated);
      value.originalBundle.evidence.operations.find(
        (operation) => operation.kind === "NEGATIVE_CONTROL",
      ).outcome = "PASS";
      return value;
    })(),
    [MIGRATION_DIAGNOSTICS.SOURCE_INVALID],
  ],
];
const catalog = {
  schemaVersion: "mcp-res.migration-test-corpus/0.2.0",
  cases: [],
};
for (const [id, value, expectedDiagnostics] of migrationCases) {
  const validation = await validateMigrationResult(value);
  invariant(
    JSON.stringify(validation.diagnostics) === JSON.stringify(expectedDiagnostics),
    `Migration diagnostic mismatch for ${id}: ${JSON.stringify(validation)}`,
  );
  const file = `${id}.json`;
  await writeFile(join(corpusDirectory, file), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  catalog.cases.push({ id, file, expectedDiagnostics });
}
await writeFile(
  join(corpusDirectory, "catalog.json"),
  `${JSON.stringify(catalog, null, 2)}\n`,
  "utf8",
);
console.log(
  JSON.stringify({
    validMigration: true,
    invalidSourceRejected: true,
    alreadyV02Rejected: true,
    missingSourceEvidenceMarked: true,
    legacyRuntimeDowngraded: true,
    historicalDigestPreserved: true,
    repeatedMigrationIdempotent: true,
    dryRunWriteFree: true,
    outputConflictRejected: true,
    inputOverwriteRejected: true,
    outputContainmentEnforced: true,
    secretRejected: true,
    migrationCorpusCases: migrationCases.length,
    corpusDirectory,
  }),
);
