import {
  createAdapterRegistry,
  evaluateSemanticAdvisory,
  normalizeDocumentedCallbackEvent,
} from "../packages/adapter-sdk/dist/index.js";
import { parseOtlpJsonBridgeEvents } from "../packages/otel-bridge/dist/index.js";

const registry = createAdapterRegistry();
const detected = registry.resolve({
  rootDirectory: process.cwd(),
  packageName: "@openai/agents",
});
if (detected?.profile.evidenceClass !== "GENUINE_RUNTIME") {
  throw new Error("Tier 1 registry detection failed.");
}

const autogen = parseOtlpJsonBridgeEvents({
  context: {
    framework: "autogen",
    frameworkVersion: "documented-stable",
    adapter: "@resilireplay/otel-bridge/autogen",
    adapterVersion: "0.7.0",
    runId: "framework-demo",
  },
  raw: JSON.stringify({
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: [
              {
                traceId: "demo-trace",
                spanId: "demo-tool",
                name: "execute_tool",
                events: [
                  {
                    name: "tool.error",
                    attributes: [
                      { key: "eventKind", value: { stringValue: "tool.error" } },
                      { key: "secret", value: { stringValue: "sk-demo-secret-value123" } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }),
});
if (autogen.events[0]?.eventKind !== "tool.error") {
  throw new Error("AutoGen OTLP bridge profile failed.");
}

const crew = normalizeDocumentedCallbackEvent(
  {
    eventName: "ToolUsageErrorEvent",
    eventId: "crew-tool",
    actorId: "crew-agent",
    payload: { error: "local demo" },
  },
  {
    framework: "crewai",
    frameworkVersion: "documented",
    runId: "framework-demo",
    traceId: "crew-trace",
    turnId: "crew-turn",
    sequence: 0,
  },
);

const decision = await evaluateSemanticAdvisory("failed", [autogen.events[0], crew]);
if (decision.semanticAdvisory.status !== "disabled" || decision.finalPolicyStatus !== "failed") {
  throw new Error("Deterministic policy boundary failed.");
}

console.log("ResiliReplay framework layer demo: PASS");
console.log(`Tier 1 detected: ${detected.profile.displayName} (${detected.profile.evidenceClass})`);
console.log("AutoGen bridge: FIXTURE_BACKED_PROTOCOL");
console.log("CrewAI callback: DOCUMENTED_ONLY");
console.log("Semantic advisor: disabled; deterministic failure remains authoritative");
