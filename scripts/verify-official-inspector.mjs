import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageManagerCli = process.env.npm_execpath;
if (!packageManagerCli) {
  throw new Error("Run the Inspector verification through a package script");
}

const inspectorVersion = "2.1.0";
const result = spawnSync(
  process.execPath,
  [
    packageManagerCli,
    "dlx",
    `@modelcontextprotocol/inspector@${inspectorVersion}`,
    "--cli",
    "--config",
    "tests/fixtures/mcp-inspector/resilireplay-universal.json",
    "--server",
    "resilireplay",
    "--method",
    "tools/list",
    "--format",
    "json",
    "--cwd",
    ".",
  ],
  {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 120_000,
  },
);

if (result.status !== 0) {
  throw new Error(`Official MCP Inspector failed: ${result.stdout ?? ""}${result.stderr ?? ""}`);
}

const output = JSON.parse(result.stdout);
const tools = output?.result?.tools;
if (!Array.isArray(tools) || tools.length !== 9) {
  throw new Error(`Official MCP Inspector returned ${tools?.length ?? 0} tools instead of 9`);
}
for (const tool of tools) {
  const annotations = tool.annotations;
  if (
    !annotations ||
    !["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"].every(
      (name) => typeof annotations[name] === "boolean",
    )
  ) {
    throw new Error(`Tool ${tool.name} did not expose complete MCP behavior annotations`);
  }
}

console.log(
  `Official MCP Inspector ${inspectorVersion} discovered ${tools.length} fully annotated ResiliReplay tools.`,
);
