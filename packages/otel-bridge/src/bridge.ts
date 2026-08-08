import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import { lstat, readFile, stat } from "node:fs/promises";
import { closeSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { z } from "zod";
import {
  BoundarySchema,
  createV1Event,
  EventClassSchema,
  type EventEnvelopeV1,
  EventEnvelopeV1Schema,
  EventKindSchema,
  PhaseSchema,
  SafetyClassSchema,
  validateV1Event,
  safeOutputPath,
} from "@resilireplay/core";

export const OTEL_BRIDGE_SCHEMA = "resilireplay.otel-bridge/v1.0.0" as const;
export const DEFAULT_MAX_REQUEST_BYTES = 1_048_576;
export const DEFAULT_MAX_EVENTS = 5_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 3_000;
export const DEFAULT_HTTP_ROUTE = "/v1/bridge/events";

type Boundary = z.infer<typeof BoundarySchema>;
type EventKind = z.infer<typeof EventKindSchema>;
type EventClass = z.infer<typeof EventClassSchema>;
type Phase = z.infer<typeof PhaseSchema>;

type OtlpAttribute = { key: string; value?: { [name: string]: unknown } };
type OtlpEvent = { name?: string; timeUnixNano?: string; attributes?: OtlpAttribute[] };
type OtlpSpan = {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  attributes?: OtlpAttribute[] | { [key: string]: unknown };
  events?: OtlpEvent[];
};
type OtlpScopeSpan = { spans?: OtlpSpan[] };
type OtlpResourceSpan = {
  scopeSpans?: OtlpScopeSpan[];
  resource?: { attributes?: OtlpAttribute[] };
};
type OtlpPayload = { resourceSpans?: OtlpResourceSpan[] };

const BOUNDARY_BY_PREFIX: Record<string, Boundary> = {
  run: "framework",
  agent: "framework",
  turn: "framework",
  model: "model",
  tool: "tool",
  stream: "stream",
  handoff: "framework",
  guardrail: "framework",
  checkpoint: "checkpoint",
  state: "state",
  interrupt: "framework",
  recovery: "framework",
  custom: "unknown",
  side_effect: "side_effect",
};

const EVENT_CLASS_BY_KIND: Record<EventKind, EventClass> = {
  "run.start": "run",
  "run.end": "run",
  "run.error": "run",
  "agent.start": "agent",
  "agent.end": "agent",
  "agent.error": "agent",
  "turn.start": "turn",
  "turn.end": "turn",
  "model.request": "model",
  "model.response": "model",
  "model.error": "model",
  "model.retry": "model",
  "tool.start": "tool",
  "tool.result": "tool",
  "tool.error": "tool",
  "tool.timeout": "tool",
  "tool.cancelled": "tool",
  "tool.retry": "tool",
  "stream.chunk": "stream",
  "stream.truncated": "stream",
  "stream.completed": "stream",
  "stream.cancelled": "stream",
  "stream.outOfOrder": "stream",
  "stream.duplicate": "stream",
  "stream.missing": "stream",
  "handoff.requested": "handoff",
  "handoff.accepted": "handoff",
  "handoff.rejected": "handoff",
  "handoff.failed": "handoff",
  "handoff.completed": "handoff",
  "guardrail.start": "guardrail",
  "guardrail.pass": "guardrail",
  "guardrail.fail": "guardrail",
  "guardrail.error": "guardrail",
  "checkpoint.write": "checkpoint",
  "checkpoint.read": "checkpoint",
  "checkpoint.resume": "checkpoint",
  interrupt: "interrupt",
  resume: "state",
  "partial.completion": "tool",
  "state.read": "state",
  "state.write": "state",
  "state.update": "state",
  "state.rollback": "state",
  "recovery.decision": "retry",
  "recovery.result": "retry",
  custom: "custom",
};

const PHASE_BY_KIND: Record<EventKind, Phase> = {
  "run.start": "start",
  "run.end": "succeeded",
  "run.error": "error",
  "agent.start": "start",
  "agent.end": "succeeded",
  "agent.error": "error",
  "turn.start": "start",
  "turn.end": "succeeded",
  "model.request": "running",
  "model.response": "succeeded",
  "model.error": "error",
  "model.retry": "retry",
  "tool.start": "running",
  "tool.result": "succeeded",
  "tool.error": "error",
  "tool.timeout": "error",
  "tool.cancelled": "cancelled",
  "tool.retry": "retry",
  "stream.chunk": "running",
  "stream.truncated": "error",
  "stream.completed": "succeeded",
  "stream.cancelled": "cancelled",
  "stream.outOfOrder": "error",
  "stream.duplicate": "error",
  "stream.missing": "error",
  "handoff.requested": "running",
  "handoff.accepted": "succeeded",
  "handoff.rejected": "error",
  "handoff.failed": "error",
  "handoff.completed": "succeeded",
  "guardrail.start": "running",
  "guardrail.pass": "succeeded",
  "guardrail.fail": "error",
  "guardrail.error": "error",
  "checkpoint.write": "running",
  "checkpoint.read": "running",
  "checkpoint.resume": "running",
  "state.read": "running",
  "state.write": "running",
  "state.update": "running",
  "state.rollback": "running",
  interrupt: "running",
  resume: "running",
  "partial.completion": "succeeded",
  "recovery.decision": "running",
  "recovery.result": "succeeded",
  custom: "running",
};

const EVENT_KIND_ALIAS: Record<string, EventKind> = {
  run_started: "run.start",
  run_completed: "run.end",
  run_failed: "run.error",
  agent_started: "agent.start",
  agent_ended: "agent.end",
  agent_error: "agent.error",
  turn_started: "turn.start",
  turn_ended: "turn.end",
  model_request: "model.request",
  model_response: "model.response",
  model_error: "model.error",
  tool_result: "tool.result",
  tool_start: "tool.start",
  tool_error: "tool.error",
  tool_timeout: "tool.timeout",
  tool_cancelled: "tool.cancelled",
  tool_retry: "tool.retry",
  stream_chunk: "stream.chunk",
  stream_truncated: "stream.truncated",
  stream_completed: "stream.completed",
  stream_cancelled: "stream.cancelled",
  handoff_requested: "handoff.requested",
  handoff_accepted: "handoff.accepted",
  handoff_rejected: "handoff.rejected",
  handoff_failed: "handoff.failed",
  handoff_completed: "handoff.completed",
  guardrail_start: "guardrail.start",
  guardrail_pass: "guardrail.pass",
  guardrail_fail: "guardrail.fail",
  guardrail_error: "guardrail.error",
  checkpoint_write: "checkpoint.write",
  checkpoint_read: "checkpoint.read",
  checkpoint_resume: "checkpoint.resume",
  state_read: "state.read",
  state_write: "state.write",
  state_update: "state.update",
  state_rollback: "state.rollback",
  recovery_decision: "recovery.decision",
  recovery_result: "recovery.result",
  stream_outOfOrder: "stream.outOfOrder",
  stream_duplicate: "stream.duplicate",
  stream_missing: "stream.missing",
  partial_completion: "partial.completion",
  interrupt: "interrupt",
  resume: "resume",
  custom: "custom",
};

const SENSITIVE_KEY =
  /(api[_-]?key|authorization|auth[_-]?token|token|secret|password|private[_-]?key|credential|cookie)/iu;
const SENSITIVE_VALUE = /(sk-[A-Za-z0-9]{6,}|gh_[A-Za-z0-9_]{10,}|(?:^|\\s)secret(?:\\s|$))/iu;
const MAX_PATH_ATTEMPT = 8;

export interface BridgeContext {
  framework: string;
  frameworkVersion: string;
  adapter: string;
  adapterVersion: string;
  runId: string;
  traceId?: string;
  actorId?: string;
  wallClock?: string;
  deterministicSeed?: number;
}

export interface ParseInput {
  raw: string;
  context: BridgeContext;
}

export interface BridgeLimits {
  maxBytes?: number;
  maxEvents?: number;
}

export interface BridgeIngestResult {
  events: EventEnvelopeV1[];
  dropped: number;
  malformed: number;
  source: "jsonl" | "otlp-json";
  warnings: string[];
}

export interface HttpIngestOptions {
  port: number;
  host?: string;
  route?: string;
  loopbackOnly?: boolean;
  allowedOrigins?: string[];
  maxBytes?: number;
  maxEvents?: number;
  requestTimeoutMs?: number;
}

export interface HttpIngestResult {
  events: EventEnvelopeV1[];
  receivedBytes: number;
}

export interface OtelBridgeServer {
  url: string;
  close(): Promise<void>;
}

const BridgeContextSchema = z.object({
  framework: z.string().min(1),
  frameworkVersion: z.string().min(1),
  adapter: z.string().min(1),
  adapterVersion: z.string().min(1),
  runId: z.string().min(1),
  traceId: z.string().min(1).optional(),
  actorId: z.string().min(1).optional(),
  wallClock: z.string().datetime({ offset: true }).optional(),
  deterministicSeed: z.number().int().optional(),
});

const OtlpSpanSchema = z
  .object({
    traceId: z.string().optional(),
    spanId: z.string().min(1).optional(),
    parentSpanId: z.string().min(1).optional(),
    name: z.string().optional(),
    attributes: z.unknown().optional(),
    events: z.array(z.unknown()).default([]),
  })
  .strict();

function hashValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sanitizeValue(value: unknown, keyHint?: string): unknown {
  if (typeof value === "string") {
    if (keyHint !== undefined && SENSITIVE_KEY.test(keyHint)) return "[redacted]";
    if (SENSITIVE_VALUE.test(value)) return "[redacted]";
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry));
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        sanitizeValue(child, key),
      ]),
    );
  }
  return value;
}

