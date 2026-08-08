import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectPayloadKind,
  loadEventsFromJsonlFile,
  parseJsonlBridgeEvents,
  parseOtlpJsonBridgeEvents,
  startOtelBridgeServer,
} from "@resilireplay/otel-bridge";

const context = {
  framework: "test-framework",
  frameworkVersion: "1.0.0",
  adapter: "otel-bridge",
  adapterVersion: "0.6.0",
  runId: "bridge-run",
};

const lineEvent = JSON.stringify({
  runId: "x",
  eventKind: "run.start",
  framework: "test-framework",
  frameworkVersion: "1.0.0",
  adapter: "otel-bridge",
  adapterVersion: "0.6.0",
  turnId: "turn-1",
  actorId: "agent-1",
  traceId: "trace-1",
  spanId: "span-1",
  boundary: "framework",
  sequence: 0,
  phase: "start",
  operation: "run",
  eventClass: "run",
  safetyClass: "safe",
  payload: { status: "ok" },
});

describe("otel bridge JSONL ingestion", () => {
  it("parses valid jsonl events with redacted secrets", () => {
    const result = parseJsonlBridgeEvents(
      {
        raw: JSON.stringify({
          eventKind: "tool.result",
          operation: "tool",
          payload: { apiKey: "abc", nested: { authorization: "Bearer secret" } },
        }),
        context,
      },
      { maxEvents: 5 },
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.eventKind).toBe("tool.result");
    const payload = result.events[0]!.payload as {
      apiKey?: string;
      nested?: { authorization?: string };
    };
    expect(payload.apiKey).toBe("[REDACTED]");
    expect(payload.nested?.authorization).toBe("[REDACTED]");
  });

  it("rejects malformed json and counts malformed lines", () => {
    const malformed = parseJsonlBridgeEvents(
      {
        raw: "not-json\n{}\n",
        context,
      },
      { maxEvents: 10 },
    );
    expect(malformed.malformed).toBe(1);
    expect(malformed.events).toHaveLength(1);
  });

  it("limits accepted events", () => {
    expect(() =>
      parseJsonlBridgeEvents(
        {
          raw: `${lineEvent}\n${lineEvent}`,
          context,
        },
        { maxEvents: 1 },
      ),
    ).toThrow("Input exceeds event limit");
  });

  it("loads JSONL from file with safe paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "rr-otel-bridge-"));
    const file = join(root, "events.jsonl");
    await writeFile(file, `${lineEvent}\n`, "utf8");
    const loaded = await loadEventsFromJsonlFile(file, context, { maxEvents: 10 });
    expect(loaded.events).toHaveLength(1);
    await expect(loadEventsFromJsonlFile("../outside.jsonl", context)).rejects.toThrow(
      /Output path escapes the allowed directory|Path traversal/i,
    );
    await rm(root, { recursive: true, force: true });
  });
});

describe("otel bridge OTLP JSON ingestion", () => {
  it("parses constrained OTLP JSON events", () => {
    const otlp = {
      resourceSpans: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "test" } }] },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "trace-1",
                  spanId: "span-1",
                  name: "model-step",
                  events: [
                    {
                      name: "model.request",
                      timeUnixNano: "123",
                      attributes: [{ key: "eventKind", value: { stringValue: "model.request" } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = parseOtlpJsonBridgeEvents(
      {
        raw: JSON.stringify(otlp),
        context,
      },
      { maxEvents: 5 },
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.eventKind).toBe("model.request");
    expect(result.events[0]?.operation).toBe("model.request");
  });

  it("[FIXTURE_BACKED_PROTOCOL] maps an AutoGen-compatible OTLP agent/tool fixture", () => {
    const autogenContext = {
      ...context,
      framework: "autogen",
      frameworkVersion: "documented-stable",
      adapter: "@resilireplay/otel-bridge/autogen",
    };
    const otlp = {
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "autogen-agentchat" } }],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "autogen-trace",
                  spanId: "invoke-agent",
                  name: "invoke_agent",
                  events: [
                    {
                      name: "agent.start",
                      attributes: [{ key: "eventKind", value: { stringValue: "agent.start" } }],
                    },
                    {
                      name: "tool.start",
                      attributes: [{ key: "eventKind", value: { stringValue: "tool.start" } }],
                    },
                    {
                      name: "tool.result",
                      attributes: [{ key: "eventKind", value: { stringValue: "tool.result" } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = parseOtlpJsonBridgeEvents(
      { raw: JSON.stringify(otlp), context: autogenContext },
      { maxEvents: 10 },
    );
    expect(result.events.map((event) => event.eventKind)).toEqual([
      "agent.start",
      "tool.start",
      "tool.result",
    ]);
    expect(result.events.every((event) => event.framework === "autogen")).toBe(true);
  });
});

describe("otel bridge HTTP ingestion", () => {
  it("enforces origin allowlist and loopback-only defaults", async () => {
    const denied = await startOtelBridgeServer(context, {
      port: 0,
      route: "/v1/bridge/events",
      maxBytes: 2_000,
      maxEvents: 10,
      allowedOrigins: ["http://127.0.0.1:1"],
    });
    const deniedOrigin = new URL(denied.url);
    const invalid = await fetch(denied.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:1111",
      },
      body: "{}",
    });
    expect(invalid.status).toBe(403);
    await denied.close();

    const allowed = `${deniedOrigin.origin}`;
    const validServer = await startOtelBridgeServer(context, {
      port: 0,
      route: "/v1/bridge/events",
      maxBytes: 2_000,
      maxEvents: 10,
      allowedOrigins: [allowed],
    });
    const valid = await fetch(validServer.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: allowed,
      },
      body: `${JSON.stringify({
        eventKind: "run.start",
        payload: { apiKey: "token-shown" },
      })}\n`,
    });
    expect(valid.status).toBe(200);
    await validServer.close();
  });
});

describe("bridge payload detection", () => {
  it("detects payload type from JSONL and OTLP shape", () => {
    expect(detectPayloadKind("x\\ny")).toBe("jsonl");
    expect(
      detectPayloadKind(
        JSON.stringify({
          resourceSpans: [],
        }),
      ),
    ).toBe("otlp-json");
  });
});
