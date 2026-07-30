import { readFile, writeFile } from "node:fs/promises";
import { stableStringify, validateEvent, validateTrace, type TraceEvent } from "@resilireplay/core";

export function serializeTrace(events: readonly TraceEvent[]): string {
  validateTrace(events);
  return `${events.map((event) => stableStringify(event)).join("\n")}\n`;
}

export function parseTrace(content: string): TraceEvent[] {
  const values = content
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
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
  return parseTrace(await readFile(path, "utf8"));
}

export async function writeTrace(path: string, events: readonly TraceEvent[]): Promise<void> {
  await writeFile(path, serializeTrace(events), "utf8");
}
