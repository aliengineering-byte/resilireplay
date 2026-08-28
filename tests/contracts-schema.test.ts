import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { adapterTemplates, parseAdapterTemplate } from "@resilireplay/adapter-sdk";
import { createV1Event, EventEnvelopeV1Schema } from "@resilireplay/core";

function requiredByRef(schema: Record<string, unknown>, name: string): string[] {
  return ((schema.required as string[] | undefined) ?? []).filter(
    (entry) => entry === name || entry !== "",
  );
}

describe("contract schemas", () => {
  it("ships a v1 framework event JSON schema with required canonical fields", async () => {
    const raw = (await readFile("schemas/framework-event-v1.schema.json", "utf8")) as string;
    const schema = JSON.parse(raw) as Record<string, unknown>;
    expect(schema["$id"]).toContain("framework-event-v1.schema.json");
    expect((schema.required as string[]) ?? []).toContain("payloadDigest");
    expect((schema.required as string[]) ?? []).toContain("redaction");
    expect((schema.required as string[]) ?? []).toContain("wallClock");
    const properties = schema.properties as Record<string, unknown>;
    expect(properties["schemaVersion"]).toMatchObject({ const: "1.0.0" });
    const required = requiredByRef(schema, "schemaVersion");
    expect(required).toContain("schemaVersion");
    expect(properties["eventKind"]).toBeDefined();
  });

  it("keeps JSON schema and runtime validation in lockstep for event examples", () => {
    const event = createV1Event({
      runId: "schema-run",
      traceId: "schema-trace",
      spanId: "schema-span",
      sequence: 0,
      turnId: "schema-turn",
      actorId: "actor-schema",
      framework: "schema",
      frameworkVersion: "1.0.0",
      adapter: "resili-unit",
      adapterVersion: "0.7.0",
      operation: "run",
      boundary: "framework",
      phase: "start",
      eventKind: "run.start",
      attempt: 0,
      eventClass: "run",
      safetyClass: "safe",
      payload: { a: 1 },
    });
    expect(() => EventEnvelopeV1Schema.parse(event)).not.toThrow();
    expect(event.schemaVersion).toBe("1.0.0");
  });

  it("validates template fixtures against the adapter-template schema", () => {
    const raw = adapterTemplates().map((template) => parseAdapterTemplate(template));
    expect(raw.length).toBeGreaterThan(0);
    for (const template of raw) {
      expect(template.schemaVersion).toBe("resilireplay.adapter-template/v1.0.0");
      expect(template.license).toBe("Apache-2.0");
      expect(template.expectedEvidence.length).toBeGreaterThan(0);
    }
  });

  it("ships an adapter template JSON schema artifact", async () => {
    const raw = (await readFile("schemas/adapter-template-v1.schema.json", "utf8")) as string;
    const schema = JSON.parse(raw) as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(properties["schemaVersion"]).toMatchObject({
      const: "resilireplay.adapter-template/v1.0.0",
    });
    expect((schema.required as string[]) ?? []).toContain("expectedEvidence");
    expect((schema.required as string[]) ?? []).toContain("scenarioFixture");
  });
});
