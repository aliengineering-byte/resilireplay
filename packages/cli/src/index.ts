import { access, readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { spawn } from "node:child_process";
import { Command } from "commander";
import { parse } from "yaml";
import {
  BUILTIN_SCENARIOS,
  FAULT_TYPES,
  FaultScenarioSchema,
  calculateMetrics,
  injectFaults,
  safeOutputPath,
  type FaultScenario,
} from "@resilireplay/core";
import { auditMcp, MCP_FAULT_TYPES, writeMcpCertification } from "@resilireplay/mcp-chaos";
import { terminalReport, writeReportBundle } from "@resilireplay/reporters";
import {
  compileRegression,
  parseTrace,
  readTrace,
  serializeTrace,
  writeTrace,
} from "@resilireplay/trace";
import { recordCommand } from "./record.js";

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

function boundedPath(candidate: string): string {
  return safeOutputPath(process.cwd(), candidate);
}

async function loadScenario(input: string, seed?: number): Promise<FaultScenario> {
  const builtIn = BUILTIN_SCENARIOS[input];
  const value = builtIn ?? parse(await readFile(boundedPath(input), "utf8"));
  const parsed = FaultScenarioSchema.parse(value);
  return seed === undefined ? parsed : { ...parsed, seed };
}

async function executeGeneratedTest(testPath: string): Promise<void> {
  const child = spawn(process.execPath, ["--test", testPath], {
    cwd: dirname(testPath),
    stdio: "inherit",
    windowsHide: true,
  });
  const code = await new Promise<number>((resolveCode, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode) => resolveCode(exitCode ?? 1));
  });
  if (code !== 0) throw new Error(`Generated regression test exited with ${code}`);
}

async function runScenarioDirectory(directoryInput: string): Promise<{
  total: number;
  passed: number;
  failed: number;
}> {
  const directory = boundedPath(directoryInput);
  const entries = (await readdir(directory))
    .filter((name) => [".yaml", ".yml"].includes(extname(name)))
    .sort();
  let passed = 0;
  for (const entry of entries) {
    const raw = parse(await readFile(join(directory, entry), "utf8")) as Record<string, unknown>;
    const scenario = FaultScenarioSchema.parse({
      schemaVersion: raw.schemaVersion,
      id: raw.id,
      description: raw.description,
      seed: raw.seed,
      rules: raw.rules,
    });
    const fixtureName =
      typeof raw.fixture === "string"
        ? raw.fixture
        : `${basename(entry, extname(entry))}.fixture.jsonl`;
    const fixturePath = safeOutputPath(directory, fixtureName);
    if (!(await exists(fixturePath))) {
      console.log(`VALID ${entry} (no fixture declared)`);
      passed += 1;
      continue;
    }
    const source = await readTrace(fixturePath);
    const result = injectFaults(source, scenario);
    const metrics = calculateMetrics(result.events);
    const expected =
      typeof raw.expected === "object" && raw.expected !== null
        ? (raw.expected as Record<string, unknown>).outcome
        : "passed";
    const matched = expected === "failed" ? !metrics.passed : metrics.passed;
    console.log(`${matched ? "PASS" : "FAIL"} ${entry} (${result.applied.length} fault(s))`);
    if (matched) passed += 1;
  }
  return { total: entries.length, passed, failed: entries.length - passed };
}

