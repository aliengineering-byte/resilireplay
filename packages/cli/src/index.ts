import { access, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { Command } from "commander";
import { parse } from "yaml";
import {
  BUILTIN_SCENARIOS,
  FAULT_TYPES,
  PRODUCT_VERSION,
  FaultScenarioSchema,
  calculateMetrics,
  injectFaults,
  prepareContainedOutputDirectory,
  prepareContainedOutputFile,
  resolveContainedOutputPath,
  safeOutputPath,
  stableStringify,
  type FaultScenario,
} from "@resilireplay/core";
import {
  auditMcp,
  loadInspectorConfig,
  metadataOnlyMcpEvidence,
  MCP_EXIT_CODES,
  MCP_FAULT_TYPES,
  McpInspectorConfigError,
  writeMcpCertification,
  type ImportedInspectorServer,
} from "@resilireplay/mcp-chaos";
import { terminalReport, writeReportBundle } from "@resilireplay/reporters";
import {
  compileRegression,
  parseTrace,
  readTrace,
  serializeTrace,
  writeTrace,
} from "@resilireplay/trace";
import { recordCommand } from "./record.js";
import {
  CAMPAIGN_EXIT_CODES,
  approveCampaignBaseline,
  campaignTerminalReport,
  compareCampaignRun,
  comparisonTerminalReport,
  createCampaignTemplate,
  loadCampaignBaseline,
  loadCampaignFile,
  loadCampaignRun,
  runCampaign,
  writeCampaignBaseline,
  writeCampaignComparisonReports,
  writeCampaignFile,
  writeCampaignRunReports,
} from "@resilireplay/campaign";
import { startStudio } from "@resilireplay/studio";
import {
  adapterTemplates,
  createAdapterRegistry,
  frameworkSupportProfiles,
  renderTemplateArtifact,
  templateById,
} from "@resilireplay/adapter-sdk";
import { demoTerminalReport, runDemo } from "./demo.js";
import {
  MCP_TEST_SAFETY_CLASSES,
  mcpTestPlanReport,
  mcpTestTerminalReport,
  planMcpTest,
  runMcpTest,
} from "./mcp-test.js";
import { adoptTerminalReport, runAdopt, type AdoptOptions } from "./adopt.js";
import {
  captureLast,
  captureStart,
  captureStatus,
  captureStop,
  connectAgent,
  generateCapturedRegression,
  initAdapter,
  planConnection,
  rollbackConnection,
  runPluginHook,
  verifyAdapter,
  type ConnectAgent,
} from "@resilireplay/agent";
import { serveResiliReplayMcp } from "./agent-mcp.js";

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

function boundedPath(candidate: string): string {
  return safeOutputPath(process.cwd(), candidate);
}

async function boundedOutputDirectory(candidate: string): Promise<string> {
  return prepareContainedOutputDirectory(process.cwd(), candidate);
}

async function boundedOutputFile(candidate: string): Promise<string> {
  return prepareContainedOutputFile(process.cwd(), candidate);
}

async function persistedRunPath(input: string): Promise<string> {
  const path = boundedPath(input);
  const information = await stat(path);
  return information.isDirectory() ? join(path, "campaign-run.json") : path;
}

function openBrowser(url: string): void {
  const command =
    process.platform === "win32"
      ? { executable: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] }
      : process.platform === "darwin"
        ? { executable: "open", args: [url] }
        : { executable: "xdg-open", args: [url] };
  const child = spawn(command.executable, command.args, {
    stdio: "ignore",
    windowsHide: true,
    detached: true,
    shell: false,
  });
  child.unref();
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
    .description("Test MCP failure recovery and turn failures into executable regressions.")
    .version(PRODUCT_VERSION);

  const addDemoCommand = (parent: Command, hidden = false): void => {
    parent
      .command("demo", hidden ? { hidden: true } : {})
      .description("Try a deterministic local MCP reliability test.")
      .option("--json", "Print one machine-readable JSON result")
      .option("-o, --output <directory>", "Keep generated evidence and regression artifacts")
      .option("--keep", "Keep artifacts under .resilireplay/demo")
      .option("--no-color", "Disable ANSI color")
      .option("--seed <number>", "Deterministic seed", "42")
      .action(
        async (options: {
          json?: boolean;
          output?: string;
          keep?: boolean;
          color: boolean;
          seed: string;
        }) => {
          if (options.keep && options.output) {
            throw Object.assign(new Error("Use either --keep or --output, not both"), {
              exitCode: 2,
            });
          }
          const result = await runDemo({
            seed: Number(options.seed),
            ...(options.output
              ? { outputDirectory: options.output }
              : options.keep
                ? { outputDirectory: ".resilireplay/demo" }
                : {}),
          });
          console.log(
            options.json
              ? stableStringify(result)
              : demoTerminalReport(result, options.color && process.env.NO_COLOR === undefined),
          );
        },
      );
  };

  const mcp = program
    .command("mcp")
    .description("Test bounded recovery and regression evidence for MCP servers.");
  addDemoCommand(mcp);
  mcp
    .command("test")
    .description("Test one reviewed MCP tool with a bounded fault and recovery.")
    .requiredOption("--config <path>", "Reviewed Inspector-compatible mcp.json file")
    .option("--server <name>", "Named mcpServers entry")
    .option("--tool <name>", "One reviewed tool allowlist entry")
    .option(
      "--safety <classification>",
      `Tool classification: ${MCP_TEST_SAFETY_CLASSES.join(", ")}`,
    )
    .option("--dry-run", "Print a value-free plan without starting or writing anything")
    .option("--approve <sha256>", "Exact plan digest required for execution")
    .option("--fault <name>", `Controlled MCP mutation: ${MCP_FAULT_TYPES.join(", ")}`)
    .option("--retries <number>", "Bounded recovery retry count", "1")
    .option("--timeout <ms>", "Connection and request timeout", "10000")
    .option("-o, --output <directory>", "Evidence directory", ".resilireplay/mcp-test")
    .option("--no-regression", "Do not generate and execute a regression")
    .option("--json", "Print one machine-readable JSON result")
    .action(
      async (options: {
        config: string;
        server?: string;
        tool?: string;
        safety?: (typeof MCP_TEST_SAFETY_CLASSES)[number];
        dryRun?: boolean;
        approve?: string;
        fault?: (typeof MCP_FAULT_TYPES)[number];
        retries: string;
        timeout: string;
        output: string;
        regression: boolean;
        json?: boolean;
      }) => {
        const result = await runMcpTest({
          config: options.config,
          ...(options.server ? { server: options.server } : {}),
          ...(options.tool ? { tool: options.tool } : {}),
          ...(options.safety ? { safety: options.safety } : {}),
          dryRun: options.dryRun ?? false,
          ...(options.approve ? { approve: options.approve } : {}),
          ...(options.fault ? { fault: options.fault } : {}),
          retries: Number(options.retries),
          timeoutMs: Number(options.timeout),
          outputDirectory: options.output,
          regression: options.regression,
          json: options.json ?? false,
        });
        console.log(
          options.json
            ? stableStringify(result)
            : "result" in result
              ? mcpTestTerminalReport(result)
              : mcpTestPlanReport(result, options.config),
        );
        if ("result" in result && result.result !== "PASS") process.exitCode = 1;
      },
    );
  mcp
    .command("validate")
    .description("Validate an MCP test configuration without starting the target.")
    .requiredOption("--config <path>", "Reviewed Inspector-compatible mcp.json file")
    .option("--server <name>", "Named mcpServers entry")
    .option("--tool <name>", "Optional reviewed tool allowlist entry")
    .option("--json", "Print one machine-readable JSON plan")
    .action(async (options: { config: string; server?: string; tool?: string; json?: boolean }) => {
      const plan = await planMcpTest({
        config: options.config,
        ...(options.server ? { server: options.server } : {}),
        ...(options.tool ? { tool: options.tool } : {}),
        dryRun: true,
      });
      console.log(options.json ? stableStringify(plan) : mcpTestPlanReport(plan, options.config));
    });
  addDemoCommand(program, true);

  program
    .command("adopt")
    .description("Turn an existing MCP configuration into reviewed recovery CI.")
    .option("--config <path>", "Repository-local Inspector-compatible MCP configuration")
    .option("--server <name>", "Exact mcpServers entry")
    .option("--dry-run", "Parse and print a side-effect-free sanitized execution plan")
    .option("--non-interactive", "Require every safety-critical choice as a flag")
    .option("--json", "Print one machine-readable JSON result")
    .option("-o, --output <directory>", "Primary artifact directory", ".resilireplay")
    .option("--tool <name>", "Exact reviewed MCP tool")
    .option("--arguments <json-object>", "Exact reviewed tool arguments")
    .option("--safety <classification>", "read-only-idempotent or reviewed-idempotent")
    .option("--confirm-target", "Confirm the exact displayed process or HTTP target")
    .option("--confirm-tool-execution", "Confirm the exact tool and arguments")
    .option("--confirm-retry-safe", "Confirm idempotence and one duplicate attempt")
    .option("--allow-remote", "Confirm ownership of the declared remote HTTP target")
    .option("--yes", "Confirm non-tool setup choices; never bypasses tool review")
    .option("--seed <number>", "Deterministic campaign seed", "42")
    .action(
      async (options: {
        config?: string;
        server?: string;
        dryRun?: boolean;
        nonInteractive?: boolean;
        json?: boolean;
        output: string;
        tool?: string;
        arguments?: string;
        safety?: string;
        confirmTarget?: boolean;
        confirmToolExecution?: boolean;
        confirmRetrySafe?: boolean;
        allowRemote?: boolean;
        yes?: boolean;
        seed: string;
      }) => {
        const adoptOptions: AdoptOptions = {
          ...(options.config ? { config: options.config } : {}),
          ...(options.server ? { server: options.server } : {}),
          dryRun: options.dryRun ?? false,
          nonInteractive: options.nonInteractive ?? false,
          json: options.json ?? false,
          outputDirectory: options.output,
          ...(options.tool ? { tool: options.tool } : {}),
          ...(options.arguments ? { argumentsJson: options.arguments } : {}),
          ...(options.safety ? { safety: options.safety } : {}),
          confirmTarget: options.confirmTarget ?? false,
          confirmToolExecution: options.confirmToolExecution ?? false,
          confirmRetrySafe: options.confirmRetrySafe ?? false,
          allowRemote: options.allowRemote ?? false,
          yes: options.yes ?? false,
          seed: Number(options.seed),
        };
        const result = await runAdopt(adoptOptions);
        console.log(options.json ? stableStringify(result) : adoptTerminalReport(result));
      },
    );

  program
    .command("connect")
    .description("Safely connect passive ResiliReplay capture to a supported coding agent.")
    .option("--agent <agent>", "auto, claude-code, codex, or hermes", "auto")
    .option("--dry-run", "Show the exact repository-local changes without writing files")
    .option("--yes", "Apply the displayed changes without an interactive prompt")
    .option("--rollback [backup-id]", "Restore a previous recoverable connection backup")
    .option("--json", "Print one machine-readable result")
    .action(
      async (options: {
        agent: string;
        dryRun?: boolean;
        yes?: boolean;
        rollback?: string | boolean;
        json?: boolean;
      }) => {
        if (options.rollback !== undefined) {
          const result = await rollbackConnection(
            process.cwd(),
            typeof options.rollback === "string" ? options.rollback : undefined,
          );
          console.log(
            options.json
              ? stableStringify(result)
              : `Restored ${result.restored.length} file(s) from ${result.backupId}`,
          );
          return;
        }
        if (!["auto", "claude-code", "codex", "hermes"].includes(options.agent)) {
          throw Object.assign(new Error("--agent must be auto, claude-code, codex, or hermes"), {
            exitCode: 2,
          });
        }
        const agent = options.agent as ConnectAgent;
        const skillSource = fileURLToPath(new URL("../portable-skill", import.meta.url));
        const preview = await planConnection(
          { agent, dryRun: options.dryRun ?? false, skillSource },
          process.cwd(),
        );
        if (options.dryRun) {
          console.log(stableStringify(preview.plan));
          return;
        }
        if (preview.files.length === 0) {
          console.log(stableStringify(preview.plan));
          return;
        }
        console.log(stableStringify(preview.plan));
        let confirmed = options.yes ?? false;
        if (!confirmed && process.stdin.isTTY && process.stdout.isTTY) {
          const prompt = createInterface({ input: process.stdin, output: process.stdout });
          try {
            confirmed = /^y(?:es)?$/iu.test(
              (await prompt.question("Apply these repository-local changes? [y/N] ")).trim(),
            );
          } finally {
            prompt.close();
          }
        }
        if (!confirmed)
          throw Object.assign(new Error("Connection changes were not confirmed"), { exitCode: 2 });
        const result = await connectAgent({ agent, yes: true, skillSource }, process.cwd());
        console.log(
          options.json
            ? stableStringify(result)
            : `Connected ${agent}; backup ${result.backupId}. Capture remains off.`,
        );
      },
    );

  const adapter = program
    .command("adapter")
    .description("Create and verify integrations against the ResiliReplay adapter contract.");
  adapter
    .command("init")
    .argument("<name>", "Lowercase adapter name")
    .description("Create a minimal Apache-2.0 adapter and canonical failure fixture.")
    .action(async (name: string) => console.log(`Created ${await initAdapter(name)}`));
  adapter
    .command("verify")
    .argument("<adapter-path>", "Adapter directory")
    .description(
      "Run manifest, classification, determinism, bounds, and privacy conformance checks.",
    )
    .action(async (path: string) => console.log(stableStringify(await verifyAdapter(path))));
  adapter
    .command("list")
    .description("List framework profiles and their honest evidence classifications.")
    .action(() => console.log(stableStringify(frameworkSupportProfiles())));
  adapter
    .command("detect")
    .description("Detect a framework profile, with an optional explicit override.")
    .argument("[hint]", "Framework hint, package, or command text")
    .option("--package <name>", "Exact installed package name")
    .option("--command <command>", "Framework launch command")
    .option("--framework <id>", "Explicit framework profile override")
    .action(
      (
        hint: string | undefined,
        options: { package?: string; command?: string; framework?: string },
      ) => {
        const resolution = createAdapterRegistry().resolve(
          {
            rootDirectory: process.cwd(),
            ...(hint === undefined ? {} : { frameworkHint: hint }),
            ...(options.package === undefined ? {} : { packageName: options.package }),
            ...(options.command === undefined ? {} : { command: options.command }),
          },
          options.framework,
        );
        if (resolution === undefined) {
          throw Object.assign(new Error("No supported framework profile detected"), {
            exitCode: 2,
          });
        }
        console.log(stableStringify(resolution));
      },
    );
  adapter
    .command("doctor")
    .description("Report the registered evidence boundary for a framework profile.")
    .argument("<framework>", "Framework profile identifier")
    .action(async (framework: string) => {
      console.log(
        stableStringify(
          await createAdapterRegistry().doctor(framework, { rootDirectory: process.cwd() }),
        ),
      );
    });

  const template = program
    .command("template")
    .description("Manage deterministic reliability scenario templates.");

  template
    .command("list")
    .description("List available starter templates.")
    .action(() => {
      console.log(
        stableStringify(
          adapterTemplates().map((entry) => ({
            id: entry.id,
            compatibility: entry.compatibility,
            framework: entry.framework,
            safetyClass: entry.safetyClass,
            mode: entry.mode,
            expectedEvidence: entry.expectedEvidence,
          })),
        ),
      );
    });

  template
    .command("show")
    .description("Show an exact template descriptor.")
    .argument("<id>", "Template identifier")
    .action((id: string) => {
      const selected = templateById(id);
      if (!selected) throw new Error(`Unknown template ${id}`);
      console.log(stableStringify(selected));
    });

  template
    .command("copy")
    .description("Copy one template fixture to a local path.")
    .argument("<id>", "Template identifier")
    .option("-o, --output <path>", "Template output path")
    .action(async (id: string, options: { output?: string }) => {
      const selected = templateById(id);
      if (!selected) throw new Error(`Unknown template ${id}`);
      const output = await boundedOutputFile(options.output ?? `${id}.template.json`);
      const rendered = renderTemplateArtifact(selected, `${id}.template.json`);
      await writeFile(output, `${rendered}\n`, "utf8");
      console.log(`Wrote template ${output}`);
    });

  const capture = program
    .command("capture")
    .description("Control opt-in, bounded, sanitized passive agent failure capture.");
  capture
    .command("start")
    .description("Arm capture for this repository.")
    .action(async () => console.log(stableStringify(await captureStart())));
  capture
    .command("status")
    .description("Show capture state.")
    .action(async () => console.log(stableStringify((await captureStatus()) ?? { status: "off" })));
  capture
    .command("stop")
    .description("Stop capture without deleting evidence.")
    .action(async () => console.log(stableStringify((await captureStop()) ?? { status: "off" })));
  capture
    .command("last")
    .description("Show the last supported sanitized failure.")
    .action(async () =>
      console.log(stableStringify((await captureLast()) ?? { available: false })),
    );
  capture
    .command("generate-test")
    .description("Turn the last supported failure into an executable deterministic regression.")
    .option(
      "-o, --output <path>",
      "Generated Node test path",
      "scenarios/generated/agent-failure.test.mjs",
    )
    .action(async (options: { output: string }) => {
      const generated = await generateCapturedRegression(options.output);
      await executeGeneratedTest(generated.testPath);
      console.log(`Generated and verified ${generated.testPath}`);
      console.log(`Evidence ${generated.evidence.evidenceId}`);
    });

  program
    .command("hook", { hidden: true })
    .description("Internal passive hook adapter.")
    .command("ingest", { hidden: true })
    .requiredOption("--agent <agent>")
    .action(async (options: { agent: string }) => {
      if (!["claude-code", "codex", "hermes", "generic"].includes(options.agent)) return;
      await runPluginHook(options.agent);
    });

  program
    .command("studio")
    .description("Start the local, loopback-only ResiliReplay Studio.")
    .option("--port <number>", "Loopback port; 0 selects an available port", "4199")
    .option("--open", "Open the local Studio URL in the default browser")
    .action(async (options: { port: string; open?: boolean }) => {
      const port = Number(options.port);
      if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
        throw Object.assign(new Error("--port must be an integer from 0 to 65535"), {
          exitCode: 2,
        });
      }
      const studio = await startStudio({ rootDirectory: process.cwd(), port });
      console.log(`ResiliReplay Studio v${PRODUCT_VERSION} ready in ${studio.startupMs}ms`);
      console.log(studio.url);
      console.log("Loopback only · ephemeral session · no telemetry · Ctrl+C to stop");
      if (options.open) openBrowser(studio.url);
      await new Promise<void>((resolveStop) => {
        const stop = (): void => resolveStop();
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
      await studio.close();
      console.log("Studio stopped; active campaigns, processes, and listeners were cleaned up.");
    });

  const campaign = program
    .command("campaign")
    .description("Create, run, approve, and compare deterministic fault campaigns.");

  campaign
    .command("init")
    .description("Create a versioned campaign template without overwriting existing files.")
    .argument("[path]", "Campaign YAML or JSON path", "campaign.yml")
    .action(async (path: string) => {
      const written = await writeCampaignFile(createCampaignTemplate(), path, process.cwd());
      console.log(`Created ${written.path}`);
      console.log(`Campaign hash ${written.campaignHash}`);
    });

  campaign
    .command("validate")
    .description("Validate a campaign and print its confirmation hash.")
    .argument("<path>", "Campaign YAML or JSON")
    .action(async (path: string) => {
      const loaded = await loadCampaignFile(path, process.cwd());
      console.log(`VALID ${loaded.campaign.id}`);
      console.log(`Campaign hash ${loaded.campaignHash}`);
      console.log(
        stableStringify({
          targets: loaded.campaign.targets.map((target) =>
            target.kind === "trace"
              ? { id: target.id, kind: target.kind, trace: target.trace }
              : {
                  id: target.id,
                  kind: target.kind,
                  inspectorConfig: target.inspectorConfig,
                  server: target.server,
                  allowTools: target.allowTools,
                  toolArguments: target.toolArguments,
                  evidenceMode: target.evidenceMode,
                  allowRemote: target.allowRemote,
                },
          ),
          scenarios: loaded.campaign.scenarios.map((scenario) => ({
            id: scenario.id,
            target: scenario.target,
            fault: scenario.fault,
            seed: scenario.seed ?? loaded.campaign.seed,
            recovery: scenario.recovery,
          })),
          budgets: loaded.campaign.budgets,
        }),
      );
    });

  campaign
    .command("run")
    .description("Run a reviewed campaign with bounded concurrency and sanitized artifacts.")
    .argument("<path>", "Campaign YAML or JSON")
    .option("-o, --output <directory>", "Campaign run directory")
    .option(
      "--confirm-tools <campaign-sha256>",
      "Confirm the exact reviewed hash when a campaign calls allowlisted tools",
    )
    .option("--allow-remote", "Confirm ownership of declared remote MCP targets")
    .action(
      async (
        path: string,
        options: { output?: string; confirmTools?: string; allowRemote?: boolean },
      ) => {
        const loaded = await loadCampaignFile(path, process.cwd());
        console.log(`Reviewed campaign ${loaded.campaign.id}`);
        console.log(`Campaign hash ${loaded.campaignHash}`);
        console.log(
          stableStringify(
            loaded.campaign.targets.map((target) =>
              target.kind === "trace"
                ? { id: target.id, kind: target.kind, trace: target.trace }
                : {
                    id: target.id,
                    kind: target.kind,
                    inspectorConfig: target.inspectorConfig,
                    server: target.server,
                    allowTools: target.allowTools,
                    allowRemote: target.allowRemote,
                  },
            ),
          ),
        );
        const controller = new AbortController();
        const cancel = (): void => controller.abort(new Error("Campaign cancelled by signal"));
        process.once("SIGINT", cancel);
        process.once("SIGTERM", cancel);
        try {
          const result = await runCampaign(loaded.campaign, {
            rootDirectory: process.cwd(),
            ...(options.output ? { outputDirectory: options.output } : {}),
            ...(options.confirmTools ? { confirmedToolCampaignHash: options.confirmTools } : {}),
            allowRemoteTargets: options.allowRemote ?? false,
            signal: controller.signal,
            onProgress: (progress) => {
              if (progress.phase === "scenario-completed") {
                console.log(
                  `${progress.scenarioStatus?.toUpperCase()} ${progress.scenarioId} (${progress.completed}/${progress.total})`,
                );
              }
            },
          });
          await writeCampaignRunReports(
            result.run,
            safeOutputPath(result.outputDirectory, "reports"),
          );
          console.log(campaignTerminalReport(result.run));
          console.log(`Campaign evidence ${result.path}`);
          if (result.run.status === "cancelled" || result.run.status === "incomplete") {
            process.exitCode = CAMPAIGN_EXIT_CODES.INCOMPLETE;
          } else if (result.run.status === "invalid") {
            process.exitCode = CAMPAIGN_EXIT_CODES.TARGET;
          } else if (!result.run.summary.passed) {
            process.exitCode = CAMPAIGN_EXIT_CODES.REGRESSION;
          }
        } finally {
          process.removeListener("SIGINT", cancel);
          process.removeListener("SIGTERM", cancel);
        }
      },
    );

  campaign
    .command("approve")
    .description("Approve a complete expectation-passing run as a versioned baseline.")
    .argument("<run>", "campaign-run.json or its containing directory")
    .requiredOption("-o, --output <path>", "Baseline JSON path")
    .action(async (runInput: string, options: { output: string }) => {
      const run = await loadCampaignRun(await persistedRunPath(runInput));
      const baseline = approveCampaignBaseline(run);
      const output = await boundedOutputFile(options.output);
      await writeCampaignBaseline(baseline, output);
      console.log(`Approved baseline ${output}`);
      console.log(`Baseline hash ${baseline.baselineHash}`);
    });

  campaign
    .command("compare")
    .description("Compare a complete run with a verified reliability baseline.")
    .argument("<run>", "campaign-run.json or its containing directory")
    .requiredOption("--baseline <path>", "Approved baseline JSON")
    .option("-o, --output <directory>", "Comparison report directory")
    .action(async (runInput: string, options: { baseline: string; output?: string }) => {
      const runPath = await persistedRunPath(runInput);
      const run = await loadCampaignRun(runPath);
      const baseline = await loadCampaignBaseline(boundedPath(options.baseline));
      const comparison = compareCampaignRun(run, baseline);
      const output = await boundedOutputDirectory(
        options.output ?? safeOutputPath(dirname(runPath), "comparison"),
      );
      await writeCampaignComparisonReports(comparison, output);
      console.log(comparisonTerminalReport(comparison));
      console.log(`Comparison reports ${output}`);
      if (comparison.status === "regression") {
        process.exitCode = CAMPAIGN_EXIT_CODES.REGRESSION;
      } else if (comparison.status === "invalid") {
        process.exitCode = CAMPAIGN_EXIT_CODES.INVALID_SCHEMA;
      } else if (comparison.status === "incomplete") {
        process.exitCode = CAMPAIGN_EXIT_CODES.INCOMPLETE;
      }
    });

  program
    .command("record")
    .description("Record a subprocess as a sanitized JSONL agent trace.")
    .argument("<command...>", "Executable and arguments; place them after --")
    .option("-o, --output <path>", "Trace output", "runs/latest/trace.jsonl")
    .option("--timeout <ms>", "Subprocess timeout", "30000")
    .allowUnknownOption(true)
    .action(async (command: string[], options: { output: string; timeout: string }) => {
      const output = await boundedOutputFile(options.output);
      const result = await recordCommand(command, output, Number(options.timeout), process.cwd());
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
      const output = await boundedOutputFile(options.output);
      await writeTrace(output, result.events, { allowedRoot: process.cwd() });
      console.log(
        `Applied ${result.applied.length} deterministic fault(s); trace ${result.traceHash.slice(0, 12)} → ${output}`,
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
        const report = await writeReportBundle(
          events,
          await boundedOutputDirectory(options.reportDir),
        );
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
      const output = await resolveContainedOutputPath(process.cwd(), options.output);
      const artifacts = await compileRegression(events, output, { allowedRoot: process.cwd() });
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
      const output = await boundedOutputDirectory(
        options.output ?? join(dirname(tracePath), "report"),
      );
      const bundle = await writeReportBundle(await readTrace(tracePath), output);
      console.log(bundle.terminal);
      console.log(`HTML ${bundle.htmlPath}`);
    });

  mcp
    .command("serve")
    .description("Serve ResiliReplay itself as a local stdio MCP server.")
    .action(async () => serveResiliReplayMcp());
  mcp
    .command("audit")
    .description("Audit a reviewed MCP Inspector config, stdio command, or HTTP endpoint.")
    .option("--inspector-config <path>", "Reviewed MCP Inspector mcp.json file")
    .option("--server <name>", "Named mcpServers entry (required when the file has multiple)")
    .option("--dry-run", "Print a value-free execution plan without contacting the server")
    .option("--command <command>", "Authorized stdio server command")
    .option("--url <url>", "Authorized Streamable HTTP endpoint")
    .option("--allow-remote", "Confirm the HTTP endpoint is user-owned")
    .option("--call-tools", "Explicitly invoke tools with generated safe arguments")
    .option("--fault <name>", `Controlled MCP mutation: ${MCP_FAULT_TYPES.join(", ")}`)
    .option("--recovery <mode>", "Fault recovery evaluation: none or retry", "none")
    .option("--seed <number>", "Mutation seed", "42")
    .option("--timeout <ms>", "Override connection and request timeouts")
    .option("-o, --output <directory>", "Certification output", "runs/mcp-latest")
    .action(
      async (options: {
        inspectorConfig?: string;
        server?: string;
        dryRun?: boolean;
        command?: string;
        url?: string;
        allowRemote?: boolean;
        callTools?: boolean;
        fault?: (typeof MCP_FAULT_TYPES)[number];
        recovery: string;
        seed: string;
        timeout?: string;
        output: string;
      }) => {
        if (options.fault && !MCP_FAULT_TYPES.includes(options.fault)) {
          throw new Error(`Unknown MCP fault: ${options.fault}`);
        }
        if (options.recovery !== "none" && options.recovery !== "retry") {
          throw new McpInspectorConfigError(
            "--recovery must be either none or retry",
            "RR_MCP_RECOVERY_MODE",
          );
        }
        const targetCount = [options.inspectorConfig, options.command, options.url].filter(
          Boolean,
        ).length;
        if (targetCount !== 1) {
          throw new McpInspectorConfigError(
            "Supply exactly one MCP target: --inspector-config, --command, or --url",
            "RR_MCP_TARGET_SELECTION",
          );
        }
        if (options.server && !options.inspectorConfig) {
          throw new McpInspectorConfigError(
            "--server is valid only with --inspector-config",
            "RR_MCP_SERVER_WITHOUT_CONFIG",
          );
        }
        if (options.dryRun && !options.inspectorConfig) {
          throw new McpInspectorConfigError(
            "--dry-run requires --inspector-config",
            "RR_MCP_DRY_RUN_TARGET",
          );
        }
        const timeout = options.timeout === undefined ? undefined : Number(options.timeout);
        if (timeout !== undefined && (!Number.isSafeInteger(timeout) || timeout <= 0)) {
          throw new McpInspectorConfigError(
            "--timeout must be a positive integer number of milliseconds",
            "RR_MCP_TIMEOUT",
          );
        }
        const plannedOutput = options.dryRun
          ? undefined
          : await resolveContainedOutputPath(process.cwd(), options.output);

        let imported: ImportedInspectorServer | undefined;
        if (options.inspectorConfig) {
          imported = await loadInspectorConfig(options.inspectorConfig, {
            ...(options.server ? { serverName: options.server } : {}),
            allowRemote: options.allowRemote ?? false,
            allowedRoot: process.cwd(),
            environment: process.env,
          });
          if (options.dryRun) {
            console.log(stableStringify(imported.plan));
            return;
          }
        }

        const result = await auditMcp({
          ...(imported?.transport === "stdio"
            ? {
                stdio: {
                  command: imported.command,
                  args: imported.args,
                  env: imported.env,
                  ...(imported.cwd ? { cwd: imported.cwd } : {}),
                },
              }
            : {}),
          ...(imported && imported.transport !== "stdio"
            ? {
                http: {
                  url: imported.url,
                  headers: imported.headers,
                  transport: imported.transport,
                },
              }
            : {}),
          ...(!imported && options.command ? { command: options.command } : {}),
          ...(!imported && options.url ? { url: options.url } : {}),
          allowRemote: options.allowRemote ?? false,
          callTools: options.callTools ?? false,
          ...(options.fault ? { fault: options.fault } : {}),
          seed: Number(options.seed),
          recoveryMode: options.recovery,
          ...(timeout !== undefined ? { timeoutMs: timeout } : {}),
          ...(imported
            ? {
                serverName: imported.serverName,
                sourceConfigSha256: imported.configSha256,
                connectionTimeoutMs: imported.connectionTimeoutMs,
                requestTimeoutMs: imported.requestTimeoutMs,
              }
            : {}),
        });
        const output = await boundedOutputDirectory(plannedOutput!);
        const persistedEvents = metadataOnlyMcpEvidence(result.events);
        const persistedResult = { ...result, events: persistedEvents };
        await writeTrace(join(output, "trace.jsonl"), persistedEvents, {
          allowedRoot: process.cwd(),
        });
        await writeMcpCertification(persistedResult, output);
        const report = await writeReportBundle(persistedEvents, output);
        console.log(report.terminal);
        for (const finding of result.findings) {
          console.log(`${finding.severity.toUpperCase()} ${finding.id} ${finding.title}`);
        }
        console.log(`MCP certification ${output}`);
        if (!result.passed) {
          process.exitCode = result.secretOutputDetected
            ? MCP_EXIT_CODES.SECRET_OUTPUT
            : MCP_EXIT_CODES.FINDINGS;
        }
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
