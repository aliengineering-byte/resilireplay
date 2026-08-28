#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateOfficialConformanceAttachment } from "./official-conformance-lib.mjs";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node validate-official-conformance.mjs <attachment.json>");
  process.exit(2);
}
try {
  const result = await validateOfficialConformanceAttachment(
    JSON.parse(await readFile(resolve(path), "utf8")),
  );
  console.log(JSON.stringify(result));
  process.exit(result.valid ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
