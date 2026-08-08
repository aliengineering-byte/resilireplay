import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  Agent,
  handoff,
  setTraceProcessors,
  setTracingDisabled,
  tool,
  type Model,
  type ModelRequest,
  type ModelResponse,
  type StreamEvent,
} from "@openai/agents";
import {
  createEvent,
  validateV1Event,
  type EventEnvelopeV1,
  type EventType,
  type TraceEvent,
} from "@resilireplay/core";
import { compileRegression } from "@resilireplay/trace";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  OpenAIAgentsTraceProcessor,
  ScriptedModel,
  createOpenAIAgentsAdapter,
  functionCallResponse,
  textResponse,
  type OpenAIAgentsRunContext,
} from "./index.js";

function runContext(overrides: Partial<OpenAIAgentsRunContext> = {}): OpenAIAgentsRunContext {
  const identity = randomUUID();
  return {
    runId: `run-${identity}`,
    traceId: `trace-${identity}`,
    turnId: `turn-${identity}`,
    actorId: "openai-agents-runtime",
    evidenceClass: "GENUINE_RUNTIME",
    ...overrides,
  };
}

function agent(_model: Model, overrides: Partial<ConstructorParameters<typeof Agent>[0]> = {}) {
  return new Agent({
    name: "local-agent",
    instructions: "Use only the deterministic local model.",
    ...overrides,
  });
}

function payload(event: EventEnvelopeV1): Record<string, unknown> {
  return typeof event.payload === "object" &&
    event.payload !== null &&
    !Array.isArray(event.payload)
    ? (event.payload as Record<string, unknown>)
    : {};
}

function toTraceType(kind: EventEnvelopeV1["eventKind"]): EventType | undefined {
  if (kind === "run.start") return "run_started";
  if (kind === "run.end") return "run_completed";
  if (kind === "run.error") return "run_failed";
  if (kind === "model.request") return "model_request";
  if (kind === "model.response") return "model_response";
  if (kind === "tool.start") return "tool_requested";
  if (kind === "tool.result") return "tool_result";
  if (kind === "handoff.requested") return "agent_handoff";
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
        type: "run_failed",
        actor: "openai-agents-runtime",
        payload: { reason: "captured runtime failure", evidenceClass: "GENUINE_RUNTIME" },
      }),
    );
  }
  return trace;
}

class AbortOnlyModel implements Model {
  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    return await new Promise<ModelResponse>((_resolve, reject) => {
      const abort = () =>
        reject(request.signal?.reason ?? new DOMException("Aborted", "AbortError"));
      if (request.signal?.aborted) abort();
      else request.signal?.addEventListener("abort", abort, { once: true });
    });
  }

  async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    yield { type: "response_started" };
    await this.getResponse(request);
  }
}

