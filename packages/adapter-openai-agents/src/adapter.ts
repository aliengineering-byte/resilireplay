import {
  InputGuardrailTripwireTriggered,
  Runner,
  ToolTimeoutError,
  Usage,
  type Agent,
  type AgentInputItem,
  type AgentOutputType,
  type Model,
  type ModelRequest,
  type ModelResponse,
  type RunConfig,
  type RunStreamEvent,
  type StreamEvent,
} from "@openai/agents";
import {
  createV1Event,
  hashValue,
  stableStringify,
  validateV1Event,
  type EventEnvelopeV1,
} from "@resilireplay/core";
import type {
  AdapterHooks,
  DetectResult,
  FaultInjectionRequest,
  FaultInjectionResult,
  FrameworkAdapter,
  FrameworkDetectionContext,
  HealthStatus,
  RegressionArtifact,
  ReplayResult,
} from "@resilireplay/adapter-sdk";
import {
  OPENAI_AGENTS_ADAPTER_NAME,
  OPENAI_AGENTS_FRAMEWORK_VERSION,
  OPENAI_AGENTS_MANIFEST,
  openAIAgentsCapabilities,
  openAIAgentsFaultBoundaries,
} from "./manifest.js";
import { OpenAIAgentsEventRecorder, type OpenAIAgentsRunContext } from "./recorder.js";

export interface OpenAIAgentsCaptureRequest<TContext, TOutput extends AgentOutputType> {
  agent: Agent<TContext, TOutput>;
  input: string | AgentInputItem[];
  model: Model;
  context: OpenAIAgentsRunContext;
  runContext?: TContext;
  runnerConfig?: Omit<Partial<RunConfig>, "model" | "traceIncludeSensitiveData">;
  maxTurns?: number;
  signal?: AbortSignal;
  stream?: boolean;
}

export interface OpenAIAgentsCaptureResult {
  events: EventEnvelopeV1[];
  finalOutput?: unknown;
  streamEventTypes: string[];
  error?: Error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isAbortError(error: Error, signal?: AbortSignal): boolean {
  return signal?.aborted === true || error.name === "AbortError" || /abort/iu.test(error.message);
}

function findToolTimeout(value: unknown): ToolTimeoutError | undefined {
  if (value instanceof ToolTimeoutError) return value;
  if (!isRecord(value)) return undefined;
  return value.error instanceof ToolTimeoutError
    ? value.error
    : value.cause instanceof ToolTimeoutError
      ? value.cause
      : undefined;
}

function callId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const candidate = value.callId ?? value.call_id ?? value.id;
  return typeof candidate === "string" ? candidate : undefined;
}

function recreateEvent(
  event: EventEnvelopeV1,
  overrides: Partial<
    Pick<
      EventEnvelopeV1,
      "eventKind" | "eventClass" | "boundary" | "phase" | "payload" | "metadata"
    >
  > = {},
): EventEnvelopeV1 {
  return createV1Event({
    eventId: event.eventId,
    runId: event.runId,
    traceId: event.traceId,
    spanId: event.spanId,
    ...(event.parentSpanId === undefined ? {} : { parentSpanId: event.parentSpanId }),
    sequence: event.sequence,
    turnId: event.turnId,
    actorId: event.actorId,
    framework: event.framework,
    frameworkVersion: event.frameworkVersion,
    adapter: event.adapter,
    adapterVersion: event.adapterVersion,
    operation: event.operation,
    boundary: overrides.boundary ?? event.boundary,
    phase: overrides.phase ?? event.phase,
    eventKind: overrides.eventKind ?? event.eventKind,
    attempt: event.attempt,
    eventClass: overrides.eventClass ?? event.eventClass,
    safetyClass: event.safetyClass,
    payload: overrides.payload ?? event.payload,
    metadata: overrides.metadata ?? event.metadata,
    redaction: event.redaction,
    wallClock: event.wallClock,
    ...(event.sideEffect === undefined ? {} : { sideEffect: event.sideEffect }),
    ...(event.deterministicSeed === undefined
      ? {}
      : { deterministicSeed: event.deterministicSeed }),
    ...(event.causeId === undefined ? {} : { causeId: event.causeId }),
    ...(event.parentEventId === undefined ? {} : { parentEventId: event.parentEventId }),
  });
}

class InstrumentedModel implements Model {
  private attempt = 0;
  private turnIndex = 0;