function normalizedPayloadForKindHint(value?: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[:\s]+/g, ".")
    .replace(/[_-]+/g, ".");
}

function inferEventKindFromValue(value?: unknown): EventKind {
  const normalized = normalizedPayloadForKindHint(value);
  if (normalized.length === 0) return "custom";
  const alias = EVENT_KIND_ALIAS[normalized.replace(/^rr\./u, "")];
  if (alias !== undefined) return alias;
  const parsed = EventKindSchema.safeParse(normalized);
  if (parsed.success) return parsed.data;
  const fallbackPatterns: Array<[RegExp, EventKind]> = [
    [/^run\./u, "run.start"],
    [/^model\./u, "model.request"],
    [/^tool\./u, "tool.result"],
    [/^stream\./u, "stream.chunk"],
    [/^handoff\./u, "handoff.requested"],
    [/^guardrail\./u, "guardrail.start"],
    [/^checkpoint\./u, "checkpoint.write"],
    [/^turn\./u, "turn.start"],
    [/^agent\./u, "agent.start"],
    [/^state\./u, "state.update"],
  ];
  const matched = fallbackPatterns.find(([pattern]) => pattern.test(normalized));
  if (matched?.[0].source.includes("run")) return "run.start";
  if (matched) return matched[1];
  if (normalized.includes("completion")) return "partial.completion";
  return "custom";
}

