import { isAbsolute, relative, resolve } from "node:path";

export function safeOutputPath(baseDirectory: string, candidate: string): string {
  const base = resolve(baseDirectory);
  const output = isAbsolute(candidate) ? resolve(candidate) : resolve(base, candidate);
  const relationship = relative(base, output);
  if (
    relationship === ".." ||
    relationship.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error(`Output path escapes the allowed directory: ${candidate}`);
  }
  return output;
}
