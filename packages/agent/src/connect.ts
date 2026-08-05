import { access, lstat, mkdir, readFile, readdir, realpath, rm, rmdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { stableStringify } from "@resilireplay/core";
import { atomicWritePublic } from "./internal-write.js";
import type { AgentSource } from "./schemas.js";

export type ConnectAgent = Exclude<AgentSource, "generic"> | "auto";

export interface ConnectChange {
  path: string;
  operation: "create" | "update";
  sha256Before?: string;
  sha256After: string;
  description: string;
  details: string[];
}

export interface ConnectPlan {
  schemaVersion: "resilireplay.connect-plan/v1";
  agent: ConnectAgent;
  detected: Exclude<ConnectAgent, "auto">[];
  dryRun: boolean;
  captureArmed: false;
  changes: ConnectChange[];
  warnings: string[];
}

interface PlannedFile extends ConnectChange {
  absolute: string;
  content: string;
  original?: string;
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function inside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

async function rejectSymlinkComponents(root: string, candidate: string): Promise<void> {
  if (!inside(root, candidate)) throw new Error("Connect target escaped the repository root");
  const segments = relative(root, candidate).split(/[\\/]/u).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error("Symlinked connection paths are not allowed");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function optionalRead(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function parseObject(raw: string | undefined, label: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error(`${label} must contain a JSON object before ResiliReplay can update it`);
  }
}

function hookCommand(source: Exclude<ConnectAgent, "auto">): string {
  return `npx --yes resilireplay@0.5.0 hook ingest --agent ${source}`;
}

function mergeHook(
  original: Record<string, unknown>,
  events: string[],
  source: Exclude<ConnectAgent, "auto">,
): Record<string, unknown> {
  const hooks =
    typeof original.hooks === "object" && original.hooks !== null && !Array.isArray(original.hooks)
      ? { ...(original.hooks as Record<string, unknown>) }
      : {};
  for (const event of events) {
    const current = Array.isArray(hooks[event]) ? [...(hooks[event] as unknown[])] : [];
    const command = hookCommand(source);
    const already = current.some((entry) => stableStringify(entry).includes(command));
    if (!already)
      current.push({ matcher: "*", hooks: [{ type: "command", command, timeout: 10 }] });
    hooks[event] = current;
  }
  return { ...original, hooks };
}

function mergeMcp(original: Record<string, unknown>): Record<string, unknown> {
  const servers =
    typeof original.mcpServers === "object" &&
    original.mcpServers !== null &&
    !Array.isArray(original.mcpServers)
      ? { ...(original.mcpServers as Record<string, unknown>) }
      : {};
  servers.resilireplay = {
    command: "npx",
    args: ["--yes", "resilireplay@0.5.0", "mcp", "serve"],
  };
  return { ...original, mcpServers: servers };
}

async function detect(root: string): Promise<Exclude<ConnectAgent, "auto">[]> {
  const probes: Array<[Exclude<ConnectAgent, "auto">, string[]]> = [
    ["claude-code", [".claude/settings.json", ".claude/settings.local.json"]],
    ["codex", [".codex/hooks.json", ".codex/config.toml"]],
    ["hermes", [".hermes/config.yaml", ".hermes/config.yml"]],
  ];
  const found: Exclude<ConnectAgent, "auto">[] = [];
  for (const [agent, entries] of probes) {
    if (
      await Promise.any(entries.map((entry) => access(resolve(root, entry)))).then(
        () => true,
        () => false,
      )
    )
      found.push(agent);
  }
  return found;
}

async function plannedFile(
  root: string,
  relativePath: string,
  content: string,
  description: string,
  details: string[],
): Promise<PlannedFile> {
  const absolute = resolve(root, relativePath);
  if (!inside(root, absolute)) throw new Error("Connect target escaped the repository root");
  await rejectSymlinkComponents(root, absolute);
  const original = await optionalRead(absolute);
  return {
    absolute,
    path: relativePath.replaceAll("\\", "/"),
    operation: original === undefined ? "create" : "update",
    ...(original === undefined ? {} : { original, sha256Before: sha(original) }),
    sha256After: sha(content),
    content,
    description,
    details,
  };
}

async function listFiles(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await listFiles(path)));
    else if (entry.isFile()) output.push(path);
  }
  return output.sort();
}

export interface ConnectOptions {
  agent: ConnectAgent;
  dryRun?: boolean;
  yes?: boolean;
  skillSource?: string;
}

