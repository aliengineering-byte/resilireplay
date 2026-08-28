import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  canonicalize,
  sha256,
  validateBundle,
} from "../docs/standards/mcp-res/v0.2.0/conformance-kit/lib.mjs";

const root = resolve(import.meta.dirname, "..");
const standard = join(root, "docs", "standards", "mcp-res", "v0.2.0");
const schemas = join(standard, "schemas");
const pythonValidator = join(standard, "conformance-kit", "python", "mcp_res_validator.py");
const python = process.env.MCP_RES_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const artifacts = join(root, ".artifacts", "mcp-res-v02");
await mkdir(artifacts, { recursive: true });

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function runPython(args, expectedStatuses = [0, 1]) {
  const result = spawnSync(python, [pythonValidator, ...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  invariant(
    expectedStatuses.includes(result.status),
    `Python validator failed (${result.status}): ${result.stderr || result.stdout}`,
  );
  const lines = result.stdout.trim().split(/\r?\n/u);
  return { status: result.status, output: JSON.parse(lines.at(-1)) };
}

const pythonVersion = spawnSync(python, ["--version"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});
invariant(pythonVersion.status === 0, `Python runtime unavailable: ${pythonVersion.stderr}`);

const catalog = JSON.parse(await readFile(join(standard, "test-vectors", "catalog.json"), "utf8"));
let coreAgreements = 0;
let canonicalAgreements = 0;
for (const entry of [...catalog.valid, ...catalog.invalid]) {
  const path = join(standard, "test-vectors", entry.path);
  const bundle = JSON.parse(await readFile(path, "utf8"));
  const javascript = await validateBundle(bundle, { schemaDirectory: schemas });
  const independent = runPython(["validate", path, "--schemas", schemas]);
  invariant(
    independent.output.valid === javascript.valid &&
      JSON.stringify(independent.output.diagnostics) === JSON.stringify(javascript.diagnostics),
    `Decision/diagnostic disagreement for ${entry.id}: ${JSON.stringify({ javascript, python: independent.output })}`,
  );
  coreAgreements += 1;
  const canonical = runPython(["canonicalize", path], [0]).output;
  const javascriptBytes = Buffer.from(canonicalize(bundle), "utf8");
  invariant(
    canonical.canonicalBase64 === javascriptBytes.toString("base64") &&
      canonical.sha256 === sha256(bundle),
    `Canonical byte/digest disagreement for ${entry.id}`,
  );
  canonicalAgreements += 1;
}

const edgeDirectory = join(artifacts, "python-edge-corpus");
await mkdir(edgeDirectory, { recursive: true });
const unicodeOrdering = join(edgeDirectory, "unicode-ordering.json");
await writeFile(unicodeOrdering, '{"":2,"😀":1}\n', "utf8");
const unicodeValue = JSON.parse(await readFile(unicodeOrdering, "utf8"));
const unicodeIndependent = runPython(["canonicalize", unicodeOrdering], [0]).output;
invariant(
  unicodeIndependent.canonicalBase64 ===
    Buffer.from(canonicalize(unicodeValue), "utf8").toString("base64"),
  "UTF-16 key-order agreement failed",
);
canonicalAgreements += 1;

const unsafeInteger = join(edgeDirectory, "unsafe-integer.json");
await writeFile(unsafeInteger, '{"n":9007199254740992}\n', "utf8");
invariant(
  runPython(["canonicalize", unsafeInteger], [2]).output.diagnostics[0] === "MCP_RES_INPUT_INVALID",
  "Python accepted an unsafe integer",
);
let javascriptRejectedUnsafe = false;
try {
  canonicalize(JSON.parse(await readFile(unsafeInteger, "utf8")));
} catch {
  javascriptRejectedUnsafe = true;
}
invariant(javascriptRejectedUnsafe, "JavaScript accepted an unsafe integer");

const loneSurrogate = join(edgeDirectory, "lone-surrogate.json");
await writeFile(loneSurrogate, '{"value":"\\ud800"}\n', "utf8");
invariant(
  runPython(["canonicalize", loneSurrogate], [2]).output.diagnostics[0] === "MCP_RES_INPUT_INVALID",
  "Python accepted a lone surrogate",
);
let javascriptRejectedSurrogate = false;
try {
  canonicalize(JSON.parse(await readFile(loneSurrogate, "utf8")));
} catch {
  javascriptRejectedSurrogate = true;
}
invariant(javascriptRejectedSurrogate, "JavaScript accepted a lone surrogate");

const attestationGeneration = spawnSync(
  process.execPath,
  [join(root, "scripts", "verify-mcp-res-attestations.mjs")],
  { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
);
invariant(
  attestationGeneration.status === 0,
  `Attestation corpus generation failed: ${attestationGeneration.stderr || attestationGeneration.stdout}`,
);
const attestationDirectory = join(artifacts, "attestation-corpus");
const attestationCatalog = JSON.parse(
  await readFile(join(attestationDirectory, "catalog.json"), "utf8"),
);
let attestationAgreements = 0;
for (const entry of attestationCatalog.cases) {
  const args = [
    "attestation",
    join(attestationDirectory, entry.wrapper),
    "--schemas",
    schemas,
    "--evaluated-at",
    attestationCatalog.evaluatedAt,
  ];
  if (entry.trustPolicy) args.push("--trust-policy", join(attestationDirectory, entry.trustPolicy));
  const independent = runPython(args);
  invariant(
    JSON.stringify(independent.output.diagnostics) === JSON.stringify(entry.expectedDiagnostics),
    `Attestation diagnostic disagreement for ${entry.id}: ${JSON.stringify(independent.output)}`,
  );
  attestationAgreements += 1;
}

const migrationGeneration = spawnSync(
  process.execPath,
  [join(root, "scripts", "verify-mcp-res-migration.mjs")],
  { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
);
invariant(
  migrationGeneration.status === 0,
  `Migration corpus generation failed: ${migrationGeneration.stderr || migrationGeneration.stdout}`,
);
const migrationDirectory = join(artifacts, "migration-corpus");
const migrationCatalog = JSON.parse(
  await readFile(join(migrationDirectory, "catalog.json"), "utf8"),
);
let migrationAgreements = 0;
for (const entry of migrationCatalog.cases) {
  const independent = runPython([
    "migration",
    join(migrationDirectory, entry.file),
    "--schemas",
    schemas,
  ]);
  invariant(
    JSON.stringify(independent.output.diagnostics) === JSON.stringify(entry.expectedDiagnostics),
    `Migration diagnostic disagreement for ${entry.id}: ${JSON.stringify(independent.output)}`,
  );
  migrationAgreements += 1;
}

const verification = {
  implementation: "python-stdlib-second-implementation-validator",
  pythonVersion: (pythonVersion.stdout || pythonVersion.stderr).trim(),
  javascriptImports: 0,
  resilireplayPackageImports: 0,
  coreDecisionAgreements: coreAgreements,
  coreDecisionAgreementPercent: 100,
  diagnosticFamilyAgreementPercent: 100,
  canonicalByteAgreements: canonicalAgreements,
  canonicalByteAgreementPercent: 100,
  digestAgreementPercent: 100,
  attestationAgreements,
  migrationAgreements,
  unsafeIntegerRejectedByBoth: true,
  loneSurrogateRejectedByBoth: true,
  externalIndependenceClaim: false,
};
await writeFile(
  join(artifacts, "python-verification.json"),
  `${JSON.stringify(verification, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(verification));
