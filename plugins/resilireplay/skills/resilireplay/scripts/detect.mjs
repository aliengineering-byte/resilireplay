#!/usr/bin/env node
import { access } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const markers = {
  "claude-code": [".claude/settings.json", ".claude/settings.local.json"],
  codex: [".codex/hooks.json", ".codex/config.toml"],
  hermes: [".hermes/config.yaml", ".hermes/config.yml"],
};
const detected = [];
for (const [agent, paths] of Object.entries(markers)) {
  if (
    await Promise.any(paths.map((path) => access(resolve(root, path)))).then(
      () => true,
      () => false,
    )
  )
    detected.push(agent);
}
process.stdout.write(
  `${JSON.stringify({ schemaVersion: "resilireplay.skill-detection/v1", detected, valuesExposed: false })}\n`,
);
