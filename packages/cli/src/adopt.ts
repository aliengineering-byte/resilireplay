import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { stringify } from "yaml";
import {
  PRODUCT_VERSION,
  containsLikelySecret,
  safeOutputPath,
  sanitize,
  sha256,
  stableStringify,
  type TraceEvent,
} from "@resilireplay/core";
import {
  auditMcp,
  listInspectorServers,
  loadInspectorConfig,
  metadataOnlyMcpEvidence,
  type ImportedInspectorServer,
  type McpAuditOptions,
  type McpAuditResult,
} from "@resilireplay/mcp-chaos";
import { CampaignSchema, campaignHash, type Campaign } from "@resilireplay/campaign";
import { compileRegression, serializeTrace } from "@resilireplay/trace";

export const ADOPT_EXIT_CODES = {
  PASS: 0,
  USAGE: 2,
  DISCOVERY: 40,
  AUTHORIZATION: 41,
  TARGET: 42,
  SANITIZATION: 43,
  ARTIFACT: 44,
} as const;

export type AdoptSafety = "read-only-idempotent" | "reviewed-idempotent";

export interface AdoptOptions {
  config?: string;
  server?: string;
  dryRun?: boolean;
  nonInteractive?: boolean;
  json?: boolean;
  outputDirectory?: string;
  tool?: string;
  argumentsJson?: string;
  safety?: string;
  confirmTarget?: boolean;
  confirmToolExecution?: boolean;
  confirmRetrySafe?: boolean;
  allowRemote?: boolean;
  yes?: boolean;
  seed?: number;
  rootDirectory?: string;
}

export interface AdoptPlan {
  schemaVersion: "1.0";
  mode: "dry-run" | "adopt";
  config: string;
  server: string;
  target: ImportedInspectorServer["plan"];
  operations: string[];
  files: string[];
  sideEffects: {
    processStarts: boolean;
    networkConnections: boolean;
    toolCalls: boolean;
    projectWrites: boolean;
  };
}

export interface AdoptResult {
  schemaVersion: "1.0";
  productVersion: typeof PRODUCT_VERSION;
  status: "dry-run" | "adopted";
  durationMs: number;
  plan: AdoptPlan;
  tool?: string;
  safety?: AdoptSafety;
  campaignHash?: string;
  evidenceHash?: string;
  createdFiles: string[];
  nextCommands: string[];
}

class AdoptError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = "AdoptError";
  }
}

const DISCOVERY_ALLOWLIST = ["mcp.json", ".mcp.json", ".vscode/mcp.json"] as const;
const DEFAULT_OUTPUT = ".resilireplay";

function isContained(root: string, candidate: string): boolean {
  const relationship = relative(resolve(root), resolve(candidate));
  return (
    relationship === "" ||
    (relationship !== ".." && !relationship.startsWith(`..${sep}`) && !isAbsolute(relationship))
  );
}

function repositoryPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

async function discoverConfigurations(root: string): Promise<string[]> {
  const discovered: string[] = [];
  for (const name of DISCOVERY_ALLOWLIST) {
    const candidate = safeOutputPath(root, name);
    try {
      const information = await lstat(candidate);
      if (!information.isFile() && !information.isSymbolicLink()) continue;
      const actual = await realpath(candidate);
      if (!isContained(root, actual)) {
        throw new AdoptError(
          `Discovered configuration ${name} resolves outside the project root`,
          ADOPT_EXIT_CODES.DISCOVERY,
        );
      }
      discovered.push(candidate);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
  }
  return discovered;
}

async function choose(
  question: string,
  choices: readonly string[],
  nonInteractive: boolean,
): Promise<string> {
  if (choices.length === 1) return choices[0]!;
  if (nonInteractive) {
    throw new AdoptError(
      `${question} must be explicit in --non-interactive mode. Choices: ${choices.join(", ")}`,
      ADOPT_EXIT_CODES.USAGE,
    );
  }
  const terminal = createInterface({ input, output });
  try {
    output.write(`${question}\n`);
    choices.forEach((choice, index) => output.write(`  ${index + 1}. ${choice}\n`));
    const answer = await terminal.question("Select number: ");
    const index = Number(answer) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= choices.length) {
      throw new AdoptError("Selection was not one of the listed choices", ADOPT_EXIT_CODES.USAGE);
    }
    return choices[index]!;
  } finally {
    terminal.close();
  }
}

