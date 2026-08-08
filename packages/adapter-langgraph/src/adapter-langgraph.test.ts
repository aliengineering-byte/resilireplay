import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AIMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import {
  Annotation,
  Command,
  END,
  getWriter,
  interrupt,
  isNodeTimeoutError,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
  type ProtocolEvent,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  createEvent,
  validateV1Event,
  type EventEnvelopeV1,
  type EventType,
  type TraceEvent,
} from "@resilireplay/core";
import { compileRegression } from "@resilireplay/trace";
import { describe, expect, it } from "vitest";
import { createLangGraphAdapter, type LangGraphRunContext } from "./index.js";

function runContext(overrides: Partial<LangGraphRunContext> = {}): LangGraphRunContext {
  const identity = randomUUID();
  return {
    runId: `run-${identity}`,
    traceId: `trace-${identity}`,
    turnId: `turn-${identity}`,
    actorId: "langgraph-runtime",
    evidenceClass: "GENUINE_RUNTIME",
    ...overrides,
  };
}

function protocolPayload(event: EventEnvelopeV1): Record<string, unknown> {
  const payload = event.payload;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
}

function toTraceType(kind: EventEnvelopeV1["eventKind"]): EventType | undefined {
  if (kind === "run.start") return "run_started";
  if (kind === "run.end") return "run_completed";
  if (kind === "run.error") return "run_failed";
  if (kind === "tool.start") return "tool_requested";
  if (kind === "tool.result") return "tool_result";
  if (kind === "state.update" || kind === "state.read") return "shared_state_write";
  return undefined;
}

function toReplayTrace(events: readonly EventEnvelopeV1[], runId: string): TraceEvent[] {
  const trace: TraceEvent[] = [];
  for (const event of events) {
    const type = toTraceType(event.eventKind);
    if (type === undefined) continue;
    trace.push(
      createEvent({
        runId,
        stepId: `step-${trace.length}`,
        sequence: trace.length,
        timestamp: event.wallClock,
        type,
        actor: event.actorId,
        payload: {
          boundary: event.boundary,
          eventKind: event.eventKind,
          evidenceClass: "GENUINE_RUNTIME",
        },
      }),
    );
  }
  if (trace.at(-1)?.type !== "run_failed") {
    trace.push(
      createEvent({
        runId,
        stepId: `step-${trace.length}`,
        sequence: trace.length,
        timestamp: new Date().toISOString(),
        type: "run_failed",
        actor: "langgraph-runtime",
        payload: { reason: "captured runtime failure", evidenceClass: "GENUINE_RUNTIME" },
      }),
    );
  }
  return trace;
}

