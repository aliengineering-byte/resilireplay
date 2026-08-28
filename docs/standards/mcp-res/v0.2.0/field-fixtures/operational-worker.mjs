import { createServer } from "node:http";

const maximumActive = 4;
const seen = new Map();
let active = 0;
let effects = 0;

function reply(response, status, body, headers = {}) {
  const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": payload.length,
    ...headers,
  });
  response.end(payload);
}

const server = createServer((request, response) => {
  const chunks = [];
  let bytes = 0;
  request.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes <= 65_536) chunks.push(chunk);
  });
  request.on("end", async () => {
    if (request.url === "/shutdown") {
      reply(response, 204);
      server.close(() => process.exit(0));
      return;
    }
    if (bytes > 65_536) {
      reply(response, 413, { reason: "MCP_RES_OVERSIZED_INPUT" });
      return;
    }
    if (active >= maximumActive) {
      reply(response, 429, { reason: "MCP_RES_OVERLOAD_REJECTED" }, { "retry-after": "1" });
      return;
    }
    active += 1;
    try {
      let input;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        reply(response, 400, { reason: "MCP_RES_MALFORMED_MESSAGE" });
        return;
      }
      if (input.mode === "timeout") {
        await new Promise((resolve) => setTimeout(resolve, 80));
        reply(response, 504, { reason: "MCP_RES_TIMEOUT" });
        return;
      }
      if (
        ["partial-outage", "downstream-failure", "disk-full", "permission-failure"].includes(
          input.mode,
        )
      ) {
        reply(response, 503, {
          reason: `MCP_RES_${input.mode.replaceAll("-", "_").toUpperCase()}`,
        });
        return;
      }
      const key = String(input.idempotencyKey ?? "");
      if (seen.has(key)) {
        reply(response, 200, { result: seen.get(key), duplicateSuppressed: true, effects });
        return;
      }
      const result = { accepted: true, revision: input.revision };
      seen.set(key, result);
      effects += 1;
      await new Promise((resolve) => setTimeout(resolve, 6));
      reply(response, 200, { result, duplicateSuppressed: false, effects });
    } finally {
      active -= 1;
    }
  });
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(`${JSON.stringify({ port: address.port, pid: process.pid })}\n`);
});
