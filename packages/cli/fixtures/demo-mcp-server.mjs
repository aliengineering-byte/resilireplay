import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function fail(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

for await (const line of lines) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    fail(null, -32700, "Parse error");
    continue;
  }
  if (message.id === undefined) continue;

  if (message.method === "initialize") {
    reply(message.id, {
      protocolVersion: message.params?.protocolVersion ?? "2025-11-25",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "resilireplay-local-demo", version: "1.0.0" },
    });
    continue;
  }
  if (message.method === "tools/list") {
    reply(message.id, {
      tools: [
        {
          name: "local_echo",
          description: "Echo one inert local string for the ResiliReplay reliability demo.",
          inputSchema: {
            type: "object",
            properties: { message: { type: "string" } },
            required: ["message"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, idempotentHint: true },
        },
      ],
    });
    continue;
  }
  if (message.method === "tools/call") {
    if (message.params?.name !== "local_echo") {
      fail(message.id, -32602, "Unknown tool");
      continue;
    }
    const value = message.params?.arguments?.message;
    reply(message.id, {
      content: [{ type: "text", text: typeof value === "string" ? value : "" }],
      isError: false,
    });
    continue;
  }
  if (message.method === "ping") {
    reply(message.id, {});
    continue;
  }
  fail(message.id, -32601, "Method not found");
}
