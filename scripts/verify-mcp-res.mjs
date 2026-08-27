import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { createReferenceValidator } from "./reference-mcp-res-validator.mjs";
import {
  canonicalize,
  loadSchemaValidator,
  validateBundle,
} from "../docs/standards/mcp-res/v0.1.0/conformance-kit/lib.mjs";

const root = resolve(import.meta.dirname, "..");
const standard = join(root, "docs", "standards", "mcp-res", "v0.1.0");
const schemas = join(standard, "schemas");
const vectors = join(standard, "test-vectors");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function fileSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function filesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesRecursively(path)));
    else files.push(path);
  }
  return files;
}

const generated = spawnSync(
  process.execPath,
  [join(root, "scripts", "generate-mcp-res-vectors.mjs"), "--check"],
  {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  },
);
invariant(
  generated.status === 0,
  `Vector generation is not byte-for-byte reproducible: ${generated.stderr || generated.stdout}`,
);

const compiled = await loadSchemaValidator(schemas);
invariant(compiled.count === 9, `Expected 9 compiled schemas, got ${compiled.count}`);
const reference = await createReferenceValidator(schemas);
invariant(reference.schemaCount === 9, "Reference validator did not compile all schemas");

const profileValidate = compiled.ajv.getSchema(
  "https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/v0.1.0/schemas/profile-manifest.schema.json",
);
const profilePaths = [
  "server-tool-call-v1.json",
  "client-config-source-v1.json",
  "agent-tool-recovery-v1.json",
];
for (const name of profilePaths) {
  const profile = JSON.parse(await readFile(join(standard, "profiles", name), "utf8"));
  invariant(
    profileValidate(profile),
    `Invalid profile manifest ${name}: ${JSON.stringify(profileValidate.errors)}`,
  );
}

const catalog = JSON.parse(await readFile(join(vectors, "catalog.json"), "utf8"));
let validCount = 0;
let invalidCount = 0;
let agreementCount = 0;
for (const entry of [...catalog.valid, ...catalog.invalid]) {
  const path = join(vectors, entry.path);
  const bytes = await readFile(path);
  invariant(fileSha256(bytes) === entry.fileSha256, `Vector byte hash mismatch: ${entry.path}`);
  const bundle = JSON.parse(bytes.toString("utf8"));
  const independent = await validateBundle(bundle, { schemaDirectory: schemas });
  invariant(
    JSON.stringify(independent.diagnostics) === JSON.stringify(entry.expectedDiagnostics),
    `Unexpected diagnostic for ${entry.id}: ${JSON.stringify(independent)}`,
  );
  const expectedValid = entry.expectedDiagnostics.length === 0;
  invariant(independent.valid === expectedValid, `Independent result mismatch for ${entry.id}`);
  invariant(
    reference.validate(bundle) === expectedValid,
    `Reference result mismatch for ${entry.id}`,
  );
  agreementCount += 1;
  if (expectedValid) validCount += 1;
  else invalidCount += 1;
}
invariant(
  validCount === 7 && invalidCount === 18,
  `Unexpected vector inventory ${validCount}/${invalidCount}`,
);

const handValid = JSON.parse(
  await readFile(join(standard, "examples", "hand-authored-valid.json"), "utf8"),
);
const handInvalid = JSON.parse(
  await readFile(join(standard, "examples", "hand-authored-invalid.json"), "utf8"),
);
invariant(
  (await validateBundle(handValid, { schemaDirectory: schemas })).valid,
  "Hand-authored valid example failed",
);
invariant(
  (await validateBundle(handInvalid, { schemaDirectory: schemas })).diagnostics[0] ===
    "MCP_RES_MISSING_CLEAN_CONTROL",
  "Hand-authored invalid example was not rejected precisely",
);

const fieldNames = ["resilireplay-mcp-demo.mcp-res.json", "mcp-everything-2026.7.4.mcp-res.json"];
const fieldBundles = [];
for (const name of fieldNames) {
  const bundle = JSON.parse(await readFile(join(standard, "field-evidence", name), "utf8"));
  const independent = await validateBundle(bundle, { schemaDirectory: schemas });
  invariant(
    independent.valid && reference.validate(bundle),
    `Field/reference bundle failed: ${name}`,
  );
  fieldBundles.push(bundle);
}

const mutations = [
  [
    "remove clean control",
    (bundle) => {
      bundle.evidence.operations = bundle.evidence.operations.filter(
        (operation) => operation.kind !== "CLEAN_CONTROL",
      );
    },
  ],
  [
    "make negative control vacuous",
    (bundle) => {
      bundle.evidence.operations.find(
        (operation) => operation.kind === "NEGATIVE_CONTROL",
      ).outcome = "PASS";
    },
  ],
  [
    "make retry unbounded",
    (bundle) => {
      bundle.evidence.recoveryPolicies[0].retryLimit = "unbounded";
    },
  ],
  [
    "leave a child process",
    (bundle) => {
      bundle.evidence.cleanup.childProcessesRemaining = 1;
      bundle.evidence.cleanup.complete = false;
    },
  ],
  [
    "alter evidence digest",
    (bundle) => {
      bundle.integrity.artifacts.find(
        (artifact) => artifact.path === "evidence-envelope.json",
      ).sha256 = "0".repeat(64);
    },
  ],
  [
    "mark manifest partial",
    (bundle) => {
      bundle.integrity.complete = false;
    },
  ],
  [
    "break run causality",
    (bundle) => {
      bundle.evidence.operations[0].runId = "run-wrong-0000";
    },
  ],
  [
    "promote fixture evidence",
    (bundle) => {
      bundle.integrity.artifacts = bundle.integrity.artifacts.filter(
        (artifact) => !artifact.path.startsWith("source-evidence/"),
      );
      bundle.evidence.evidenceClass = "GENUINE_RUNTIME";
    },
  ],
  [
    "retry side effect unsafely",
    (bundle) => {
      bundle.evidence.recoveryPolicies[0].sideEffectModel = "SIDE_EFFECTING";
    },
  ],
  [
    "add unknown execution field",
    (bundle) => {
      bundle.evidence.execution.unboundedCapture = false;
    },
  ],
  [
    "invalidate regression proof",
    (bundle) => {
      bundle.evidence.regression.brokenConditionFails = false;
    },
  ],
  [
    "insert encoded credential shape",
    (bundle) => {
      bundle.evidence.subject.name = "QXV0aG9yaXphdGlvbjogQmVhcmVyIFRFU1RfT05MWV9OT1RfQV9TRUNSRVQ=";
    },
  ],
  [
    "duplicate manifest path",
    (bundle) => {
      bundle.integrity.artifacts.push(structuredClone(bundle.integrity.artifacts[0]));
    },
  ],
];
for (const [name, mutate] of mutations) {
  const bundle = structuredClone(fieldBundles[0]);
  mutate(bundle);
  const result = await validateBundle(bundle, { schemaDirectory: schemas });
  invariant(!result.valid && result.diagnostics.length > 0, `Mutation survived: ${name}`);
  invariant(!reference.validate(bundle), `Reference validator accepted mutation: ${name}`);
}

