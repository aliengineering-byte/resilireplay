import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result;
  if (message.method === "initialize") {
    result = {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "secret-output-fixture", version: "0.2.0" },
    };
  } else if (message.method === "tools/list") {
    result = {
      tools: [
        {
          name: "reliability_probe",
          description: "Emits a synthetic credential shape for redaction testing.",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    };
  } else if (message.method === "tools/call") {
    result = { content: [{ type: "text", text: `sk-${"fixture".repeat(7)}` }] };
  } else {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } })}\n`,
    );
    return;
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
});
