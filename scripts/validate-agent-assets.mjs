import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AgentEventSchema } from "../packages/agent/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const plugin = resolve(root, "plugins/resilireplay");

async function json(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

function invariant(value, message) {
  if (!value) throw new Error(message);
}

const codex = await json("plugins/resilireplay/.codex-plugin/plugin.json");
const claude = await json("plugins/resilireplay/.claude-plugin/plugin.json");
const marketplace = await json(".claude-plugin/marketplace.json");
const codexMarketplace = await json(".agents/plugins/marketplace.json");
const mcp = await json("plugins/resilireplay/.mcp.json");
const codexHooks = await json("plugins/resilireplay/hooks/hooks.json");
const claudeHooks = await json("plugins/resilireplay/hooks/claude-hooks.json");

for (const manifest of [codex, claude]) {
  invariant(manifest.name === "resilireplay", "Plugin name must remain stable");
  invariant(manifest.version === "0.6.0", "Plugin version must match the release");
  invariant(manifest.license === "Apache-2.0", "Plugin license must remain Apache-2.0");
}
invariant(marketplace.name === "resilireplay", "Claude marketplace name must match install syntax");
invariant(
  marketplace.plugins?.filter((entry) => entry.name === "resilireplay").length === 1,
  "Claude marketplace must contain exactly one ResiliReplay entry",
);
invariant(
  codexMarketplace.plugins?.filter((entry) => entry.name === "resilireplay").length === 1,
  "Codex marketplace must contain exactly one ResiliReplay entry",
);
invariant(
  mcp.mcpServers?.resilireplay?.args?.includes("resilireplay@0.6.0"),
  "MCP registration must pin the release version",
);
invariant(codexHooks.hooks?.PostToolUse?.length === 1, "Codex PostToolUse hook is missing");
invariant(
  claudeHooks.hooks?.PostToolUseFailure?.length === 1,
  "Claude PostToolUseFailure hook is missing",
);
invariant(claudeHooks.hooks?.Stop?.length === 1, "Claude finalization hook is missing");

const skill = await readFile(resolve(plugin, "skills/resilireplay/SKILL.md"), "utf8");
invariant(skill.startsWith("---\nname: resilireplay\n"), "Portable skill frontmatter is invalid");
invariant(
  skill.includes("capture start") && skill.includes("Never"),
  "Portable skill is missing capture or safety guidance",
);
const publicSchemas = [
  ["schemas/agent-event.v1.schema.json", "resilireplay.agent-event/v1"],
  ["schemas/capture-session.v1.schema.json", "resilireplay.capture-session/v1"],
  ["schemas/failure-evidence.v1.schema.json", "resilireplay.failure-evidence/v1"],
  ["schemas/adapter-manifest.v1.schema.json", "resilireplay.adapter-manifest/v1"],
];
for (const [path, schemaVersion] of publicSchemas) {
  const schema = await json(path);
  invariant(
    schema.$schema === "https://json-schema.org/draft/2020-12/schema",
    `${path} must use JSON Schema 2020-12`,
  );
  invariant(
    schema.$id === `https://github.com/aliengineering-byte/resilireplay/blob/v0.6.0/${path}`,
    `${path} must use its immutable release URL`,
  );
  invariant(
    schema.additionalProperties === false &&
      schema.properties?.schemaVersion?.const === schemaVersion,
    `${path} must be strict and version-bound`,
  );
}
await access(resolve(root, "plugins/resilireplay/runtime/hook-runtime.mjs"));

const datasetLines = (
  await readFile(resolve(root, "ecosystem/huggingface/dataset/data/train.jsonl"), "utf8")
)
  .split(/\r?\n/u)
  .filter(Boolean);
invariant(datasetLines.length === 12, "Synthetic dataset must contain exactly 12 bounded fixtures");
const fixtureIds = new Set();
for (const line of datasetLines) {
  const record = JSON.parse(line);
  invariant(record.synthetic === true, "Dataset records must be explicitly synthetic");
  invariant(typeof record.fixtureId === "string", "Dataset fixture identifier is missing");
  fixtureIds.add(record.fixtureId);
  AgentEventSchema.parse(record.event);
  invariant(
    !/(?:[A-Za-z]:\\Users\\|\/(?:Users|home)\/|Bearer\s+[A-Za-z0-9._~+/=-]{24,})/u.test(line),
    "Synthetic dataset leaked a personal path or credential-shaped value",
  );
}
invariant(fixtureIds.size === datasetLines.length, "Synthetic dataset fixture IDs must be unique");

const space = await readFile(resolve(root, "ecosystem/huggingface/space/index.html"), "utf8");
invariant(
  !/<form\b|\bfetch\s*\(|<(?:script|img)[^>]+(?:src)=['"]https?:\/\//iu.test(space),
  "Static Space must not upload data or load remote executable/media content",
);
invariant(
  space.includes("Content-Security-Policy") && space.includes("runs no command"),
  "Static Space is missing its enforced or disclosed safety boundary",
);

const disposable = await mkdtemp(join(tmpdir(), "resilireplay-plugin-validation-"));
try {
  const child = spawn(process.execPath, [resolve(plugin, "scripts/hook-adapter.mjs"), "codex"], {
    cwd: disposable,
    env: { ...process.env, PLUGIN_ROOT: plugin, PLUGIN_DATA: resolve(disposable, "data") },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdin.end(
    JSON.stringify({
      hook_event_name: "PostToolUse",
      session_id: "fixture",
      tool_name: "Bash",
      tool_use_id: "one",
      tool_response: { exit_code: 7 },
    }),
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolveCode, reject) => {
    child.once("error", reject);
    child.once("exit", (value) => resolveCode(value ?? 1));
  });
  invariant(code === 0, `Passive plugin hook failed: ${stderr}`);
  invariant(stdout === "", "Passive plugin hook wrote noisy stdout");
  invariant(
    await access(resolve(disposable, ".resilireplay")).then(
      () => false,
      () => true,
    ),
    "Unarmed plugin hook created capture state",
  );
} finally {
  await rm(disposable, { recursive: true, force: true });
}

console.log(
  "Agent skill, Claude plugin, Codex plugin, hooks, schemas, and inert runtime validated.",
);