const artifacts = join(root, ".artifacts");
await mkdir(artifacts, { recursive: true });
const temporary = await mkdtemp(join(artifacts, "mcp-res-verify-"));
invariant(
  temporary.startsWith(`${artifacts}${sep}`),
  "Temporary exporter directory escaped .artifacts",
);
try {
  const inputs = ["resilireplay-mcp-demo", "mcp-everything-2026.7.4"];
  for (const id of inputs) {
    const input = join(standard, "reference-inputs", `${id}.json`);
    const output = join(temporary, `${id}.mcp-res.json`);
    const exported = spawnSync(
      process.execPath,
      [join(root, "scripts", "export-mcp-res-reference.mjs"), input, output],
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    invariant(
      exported.status === 0,
      `Reference export failed: ${exported.stderr || exported.stdout}`,
    );
    const committed =
      id === "resilireplay-mcp-demo"
        ? `${id}.mcp-res.json`
        : "mcp-everything-2026.7.4.mcp-res.json";
    invariant(
      (await readFile(output)).equals(await readFile(join(standard, "field-evidence", committed))),
      `Reference export is not byte-for-byte deterministic: ${id}`,
    );
  }
} finally {
  invariant(temporary.startsWith(`${artifacts}${sep}`), "Refusing unsafe temporary cleanup");
  await rm(temporary, { recursive: true, force: false });
}

const descriptorPath = join(standard, "conformance-kit", "validator-release.json");
invariant(
  fileSha256(await readFile(descriptorPath)) === fieldBundles[0].evidence.validator.sha256,
  "Validator descriptor identity mismatch",
);
const reordered = Object.fromEntries(Object.entries(handValid.evidence).reverse());
invariant(
  canonicalize(reordered) === canonicalize(handValid.evidence),
  "Canonicalization depends on insertion order",
);

const standardFiles = await filesRecursively(join(root, "docs", "standards", "mcp-res"));
const sensitivePatterns = [
  /sk-[A-Za-z0-9]{20,}/u,
  /gh[ps]_[A-Za-z0-9]{24,}/u,
  /AKIA[0-9A-Z]{16}/u,
  /[A-Z]:\\Users\\[^<\\]+\\/u,
];
for (const path of standardFiles) {
  const bytes = await readFile(path);
  if (extname(path) === ".png") continue;
  const content = bytes.toString("utf8");
  for (const pattern of sensitivePatterns)
    invariant(!pattern.test(content), `Secret/private-path pattern in ${path}`);
  if (extname(path) !== ".md") continue;
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
    const referencePath = match[1].split("#")[0];
    if (!referencePath || /^https:\/\//u.test(referencePath)) continue;
    invariant(!/^[a-z]+:/iu.test(referencePath), `Non-HTTPS link in ${path}: ${match[1]}`);
    const target = resolve(dirname(path), decodeURIComponent(referencePath));
    invariant(
      target.startsWith(`${root}${sep}`),
      `Link escapes repository in ${path}: ${match[1]}`,
    );
    await access(target);
    const targetStat = await stat(target);
    invariant(
      targetStat.isDirectory() || targetStat.size > 0,
      `Empty link target in ${path}: ${match[1]}`,
    );
  }
}

const terminology = await readFile(join(standard, "TERMINOLOGY.md"), "utf8");
for (const keyword of ["MUST", "MUST NOT", "SHOULD", "SHOULD NOT", "MAY", "OPTIONAL"]) {
  invariant(terminology.includes(`**${keyword}**`), `Undefined normative keyword: ${keyword}`);
}

const verification = {
  standardVersion: "0.1.0",
  schemasCompiled: compiled.count,
  profilesValidated: profilePaths.length,
  validVectors: validCount,
  invalidVectors: invalidCount,
  mutationTests: mutations.length,
  validatorAgreements: agreementCount + fieldBundles.length,
  referenceBundles: fieldBundles.map((bundle) => ({
    subject: bundle.evidence.subject.name,
    evidenceSha256: bundle.statement.evidenceSha256,
  })),
  deterministicGeneration: true,
  linksChecked: true,
  secretPatternsRejected: true,
};
const evidenceDirectory = join(artifacts, "mcp-res");
await mkdir(evidenceDirectory, { recursive: true });
await writeFile(
  join(evidenceDirectory, "verification.json"),
  `${JSON.stringify(verification, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(verification));
