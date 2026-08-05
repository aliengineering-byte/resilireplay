#!/usr/bin/env node
import { runCli } from "./index.js";

runCli().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : stableError(error);
  const code = exitCode(error);
  console.error(
    process.argv.includes("--json")
      ? JSON.stringify({ schemaVersion: "1.0", status: "error", error: { code, message } })
      : `resilireplay: ${message}`,
  );
  process.exitCode = code;
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
