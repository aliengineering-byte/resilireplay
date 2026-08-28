import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createEvent,
  hashValue,
  stableStringify,
  validateEvent,
  validateTrace,
  EventEnvelopeV1Schema,
  createV1Event,
  migrateLegacyTrace,
  validateV1Event,
  stripUnstableValues,
} from "@resilireplay/core";
import { event, passingTrace } from "./helpers.js";

describe("versioned event model", () => {
  it("creates validated events with stable hashes", () => {
    const value = event(0, "run_started", { z: 1, a: 2 });
    expect(value.schemaVersion).toBe("1.0");
    expect(value.payloadHash).toBe(hashValue({ a: 2, z: 1 }));
    expect(validateEvent(value)).toEqual(value);
  });

  it("rejects a tampered payload", () => {
    const value = event(0, "run_started", { safe: true });
    expect(() => validateEvent({ ...value, payload: { safe: false } })).toThrow(
      "Payload hash mismatch",
    );
  });

  it("rejects non-monotonic sequences", () => {
    expect(() => validateTrace([event(1, "run_started"), event(0, "run_completed")])).toThrow(
      "strictly monotonic",
    );
  });

  it("rejects duplicate step IDs", () => {
    const one = event(0, "run_started");
    const two = createEvent({ ...event(1, "run_completed"), stepId: one.stepId });
    expect(() => validateTrace([one, two])).toThrow("Duplicate step ID");
  });

  it("uses canonical object ordering", () => {
    expect(stableStringify({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
    expect(validateTrace(passingTrace())).toHaveLength(5);
  });

  it("uses locale-independent canonical ordering under concurrency", async () => {
    const input = { z: 1, ä: 2, a: 3, Z: 4 };
    const expected = '{"Z":4,"a":3,"z":1,"ä":2}';
    expect(stableStringify(input)).toBe(expected);
    const results = await Promise.all(
      Array.from({ length: 128 }, async (_, index) =>
        stableStringify(index % 2 === 0 ? input : { Z: 4, a: 3, ä: 2, z: 1 }),
      ),
    );
    expect(new Set(results)).toEqual(new Set([expected]));
    expect(hashValue({ ...input, z: 2 })).not.toBe(hashValue(input));
  });

  it("produces the same canonical bytes in separate processes and working directories", async () => {
    const firstDirectory = await mkdtemp(join(tmpdir(), "resilireplay-canonical-first-"));
    const secondDirectory = await mkdtemp(join(tmpdir(), "resilireplay-canonical-second-"));
    const coreModule = pathToFileURL(resolve("packages/core/dist/index.js")).href;
    const source = `import { stableStringify } from ${JSON.stringify(coreModule)}; process.stdout.write(stableStringify({z:1,a:2,"ä":3}));`;
    try {
      const outputs = [firstDirectory, secondDirectory].map((cwd) =>
        spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
          cwd,
          encoding: "utf8",
          windowsHide: true,
        }),
      );
      expect(outputs.map((result) => result.status)).toEqual([0, 0]);
      expect(new Set(outputs.map((result) => result.stdout))).toEqual(
        new Set(['{"a":2,"z":1,"ä":3}']),
      );
    } finally {
      await rm(firstDirectory, { recursive: true, force: true });
      await rm(secondDirectory, { recursive: true, force: true });
    }
  });

  it("rejects interleaved run identities", () => {
    expect(() =>
      validateTrace([event(0, "run_started"), { ...event(1, "run_completed"), runId: "other" }]),
    ).toThrow("more than one run ID");
  });
});

describe("v1 event contract", () => {
  it("creates a valid v1 event with canonical digest", () => {
    const value = createV1Event({
      runId: "run-v1",
      traceId: "trace-v1",
      spanId: "span-v1",
      sequence: 0,
      turnId: "turn-1",
      actorId: "agent-1",
      framework: "unit-test",
      frameworkVersion: "0.0.1",
      adapter: "resili-unit",
      adapterVersion: "0.7.0",
      operation: "run",
      boundary: "framework",
      phase: "start",
      eventKind: "run.start",
      attempt: 0,
      eventClass: "run",
      safetyClass: "safe",
      payload: { alpha: 1, beta: "value" },
    });
    const validated = validateV1Event(value);
    expect(validated.schemaVersion).toBe("1.0.0");
    expect(EventEnvelopeV1Schema.parse(validated)).toStrictEqual(validated);
  });

  it("keeps canonical digests stable across wall-clock changes", () => {
    const first = createV1Event({
      runId: "run-v1-stable",
      traceId: "trace-v1-stable",
      spanId: "span-v1",
      sequence: 0,
      turnId: "turn-stable",
      actorId: "agent-1",
      framework: "unit-test",
      frameworkVersion: "0.0.1",
      adapter: "resili-unit",
      adapterVersion: "0.7.0",
      operation: "run",
      boundary: "framework",
      phase: "start",
      eventKind: "run.start",
      attempt: 0,
      eventClass: "run",
      safetyClass: "safe",
      payload: { value: 1 },
      wallClock: "1970-01-01T00:00:00.000Z",
    });
    const second = createV1Event({
      runId: "run-v1-stable",
      traceId: "trace-v1-stable",
      spanId: "span-v1",
      sequence: 0,
      turnId: "turn-stable",
      actorId: "agent-1",
      framework: "unit-test",
      frameworkVersion: "0.0.1",
      adapter: "resili-unit",
      adapterVersion: "0.7.0",
      operation: "run",
      boundary: "framework",
      phase: "start",
      eventKind: "run.start",
      attempt: 0,
      eventClass: "run",
      safetyClass: "safe",
      payload: { value: 1 },
      wallClock: "2070-01-01T00:00:00.000Z",
    });
    expect(first.payloadDigest).toBe(second.payloadDigest);
  });

  it("rejects malformed payload digests and unsupported schema versions", () => {
    const value = createV1Event({
      runId: "run-v1",
      traceId: "trace-v1",
      spanId: "span-v1",
      sequence: 3,
      turnId: "turn-1",
      actorId: "agent-1",
      framework: "unit-test",
      frameworkVersion: "0.0.1",
      adapter: "resili-unit",
      adapterVersion: "0.7.0",
      operation: "run",
      boundary: "framework",
      phase: "running",
      eventKind: "run.end",
      attempt: 0,
      eventClass: "run",
      safetyClass: "safe",
      payload: { result: "ok" },
    });
    expect(() =>
      validateV1Event({ ...value, payloadDigest: "0".repeat(64) } as typeof value),
    ).toThrow("Payload digest mismatch");
    expect(() =>
      validateV1Event({ ...value, schemaVersion: "2.0.0" as "1.0.0" } as typeof value),
    ).toThrow();
  });

  it("rejects malformed v1 payload hash", () => {
    const value = createV1Event({
      runId: "run-v1",
      traceId: "trace-v1",
      spanId: "span-v1",
      sequence: 1,
      turnId: "turn-1",
      actorId: "agent-1",
      framework: "unit-test",
      frameworkVersion: "0.0.1",
      adapter: "resili-unit",
      adapterVersion: "0.7.0",
      operation: "run",
      boundary: "framework",
      phase: "running",
      eventKind: "run.end",
      attempt: 0,
      eventClass: "run",
      safetyClass: "safe",
      payload: { result: "ok" },
    });
    expect(() =>
      validateV1Event({
        ...value,
        payload: { result: "bad" },
      }),
    ).toThrow("Payload digest mismatch");
  });

  it("strips unstable paths from canonical digest", () => {
    const event = createV1Event({
      runId: "run-v1",
      traceId: "trace-v1",
      spanId: "span-v1",
      sequence: 2,
      turnId: "turn-2",
      actorId: "agent-1",
      framework: "unit-test",
      frameworkVersion: "0.0.1",
      adapter: "resili-unit",
      adapterVersion: "0.7.0",
      operation: "tool",
      boundary: "tool",
      phase: "running",
      eventKind: "tool.result",
      attempt: 0,
      eventClass: "tool",
      safetyClass: "safe",
      payload: { path: "C:/tmp/reli/test.txt", temp: "/tmp/agent/path" },
    });
    const replay = stripUnstableValues({
      payload: event.payload,
      metadata: {},
      wallClock: event.wallClock,
      eventId: event.eventId,
    });
    expect((replay as Record<string, unknown>).payload).toMatchObject({ path: "[redacted-path]" });
  });

  it("migrates legacy traces to v1 shape", () => {
    const migrated = migrateLegacyTrace(passingTrace());
    expect(migrated).toHaveLength(5);
    expect(migrated[0]?.eventKind).toBe("run.start");
    expect(migrated.at(-1)?.eventKind).toBe("run.end");
  });
});
