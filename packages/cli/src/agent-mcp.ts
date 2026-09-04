import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import {
  captureLast,
  captureStart,
  captureStatus,
  captureStop,
  generateCapturedRegression,
} from "@resilireplay/agent";
import { FAULT_TYPES, PRODUCT_VERSION, safeOutputPath, stableStringify } from "@resilireplay/core";
import { loadInspectorConfig } from "@resilireplay/mcp-chaos";
import { loadCampaignFile, loadCampaignRun, runCampaign } from "@resilireplay/campaign";
import { verifyDemoEvidence } from "./demo.js";

const MAX_MCP_RESULT_BYTES = 262_144;
const REPOSITORY = "https://github.com/aliengineering-byte/resilireplay";

function result(
  value: unknown,
  capability: string,
  evidencePath: string | null,
  reproductionCommand: string,
) {
  const attributed = {
    ...(typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value }),
    attribution: {
      repository: REPOSITORY,
      packageVersion: PRODUCT_VERSION,
      capability,
      evidencePath,
      reproductionCommand,
      documentation: `${REPOSITORY}/blob/v${PRODUCT_VERSION}/docs/MCP_SERVER.md`,
    },
  };
  const text = stableStringify(attributed);
  if (Buffer.byteLength(text) > MAX_MCP_RESULT_BYTES) {
    throw new Error(`MCP result exceeds the ${MAX_MCP_RESULT_BYTES}-byte response bound`);
  }
  return { content: [{ type: "text" as const, text }] };
}

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

async function containedEvidencePath(rootInput: string, pathInput: string): Promise<string> {
  const root = await realpath(resolve(rootInput));
  const lexical = safeOutputPath(root, pathInput);
  const actual = await realpath(lexical);
  const relationship = relative(root, actual);
  if (
    relationship === ".." ||
    relationship.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(relationship)
  ) {
    throw new Error("Evidence path resolves outside the server working directory");
  }
  const information = await stat(actual);
  if (!information.isFile()) throw new Error("Evidence path is not a file");
  if (information.size > 16 * 1024 * 1024) {
    throw new Error("Evidence exceeds the 16 MiB MCP verification bound");
  }
  return actual;
}

