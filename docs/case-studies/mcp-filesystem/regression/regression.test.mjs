import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const SOURCE_TRACE_SHA256 = "f178556e7cf49816f2ae6d63c9b52d33a70108a3f4f4155408f50afd6611be0c";
const FIXTURE_SHA256 = "03d391c7f7841651fef2487d84555aafaf074cea222df8668df5233d24b7483f";
const FIRST_CRITICAL_STEP = "0027cf6d-c616-4c4e-9dc2-c4582093eea7";

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
