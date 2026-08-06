import { describe, expect, it } from "vitest";
import {
  adapterTemplates,
  capabilityGate,
  parseAdapterManifest,
  parseAdapterTemplate,
  renderTemplateArtifact,
  templateById,
} from "@resilireplay/adapter-sdk";

describe("adapter SDK contracts and templates", () => {
  it("exports stable templates with valid schema and hashes", () => {
    const values = adapterTemplates();
    expect(values.length).toBeGreaterThanOrEqual(9);
    for (const value of values) {
      const parsed = parseAdapterTemplate(value);
      expect(parsed.id).toBe(value.id);
      const rendered = renderTemplateArtifact(parsed);
      const parsedRendered = JSON.parse(rendered) as { id?: string };
      expect(parsedRendered.id).toBe(parsed.id);
    }
  });

  it("resolves templates by identifier and rejects unknown template names", () => {
    expect(templateById("tool-timeout")?.id).toBe("tool-timeout");
    expect(templateById("../tool-timeout")).toBeUndefined();
  });

  it("prevents invalid manifests and unsupported capabilities", () => {
    expect(() =>
      parseAdapterManifest({
        schemaVersion: "not-known",
        adapterId: "bad",
        adapterName: "bad",
        adapterVersion: "0.0.1",
        framework: "unknown",
        frameworkVersionRange: ">=0.0",
        kind: "manual",
        capabilities: [{ name: "run.start", level: "unsupported", required: true }],
        evidence: [],
        limitations: [],
        limitationsHash: "bad".padEnd(64, "0"),
      }),
    ).toThrow();
    expect(() =>
      capabilityGate(
        {
          schemaVersion: "resilireplay.adapter-sdk/v1.0.0",
          adapterId: "bad",
          adapterName: "bad",
          adapterVersion: "0.0.1",
          framework: "unknown",
          frameworkVersionRange: ">=0.0",
          kind: "manual",
          capabilities: [{ name: "run.start", level: "unsupported", required: true }],
          evidence: [],
          limitations: [],
          limitationsHash: "e".repeat(64),
        },
        ["run.start"],
      ),
    ).toThrow("Unsupported required capability: run.start");
  });

  it("rejects malicious template payloads", () => {
    expect(() =>
      parseAdapterTemplate({
        schemaVersion: "resilireplay.adapter-template/v1.0.0",
        templateVersion: "1.0",
        id: "bad-template",
        name: "bad",
        description: "evil",
        framework: "universal",
        frameworkVersionRange: ">=5.0",
        compatibility: "verified",
        safetyClass: "safe",
        mode: "campaign",
        source: {
          repository: "a",
          version: "1.0.0",
        },
        license: "Apache-2.0",
        expectedEvidence: ["run.start"],
        scenarioFixture: {
          fault: "tool-result",
          event: "tool.result",
          occurrence: 1,
          instructions: "../unsafe/path",
        },
        schemaValidation: { requiredEvidenceFields: ["run.start"] },
        limitations: [],
      }),
    ).toThrow();
  });
});
