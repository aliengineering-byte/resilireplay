import { hashValue } from "@resilireplay/core";
import {
  parseAdapterManifest,
  type AdapterCapability,
  type FaultBoundary,
} from "@resilireplay/adapter-sdk";

export const OPENAI_AGENTS_ADAPTER_ID = "openai-agents" as const;
export const OPENAI_AGENTS_ADAPTER_NAME = "@resilireplay/adapter-openai-agents" as const;
export const OPENAI_AGENTS_ADAPTER_VERSION = "0.6.0" as const;
export const OPENAI_AGENTS_FRAMEWORK_VERSION = "0.14.3" as const;
export const OPENAI_AGENTS_FRAMEWORK_VERSION_RANGE = ">=0.14.3 <0.15.0" as const;

export type EvidenceClass =
  | "GENUINE_RUNTIME"
  | "FIXTURE_BACKED_PROTOCOL"
  | "DOCUMENTED_ONLY"
  | "UNSUPPORTED";

const capabilities: AdapterCapability[] = [
  {
    name: "run-agent-lifecycle",
    level: "verified",
    required: true,
    details: "GENUINE_RUNTIME: public Runner lifecycle hooks are captured locally.",
  },
  {
    name: "tool-lifecycle",
    level: "verified",
    required: false,
    details: "GENUINE_RUNTIME: public function tools cover result, error, and timeout paths.",
  },
  {
    name: "model-lifecycle",
    level: "verified",
    required: false,
    details:
      "GENUINE_RUNTIME: a provider-neutral public Model is instrumented without credentials.",
  },
  {
    name: "bounded-retry",
    level: "verified",
    required: false,
    details: "GENUINE_RUNTIME: SDK model retry policy is exercised with an exact attempt bound.",
  },
  {
    name: "handoff",
    level: "verified",
    required: false,
    details: "GENUINE_RUNTIME: public handoff routing retains from/to agent identity.",
  },
  {
    name: "guardrails",
    level: "verified",
    required: false,
    details: "GENUINE_RUNTIME: an input guardrail tripwire is captured as neutral evidence.",
  },
  {
    name: "streaming-cancellation",
    level: "verified",
    required: false,
    details: "GENUINE_RUNTIME: public streamed runs preserve ordered chunks and cancellation.",
  },
  {
    name: "trace-span-mapping",
    level: "verified",
    required: false,
    details: "GENUINE_RUNTIME: public tracing processor callbacks map trace and span identity.",
  },
  {
    name: "deterministic-regression",
    level: "verified",
    required: false,
    details: "GENUINE_RUNTIME: captured failure evidence compiles and executes as a regression.",
  },
];

const boundaries: FaultBoundary[] = [
  {
    name: "framework",
    recoverable: true,
    retryable: true,
    requiresCleanup: false,
    idempotent: false,
  },
  { name: "model", recoverable: true, retryable: true, requiresCleanup: true, idempotent: true },
  { name: "tool", recoverable: true, retryable: true, requiresCleanup: true, idempotent: false },
  { name: "stream", recoverable: true, retryable: false, requiresCleanup: true, idempotent: true },
  {
    name: "transport",
    recoverable: true,
    retryable: true,
    requiresCleanup: true,
    idempotent: true,
  },
];

const limitations = [
  "DOCUMENTED_ONLY: hosted OpenAI model transport behavior is outside local no-key verification.",
  "UNSUPPORTED: this checkpoint does not claim provider latency, billing, quota, or server retry semantics.",
  "UNSUPPORTED: global trace processor installation remains an explicit caller-controlled SDK operation.",
];

export const OPENAI_AGENTS_MANIFEST = parseAdapterManifest({
  schemaVersion: "resilireplay.adapter-sdk/v1.0.0",
  adapterId: OPENAI_AGENTS_ADAPTER_ID,
  adapterName: OPENAI_AGENTS_ADAPTER_NAME,
  adapterVersion: OPENAI_AGENTS_ADAPTER_VERSION,
  framework: "openai-agents",
  frameworkVersionRange: OPENAI_AGENTS_FRAMEWORK_VERSION_RANGE,
  kind: "typescript",
  capabilities,
  evidence: [
    "GENUINE_RUNTIME: @openai/agents@0.14.3 public Agent, Runner, tool, handoff, guardrail, retry, streaming, and tracing APIs.",
    "GENUINE_RUNTIME: provider-neutral scripted Model implementation with no API key or network access.",
  ],
  limitations,
  limitationsHash: hashValue(limitations),
});

export function openAIAgentsCapabilities(): AdapterCapability[] {
  return OPENAI_AGENTS_MANIFEST.capabilities.map((capability) => ({ ...capability }));
}

export function openAIAgentsFaultBoundaries(): FaultBoundary[] {
  return boundaries.map((boundary) => ({ ...boundary }));
}
