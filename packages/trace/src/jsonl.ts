import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  containsLikelySecret,
  prepareContainedOutputFile,
  stableStringify,
  validateEvent,
  validateTrace,
  type TraceEvent,
} from "@resilireplay/core";

export const MAX_TRACE_BYTES = 32 * 1024 * 1024;
export const MAX_TRACE_EVENTS = 100_000;
export const MAX_TRACE_NESTING_DEPTH = 64;

export class TraceInputError extends Error {
  readonly code:
    | "RR_TRACE_BYTE_LIMIT"
    | "RR_TRACE_EVENT_LIMIT"
    | "RR_TRACE_NESTING_LIMIT"
    | "RR_TRACE_INVALID_JSONL";

  constructor(code: TraceInputError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TraceInputError";
    this.code = code;
  }
}

function nestingDepth(value: unknown): number {
  if (value === null || typeof value !== "object") return 0;
  let maximum = 0;
  const pending: Array<{ value: object; depth: number }> = [{ value, depth: 1 }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    maximum = Math.max(maximum, current.depth);
    if (maximum > MAX_TRACE_NESTING_DEPTH) return maximum;
    for (const child of Array.isArray(current.value)
      ? current.value
      : Object.values(current.value)) {
      if (child !== null && typeof child === "object") {
        pending.push({ value: child as object, depth: current.depth + 1 });
      }
    }
  }
  return maximum;
}

export function serializeTrace(events: readonly TraceEvent[]): string {
  if (events.length > MAX_TRACE_EVENTS) {
    throw new TraceInputError("RR_TRACE_EVENT_LIMIT", `Trace exceeds ${MAX_TRACE_EVENTS} events`);
  }
  for (const [index, event] of events.entries()) {
    if (nestingDepth(event) > MAX_TRACE_NESTING_DEPTH) {
      throw new TraceInputError(
        "RR_TRACE_NESTING_LIMIT",
        `Trace exceeds nesting depth ${MAX_TRACE_NESTING_DEPTH} at event ${index + 1}`,
      );
    }
  }
  validateTrace(events);
  if (containsLikelySecret(events)) {
    throw new Error("Trace contains credential-shaped material and cannot be persisted");
  }
  return `${events.map((event) => stableStringify(event)).join("\n")}\n`;
}

export function parseTrace(content: string): TraceEvent[] {
  if (Buffer.byteLength(content, "utf8") > MAX_TRACE_BYTES) {
    throw new TraceInputError("RR_TRACE_BYTE_LIMIT", `Trace exceeds ${MAX_TRACE_BYTES} bytes`);
  }
  const lines = content.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length > MAX_TRACE_EVENTS) {
    throw new TraceInputError("RR_TRACE_EVENT_LIMIT", `Trace exceeds ${MAX_TRACE_EVENTS} events`);
  }
  const values = lines
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch (error) {
        throw new TraceInputError(
          "RR_TRACE_INVALID_JSONL",
          `Invalid JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    })
    .map((value, index) => {
      if (nestingDepth(value) > MAX_TRACE_NESTING_DEPTH) {
        throw new TraceInputError(
          "RR_TRACE_NESTING_LIMIT",
          `Trace exceeds nesting depth ${MAX_TRACE_NESTING_DEPTH} at line ${index + 1}`,
        );
      }
      return value;
    })
    .map(validateEvent);
  return validateTrace(values);
}

export async function readTrace(path: string): Promise<TraceEvent[]> {
  const information = await stat(path);
  if (information.size > MAX_TRACE_BYTES) {
    throw new TraceInputError("RR_TRACE_BYTE_LIMIT", `Trace exceeds ${MAX_TRACE_BYTES} bytes`);
  }
  return parseTrace(await readFile(path, "utf8"));
}

export interface WriteTraceOptions {
  allowedRoot?: string;
  overwrite?: boolean;
}

export async function writeTrace(
  path: string,
  events: readonly TraceEvent[],
  options: WriteTraceOptions = {},
): Promise<void> {
  const output = resolve(path);
  const allowedRoot = resolve(options.allowedRoot ?? dirname(output));
  await prepareContainedOutputFile(allowedRoot, output);
  await writeFile(output, serializeTrace(events), {
    encoding: "utf8",
    flag: options.overwrite === false ? "wx" : "w",
    flush: true,
  });
}
