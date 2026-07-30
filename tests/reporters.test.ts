import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { terminalReport, writeReportBundle } from "@resilireplay/reporters";
import { failedTrace, passingTrace } from "./helpers.js";

describe("reporters", () => {
  it("writes all auditable formats and a reproducible manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "resilireplay-report-"));
    try {
      const bundle = await writeReportBundle(passingTrace(), directory);
      const json = JSON.parse(await readFile(bundle.jsonPath, "utf8")) as { schemaVersion: string };
      expect(json.schemaVersion).toBe("1.0");
      expect(await readFile(bundle.htmlPath, "utf8")).toContain("<!doctype html>");
      expect(await readFile(bundle.junitPath, "utf8")).toContain('failures="0"');
      expect(JSON.parse(await readFile(bundle.sarifPath, "utf8"))).toHaveProperty(
        "version",
        "2.1.0",
      );
      expect(await readFile(bundle.badgePath, "utf8")).toContain("Agent Reliability Tested");
      expect(await readFile(bundle.manifestPath, "utf8")).toContain("traceSha256");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("explains failures in terminal and JUnit reports", async () => {
    const directory = await mkdtemp(join(tmpdir(), "resilireplay-report-"));
    try {
      const bundle = await writeReportBundle(failedTrace(), directory);
      expect(terminalReport(bundle.metrics, false)).toMatch(/FAIL/);
      expect(await readFile(bundle.junitPath, "utf8")).toContain("<failure");
      expect(bundle.metrics.reasons.length).toBeGreaterThan(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
