#!/usr/bin/env node
import { runCli } from "./index.js";

runCli().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : stableError(error);
  console.error(`resilireplay: ${message}`);
  process.exitCode = 1;
});

function stableError(error: unknown): string {
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