  constructor(
    private readonly delegate: Model,
    private readonly recorder: OpenAIAgentsEventRecorder,
  ) {}

  private start(request: ModelRequest, stream: boolean): number {
    const attempt = ++this.attempt;
    this.recorder.beginTurn(this.turnIndex++);
    this.recorder.emit({
      kind: "turn.start",
      attempt,
      payload: { attempt, stream },
    });
    if (attempt > 1) {
      this.recorder.emit({
        kind: "model.retry",
        attempt,
        payload: { attempt, stream },
      });
    }
    this.recorder.emit({
      kind: "model.request",
      attempt,
      payload: {
        attempt,
        stream,
        inputKind: typeof request.input === "string" ? "text" : "items",
        toolCount: request.tools.length,
        handoffCount: request.handoffs.length,
        tracing: request.tracing,
      },
    });
    return attempt;
  }

  private complete(response: ModelResponse, attempt: number, stream: boolean): void {
    this.recorder.emit({
      kind: "model.response",
      attempt,
      payload: {
        attempt,
        responseId: response.responseId,
        outputTypes: response.output.map((item) => item.type ?? "message"),
        usage: {
          requests: response.usage.requests,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          totalTokens: response.usage.totalTokens,
        },
      },
    });
    this.recorder.emit({
      kind: "turn.end",
      attempt,
      payload: { attempt, stream },
    });
  }

  private failed(error: unknown, attempt: number): never {
    const normalized = asError(error);
    this.recorder.emit({
      kind: "model.error",
      attempt,
      payload: { attempt, name: normalized.name, message: normalized.message },
    });
    this.recorder.emit({
      kind: "turn.end",
      attempt,
      payload: { attempt, error: true },
    });
    throw normalized;
  }

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const attempt = this.start(request, false);
    try {
      const response = await this.delegate.getResponse(request);
      this.complete(response, attempt, false);
      return response;
    } catch (error) {
      return this.failed(error, attempt);
    }
  }

  async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    const attempt = this.start(request, true);
    try {
      for await (const event of this.delegate.getStreamedResponse(request)) {
        if (event.type === "response_done") {
          const response: ModelResponse = {
            responseId: event.response.id,
            ...(event.response.requestId === undefined
              ? {}
              : { requestId: event.response.requestId }),
            usage: new Usage({
              inputTokens: event.response.usage.inputTokens,
              outputTokens: event.response.usage.outputTokens,
              totalTokens: event.response.usage.totalTokens,
              ...(event.response.usage.requests === undefined
                ? {}
                : { requests: event.response.usage.requests }),
              ...(event.response.usage.inputTokensDetails === undefined
                ? {}
                : { inputTokensDetails: event.response.usage.inputTokensDetails }),
              ...(event.response.usage.outputTokensDetails === undefined
                ? {}
                : { outputTokensDetails: event.response.usage.outputTokensDetails }),
            }),
            output: event.response.output,
          };
          this.complete(response, attempt, true);
        }
        yield event;
      }
    } catch (error) {
      this.failed(error, attempt);
    }
  }

  getRetryAdvice(args: Parameters<NonNullable<Model["getRetryAdvice"]>>[0]) {
    return this.delegate.getRetryAdvice?.(args);
  }
}

function streamPayload(event: RunStreamEvent): Record<string, unknown> | undefined {
  if (event.type !== "raw_model_stream_event") return undefined;
  if (event.data.type === "output_text_delta") {
    return {
      type: event.data.type,
      itemId: event.data.itemId,
      deltaDigest: hashValue(event.data.delta),
      deltaLength: event.data.delta.length,
    };
  }
  if (event.data.type === "response_started") return { type: event.data.type };
  if (event.data.type === "response_done") {
    return { type: event.data.type, responseId: event.data.response.id };
  }
  return { type: event.data.type };
}

export class OpenAIAgentsAdapter implements FrameworkAdapter {
  readonly manifest = OPENAI_AGENTS_MANIFEST;
  private activeCaptures = 0;