async function ask(question: string): Promise<string> {
  const terminal = createInterface({ input, output });
  try {
    return (await terminal.question(question)).trim();
  } finally {
    terminal.close();
  }
}

async function requireConfirmation(
  label: string,
  confirmed: boolean | undefined,
  nonInteractive: boolean,
  flag: string,
): Promise<void> {
  if (confirmed) return;
  if (nonInteractive) {
    throw new AdoptError(`${label} requires ${flag}`, ADOPT_EXIT_CODES.AUTHORIZATION);
  }
  const answer = await ask(`${label}. Type yes to continue: `);
  if (answer.toLowerCase() !== "yes") {
    throw new AdoptError(`${label} was not confirmed`, ADOPT_EXIT_CODES.AUTHORIZATION);
  }
}

function parseArguments(raw: string | undefined, nonInteractive: boolean): Record<string, unknown> {
  if (raw === undefined && nonInteractive) {
    throw new AdoptError(
      "--arguments <json-object> is required in --non-interactive mode",
      ADOPT_EXIT_CODES.USAGE,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(raw ?? "{}");
  } catch (error) {
    throw new AdoptError(
      `Tool arguments are not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ADOPT_EXIT_CODES.USAGE,
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AdoptError("Tool arguments must be a JSON object", ADOPT_EXIT_CODES.USAGE);
  }
  if (containsLikelySecret(value) || stableStringify(sanitize(value)) !== stableStringify(value)) {
    throw new AdoptError(
      "Tool arguments contain a credential-shaped value or sensitive key and cannot be persisted safely",
      ADOPT_EXIT_CODES.SANITIZATION,
    );
  }
  return value as Record<string, unknown>;
}

async function normalizePersistedValue(value: unknown, root: string): Promise<unknown> {
  if (typeof value === "string") {
    if (/^(?:~[\\/]|%USERPROFILE%|\$HOME)/iu.test(value)) {
      throw new AdoptError(
        "Home-directory references cannot be persisted by adopt",
        ADOPT_EXIT_CODES.SANITIZATION,
      );
    }
    if (value.startsWith("{{PROJECT_ROOT}}/") || value.split(/[\\/]/u).includes("..")) {
      throw new AdoptError(
        "Reserved project-root tokens and parent-traversal arguments cannot be supplied directly",
        ADOPT_EXIT_CODES.SANITIZATION,
      );
    }
    if (!isAbsolute(value)) return value;
    const resolved = resolve(value);
    let ancestor = resolved;
    while (
      !(await access(ancestor).then(
        () => true,
        () => false,
      ))
    ) {
      const parent = dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    const actualAncestor = await realpath(ancestor);
    const canonicalCandidate = resolve(actualAncestor, relative(ancestor, resolved));
    if (!isContained(root, canonicalCandidate)) {
      throw new AdoptError(
        "Tool-argument path resolves through a link outside the current project",
        ADOPT_EXIT_CODES.SANITIZATION,
      );
    }
    return `{{PROJECT_ROOT}}/${repositoryPath(root, canonicalCandidate)}`;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((entry) => normalizePersistedValue(entry, root)));
  }
  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(async ([key, entry]) => [
        key,
        await normalizePersistedValue(entry, root),
      ]),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

function importedAuditOptions(
  imported: ImportedInspectorServer,
  tool?: string,
  toolArguments?: Record<string, unknown>,
  overrides: Partial<McpAuditOptions> = {},
): McpAuditOptions {
  return {
    ...(imported.transport === "stdio"
      ? {
          stdio: {
            command: imported.command,
            args: imported.args,
            env: imported.env,
            ...(imported.cwd ? { cwd: imported.cwd } : {}),
          },
        }
      : {
          http: {
            url: imported.url,
            headers: imported.headers,
            transport: imported.transport,
          },
        }),
    serverName: imported.serverName,
    sourceConfigSha256: imported.configSha256,
    connectionTimeoutMs: imported.connectionTimeoutMs,
    requestTimeoutMs: imported.requestTimeoutMs,
    allowRemote: imported.plan.remoteAuthorizationRequired,
    callTools: tool !== undefined,
    ...(tool ? { allowedTools: [tool] } : {}),
    ...(tool && toolArguments ? { toolArguments: { [tool]: toolArguments } } : {}),
    ...overrides,
  };
}

function outputFiles(outputDirectory: string): string[] {
  return [
    `${outputDirectory}/campaign.yml`,
    `${outputDirectory}/baseline/README.md`,
    `${outputDirectory}/baseline/candidate.json`,
    `${outputDirectory}/evidence/clean-control.jsonl`,
    `${outputDirectory}/evidence/tool-error-recovery.jsonl`,
    `${outputDirectory}/evidence/timeout-negative.jsonl`,
    `${outputDirectory}/evidence/safety-negative.jsonl`,
    `${outputDirectory}/evidence/adoption-summary.json`,
    `${outputDirectory}/README.md`,
    "tests/resilireplay/regression.test.mjs",
    "tests/resilireplay/replay.fixture.jsonl",
    "tests/resilireplay/scenario.yaml",
    "tests/resilireplay/manifest.json",
    ".github/workflows/resilireplay.yml",
  ];
}

function createPlan(
  root: string,
  imported: ImportedInspectorServer,
  configPath: string,
  outputDirectory: string,
  dryRun: boolean,
): AdoptPlan {
  return {
    schemaVersion: "1.0",
    mode: dryRun ? "dry-run" : "adopt",
    config: repositoryPath(root, configPath),
    server: imported.serverName,
    target: imported.plan,
    operations: dryRun
      ? [
          "Read and validate the selected repository-local Inspector configuration",
          "Select the declared MCP server without starting it",
          "Print the sanitized target and planned artifact paths",
        ]
      : [
          "Connect after confirmation and list tools",
          "Call only the explicitly reviewed tool with exact reviewed arguments",
          "Run four bounded deterministic scenarios with one retry maximum",
          "Write sanitized commit-ready CI and regression artifacts transactionally",
        ],
    files: outputFiles(outputDirectory),
    sideEffects: {
      processStarts: !dryRun && imported.transport === "stdio",
      networkConnections: !dryRun && imported.transport !== "stdio",
      toolCalls: !dryRun,
      projectWrites: !dryRun,
    },
  };
}

function formatTarget(plan: ImportedInspectorServer["plan"]): string {
  return stableStringify({
    transport: plan.transport,
    ...(plan.command ? { command: plan.command, arguments: plan.arguments } : {}),
    ...(plan.workingDirectory ? { workingDirectory: plan.workingDirectory } : {}),
    ...(plan.url ? { url: plan.url } : {}),
    environment: plan.environment,
    headers: plan.headers,
    timeouts: {
      connectionMs: plan.connectionTimeoutMs,
      requestMs: plan.requestTimeoutMs,
    },
  });
}

function validateSafety(value: string | undefined, nonInteractive: boolean): AdoptSafety {
  if (value === "read-only-idempotent" || value === "reviewed-idempotent") return value;
  throw new AdoptError(
    nonInteractive
      ? "--safety must be read-only-idempotent or reviewed-idempotent"
      : "Safety classification must be read-only-idempotent or reviewed-idempotent",
    ADOPT_EXIT_CODES.USAGE,
  );
}

async function writeTransaction(
  root: string,
  files: Array<{ path: string; content: string }>,
): Promise<string[]> {
  for (const file of files) {
    const absolute = safeOutputPath(root, file.path);
    const exists = await access(absolute).then(
      () => true,
      () => false,
    );
    if (exists) {
      throw new AdoptError(
        `Refusing to overwrite existing adoption artifact: ${file.path}`,
        ADOPT_EXIT_CODES.ARTIFACT,
      );
    }
  }
  const created: string[] = [];
  try {
    for (const file of files) {
      const absolute = safeOutputPath(root, file.path);
      await mkdir(dirname(absolute), { recursive: true });
      const parent = await realpath(dirname(absolute));
      if (!isContained(root, parent)) {
        throw new AdoptError(
          `Artifact parent resolves outside the project: ${file.path}`,
          ADOPT_EXIT_CODES.ARTIFACT,
        );
      }
      await writeFile(absolute, file.content, { encoding: "utf8", flag: "wx" });
      created.push(file.path);
    }
    return created;
  } catch (error) {
    await Promise.all(
      created.map((path) => unlink(safeOutputPath(root, path)).catch(() => undefined)),
    );
    throw error;
  }
}

async function validateArtifactBoundaries(root: string, files: readonly string[]): Promise<void> {
  for (const file of files) {
    const absolute = safeOutputPath(root, file);
    if (
      await access(absolute).then(
        () => true,
        () => false,
      )
    ) {
      throw new AdoptError(
        `Refusing to overwrite existing adoption artifact: ${file}`,
        ADOPT_EXIT_CODES.ARTIFACT,
      );
    }
    let ancestor = dirname(absolute);
    while (
      !(await access(ancestor).then(
        () => true,
        () => false,
      ))
    ) {
      const parent = dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    const actualAncestor = await realpath(ancestor);
    if (!isContained(root, actualAncestor)) {
      throw new AdoptError(
        `Artifact destination resolves outside the project: ${file}`,
        ADOPT_EXIT_CODES.ARTIFACT,
      );
    }
  }
}

function campaignFor(
  configPath: string,
  server: string,
  tool: string,
  persistedArguments: Record<string, unknown>,
  allowRemote: boolean,
  seed: number,
): Campaign {
  return CampaignSchema.parse({
    schemaVersion: "1.0",
    kind: "resilireplay-campaign",
    id: "adopted-mcp-recovery",
    description: "Reviewed deterministic MCP recovery campaign generated by resilireplay adopt.",
    seed,
    budgets: {
      concurrency: 1,
      retries: 1,
      scenarioTimeoutMs: 10_000,
      totalTimeoutMs: 60_000,
    },
    targets: [
      {
        id: "reviewed-mcp-server",
        kind: "mcp",
        inspectorConfig: configPath,
        server,
        allowTools: [tool],
        toolArguments: { [tool]: persistedArguments },
        evidenceMode: "metadata-only",
        allowRemote,
      },
    ],
    scenarios: [
      {
        id: "clean-control",
        target: "reviewed-mcp-server",
        fault: "none",
        recovery: "none",
        assertions: {
          outcome: "passed",
          noDuplicateSideEffects: true,
          safetyPolicyCompliance: true,
        },
      },
      {
        id: "tool-error-recovers-once",
        target: "reviewed-mcp-server",
        fault: "mcp-tool-error",
        event: "tool_result",
        recovery: "retry",
        assertions: {
          outcome: "passed",
          safeRecovery: true,
          maxRetries: 1,
          noDuplicateSideEffects: true,
          safetyPolicyCompliance: true,
        },
      },
      {
        id: "timeout-negative-control",
        target: "reviewed-mcp-server",
        fault: "mcp-tool-timeout",
        event: "tool_result",
        recovery: "none",
        assertions: {
          outcome: "failed",
          noDuplicateSideEffects: true,
          safetyPolicyCompliance: true,
        },
      },
      {
        id: "safety-negative-control",
        target: "reviewed-mcp-server",
        fault: "mcp-malicious-canary-instruction",
        event: "tool_result",
        recovery: "none",
        assertions: {
          outcome: "failed",
          noDuplicateSideEffects: true,
          safetyPolicyCompliance: false,
        },
      },
    ],
    thresholds: { maxScoreDrop: 0, maxRetryIncrease: 0, maxDuplicateSideEffectIncrease: 0 },
  });
}

function projected(result: McpAuditResult): TraceEvent[] {
  return metadataOnlyMcpEvidence(result.events);
}

export async function runAdopt(options: AdoptOptions = {}): Promise<AdoptResult> {
  const started = performance.now();
  const root = await realpath(options.rootDirectory ?? process.cwd());
  const nonInteractive = options.nonInteractive ?? false;
  const seed = options.seed ?? 42;
  if (!Number.isSafeInteger(seed)) {
    throw new AdoptError("--seed must be an integer", ADOPT_EXIT_CODES.USAGE);
  }
  const discovered = options.config
    ? [safeOutputPath(root, options.config)]
    : await discoverConfigurations(root);
  if (discovered.length === 0) {
    throw new AdoptError(
      `No repository-local MCP configuration found. Checked: ${DISCOVERY_ALLOWLIST.join(", ")}`,
      ADOPT_EXIT_CODES.DISCOVERY,
    );
  }
  const configPath = await choose(
    "Select MCP configuration",
    discovered.map((path) => repositoryPath(root, path)),
    nonInteractive,
  ).then((selected) => safeOutputPath(root, selected));
  const summary = await listInspectorServers(configPath, { allowedRoot: root });
  const server =
    options.server ?? (await choose("Select MCP server", summary.serverNames, nonInteractive));
  if (!summary.serverNames.includes(server)) {
    throw new AdoptError(
      `Server ${JSON.stringify(server)} was not found. Available: ${summary.serverNames.join(", ")}`,
      ADOPT_EXIT_CODES.TARGET,
    );
  }
  const imported = await loadInspectorConfig(configPath, {
    serverName: server,
    allowRemote: options.dryRun ? true : (options.allowRemote ?? false),
    allowedRoot: root,
    environment: process.env,
  });
  const outputDirectory = repositoryPath(
    root,
    safeOutputPath(root, options.outputDirectory ?? DEFAULT_OUTPUT),
  );
  const plan = createPlan(root, imported, configPath, outputDirectory, options.dryRun ?? false);
  if (options.dryRun) {
    return {
      schemaVersion: "1.0",
      productVersion: PRODUCT_VERSION,
      status: "dry-run",
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      plan,
      createdFiles: [],
      nextCommands: [
        `npx --yes resilireplay@0.4.0 adopt --config ./${plan.config} --server ${server}`,
      ],
    };
  }

  await validateArtifactBoundaries(root, plan.files);

  if (!options.json) output.write(`Reviewed target\n${formatTarget(imported.plan)}\n`);
  await requireConfirmation(
    "Confirm this exact process or HTTP target",
    options.confirmTarget || options.yes,
    nonInteractive,
    "--confirm-target",
  );

  const discovery = await auditMcp(importedAuditOptions(imported));
  if (discovery.tools.length === 0) {
    throw new AdoptError("The selected MCP server exposes no tools", ADOPT_EXIT_CODES.TARGET);
  }
  if (!options.json) {
    output.write("Available tools (annotations are untrusted hints):\n");
    for (const tool of discovery.tools) {
      const readOnly = tool.annotations?.readOnlyHint === true ? " readOnlyHint=true" : "";
      output.write(`  ${tool.name}${readOnly}\n`);
    }
  }
  const tool =
    options.tool ??
    (await choose(
      "Select the reviewed tool; no tool is auto-selected",
      discovery.tools.map((entry) => entry.name),
      nonInteractive,
    ));
  if (!discovery.tools.some((entry) => entry.name === tool)) {
    throw new AdoptError(
      `Tool ${JSON.stringify(tool)} was not returned by tools/list`,
      ADOPT_EXIT_CODES.TARGET,
    );
  }
  const rawArguments =
    options.argumentsJson ??
    (nonInteractive ? undefined : await ask(`Exact JSON arguments for ${tool}: `));
  const toolArguments = parseArguments(rawArguments, nonInteractive);
  const persistedArguments = (await normalizePersistedValue(toolArguments, root)) as Record<
    string,
    unknown
  >;
  if (!options.json)
    output.write(
      `Reviewed tool call\n${stableStringify({ tool, arguments: persistedArguments })}\n`,
    );
  await requireConfirmation(
    "Confirm this exact tool and argument boundary",
    options.confirmToolExecution,
    nonInteractive,
    "--confirm-tool-execution",
  );
  const safety = validateSafety(
    options.safety ??
      (nonInteractive
        ? undefined
        : await ask("Safety classification (read-only-idempotent or reviewed-idempotent): ")),
    nonInteractive,
  );
  await requireConfirmation(
    "Confirm the operation is idempotent and safe for one duplicate attempt",
    options.confirmRetrySafe,
    nonInteractive,
    "--confirm-retry-safe",
  );

  const base = importedAuditOptions(imported, tool, toolArguments, { seed, retryBudget: 1 });
  const clean = await auditMcp(base);
  const recovered = await auditMcp({
    ...base,
    fault: "mcp-tool-error",
    recoveryMode: "retry",
  });
  const timeoutNegative = await auditMcp({
    ...base,
    fault: "mcp-tool-timeout",
    recoveryMode: "none",
  });
  const safetyNegative = await auditMcp({
    ...base,
    fault: "mcp-malicious-canary-instruction",
    recoveryMode: "none",
  });
  if (
    !clean.passed ||
    !recovered.passed ||
    !recovered.recovery.succeeded ||
    timeoutNegative.passed ||
    safetyNegative.passed
  ) {
    throw new AdoptError(
      "The bounded adoption campaign did not meet its clean, recovery, and negative-control expectations",
      ADOPT_EXIT_CODES.TARGET,
    );
  }

  const projectedRuns = {
    clean: projected(clean),
    recovered: projected(recovered),
    timeoutNegative: projected(timeoutNegative),
    safetyNegative: projected(safetyNegative),
  };
  const staging = await mkdtemp(join(tmpdir(), "resilireplay-adopt-"));
  try {
    const regression = await compileRegression(
      projectedRuns.safetyNegative,
      join(staging, "regression"),
    );
    const execution = spawnSync(process.execPath, ["--test", regression.testPath], {
      cwd: regression.outputDirectory,
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    });
    if (execution.status !== 0) {
      throw new AdoptError(
        `Generated adoption regression failed: ${execution.stderr}`,
        ADOPT_EXIT_CODES.ARTIFACT,
      );
    }
    const configRelative = repositoryPath(root, configPath);
    const campaign = campaignFor(
      configRelative,
      server,
      tool,
      persistedArguments,
      imported.plan.remoteAuthorizationRequired,
      seed,
    );
    const reviewedCampaignHash = campaignHash(campaign);
    const scenarioHashes = {
      clean: sha256(serializeTrace(projectedRuns.clean)),
      recovered: sha256(serializeTrace(projectedRuns.recovered)),
      timeoutNegative: sha256(serializeTrace(projectedRuns.timeoutNegative)),
      safetyNegative: sha256(serializeTrace(projectedRuns.safetyNegative)),
    };
    const evidence = {
      schemaVersion: "1.0",
      productVersion: PRODUCT_VERSION,
      server,
      transport: imported.transport,
      configSha256: imported.configSha256,
      tool,
      argumentsSha256: sha256(stableStringify(persistedArguments)),
      safety,
      toolAnnotationsTrusted: false,
      rawToolBodiesPersisted: false,
      seed,
      campaignHash: reviewedCampaignHash,
      scenarioHashes,
      regression: {
        sourceTraceSha256: regression.sourceTraceHash,
        fixtureSha256: regression.fixtureHash,
        testSha256: regression.testHash,
        verified: true,
      },
      telemetry: false,
    } as const;
    const evidenceHash = sha256(stableStringify(evidence));
    const regressionFiles = await Promise.all(
      [
        [regression.testPath, "tests/resilireplay/regression.test.mjs"],
        [regression.fixturePath, "tests/resilireplay/replay.fixture.jsonl"],
        [regression.scenarioPath, "tests/resilireplay/scenario.yaml"],
        [regression.manifestPath, "tests/resilireplay/manifest.json"],
      ].map(async ([source, target]) => ({
        path: target!,
        content: await readFile(source!, "utf8"),
      })),
    );
    const remoteArgument = imported.plan.remoteAuthorizationRequired ? " --allow-remote" : "";
    const localCommand = `npx --yes resilireplay@0.4.0 campaign run ${outputDirectory}/campaign.yml --confirm-tools ${reviewedCampaignHash}${remoteArgument}`;
    const files: Array<{ path: string; content: string }> = [
      {
        path: `${outputDirectory}/campaign.yml`,
        content: stringify(JSON.parse(stableStringify(campaign)) as unknown, { lineWidth: 100 }),
      },
      {
        path: `${outputDirectory}/baseline/README.md`,
        content: `# Baseline approval\n\nRun the reviewed campaign, inspect its metadata-only evidence, then approve only a complete expectation-passing result:\n\n\`\`\`bash\n${localCommand} --output ${outputDirectory}/runs/candidate\nnpx --yes resilireplay@0.4.0 campaign approve ${outputDirectory}/runs/candidate --output ${outputDirectory}/baseline/approved.json\n\`\`\`\n\nNever approve a baseline you did not review. Tool annotations remain untrusted hints.\n`,
      },
      {
        path: `${outputDirectory}/baseline/candidate.json`,
        content: `${stableStringify({ schemaVersion: "1.0", approved: false, evidenceHash, scenarioHashes })}\n`,
      },
      {
        path: `${outputDirectory}/evidence/clean-control.jsonl`,
        content: serializeTrace(projectedRuns.clean),
      },
      {
        path: `${outputDirectory}/evidence/tool-error-recovery.jsonl`,
        content: serializeTrace(projectedRuns.recovered),
      },
      {
        path: `${outputDirectory}/evidence/timeout-negative.jsonl`,
        content: serializeTrace(projectedRuns.timeoutNegative),
      },
      {
        path: `${outputDirectory}/evidence/safety-negative.jsonl`,
        content: serializeTrace(projectedRuns.safetyNegative),
      },
      {
        path: `${outputDirectory}/evidence/adoption-summary.json`,
        content: `${stableStringify({ ...evidence, evidenceHash })}\n`,
      },
      {
        path: `${outputDirectory}/README.md`,
        content: `# ResiliReplay adoption\n\nThis setup calls only \`${tool}\` on \`${server}\` with the reviewed arguments in \`campaign.yml\`. Persisted MCP evidence is metadata-only; raw tool bodies, credentials, headers, and environment values are not stored. ResiliReplay is not an OS sandbox.\n\n## Reproduce\n\n\`\`\`bash\n${localCommand}\nnode --test tests/resilireplay/regression.test.mjs\n\`\`\`\n\nPaths beginning with \`{{PROJECT_ROOT}}/\` are expanded inside the checked-out repository at runtime.\n\n## Remove\n\nDelete \`${outputDirectory}\`, \`tests/resilireplay\`, and \`.github/workflows/resilireplay.yml\`.\n`,
      },
      ...regressionFiles,
      {
        path: ".github/workflows/resilireplay.yml",
        content: `name: ResiliReplay\n\non:\n  pull_request:\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\njobs:\n  recovery:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - uses: aliengineering-byte/resilireplay@v0.4.0\n        with:\n          campaign: ${outputDirectory}/campaign.yml\n          campaign-confirmation-hash: ${reviewedCampaignHash}\n${imported.plan.remoteAuthorizationRequired ? "          allow-remote: true\n" : ""}`,
      },
    ];
    const createdFiles = await writeTransaction(root, files);
    return {
      schemaVersion: "1.0",
      productVersion: PRODUCT_VERSION,
      status: "adopted",
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      plan,
      tool,
      safety,
      campaignHash: reviewedCampaignHash,
      evidenceHash,
      createdFiles,
      nextCommands: [
        localCommand,
        "node --test tests/resilireplay/regression.test.mjs",
        "git add .resilireplay tests/resilireplay .github/workflows/resilireplay.yml",
      ],
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export function adoptTerminalReport(result: AdoptResult): string {
  if (result.status === "dry-run") {
    return [
      `DRY RUN ${result.plan.server} (${result.plan.target.transport})`,
      formatTarget(result.plan.target),
      `Would create ${result.plan.files.length} files; no process, network, tool call, or project write occurred.`,
      `Next: ${result.nextCommands[0]}`,
    ].join("\n");
  }
  return [
    `ADOPTED ${result.plan.server} in ${result.durationMs}ms`,
    `Reviewed tool ${result.tool} · campaign ${result.campaignHash}`,
    `Created ${result.createdFiles.length} commit-ready files; raw MCP tool bodies were not persisted.`,
    ...result.nextCommands.map((command, index) => `${index === 0 ? "Run" : "Then"}: ${command}`),
  ].join("\n");
}
