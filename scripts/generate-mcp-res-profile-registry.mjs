import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const standard = join(root, "docs", "standards", "mcp-res", "v0.2.0");
const profiles = join(standard, "profiles");
const registryPath = join(standard, "PROFILE_REGISTRY.json");
const schemaPath = join(standard, "schemas", "profile-evaluation.schema.json");
const genericVectors = join(standard, "test-vectors", "catalog.json");
const validatorJs = join(standard, "conformance-kit", "profile-lib.mjs");
const validatorPython = join(standard, "conformance-kit", "python", "mcp_res_validator.py");

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rel = (path) => relative(root, path).replaceAll("\\", "/");
const files = (await readdir(profiles)).filter((name) => name.endsWith(".json")).sort();
const manifests = await Promise.all(
  files.map(async (name) => ({
    name,
    value: JSON.parse(await readFile(join(profiles, name), "utf8")),
    bytes: await readFile(join(profiles, name)),
  })),
);
const ids = manifests.map(({ value }) => value.id);
if (new Set(ids).size !== ids.length) throw new Error("MCP_RES_REGISTRY_DUPLICATE_PROFILE_ID");
const requiredPaths = [schemaPath, genericVectors, validatorJs, validatorPython];
for (const path of requiredPaths) await readFile(path);

const schemas = [{ path: rel(schemaPath), sha256: sha(await readFile(schemaPath)) }];
const vectors = [{ path: rel(genericVectors), sha256: sha(await readFile(genericVectors)) }];
const validatorDigests = {
  javascript: sha(await readFile(validatorJs)),
  python: sha(await readFile(validatorPython)),
};
const registry = {
  schemaVersion: "mcp-res.profile-registry/0.2.0",
  standardVersion: "0.2.0",
  mutationPolicy:
    "Any manifest digest change requires a profile version change or a documented draft erratum before release.",
  compatibilityRule:
    "Overlapping incompatible released versions under one profile ID are forbidden.",
  profiles: manifests.map(({ name, value, bytes }) => ({
    id: value.id,
    version: value.version,
    standardVersion: "0.2.0",
    status: value.status,
    subjectTypes:
      value.id.includes("oauth") ||
      value.id.includes("authorization") ||
      value.id.includes("dpop") ||
      value.id.includes("token-exchange")
        ? ["MCP_CLIENT", "MCP_SERVER", "AUTHORIZATION_FIXTURE"]
        : value.id.includes("stdio") ||
            value.id.includes("streamable-http") ||
            value.id.includes("operational")
          ? ["MCP_CLIENT", "MCP_SERVER", "TRANSPORT_FIXTURE"]
          : ["MCP_CLIENT", "MCP_SERVER", "OFFLINE_MODEL"],
    evidenceClasses: ["SIMULATED", "GENUINE_RUNTIME"],
    normativeRequirements: [
      ...value.requiredChecks,
      ...value.conditionalChecks.map((item) => item.id),
    ],
    manifest: { path: rel(join(profiles, name)), sha256: sha(bytes) },
    schemaDigests: schemas,
    vectorDigests: vectors,
    validatorCompatibility: [
      {
        language: "JavaScript",
        standard: "mcp-res/0.2.0",
        path: rel(validatorJs),
        sha256: validatorDigests.javascript,
      },
      {
        language: "Python",
        standard: "mcp-res/0.2.0",
        path: rel(validatorPython),
        sha256: validatorDigests.python,
      },
    ],
    releaseDate: null,
    deprecationDate: null,
    successor: null,
    owner: "aliengineering-byte/resilireplay maintainers",
    changeHistory: [
      { date: "2026-08-27", status: value.status, change: "Initial v0.2 draft registration" },
    ],
  })),
};

for (const entry of registry.profiles) {
  if (entry.changeHistory.at(-1)?.status !== entry.status)
    throw new Error(`MCP_RES_REGISTRY_STATUS_PROMOTION_UNDOCUMENTED: ${entry.id}`);
  if (!entry.schemaDigests.length || !entry.vectorDigests.length)
    throw new Error(`MCP_RES_REGISTRY_EVIDENCE_MISSING: ${entry.id}`);
}
const serialized = `${JSON.stringify(registry, null, 2)}\n`;
if (process.argv.includes("--write")) await writeFile(registryPath, serialized, "utf8");
else if (
  JSON.stringify(JSON.parse(await readFile(registryPath, "utf8"))) !== JSON.stringify(registry)
)
  throw new Error("MCP_RES_REGISTRY_PROFILE_MUTATION_OR_STALE_OUTPUT");
console.log(
  JSON.stringify({
    profiles: registry.profiles.length,
    uniqueIds: ids.length,
    statusHistoryVerified: true,
    manifestMutationGuard: true,
  }),
);