export function createProgram(): Command {
  const program = new Command()
    .name("resilireplay")
    .description(
      "Crash-test AI agents and MCP servers, replay failures, and generate regression tests.",
    )
    .version("0.1.0");

  program
    .command("record")
    .description("Record a subprocess as a sanitized JSONL agent trace.")
    .argument("<command...>", "Executable and arguments; place them after --")
    .option("-o, --output <path>", "Trace output", "runs/latest/trace.jsonl")
    .option("--timeout <ms>", "Subprocess timeout", "30000")
    .allowUnknownOption(true)
    .action(async (command: string[], options: { output: string; timeout: string }) => {
      const output = boundedPath(options.output);
      const result = await recordCommand(command, output, Number(options.timeout));
      console.log(`\nRecorded ${result.events.length} events to ${output}`);
      if (result.exitCode !== 0) process.exitCode = result.exitCode;
    });

  program
    .command("inject")
    .description("Deterministically mutate a trace with a built-in or YAML fault scenario.")
    .requiredOption("--trace <path>", "Source JSONL trace")
    .requiredOption("--scenario <name-or-path>", "Built-in scenario or YAML file")
    .option("--seed <number>", "Override scenario seed")
    .option("-o, --output <path>", "Mutated JSONL trace", "runs/latest/injected.jsonl")
    .action(async (options: { trace: string; scenario: string; seed?: string; output: string }) => {
      const source = await readTrace(boundedPath(options.trace));
      const scenario = await loadScenario(
        options.scenario,
        options.seed === undefined ? undefined : Number(options.seed),
      );
      const result = injectFaults(source, scenario);
      await writeTrace(boundedPath(options.output), result.events);
      console.log(
        `Applied ${result.applied.length} deterministic fault(s); trace ${result.traceHash.slice(0, 12)} → ${boundedPath(options.output)}`,
      );
    });

  program
    .command("replay")
    .description("Replay a trace through deterministic recovery and safety scoring.")
    .requiredOption("--trace <path>", "JSONL trace")
    .option("--seed <number>", "Recorded replay seed", "42")
    .option("--report-dir <path>", "Write all report formats")
    .action(async (options: { trace: string; seed: string; reportDir?: string }) => {
      const events = await readTrace(boundedPath(options.trace));
      const metrics = calculateMetrics(events);
      console.log(terminalReport(metrics));
      console.log(`Replay seed     ${Number(options.seed)}`);
      if (options.reportDir) {
        const report = await writeReportBundle(events, boundedPath(options.reportDir));
        console.log(`Reports         ${report.directory}`);
      }
      if (!metrics.passed) process.exitCode = 1;
    });

  program
    .command("generate-test")
    .description("Compile a failed trace into YAML, a minimized fixture, and an executable test.")
    .requiredOption("--trace <path>", "Failed JSONL trace")
    .option("-o, --output <directory>", "Generated artifact directory", "scenarios/generated")
    .option("--verify", "Execute the generated test immediately", true)
    .action(async (options: { trace: string; output: string; verify: boolean }) => {
      const events = await readTrace(boundedPath(options.trace));
      const artifacts = await compileRegression(events, boundedPath(options.output));
      if (options.verify) await executeGeneratedTest(artifacts.testPath);
      console.log(
        `Generated regression: ${artifacts.sourceEventCount} → ${artifacts.minimizedEventCount} events; first critical ${artifacts.firstCriticalStep}`,
      );
      console.log(`Source hash ${artifacts.sourceTraceHash}`);
    });

  program
    .command("test")
    .description("Run all editable YAML scenarios in a directory.")
    .argument("[directory]", "Scenario directory", "scenarios")
    .action(async (directory: string) => {
      const result = await runScenarioDirectory(directory);
      console.log(`${result.passed}/${result.total} scenarios passed`);
      if (result.failed > 0) process.exitCode = 1;
    });

  program
    .command("report")
    .description("Generate terminal, JSON, HTML, JUnit, SARIF, manifest, and badge reports.")
    .argument("<path>", "Trace JSONL file or run directory")
    .option("-o, --output <directory>", "Report directory")
    .action(async (pathInput: string, options: { output?: string }) => {
      const input = boundedPath(pathInput);
      const tracePath =
        (await exists(input)) && extname(input) === ".jsonl" ? input : join(input, "trace.jsonl");
      const output = options.output
        ? boundedPath(options.output)
        : join(dirname(tracePath), "report");
      const bundle = await writeReportBundle(await readTrace(tracePath), output);
      console.log(bundle.terminal);
      console.log(`HTML ${bundle.htmlPath}`);
    });

  const mcp = program
    .command("mcp")
    .description("Controlled reliability testing for authorized MCP servers.");
  mcp
    .command("audit")
    .description("Audit an explicitly supplied stdio or Streamable HTTP MCP server.")
    .option("--command <command>", "Authorized stdio server command")
    .option("--url <url>", "Authorized Streamable HTTP endpoint")
    .option("--allow-remote", "Confirm the HTTP endpoint is user-owned")
    .option("--call-tools", "Explicitly invoke tools with generated safe arguments")
    .option("--fault <name>", `Controlled MCP mutation: ${MCP_FAULT_TYPES.join(", ")}`)
    .option("--seed <number>", "Mutation seed", "42")
    .option("--timeout <ms>", "Connection and call timeout", "5000")
    .option("-o, --output <directory>", "Certification output", "runs/mcp-latest")
    .action(
      async (options: {
        command?: string;
        url?: string;
        allowRemote?: boolean;
        callTools?: boolean;
        fault?: (typeof MCP_FAULT_TYPES)[number];
        seed: string;
        timeout: string;
        output: string;
      }) => {
        if (options.fault && !MCP_FAULT_TYPES.includes(options.fault)) {
          throw new Error(`Unknown MCP fault: ${options.fault}`);
        }
        const result = await auditMcp({
          ...(options.command ? { command: options.command } : {}),
          ...(options.url ? { url: options.url } : {}),
          allowRemote: options.allowRemote ?? false,
          callTools: options.callTools ?? false,
          ...(options.fault ? { fault: options.fault } : {}),
          seed: Number(options.seed),
          timeoutMs: Number(options.timeout),
        });
        const output = boundedPath(options.output);
        await writeMcpCertification(result, output);
        const report = await writeReportBundle(result.events, output);
        console.log(report.terminal);
        for (const finding of result.findings) {
          console.log(`${finding.severity.toUpperCase()} ${finding.id} ${finding.title}`);
        }
        console.log(`MCP certification ${output}`);
        if (!result.passed) process.exitCode = 1;
      },
    );

  program
    .command("faults")
    .description("List all supported deterministic fault types.")
    .action(() => {
      console.log(FAULT_TYPES.join("\n"));
    });

  program
    .command("validate-trace")
    .description("Validate event schemas, sequence ordering, and payload hashes.")
    .argument("<path>")
    .action(async (input: string) => {
      const events = parseTrace(await readFile(boundedPath(input), "utf8"));
      console.log(
        `${events.length} valid events; sha-ready JSONL bytes ${serializeTrace(events).length}`,
      );
    });

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = createProgram();
  await program.parseAsync(argv);
}

export { recordCommand };
