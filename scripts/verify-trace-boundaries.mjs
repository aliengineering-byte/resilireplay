import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createEvent, hashValue, stableStringify } from "../packages/core/dist/index.js";
import {
  MAX_TRACE_BYTES,
  MAX_TRACE_EVENTS,
  MAX_TRACE_NESTING_DEPTH,
  parseTrace,
  serializeTrace,
} from "../packages/trace/dist/index.js";

const reportPath = new URL("../.artifacts/hardening/trace-boundaries.json", import.meta.url);

function fixedEvent(sequence, type, payload) {
  return createEvent({
    runId: "trace-boundary-run",
    stepId: `step-${sequence}`,
    sequence,
    timestamp: "2026-08-27T00:00:00.000Z",
    type,
    actor: "trace-boundary-gate",
    payload,
  });
}

function exactByteTrace(targetBytes) {
  const base = fixedEvent(0, "run_started", "");
  const empty = `${stableStringify(base)}\n`;
  const paddingBytes = targetBytes - Buffer.byteLength(empty, "utf8");
  if (paddingBytes < 0) throw new Error("Target is smaller than the minimal trace");
  const payload = "x".repeat(paddingBytes);
  const event = { ...base, payload, payloadHash: hashValue(payload) };
  const trace = `${stableStringify(event)}\n`;
  if (Buffer.byteLength(trace, "utf8") !== targetBytes) {
    throw new Error(`Unable to construct an exact ${targetBytes}-byte trace`);
  }
  return trace;
}

function nestedPayload(levels) {
  let value = "leaf";
  for (let index = 0; index < levels; index += 1) value = { child: value };
  return value;
}

function measure(name, operation) {
  const rssBefore = process.memoryUsage().rss;
  const started = performance.now();
  const result = operation();
  const durationMs = Number((performance.now() - started).toFixed(2));
  const rssAfter = process.memoryUsage().rss;
  return {
    name,
    durationMs,
    rssBefore,
    rssAfter,
    rssDelta: rssAfter - rssBefore,
    ...result,
  };
}

const below = exactByteTrace(MAX_TRACE_BYTES - 1);
const at = exactByteTrace(MAX_TRACE_BYTES);
const byteCases = [
  measure("valid-byte-limit-minus-one", () => ({
    eventCount: parseTrace(below).length,
    inputBytes: Buffer.byteLength(below, "utf8"),
    result: "PASS",
  })),
  measure("valid-byte-limit", () => ({
    eventCount: parseTrace(at).length,
    inputBytes: Buffer.byteLength(at, "utf8"),
    result: "PASS",
  })),
];
let overByteCode;
try {
  parseTrace(`${at} `);
} catch (error) {
  overByteCode = error.code;
}
if (overByteCode !== "RR_TRACE_BYTE_LIMIT") {
  throw new Error(`Expected RR_TRACE_BYTE_LIMIT, received ${String(overByteCode)}`);
}
byteCases.push({
  name: "invalid-byte-limit-plus-one",
  inputBytes: MAX_TRACE_BYTES + 1,
  eventCount: null,
  result: "EXPECTED_FAILURE",
  diagnosticCode: overByteCode,
});

const depthAt = serializeTrace([
  fixedEvent(0, "run_started", nestedPayload(MAX_TRACE_NESTING_DEPTH - 1)),
]);
const depthCase = measure("valid-nesting-limit", () => ({
  eventCount: parseTrace(depthAt).length,
  inputBytes: Buffer.byteLength(depthAt, "utf8"),
  nestingDepth: MAX_TRACE_NESTING_DEPTH,
  result: "PASS",
}));
let overDepthCode;
let depthOverBytes = null;
try {
  const depthOver = serializeTrace([
    fixedEvent(0, "run_started", nestedPayload(MAX_TRACE_NESTING_DEPTH)),
  ]);
  depthOverBytes = Buffer.byteLength(depthOver, "utf8");
  parseTrace(depthOver);
} catch (error) {
  overDepthCode = error.code;
}
if (overDepthCode !== "RR_TRACE_NESTING_LIMIT") {
  throw new Error(`Expected RR_TRACE_NESTING_LIMIT, received ${String(overDepthCode)}`);
}

const redactionPayload = { padding: "" };
for (let index = 0; index < 2_048; index += 1) {
  redactionPayload[`authorization_${index}`] = `Bearer secret-canary-${index}`;
}
const redactedBase = fixedEvent(0, "run_started", redactionPayload);
const targetRedactedBytes = MAX_TRACE_BYTES - 1_024;
const currentRedactedBytes = Buffer.byteLength(serializeTrace([redactedBase]), "utf8");
redactedBase.payload.padding = "r".repeat(targetRedactedBytes - currentRedactedBytes);
redactedBase.payloadHash = hashValue(redactedBase.payload);
const redactedTrace = serializeTrace([redactedBase]);
const redactionCase = measure("redaction-heavy-near-limit", () => ({
  eventCount: parseTrace(redactedTrace).length,
  inputBytes: Buffer.byteLength(redactedTrace, "utf8"),
  redactedFieldCount: 2_048,
  containsCanary: redactedTrace.includes("secret-canary"),
  result: "PASS",
}));
if (redactionCase.containsCanary || redactionCase.inputBytes !== targetRedactedBytes) {
  throw new Error("Redaction-heavy boundary construction failed");
}

const duplicateEvents = Array.from({ length: MAX_TRACE_EVENTS }, (_, sequence) =>
  fixedEvent(
    sequence,
    sequence === 0
      ? "run_started"
      : sequence === MAX_TRACE_EVENTS - 1
        ? "run_completed"
        : "model_response",
    { duplicateClass: "bounded-flood" },
  ),
);
const duplicateTrace = serializeTrace(duplicateEvents);
const duplicateCase = measure("duplicate-event-flood-at-limit", () => ({
  eventCount: parseTrace(duplicateTrace).length,
  inputBytes: Buffer.byteLength(duplicateTrace, "utf8"),
  result: "PASS",
}));
let overEventCode;
try {
  serializeTrace([...duplicateEvents, fixedEvent(MAX_TRACE_EVENTS, "run_completed", {})]);
} catch (error) {
  overEventCode = error.code;
}
if (overEventCode !== "RR_TRACE_EVENT_LIMIT") {
  throw new Error(`Expected RR_TRACE_EVENT_LIMIT, received ${String(overEventCode)}`);
}

const report = {
  schemaVersion: "resilireplay-hardening-trace-boundaries/1.0",
  observedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  limits: {
    inputBytes: MAX_TRACE_BYTES,
    events: MAX_TRACE_EVENTS,
    nestingDepth: MAX_TRACE_NESTING_DEPTH,
  },
  cases: [
    ...byteCases,
    depthCase,
    {
      name: "invalid-nesting-limit-plus-one",
      inputBytes: depthOverBytes,
      eventCount: 1,
      result: "EXPECTED_FAILURE",
      diagnosticCode: overDepthCode,
    },
    redactionCase,
    duplicateCase,
    {
      name: "invalid-event-limit-plus-one",
      inputBytes: null,
      eventCount: MAX_TRACE_EVENTS + 1,
      result: "EXPECTED_FAILURE",
      diagnosticCode: overEventCode,
    },
  ],
  finalRss: process.memoryUsage().rss,
};

await mkdir(new URL("../.artifacts/hardening/", import.meta.url), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
