import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stableStringify } from "@resilireplay/core";
import { atomicWritePublic } from "./internal-write.js";
import { MAX_EVENTS, MAX_EVENT_BYTES, hashValue } from "./normalize.js";
import {
  CAPTURE_SESSION_SCHEMA,
  CaptureSessionSchema,
  FAILURE_EVIDENCE_SCHEMA,
  FailureEvidenceSchema,
  AgentEventSchema,
  type AgentEvent,
  type CaptureSession,
  type FailureEvidence,
} from "./schemas.js";

const STORE = ".resilireplay/capture";

function inside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

async function rejectSymlinkComponents(root: string, candidate: string): Promise<void> {
  if (!inside(root, candidate)) throw new Error("Capture path escaped its repository root");
  const segments = relative(root, candidate).split(/[\\/]/u).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error("Symlinked capture paths are not allowed");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

function paths(rootInput: string) {
  const root = resolve(rootInput);
  const directory = resolve(root, STORE);
  if (!inside(root, directory)) throw new Error("Invalid capture directory");
  return {
    root,
    directory,
    session: resolve(directory, "session.json"),
    journal: resolve(directory, "events.jsonl"),
    evidence: resolve(directory, "last-failure.json"),
    recent: resolve(directory, "recent.json"),
    seen: resolve(directory, ".seen"),
    lock: resolve(directory, ".lock"),
  };
}

async function atomicWrite(path: string, data: string): Promise<void> {
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporary, data, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST" && error.code !== "EPERM") throw error;
    await rm(path, { force: true });
    await rename(temporary, path);
  });
}

async function withLock<T>(rootInput: string, operation: () => Promise<T>): Promise<T> {
  const location = paths(rootInput);
  await rejectSymlinkComponents(location.root, location.directory);
  await mkdir(location.directory, { recursive: true });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await mkdir(location.lock);
      try {
        return await operation();
      } finally {
        await rm(location.lock, { recursive: true, force: true });
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM" && code !== "ENOTEMPTY") throw error;
      let age: number;
      try {
        age = Date.now() - (await stat(location.lock)).mtimeMs;
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === "ENOENT") {
          await delay(5);
          continue;
        }
        throw statError;
      }
      if (age > 30_000) {
        await rm(location.lock, { recursive: true, force: true });
        continue;
      }
      await delay(5);
    }
  }
  throw new Error("Capture journal is busy");
}

async function readSession(path: string): Promise<CaptureSession | undefined> {
  try {
    return CaptureSessionSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function captureStart(root = process.cwd()): Promise<CaptureSession> {
  return withLock(root, async () => {
    const location = paths(root);
    const active = await readSession(location.session);
    if (active?.status === "armed") return active;
    const startedAt = new Date().toISOString();
    const session = CaptureSessionSchema.parse({
      schemaVersion: CAPTURE_SESSION_SCHEMA,
      sessionId: hashValue([resolve(root), startedAt]),
      status: "armed",
      startedAt,
      eventCount: 0,
      failureCount: 0,
      limits: { maxEvents: MAX_EVENTS, maxEventBytes: MAX_EVENT_BYTES },
    });
    await rm(location.seen, { recursive: true, force: true });
    await mkdir(location.seen, { recursive: true });
    await atomicWrite(location.session, `${stableStringify(session)}\n`);
    await atomicWrite(location.journal, "");
    await atomicWrite(location.recent, "[]\n");
    await rm(location.evidence, { force: true });
    return session;
  });
}

export async function captureStatus(root = process.cwd()): Promise<CaptureSession | undefined> {
  return readSession(paths(root).session);
}

export async function captureStop(root = process.cwd()): Promise<CaptureSession | undefined> {
  return withLock(root, async () => {
    const location = paths(root);
    const session = await readSession(location.session);
    if (!session || session.status === "stopped") return session;
    const stopped = CaptureSessionSchema.parse({
      ...session,
      status: "stopped",
      stoppedAt: new Date().toISOString(),
    });
    await atomicWrite(location.session, `${stableStringify(stopped)}\n`);
    return stopped;
  });
}

function validJournal(raw: string): AgentEvent[] {
  const lines = raw.split(/\r?\n/u).filter(Boolean);
  const events: AgentEvent[] = [];
  for (const line of lines) {
    try {
      events.push(AgentEventSchema.parse(JSON.parse(line)));
    } catch {
      break;
    }
  }
  return events;
}

async function repairPartialJournal(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, "r");
    const information = await handle.stat();
    if (information.size === 0) return;
    const tail = Buffer.alloc(1);
    await handle.read(tail, 0, 1, information.size - 1);
    if (tail[0] === 10) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  } finally {
    await handle?.close();
  }
  const recovered = validJournal(await readFile(path, "utf8"));
  await atomicWrite(
    path,
    recovered.length === 0
      ? ""
      : `${recovered.map((entry) => stableStringify(entry)).join("\n")}\n`,
  );
}

