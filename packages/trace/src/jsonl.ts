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

export function serializeTrace(events: readonly TraceEvent[]): string {
  if (events.length > MAX_TRACE_EVENTS) {
    throw new Error(`Trace exceeds ${MAX_TRACE_EVENTS} events`);
  }
  validateTrace(events);
  if (containsLikelySecret(events)) {
    throw new Error("Trace contains credential-shaped material and cannot be persisted");
  }
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
