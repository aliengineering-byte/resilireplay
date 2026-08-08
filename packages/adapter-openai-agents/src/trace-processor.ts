import type { TracingProcessor } from "@openai/agents";
import type { EventEnvelopeV1 } from "@resilireplay/core";
import { OpenAIAgentsEventRecorder, type OpenAIAgentsRunContext } from "./recorder.js";

export class OpenAIAgentsTraceProcessor implements TracingProcessor {
  private readonly recorder: OpenAIAgentsEventRecorder;

  constructor(context: OpenAIAgentsRunContext) {
    this.recorder = new OpenAIAgentsEventRecorder(context);
  }

  get events(): readonly EventEnvelopeV1[] {
    return this.recorder.events;
  }

  async onTraceStart(trace: Parameters<TracingProcessor["onTraceStart"]>[0]): Promise<void> {
    this.recorder.emit({
      kind: "run.start",
      spanId: trace.traceId,
      payload: { sdkTraceId: trace.traceId, workflowName: trace.name, groupId: trace.groupId },
      metadata: { source: "sdk-tracing-processor" },
    });
  }

  async onTraceEnd(trace: Parameters<TracingProcessor["onTraceEnd"]>[0]): Promise<void> {
    this.recorder.emit({
      kind: "run.end",
      spanId: trace.traceId,
      payload: { sdkTraceId: trace.traceId },
      metadata: { source: "sdk-tracing-processor" },
    });
  }

  async onSpanStart(span: Parameters<TracingProcessor["onSpanStart"]>[0]): Promise<void> {
    this.recorder.emit({
      kind: "custom",
      spanId: span.spanId,
      ...(span.parentId === null ? {} : { parentSpanId: span.parentId }),
      actorId: span.spanData.type,
      payload: { sdkSpanId: span.spanId, sdkSpanType: span.spanData.type, lifecycle: "start" },
      metadata: { source: "sdk-tracing-processor" },
    });
  }

  async onSpanEnd(span: Parameters<TracingProcessor["onSpanEnd"]>[0]): Promise<void> {
    this.recorder.emit({
      kind: span.error === null ? "custom" : "agent.error",
      spanId: span.spanId,
      ...(span.parentId === null ? {} : { parentSpanId: span.parentId }),
      actorId: span.spanData.type,
      payload: {
        sdkSpanId: span.spanId,
        sdkSpanType: span.spanData.type,
        lifecycle: "end",
        error: span.error?.message,
      },
      metadata: { source: "sdk-tracing-processor" },
    });
  }

  async shutdown(): Promise<void> {}

  async forceFlush(): Promise<void> {}
}
