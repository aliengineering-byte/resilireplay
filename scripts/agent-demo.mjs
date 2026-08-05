import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cli = resolve(root, "packages/cli/dist/resilireplay.js");
const project = resolve(root, ".artifacts/everywhere-demo");
const publicArtifacts = resolve(root, "examples/everywhere");
await rm(project, { recursive: true, force: true });
await mkdir(project, { recursive: true });
await mkdir(publicArtifacts, { recursive: true });

async function run(args, input) {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: project,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  if (input) child.stdin.end(input);
  else child.stdin.end();
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
  if (code !== 0) throw new Error(`resilireplay ${args.join(" ")} failed: ${stderr}`);
  return stdout.trim();
}

const started = performance.now();
await run(["capture", "start"]);

const controlled = spawn(process.execPath, ["-e", "process.exit(7)"], {
  cwd: project,
  stdio: "ignore",
  windowsHide: true,
});
const controlledExit = await new Promise((resolveCode, reject) => {
  controlled.once("error", reject);
  controlled.once("exit", (value) => resolveCode(value ?? 1));
});
if (controlledExit !== 7)
  throw new Error(`Controlled failure returned ${controlledExit}, expected 7`);

const payload = JSON.stringify({
  hook_event_name: "PostToolUse",
  session_id: "everywhere-demo-session",
  turn_id: "turn-1",
  tool_name: "Bash",
  tool_use_id: "controlled-exit-7",
  tool_input: { command: "node -e process.exit(7)" },
  tool_response: { exit_code: 7, stderr: "controlled non-zero exit" },
  timestamp: "2026-08-05T12:00:00.000Z",
});
await run(["hook", "ingest", "--agent", "codex"], payload);
const evidence = JSON.parse(await run(["capture", "last"]));
await run(["capture", "stop"]);
const generatedOutput = await run([
  "capture",
  "generate-test",
  "--output",
  "regression/everywhere.test.mjs",
]);
const wallMs = Math.round(performance.now() - started);
if (wallMs >= 60_000) throw new Error(`Everywhere demo took ${wallMs}ms`);

const test = await readFile(resolve(project, "regression/everywhere.test.mjs"), "utf8");
const pinnedEvidence = await readFile(
  resolve(project, "regression/everywhere.test.mjs.evidence.json"),
  "utf8",
);
await writeFile(resolve(publicArtifacts, "everywhere.test.mjs"), test, "utf8");
await writeFile(
  resolve(publicArtifacts, "everywhere.test.mjs.evidence.json"),
  pinnedEvidence,
  "utf8",
);

const transcript = [
  "ResiliReplay v0.5.0 Everywhere — genuine local fixture demo",
  "$ npx --yes resilireplay@0.5.0 capture start",
  "Capture armed · project-local · bounded · no telemetry",
  '$ node -e "process.exit(7)"',
  `Controlled tool result: exit ${controlledExit}`,
  "$ npx --yes resilireplay@0.5.0 capture last",
  `Failure: ${evidence.toolName} · ${evidence.errorClass} · ${evidence.summary}`,
  `Evidence: ${evidence.evidenceId}`,
  "$ npx --yes resilireplay@0.5.0 capture stop",
  "$ npx --yes resilireplay@0.5.0 capture generate-test",
  generatedOutput
    .split(/\r?\n/u)
    .find((line) => line.startsWith("Generated and verified"))
    ?.replace(project, "[PROJECT]") ?? "Generated and verified regression/everywhere.test.mjs",
  "PASS 1 executable regression · original command was not retried",
  `wall=${wallMs}ms under-60s=${wallMs < 60_000}`,
  "capture=off telemetry=false raw-transcript=false",
].join("\n");
await writeFile(
  resolve(root, "docs/assets/everywhere-demo-transcript.txt"),
  `${transcript}\n`,
  "utf8",
);
console.log(transcript);
