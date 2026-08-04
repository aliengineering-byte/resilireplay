import { readFile, stat, writeFile } from "node:fs/promises";
import { stableStringify, validateEvent, validateTrace, type TraceEvent } from "@resilireplay/core";

export const MAX_TRACE_BYTES = 32 * 1024 * 1024;
export const MAX_TRACE_EVENTS = 100_000;

export function serializeTrace(events: readonly TraceEvent[]): string {
  if (events.length > MAX_TRACE_EVENTS) {
    throw new Error(`Trace exceeds ${MAX_TRACE_EVENTS} events`);
  }
  validateTrace(events);
  return `${events.map((event) => stableStringify(event)).join("\n")}\n`;
}

export function parseTrace(content: string): TraceEvent[] {
  if (Buffer.byteLength(content, "utf8") > MAX_TRACE_BYTES) {
    throw new Error(`Trace exceeds ${MAX_TRACE_BYTES} bytes`);
  }
  const lines = content.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length > MAX_TRACE_EVENTS) {
    throw new Error(`Trace exceeds ${MAX_TRACE_EVENTS} events`);
  }
  const values = lines
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch (error) {
        throw new Error(
          `Invalid JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })
    .map(validateEvent);
  return validateTrace(values);
}

export async function readTrace(path: string): Promise<TraceEvent[]> {
  const information = await stat(path);
  if (information.size > MAX_TRACE_BYTES) {
    throw new Error(`Trace exceeds ${MAX_TRACE_BYTES} bytes`);
  }
  return parseTrace(await readFile(path, "utf8"));
}

export async function writeTrace(path: string, events: readonly TraceEvent[]): Promise<void> {
  await writeFile(path, serializeTrace(events), "utf8");
}
