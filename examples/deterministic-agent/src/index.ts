function emit(type: string, payload: unknown, extra: Record<string, unknown> = {}): void {
  console.log(
    `RESILIREPLAY_EVENT ${JSON.stringify({ type, actor: "deterministic-agent", payload, ...extra })}`,
  );
}

emit(
  "model_request",
  { prompt: "Add 2 + 2 using the calculator." },
  { model: "local-deterministic" },
);
emit(
  "model_response",
  { tool: "calculator", arguments: { left: 2, right: 2 } },
  { model: "local-deterministic" },
);
emit("tool_requested", { left: 2, right: 2 }, { tool: "calculator" });
emit("tool_result", { value: 4 }, { tool: "calculator" });
emit("validation_result", { valid: true, expected: 4, actual: 4 });
console.log("Deterministic answer: 4");
