import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeHookEvent } from "../packages/agent/dist/index.js";
import { stableStringify } from "../packages/core/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "ecosystem/huggingface/dataset/data/train.jsonl");
const cases = [
  ["shell-exit", "Bash", { exit_code: 7, stderr: "controlled non-zero exit" }],
  ["shell-timeout", "Bash", { success: false, error: "synthetic timeout after 50ms" }],
  [
    "permission",
    "apply_patch",
    { success: false, error: "permission denied for synthetic fixture" },
  ],
  ["not-found", "Bash", { exit_code: 127, stderr: "synthetic command not found" }],
  [
    "mcp-protocol",
    "mcp__fixture__probe",
    { isError: true, message: "synthetic MCP protocol failure" },
  ],
  [
    "mcp-validation",
    "mcp__fixture__probe",
    { isError: true, message: "synthetic schema validation error" },
  ],
  [
    "mcp-success",
    "mcp__fixture__probe",
    { isError: false, content: [{ type: "text", text: "synthetic ok" }] },
  ],
  ["file-success", "apply_patch", { success: true }],
  ["interrupted", "Bash", { interrupted: true }],
  ["unknown-failure", "local_tool", { success: false, error: "synthetic failure" }],
  ["safe-success", "local_tool", { success: true }],
  [
    "bounded-secret",
    "Bash",
    {
      success: false,
      error: `authorization=${["Bearer", "synthetic-token-value-123456789"].join(" ")}`,
    },
  ],
];
const records = cases.map(([id, tool, response], index) => {
  const event = normalizeHookEvent(
    {
      hook_event_name: "PostToolUse",
      session_id: "synthetic-dataset-session",
      tool_name: tool,
      tool_use_id: id,
      tool_input: { fixture: id },
      tool_response: response,
      timestamp: new Date(Date.UTC(2026, 7, 5, 12, 0, index)).toISOString(),
    },
    { source: "codex" },
  );
  if (!event) throw new Error(`Fixture ${id} was unsupported`);
  return { fixtureId: id, synthetic: true, event };
});
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, `${records.map((record) => stableStringify(record)).join("\n")}\n`, "utf8");
console.log(`Generated ${records.length} synthetic records at ${output}`);
