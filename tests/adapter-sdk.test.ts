import { describe, expect, it } from "vitest";
import {
  adapterTemplates,
  capabilityGate,
  createAdapterRegistry,
  detectFrameworkProfile,
  documentedCallbackEventNames,
  frameworkSupportProfiles,
  evaluateSemanticAdvisory,
  normalizeDocumentedCallbackEvent,
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

  it("publishes deterministic framework profiles with honest evidence classes", async () => {
    const profiles = frameworkSupportProfiles();
    expect(profiles.map((profile) => profile.id)).toEqual(
      expect.arrayContaining(["langgraph", "openai-agents", "autogen", "crewai", "llamaindex"]),
    );
    expect(profiles.find((profile) => profile.id === "autogen")?.evidenceClass).toBe(
      "FIXTURE_BACKED_PROTOCOL",
    );
    expect(profiles.find((profile) => profile.id === "crewai")?.evidenceClass).toBe(
      "DOCUMENTED_ONLY",
    );
    expect(profiles.find((profile) => profile.id === "llamaindex")?.evidenceClass).toBe(
      "DOCUMENTED_ONLY",
    );

    const registry = createAdapterRegistry();
    expect(
      registry.resolve({ rootDirectory: process.cwd(), packageName: "@openai/agents" })?.profile.id,
    ).toBe("openai-agents");
    expect(
      registry.resolve({ rootDirectory: process.cwd(), packageName: "@openai/agents" }, "crewai")
        ?.profile.id,
    ).toBe("crewai");
    expect(() => registry.resolve({ rootDirectory: process.cwd() }, "../unsafe-adapter")).toThrow(
      "Unknown framework override",
    );
    expect((await registry.doctor("autogen")).status).toBe("degraded");
  });

  it("auto-detects framework hints and commands without a false universal fallback", () => {
    expect(
      detectFrameworkProfile({ rootDirectory: process.cwd(), frameworkHint: "LangGraph workflow" })
        ?.profile.id,
    ).toBe("langgraph");
    expect(
      detectFrameworkProfile({ rootDirectory: process.cwd(), command: "python -m crewai run" })
        ?.profile.id,
    ).toBe("crewai");
    expect(
      detectFrameworkProfile({ rootDirectory: process.cwd(), command: "node ordinary-script.mjs" }),
    ).toBeUndefined();
  });

  it("[DOCUMENTED_ONLY] maps bounded CrewAI and LlamaIndex callback surfaces", () => {
    expect(documentedCallbackEventNames("crewai")).toContain("ToolUsageErrorEvent");
    expect(documentedCallbackEventNames("llamaindex")).toContain("span_drop");
    const crewEvent = normalizeDocumentedCallbackEvent(
      {
        eventName: "ToolUsageErrorEvent",
        eventId: "crew-tool-1",
        actorId: "researcher",
        payload: { apiKey: "must-not-survive", error: "controlled" },
      },
      {
        framework: "crewai",
        frameworkVersion: "documented",
        runId: "crew-run",
        traceId: "crew-trace",
        turnId: "crew-turn",
        sequence: 0,
      },
    );
    expect(crewEvent.eventKind).toBe("tool.error");
    expect(crewEvent.metadata.evidenceClass).toBe("DOCUMENTED_ONLY");
    expect((crewEvent.payload as { apiKey?: string }).apiKey).toBe("[REDACTED]");

    const llamaEvent = normalizeDocumentedCallbackEvent(
      { eventName: "span_drop", eventId: "llama-span-1", actorId: "query-engine" },
      {
        framework: "llamaindex",
        frameworkVersion: "documented",
        runId: "llama-run",
        traceId: "llama-trace",
        turnId: "llama-turn",
        sequence: 0,
      },
    );
    expect(llamaEvent.eventKind).toBe("agent.error");
    expect(llamaEvent.metadata.evidenceClass).toBe("DOCUMENTED_ONLY");
  });

  it("keeps semantic evaluation optional, advisory, and disabled by default", async () => {
    let calls = 0;
    const disabled = await evaluateSemanticAdvisory(
      "failed",
      { secret: "hidden" },
      {
        advisor: {
          providerId: "must-not-run",
          evaluate: async () => {
            calls += 1;
            return {
              rubricVersion: "1",
              evidenceDigest: "0".repeat(64),
              status: "completed",
              score: 1,
            };
          },
        },
      },
    );
    expect(calls).toBe(0);
    expect(disabled.semanticAdvisory.status).toBe("disabled");
    expect(disabled.finalPolicyStatus).toBe("failed");

    const enabled = await evaluateSemanticAdvisory(
      "failed",
      { value: "sanitized" },
      {
        enabled: true,
        rubricVersion: "rubric-1",
        advisor: {
          providerId: "local-fixture",
          evaluate: async ({ evidenceDigest, rubricVersion }) => ({
            rubricVersion,
            evidenceDigest,
            status: "completed",
            score: 1,
            notes: "Advisory only.",
          }),
        },
      },
    );
    expect(enabled.semanticAdvisory.status).toBe("completed");
    expect(enabled.finalPolicyStatus).toBe("failed");
  });
});