async function appendDurably(path: string, value: string): Promise<void> {
  const handle = await open(path, "a");
  try {
    await handle.writeFile(`${value}\n`, "utf8");
  } finally {
    await handle.close();
  }
}

export type CaptureIngestResult = "captured" | "duplicate" | "off" | "full";

export async function captureIngestBatch(
  input: readonly AgentEvent[],
  root = process.cwd(),
): Promise<CaptureIngestResult[]> {
  if (input.length > MAX_EVENTS)
    throw new Error(`A capture batch cannot exceed ${MAX_EVENTS} events`);
  const parsed = input.map((event) => AgentEventSchema.parse(event));
  const serialized = parsed.map((event) => stableStringify(event));
  if (serialized.some((event) => Buffer.byteLength(event) > MAX_EVENT_BYTES)) {
    throw new Error("Normalized event exceeds capture limit");
  }
  const beforeLock = await readSession(paths(root).session);
  if (!beforeLock || beforeLock.status !== "armed") return parsed.map(() => "off");
  return withLock(root, async () => {
    const location = paths(root);
    const session = await readSession(location.session);
    if (!session || session.status !== "armed") return parsed.map(() => "off");
    const results: CaptureIngestResult[] = [];
    const accepted: Array<{ event: AgentEvent; serialized: string }> = [];
    const shards = new Map<
      string,
      { path: string; original: string; values: Set<string>; added: string[] }
    >();
    let remaining = MAX_EVENTS - session.eventCount;
    for (const [index, event] of parsed.entries()) {
      if (remaining <= 0) {
        results.push("full");
        continue;
      }
      const dedupeId = hashValue([
        event.toolCallId ?? event.eventId,
        event.eventType,
        event.outcome,
      ]);
      const shardName = dedupeId.slice(0, 2);
      let shard = shards.get(shardName);
      if (!shard) {
        const path = resolve(location.seen, `${shardName}.jsonl`);
        let original = "";
        try {
          original = await readFile(path, "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        shard = {
          path,
          original,
          values: new Set(
            original.split(/\r?\n/u).filter((value) => /^[a-f0-9]{64}$/u.test(value)),
          ),
          added: [],
        };
        shards.set(shardName, shard);
      }
      if (shard.values.has(dedupeId)) {
        results.push("duplicate");
        continue;
      }
      shard.values.add(dedupeId);
      shard.added.push(dedupeId);
      accepted.push({ event, serialized: serialized[index]! });
      results.push("captured");
      remaining -= 1;
    }
    try {
      await Promise.all(
        [...shards.values()]
          .filter((shard) => shard.added.length > 0)
          .map((shard) => appendDurably(shard.path, shard.added.join("\n"))),
      );
      await repairPartialJournal(location.journal);
      if (accepted.length > 0) {
        await appendDurably(location.journal, accepted.map((entry) => entry.serialized).join("\n"));
      }
    } catch (error) {
      await Promise.all(
        [...shards.values()]
          .filter((shard) => shard.added.length > 0)
          .map((shard) => atomicWrite(shard.path, shard.original)),
      );
      throw error;
    }
    const failureCount = accepted.filter(
      ({ event }) => event.outcome === "failed" || event.outcome === "interrupted",
    ).length;
    const updated = CaptureSessionSchema.parse({
      ...session,
      eventCount: session.eventCount + accepted.length,
      failureCount: session.failureCount + failureCount,
    });
    await atomicWrite(location.session, `${stableStringify(updated)}\n`);
    let recent: Array<{ sessionId: string; eventId: string }> = [];
    try {
      const value = JSON.parse(await readFile(location.recent, "utf8")) as unknown;
      if (Array.isArray(value)) {
        recent = value
          .filter(
            (entry): entry is { sessionId: string; eventId: string } =>
              typeof entry === "object" &&
              entry !== null &&
              typeof (entry as Record<string, unknown>).sessionId === "string" &&
              typeof (entry as Record<string, unknown>).eventId === "string",
          )
          .slice(-16);
      }
    } catch {
      recent = [];
    }
    let lastEvidence: FailureEvidence | undefined;
    for (const { event } of accepted) {
      const causalEventIds = recent
        .filter((entry) => entry.sessionId === event.sessionId)
        .map((entry) => entry.eventId);
      recent.push({ sessionId: event.sessionId, eventId: event.eventId });
      recent = recent.slice(-16);
      if (event.outcome === "failed" || event.outcome === "interrupted") {
        const body = {
          schemaVersion: FAILURE_EVIDENCE_SCHEMA,
          source: event.source,
          sessionId: event.sessionId,
          failureEventId: event.eventId,
          ...(event.toolName ? { toolName: event.toolName } : {}),
          errorClass: event.errorClass ?? "unknown",
          ...(event.summary ? { summary: event.summary } : {}),
          ...(event.inputSha256 ? { inputSha256: event.inputSha256 } : {}),
          ...(event.outputSha256 ? { outputSha256: event.outputSha256 } : {}),
          causalEventIds,
          deterministic: true as const,
        };
        lastEvidence = FailureEvidenceSchema.parse({ ...body, evidenceId: hashValue(body) });
      }
    }
    await atomicWrite(location.recent, `${stableStringify(recent.slice(-16))}\n`);
    if (lastEvidence) {
      await atomicWrite(location.evidence, `${stableStringify(lastEvidence)}\n`);
    }
    return results;
  });
}

export async function captureIngest(
  event: AgentEvent,
  root = process.cwd(),
): Promise<CaptureIngestResult> {
  return (await captureIngestBatch([event], root))[0]!;
}

export async function captureLast(root = process.cwd()): Promise<FailureEvidence | undefined> {
  try {
    return FailureEvidenceSchema.parse(JSON.parse(await readFile(paths(root).evidence, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function generateCapturedRegression(
  outputInput = "scenarios/generated/agent-failure.test.mjs",
  root = process.cwd(),
): Promise<{ testPath: string; evidencePath: string; evidence: FailureEvidence }> {
  const evidence = await captureLast(root);
  if (!evidence) throw new Error("No supported captured failure is available");
  const testPath = resolve(root, outputInput);
  if (!inside(resolve(root), testPath))
    throw new Error("Regression output must stay inside the repository");
  await rejectSymlinkComponents(resolve(root), dirname(testPath));
  await mkdir(dirname(testPath), { recursive: true });
  const evidencePath = `${testPath}.evidence.json`;
  if (
    (await access(testPath).then(
      () => true,
      () => false,
    )) ||
    (await access(evidencePath).then(
      () => true,
      () => false,
    ))
  ) {
    throw new Error("Regression output already exists; refusing to overwrite it");
  }
  const test = `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\n\ntest("captured ${evidence.errorClass} boundary remains reproducible", async () => {\n  const evidence = JSON.parse(await readFile(new URL("./${basename(evidencePath)}", import.meta.url), "utf8"));\n  assert.equal(evidence.schemaVersion, "${FAILURE_EVIDENCE_SCHEMA}");\n  assert.equal(evidence.evidenceId, "${evidence.evidenceId}");\n  assert.equal(evidence.errorClass, ${JSON.stringify(evidence.errorClass)});\n  assert.equal(evidence.deterministic, true);\n});\n`;
  await Promise.all([
    atomicWritePublic(testPath, test, false),
    atomicWritePublic(evidencePath, `${stableStringify(evidence)}\n`, false),
  ]);
  await access(testPath);
  return { testPath, evidencePath, evidence };
}
