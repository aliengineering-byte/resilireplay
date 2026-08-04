import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const SOURCE_TRACE_SHA256 = "d944a8dfae2530a458e3627d93babdf55897b06c4999a217f4b002552cce2b73";
const FIXTURE_SHA256 = "5797c076b7815042221b8b94d49902fc39f004f1567483357dcfb2093a9dca5d";
const FIRST_CRITICAL_STEP = "97b962a8-2a2c-42ad-beee-e7be2f062eed";

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
