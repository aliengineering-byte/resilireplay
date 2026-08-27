import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  loadSchemaValidator,
  scenarioFingerprint,
  validateBundle,
} from "../docs/standards/mcp-res/v0.2.0/conformance-kit/lib.mjs";
import { validateBundle as validateV01Bundle } from "../docs/standards/mcp-res/v0.1.0/conformance-kit/lib.mjs";

const root = resolve(import.meta.dirname, "..");
const standard = join(root, "docs", "standards", "mcp-res", "v0.2.0");
const schemas = join(standard, "schemas");
const vectors = join(standard, "test-vectors");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function fileSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function legacyVerdictOnlyWouldPass(bundle) {
  const negative = bundle.evidence.operations.find(
    (operation) => operation.kind === "NEGATIVE_CONTROL",
  );
  return Boolean(negative && negative.outcome === "EXPECTED_FAILURE" && negative.faultId !== null);
}

const generated = spawnSync(
  process.execPath,
  [join(root, "scripts", "generate-mcp-res-v02-vectors.mjs"), "--check"],
  { cwd: root, encoding: "utf8", windowsHide: true },
);
invariant(
  generated.status === 0,
  `v0.2 vectors are not reproducible: ${generated.stderr || generated.stdout}`,
);

const compiled = await loadSchemaValidator(schemas);
invariant(compiled.count === 7, `Expected 7 v0.2 schemas, got ${compiled.count}`);

const catalog = JSON.parse(await readFile(join(vectors, "catalog.json"), "utf8"));
let validCount = 0;
let invalidCount = 0;
for (const entry of [...catalog.valid, ...catalog.invalid]) {
  const bytes = await readFile(join(vectors, entry.path));
  invariant(fileSha256(bytes) === entry.fileSha256, `Vector byte hash mismatch: ${entry.path}`);
  const result = await validateBundle(JSON.parse(bytes.toString("utf8")), {
    schemaDirectory: schemas,
  });
  invariant(
    JSON.stringify(result.diagnostics) === JSON.stringify(entry.expectedDiagnostics),
    `Unexpected diagnostic for ${entry.id}: ${JSON.stringify(result)}`,
  );
  if (result.valid) validCount += 1;
  else invalidCount += 1;
}
invariant(
  validCount === 4 && invalidCount === 21,
  `Unexpected vector counts ${validCount}/${invalidCount}`,
);

const validReason = JSON.parse(
  await readFile(join(vectors, "valid", "reason-bound-negative.json"), "utf8"),
);
const validRerun = JSON.parse(
  await readFile(join(vectors, "valid", "equivalent-scenario-distinct-run.json"), "utf8"),
);
invariant(
  validReason.evidence.scenario.fingerprint === validRerun.evidence.scenario.fingerprint,
  "Equivalent reruns did not retain the same scenario fingerprint",
);
invariant(
  validReason.statement.executionInstanceDigest !== validRerun.statement.executionInstanceDigest,
  "Separate runs did not receive distinct execution instance digests",
);
const changedFault = structuredClone(validReason.evidence.scenario.descriptor);
changedFault.faults[0].expectedEffect = "DIFFERENT_EFFECT";
invariant(
  scenarioFingerprint(changedFault) !== validReason.evidence.scenario.fingerprint,
  "Changing the fault did not change the scenario fingerprint",
);
const timestampOnly = structuredClone(validReason.evidence);
timestampOnly.run.startedAt = "2030-01-01T00:00:00.000Z";
timestampOnly.run.finishedAt = "2030-01-01T00:00:01.000Z";
invariant(
  scenarioFingerprint(timestampOnly.scenario.descriptor) ===
    validReason.evidence.scenario.fingerprint,
  "Wall-clock fields contaminated the scenario fingerprint",
);

const verdictOnlyFalseGreen = JSON.parse(
  await readFile(join(vectors, "invalid", "verdict-only-false-green.json"), "utf8"),
);
invariant(
  legacyVerdictOnlyWouldPass(verdictOnlyFalseGreen),
  "The false-green demonstration no longer exercises the verdict-only weakness",
);
invariant(
  (await validateBundle(verdictOnlyFalseGreen, { schemaDirectory: schemas })).diagnostics[0] ===
    "MCP_RES_WRONG_STOP_REASON",
  "The v0.2 reason-bound validator did not eliminate the verdict-only false green",
);

const legacyPromotion = structuredClone(validReason);
legacyPromotion.evidence.evidenceClassClaim = "GENUINE_RUNTIME";
legacyPromotion.statement.evidenceClass = "GENUINE_RUNTIME";
legacyPromotion.evidence.legacyAssertions = [
  { name: "actualRuntime", value: true, strength: "LEGACY_SELF_ASSERTED" },
  { name: "protocolMessagesExchanged", value: true, strength: "LEGACY_SELF_ASSERTED" },
];
invariant(
  (await validateBundle(legacyPromotion, { schemaDirectory: schemas })).diagnostics[0] ===
    "MCP_RES_EVIDENCE_CLASS_PROMOTION",
  "Legacy self-assertions silently promoted a v0.2 evidence class",
);

const v01Path = join(
  root,
  "docs",
  "standards",
  "mcp-res",
  "v0.1.0",
  "test-vectors",
  "valid",
  "minimal-valid-clean-control.json",
);
const v01Bundle = JSON.parse(await readFile(v01Path, "utf8"));
invariant(
  (await validateV01Bundle(v01Bundle)).valid,
  "v0.1 validator no longer reads v0.1 evidence",
);
invariant(
  !(await validateBundle(v01Bundle, { schemaDirectory: schemas })).valid,
  "v0.1 evidence was silently accepted as v0.2 evidence",
);
const v01Tree = spawnSync("git", ["rev-parse", "HEAD:docs/standards/mcp-res/v0.1.0"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});
invariant(v01Tree.status === 0, `Unable to resolve v0.1 tree: ${v01Tree.stderr}`);
invariant(
  v01Tree.stdout.trim() === "ae968910b6305bbac6a85f6a0bb01cea52efa6cd",
  `v0.1 immutable tree changed: ${v01Tree.stdout.trim()}`,
);

const migrationRecord = JSON.parse(await readFile(join(standard, "MIGRATION_RECORD.json"), "utf8"));
invariant(
  migrationRecord.changes.every((change) => change.promotionAllowed === false),
  "PR 1 migration record permits silent semantic promotion",
);

const verification = {
  standardVersion: "0.2.0",
  phase: "PR 1 evidence semantics",
  schemasCompiled: compiled.count,
  validVectors: validCount,
  invalidVectors: invalidCount,
  schemaTests: validCount + invalidCount,
  semanticAndMutationTests: invalidCount,
  migrationTests: 4,
  verdictOnlyFalseGreenReproduced: true,
  reasonBoundFalseGreenEliminated: true,
  equivalentScenarioFingerprint: validReason.evidence.scenario.fingerprint,
  distinctExecutionDigests: true,
  legacyPromotionRejected: true,
  v01ReadableByV01Validator: true,
  v01RejectedByV02Validator: true,
  v01Tree: v01Tree.stdout.trim(),
};
const artifacts = join(root, ".artifacts", "mcp-res-v02");
await mkdir(artifacts, { recursive: true });
await writeFile(
  join(artifacts, "verification.json"),
  `${JSON.stringify(verification, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(verification));
