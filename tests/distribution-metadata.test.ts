import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("distribution metadata", () => {
  it("exposes one intended root Action with Marketplace-safe metadata", async () => {
    const rootEntries = await readdir(root);
    expect(rootEntries.filter((entry) => ["action.yml", "action.yaml"].includes(entry))).toEqual([
      "action.yml",
    ]);

    const metadata = await readFile(join(root, "action.yml"), "utf8");
    expect(metadata).toContain("name: ResiliReplay — Agent and MCP Reliability Tests\n");
    expect(metadata).toContain("author: Ali\n");
    const description = /^description: (.+)$/mu.exec(metadata)?.[1];
    expect(description?.length).toBeLessThanOrEqual(125);
    expect(description).toContain("deterministic recovery regressions");
    expect(metadata).toContain("branding:\n  icon: activity\n  color: purple\n");
    expect(metadata).not.toMatch(/^outputs:/mu);
    expect(metadata).toContain(
      "scenarios:\n    description: Scenario directory\n    required: false\n    default: scenarios",
    );
    expect(metadata).toContain(
      'campaign:\n    description: Optional campaign YAML/JSON path; when set, the scenario directory is not run\n    required: false\n    default: ""',
    );
    expect(metadata).toContain(
      'campaign-confirmation-hash:\n    description: Exact reviewed hash required only when the campaign allowlists tool calls\n    required: false\n    default: ""',
    );
    expect(metadata).toContain(
      'allow-remote:\n    description: Explicitly confirm that declared non-loopback MCP targets are user-owned\n    required: false\n    default: "false"',
    );
  });

  it("separates immutable Action source from caller-relative inputs", async () => {
    const metadata = await readFile(join(root, "action.yml"), "utf8");
    expect(metadata).toContain("using: composite");
    expect(metadata).toContain("working-directory: ${{ github.action_path }}");
    expect(metadata).toContain("RESILIREPLAY_ACTION_ROOT: ${{ github.action_path }}");
    expect(metadata).toContain('node "$RESILIREPLAY_ACTION_ROOT/packages/cli/dist/bin.js"');
  });

  it("keeps root and package license declarations at Apache-2.0", async () => {
    const rootLicense = await readFile(join(root, "LICENSE"), "utf8");
    expect(rootLicense).toContain("Apache License");
    expect(
      (await readFile(join(root, "packages", "cli", "LICENSE"), "utf8")).replaceAll("\r\n", "\n"),
    ).toBe(rootLicense.replaceAll("\r\n", "\n"));

    const manifests = [join(root, "package.json")];
    for (const entry of await readdir(join(root, "packages"), { withFileTypes: true })) {
      if (entry.isDirectory()) manifests.push(join(root, "packages", entry.name, "package.json"));
    }
    for (const manifest of manifests) {
      const parsed = JSON.parse(await readFile(manifest, "utf8")) as { license?: string };
      expect(parsed.license, manifest).toBe("Apache-2.0");
    }
  });

  it("publishes npm only after the immutable GitHub Release is published", async () => {
    const workflow = await readFile(join(root, ".github", "workflows", "npm-publish.yml"), "utf8");
    expect(workflow).toContain("release:\n    types: [published]");
    expect(workflow).toContain("github.event.release.tag_name");
    expect(workflow).not.toContain('push:\n    tags: ["v*.*.*"]');
  });
});