export async function planConnection(
  options: ConnectOptions,
  rootInput = process.cwd(),
): Promise<{ plan: ConnectPlan; files: PlannedFile[] }> {
  const root = resolve(rootInput);
  const detected = await detect(root);
  const selected = options.agent === "auto" ? detected : [options.agent];
  const files: PlannedFile[] = [];
  for (const agent of selected) {
    if (agent === "claude-code") {
      const path = ".claude/settings.json";
      const raw = await optionalRead(resolve(root, path));
      const next = mergeHook(
        parseObject(raw, path),
        ["PostToolUse", "PostToolUseFailure", "Stop"],
        agent,
      );
      files.push(
        await plannedFile(
          root,
          path,
          `${JSON.stringify(next, null, 2)}\n`,
          "Install passive Claude Code hooks",
          ["PostToolUse", "PostToolUseFailure", "Stop"].map(
            (event) =>
              `append hooks.${event}: matcher=*; type=command; command=${hookCommand(agent)}; timeout=10s`,
          ),
        ),
      );
    } else if (agent === "codex") {
      const path = ".codex/hooks.json";
      const raw = await optionalRead(resolve(root, path));
      const next = mergeHook(parseObject(raw, path), ["PostToolUse", "Stop"], agent);
      files.push(
        await plannedFile(
          root,
          path,
          `${JSON.stringify(next, null, 2)}\n`,
          "Install passive Codex hooks",
          ["PostToolUse", "Stop"].map(
            (event) =>
              `append hooks.${event}: matcher=*; type=command; command=${hookCommand(agent)}; timeout=10s`,
          ),
        ),
      );
    } else {
      const path = ".mcp.json";
      const raw = await optionalRead(resolve(root, path));
      files.push(
        await plannedFile(
          root,
          path,
          `${JSON.stringify(mergeMcp(parseObject(raw, path)), null, 2)}\n`,
          "Stage a local-first ResiliReplay MCP definition for reviewed Hermes import",
          ["set mcpServers.resilireplay: command=npx; args=--yes,resilireplay@0.5.0,mcp,serve"],
        ),
      );
    }
  }
  if (options.skillSource) {
    const skillSource = resolve(options.skillSource);
    const canonicalSkillSource = resolve(await realpath(skillSource));
    if (
      canonicalSkillSource.localeCompare(skillSource, undefined, {
        sensitivity: process.platform === "win32" ? "accent" : "variant",
      }) !== 0
    )
      throw new Error("Symlinked Agent Skill sources are not allowed");
    for (const sourcePath of await listFiles(skillSource)) {
      const nested = relative(skillSource, sourcePath);
      files.push(
        await plannedFile(
          root,
          [".agents", "skills", "resilireplay", nested].join("/"),
          await readFile(sourcePath, "utf8"),
          "Install the portable ResiliReplay Agent Skill",
          ["write the bundled Apache-2.0 skill file with the displayed sha256After"],
        ),
      );
    }
  }
  const warnings =
    selected.length === 0
      ? [
          "No supported project-local agent configuration was detected; choose --agent claude-code, codex, or hermes.",
        ]
      : [
          "Capture remains off until `resilireplay capture start`.",
          "Hooks observe results only; they never retry or inject failures.",
          ...(selected.includes("hermes")
            ? [
                "Hermes does not auto-discover these repository files; after review run `hermes mcp add resilireplay --command npx --args --yes resilireplay@0.5.0 mcp serve`. ResiliReplay never edits the global Hermes profile.",
              ]
            : []),
        ];
  return {
    plan: {
      schemaVersion: "resilireplay.connect-plan/v1",
      agent: options.agent,
      detected,
      dryRun: options.dryRun ?? false,
      captureArmed: false,
      changes: files.map(
        ({ absolute: _absolute, content: _content, original: _original, ...change }) => change,
      ),
      warnings,
    },
    files,
  };
}

export async function connectAgent(
  options: ConnectOptions,
  rootInput = process.cwd(),
): Promise<ConnectPlan & { backupId?: string }> {
  const root = resolve(rootInput);
  const { plan, files } = await planConnection(options, root);
  if (options.dryRun || files.length === 0) return plan;
  if (!options.yes)
    throw Object.assign(new Error("Review the plan, then rerun with --yes to apply it"), {
      exitCode: 2,
    });
  const backupId = `${new Date().toISOString().replace(/[:.]/gu, "-")}-${sha(stableStringify(plan)).slice(0, 12)}`;
  const backupDirectory = resolve(root, ".resilireplay", "backups", backupId);
  await rejectSymlinkComponents(root, backupDirectory);
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  const manifest = {
    schemaVersion: "resilireplay.connect-backup/v1",
    backupId,
    createdAt: new Date().toISOString(),
    files: files.map((file) => ({
      path: file.path,
      existed: file.original !== undefined,
      ...(file.original === undefined
        ? {}
        : { contentBase64: Buffer.from(file.original).toString("base64") }),
    })),
  };
  await atomicWritePublic(
    resolve(backupDirectory, "manifest.json"),
    `${stableStringify(manifest)}\n`,
  );
  for (const file of files) await atomicWritePublic(file.absolute, file.content);
  await atomicWritePublic(resolve(root, ".resilireplay", "backups", "latest"), `${backupId}\n`);
  return { ...plan, backupId };
}

export async function rollbackConnection(
  rootInput = process.cwd(),
  backupInput?: string,
): Promise<{ backupId: string; restored: string[] }> {
  const root = resolve(rootInput);
  const latest =
    backupInput ??
    (await readFile(resolve(root, ".resilireplay", "backups", "latest"), "utf8")).trim();
  if (!/^[0-9TZ-]+-[a-f0-9]{12}$/u.test(latest))
    throw new Error("Invalid ResiliReplay backup identifier");
  const manifestPath = resolve(root, ".resilireplay", "backups", latest, "manifest.json");
  await rejectSymlinkComponents(root, manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    backupId: string;
    files: Array<{ path: string; existed: boolean; contentBase64?: string }>;
  };
  const restored: string[] = [];
  const createdTargets: string[] = [];
  for (const file of manifest.files) {
    const target = resolve(root, file.path);
    if (!inside(root, target)) throw new Error("Backup target escaped the repository root");
    await rejectSymlinkComponents(root, target);
    if (file.existed && file.contentBase64 !== undefined)
      await atomicWritePublic(target, Buffer.from(file.contentBase64, "base64").toString("utf8"));
    else {
      await rm(target, { force: true });
      createdTargets.push(target);
    }
    restored.push(file.path);
  }
  const directories = new Set<string>();
  for (const target of createdTargets) {
    let current = dirname(target);
    while (current !== root && inside(root, current)) {
      directories.add(current);
      current = dirname(current);
    }
  }
  for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
    await rmdir(directory).catch(() => undefined);
  }
  return { backupId: latest, restored };
}