function mapBoundary(eventKind: EventKind): Boundary {
  const boundaryParts = eventKind.split(".");
  const boundaryKey = boundaryParts[0] ?? "custom";
  return BOUNDARY_BY_PREFIX[boundaryKey] ?? "unknown";
}

function mapPhase(eventKind: EventKind): Phase {
  return PHASE_BY_KIND[eventKind];
}

function mapEventClass(eventKind: EventKind): EventClass {
  return EVENT_CLASS_BY_KIND[eventKind];
}

function resolveInputPath(baseDirectory: string, candidate: string): string {
  return isAbsolute(candidate) ? resolve(candidate) : safeOutputPath(baseDirectory, candidate);
}

async function assertNoSymlinkInPath(baseDirectory: string, candidate: string): Promise<void> {
  const base = resolve(baseDirectory);
  const target = resolve(candidate);
  const relationship = relative(base, target);
  if (relationship === "" || target === base) return;
  if (relationship === ".." || relationship.startsWith(`..${sep}`)) {
    throw new Error(`Path outside base directory: ${candidate}`);
  }
  let current = target;
  let attempts = 0;
  while (current !== base && attempts < MAX_PATH_ATTEMPT) {
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`Symbolic link blocked: ${current}`);
    const next = dirname(current);
    if (next === current) break;
    current = next;
    attempts += 1;
  }
  const info = await lstat(target);
  if (info.isSymbolicLink()) throw new Error(`Symbolic link blocked: ${target}`);
}

function parseOtlpValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw !== "object") return raw;
  const value = raw as Record<string, unknown>;
  if (typeof value.stringValue === "string") return value.stringValue;
  if (typeof value.boolValue === "boolean") return value.boolValue;
  if (typeof value.doubleValue === "number") return value.doubleValue;
  if (typeof value.intValue === "string" || typeof value.intValue === "number")
    return Number(value.intValue);
  if (typeof value.bytesValue === "string") return value.bytesValue;
  if (
    value.arrayValue &&
    typeof value.arrayValue === "object" &&
    Array.isArray((value.arrayValue as { values?: unknown[] }).values)
  )
    return (value.arrayValue as { values?: unknown[] }).values;
  if (
    value.kvListValue &&
    typeof value.kvListValue === "object" &&
    Array.isArray((value.kvListValue as { values?: unknown[] }).values)
  )
    return (value.kvListValue as { values?: unknown[] }).values;
  return raw;
}

function attributesToRecord(source: unknown): Record<string, unknown> {
  if (Array.isArray(source)) {
    const entries = source.filter((entry): entry is OtlpAttribute => {
      return (
        entry !== null &&
        typeof entry === "object" &&
        typeof (entry as OtlpAttribute).key === "string"
      );
    });
    return Object.fromEntries(entries.map((entry) => [entry.key, parseOtlpValue(entry.value)]));
  }
  if (source && typeof source === "object") {
    return source as Record<string, unknown>;
  }
  return {};
}

export function asV1Event(
  source: Record<string, unknown>,
  context: BridgeContext,
  sequence: number,
): EventEnvelopeV1 {
  const maybeV1 = source as unknown as Partial<EventEnvelopeV1>;
  if (
    maybeV1.schemaVersion === "1.0.0" &&
    typeof maybeV1.payloadDigest === "string" &&
    maybeV1.eventId !== undefined
  ) {
    return validateV1Event(EventEnvelopeV1Schema.parse(maybeV1));
  }

  const eventKind = inferEventKindFromValue(
    (source.eventKind as string | undefined) ??
      (source.kind as string | undefined) ??
      (source.operation as string | undefined),
  );
  const boundary = mapBoundary(eventKind);
  const phase = mapPhase(eventKind);
  const eventClass = mapEventClass(eventKind);
  const payload = sanitizeValue(source.payload ?? source);
  const redaction = {
    strategy: "redacted" as const,
    fieldsRemoved: ["payload.api_key", "payload.secret", "payload.authorization"],
    fieldsMasked: [],
    version: "1",
  };

  const turnId = typeof source.turnId === "string" ? source.turnId : `${context.runId}-${sequence}`;
  const actorId =
    typeof source.actorId === "string" ? source.actorId : (context.actorId ?? "otel-bridge");
  const operation =
    typeof source.operation === "string" && source.operation.length > 0
      ? source.operation
      : eventKind;

  return createV1Event({
    runId: context.runId,
    traceId:
      typeof source.traceId === "string"
        ? source.traceId
        : (context.traceId ?? `${context.runId}-trace`),
    spanId:
      typeof source.spanId === "string"
        ? source.spanId
        : typeof source.span_id === "string"
          ? source.span_id
          : randomUUID(),
    parentSpanId: typeof source.parentSpanId === "string" ? source.parentSpanId : undefined,
    sequence,
    turnId,
    actorId,
    framework: context.framework,
    frameworkVersion: context.frameworkVersion,
    adapter: context.adapter,
    adapterVersion: context.adapterVersion,
    operation,
    boundary,
    phase,
    eventKind,
    attempt: typeof source.attempt === "number" ? Math.max(0, Math.trunc(source.attempt)) : 0,
    eventClass,
    safetyClass: SafetyClassSchema.parse(
      typeof source.safetyClass === "string" &&
        ["safe", "unsafe", "unknown"].includes(source.safetyClass)
        ? source.safetyClass
        : "unknown",
    ),
    payload,
    redaction,
    metadata: {
      source: "otel-bridge",
      sourceDigest: hashValue(payload),
      sourceKind: typeof source.sourceKind === "string" ? source.sourceKind : "generic",
      ...(typeof source.metadata === "object" && source.metadata !== null ? source.metadata : {}),
    },
    deterministicSeed: context.deterministicSeed,
    causeId: typeof source.causeId === "string" ? source.causeId : undefined,
    parentEventId: typeof source.parentEventId === "string" ? source.parentEventId : undefined,
    sideEffect:
      typeof source.sideEffect === "object" && source.sideEffect !== null
        ? (source.sideEffect as EventEnvelopeV1["sideEffect"])
        : undefined,
  });
}

