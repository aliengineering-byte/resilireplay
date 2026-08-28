#!/usr/bin/env node
import { resolve } from "node:path";
import { validateAttestedBundle } from "./attestation-lib.mjs";
import { readInertJson } from "./safe-json.mjs";

const args = process.argv.slice(2);
const input = args[0];
const trustIndex = args.indexOf("--trust-policy");
if (!input) {
  console.error(
    "Usage: node validate-attestation.mjs <attested-bundle.json> [--trust-policy policy.json]",
  );
  process.exitCode = 2;
} else {
  try {
    const wrapper = await readInertJson(resolve(input));
    const trustPolicy =
      trustIndex >= 0 ? await readInertJson(resolve(args[trustIndex + 1])) : undefined;
    const result = await validateAttestedBundle(wrapper, { trustPolicy });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.valid ? 0 : 1;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ valid: false, diagnostics: ["MCP_RES_INPUT_INVALID"], message: error instanceof Error ? error.message : String(error) })}\n`,
    );
    process.exitCode = 2;
  }
}
