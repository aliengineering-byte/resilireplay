import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { containsLikelySecret, safeOutputPath, sanitize } from "@resilireplay/core";

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
