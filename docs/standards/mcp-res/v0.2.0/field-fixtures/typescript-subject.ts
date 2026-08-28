import { createServer } from "node:http";
import { createInterface } from "node:readline";

const mode = process.argv[2];
const supported = new Set(["2025-11-25", "2026-07-28"]);
const token = "mcp-res-loopback-field-token";

function responseFor(message: { id?: unknown; protocolRevision?: unknown }) {
  if (!supported.has(String(message.protocolRevision))) {
    return {
      id: message.id ?? null,
      error: { code: -32602, reason: "MCP_RES_PROTOCOL_REVISION_UNSUPPORTED" },
    };
  }
  return {
    id: message.id ?? null,
    result: { protocolRevision: message.protocolRevision, accepted: true },
  };
}

if (mode === "stdio") {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stderr.write("MCP_RES_STDIO_MALFORMED_OUTPUT\n");
      return;
    }
    if (message.method === "shutdown") {
      process.stdout.write(`${JSON.stringify({ id: message.id, result: "shutdown" })}\n`);
      lines.close();
      return;
    }
    process.stdout.write(`${JSON.stringify(responseFor(message))}\n`);
  });
} else if (mode === "http") {
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ reason: "MCP_RES_HTTP_AUTH_REQUIRED" }));
      return;
    }
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "http://192.0.2.1/disallowed" });
      response.end();
      return;
    }
    if (request.url === "/interrupt") {
      response.writeHead(200, { "content-type": "text/event-stream", "content-length": "4096" });
      response.write("event: message\ndata: partial");
      response.destroy();
      return;
    }
    if (request.url === "/shutdown") {
      response.writeHead(204);
      response.end(() => server.close());
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (request.headers.accept === "text/event-stream") {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(`event: message\ndata: ${JSON.stringify(responseFor(message))}\n\n`);
      } else {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(responseFor(message)));
      }
    });
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No loopback port");
    process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);
  });
} else {
  process.stderr.write("usage: typescript-subject.ts <stdio|http>\n");
  process.exitCode = 2;
}
