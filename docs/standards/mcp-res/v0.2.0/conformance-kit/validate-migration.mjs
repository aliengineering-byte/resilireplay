#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateMigrationResult } from "./migration-lib.mjs";

const [input] = process.argv.slice(2);
if (!input) {
  console.error("Usage: node validate-migration.mjs <migration-result.json>");
  process.exitCode = 2;
} else {
  try {
    const result = await validateMigrationResult(
      JSON.parse(await readFile(resolve(input), "utf8")),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.valid ? 0 : 1;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ valid: false, diagnostics: ["MCP_RES_INPUT_INVALID"], message: error instanceof Error ? error.message : String(error) })}\n`,
    );
    process.exitCode = 2;
  }
}
