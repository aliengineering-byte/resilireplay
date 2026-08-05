import { createHash } from "node:crypto";
import { stableStringify } from "@resilireplay/core";
import {
  AGENT_EVENT_SCHEMA,
  AgentEventSchema,
  AgentSourceSchema,
  type AgentEvent,
  type AgentSource,
} from "./schemas.js";

const SECRET =
  /(?:bearer\s+[a-z0-9._~+/=-]+|basic\s+[a-z0-9+/=]+|(?:gh[pousr]|sk)(?:-|%2d)[a-z0-9_-]{12,}|AKIA[A-Z0-9]{16}|base64:[a-z0-9+/]{20,}={0,2}|(?:api[-_]?key|token|secret|password|authorization)\s*[=:]\s*(?:bearer\s+|basic\s+)?[^\s,;]+)/giu;
const PATH = /(?:[A-Za-z]:\\|\\\\|\/(?:Users|home|root|tmp)\/)[^\s"']+/gu;
const CONTROL = /\p{Cc}/gu;

export const MAX_HOOK_BYTES = 1_048_576;
export const MAX_EVENT_BYTES = 32_768;
export const MAX_EVENTS = 20_000;

export function hashValue(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function boundedSummary(value: unknown, limit = 512): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = (typeof value === "string" ? value : stableStringify(value))
    .replace(SECRET, "[REDACTED]")
    .replace(PATH, "[PATH]")
    .replace(CONTROL, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!text) return undefined;
  return text.slice(0, limit);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(Math.trunc(value), 86_400_000)
    : undefined;
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function classify(
  message: string | undefined,
  outcome: AgentEvent["outcome"],
): NonNullable<AgentEvent["errorClass"]> {
  if (outcome === "succeeded") return "none";
  if (outcome === "interrupted") return "interrupted";
  const value = message?.toLowerCase() ?? "";
  if (/timed?\s*out|timeout/u.test(value)) return "timeout";
  if (/permission|denied|forbidden|unauthorized/u.test(value)) return "permission";
  if (/not found|enoent|unknown tool/u.test(value)) return "not-found";
  if (/schema|invalid|validation/u.test(value)) return "validation";
  if (/json-rpc|mcp|protocol/u.test(value)) return "protocol";
  if (/exit(?:ed)? (?:code|status)|non-zero/u.test(value)) return "process-exit";
  return "unknown";
}

function codexOutcome(response: Record<string, unknown>): AgentEvent["outcome"] {
  if (response.cancelled === true || response.interrupted === true) return "interrupted";
  if (response.isError === true || response.success === false) return "failed";
  if (response.isError === false || response.success === true) return "succeeded";
  const exitCode = response.exit_code ?? response.exitCode ?? response.code;
  if (typeof exitCode === "number") return exitCode === 0 ? "succeeded" : "failed";
  const status = text(response.status)?.toLowerCase();
  if (status && ["error", "failed", "failure"].includes(status)) return "failed";
  if (status && ["success", "succeeded", "completed"].includes(status)) return "succeeded";
  return "unknown";
}

export interface NormalizeOptions {
  source: AgentSource;
  receivedAt?: string;
}

export function normalizeHookEvent(
  input: unknown,
  options: NormalizeOptions,
): AgentEvent | undefined {
  AgentSourceSchema.parse(options.source);
  const root = record(input);
  if (options.source === "codex" && (root.hosted === true || root.tool_kind === "hosted")) {
    return undefined;
  }
  const hook = text(root.hook_event_name) ?? text(root.event) ?? "PostToolUse";
  const lowerHook = hook.toLowerCase();
  const isEnd =
    lowerHook.includes("stop") ||
    lowerHook.includes("sessionend") ||
    lowerHook.includes("session_end");
  const eventType: AgentEvent["eventType"] = isEnd
    ? lowerHook.includes("session")
      ? "session-end"
      : "turn-end"
    : "tool-result";
  if (eventType === "tool-result" && !lowerHook.includes("tool") && options.source === "codex") {
    return undefined;
  }
  const response = record(root.tool_response ?? root.toolResponse ?? root.response);
  const error = root.error ?? response.error ?? response.stderr ?? response.message;
  const failureHook = lowerHook.includes("failure") || lowerHook.includes("failed");
  const outcome = isEnd
    ? "unknown"
    : failureHook
      ? root.is_interrupt === true
        ? "interrupted"
        : "failed"
      : options.source === "claude-code" && lowerHook === "posttooluse"
        ? "succeeded"
        : codexOutcome(response);
  const sessionRaw = text(root.session_id) ?? text(root.sessionId) ?? "session-local";
  const toolCallRaw = text(root.tool_use_id) ?? text(root.toolUseId) ?? text(root.tool_call_id);
  const parentRaw = text(root.parent_id) ?? text(root.parentId);
  const toolInput = root.tool_input ?? root.toolInput;
  const summary = boundedSummary(error ?? (outcome === "failed" ? response : undefined));
  const base = {
    schemaVersion: AGENT_EVENT_SCHEMA,
    source: options.source,
    sessionId: hashValue([options.source, sessionRaw]),
    eventType,
    outcome,
    capturedAt:
      options.receivedAt ??
      timestamp(root.timestamp ?? root.captured_at ?? root.capturedAt) ??
      new Date().toISOString(),
    ...(text(root.tool_name ?? root.toolName)
      ? { toolName: boundedSummary(root.tool_name ?? root.toolName)! }
      : {}),
    ...(toolCallRaw ? { toolCallId: hashValue([options.source, sessionRaw, toolCallRaw]) } : {}),
    ...(parentRaw ? { parentId: hashValue([options.source, sessionRaw, parentRaw]) } : {}),
    ...(number(root.duration_ms ?? root.durationMs) !== undefined
      ? { durationMs: number(root.duration_ms ?? root.durationMs)! }
      : {}),
    errorClass: classify(summary, outcome),
    ...(toolInput !== undefined ? { inputSha256: hashValue(toolInput) } : {}),
    ...(Object.keys(response).length > 0 ? { outputSha256: hashValue(response) } : {}),
    ...(summary ? { summary } : {}),
  };
  return AgentEventSchema.parse({ ...base, eventId: hashValue(base) });
}
