import { spawn, spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createEvent,
  prepareContainedOutputFile,
  sanitize,
  type EventType,
  type TraceEvent,
} from "@resilireplay/core";
import { writeTrace } from "@resilireplay/trace";

interface InlineEvent {
  type: EventType;
  actor?: string;
  tool?: string;
  model?: string;
  parentId?: string;
  causeId?: string;
  metadata?: Record<string, unknown>;
  payload?: unknown;
}

async function terminateProcessTree(child: ReturnType<typeof spawn>): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

export async function recordCommand(
  command: string[],
  outputPath: string,
  timeoutMs: number,
  allowedRoot: string = dirname(outputPath),
): Promise<{ events: TraceEvent[]; exitCode: number }> {
  if (command.length === 0) throw new Error("A command is required after --");
  await prepareContainedOutputFile(allowedRoot, outputPath);
  const runId = randomUUID();
  const events: TraceEvent[] = [
    createEvent({
      runId,
      sequence: 0,
      type: "run_started",
      actor: "recorded-command",
      payload: { executable: command[0], arguments: command.slice(1), telemetry: false },
    }),
  ];
  const executable = command[0];
  if (!executable) throw new Error("Recorded executable cannot be empty");
  const child = spawn(executable, command.slice(1), {
    cwd: process.cwd(),
    env: { ...process.env, RESILIREPLAY_RUN_ID: runId },
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
    process.stdout.write(chunk);
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
    process.stderr.write(chunk);
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void terminateProcessTree(child);
  }, timeoutMs);
  timer.unref();
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  }).finally(() => clearTimeout(timer));

  for (const line of stdout.split(/\r?\n/u)) {
    if (!line.startsWith("RESILIREPLAY_EVENT ")) continue;
    try {
      const inline = JSON.parse(line.slice("RESILIREPLAY_EVENT ".length)) as InlineEvent;
      events.push(
        createEvent({
          runId,
          sequence: events.length,
          type: inline.type,
          actor: inline.actor ?? "recorded-agent",
          ...(inline.tool ? { tool: inline.tool } : {}),
          ...(inline.model ? { model: inline.model } : {}),
          ...(inline.parentId ? { parentId: inline.parentId } : {}),
          ...(inline.causeId ? { causeId: inline.causeId } : {}),
          metadata: inline.metadata ?? {},
          payload: inline.payload ?? {},
        }),
      );
    } catch {
      events.push(
        createEvent({
          runId,
          sequence: events.length,
          type: "validation_result",
          actor: "resilireplay-recorder",
          payload: { valid: false, reason: "Malformed RESILIREPLAY_EVENT line" },
        }),
      );
    }
  }

  events.push(
    createEvent({
      runId,
      sequence: events.length,
      type: "model_response",
      actor: "recorded-command",
      payload: {
        stdout: sanitize(stdout.slice(0, 1_000_000)),
        stderr: sanitize(stderr.slice(0, 1_000_000)),
        truncated: stdout.length > 1_000_000 || stderr.length > 1_000_000,
      },
    }),
    createEvent({
      runId,
      sequence: events.length + 1,
      type: exitCode === 0 && !timedOut ? "run_completed" : "run_failed",
      actor: "recorded-command",
      payload: { exitCode, timedOut, timeoutMs },
    }),
  );
  await writeTrace(outputPath, events, { allowedRoot });
  return { events, exitCode };
}
