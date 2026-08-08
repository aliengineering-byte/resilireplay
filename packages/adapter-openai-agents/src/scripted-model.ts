import {
  Usage,
  type AgentOutputItem,
  type Model,
  type ModelRequest,
  type ModelResponse,
  type StreamEvent,
} from "@openai/agents";

export type ScriptedStep =
  | ModelResponse
  | Error
  | ((request: ModelRequest, attempt: number) => ModelResponse | Promise<ModelResponse>);

export function textResponse(text: string, responseId = "response-text"): ModelResponse {
  const output: AgentOutputItem[] = [
    {
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text }],
    },
  ];
  return { usage: new Usage(), output, responseId };
}

export function functionCallResponse(
  name: string,
  callId: string,
  argumentsJson: string,
  responseId = `response-${callId}`,
): ModelResponse {
  return {
    usage: new Usage(),
    output: [
      {
        type: "function_call",
        callId,
        name,
        arguments: argumentsJson,
        status: "completed",
      },
    ],
    responseId,
  };
}

function outputText(response: ModelResponse): string {
  const text: string[] = [];
  for (const item of response.output) {
    if (item.type !== "message" || item.role !== "assistant" || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (content.type === "output_text") text.push(content.text);
    }
  }
  return text.join("");
}

function streamUsage(response: ModelResponse) {
  return {
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    totalTokens: response.usage.totalTokens,
    ...(response.usage.requests === undefined ? {} : { requests: response.usage.requests }),
    ...(response.usage.inputTokensDetails === undefined
      ? {}
      : { inputTokensDetails: response.usage.inputTokensDetails }),
    ...(response.usage.outputTokensDetails === undefined
      ? {}
      : { outputTokensDetails: response.usage.outputTokensDetails }),
  };
}

export class ScriptedModel implements Model {
  readonly requests: ModelRequest[] = [];
  private cursor = 0;

  constructor(private readonly steps: readonly ScriptedStep[]) {
    if (steps.length === 0) throw new Error("ScriptedModel requires at least one step.");
  }

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    if (request.signal?.aborted)
      throw request.signal.reason ?? new DOMException("Aborted", "AbortError");
    const attempt = ++this.cursor;
    const step = this.steps[attempt - 1];
    if (step === undefined) throw new Error(`ScriptedModel exhausted at attempt ${attempt}.`);
    if (step instanceof Error) throw step;
    return typeof step === "function" ? await step(request, attempt) : step;
  }

  async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    const response = await this.getResponse(request);
    yield { type: "response_started" };
    const text = outputText(response);
    for (const delta of text.match(/.{1,3}/gu) ?? []) {
      if (request.signal?.aborted) {
        throw request.signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      yield { type: "output_text_delta", itemId: "scripted-message", delta };
    }
    yield {
      type: "response_done",
      response: {
        id: response.responseId ?? `response-${this.cursor}`,
        usage: streamUsage(response),
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text }],
          },
        ],
      },
    };
  }

  attemptCount(): number {
    return this.cursor;
  }
}
