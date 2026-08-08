import {
  sanitize,
  containsLikelySecret,
  createV1Event,
  type EventEnvelopeV1,
} from "@resilireplay/core";
import type { ProtocolEvent } from "@langchain/langgraph";
import {
  LANGGRAPH_ADAPTER_NAME,
  LANGGRAPH_ADAPTER_VERSION,
  LANGGRAPH_FRAMEWORK_VERSION,
  type EvidenceClass,
} from "./manifest.js";

export interface LangGraphRunContext {
  runId: string;
  traceId: string;
  turnId: string;
  actorId: string;
  evidenceClass: EvidenceClass;
  sequence?: number;
  attempt?: number;
}

interface NormalizationState {
  lastRawSequence?: number;
  lastEventId?: string;
  nextSequence: number;
}

interface Classification {
  eventKind: EventEnvelopeV1["eventKind"];
  eventClass: EventEnvelopeV1["eventClass"];
  boundary: EventEnvelopeV1["boundary"];
  phase: EventEnvelopeV1["phase"];
  safetyClass: EventEnvelopeV1["safetyClass"];
  malformedResult?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function safeString(value: unknown): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (value === undefined || value === null) return "unknown";
  return JSON.stringify(sanitize(value));
}

function dataEvent(data: Record<string, unknown>): string {
  return typeof data.event === "string" ? data.event.toLowerCase() : "";
}

function includesTimeout(value: unknown): boolean {
  const text = safeString(value).toLowerCase();
  return text.includes("timeout") || text.includes("timed out");
}

function classifyLifecycle(data: Record<string, unknown>, nested: boolean): Classification {
  const event = dataEvent(data);
  if (event === "completed") {
    return {
      eventKind: nested ? "agent.end" : "run.end",
      eventClass: nested ? "agent" : "run",
      boundary: "framework",
      phase: "succeeded",
      safetyClass: "safe",
    };
  }
  if (event === "failed") {
    return {
      eventKind: nested ? "agent.error" : "run.error",
      eventClass: nested ? "agent" : "run",
      boundary: "framework",
      phase: "error",
      safetyClass: "unknown",
    };
  }
  if (event === "interrupted") {
    return {
      eventKind: "interrupt",
      eventClass: "interrupt",
      boundary: "checkpoint",
      phase: "abort",
      safetyClass: "safe",
    };
  }
  return {
    eventKind: nested ? "agent.start" : "run.start",
    eventClass: nested ? "agent" : "run",
    boundary: "framework",
    phase: event === "started" ? "start" : "running",
    safetyClass: "safe",
  };
}

function classifyTool(data: Record<string, unknown>): Classification {
  const event = dataEvent(data);
  if (event === "tool-started") {
    return {
      eventKind: "tool.start",
      eventClass: "tool",
      boundary: "tool",
      phase: "start",
      safetyClass: "unknown",
    };
  }
  if (event === "tool-finished") {
    const malformedResult = !hasOwn(data, "output");
    return {
      eventKind: malformedResult ? "tool.error" : "tool.result",
      eventClass: "tool",
      boundary: "tool",
      phase: malformedResult ? "error" : "succeeded",
      safetyClass: "unknown",
      malformedResult,
    };
  }
  if (event === "tool-error") {
    const timeout = includesTimeout(data.message) || includesTimeout(data.code);
    return {
      eventKind: timeout ? "tool.timeout" : "tool.error",
      eventClass: "tool",
      boundary: "tool",
      phase: "error",
      safetyClass: "unknown",
    };
  }
  if (event === "tool-output-delta") {
    return {
      eventKind: "stream.chunk",
      eventClass: "stream",
      boundary: "tool",
      phase: "running",
      safetyClass: "safe",
    };
  }
  return {
    eventKind: "custom",
    eventClass: "custom",
    boundary: "tool",
    phase: "unknown",
    safetyClass: "unknown",
  };
}

function classifyMessage(data: Record<string, unknown>): Classification {
  const event = dataEvent(data);
  if (event === "message-start") {
    return {
      eventKind: "model.request",
      eventClass: "model",
      boundary: "model",
      phase: "start",
      safetyClass: "safe",
    };
  }
  if (event === "message-finish") {
    return {
      eventKind: "model.response",
      eventClass: "model",
      boundary: "model",
      phase: "succeeded",
      safetyClass: "safe",
    };
  }
  if (event === "error") {
    return {
      eventKind: "model.error",
      eventClass: "model",
      boundary: "model",
      phase: "error",
      safetyClass: "unknown",
    };
  }
  return {
    eventKind: "stream.chunk",
    eventClass: "stream",
    boundary: "stream",
    phase: "running",
    safetyClass: "safe",
  };
}

