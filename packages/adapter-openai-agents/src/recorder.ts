import { createV1Event, type EventEnvelopeV1, type EventKind } from "@resilireplay/core";
import {
  OPENAI_AGENTS_ADAPTER_NAME,
  OPENAI_AGENTS_ADAPTER_VERSION,
  OPENAI_AGENTS_FRAMEWORK_VERSION,
  type EvidenceClass,
} from "./manifest.js";

export interface OpenAIAgentsRunContext {
  runId: string;
  traceId: string;
  turnId: string;
  actorId?: string;
  evidenceClass?: EvidenceClass;
  deterministicSeed?: number;
}

interface EmitOptions {
  kind: EventKind;
  actorId?: string;
  spanId?: string;
  parentSpanId?: string;
  attempt?: number;
  payload?: unknown;
  metadata?: Record<string, unknown>;
}

function eventClass(kind: EventKind): EventEnvelopeV1["eventClass"] {
  if (kind.startsWith("run.")) return "run";
  if (kind.startsWith("agent.")) return "agent";
  if (kind.startsWith("turn.")) return "turn";
  if (kind.startsWith("model.")) return kind === "model.retry" ? "retry" : "model";
  if (kind.startsWith("tool.")) return "tool";
  if (kind.startsWith("stream.")) return "stream";
  if (kind.startsWith("handoff.")) return "handoff";
  if (kind.startsWith("guardrail.")) return "guardrail";
  return "custom";
}

function boundary(kind: EventKind): EventEnvelopeV1["boundary"] {
  if (kind.startsWith("model.")) return "model";
  if (kind.startsWith("tool.")) return "tool";
  if (kind.startsWith("stream.")) return "stream";
  return "framework";
}

function phase(kind: EventKind): EventEnvelopeV1["phase"] {
  if (kind.endsWith(".start") || kind === "model.request" || kind === "handoff.requested") {
    return "start";
  }
  if (kind.endsWith(".error") || kind.endsWith(".failed") || kind === "guardrail.fail") {
    return "error";
  }
  if (kind.endsWith(".cancelled")) return "cancelled";
  if (kind.endsWith(".retry")) return "retry";
  if (
    kind.endsWith(".end") ||
    kind.endsWith(".result") ||
    kind.endsWith(".response") ||
    kind.endsWith(".completed") ||
    kind.endsWith(".accepted") ||
    kind === "guardrail.pass"
  ) {
    return "succeeded";
  }
  return "running";
}

export class OpenAIAgentsEventRecorder {
  readonly events: EventEnvelopeV1[] = [];
  private sequence = 0;
  private currentTurnId: string;
  private currentActorId: string;

  constructor(readonly context: OpenAIAgentsRunContext) {
    this.currentTurnId = context.turnId;
    this.currentActorId = context.actorId ?? "openai-agents-runtime";
  }

  beginTurn(index: number): string {
    this.currentTurnId = `${this.context.turnId}/${index}`;
    return this.currentTurnId;
  }

  setActor(actorId: string): void {
    this.currentActorId = actorId;
  }

  emit(options: EmitOptions): EventEnvelopeV1 {
    const sequence = this.sequence++;
    const event = createV1Event({
      eventId: `${this.context.runId}/${sequence}/${options.kind}`,
      runId: this.context.runId,
      traceId: this.context.traceId,
      spanId: options.spanId ?? `${this.context.traceId}/${options.kind}/${sequence}`,
      ...(options.parentSpanId === undefined ? {} : { parentSpanId: options.parentSpanId }),
      sequence,
      turnId: this.currentTurnId,
      actorId: options.actorId ?? this.currentActorId,
      framework: "openai-agents",
      frameworkVersion: OPENAI_AGENTS_FRAMEWORK_VERSION,
      adapter: OPENAI_AGENTS_ADAPTER_NAME,
      adapterVersion: OPENAI_AGENTS_ADAPTER_VERSION,
      operation: options.kind,
      boundary: boundary(options.kind),
      phase: phase(options.kind),
      eventKind: options.kind,
      attempt: options.attempt ?? 0,
      eventClass: eventClass(options.kind),
      safetyClass: options.kind === "guardrail.fail" ? "unsafe" : "unknown",
      payload: options.payload ?? {},
      metadata: {
        evidenceClass: this.context.evidenceClass ?? "GENUINE_RUNTIME",
        ...(options.metadata ?? {}),
      },
      redaction: {
        strategy: "redacted",
        fieldsRemoved: ["apiKey", "authorization", "token", "secret"],
        fieldsMasked: [],
      },
      ...(this.context.deterministicSeed === undefined
        ? {}
        : { deterministicSeed: this.context.deterministicSeed }),
    });
    this.events.push(event);
    return event;
  }
}
