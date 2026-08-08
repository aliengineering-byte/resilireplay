import { hashValue } from "@resilireplay/core";
import {
  parseAdapterManifest,
  type AdapterCapability,
  type AdapterManifest,
  type FaultBoundary,
} from "@resilireplay/adapter-sdk";

export const LANGGRAPH_ADAPTER_ID = "langgraph" as const;
export const LANGGRAPH_ADAPTER_NAME = "@resilireplay/adapter-langgraph" as const;
export const LANGGRAPH_ADAPTER_VERSION = "0.6.0" as const;
export const LANGGRAPH_FRAMEWORK_VERSION = "1.4.9" as const;
export const LANGGRAPH_FRAMEWORK_VERSION_RANGE = ">=1.4.9 <1.5.0" as const;

export type EvidenceClass =
  | "GENUINE_RUNTIME"
  | "FIXTURE_BACKED_PROTOCOL"
  | "DOCUMENTED_ONLY"
  | "UNSUPPORTED";

const capabilities: AdapterCapability[] = [
  {
    name: "run-lifecycle",
    level: "verified",
    required: true,
    details: "GENUINE_RUNTIME: compiled StateGraph lifecycle events are normalized locally.",
  },
  {
    name: "node-lifecycle",
    level: "verified",
    required: false,
    details:
      "GENUINE_RUNTIME: task start/result identity is preserved from public protocol events.",
  },
  {
    name: "tool-lifecycle",
    level: "verified",
    required: false,
    details:
      "GENUINE_RUNTIME: ToolNode start/result/error events are executed without a model provider.",
  },
  {
    name: "timeout",
    level: "verified",
    required: false,
    details:
      "GENUINE_RUNTIME: public node timeout policy produces bounded NodeTimeoutError evidence.",
  },
  {
    name: "stream-ordering",
    level: "verified",
    required: false,
    details: "GENUINE_RUNTIME: monotonic protocol sequence and chunk identity are checked.",
  },
  {
    name: "interrupt-resume",
    level: "verified",
    required: false,
    details: "GENUINE_RUNTIME: MemorySaver and Command resume are executed locally.",
  },
  {
    name: "subgraph-identity",
    level: "verified",
    required: false,
    details: "GENUINE_RUNTIME: public nested graph namespaces map to child and parent spans.",
  },
  {
    name: "malformed-result",
    level: "experimental",
    required: false,
    details:
      "FIXTURE_BACKED_PROTOCOL: invalid tool-finished payloads are rejected by the normalizer.",
  },
  {
    name: "deterministic-replay",
    level: "verified",
    required: false,
    details: "GENUINE_RUNTIME: normalized failure evidence compiles and executes as a regression.",
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
  { name: "tool", recoverable: true, retryable: true, requiresCleanup: true, idempotent: false },
  {
    name: "checkpoint",
    recoverable: true,
    retryable: true,
    requiresCleanup: false,
    idempotent: true,
  },
  { name: "state", recoverable: true, retryable: false, requiresCleanup: false, idempotent: true },
  { name: "stream", recoverable: true, retryable: false, requiresCleanup: false, idempotent: true },
  {
    name: "subgraph",
    recoverable: true,
    retryable: true,
    requiresCleanup: true,
    idempotent: false,
  },
];

const limitations = [
  "FIXTURE_BACKED_PROTOCOL: malformed wire payloads cannot be emitted by the typed public runtime and use a bounded protocol fixture.",
  "DOCUMENTED_ONLY: remote LangGraph Platform transports are outside this local no-key verification scope.",
  "UNSUPPORTED: provider-backed model semantics are not claimed by this adapter checkpoint.",
];

export const LANGGRAPH_MANIFEST: AdapterManifest = parseAdapterManifest({
  schemaVersion: "resilireplay.adapter-sdk/v1.0.0",
  adapterId: LANGGRAPH_ADAPTER_ID,
  adapterName: LANGGRAPH_ADAPTER_NAME,
  adapterVersion: LANGGRAPH_ADAPTER_VERSION,
  framework: "langgraph",
  frameworkVersionRange: LANGGRAPH_FRAMEWORK_VERSION_RANGE,
  kind: "typescript",
  capabilities,
  evidence: [
    "GENUINE_RUNTIME: @langchain/langgraph@1.4.9 public streamEvents({ version: 'v3' }) execution.",
    "GENUINE_RUNTIME: local ToolNode, MemorySaver, Command, nested StateGraph, retry, and timeout execution.",
    "FIXTURE_BACKED_PROTOCOL: one malformed tool result protocol fixture.",
  ],
  limitations,
  limitationsHash: hashValue(limitations),
});

export function langGraphCapabilities(): AdapterCapability[] {
  return LANGGRAPH_MANIFEST.capabilities.map((capability) => ({ ...capability }));
}

export function langGraphFaultBoundaries(): FaultBoundary[] {
  return boundaries.map((boundary) => ({ ...boundary }));
}