describe.sequential("OpenAI Agents SDK 0.14.3 adapter checkpoint", () => {
  afterEach(() => {
    setTraceProcessors([]);
    setTracingDisabled(true);
  });

  it("[GENUINE_RUNTIME] captures a clean public Agent and Runner lifecycle", async () => {
    const model = new ScriptedModel([textResponse("local answer")]);
    const adapter = createOpenAIAgentsAdapter();
    const result = await adapter.captureRun({
      agent: agent(model),
      input: "hello",
      model,
      context: runContext(),
    });

    expect(result.error).toBeUndefined();
    expect(result.finalOutput).toBe("local answer");
    expect(result.events.map((event) => event.eventKind)).toEqual(
      expect.arrayContaining([
        "run.start",
        "turn.start",
        "agent.start",
        "model.request",
        "model.response",
        "agent.end",
        "turn.end",
        "run.end",
      ]),
    );
    expect(() => result.events.forEach((event) => validateV1Event(event))).not.toThrow();
  });

  it("[GENUINE_RUNTIME] executes a real function tool and preserves call identity", async () => {
    const double = tool({
      name: "double",
      description: "Double a number.",
      parameters: z.object({ value: z.number() }),
      execute: (input) => String(input.value * 2),
    });
    const model = new ScriptedModel([
      functionCallResponse("double", "call-double", '{"value":4}'),
      textResponse("8"),
    ]);
    const adapter = createOpenAIAgentsAdapter();
    const result = await adapter.captureRun({
      agent: agent(model, { tools: [double] }),
      input: "double four",
      model,
      context: runContext(),
    });

    expect(result.error).toBeUndefined();
    const toolEvents = result.events.filter((event) => event.eventClass === "tool");
    expect(toolEvents.map((event) => event.eventKind)).toEqual(["tool.start", "tool.result"]);
    expect(payload(toolEvents[0]!).callId).toBe("call-double");
    expect(payload(toolEvents[1]!).callId).toBe("call-double");
    const turns = result.events.filter((event) => event.eventKind === "turn.start");
    expect(new Set(turns.map((event) => event.turnId)).size).toBe(2);
  });

  it("[GENUINE_RUNTIME] captures a controlled public function-tool failure", async () => {
    const fail = tool({
      name: "fail_local",
      description: "Fail deterministically.",
      parameters: z.object({}),
      errorFunction: null,
      execute: () => {
        throw new Error("controlled tool failure");
      },
    });
    const model = new ScriptedModel([functionCallResponse("fail_local", "call-fail", "{}")]);
    const adapter = createOpenAIAgentsAdapter();
    const result = await adapter.captureRun({
      agent: agent(model, { tools: [fail] }),
      input: "fail",
      model,
      context: runContext(),
    });

    expect(result.error?.message).toContain("controlled tool failure");
    expect(result.events.map((event) => event.eventKind)).toEqual(
      expect.arrayContaining(["tool.start", "tool.error", "run.error"]),
    );
  });

  it("[GENUINE_RUNTIME] captures a public function-tool timeout boundary", async () => {
    const slow = tool({
      name: "slow_local",
      description: "Exceed a deterministic local timeout.",
      parameters: z.object({}),
      timeoutMs: 5,
      timeoutBehavior: "raise_exception",
      execute: async () => {
        await delay(40);
        return "late";
      },
    });
    const model = new ScriptedModel([functionCallResponse("slow_local", "call-timeout", "{}")]);
    const adapter = createOpenAIAgentsAdapter();
    const result = await adapter.captureRun({
      agent: agent(model, { tools: [slow] }),
      input: "timeout",
      model,
      context: runContext(),
    });

    expect(result.error).toBeDefined();
    const timeout = result.events.find((event) => event.eventKind === "tool.timeout");
    expect(payload(timeout!).toolName).toBe("slow_local");
    expect(payload(timeout!).timeoutMs).toBe(5);
  });

  it("[GENUINE_RUNTIME] bounds an SDK model retry to exactly one retry", async () => {
    const model = new ScriptedModel([
      new Error("transient local failure"),
      textResponse("recovered"),
    ]);
    const adapter = createOpenAIAgentsAdapter();
    const result = await adapter.captureRun({
      agent: agent(model),
      input: "retry once",
      model,
      context: runContext(),
      runnerConfig: {
        modelSettings: {
          retry: {
            maxRetries: 1,
            policy: () => true,
            backoff: { initialDelayMs: 0, maxDelayMs: 0, multiplier: 1, jitter: false },
          },
        },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.finalOutput).toBe("recovered");
    expect(model.attemptCount()).toBe(2);
    expect(result.events.filter((event) => event.eventKind === "model.retry")).toHaveLength(1);
  });

  it("[GENUINE_RUNTIME] performs a public handoff with from/to identity", async () => {
    const model = new ScriptedModel([
      functionCallResponse("transfer_to_specialist", "call-handoff", "{}"),
      textResponse("specialist complete"),
    ]);
    const specialist = agent(model, { name: "specialist" });
    const triage = agent(model, {
      name: "triage",
      handoffs: [handoff(specialist, { toolNameOverride: "transfer_to_specialist" })],
    });
    const adapter = createOpenAIAgentsAdapter();
    const result = await adapter.captureRun({
      agent: triage,
      input: "route",
      model,
      context: runContext(),
    });

    expect(result.error).toBeUndefined();
    const accepted = result.events.find((event) => event.eventKind === "handoff.accepted");
    expect(payload(accepted!).fromAgent).toBe("triage");
    expect(payload(accepted!).toAgent).toBe("specialist");
    expect(result.events.map((event) => event.eventKind)).toContain("handoff.completed");
    const agentStarts = result.events.filter((event) => event.eventKind === "agent.start");
    expect(agentStarts.map((event) => event.actorId)).toEqual(
      expect.arrayContaining(["triage", "specialist"]),
    );
    expect(agentStarts.every((event) => event.traceId === result.events[0]!.traceId)).toBe(true);
  });

  it("[GENUINE_RUNTIME] captures a public input guardrail tripwire", async () => {
    const model = new ScriptedModel([textResponse("must not run")]);
    const adapter = createOpenAIAgentsAdapter();
    const result = await adapter.captureRun({
      agent: agent(model),
      input: "blocked",
      model,
      context: runContext(),
      runnerConfig: {
        inputGuardrails: [
          {
            name: "deny-local-input",
            runInParallel: false,
            execute: async () => ({ tripwireTriggered: true, outputInfo: { reason: "test" } }),
          },
        ],
      },
    });

    expect(result.error?.name).toBe("InputGuardrailTripwireTriggered");
    expect(model.attemptCount()).toBe(0);
    const failure = result.events.find((event) => event.eventKind === "guardrail.fail");
    expect(payload(failure!).guardrail).toBe("deny-local-input");
  });

  it("[GENUINE_RUNTIME] preserves stream order while omitting sensitive delta text", async () => {
    const secret = "sk-abcdefghijklmnopQRST";
    const model = new ScriptedModel([textResponse(`answer ${secret}`)]);
    const adapter = createOpenAIAgentsAdapter();
    const result = await adapter.captureRun({
      agent: agent(model),
      input: "stream",
      model,
      context: runContext(),
      stream: true,
    });

    expect(result.error).toBeUndefined();
    const chunks = result.events.filter((event) => event.eventKind === "stream.chunk");
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((event) => event.sequence)).toEqual(
      [...chunks.map((event) => event.sequence)].sort((left, right) => left - right),
    );
    expect(JSON.stringify(chunks)).not.toContain(secret);
    expect(payload(chunks[0]!).deltaDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.events.map((event) => event.eventKind)).toContain("stream.completed");
  });

  it("[GENUINE_RUNTIME] cancels a streaming SDK run through AbortSignal", async () => {
    const model = new AbortOnlyModel();
    const controller = new AbortController();
    const adapter = createOpenAIAgentsAdapter();
    const capture = adapter.captureRun({
      agent: agent(model),
      input: "wait",
      model,
      context: runContext(),
      signal: controller.signal,
      stream: true,
    });
    await delay(10);
    controller.abort(new DOMException("cancelled locally", "AbortError"));
    const result = await capture;

    expect(result.error).toBeDefined();
    expect(result.events.map((event) => event.eventKind)).toEqual(
      expect.arrayContaining(["stream.cancelled", "run.error"]),
    );
  });

  it("[GENUINE_RUNTIME] maps genuine SDK trace and span identities without an exporter", async () => {
    const context = runContext({ traceId: `trace_${randomUUID().replaceAll("-", "")}` });
    const processor = new OpenAIAgentsTraceProcessor(context);
    setTracingDisabled(false);
    setTraceProcessors([processor]);
    const model = new ScriptedModel([textResponse("traced")]);
    const adapter = createOpenAIAgentsAdapter();
    const result = await adapter.captureRun({
      agent: agent(model),
      input: "trace",
      model,
      context,
      runnerConfig: { tracingDisabled: false, workflowName: "local trace evidence" },
    });

    expect(result.error).toBeUndefined();
    await processor.forceFlush();
    expect(processor.events.map((event) => event.eventKind)).toEqual(
      expect.arrayContaining(["run.start", "run.end", "custom"]),
    );
    const spans = processor.events.filter((event) => payload(event).sdkSpanId !== undefined);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.every((event) => event.traceId === context.traceId)).toBe(true);
  });

  it("[GENUINE_RUNTIME] generates and executes a regression from a genuine SDK failure", async () => {
    const fail = tool({
      name: "regression_failure",
      description: "Fail for regression capture.",
      parameters: z.object({}),
      errorFunction: null,
      execute: () => {
        throw new Error("genuine agents regression source");
      },
    });
    const model = new ScriptedModel([
      functionCallResponse("regression_failure", "call-regression", "{}"),
    ]);
    const context = runContext();
    const adapter = createOpenAIAgentsAdapter();
    const capture = await adapter.captureRun({
      agent: agent(model, { tools: [fail] }),
      input: "fail for regression",
      model,
      context,
    });
    expect(capture.error?.message).toContain("genuine agents regression source");
    const trace = toReplayTrace(capture.events, context.runId);
    const workspace = await mkdtemp(join(tmpdir(), "resilireplay-openai-agents-regression-"));
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

  it("[GENUINE_RUNTIME] cleanup leaves no adapter run state or process listeners", async () => {
    const beforeUnhandled = process.listenerCount("unhandledRejection");
    const beforeUncaught = process.listenerCount("uncaughtException");
    const model = new ScriptedModel([textResponse("clean")]);
    const adapter = createOpenAIAgentsAdapter();
    await adapter.captureRun({ agent: agent(model), input: "clean", model, context: runContext() });
    await adapter.cleanup({ rootDirectory: process.cwd() });

    expect(adapter.activeRunCount()).toBe(0);
    expect(process.listenerCount("unhandledRejection")).toBe(beforeUnhandled);
    expect(process.listenerCount("uncaughtException")).toBe(beforeUncaught);
  });
});
