import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "resilireplay-resilient-toy", version: "0.2.0" });

server.registerTool(
  "reliability_probe",
  {
    description: "Returns a bounded, inert echo for local reliability testing.",
    inputSchema: { message: z.string().max(200) },
    annotations: { readOnlyHint: true },
  },
  async ({ message }) => ({
    content: [{ type: "text", text: `Safe bounded echo: ${message.slice(0, 200)}` }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
