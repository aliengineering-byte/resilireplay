#!/usr/bin/env node
import { cp, lstat, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const index = process.argv.indexOf("--target");
if (index < 0 || !process.argv[index + 1])
  throw new Error("Usage: install.mjs --target <directory>");
const source = resolve(import.meta.dirname, "..");
const target = resolve(process.cwd(), process.argv[index + 1]);
const rel = relative(resolve(process.cwd()), target);
if (rel.startsWith("..") || isAbsolute(rel))
  throw new Error("Target must stay inside the current repository");
try {
  await lstat(target);
  throw new Error("Target already exists; refusing to overwrite it");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await mkdir(dirname(target), { recursive: true });
await cp(source, target, { recursive: true, errorOnExist: true });
process.stdout.write(`Installed ResiliReplay skill at ${rel.replaceAll("\\", "/")}\n`);