export function parseJsonlBridgeEvents(
  input: ParseInput,
  limits?: BridgeLimits,
): BridgeIngestResult {
  BridgeContextSchema.parse(input.context);
  const maxBytes = limits?.maxBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const maxEvents = limits?.maxEvents ?? DEFAULT_MAX_EVENTS;
  if (Buffer.byteLength(input.raw, "utf8") > maxBytes) throw new Error("Input exceeds byte limit");

  const lines = input.raw.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length > maxEvents) throw new Error("Input exceeds event limit");

  const events: EventEnvelopeV1[] = [];
  const warnings: string[] = [];
  let malformed = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(line) as Record<string, unknown>;
    } catch (error) {
      malformed += 1;
      warnings.push(`Skipping malformed JSONL line ${index + 1}: ${(error as Error).message}`);
      continue;
    }
    try {
      events.push(asV1Event(payload, input.context, index));
    } catch (error) {
      malformed += 1;
      warnings.push(`Skipping invalid bridge event line ${index + 1}: ${(error as Error).message}`);
    }
  }

  return {
    events,
    dropped: lines.length - events.length,
    malformed,
    source: "jsonl",
    warnings,
  };
}

export function parseOtlpJsonBridgeEvents(
  input: ParseInput,
  limits?: BridgeLimits,
): BridgeIngestResult {
  BridgeContextSchema.parse(input.context);
  const maxBytes = limits?.maxBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const maxEvents = limits?.maxEvents ?? DEFAULT_MAX_EVENTS;
  if (Buffer.byteLength(input.raw, "utf8") > maxBytes) throw new Error("Input exceeds byte limit");

  const parsed = JSON.parse(input.raw) as OtlpPayload;
  const warnings: string[] = [];
  const events: EventEnvelopeV1[] = [];
  let malformed = 0;
  let dropped = 0;

  const resourceSpans = Array.isArray(parsed.resourceSpans) ? parsed.resourceSpans : [];
  for (const resourceSpan of resourceSpans) {
    if (resourceSpan === null || typeof resourceSpan !== "object") {
      malformed += 1;
      warnings.push("Skipping malformed resource span entry.");
      continue;
    }
    for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
      if (scopeSpan === null || typeof scopeSpan !== "object") {
        malformed += 1;
        warnings.push("Skipping malformed scope span entry.");
        continue;
      }
      const spans = Array.isArray(scopeSpan.spans) ? scopeSpan.spans : [];
      for (const candidateSpan of spans) {
        const spanParse = OtlpSpanSchema.safeParse(candidateSpan);
        if (!spanParse.success) {
          malformed += 1;
          warnings.push("Skipping malformed span.");
          continue;
        }
        const span = spanParse.data;
        const spanAttributes = attributesToRecord(span.attributes);
        const spanEvents = Array.isArray(span.events) ? span.events : [];
        if (spanEvents.length === 0) {
          dropped += 1;
          continue;
        }
        for (const eventEntry of spanEvents) {
          if (eventEntry === null || typeof eventEntry !== "object") {
            malformed += 1;
            warnings.push("Skipping malformed span event.");
            continue;
          }
          const entry = eventEntry as OtlpEvent;
          const entryAttributes = attributesToRecord(entry.attributes);
          const eventKind = inferEventKindFromValue(
            typeof entryAttributes.eventKind === "string"
              ? (entryAttributes.eventKind as string)
              : (entry.name ?? span.name),
          );
          const sourcePayload = {
            sourceKind: "otlp",
            eventKind,
            payload: {
              sourceSpan: {
                traceId: span.traceId,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId,
                name: span.name,
                attributes: spanAttributes,
              },
              event: entry,
              eventAttributes: entryAttributes,
            },
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            traceId: span.traceId,
            turnId: `${entry.timeUnixNano ?? "0"}`,
            actorId:
              typeof entryAttributes.actorId === "string"
                ? entryAttributes.actorId
                : input.context.actorId,
          } as Record<string, unknown>;
          try {
            events.push(asV1Event(sourcePayload, input.context, events.length));
          } catch (error) {
            malformed += 1;
            warnings.push(`Skipping invalid OTLP span event: ${(error as Error).message}`);
          }
        }
      }
    }
  }

  if (events.length > maxEvents) throw new Error("Input exceeds event limit");
  return {
    events,
    dropped,
    malformed,
    source: "otlp-json",
    warnings,
  };
}

