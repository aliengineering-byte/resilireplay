import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { once } from "node:events";
import { type FaultType } from "@resilireplay/core";

export interface FaultProxyOptions {
  target: string;
  fault: FaultType;
  seed?: number;
  hostname?: string;
  port?: number;
  timeoutMs?: number;
}

export interface RunningFaultProxy {
  url: string;
  close(): Promise<void>;
}

function forwardedHeaders(source: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  const blocked = new Set(["host", "connection", "content-length", "transfer-encoding"]);
  for (const [name, value] of Object.entries(source)) {
    if (blocked.has(name.toLowerCase()) || value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

async function bodyOf(request: NodeJS.ReadableStream, limit = 4 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : typeof chunk === "string"
        ? Buffer.from(chunk)
        : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > limit) throw new Error(`Proxy request exceeded ${limit} bytes`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function statusForFault(fault: FaultType): number | undefined {
  if (/^http-\d{3}$/u.test(fault)) return Number(fault.slice(5));
  return undefined;
}

export async function startFaultProxy(options: FaultProxyOptions): Promise<RunningFaultProxy> {
  const target = new URL(options.target);
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("Fault proxy target must use http or https");
  }
  const hostname = options.hostname ?? "127.0.0.1";
  const timeoutMs = options.timeoutMs ?? 10_000;
  const server: Server = createServer(async (request, response) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref();
    try {
      if (options.fault === "connection-reset") {
        request.socket.destroy();
        return;
      }
      if (options.fault === "timeout") {
        setTimeout(() => response.destroy(), timeoutMs).unref();
        return;
      }
      const delay =
        options.fault === "latency" ? Math.max(1, ((options.seed ?? 42) % 200) + 50) : 0;
      if (delay) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));

      const injectedStatus = statusForFault(options.fault);
      if (injectedStatus) {
        response.writeHead(injectedStatus, {
          "content-type": "application/json",
          ...(injectedStatus === 429 ? { "retry-after": "1" } : {}),
        });
        response.end(JSON.stringify({ error: `Injected HTTP ${injectedStatus}` }));
        return;
      }

      const upstreamUrl = new URL(request.url ?? "/", target);
      const body =
        request.method === "GET" || request.method === "HEAD" ? undefined : await bodyOf(request);
      const upstream = await fetch(upstreamUrl, {
        method: request.method ?? "GET",
        headers: forwardedHeaders(request.headers),
        ...(body && body.length > 0 ? { body } : {}),
        signal: controller.signal,
        redirect: "manual",
      });
      let content = Buffer.from(await upstream.arrayBuffer());
      if (options.fault === "truncated-response") {
        content = content.subarray(0, Math.max(1, Math.floor(content.length / 2)));
      } else if (options.fault === "malformed-json") {
        content = Buffer.from('{"injected":true,"unterminated":');
      } else if (options.fault === "duplicated-response") {
        content = Buffer.concat([content, content]);
      } else if (options.fault === "stale-response") {
        content = Buffer.from(JSON.stringify({ stale: true, original: content.toString("utf8") }));
      }
      const headers = Object.fromEntries(upstream.headers.entries());
      delete headers["content-length"];
      delete headers["set-cookie"];
      response.writeHead(upstream.status, headers);
      response.end(content);
    } catch (error) {
      if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: "ResiliReplay proxy failure",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      clearTimeout(timer);
    }
  });
  server.listen(options.port ?? 0, hostname);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fault proxy has no TCP address");
  return {
    url: `http://${hostname}:${address.port}`,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}
