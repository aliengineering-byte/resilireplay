import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const SOURCE_TRACE_SHA256 = "eec8c970cb0d5eb067c2634eeb1211b7a849d4129808180b454a419de2478372";
const FIXTURE_SHA256 = "1acda2d176d28721dfaba951173ac0d2067fbbba5001ac6df0fdeb4f916bf92c";
const FIRST_CRITICAL_STEP = "da0c2e9e-3630-4018-ac33-b240d4e3466e";

test("reproduces the captured ResiliReplay failure", async () => {
  const raw = await readFile(new URL("./replay.fixture.jsonl", import.meta.url), "utf8");
  assert.equal(createHash("sha256").update(raw).digest("hex"), FIXTURE_SHA256);
  const events = raw.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  const critical = events.find((event) => event.stepId === FIRST_CRITICAL_STEP);
  assert.ok(critical, "critical causal event is preserved");
  assert.ok(critical.fault || critical.type === "safety_violation" || critical.type === "run_failed");
  assert.equal(events.at(-1)?.type, "run_failed", "the minimized replay reproduces failure");
  assert.match(SOURCE_TRACE_SHA256, /^[a-f0-9]{64}$/u);
});
