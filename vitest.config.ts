import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@resilireplay/core": `${root}packages/core/src/index.ts`,
      "@resilireplay/trace": `${root}packages/trace/src/index.ts`,
      "@resilireplay/reporters": `${root}packages/reporters/src/index.ts`,
      "@resilireplay/mcp-chaos": `${root}packages/mcp-chaos/src/index.ts`,
      "@resilireplay/campaign": `${root}packages/campaign/src/index.ts`,
      "@resilireplay/studio": `${root}packages/studio/src/index.ts`,
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/bin.ts", "**/index.ts"],
    },
  },
});
