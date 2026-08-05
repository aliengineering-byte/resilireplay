#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPluginHook } from "../runtime/hook-runtime.mjs";

const inferredRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const declaredRoot = process.env.PLUGIN_ROOT ?? process.env.CLAUDE_PLUGIN_ROOT ?? inferredRoot;
if (resolve(declaredRoot) !== inferredRoot) throw new Error("Untrusted plugin root");
const dataRoot = process.env.PLUGIN_DATA ?? process.env.CLAUDE_PLUGIN_DATA;
if (dataRoot !== undefined && !resolve(dataRoot)) throw new Error("Invalid plugin data root");
await runPluginHook(process.argv[2], process.cwd());
