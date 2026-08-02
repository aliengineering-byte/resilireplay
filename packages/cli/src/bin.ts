#!/usr/bin/env node
import { runCli } from "./index.js";

runCli().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : stableError(error);
  console.error(`resilireplay: ${message}`);
  process.exitCode = exitCode(error);
});

function exitCode(error: unknown): number {
  if (
    typeof error === "object" &&
    error !== null &&
    "exitCode" in error &&
    typeof error.exitCode === "number" &&
    Number.isInteger(error.exitCode)
  ) {
    return error.exitCode;
  }
  return 1;
}

function stableError(error: unknown): string {
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
