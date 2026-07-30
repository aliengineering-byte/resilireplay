import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { calculateMetrics } from "@resilireplay/core";
import { writeReportBundle } from "@resilireplay/reporters";
import { readTrace } from "@resilireplay/trace";

export async function runAction(
  traceInput = process.env.INPUT_TRACE ?? "runs/latest/trace.jsonl",
  reportDirectoryInput = process.env.INPUT_REPORT_DIRECTORY ?? "resilireplay-report",
): Promise<void> {
  const events = await readTrace(resolve(traceInput));
  const metrics = calculateMetrics(events);
  await writeReportBundle(events, resolve(reportDirectoryInput));
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    await appendFile(
      output,
      `passed=${String(metrics.passed)}\nscore=${metrics.deterministicScore}\n`,
      "utf8",
    );
  }
  if (!metrics.passed) process.exitCode = 1;
}

if (process.env.GITHUB_ACTIONS === "true") {
  runAction().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