  detect(context: FrameworkDetectionContext): DetectResult | undefined {
    const candidates = [context.frameworkHint, context.packageName, context.command]
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.toLowerCase());
    const matched = candidates.some(
      (entry) => entry.includes("@openai/agents") || entry.includes("openai-agents"),
    );
    if (!matched) return undefined;
    return {
      framework: "openai-agents",
      ...(context.version === undefined ? {} : { frameworkVersion: context.version }),
      confidence: context.packageName?.toLowerCase() === "@openai/agents" ? "high" : "medium",
      evidence: candidates,
      reason: "Detected the OpenAI Agents SDK package, framework hint, or command token.",
    };
  }

  capabilities() {
    return openAIAgentsCapabilities();
  }

  faultBoundaries() {
    return openAIAgentsFaultBoundaries();
  }

  async captureRun<TContext, TOutput extends AgentOutputType>(
    request: OpenAIAgentsCaptureRequest<TContext, TOutput>,
    hooks?: AdapterHooks,
  ): Promise<OpenAIAgentsCaptureResult> {
    this.activeCaptures += 1;
    const recorder = new OpenAIAgentsEventRecorder(request.context);
    const streamEventTypes: string[] = [];
    const instrumentedModel = new InstrumentedModel(request.model, recorder);
    const capturedAgent = request.agent.clone({ model: instrumentedModel });
    const tracingDisabled = request.runnerConfig?.tracingDisabled ?? true;
    const runner = new Runner({
      ...(request.runnerConfig ?? {}),
      model: instrumentedModel,
      tracingDisabled,
      traceIncludeSensitiveData: false,
      ...(tracingDisabled ? {} : { traceId: request.context.traceId }),
    });
    const activeTools = new Map<string, string>();
    const onAgentStart: Parameters<typeof runner.on<"agent_start">>[1] = (_runContext, agent) => {
      recorder.setActor(agent.name);
      recorder.emit({
        kind: "agent.start",
        actorId: agent.name,
        payload: { agentName: agent.name },
      });
    };
    const onAgentEnd: Parameters<typeof runner.on<"agent_end">>[1] = (_runContext, agent) => {
      recorder.emit({ kind: "agent.end", actorId: agent.name, payload: { agentName: agent.name } });
    };
    const onHandoff: Parameters<typeof runner.on<"agent_handoff">>[1] = (
      _runContext,
      fromAgent,
      toAgent,
    ) => {
      recorder.emit({
        kind: "handoff.requested",
        actorId: fromAgent.name,
        payload: { fromAgent: fromAgent.name, toAgent: toAgent.name },
      });
      recorder.emit({
        kind: "handoff.accepted",
        actorId: toAgent.name,
        payload: { fromAgent: fromAgent.name, toAgent: toAgent.name },
      });
    };
    const onToolStart: Parameters<typeof runner.on<"agent_tool_start">>[1] = (
      _runContext,
      agent,
      tool,
      details,
    ) => {
      const identity = callId(details.toolCall) ?? `${tool.name}-${activeTools.size}`;
      activeTools.set(identity, tool.name);
      recorder.emit({
        kind: "tool.start",
        actorId: agent.name,
        spanId: identity,
        payload: { toolName: tool.name, callId: identity, agentName: agent.name },
      });
    };
    const onToolEnd: Parameters<typeof runner.on<"agent_tool_end">>[1] = (
      _runContext,
      agent,
      tool,
      result,
      details,
    ) => {
      const identity = callId(details.toolCall) ?? `${tool.name}-unknown`;
      activeTools.delete(identity);
      recorder.emit({
        kind: "tool.result",
        actorId: agent.name,
        spanId: identity,
        payload: { toolName: tool.name, callId: identity, result, agentName: agent.name },
      });
    };

    runner.on("agent_start", onAgentStart);
    runner.on("agent_end", onAgentEnd);
    runner.on("agent_handoff", onHandoff);
    runner.on("agent_tool_start", onToolStart);
    runner.on("agent_tool_end", onToolEnd);

    const started = recorder.emit({
      kind: "run.start",
      payload: { stream: request.stream === true },
    });
    await hooks?.onRunStart?.(started);

    try {
      const commonOptions = {
        ...(request.runContext === undefined ? {} : { context: request.runContext }),
        ...(request.maxTurns === undefined ? {} : { maxTurns: request.maxTurns }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      };
      let finalOutput: unknown;
      if (request.stream === true) {
        const result = await runner.run(capturedAgent, request.input, {
          ...commonOptions,
          stream: true,
        });
        for await (const raw of result) {
          streamEventTypes.push(raw.type);
          const payload = streamPayload(raw);
          if (payload?.type === "output_text_delta") {
            const event = recorder.emit({ kind: "stream.chunk", payload });
            await hooks?.onEvent?.(event);
          }
          if (payload?.type === "response_done") {
            const event = recorder.emit({ kind: "stream.completed", payload });
            await hooks?.onEvent?.(event);
          }
        }
        await result.completed;
        if (result.error !== undefined && result.error !== null) throw result.error;
        if (result.cancelled) {
          throw request.signal?.reason ?? new DOMException("Stream cancelled", "AbortError");
        }
        finalOutput = result.finalOutput;
      } else {
        const result = await runner.run(capturedAgent, request.input, commonOptions);
        finalOutput = result.finalOutput;
      }
      if (recorder.events.some((event) => event.eventKind === "handoff.accepted")) {
        recorder.emit({
          kind: "handoff.completed",
          payload: { finalActor: recorder.events.at(-1)?.actorId },
        });
      }
      recorder.emit({ kind: "run.end", payload: { finalOutputType: typeof finalOutput } });
      for (const event of recorder.events) await hooks?.onEvent?.(event);
      return { events: recorder.events, finalOutput, streamEventTypes };
    } catch (cause) {
      const error = asError(cause);
      const timeout = findToolTimeout(cause);
      if (cause instanceof InputGuardrailTripwireTriggered) {
        recorder.emit({
          kind: "guardrail.fail",
          payload: { guardrail: cause.result.guardrail.name, tripwireTriggered: true },
        });
      } else if (timeout !== undefined) {
        recorder.emit({
          kind: "tool.timeout",
          payload: { toolName: timeout.toolName, timeoutMs: timeout.timeoutMs },
        });
      } else if (isAbortError(error, request.signal)) {
        recorder.emit({
          kind: "stream.cancelled",
          payload: { name: error.name, message: error.message },
        });
      } else if (activeTools.size > 0) {
        for (const [identity, toolName] of activeTools) {
          recorder.emit({
            kind: "tool.error",
            spanId: identity,
            payload: { toolName, callId: identity, name: error.name, message: error.message },
          });
        }
      } else {
        const lastToolStart = recorder.events.findLast((event) => event.eventKind === "tool.start");
        if (lastToolStart !== undefined) {
          recorder.emit({
            kind: "tool.error",
            spanId: lastToolStart.spanId,
            payload: {
              ...payloadRecord(lastToolStart.payload),
              name: error.name,
              message: error.message,
            },
          });
        }
      }
      recorder.emit({ kind: "run.error", payload: { name: error.name, message: error.message } });
      await hooks?.onError?.(error);
      return { events: recorder.events, streamEventTypes, error };
    } finally {
      runner.off("agent_start", onAgentStart);
      runner.off("agent_end", onAgentEnd);
      runner.off("agent_handoff", onHandoff);
      runner.off("agent_tool_start", onToolStart);
      runner.off("agent_tool_end", onToolEnd);
      this.activeCaptures -= 1;
    }
  }

  async captureEvents(
    context: FrameworkDetectionContext,
    hooks?: AdapterHooks,
  ): Promise<EventEnvelopeV1[]> {
    const candidate = context as FrameworkDetectionContext &
      Partial<OpenAIAgentsCaptureRequest<unknown, AgentOutputType>>;
    if (
      candidate.agent === undefined ||
      candidate.input === undefined ||
      candidate.model === undefined
    ) {
      throw new Error(
        `${OPENAI_AGENTS_ADAPTER_NAME} captureEvents requires agent, input, model, and run context; use captureRun for typed capture.`,
      );
    }
    if (!isRecord(candidate.context)) {
      throw new Error(`${OPENAI_AGENTS_ADAPTER_NAME} captureEvents requires a typed run context.`);
    }
    const result = await this.captureRun(
      candidate as OpenAIAgentsCaptureRequest<unknown, AgentOutputType>,
      hooks,
    );
    if (result.error !== undefined) throw result.error;
    return result.events;
  }

  async injectFaults(
    sourceEvents: readonly EventEnvelopeV1[],
    request: FaultInjectionRequest,
  ): Promise<FaultInjectionResult> {
    const events = sourceEvents.map((event) => validateV1Event(event));
    const map: Record<string, EventEnvelopeV1["eventKind"]> = {
      "tool-error": "tool.error",
      "tool-timeout": "tool.timeout",
      timeout: "tool.timeout",
      cancellation: "stream.cancelled",
      "handoff-failure": "handoff.failed",
      "stream-truncation": "stream.truncated",
    };
    const kind = map[request.faultType];
    if (kind === undefined) {
      return {
        events,
        injected: 0,
        skipped: [`Unsupported OpenAI Agents fault type: ${request.faultType}`],
        seed: request.seed,
      };
    }
    let seen = 0;
    let injected = 0;
    const occurrence = Math.max(1, request.occurrence);
    const replaced = events.map((event) => {
      if (event.boundary !== request.targetBoundary) return event;
      seen += 1;
      if (seen !== occurrence) return event;
      injected += 1;
      return recreateEvent(event, {
        eventKind: kind,
        eventClass: kind.startsWith("tool.")
          ? "tool"
          : kind.startsWith("stream.")
            ? "stream"
            : "handoff",
        boundary: kind.startsWith("tool.")
          ? "tool"
          : kind.startsWith("stream.")
            ? "stream"
            : "framework",
        phase: kind.endsWith("cancelled") ? "cancelled" : "error",
        payload: { source: event.payload, injectedFault: request.faultType, seed: request.seed },
        metadata: { ...event.metadata, injectedBy: OPENAI_AGENTS_ADAPTER_NAME },
      });
    });
    return {
      events: replaced,
      injected,
      skipped:
        injected === 0 ? [`No ${request.targetBoundary} boundary at occurrence ${occurrence}`] : [],
      seed: request.seed,
    };
  }

  async replay(sourceEvents: readonly EventEnvelopeV1[]): Promise<ReplayResult> {
    const events = sourceEvents.map((event) => validateV1Event(event));
    let duplicateSideEffects = 0;
    const sideEffects = new Set<string>();
    let lastSequence = -1;
    let ordered = true;
    for (const event of events) {
      if (event.sequence <= lastSequence) ordered = false;
      lastSequence = event.sequence;
      if (event.sideEffect?.status === "applied") {
        if (sideEffects.has(event.sideEffect.id)) duplicateSideEffects += 1;
        sideEffects.add(event.sideEffect.id);
      }
    }
    return {
      passed: ordered && duplicateSideEffects === 0,
      finalSequence: lastSequence,
      duplicateSideEffects,
      metricsDigest: hashValue({
        ordered,
        duplicateSideEffects,
        evidence: events.map((event) => event.payloadDigest),
      }),
    };
  }

  async generateRegression(
    sourceEvents: readonly EventEnvelopeV1[],
    destinationDirectory: string,
  ): Promise<RegressionArtifact> {
    const events = this.sanitizeEvents(sourceEvents);
    const fixture = events.map((event) => stableStringify(event));
    const critical = events.find((event) => event.phase === "error" || event.phase === "abort");
    return {
      scenario: {
        schemaVersion: "1.0",
        adapter: OPENAI_AGENTS_ADAPTER_NAME,
        frameworkVersion: OPENAI_AGENTS_FRAMEWORK_VERSION,
        destination: destinationDirectory,
        eventCount: events.length,
      },
      fixture,
      evidenceHash: hashValue(events),
      fixtureHash: hashValue(fixture.join("\n")),
      firstCriticalSequence: critical?.sequence ?? events.at(-1)?.sequence ?? 0,
    };
  }

  sanitizeEvents(sourceEvents: readonly EventEnvelopeV1[]): EventEnvelopeV1[] {
    return sourceEvents.map((event) => recreateEvent(validateV1Event(event)));
  }

  async cleanup(_context: FrameworkDetectionContext): Promise<void> {
    if (this.activeCaptures !== 0) {
      throw new Error(`Cannot clean up ${this.activeCaptures} active OpenAI Agents capture(s).`);
    }
  }

  async doctor(
    context: FrameworkDetectionContext = { rootDirectory: process.cwd() },
  ): Promise<HealthStatus> {
    const messages = [
      `Adapter manifest valid for @openai/agents${this.manifest.frameworkVersionRange}.`,
      "Capture uses the public provider-neutral Model interface and requires no API key.",
    ];
    if (context.version !== undefined && context.version !== OPENAI_AGENTS_FRAMEWORK_VERSION) {
      return {
        status: "degraded",
        messages: [
          ...messages,
          `Requested version ${context.version} differs from verified version ${OPENAI_AGENTS_FRAMEWORK_VERSION}.`,
        ],
      };
    }
    return { status: "ok", messages };
  }

  activeRunCount(): number {
    return this.activeCaptures;
  }
}

export function createOpenAIAgentsAdapter(): OpenAIAgentsAdapter {
  return new OpenAIAgentsAdapter();
}
