import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const standard = join(root, "docs", "standards", "mcp-res");
const version = join(standard, "v0.2.0");
const artifact = join(root, ".artifacts", "mcp-res-v02", "governance-verification.json");
const required = [
  ".github/CODEOWNERS",
  ".github/ISSUE_TEMPLATE/mcp_res_rfc.yml",
  ".github/ISSUE_TEMPLATE/mcp_res_profile.yml",
  ".github/ISSUE_TEMPLATE/mcp_res_conformance.yml",
  ".github/ISSUE_TEMPLATE/mcp_res_disposition.yml",
  "docs/standards/mcp-res/REVIEW_CHECKLIST.md",
  "docs/standards/mcp-res/LICENSE.md",
  "docs/standards/mcp-res/PROFILE_LIFECYCLE.md",
  "docs/standards/mcp-res/v0.2.0/PROFILE_REGISTRY.json",
  ".github/workflows/mcp-res-source-drift.yml",
  "docs/standards/mcp-res/v0.2.0/GITHUB_GOVERNANCE.json",
];
for (const path of required) await readFile(join(root, path));
const ledger = await readFile(join(version, "GAP_LEDGER.md"), "utf8");
const allowed = new Set([
  "FIXED",
  "PROFILED_PROVISIONALLY",
  "DEFERRED_NORMATIVE_DEPENDENCY",
  "EXTERNAL_INDEPENDENCE_REQUIRED",
  "OUT_OF_SCOPE_SECURITY",
  "REJECTED_WITH_REASON",
]);
const rows = ledger.split(/\r?\n/u).filter((line) => line.startsWith("| GAP-"));
const statuses = rows.map((line) => line.split("|").at(-2).trim());
if (!statuses.every((status) => allowed.has(status)))
  throw new Error(
    `MCP_RES_GAP_STATUS_NONTERMINAL: ${statuses.filter((status) => !allowed.has(status)).join(",")}`,
  );
const npmWorkflow = await readFile(join(root, ".github", "workflows", "npm-publish.yml"), "utf8");
if (
  !npmWorkflow.includes("startsWith(github.event.release.tag_name, 'v')") ||
  npmWorkflow.includes("mcp-res-v*")
)
  throw new Error("MCP_RES_STANDARD_TAG_NPM_BOUNDARY_MISSING");
const workflows = ["mcp-res.yml", "mcp-res-release.yml", "mcp-res-source-drift.yml"];
for (const name of workflows)
  if (
    (await readFile(join(root, ".github", "workflows", name), "utf8")).includes(
      "pull_request_target",
    )
  )
    throw new Error(`unsafe pull_request_target in ${name}`);
const field = JSON.parse(
  await readFile(join(version, "field-evidence", "FIELD_CORPUS.json"), "utf8"),
);
const githubGovernance = JSON.parse(
  await readFile(join(version, "GITHUB_GOVERNANCE.json"), "utf8"),
);
if (
  !githubGovernance.apiEnforcementAvailable ||
  githubGovernance.mainRuleset.enforcement !== "active" ||
  githubGovernance.tagRuleset.enforcement !== "active" ||
  githubGovernance.releaseEnvironment.allowedRefPattern !== "mcp-res-v*"
)
  throw new Error("MCP_RES_GITHUB_GOVERNANCE_NOT_ENFORCED");
if (field.summary.externalAdopters !== 0 || field.rows.some((row) => row.adopter !== false))
  throw new Error("MCP_RES_EXTERNAL_ADOPTION_OVERCLAIM");
const v01Tree = execFileSync("git", ["rev-parse", "HEAD:docs/standards/mcp-res/v0.1.0"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
}).trim();
if (v01Tree !== "ae968910b6305bbac6a85f6a0bb01cea52efa6cd")
  throw new Error(`MCP_RES_V01_TREE_MUTATED: ${v01Tree}`);
const report = {
  schemaVersion: "mcp-res.governance-verification/0.2.0",
  terminalGapStatuses: statuses.reduce(
    (result, status) => ({ ...result, [status]: (result[status] ?? 0) + 1 }),
    {},
  ),
  requiredGovernanceFiles: required.length,
  standardTagsCanPublishNpm: false,
  unsafePullRequestTargetWorkflows: 0,
  profileRegistryVerified: true,
  externalAdoptersClaimed: 0,
  v01Tree,
  repositorySettingsBoundary:
    "GitHub API settings and residual administrator bypass are recorded in GITHUB_GOVERNANCE.json.",
};
await mkdir(resolve(artifact, ".."), { recursive: true });
await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