function isLoopbackAddress(value: string): boolean {
  return value === "::1" || value === "127.0.0.1" || value.startsWith("::ffff:127.");
}

function hostFromHeader(hostHeader: string | undefined): string | undefined {
  if (hostHeader === undefined) return undefined;
  return hostHeader.split(":")[0];
}

function isAllowedHost(hostHeader: string | undefined): boolean {
  const host = hostFromHeader(hostHeader);
  if (host === undefined) return false;
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function checkHostAndOrigin(
  request: IncomingMessage,
  options: { loopbackOnly?: boolean; allowedOrigins?: string[] },
): void {
  if (options.loopbackOnly ?? true) {
    const remoteAddress = request.socket.remoteAddress ?? "unknown";
    if (!isLoopbackAddress(remoteAddress) && !isAllowedHost(request.headers.host)) {
      throw new Error(`Non-loopback host: ${remoteAddress}`);
    }
  }
  if (options.allowedOrigins !== undefined && options.allowedOrigins.length > 0) {
    const origin = request.headers.origin;
    if (typeof origin !== "string") throw new Error("Missing Origin");
    if (!options.allowedOrigins.includes(origin)) throw new Error(`Origin not allowed: ${origin}`);
  }
}

export function detectPayloadKind(raw: string): "jsonl" | "otlp-json" {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "jsonl";
  if (!trimmed.startsWith("{")) return "jsonl";
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return parsed && typeof parsed === "object" && Array.isArray(parsed.resourceSpans)
      ? "otlp-json"
      : "jsonl";
  } catch {
    return "jsonl";
  }
}

export async function loadEventsFromJsonlFile(
  path: string,
  context: BridgeContext,
  limits?: BridgeLimits,
): Promise<BridgeIngestResult> {
  const bounded = resolveInputPath(process.cwd(), path);
  const symlinkBoundary = isAbsolute(path) ? parse(bounded).root : process.cwd();
  await assertNoSymlinkInPath(symlinkBoundary, bounded);
  const info = await stat(bounded);
  if (!info.isFile()) throw new Error(`Not a file: ${bounded}`);
  const raw = await readFile(bounded, "utf8");
  const result = parseJsonlBridgeEvents({ raw, context }, limits);
  const maxBytes = limits?.maxBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  if (raw.length > maxBytes) throw new Error("Input exceeds byte limit");
  return result;
}

