import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const SOURCE_TRACE_SHA256 = "774ff580de4311f91a43b3cbdb6693e5767f425b0612c36d326a1f79544e0666";
const FIXTURE_SHA256 = "b50a3c4c8022de42c9ec21f13d8aa51b9056d7eab0ea4a480093f4c7e5364118";
const FIRST_CRITICAL_STEP = "ae05228f-53da-476f-9ed6-b20dda0a7854";

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
