import { access, lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stableStringify } from "@resilireplay/core";
import { atomicWritePublic } from "./internal-write.js";
import { normalizeHookEvent } from "./normalize.js";
import { ADAPTER_MANIFEST_SCHEMA, AdapterManifestSchema, type AdapterManifest } from "./schemas.js";

const template = (name: string): AdapterManifest => ({
  schemaVersion: ADAPTER_MANIFEST_SCHEMA,
  name,
  version: "0.1.0",
  license: "Apache-2.0",
  source: "generic",
  entrypoint: "adapter.mjs",
  events: ["tool-result", "session-end"],
  privacy: {
    rawPromptsPersisted: false,
    rawTranscriptsPersisted: false,
    environmentValuesPersisted: false,
  },
});

export async function initAdapter(nameInput: string, root = process.cwd()): Promise<string> {
  const name = nameInput.trim().toLowerCase();
  const manifest = AdapterManifestSchema.parse(template(name));
  const directory = resolve(root, name);
  if (
    await access(directory).then(
      () => true,
      () => false,
    )
  ) {
    throw new Error(`Adapter target already exists: ${name}`);
  }
  await mkdir(resolve(directory, "fixtures"), { recursive: true });
  await atomicWritePublic(
    resolve(directory, "adapter.json"),
    `${stableStringify(manifest)}\n`,
    false,
  );
  await atomicWritePublic(
    resolve(directory, "adapter.mjs"),
    `// Return a ResiliReplay ${ADAPTER_MANIFEST_SCHEMA} normalized observation.\nexport function normalize(payload) { return payload; }\n`,
    false,
  );
  await atomicWritePublic(
    resolve(directory, "fixtures", "failure.input.json"),
    `${stableStringify({ hook_event_name: "PostToolUseFailure", session_id: "fixture", tool_name: "example", tool_use_id: "call-1", error: "controlled fixture failure" })}\n`,
    false,
  );
  await atomicWritePublic(
    resolve(directory, "fixtures", "failure.expected.json"),
    `${stableStringify({ outcome: "failed", errorClass: "unknown", toolName: "example" })}\n`,
    false,
  );
  return directory;
}

export interface AdapterVerification {
  compatible: boolean;
  manifest: AdapterManifest;
  fixtureCount: number;
  checks: string[];
}

export async function verifyAdapter(pathInput: string): Promise<AdapterVerification> {
  const directory = resolve(pathInput);
  if ((await lstat(directory)).isSymbolicLink())
    throw new Error("Symlinked adapter directories are not allowed");
  const manifest = AdapterManifestSchema.parse(
    JSON.parse(await readFile(resolve(directory, "adapter.json"), "utf8")),
  );
  const entrypoint = resolve(directory, manifest.entrypoint);
  const entryRelative = relative(directory, entrypoint);
  if (entryRelative.startsWith("..") || isAbsolute(entryRelative))
    throw new Error("Adapter entrypoint must stay inside its directory");
  if ((await lstat(entrypoint)).isSymbolicLink())
    throw new Error("Symlinked adapter entrypoints are not allowed");
  const module = (await import(`${pathToFileURL(entrypoint).href}?verify=${Date.now()}`)) as {
    normalize?: (payload: unknown) => unknown | Promise<unknown>;
  };
  if (typeof module.normalize !== "function")
    throw new Error("Adapter entrypoint must export normalize(payload)");
  const fixtureDirectory = resolve(directory, "fixtures");
  const fixtures = (await readdir(fixtureDirectory))
    .filter((name) => name.endsWith(".input.json"))
    .sort();
  if (fixtures.length === 0)
    throw new Error("Adapter must include at least one *.input.json fixture");
  const eventIds: string[] = [];
  for (const name of fixtures) {
    const inputPath = resolve(fixtureDirectory, name);
    if ((await lstat(inputPath)).isSymbolicLink())
      throw new Error("Symlinked adapter fixtures are not allowed");
    const fixture = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
    const adapted = await module.normalize(fixture);
    const event = normalizeHookEvent(adapted, {
      source: manifest.source,
      receivedAt: "2025-01-01T00:00:00.000Z",
    });
    if (!event) throw new Error(`${name} did not normalize to a supported event`);
    const expectedPath = resolve(
      fixtureDirectory,
      name.replace(/\.input\.json$/u, ".expected.json"),
    );
    if ((await lstat(expectedPath)).isSymbolicLink())
      throw new Error("Symlinked adapter fixtures are not allowed");
    const expected = JSON.parse(await readFile(expectedPath, "utf8")) as Record<string, unknown>;
    for (const [key, value] of Object.entries(expected)) {
      if ((event as unknown as Record<string, unknown>)[key] !== value)
        throw new Error(`${name} expected ${key}=${String(value)}`);
    }
    const serialized = stableStringify(event);
    if (Buffer.byteLength(serialized) > 32_768)
      throw new Error(`${name} exceeded the canonical event bound`);
    if (/(?:authorization|bearer|basic|api[_-]?key)\s*[:=]/iu.test(serialized))
      throw new Error(`${name} leaked a credential-shaped value`);
    const repeated = await Promise.all(
      Array.from({ length: 64 }, () => module.normalize!(fixture)),
    );
    const normalized = repeated.map((value) =>
      normalizeHookEvent(value, {
        source: manifest.source,
        receivedAt: "2025-01-01T00:00:00.000Z",
      }),
    );
    if (normalized.some((value) => value?.eventId !== event.eventId))
      throw new Error(`${name} was not deterministic under concurrent normalization`);
    eventIds.push(event.eventId);
  }
  return {
    compatible: true,
    manifest,
    fixtureCount: fixtures.length,
    checks: [
      "manifest",
      "entrypoint-containment",
      "golden-output",
      "failure-classification",
      "bounded-output",
      "privacy-redaction",
      "concurrent-deterministic-normalization",
      `event-sha256:${eventIds.join(",")}`,
    ],
  };
}
