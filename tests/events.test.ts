import { describe, expect, it } from "vitest";
import {
  createEvent,
  hashValue,
  stableStringify,
  validateEvent,
  validateTrace,
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
});
