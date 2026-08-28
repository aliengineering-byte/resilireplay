#!/usr/bin/env node
import { resolve } from "node:path";
import { validateProfileEvaluation } from "./profile-lib.mjs";
import { readInertJson } from "./safe-json.mjs";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node validate-profile.mjs <evaluation.json>");
  process.exit(2);
}
try {
  const result = await validateProfileEvaluation(await readInertJson(resolve(path)));
  console.log(JSON.stringify(result));
  process.exit(result.valid ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
