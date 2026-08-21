import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeHookEvent, verifyAdapter } from "@resilireplay/agent";
import { describe, expect, it } from "vitest";

const adapterDirectory = resolve("examples/adapters/openai-agents");
const adapterModuleUrl = pathToFileURL(resolve(adapterDirectory, "adapter.mjs")).href;

interface AdapterModule {
  normalize(payload: unknown): Record<string, unknown>;
}

async function adapterModule(): Promise<AdapterModule> {
  return (await import(adapterModuleUrl)) as AdapterModule;
}

describe("offline OpenAI Agents SDK adapter example", () => {
  it("passes the adapter conformance suite", async () => {
    const result = await verifyAdapter(adapterDirectory);
    expect(result.compatible).toBe(true);
    expect(result.fixtureCount).toBe(8);
    expect(result.checks).toContain("privacy-redaction");
    expect(result.checks).toContain("concurrent-deterministic-normalization");
  });

  it("rejects an unsupported or malformed captured event", async () => {
    const module = await adapterModule();
    const malformed = JSON.parse(
      readFileSync(resolve(adapterDirectory, "fixtures/malformed.invalid.json"), "utf8"),
    ) as unknown;
    expect(() => module.normalize(malformed)).toThrow("Unsupported OpenAI Agents event");
  });

  it("keeps an oversized tool body out of the canonical event", async () => {
    const module = await adapterModule();
    const body = "oversized-fixture-body".repeat(5_000);
    const adapted = module.normalize({
      sdk: "@openai/agents",
      sdk_version: "0.14.3",
      run_id: "run-oversized",
      session_id: "session-oversized",
      event: {
        type: "run_item_stream_event",
        name: "tool_output",
        runId: "run-oversized",
        item: {
          type: "tool_call_output_item",
          rawItem: { type: "function_call_result", name: "large_tool", callId: "call-oversized" },
          output: body,
        },
      },
    });
    const event = normalizeHookEvent(adapted, {
      source: "generic",
      receivedAt: "2025-01-01T00:00:00.000Z",
    });
    expect(event?.outputSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(event)).not.toContain(body);
  });
});