function classifyTask(data: Record<string, unknown>): Classification {
  if (hasOwn(data, "error")) {
    return {
      eventKind: "agent.error",
      eventClass: "agent",
      boundary: "framework",
      phase: "error",
      safetyClass: "unknown",
    };
  }
  if (hasOwn(data, "result")) {
    return {
      eventKind: "agent.end",
      eventClass: "agent",
      boundary: "framework",
      phase: "succeeded",
      safetyClass: "safe",
    };
  }
  return {
    eventKind: "agent.start",
    eventClass: "agent",
    boundary: "framework",
    phase: "start",
    safetyClass: "safe",
  };
}

function classify(event: ProtocolEvent): Classification {
  const data = isRecord(event.params.data) ? event.params.data : {};
  const nested = event.params.namespace.length > 0;
  if (event.method === "lifecycle") return classifyLifecycle(data, nested);
  if (event.method === "tools") return classifyTool(data);
  if (event.method === "messages") return classifyMessage(data);
  if (event.method === "tasks") return classifyTask(data);
  if (event.method === "checkpoints") {
    return {
      eventKind: "checkpoint.write",
      eventClass: "checkpoint",
      boundary: "checkpoint",
      phase: "succeeded",
      safetyClass: "safe",
    };
  }
  if (event.method === "values") {
    return {
      eventKind: "state.read",
      eventClass: "state",
      boundary: "state",
      phase: "succeeded",
      safetyClass: "safe",
    };
  }
  if (event.method === "updates") {
    const interrupted =
      event.params.node === "__interrupt__" ||
      (isRecord(event.params.data) && hasOwn(event.params.data, "__interrupt__"));
    return {
      eventKind: interrupted ? "interrupt" : "state.update",
      eventClass: interrupted ? "interrupt" : "state",
      boundary: interrupted ? "checkpoint" : "state",
      phase: interrupted ? "abort" : "running",
      safetyClass: "safe",
    };
  }
  if (event.method === "input" || event.method === "input.requested") {
    return {
      eventKind: "interrupt",
      eventClass: "interrupt",
      boundary: "checkpoint",
      phase: "abort",
      safetyClass: "safe",
    };
  }
  return {
    eventKind: "stream.chunk",
    eventClass: "stream",
    boundary: "stream",
    phase: "running",
    safetyClass: "safe",
  };
}

function namespaceKey(event: ProtocolEvent): string {
  return event.params.namespace.length === 0 ? "root" : event.params.namespace.join("/");
}

function eventActor(event: ProtocolEvent, context: LangGraphRunContext): string {
  const data = isRecord(event.params.data) ? event.params.data : {};
  if (event.method === "tools") {
    const callId = data.tool_call_id;
    if (typeof callId === "string" && callId.length > 0) return `tool:${callId}`;
  }
  if (typeof event.params.node === "string" && event.params.node.length > 0)
    return event.params.node;
  if (event.params.namespace.length > 0) return namespaceKey(event);
  return context.actorId;
}

function eventOperation(event: ProtocolEvent): string {
  const data = isRecord(event.params.data) ? event.params.data : {};
  const named = data.tool_name ?? data.name ?? event.params.node;
  return named === undefined ? event.method : `${event.method}:${safeString(named)}`;
}

function eventWallClock(event: ProtocolEvent): string | undefined {
  if (!Number.isFinite(event.params.timestamp)) return undefined;
  const wallClock = new Date(event.params.timestamp).toISOString();
  return Number.isNaN(Date.parse(wallClock)) ? undefined : wallClock;
}

function parentSpanId(event: ProtocolEvent, context: LangGraphRunContext): string | undefined {
  if (event.params.namespace.length === 0) return undefined;
  const parent = event.params.namespace.slice(0, -1);
  return `${context.runId}:${parent.length === 0 ? "root" : parent.join("/")}`;
}

function redactionFor(value: unknown): EventEnvelopeV1["redaction"] {
  return containsLikelySecret(value)
    ? { strategy: "redacted", fieldsRemoved: ["payload"], fieldsMasked: [], version: "1" }
    : { strategy: "none", fieldsRemoved: [], fieldsMasked: [], version: "1" };
}

export class LangGraphProtocolNormalizer {
  private readonly stateByRun = new Map<string, NormalizationState>();

  detect(raw: unknown): raw is ProtocolEvent {
    if (!isRecord(raw) || raw.type !== "event") return false;
    if (!Number.isInteger(raw.seq) || (raw.seq as number) < 0) return false;
    if (typeof raw.method !== "string" || raw.method.length === 0) return false;
    if (!isRecord(raw.params)) return false;
    if (!Array.isArray(raw.params.namespace)) return false;
    if (!raw.params.namespace.every((part) => typeof part === "string")) return false;
    if (typeof raw.params.timestamp !== "number" || !Number.isFinite(raw.params.timestamp))
      return false;
    return hasOwn(raw.params, "data");
  }

  normalize(raw: unknown, context: LangGraphRunContext): EventEnvelopeV1 {
    return this.normalizeMany([raw], context).at(-1)!;
  }

