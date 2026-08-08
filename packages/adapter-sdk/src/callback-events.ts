import { createV1Event, type EventEnvelopeV1, type EventKind } from "@resilireplay/core";
import { z } from "zod";

export const DocumentedCallbackFrameworkSchema = z.enum(["crewai", "llamaindex"]);
export type DocumentedCallbackFramework = z.infer<typeof DocumentedCallbackFrameworkSchema>;

export const DocumentedCallbackEventSchema = z
  .object({
    eventName: z.string().min(1).max(256),
    eventId: z.string().min(1).max(512),
    parentSpanId: z.string().min(1).max(512).optional(),
    actorId: z.string().min(1).max(512),
    payload: z.unknown().default({}),
    wallClock: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type DocumentedCallbackEvent = z.infer<typeof DocumentedCallbackEventSchema>;

export const DocumentedCallbackContextSchema = z
  .object({
    framework: DocumentedCallbackFrameworkSchema,
    frameworkVersion: z.string().min(1),
    runId: z.string().min(1),
    traceId: z.string().min(1),
    turnId: z.string().min(1),
    sequence: z.number().int().nonnegative(),
  })
  .strict();
export type DocumentedCallbackContext = z.infer<typeof DocumentedCallbackContextSchema>;

const crewAIEvents: Readonly<Record<string, EventKind>> = {
  CrewKickoffStartedEvent: "run.start",
  CrewKickoffCompletedEvent: "run.end",
  CrewKickoffFailedEvent: "run.error",
  AgentExecutionStartedEvent: "agent.start",
  AgentExecutionCompletedEvent: "agent.end",
  AgentExecutionErrorEvent: "agent.error",
  ToolUsageStartedEvent: "tool.start",
  ToolUsageFinishedEvent: "tool.result",
  ToolUsageErrorEvent: "tool.error",
  ToolExecutionErrorEvent: "tool.error",
};

const llamaIndexEvents: Readonly<Record<string, EventKind>> = {
  LLMChatStartEvent: "model.request",
  LLMChatInProgressEvent: "stream.chunk",
  LLMChatEndEvent: "model.response",
  span_enter: "agent.start",
  span_exit: "agent.end",
  span_drop: "agent.error",
};

function eventKind(framework: DocumentedCallbackFramework, name: string): EventKind {
  return (framework === "crewai" ? crewAIEvents[name] : llamaIndexEvents[name]) ?? "custom";
}

function eventClass(kind: EventKind): EventEnvelopeV1["eventClass"] {
  if (kind.startsWith("run.")) return "run";
  if (kind.startsWith("agent.")) return "agent";
  if (kind.startsWith("model.")) return "model";
  if (kind.startsWith("tool.")) return "tool";
  if (kind.startsWith("stream.")) return "stream";
  return "custom";
}

function boundary(kind: EventKind): EventEnvelopeV1["boundary"] {
  if (kind.startsWith("model.")) return "model";
  if (kind.startsWith("tool.")) return "tool";
  if (kind.startsWith("stream.")) return "stream";
  return "framework";
}

function phase(kind: EventKind): EventEnvelopeV1["phase"] {
  if (kind.endsWith(".start") || kind === "model.request") return "start";
  if (kind.endsWith(".error")) return "error";
  if (kind === "stream.chunk") return "running";
  return kind === "custom" ? "unknown" : "succeeded";
}

export function documentedCallbackEventNames(framework: DocumentedCallbackFramework): string[] {
  return Object.keys(framework === "crewai" ? crewAIEvents : llamaIndexEvents).sort();
}

export function normalizeDocumentedCallbackEvent(
  input: DocumentedCallbackEvent,
  context: DocumentedCallbackContext,
): EventEnvelopeV1 {
  const parsedInput = DocumentedCallbackEventSchema.parse(input);
  const parsedContext = DocumentedCallbackContextSchema.parse(context);
  const kind = eventKind(parsedContext.framework, parsedInput.eventName);
  return createV1Event({
    eventId: parsedInput.eventId,
    runId: parsedContext.runId,
    traceId: parsedContext.traceId,
    spanId: parsedInput.eventId,
    ...(parsedInput.parentSpanId === undefined ? {} : { parentSpanId: parsedInput.parentSpanId }),
    sequence: parsedContext.sequence,
    turnId: parsedContext.turnId,
    actorId: parsedInput.actorId,
    framework: parsedContext.framework,
    frameworkVersion: parsedContext.frameworkVersion,
    adapter: "@resilireplay/adapter-sdk/documented-callback",
    adapterVersion: "0.6.0",
    operation: parsedInput.eventName,
    boundary: boundary(kind),
    phase: phase(kind),
    eventKind: kind,
    attempt: 0,
    eventClass: eventClass(kind),
    safetyClass: "unknown",
    payload: parsedInput.payload,
    metadata: {
      evidenceClass: "DOCUMENTED_ONLY",
      sourceEventName: parsedInput.eventName,
      mapped: kind !== "custom",
    },
    redaction: {
      strategy: "redacted",
      fieldsRemoved: ["authorization", "apiKey", "token", "secret"],
      fieldsMasked: [],
    },
    ...(parsedInput.wallClock === undefined ? {} : { wallClock: parsedInput.wallClock }),
  });
}
