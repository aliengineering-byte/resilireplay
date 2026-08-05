import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  captureLast,
  captureStart,
  captureStatus,
  captureStop,
  generateCapturedRegression,
} from "@resilireplay/agent";
import { FAULT_TYPES, PRODUCT_VERSION, stableStringify } from "@resilireplay/core";
import { loadInspectorConfig } from "@resilireplay/mcp-chaos";
import { loadCampaignFile, runCampaign } from "@resilireplay/campaign";

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: stableStringify(value) }] };
}

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

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
      result({
        version: PRODUCT_VERSION,
        capture: (await captureStatus(root)) ?? { status: "off" },
        telemetry: false,
      }),
  );
  server.registerTool(
    "resilireplay_list_faults",
    {
      title: "List faults",
      description: "List deterministic fault types without executing a target.",
      annotations: readOnly,
    },
    async () => result({ faults: FAULT_TYPES }),
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
      return result({
        id: loaded.campaign.id,
        campaignHash: loaded.campaignHash,
        targets: loaded.campaign.targets.length,
        scenarios: loaded.campaign.scenarios.length,
      });
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
    async () => result(await captureStart(root)),
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
    async () => result((await captureStop(root)) ?? { status: "off" }),
  );
  server.registerTool(
    "resilireplay_last_failure",
    {
      title: "Summarize last failure",
      description: "Return the last bounded, sanitized supported failure evidence.",
      annotations: readOnly,
    },
    async () => result((await captureLast(root)) ?? { available: false }),
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
      return result(await generateCapturedRegression(output, root));
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
    async ({ path, confirmedCampaignHash, allowRemote }) => {
      const loaded = await loadCampaignFile(path, root);
      if (loaded.campaignHash !== confirmedCampaignHash)
        throw new Error("Exact reviewed campaign hash confirmation is required");
      const run = await runCampaign(loaded.campaign, {
        rootDirectory: root,
        confirmedToolCampaignHash: confirmedCampaignHash,
        allowRemoteTargets: allowRemote,
      });
      return result({ path: run.path, status: run.run.status, summary: run.run.summary });
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
