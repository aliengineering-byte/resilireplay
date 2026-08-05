import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import "./build-plugin-runtime.mjs";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "plugins/resilireplay/skills/resilireplay");
const target = resolve(root, "packages/cli/portable-skill");

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