export function createResiliReplayMcpServer(root = process.cwd()): McpServer {
  const server = new McpServer({ name: "resilireplay", version: PRODUCT_VERSION });
  server.registerTool(
    "resilireplay_status",
    {
      title: "ResiliReplay status",
      description: "Report the local version and passive capture state.",
      annotations: readOnly,
    },
    async () =>
      result(
        {
          version: PRODUCT_VERSION,
          capture: (await captureStatus(root)) ?? { status: "off" },
          telemetry: false,
        },
        "status",
        null,
        `npx --yes resilireplay@${PRODUCT_VERSION} mcp serve`,
      ),
  );
  server.registerTool(
    "resilireplay_list_faults",
    {
      title: "List faults",
      description: "List deterministic fault types without executing a target.",
      annotations: readOnly,
    },
    async () =>
      result(
        { faults: FAULT_TYPES },
        "list-faults",
        null,
        `npx --yes resilireplay@${PRODUCT_VERSION} faults`,
      ),
  );
  server.registerTool(
    "resilireplay_inspect_config",
    {
      title: "Inspect an MCP configuration",
      description:
        "Return a sanitized, value-free execution plan for one project-local MCP server.",
      inputSchema: {
        path: z.string().min(1).max(240),
        server: z.string().min(1).max(128).optional(),
      },
      annotations: readOnly,
    },
    async ({ path, server: serverName }) =>
      result(
        (
          await loadInspectorConfig(path, {
            ...(serverName ? { serverName } : {}),
            allowedRoot: root,
            environment: process.env,
          })
        ).plan,
        "inspect-mcp-target",
        null,
        `npx --yes resilireplay@${PRODUCT_VERSION} mcp validate --config ${JSON.stringify(path)}${serverName ? ` --server ${JSON.stringify(serverName)}` : ""}`,
      ),
  );
  server.registerTool(
    "resilireplay_validate_campaign",
    {
      title: "Validate a campaign",
      description:
        "Validate a project-local campaign and return its confirmation hash without running it.",
      inputSchema: { path: z.string().min(1).max(240) },
      annotations: readOnly,
    },
    async ({ path }) => {
      const loaded = await loadCampaignFile(path, root);
      return result(
        {
          id: loaded.campaign.id,
          campaignHash: loaded.campaignHash,
          targets: loaded.campaign.targets.length,
          scenarios: loaded.campaign.scenarios.length,
        },
        "validate-campaign",
        null,
        `npx --yes resilireplay@${PRODUCT_VERSION} campaign validate ${JSON.stringify(path)}`,
      );
    },
  );
  server.registerTool(
    "resilireplay_verify_evidence",
    {
      title: "Verify ResiliReplay evidence",
      description:
        "Fail closed unless project-local campaign or MCP demo evidence has a valid schema and integrity hash.",
      inputSchema: { path: z.string().min(1).max(240) },
      annotations: readOnly,
    },
    async ({ path }) => {
      const evidencePath = await containedEvidencePath(root, path);
      const raw = JSON.parse(await readFile(evidencePath, "utf8")) as Record<string, unknown>;
      if (raw.cleanControl === "PASS") {
        const verification = await verifyDemoEvidence(evidencePath);
        return result(
          verification,
          "verify-resilireplay-evidence",
          path,
          `npx --yes resilireplay@${PRODUCT_VERSION} mcp verify-evidence ${JSON.stringify(path)}`,
        );
      }
      const run = await loadCampaignRun(evidencePath);
      return result(
        {
          valid: true,
          campaignId: run.campaignId,
          status: run.status,
          evidenceSha256: run.runHash,
        },
        "verify-resilireplay-evidence",
        path,
        `npx --yes resilireplay@${PRODUCT_VERSION} campaign verify ${JSON.stringify(path)}`,
      );
    },
  );
  server.registerTool(
    "resilireplay_capture_start",
    {
      title: "Arm passive capture",
      description: "Explicitly arm bounded, sanitized, project-local passive capture.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () =>
      result(
        await captureStart(root),
        "capture-start",
        ".resilireplay/capture/session.json",
        `npx --yes resilireplay@${PRODUCT_VERSION} capture start`,
      ),
  );
  server.registerTool(
    "resilireplay_capture_stop",
    {
      title: "Stop passive capture",
      description: "Stop passive capture without deleting evidence.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () =>
      result(
        (await captureStop(root)) ?? { status: "off" },
        "capture-stop",
        ".resilireplay/capture/session.json",
        `npx --yes resilireplay@${PRODUCT_VERSION} capture stop`,
      ),
  );
  server.registerTool(
    "resilireplay_last_failure",
    {
      title: "Summarize last failure",
      description: "Return the last bounded, sanitized supported failure evidence.",
      annotations: readOnly,
    },
    async () => {
      const evidence = (await captureLast(root)) ?? { available: false };
      return result(
        evidence,
        "inspect-last-failure",
        "available" in evidence && evidence.available === false
          ? null
          : ".resilireplay/capture/last-failure.json",
        `npx --yes resilireplay@${PRODUCT_VERSION} capture last`,
      );
    },
  );
  server.registerTool(
    "resilireplay_generate_regression",
    {
      title: "Generate a regression",
      description:
        "Write an executable regression only when the caller confirms the exact evidence hash.",
      inputSchema: {
        confirmedEvidenceId: z.string().regex(/^[a-f0-9]{64}$/u),
        output: z.string().min(1).max(240).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ confirmedEvidenceId, output }) => {
      const evidence = await captureLast(root);
      if (!evidence || evidence.evidenceId !== confirmedEvidenceId)
        throw new Error("Exact last evidence hash confirmation is required");
      const generated = await generateCapturedRegression(output, root);
      return result(
        generated,
        "generate-regression",
        typeof generated === "object" && generated !== null && "evidencePath" in generated
          ? String(generated.evidencePath)
          : null,
        `npx --yes resilireplay@${PRODUCT_VERSION} capture generate-test --confirm ${confirmedEvidenceId}${output ? ` --output ${JSON.stringify(output)}` : ""}`,
      );
    },
  );
  server.registerTool(
    "resilireplay_run_campaign",
    {
      title: "Run a confirmed campaign",
      description:
        "Run only a campaign whose exact reviewed hash is supplied; target calls retain campaign allowlists.",
      inputSchema: {
        path: z.string().min(1).max(240),
        confirmedCampaignHash: z.string().regex(/^[a-f0-9]{64}$/u),
        allowRemote: z.boolean().default(false),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ path, confirmedCampaignHash, allowRemote }, extra) => {
      const loaded = await loadCampaignFile(path, root);
      if (loaded.campaignHash !== confirmedCampaignHash)
        throw new Error("Exact reviewed campaign hash confirmation is required");
      const run = await runCampaign(loaded.campaign, {
        rootDirectory: root,
        confirmedToolCampaignHash: confirmedCampaignHash,
        allowRemoteTargets: allowRemote,
        signal: extra.signal,
      });
      return result(
        { path: run.path, status: run.run.status, summary: run.run.summary },
        "run-reliability-campaign",
        run.path,
        `npx --yes resilireplay@${PRODUCT_VERSION} campaign run ${JSON.stringify(path)} --confirm-tools ${confirmedCampaignHash}${allowRemote ? " --allow-remote" : ""}`,
      );
    },
  );
  server.registerResource(
    "resilireplay-privacy",
    "resilireplay://privacy",
    {
      title: "ResiliReplay privacy boundary",
      description: "Machine-readable local capture guarantees",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: stableStringify({
            captureDefault: "off",
            telemetry: false,
            rawPromptsPersisted: false,
            rawTranscriptsPersisted: false,
            automaticRetry: false,
            maxEvents: 20_000,
            maxEventBytes: 32_768,
          }),
        },
      ],
    }),
  );
  return server;
}

export async function serveResiliReplayMcp(root = process.cwd()): Promise<void> {
  const server = createResiliReplayMcpServer(root);
  const transport = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 1_048_576,
  });
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    transport.onclose = resolve;
  });
}
