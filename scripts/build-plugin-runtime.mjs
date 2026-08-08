import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "plugins/resilireplay/runtime/hook-runtime.mjs");
await mkdir(resolve(root, "plugins/resilireplay/runtime"), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: [resolve(root, "packages/agent/src/plugin-hook.ts")],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  legalComments: "none",
  logLevel: "silent",
});
