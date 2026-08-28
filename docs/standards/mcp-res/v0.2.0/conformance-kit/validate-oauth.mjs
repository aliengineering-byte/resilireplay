#!/usr/bin/env node
import { resolve } from "node:path";
import { validateOAuthEvaluation } from "./oauth-lib.mjs";
import { readInertJson } from "./safe-json.mjs";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node validate-oauth.mjs <oauth-evaluation.json>");
  process.exit(2);
}
try {
  const result = await validateOAuthEvaluation(await readInertJson(resolve(path)));
  console.log(JSON.stringify(result));
  process.exit(result.valid ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