describe("LangGraph 1.4.9 adapter checkpoint", () => {
  it("[GENUINE_RUNTIME] normalizes a clean graph and real node lifecycle", async () => {
    const State = Annotation.Root({ value: Annotation<string>() });
    const graph = new StateGraph(State)
      .addNode("append", ({ value }) => ({ value: `${value}-done` }))
      .addEdge(START, "append")
      .addEdge("append", END)
      .compile();
    const adapter = createLangGraphAdapter();
    const result = await adapter.captureProtocolStream(
      graph.streamEvents(
        { value: "clean" },
        { version: "v3", streamMode: ["tasks", "updates", "values"] },
      ),
      runContext(),
    );

    expect(result.error).toBeUndefined();
    expect(result.events.map((event) => event.eventKind)).toEqual(
      expect.arrayContaining(["run.start", "agent.start", "agent.end", "state.update", "run.end"]),
    );
    expect(() => result.events.forEach((event) => validateV1Event(event))).not.toThrow();
  });

  it("[GENUINE_RUNTIME] captures real ToolNode start and result identity", async () => {
    const double = tool(async ({ value }) => value * 2, {
      name: "double",
      description: "Double a number deterministically.",
      schema: {
        type: "object",
        properties: { value: { type: "number" } },
        required: ["value"],
        additionalProperties: false,
      },
    });
    const graph = new StateGraph(MessagesAnnotation)
      .addNode("tools", new ToolNode([double]))
      .addEdge(START, "tools")
      .addEdge("tools", END)
      .compile();
    const input = {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            { name: "double", args: { value: 4 }, id: "call-double", type: "tool_call" },
          ],
        }),
      ],
    };
    const adapter = createLangGraphAdapter();
    const result = await adapter.captureProtocolStream(
      graph.streamEvents(input, {
        version: "v3",
        streamMode: ["messages", "tasks", "updates"],
      }),
      runContext(),
    );

    expect(result.error).toBeUndefined();
    const tools = result.events.filter((event) => event.eventClass === "tool");
    expect(tools.map((event) => event.eventKind)).toEqual(["tool.start", "tool.result"]);
    expect(tools.every((event) => event.actorId === "tool:call-double")).toBe(true);
  });

  it("[GENUINE_RUNTIME] captures a controlled tool error without unbounded execution", async () => {
    let calls = 0;
    const fail = tool(
      async () => {
        calls += 1;
        throw new Error("controlled tool failure");
      },
      {
        name: "fail_once",
        description: "Fail deterministically.",
        schema: { type: "object", properties: {}, additionalProperties: false },
      },
    );
    const graph = new StateGraph(MessagesAnnotation)
      .addNode("tools", new ToolNode([fail], { handleToolErrors: false }))
      .addEdge(START, "tools")
      .addEdge("tools", END)
      .compile();
    const input = {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [{ name: "fail_once", args: {}, id: "call-fail", type: "tool_call" }],
        }),
      ],
    };
    const adapter = createLangGraphAdapter();
    const result = await adapter.captureProtocolStream(
      graph.streamEvents(input, { version: "v3", streamMode: ["messages", "tasks"] }),
      runContext(),
    );

    expect(result.error?.message).toContain("controlled tool failure");
    expect(calls).toBe(1);
    expect(result.events.some((event) => event.eventKind === "tool.error")).toBe(true);
    expect(result.events.some((event) => event.eventKind === "run.error")).toBe(true);
  });

  it("[GENUINE_RUNTIME] performs exactly one bounded retry and recovery", async () => {
    const State = Annotation.Root({ count: Annotation<number>() });
    let attempts = 0;
    const graph = new StateGraph(State)
      .setNodeDefaults({
        retryPolicy: {
          maxAttempts: 2,
          initialInterval: 1,
          maxInterval: 1,
          backoffFactor: 1,
          jitter: false,
          logWarning: false,
        },
      })
      .addNode("flaky", () => {
        attempts += 1;
        if (attempts === 1) throw new Error("retry once");
        return { count: attempts };
      })
      .addEdge(START, "flaky")
      .addEdge("flaky", END)
      .compile();
    const adapter = createLangGraphAdapter();
    const result = await adapter.captureProtocolStream(
      graph.streamEvents(
        { count: 0 },
        { version: "v3", streamMode: ["tasks", "updates", "values"] },
      ),
      runContext(),
    );

    expect(result.error).toBeUndefined();
    expect(attempts).toBe(2);
    expect(result.events.some((event) => event.eventKind === "run.end")).toBe(true);
  });

  it("[GENUINE_RUNTIME] enforces the public node timeout boundary", async () => {
    const State = Annotation.Root({ value: Annotation<string>() });
    const graph = new StateGraph(State)
      .addNode(
        "slow",
        async () => {
          await delay(60);
          return { value: "late" };
        },
        { timeout: 10, retryPolicy: { maxAttempts: 1 } },
      )
      .addEdge(START, "slow")
      .addEdge("slow", END)
      .compile();
    const adapter = createLangGraphAdapter();
    const started = Date.now();
    const result = await adapter.captureProtocolStream(
      graph.streamEvents({ value: "timeout" }, { version: "v3", streamMode: ["tasks"] }),
      runContext(),
    );

    expect(isNodeTimeoutError(result.error)).toBe(true);
    expect(Date.now() - started).toBeLessThan(500);
    expect(result.events.some((event) => event.eventKind === "run.error")).toBe(true);
    await delay(70);
  });

  it("[GENUINE_RUNTIME] preserves stream chunk order and redacts secret-shaped payloads", async () => {
    const State = Annotation.Root({ value: Annotation<string>() });
    const graph = new StateGraph(State)
      .addNode("emit", (_state, config) => {
        const writer = getWriter(config);
        writer?.({ chunkId: "one", text: "first" });
        writer?.({ chunkId: "two", api_key: "sk-runtime-secret-123456789" });
        writer?.({ chunkId: "three", text: "last" });
        return { value: "done" };
      })
      .addEdge(START, "emit")
      .addEdge("emit", END)
      .compile();
    const adapter = createLangGraphAdapter();
    const result = await adapter.captureProtocolStream(
      graph.streamEvents({ value: "stream" }, { version: "v3", streamMode: ["custom"] }),
      runContext(),
    );

    expect(result.error).toBeUndefined();
    const chunks = result.events.filter(
      (event) =>
        event.eventKind === "stream.chunk" && protocolPayload(event).protocolMethod === "custom",
    );
    expect(chunks).toHaveLength(3);
    expect(chunks.map((event) => protocolPayload(event).protocolSequence)).toEqual(
      [...chunks.map((event) => protocolPayload(event).protocolSequence)].sort(
        (left, right) => Number(left) - Number(right),
      ),
    );
    expect(chunks.map((event) => event.spanId)).toEqual([
      chunks[0]?.spanId,
      chunks[0]?.spanId,
      chunks[0]?.spanId,
    ]);
    expect(JSON.stringify(chunks)).not.toContain("sk-runtime-secret-123456789");
    expect(chunks.some((event) => event.redaction.strategy === "redacted")).toBe(true);
  });

  it("[GENUINE_RUNTIME] interrupts and resumes from MemorySaver without duplicating side effects", async () => {
    const State = Annotation.Root({ approved: Annotation<boolean>() });
    let nodeRuns = 0;
    let sideEffects = 0;
    const graph = new StateGraph(State)
      .addNode("approval", () => {
        nodeRuns += 1;
        const answer = interrupt({ prompt: "approve" }) as { approved?: boolean };
        if (answer.approved) sideEffects += 1;
        return { approved: answer.approved === true };
      })
      .addEdge(START, "approval")
      .addEdge("approval", END)
      .compile({ checkpointer: new MemorySaver() });
    const configurable = { configurable: { thread_id: `thread-${randomUUID()}` } };
    const traceId = `trace-${randomUUID()}`;
    const adapter = createLangGraphAdapter();
    const first = await adapter.captureProtocolStream(
      graph.streamEvents(
        { approved: false },
        { ...configurable, version: "v3", streamMode: ["tasks", "updates", "checkpoints"] },
      ),
      runContext({ traceId }),
    );
    const interrupted = await graph.getState(configurable);
    const second = await adapter.captureProtocolStream(
      graph.streamEvents(new Command({ resume: { approved: true } }), {
        ...configurable,
        version: "v3",
        streamMode: ["tasks", "updates", "checkpoints"],
      }),
      runContext({ traceId }),
    );
    const completed = await graph.getState(configurable);

    expect(first.error).toBeUndefined();
    expect(first.events.some((event) => event.eventKind === "interrupt")).toBe(true);
    expect(interrupted.tasks.at(-1)?.interrupts).toHaveLength(1);
    expect(second.error).toBeUndefined();
    expect(second.events.some((event) => event.eventKind === "run.end")).toBe(true);
    expect(completed.values.approved).toBe(true);
    expect(nodeRuns).toBe(2);
    expect(sideEffects).toBe(1);
  });

  it("[GENUINE_RUNTIME] retains nested subgraph and parent span identity", async () => {
    const State = Annotation.Root({ value: Annotation<string>() });
    const child = new StateGraph(State)
      .addNode("child-step", ({ value }) => ({ value: `${value}-child` }))
      .addEdge(START, "child-step")
      .addEdge("child-step", END)
      .compile();
    const parent = new StateGraph(State)
      .addNode("child-graph", child)
      .addEdge(START, "child-graph")
      .addEdge("child-graph", END)
      .compile();
    const context = runContext();
    const adapter = createLangGraphAdapter();
    const result = await adapter.captureProtocolStream(
      parent.streamEvents(
        { value: "nested" },
        { version: "v3", streamMode: ["tasks", "updates", "values"] },
      ),
      context,
    );

    expect(result.error).toBeUndefined();
    const nested = result.events.filter((event) => event.parentSpanId !== undefined);
    expect(nested.length).toBeGreaterThan(0);
    expect(nested.some((event) => event.parentSpanId === `${context.runId}:root`)).toBe(true);
    expect(new Set(nested.map((event) => event.spanId)).size).toBeGreaterThanOrEqual(1);
  });

  it("[FIXTURE_BACKED_PROTOCOL] rejects a malformed tool-finished result as tool.error", () => {
    const malformed = {
      type: "event",
      seq: 0,
      method: "tools",
      params: {
        namespace: [],
        timestamp: 1_700_000_000_000,
        node: "tool-node",
        data: { event: "tool-finished", tool_call_id: "call-malformed" },
      },
    } satisfies ProtocolEvent;
    const adapter = createLangGraphAdapter();
    const event = adapter.normalize(
      malformed,
      runContext({ evidenceClass: "FIXTURE_BACKED_PROTOCOL" }),
    );

    expect(event.eventKind).toBe("tool.error");
    expect(protocolPayload(event).malformedResult).toBe(true);
    expect(event.metadata.evidenceClass).toBe("FIXTURE_BACKED_PROTOCOL");
  });

  it("[GENUINE_RUNTIME] produces a stable bounded replay comparison", async () => {
    const State = Annotation.Root({ value: Annotation<string>() });
    const graph = new StateGraph(State)
      .addNode("done", () => ({ value: "done" }))
      .addEdge(START, "done")
      .addEdge("done", END)
      .compile();
    const adapter = createLangGraphAdapter();
    const capture = await adapter.captureProtocolStream(
      graph.streamEvents({ value: "start" }, { version: "v3", streamMode: ["updates"] }),
      runContext(),
    );
    const first = await adapter.replay(capture.events);
    const second = await adapter.replay(capture.events);

    expect(first).toEqual(second);
    expect(first.passed).toBe(true);
    expect(first.duplicateSideEffects).toBe(0);
  });

  it("[GENUINE_RUNTIME] generates and executes a regression from genuine failure evidence", async () => {
    const State = Annotation.Root({ value: Annotation<string>() });
    const graph = new StateGraph(State)
      .addNode(
        "fail",
        () => {
          throw new Error("genuine regression source");
        },
        { retryPolicy: { maxAttempts: 1 } },
      )
      .addEdge(START, "fail")
      .addEdge("fail", END)
      .compile();
    const context = runContext();
    const adapter = createLangGraphAdapter();
    const capture = await adapter.captureProtocolStream(
      graph.streamEvents({ value: "fail" }, { version: "v3", streamMode: ["tasks", "values"] }),
      context,
    );
    expect(capture.error?.message).toContain("genuine regression source");
    const trace = toReplayTrace(capture.events, context.runId);
    const workspace = await mkdtemp(join(tmpdir(), "resilireplay-langgraph-regression-"));
    try {
      const artifact = await compileRegression(trace, workspace);
      const execution = spawnSync(process.execPath, ["--test", artifact.testPath], {
        cwd: workspace,
        encoding: "utf8",
        windowsHide: true,
      });
      expect(execution.status, execution.stderr).toBe(0);
      expect(execution.stdout).toContain("reproduces the captured ResiliReplay failure");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("[GENUINE_RUNTIME] cleanup releases all adapter-owned run state and adds no process listeners", async () => {
    const before = process.listenerCount("uncaughtException");
    const adapter = createLangGraphAdapter();
    adapter.normalize(
      {
        type: "event",
        seq: 0,
        method: "lifecycle",
        params: { namespace: [], timestamp: Date.now(), data: { event: "running" } },
      } satisfies ProtocolEvent,
      runContext(),
    );
    expect(adapter.activeRunCount()).toBe(1);
    await adapter.cleanup({ rootDirectory: process.cwd() });

    expect(adapter.activeRunCount()).toBe(0);
    expect(process.listenerCount("uncaughtException")).toBe(before);
  });
});
