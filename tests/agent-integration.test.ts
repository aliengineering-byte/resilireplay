import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureIngest,
  captureLast,
  captureStart,
  captureStatus,
  captureStop,
  connectAgent,
  generateCapturedRegression,
  initAdapter,
  normalizeHookEvent,
  planConnection,
  rollbackConnection,
  verifyAdapter,
} from "@resilireplay/agent";

const temporary: string[] = [];
async function directory(label: string): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), `resilireplay-${label}-`));
  temporary.push(value);
  return value;
}
afterEach(async () =>
  Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
);

function failure(id: string, receivedAt = "2026-08-05T12:00:00.000Z") {
  return normalizeHookEvent(
    {
      hook_event_name: "PostToolUseFailure",
      session_id: "private-session-name",
      tool_name: "Bash; rm -rf /",
      tool_use_id: id,
      tool_input: {
        command: "false",
        Authorization: ["Bearer", "abcdefghijklmnopqrstuvwxyz"].join(" "),
      },
      error: "Exited code 7 at C:\\Users\\private\\project token=do-not-store-this-secret-value",
      duration_ms: 19,
    },
    { source: "claude-code", receivedAt },
  )!;
}

describe("canonical agent capture", () => {
  it("is inert while off and excludes raw secrets, paths, and identifiers", async () => {
    const root = await directory("off");
    const event = failure("call-1");
    expect(await captureIngest(event, root)).toBe("off");
    expect(await captureStatus(root)).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain("private-session-name");
    expect(JSON.stringify(event)).not.toContain("do-not-store");
    expect(JSON.stringify(event)).not.toContain("C:\\Users\\private");
    expect(event.summary).toContain("[REDACTED]");
    expect(event.summary).toContain("[PATH]");
  });

  it("deduplicates repeated tool IDs and recovers a partial journal", async () => {
    const root = await directory("journal");
    await captureStart(root);
    expect(await captureIngest(failure("same"), root)).toBe("captured");
    expect(await captureIngest(failure("same", "2026-08-05T12:01:00.000Z"), root)).toBe(
      "duplicate",
    );
    const journal = resolve(root, ".resilireplay/capture/events.jsonl");
    await writeFile(journal, `${await readFile(journal, "utf8")}{partial`, "utf8");
    expect(await captureIngest(failure("next"), root)).toBe("captured");
    const lines = (await readFile(journal, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => JSON.parse(line))).toBe(true);
  });

  it("serializes concurrent writers and generates an executable regression", async () => {
    const root = await directory("concurrent");
    await captureStart(root);
    const outcomes = await Promise.all(
      Array.from({ length: 80 }, (_, index) => captureIngest(failure(`call-${index}`), root)),
    );
    expect(outcomes.every((value) => value === "captured")).toBe(true);
    expect((await captureStatus(root))?.eventCount).toBe(80);
    expect((await captureLast(root))?.errorClass).toBe("process-exit");
    const generated = await generateCapturedRegression("generated/failure.test.mjs", root);
    const run = spawnSync(process.execPath, ["--test", generated.testPath], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    });
    expect(run.status, run.stderr).toBe(0);
    const original = await readFile(generated.testPath, "utf8");
    await expect(generateCapturedRegression("generated/failure.test.mjs", root)).rejects.toThrow(
      "refusing to overwrite",
    );
    expect(await readFile(generated.testPath, "utf8")).toBe(original);
    await expect(generateCapturedRegression("../escape.test.mjs", root)).rejects.toThrow(
      "inside the repository",
    );
    expect((await captureStop(root))?.status).toBe("stopped");
  }, 20_000);

  it("rejects a symlinked capture escape", async () => {
    const root = await directory("root");
    const outside = await directory("outside");
    await symlink(
      outside,
      resolve(root, ".resilireplay"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(captureStart(root)).rejects.toThrow("Symlinked capture paths");
  });
});

describe("Codex PostToolUse classification", () => {
  const codex = (response: unknown, extra: Record<string, unknown> = {}) =>
    normalizeHookEvent(
      {
        hook_event_name: "PostToolUse",
        session_id: "codex-session",
        tool_name: "fixture-tool",
        tool_use_id: "fixture-call",
        tool_input: { value: "safe" },
        tool_response: response,
        ...extra,
      },
      { source: "codex", receivedAt: "2026-08-05T12:00:00.000Z" },
    );

  it("distinguishes shell, MCP, file-edit, interruption, and hosted-tool outcomes", () => {
    expect(codex({ exit_code: 7, stderr: "non-zero process exit" })?.outcome).toBe("failed");
    expect(codex({ isError: true, message: "MCP protocol failure" })?.errorClass).toBe("protocol");
    expect(codex({ isError: false, content: [{ type: "text", text: "ok" }] })?.outcome).toBe(
      "succeeded",
    );
    expect(codex({ success: true }, { tool_name: "apply_patch" })?.outcome).toBe("succeeded");
    expect(codex({ interrupted: true })?.outcome).toBe("interrupted");
    expect(codex({ success: false }, { tool_kind: "hosted" })).toBeUndefined();
  });

  it("bounds oversized and secret-shaped responses before persistence", () => {
    const event = codex({
      success: false,
      error: `authorization=${["Bearer", "abcdefghijklmnopqrstuvwxyz"].join(" ")} ${"x".repeat(2_000_000)}`,
    });
    expect(event?.summary?.length).toBeLessThanOrEqual(512);
    expect(event?.summary).toContain("[REDACTED]");
    expect(JSON.stringify(event)).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("redacts injected tool names, UNC paths, and encoded-secret markers", () => {
    const event = codex(
      {
        success: false,
        error: "base64:YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo= at \\\\server\\private\\artifact",
      },
      { tool_name: "Bash; touch should-never-run" },
    );
    expect(event?.toolName).toBe("Bash; touch should-never-run");
    expect(event?.summary).toContain("[REDACTED]");
    expect(event?.summary).toContain("[PATH]");
  });

  it("rejects malformed UTF-8 hook input without creating capture state", async () => {
    const root = await directory("utf8");
    const cli = resolve("packages/cli/dist/resilireplay.js");
    const malformed = Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]);
    const run = spawnSync(process.execPath, [cli, "hook", "ingest", "--agent", "codex"], {
      cwd: root,
      input: malformed,
      encoding: "utf8",
      windowsHide: true,
    });
    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toContain("valid UTF-8");
    expect(await captureStatus(root)).toBeUndefined();
  });
});

describe("adapter and connection contracts", () => {
  it("initializes and verifies the minimal adapter without overwriting", async () => {
    const root = await directory("adapter");
    const target = await initAdapter("example-adapter", root);
    const result = await verifyAdapter(target);
    expect(result.compatible).toBe(true);
    expect(result.checks).toContain("privacy-redaction");
    await expect(initAdapter("example-adapter", root)).rejects.toThrow("already exists");
  });

  it("rejects an adapter directory that redirects to an untrusted path", async () => {
    const root = await directory("adapter-root");
    const outside = await directory("adapter-outside");
    await initAdapter("external-adapter", outside);
    const redirected = resolve(root, "redirected-adapter");
    await symlink(
      resolve(outside, "external-adapter"),
      redirected,
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(verifyAdapter(redirected)).rejects.toThrow("Symlinked adapter directories");
  });

  it("dry-runs without writes, applies the smallest merge, and rolls back exactly", async () => {
    const root = await directory("connect");
    const settings = resolve(root, ".claude/settings.json");
    await mkdir(dirname(settings), { recursive: true });
    const original = `${JSON.stringify({ permissions: { allow: ["Read"] } }, null, 2)}\n`;
    await writeFile(settings, original, "utf8");
    const preview = await planConnection({ agent: "claude-code", dryRun: true }, root);
    expect(preview.plan.changes).toHaveLength(1);
    expect(await readFile(settings, "utf8")).toBe(original);
    const applied = await connectAgent({ agent: "claude-code", yes: true }, root);
    expect(applied.backupId).toBeTruthy();
    const changed = JSON.parse(await readFile(settings, "utf8")) as {
      permissions: unknown;
      hooks: unknown;
    };
    expect(changed.permissions).toEqual({ allow: ["Read"] });
    expect(changed.hooks).toBeTruthy();
    await rollbackConnection(root, applied.backupId);
    expect(await readFile(settings, "utf8")).toBe(original);
  });

  it("rejects configuration and backup parents that escape through a junction", async () => {
    const root = await directory("connect-root");
    const outside = await directory("connect-outside");
    await symlink(
      outside,
      resolve(root, ".claude"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(planConnection({ agent: "claude-code", dryRun: true }, root)).rejects.toThrow(
      "Symlinked connection paths",
    );
    expect(await readFile(resolve(outside, "settings.json"), "utf8").catch(() => undefined)).toBe(
      undefined,
    );
  });

  it("stages Hermes integration without touching its global profile", async () => {
    const root = await directory("hermes-stage");
    const preview = await planConnection({ agent: "hermes", dryRun: true }, root);
    expect(preview.plan.changes.map((change) => change.path)).toEqual([".mcp.json"]);
    expect(preview.plan.warnings.join(" ")).toContain("hermes mcp add");
    expect(preview.plan.warnings.join(" ")).toContain("never edits the global Hermes profile");
    expect(await readFile(resolve(root, ".mcp.json"), "utf8").catch(() => undefined)).toBe(
      undefined,
    );
  });
});
