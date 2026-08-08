import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const SOURCE_TRACE_SHA256 = "fa65c934e4a99741f35f3122b563797e310c5fc9bf70d8b2f011d97a1a87f0ba";
const FIXTURE_SHA256 = "9f91de1398bb25b8eb96b2b581ec6dad0e85cff1e03ce85156e1a7dbd7bbabb7";
const FIRST_CRITICAL_STEP = "a9b6941a-c438-4028-8f4d-1b81244c58f5";

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