export async function loadEventsFromStdin(
  context: BridgeContext,
  stdin: NodeJS.ReadableStream = process.stdin,
  limits?: BridgeLimits,
): Promise<BridgeIngestResult> {
  let receivedBytes = 0;
  const maxBytes = limits?.maxBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const chunks: Uint8Array[] = [];

  return new Promise<BridgeIngestResult>((resolve, reject) => {
    const stream = stdin as NodeJS.ReadableStream;
    stream.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maxBytes) {
        reject(new Error("Input exceeds byte limit"));
        stream.removeAllListeners();
      } else {
        chunks.push(chunk);
      }
    });
    stream.once("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(parseJsonlBridgeEvents({ raw, context }, limits));
      } catch (error) {
        reject(error);
      }
    });
    stream.once("error", reject);
  });
}

export async function startOtelBridgeServer(
  context: BridgeContext,
  options: HttpIngestOptions,
  onEvents?: (result: HttpIngestResult) => void | Promise<void>,
): Promise<OtelBridgeServer> {
  BridgeContextSchema.parse(context);
  const host = options.host ?? "127.0.0.1";
  const route = options.route ?? DEFAULT_HTTP_ROUTE;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  const server: Server = createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      if (request.method !== "POST") {
        response.writeHead(405, { "Content-Type": "text/plain" });
        response.end("Method not allowed");
        return;
      }
      if ((request.url ?? "") !== route) {
        response.writeHead(404, { "Content-Type": "text/plain" });
        response.end("Not found");
        return;
      }

      try {
        const bridgeChecks: { loopbackOnly?: boolean; allowedOrigins?: string[] } = {
          loopbackOnly: options.loopbackOnly ?? true,
        };
        if (options.allowedOrigins !== undefined) {
          bridgeChecks.allowedOrigins = options.allowedOrigins;
        }
        checkHostAndOrigin(request, bridgeChecks);
      } catch (error) {
        response.writeHead(403, { "Content-Type": "text/plain" });
        response.end((error as Error).message);
        return;
      }

      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      let timedOut = false;
      request.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > maxBytes) {
          response.writeHead(413, { "Content-Type": "text/plain" });
          response.end("Payload too large");
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });

      request.setTimeout(requestTimeoutMs, () => {
        timedOut = true;
        response.writeHead(408, { "Content-Type": "text/plain" });
        response.end("Request timeout");
        request.destroy();
      });

      request.once("end", async () => {
        if (timedOut) return;
        try {
          const raw = Buffer.concat(chunks).toString("utf8");
          const payloadKind = detectPayloadKind(raw);
          const result =
            payloadKind === "otlp-json"
              ? parseOtlpJsonBridgeEvents({ raw, context }, { maxBytes, maxEvents })
              : parseJsonlBridgeEvents({ raw, context }, { maxBytes, maxEvents });
          if (onEvents) await onEvents({ events: result.events, receivedBytes });
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              source: result.source,
              events: result.events.length,
              dropped: result.dropped,
              malformed: result.malformed,
              warnings: result.warnings,
            }),
          );
        } catch (error) {
          response.writeHead(400, { "Content-Type": "text/plain" });
          response.end((error as Error).message);
        }
      });

      request.once("error", () => {
        response.writeHead(400, { "Content-Type": "text/plain" });
        response.end("Bad request");
      });
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.listen(options.port, host, (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  const address = server.address();
  const actualPort = address === null || typeof address === "string" ? options.port : address.port;

  return {
    url: `http://${host}:${actualPort}${route}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export function createTempFileForIngestion(prefix = "resilireplay-bridge-"): string {
  const filename = `${tmpdir()}/${prefix}${randomUUID()}.jsonl`;
  const handle = openSync(filename, "wx");
  closeSync(handle);
  return filename;
}
