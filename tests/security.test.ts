import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  containsLikelySecret,
  prepareContainedOutputDirectory,
  prepareContainedOutputFile,
  resolveContainedOutputPath,
  safeOutputPath,
  sanitize,
} from "@resilireplay/core";

describe("security boundaries", () => {
  it("redacts authorization headers, keys, and token-shaped strings", () => {
    const bearer = ["Bearer", "abcdefghijklmnopqrstuvwxyz123456"].join(" ");
    const modelKey = ["sk", "abcdefghijklmnopqrstuvwxyz123456"].join("-");
    const value = sanitize({
      Authorization: bearer,
      nested: { api_key: "never-store-me" },
      text: `token ${modelKey}`,
    });
    expect(JSON.stringify(value)).not.toContain("never-store-me");
    expect(JSON.stringify(value)).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(JSON.stringify(value)).toContain("[REDACTED]");
    expect(containsLikelySecret(value)).toBe(false);
    expect(containsLikelySecret({ api_key: "non-token-shaped-canary" })).toBe(true);
  });

  it("redacts encoded credentials and credential-shaped key suffixes", () => {
    const encoded = Buffer.from(["fixture-user", "fixture-password"].join(":"), "utf8").toString(
      "base64",
    );
    const urlEncodedModelKey = ["sk%2D", "abcdefghijklmnopqrstuvwxyz123456"].join("");
    const value = sanitize({
      SERVICE_API_KEY_BACKUP: "must-not-survive",
      basic: `Basic ${encoded}`,
      encoded: `base64:${encoded}`,
      urlEncoded: urlEncodedModelKey,
    });
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain("must-not-survive");
    expect(serialized).not.toContain(encoded);
    expect(serialized).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(serialized.match(/\[REDACTED\]/gu)?.length).toBeGreaterThanOrEqual(4);
    expect(containsLikelySecret(value)).toBe(false);
  });

  it("redacts bounded unlabelled encodings while preserving useful diagnostics", () => {
    const modelKey = `sk-${"A".repeat(24)}`;
    const bearer = `Bearer ${"b".repeat(24)}`;
    const encodedModelKey = Buffer.from(modelKey, "utf8").toString("base64");
    const unpaddedBase64UrlModelKey = Buffer.from(modelKey, "utf8").toString("base64url");
    const ordinaryBase64 = Buffer.from("ordinary diagnostic text", "utf8").toString("base64");
    const value = sanitize({
      operation: "tools/list",
      status: "failed",
      quoted: `failure: "${modelKey}"`,
      unlabelledBase64: encodedModelKey,
      unlabelledBase64Url: unpaddedBase64UrlModelKey,
      percentEncoded: encodeURIComponent(bearer),
      multiline: `header:\n${bearer}`,
      mixedCase: `bEaReR ${"c".repeat(24)}`,
      access_token_part_one: "split-prefix",
      access_token_part_two: "split-suffix",
      ordinaryBase64,
    });
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain(modelKey);
    expect(serialized).not.toContain(encodedModelKey);
    expect(serialized).not.toContain(unpaddedBase64UrlModelKey);
    expect(serialized).not.toContain("split-prefix");
    expect(serialized).not.toContain("split-suffix");
    expect(serialized).toContain("tools/list");
    expect(serialized).toContain("failed");
    expect(serialized).toContain(ordinaryBase64);
    expect(containsLikelySecret({ value: encodedModelKey })).toBe(true);
    expect(containsLikelySecret({ value: unpaddedBase64UrlModelKey })).toBe(true);
    expect(containsLikelySecret({ value: ordinaryBase64 })).toBe(false);
    expect(containsLikelySecret(undefined)).toBe(false);
  });

  it("scans an oversized benign base64-like run in bounded linear space", () => {
    const benign = "x".repeat(1024 * 1024);
    expect(containsLikelySecret({ diagnostic: benign })).toBe(false);
    expect(sanitize({ diagnostic: benign })).toEqual({ diagnostic: benign });
  });

  it("rejects output path traversal", () => {
    const base = resolve("safe-output");
    expect(() => safeOutputPath(base, "../escape.json")).toThrow("escapes");
    expect(() => safeOutputPath(base, resolve("elsewhere.json"))).toThrow("escapes");
    expect(() => safeOutputPath(base, join(tmpdir(), "resilireplay-outside.json"))).toThrow(
      "escapes",
    );
    if (process.platform === "win32") {
      const alternateDrive = base.toUpperCase().startsWith("C:") ? "D:" : "C:";
      expect(() => safeOutputPath(base, `${alternateDrive}\\escape.json`)).toThrow("escapes");
    }
    expect(safeOutputPath(base, "nested/report.json")).toContain("nested");
  });

  it("rejects linked output directories and keeps the normal-directory negative control contained", async () => {
    const root = await mkdtemp(join(tmpdir(), "resilireplay-containment-root-"));
    const outside = await mkdtemp(join(tmpdir(), "resilireplay-containment-outside-"));
    const linked = join(root, "linked-output");
    try {
      try {
        await symlink(outside, linked, process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") return;
        throw error;
      }
      await expect(prepareContainedOutputDirectory(root, linked)).rejects.toMatchObject({
        code: "RR_OUTPUT_CONTAINMENT",
      });
      const ordinary = await prepareContainedOutputDirectory(root, "ordinary/nested");
      expect(ordinary).toBe(resolve(root, "ordinary/nested"));
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects dangling links, file-directory confusion, and a parent swapped after validation", async () => {
    const root = await mkdtemp(join(tmpdir(), "resilireplay-revalidation-root-"));
    const outside = await mkdtemp(join(tmpdir(), "resilireplay-revalidation-outside-"));
    try {
      const regularFile = join(root, "regular-file");
      await writeFile(regularFile, "negative control", "utf8");
      await expect(prepareContainedOutputDirectory(root, regularFile)).rejects.toMatchObject({
        code: "RR_OUTPUT_CONTAINMENT",
      });
      const regularDirectory = join(root, "regular-directory");
      await mkdir(regularDirectory);
      await expect(prepareContainedOutputFile(root, regularDirectory)).rejects.toMatchObject({
        code: "RR_OUTPUT_CONTAINMENT",
      });

      const dangling = join(root, "dangling");
      const plannedTarget = join(root, "missing-target");
      let danglingCreated = true;
      try {
        await symlink(plannedTarget, dangling, process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
        danglingCreated = false;
      }
      if (danglingCreated) {
        await expect(prepareContainedOutputDirectory(root, dangling)).rejects.toMatchObject({
          code: "RR_OUTPUT_CONTAINMENT",
        });
      }

      const parent = join(root, "replaceable");
      await mkdir(parent);
      const output = join(parent, "result.json");
      expect(await resolveContainedOutputPath(root, output)).toBe(output);
      await rm(parent, { recursive: true, force: true });
      try {
        await symlink(outside, parent, process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") return;
        throw error;
      }
      await expect(prepareContainedOutputFile(root, output)).rejects.toMatchObject({
        code: "RR_OUTPUT_CONTAINMENT",
      });
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "win32")(
    "rejects Windows aliases and drive-relative outputs",
    () => {
      const base = resolve("safe-output");
      expect(() => safeOutputPath(base, "CON/report.json")).toThrow("reserved Windows name");
      expect(() => safeOutputPath(base, "C:drive-relative.json")).toThrow("Drive-relative");
      expect(() => safeOutputPath(base, "nested/name. ")).toThrow("reserved Windows name");
    },
  );

  it("keeps deterministic demo network-free", async () => {
    const content = await readFile(resolve("scripts/demo.mjs"), "utf8");
    expect(content).not.toMatch(/\bfetch\s*\(/u);
    expect(content).not.toMatch(/https?:\/\//u);
  });

  it("replaces circular metadata without retaining object references", () => {
    const value: { safe: boolean; self?: unknown } = { safe: true };
    value.self = value;
    expect(sanitize(value)).toEqual({ safe: true, self: "[CIRCULAR]" });
  });
});
