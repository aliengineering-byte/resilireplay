import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";

const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

export class OutputContainmentError extends Error {
  readonly code = "RR_OUTPUT_CONTAINMENT";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OutputContainmentError";
  }
}

function contained(base: string, candidate: string): boolean {
  const relationship = relative(base, candidate);
  return (
    relationship === "" ||
    (relationship !== ".." && !relationship.startsWith(`..${sep}`) && !isAbsolute(relationship))
  );
}

function rejectWindowsAliases(candidate: string): void {
  if (process.platform !== "win32") return;
  if (/^[A-Za-z]:[^\\/]/u.test(candidate)) {
    throw new OutputContainmentError(`Drive-relative output paths are not allowed: ${candidate}`);
  }
  const absolute = resolve(candidate);
  const components = absolute.slice(parse(absolute).root.length).split(/[\\/]/u);
  if (
    components.some(
      (component) =>
        WINDOWS_DEVICE_NAME.test(component) ||
        component.endsWith(".") ||
        component.endsWith(" ") ||
        component.includes(":"),
    )
  ) {
    throw new OutputContainmentError(`Output path uses a reserved Windows name: ${candidate}`);
  }
}

export function safeOutputPath(baseDirectory: string, candidate: string): string {
  rejectWindowsAliases(candidate);
  const base = resolve(baseDirectory);
  const output = isAbsolute(candidate) ? resolve(candidate) : resolve(base, candidate);
  const relationship = relative(base, output);
  if (
    isAbsolute(relationship) ||
    relationship === ".." ||
    relationship.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new OutputContainmentError(`Output path escapes the allowed directory: ${candidate}`);
  }
  return output;
}

async function nearestExistingAncestor(candidate: string): Promise<string> {
  let current = candidate;
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new OutputContainmentError(`Unable to inspect output path: ${candidate}`, {
          cause: error,
        });
      }
      const parent = dirname(current);
      if (parent === current) {
        throw new OutputContainmentError(`Output path has no existing ancestor: ${candidate}`);
      }
      current = parent;
    }
  }
}

export async function resolveContainedOutputPath(
  baseDirectory: string,
  candidate: string,
): Promise<string> {
  const lexicalBase = resolve(baseDirectory);
  let actualBase: string;
  try {
    actualBase = await realpath(lexicalBase);
  } catch (error) {
    throw new OutputContainmentError(`Allowed output root does not exist: ${lexicalBase}`, {
      cause: error,
    });
  }
  // Absolute paths can use an OS alias for the same directory (for example,
  // Windows 8.3 names).  Their lexical spelling is not authoritative, so let
  // the realpath containment check below decide whether they are safe.
  rejectWindowsAliases(candidate);
  const output = isAbsolute(candidate)
    ? resolve(candidate)
    : safeOutputPath(lexicalBase, candidate);
  const ancestor = await nearestExistingAncestor(output);
  const ancestorInfo = await lstat(ancestor);
  if (ancestor === output && ancestorInfo.isSymbolicLink()) {
    throw new OutputContainmentError(`Output path is a symbolic link or junction: ${candidate}`);
  }
  const actualAncestor = await realpath(ancestor);
  if (!contained(actualBase, actualAncestor)) {
    throw new OutputContainmentError(
      `Output path resolves outside the allowed directory: ${candidate}`,
    );
  }
  return output;
}

export async function prepareContainedOutputDirectory(
  baseDirectory: string,
  candidate: string,
): Promise<string> {
  const output = await resolveContainedOutputPath(baseDirectory, candidate);
  try {
    await mkdir(output, { recursive: true });
  } catch (error) {
    throw new OutputContainmentError(`Unable to create output directory: ${candidate}`, {
      cause: error,
    });
  }
  const info = await lstat(output);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new OutputContainmentError(`Output path is not a real directory: ${candidate}`);
  }
  const actualBase = await realpath(resolve(baseDirectory));
  const actualOutput = await realpath(output);
  if (!contained(actualBase, actualOutput)) {
    throw new OutputContainmentError(
      `Output directory resolves outside the allowed directory: ${candidate}`,
    );
  }
  return output;
}

export async function prepareContainedOutputFile(
  baseDirectory: string,
  candidate: string,
): Promise<string> {
  const output = await resolveContainedOutputPath(baseDirectory, candidate);
  await prepareContainedOutputDirectory(baseDirectory, dirname(output));
  try {
    const info = await lstat(output);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new OutputContainmentError(`Output path is not a regular file: ${candidate}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return resolveContainedOutputPath(baseDirectory, output);
}
