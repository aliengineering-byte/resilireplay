import {
  createV1Event,
  hashValue,
  stableStringify,
  validateV1Event,
  type EventEnvelopeV1,
} from "@resilireplay/core";
import type { ProtocolEvent } from "@langchain/langgraph";
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
  LANGGRAPH_ADAPTER_NAME,
  LANGGRAPH_FRAMEWORK_VERSION,
  LANGGRAPH_MANIFEST,
  langGraphCapabilities,
  langGraphFaultBoundaries,
} from "./manifest.js";
import { LangGraphProtocolNormalizer, type LangGraphRunContext } from "./normalizer.js";

export interface LangGraphCaptureResult {
  events: EventEnvelopeV1[];
  error?: Error;
}

export interface LangGraphFrameworkContext extends FrameworkDetectionContext {
  protocolEvents: AsyncIterable<ProtocolEvent> | Promise<AsyncIterable<ProtocolEvent>>;
  run: LangGraphRunContext;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function recreateEvent(
  event: EventEnvelopeV1,
  overrides: Partial<
    Pick<
      EventEnvelopeV1,
      "eventKind" | "eventClass" | "boundary" | "phase" | "safetyClass" | "payload" | "metadata"
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
    safetyClass: overrides.safetyClass ?? event.safetyClass,
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

function injectedKind(faultType: string): EventEnvelopeV1["eventKind"] | undefined {
  if (faultType === "tool-error") return "tool.error";
  if (faultType === "timeout" || faultType === "tool-timeout") return "tool.timeout";
  if (faultType === "malformed-result") return "tool.error";
  if (faultType === "partial-completion") return "partial.completion";
  if (faultType === "stream-corruption") return "stream.outOfOrder";
  if (faultType === "duplicated-call") return "stream.duplicate";
  if (faultType === "handoff-failure") return "handoff.failed";
  return undefined;
}

function eventClassFor(kind: EventEnvelopeV1["eventKind"]): EventEnvelopeV1["eventClass"] {
  if (kind.startsWith("tool.")) return "tool";
  if (kind.startsWith("stream.")) return "stream";
  if (kind.startsWith("handoff.")) return "handoff";
  if (kind === "partial.completion") return "recovery";
  return "custom";
}

function boundaryFor(kind: EventEnvelopeV1["eventKind"]): EventEnvelopeV1["boundary"] {
  if (kind.startsWith("tool.")) return "tool";
  if (kind.startsWith("stream.")) return "stream";
  return "framework";
}

export class LangGraphAdapter implements FrameworkAdapter {
  readonly manifest = LANGGRAPH_MANIFEST;
  private readonly normalizer = new LangGraphProtocolNormalizer();

  detect(context: FrameworkDetectionContext): DetectResult | undefined {
    const candidates = [context.frameworkHint, context.packageName, context.command]
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.toLowerCase());
    const matched = candidates.some(
      (entry) => entry.includes("langgraph") || entry.includes("@langchain/langgraph"),
    );
    if (!matched) return undefined;
    return {
      framework: "langgraph",
      ...(context.version === undefined ? {} : { frameworkVersion: context.version }),
      confidence: context.packageName?.toLowerCase() === "@langchain/langgraph" ? "high" : "medium",
      evidence: candidates,
      reason: "Detected a LangGraph package, framework hint, or command token.",
    };
  }

  capabilities() {
    return langGraphCapabilities();
  }

  faultBoundaries() {
    return langGraphFaultBoundaries();
  }

  normalize(raw: unknown, context: LangGraphRunContext): EventEnvelopeV1 {
    return this.normalizer.normalize(raw, context);
  }

  normalizeMany(rawEvents: readonly unknown[], context: LangGraphRunContext): EventEnvelopeV1[] {
    return this.normalizer.normalizeMany(rawEvents, context);
  }

  async captureProtocolStream(
    protocolEvents: AsyncIterable<ProtocolEvent> | Promise<AsyncIterable<ProtocolEvent>>,
    context: LangGraphRunContext,
    hooks?: AdapterHooks,
  ): Promise<LangGraphCaptureResult> {
    const events: EventEnvelopeV1[] = [];
    try {
      const stream = await protocolEvents;
      for await (const raw of stream) {
        const normalized = this.normalizer.normalizeMany([raw], context);
        for (const event of normalized) {
          events.push(event);
          if (event.eventKind === "run.start") await hooks?.onRunStart?.(event);
          await hooks?.onEvent?.(event);
        }
      }
      return { events };
    } catch (cause) {
      const error = asError(cause);
      await hooks?.onError?.(error);
      return { events, error };
    }
  }

  async captureEvents(
    context: FrameworkDetectionContext,
    hooks?: AdapterHooks,
  ): Promise<EventEnvelopeV1[]> {
    const candidate = context as FrameworkDetectionContext & Partial<LangGraphFrameworkContext>;
    if (candidate.protocolEvents === undefined || candidate.run === undefined) {
      throw new Error(
        `${LANGGRAPH_ADAPTER_NAME} captureEvents requires protocolEvents and run context; use captureProtocolStream for typed capture.`,
      );
    }
    const capture = await this.captureProtocolStream(
      candidate.protocolEvents,
      candidate.run,
      hooks,
    );
    if (capture.error !== undefined) throw capture.error;
    return capture.events;
  }

  async injectFaults(
    sourceEvents: readonly EventEnvelopeV1[],
    request: FaultInjectionRequest,
  ): Promise<FaultInjectionResult> {
    const events = sourceEvents.map((event) => validateV1Event(event));
    const kind = injectedKind(request.faultType);
    if (kind === undefined) {
      return {
        events,
        injected: 0,
        skipped: [`Unsupported LangGraph fault type: ${request.faultType}`],
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
        eventClass: eventClassFor(kind),
        boundary: boundaryFor(kind),
        phase: kind === "partial.completion" ? "abort" : "error",
        safetyClass: "unknown",
        payload: {
          source: event.payload,
          injectedFault: request.faultType,
          parameters: request.parameters ?? {},
          seed: request.seed,
        },
        metadata: { ...event.metadata, injectedBy: LANGGRAPH_ADAPTER_NAME },
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
    const critical = events.find(
      (event) =>
        event.phase === "error" ||
        event.phase === "abort" ||
        event.eventKind === "partial.completion",
    );
    return {
      scenario: {
        schemaVersion: "1.0",
        adapter: LANGGRAPH_ADAPTER_NAME,
        frameworkVersion: LANGGRAPH_FRAMEWORK_VERSION,
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
    this.normalizer.clear();
  }

  async doctor(
    context: FrameworkDetectionContext = { rootDirectory: process.cwd() },
  ): Promise<HealthStatus> {
    const messages = [
      `Adapter manifest valid for @langchain/langgraph${this.manifest.frameworkVersionRange}.`,
      "Capture is local and does not require a model provider or API key.",
    ];
    if (context.version !== undefined && context.version !== LANGGRAPH_FRAMEWORK_VERSION) {
      return {
        status: "degraded",
        messages: [
          ...messages,
          `Requested version ${context.version} differs from verified version ${LANGGRAPH_FRAMEWORK_VERSION}.`,
        ],
      };
    }
    return { status: "ok", messages };
  }

  activeRunCount(): number {
    return this.normalizer.activeRunCount();
  }
}

export function createLangGraphAdapter(): LangGraphAdapter {
  return new LangGraphAdapter();
}
