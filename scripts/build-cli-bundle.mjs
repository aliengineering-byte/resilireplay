import { build } from "esbuild";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

await build({
  entryPoints: [resolve(root, "packages/cli/dist/bin.js")],
  outfile: resolve(root, "packages/cli/dist/resilireplay.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "bundle",
  banner: {
    js: 'import { createRequire as __resilireplayCreateRequire } from "node:module"; const require = __resilireplayCreateRequire(import.meta.url);',
  },
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
});
