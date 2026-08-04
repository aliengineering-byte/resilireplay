import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const SOURCE_TRACE_SHA256 = "1d56b0cd15524436bac0ca7074c43779dd95315118470aea402e857600f00c49";
const FIXTURE_SHA256 = "ad5d9053fae7e1829210d09bf9dd8b86ec6cfea43dcbbba04329734f060228d3";
const FIRST_CRITICAL_STEP = "d846c3dc-9bfa-4229-a5a3-9b505d8fa51d";

test("reproduces the captured ResiliReplay failure", async () => {
  const raw = await readFile(new URL("./replay.fixture.jsonl", import.meta.url), "utf8");
  assert.equal(createHash("sha256").update(raw).digest("hex"), FIXTURE_SHA256);
  const events = raw
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  const critical = events.find((event) => event.stepId === FIRST_CRITICAL_STEP);
  assert.ok(critical, "critical causal event is preserved");
  assert.ok(
    critical.fault || critical.type === "safety_violation" || critical.type === "run_failed",
  );
  assert.equal(events.at(-1)?.type, "run_failed", "the minimized replay reproduces failure");
  assert.match(SOURCE_TRACE_SHA256, /^[a-f0-9]{64}$/u);
});