  normalizeMany(rawEvents: readonly unknown[], context: LangGraphRunContext): EventEnvelopeV1[] {
    const state = this.getState(context);
    const normalized: EventEnvelopeV1[] = [];
    for (const raw of rawEvents) {
      if (!this.detect(raw)) throw new Error("Input is not a LangGraph v3 protocol event");
      if (state.lastRawSequence !== undefined) {
        if (raw.seq === state.lastRawSequence) {
          normalized.push(
            this.sequenceEvidence("stream.duplicate", raw, context, state, { observed: raw.seq }),
          );
        } else if (raw.seq < state.lastRawSequence) {
          normalized.push(
            this.sequenceEvidence("stream.outOfOrder", raw, context, state, {
              observed: raw.seq,
              expectedAfter: state.lastRawSequence,
            }),
          );
        } else if (raw.seq > state.lastRawSequence + 1) {
          normalized.push(
            this.sequenceEvidence("stream.missing", raw, context, state, {
              firstMissing: state.lastRawSequence + 1,
              lastMissing: raw.seq - 1,
            }),
          );
        }
      }
      const event = this.normalizeProtocolEvent(raw, context, state);
      normalized.push(event);
      state.lastRawSequence = Math.max(state.lastRawSequence ?? raw.seq, raw.seq);
      state.lastEventId = event.eventId;
    }
    return normalized;
  }

  clear(): void {
    this.stateByRun.clear();
  }

  activeRunCount(): number {
    return this.stateByRun.size;
  }

  private getState(context: LangGraphRunContext): NormalizationState {
    const key = `${context.runId}:${context.turnId}`;
    const existing = this.stateByRun.get(key);
    if (existing !== undefined) return existing;
    const created = { nextSequence: context.sequence ?? 0 };
    this.stateByRun.set(key, created);
    return created;
  }

  private normalizeProtocolEvent(
    event: ProtocolEvent,
    context: LangGraphRunContext,
    state: NormalizationState,
  ): EventEnvelopeV1 {
    const shape = classify(event);
    const sequence = state.nextSequence++;
    const spanId = `${context.runId}:${namespaceKey(event)}`;
    const parentSpan = parentSpanId(event, context);
    const data = isRecord(event.params.data) ? event.params.data : {};
    const wallClock = eventWallClock(event);
    const payload = {
      protocolSequence: event.seq,
      protocolMethod: event.method,
      namespace: event.params.namespace,
      node: event.params.node,
      data: event.params.data,
      malformedResult: shape.malformedResult ?? false,
    };
    return createV1Event({
      eventId: `${context.runId}/${sequence}/${shape.eventKind}`,
      runId: context.runId,
      traceId: context.traceId,
      spanId,
      ...(parentSpan === undefined ? {} : { parentSpanId: parentSpan }),
      sequence,
      turnId: context.turnId,
      actorId: safeString(sanitize(eventActor(event, context))),
      framework: "langgraph",
      frameworkVersion: LANGGRAPH_FRAMEWORK_VERSION,
      adapter: LANGGRAPH_ADAPTER_NAME,
      adapterVersion: LANGGRAPH_ADAPTER_VERSION,
      operation: safeString(sanitize(eventOperation(event))),
      boundary: shape.boundary,
      phase: shape.phase,
      eventKind: shape.eventKind,
      attempt: context.attempt ?? 0,
      eventClass: shape.eventClass,
      safetyClass: shape.safetyClass,
      payload,
      redaction: redactionFor(payload),
      metadata: {
        evidenceClass: context.evidenceClass,
        protocolEvent: dataEvent(data),
        protocolNamespace: namespaceKey(event),
      },
      ...(wallClock === undefined ? {} : { wallClock }),
      ...(state.lastEventId === undefined ? {} : { parentEventId: state.lastEventId }),
    });
  }

  private sequenceEvidence(
    eventKind: "stream.duplicate" | "stream.outOfOrder" | "stream.missing",
    raw: ProtocolEvent,
    context: LangGraphRunContext,
    state: NormalizationState,
    details: Record<string, unknown>,
  ): EventEnvelopeV1 {
    const sequence = state.nextSequence++;
    const spanId = `${context.runId}:${namespaceKey(raw)}`;
    const event = createV1Event({
      eventId: `${context.runId}/${sequence}/${eventKind}`,
      runId: context.runId,
      traceId: context.traceId,
      spanId,
      sequence,
      turnId: context.turnId,
      actorId: context.actorId,
      framework: "langgraph",
      frameworkVersion: LANGGRAPH_FRAMEWORK_VERSION,
      adapter: LANGGRAPH_ADAPTER_NAME,
      adapterVersion: LANGGRAPH_ADAPTER_VERSION,
      operation: "protocol-sequence",
      boundary: "stream",
      phase: "error",
      eventKind,
      attempt: context.attempt ?? 0,
      eventClass: "stream",
      safetyClass: "safe",
      payload: { protocolSequence: raw.seq, details },
      metadata: { evidenceClass: context.evidenceClass },
      ...(state.lastEventId === undefined ? {} : { parentEventId: state.lastEventId }),
    });
    state.lastEventId = event.eventId;
    return event;
  }
}
