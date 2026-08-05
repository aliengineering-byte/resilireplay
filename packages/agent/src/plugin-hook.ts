import { captureIngest } from "./capture.js";
import { MAX_HOOK_BYTES, normalizeHookEvent } from "./normalize.js";
import { AgentSourceSchema } from "./schemas.js";

export async function runPluginHook(
  sourceInput: string | undefined,
  root = process.cwd(),
): Promise<void> {
  const source = AgentSourceSchema.parse(sourceInput);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += value.length;
    if (total > MAX_HOOK_BYTES) throw new Error(`Hook input exceeds ${MAX_HOOK_BYTES} bytes`);
    chunks.push(value);
  }
  let input: string;
  try {
    input = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new Error("Hook input is not valid UTF-8");
  }
  const payload = JSON.parse(input.replace(/^\uFEFF/u, "")) as unknown;
  const event = normalizeHookEvent(payload, { source });
  if (event) await captureIngest(event, root);
}
