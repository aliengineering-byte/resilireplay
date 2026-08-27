#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateBundle } from "./lib.mjs";

const [input] = process.argv.slice(2);
if (!input) {
  console.error("Usage: node validate.mjs <mcp-res-bundle.json>");
  process.exitCode = 2;
} else {
  try {
    const path = resolve(input);
    const bundle = JSON.parse(await readFile(path, "utf8"));
    const result = await validateBundle(bundle);
    process.stdout.write(`${JSON.stringify({ file: path, ...result })}\n`);
    process.exitCode = result.valid ? 0 : 1;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ valid: false, diagnostics: ["MCP_RES_INPUT_INVALID"], message: error instanceof Error ? error.message : String(error) })}\n`,
    );
    process.exitCode = 2;
  }
}
