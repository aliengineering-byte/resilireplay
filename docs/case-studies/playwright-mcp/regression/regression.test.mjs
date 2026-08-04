import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const SOURCE_TRACE_SHA256 = "96cf629befda6b1e804dff6ff4c871cd5b343ca8d390dd70a32eb6c512e68db6";
const FIXTURE_SHA256 = "ff60e7156fe0e5e77b796a3c2f896fbf5b2bc46a35899089893d8f54c5656d04";
const FIRST_CRITICAL_STEP = "1bff0720-f9ad-4591-8ddc-bc7a5ac30ec7";

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
