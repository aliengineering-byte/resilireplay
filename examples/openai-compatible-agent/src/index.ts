export interface OpenAICompatibleResponse {
  id: string;
  model: string;
  choices: Array<{ message: { role: "assistant"; content: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export function adaptOpenAICompatibleResponse(response: OpenAICompatibleResponse): {
  model: string;
  payload: unknown;
  metadata: Record<string, number>;
} {
  return {
    model: response.model,
    payload: response.choices[0]?.message ?? { role: "assistant", content: "" },
    metadata: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
  };
}
