const SDK_NAME = "@openai/agents";
const SDK_VERSION = "0.14.3";
const RUN_ITEM_EVENT = "run_item_stream_event";
const COMPLETION_EVENTS = new Set(["run_completed", "run_failed", "run_cancelled"]);
const TOOL_EVENTS = new Set(["tool_output", "tool_error"]);
const HANDOFF_EVENTS = new Set(["handoff_requested", "handoff_occurred"]);

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function text(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0);
}

function runId(value) {
  const root = record(value);
  return text(root.run_id, root.runId);
}

function number(...values) {
  const value = values.find((entry) => typeof entry === "number" && Number.isFinite(entry));
  return value === undefined || value < 0 ? undefined : Math.trunc(value);
}

function outputError(value) {
  const output = record(value);
  return text(output.error, output.message, output.stderr);
}

function eventCandidates(root) {
  if (Array.isArray(root.events)) return root.events;
  if (root.event !== undefined) return [root.event];
  return [];
}

function selectEvent(root) {
  const selectedRunId = runId(root);
  const candidates = eventCandidates(root).filter((candidate) => record(candidate).type);
  const event = candidates.find((candidate) => {
    const candidateRunId = runId(candidate);
    return (
      selectedRunId === undefined ||
      candidateRunId === undefined ||
      candidateRunId === selectedRunId
    );
  });
  if (!event) throw new TypeError("No captured OpenAI Agents event matched run_id");
  return { event: record(event), selectedRunId: selectedRunId ?? runId(event) ?? "session-local" };
}

function eventItem(event) {
  return record(event.item);
}

function rawItem(item) {
  return record(item.rawItem);
}

function handoffTarget(item) {
  const source = record(item.sourceAgent);
  const target = record(item.targetAgent);
  const agent = record(item.agent);
  return text(target.name, agent.name, source.name) ?? "unknown";
}

function eventKind(event) {
  const type = text(event.type);
  const name = text(event.name);
  if (type === RUN_ITEM_EVENT && (TOOL_EVENTS.has(name) || HANDOFF_EVENTS.has(name))) {
    return { type, name };
  }
  if (type && COMPLETION_EVENTS.has(type)) return { type, name };
  if (!type || !name) throw new TypeError("Captured OpenAI Agents event is missing type or name");
  throw new TypeError(`Unsupported OpenAI Agents event: ${type}/${name}`);
}

function isInterrupted(event, item, output) {
  return (
    event.interrupted === true ||
    event.is_interrupt === true ||
    event.isInterrupt === true ||
    item.interrupted === true ||
    output.status === "interrupted" ||
    output.status === "cancelled"
  );
}

function isFailure(event, item, output, error) {
  return (
    Boolean(error) ||
    item.executionStatus === "failed" ||
    output.status === "error" ||
    output.status === "failed" ||
    output.status === "failure"
  );
}

function normalize(payload) {
  const root = record(payload);
  if (root.sdk !== SDK_NAME || text(root.sdk_version, root.sdkVersion) !== SDK_VERSION) {
    throw new TypeError(`Expected ${SDK_NAME}@${SDK_VERSION} capture envelope`);
  }

  const { event, selectedRunId } = selectEvent(root);
  const item = eventItem(event);
  const raw = rawItem(item);
  const kind = eventKind(event);
  const sessionId =
    text(root.session_id, root.sessionId, event.session_id, event.sessionId) ?? selectedRunId;
  const callId = text(
    event.tool_use_id,
    event.toolUseId,
    event.tool_call_id,
    event.toolCallId,
    item.callId,
    item.call_id,
    raw.callId,
    raw.call_id,
  );
  const parentId = text(event.parent_id, event.parentId, item.parentId, raw.parentId);
  const input = item.input ?? event.input ?? raw.arguments;
  const outputValue = item.output ?? raw.output;
  const output = record(outputValue);
  const error = text(event.error, item.error, raw.error, outputError(outputValue));
  const interrupted = !COMPLETION_EVENTS.has(kind.type) && isInterrupted(event, item, output);
  const failure =
    !COMPLETION_EVENTS.has(kind.type) && (interrupted || isFailure(event, item, output, error));
  const durationMs = number(event.duration_ms, event.durationMs, item.duration_ms, item.durationMs);

  if (COMPLETION_EVENTS.has(kind.type)) {
    return {
      hook_event_name: "SessionEnd",
      session_id: sessionId,
      tool_response: { status: text(event.status) ?? kind.type.replace("run_", "") },
    };
  }

  const handoff = HANDOFF_EVENTS.has(kind.name);
  const toolName = handoff
    ? `handoff:${handoffTarget(item)}`
    : text(event.tool_name, event.toolName, item.tool_name, item.toolName, item.name, raw.name);
  const adapted = {
    hook_event_name: failure ? "PostToolUseFailure" : "PostToolUse",
    session_id: sessionId,
    ...(toolName === undefined ? {} : { tool_name: toolName }),
    ...(callId === undefined ? {} : { tool_use_id: callId }),
    ...(parentId === undefined ? {} : { parent_id: parentId }),
    ...(input === undefined ? {} : { tool_input: input }),
    ...(durationMs === undefined ? {} : { duration_ms: durationMs }),
    ...(failure
      ? {
          error: error ?? (interrupted ? "interrupted" : "tool output failed"),
          is_interrupt: interrupted,
          tool_response: { success: false },
        }
      : {
          tool_response: {
            success: true,
            ...(handoff ? { handoff_target: handoffTarget(item) } : {}),
            ...(outputValue === undefined ? {} : { output: outputValue }),
          },
        }),
  };
  return adapted;
}

export { normalize };
