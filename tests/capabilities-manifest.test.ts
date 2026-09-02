import { readFile } from "node:fs/promises";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("AEB capability manifest", () => {
  it("validates the released repository manifest against its strict v1 schema", async () => {
    const [schema, manifest, packageManifest] = await Promise.all([
      readJson("schemas/aeb-capabilities-v1.schema.json"),
      readJson("aeb-capabilities.json"),
      readJson("package.json"),
    ]);
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(schema as AnySchema);

    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect((schema as { $id: string }).$id).toBe("urn:aeb:resilireplay:schema:aeb-capabilities:v1");
    expect(manifest).toMatchObject({
      schemaVersion: "aeb.capabilities/v1",
      repository: "aliengineering-byte/resilireplay",
      currentVersion: (packageManifest as { version: string }).version,
    });
  });

  it("rejects undeclared fields and unknown schema revisions", async () => {
    const [schema, manifest, invalid] = await Promise.all([
      readJson("schemas/aeb-capabilities-v1.schema.json"),
      readJson("aeb-capabilities.json"),
      readJson("tests/fixtures/aeb-capabilities/invalid-unknown-field.json"),
    ]);
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(schema as AnySchema);

    expect(validate(invalid)).toBe(false);
    expect(validate.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: "additionalProperties" })]),
    );

    const future = {
      ...(manifest as Record<string, unknown>),
      schemaVersion: "aeb.capabilities/v2",
    };
    expect(validate(future)).toBe(false);
    expect(validate.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ instancePath: "/schemaVersion" })]),
    );
  });
});
