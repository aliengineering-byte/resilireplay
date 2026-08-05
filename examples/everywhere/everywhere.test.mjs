import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("captured process-exit boundary remains reproducible", async () => {
  const evidence = JSON.parse(
    await readFile(new URL("./everywhere.test.mjs.evidence.json", import.meta.url), "utf8"),
  );
  assert.equal(evidence.schemaVersion, "resilireplay.failure-evidence/v1");
  assert.equal(
    evidence.evidenceId,
    "f3e175f2f2490ad9dde0d8230787613dc189652b1ca9f00f9d20191edc946928",
  );
  assert.equal(evidence.errorClass, "process-exit");
  assert.equal(evidence.deterministic, true);
});
