import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditMcp,
  classifyInspectorPath,
  loadInspectorConfig,
  MCP_EXIT_CODES,
  McpConnectionError,
  McpRemoteAuthorizationError,
  writeMcpCertification,
  type ImportedInspectorServer,
  type McpAuditOptions,
} from "@resilireplay/mcp-chaos";
import { compileRegression } from "@resilireplay/trace";

const root = resolve(".");
const fixtures = resolve("tests", "fixtures", "mcp-inspector");
const cli = resolve("packages", "cli", "dist", "bin.js");
const httpFixture = resolve("examples", "mcp-http-fixture-server", "dist", "index.js");

async function artifactDirectory(prefix: string): Promise<string> {
  const artifacts = resolve(".artifacts");
  await mkdir(artifacts, { recursive: true });
  return mkdtemp(join(artifacts, prefix));
}

async function importFixture(
  name: string,
  options: {
    serverName?: string;
    allowRemote?: boolean;
    environment?: NodeJS.ProcessEnv;
  } = {},
): Promise<ImportedInspectorServer> {
  return loadInspectorConfig(join(fixtures, name), {
    ...options,
    allowedRoot: root,
  });
}

function importedAuditOptions(
  imported: ImportedInspectorServer,
  extra: Partial<McpAuditOptions> = {},
): McpAuditOptions {
  return {
    ...(imported.transport === "stdio"
      ? {
          stdio: {
            command: imported.command,
            args: imported.args,
            env: imported.env,
            ...(imported.cwd ? { cwd: imported.cwd } : {}),
          },
        }
      : {
          http: {
            url: imported.url,
            headers: imported.headers,
            transport: imported.transport,
          },
        }),
    serverName: imported.serverName,
    sourceConfigSha256: imported.configSha256,
    connectionTimeoutMs: imported.connectionTimeoutMs,
    requestTimeoutMs: imported.requestTimeoutMs,
    ...extra,
  };
}

async function startHttpFixture(mode: string): Promise<{
  url: string;
  authorization: string;
  close: () => Promise<void>;
}> {
  const token = `fixture-${randomUUID()}`;
  const child = spawn(process.execPath, [httpFixture], {
    env: {
      ...process.env,
      RESILIREPLAY_FIXTURE_HTTP_TOKEN: token,
      RESILIREPLAY_FIXTURE_MODE: mode,
      RESILIREPLAY_FIXTURE_PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const url = await new Promise<string>((resolveUrl, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`HTTP fixture startup timed out: ${stderr}`)),
      5_000,
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      reject(new Error(`HTTP fixture exited before readiness (${code}): ${stderr}`));
    });
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const newline = stdout.indexOf("\n");
      if (newline === -1) return;
      clearTimeout(timer);
      const parsed = JSON.parse(stdout.slice(0, newline)) as { url: string };
      resolveUrl(parsed.url);
    });
  });
  return {
    url,
    authorization: `Bearer ${token}`,
    close: async () => {
      if (child.exitCode !== null) return;
      child.kill();
      await Promise.race([
        once(child, "exit"),
        new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}

async function writeHttpConfig(
  directory: string,
  url: string,
  type: "http" | "streamable-http" = "http",
): Promise<string> {
  const path = join(directory, "mcp.json");
  await writeFile(
    path,
    `${JSON.stringify(
      {
        mcpServers: {
          http: {
            type,
            url,
            headers: { Authorization: "${env:RESILIREPLAY_FIXTURE_HTTP_TOKEN}" },
            connectionTimeout: 2_000,
            requestTimeout: 2_000,
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return path;
}

async function allText(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const values: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) values.push(await allText(path));
    else values.push(await readFile(path, "utf8").catch(() => ""));
  }
  return values.join("\n");
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (
      await access(path).then(
        () => true,
        () => false,
      )
    )
      return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function waitForProcessExit(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  return false;
}

describe("MCP Inspector configuration integration", () => {
  it("auto-selects one stdio server and preserves argument boundaries", async () => {
    const imported = await importFixture("stdio-single.json");
    expect(imported.serverName).toBe("resilient-stdio");
    expect(imported.transport).toBe("stdio");
    if (imported.transport !== "stdio") throw new Error("expected stdio fixture");
    expect(imported.args).toHaveLength(1);
    expect(imported.args[0]).toBe(resolve("examples", "resilient-mcp-server", "dist", "index.js"));

    const result = await auditMcp(importedAuditOptions(imported));
    expect(result.passed).toBe(true);
    expect(result.transport).toBe("stdio");
    expect(result.sourceConfigSha256).toBe(imported.configSha256);
  });

  it("requires explicit selection for multiple servers", async () => {
    await expect(importFixture("stdio-multiple.json")).rejects.toMatchObject({
      errorId: "RR_MCP_CONFIG_SELECTION_REQUIRED",
      exitCode: MCP_EXIT_CODES.CONFIG,
    });
    await expect(
      importFixture("stdio-multiple.json", { serverName: "unknown" }),
    ).rejects.toMatchObject({ errorId: "RR_MCP_CONFIG_UNKNOWN_SERVER" });
    const selected = await importFixture("stdio-multiple.json", {
      serverName: "vulnerable-stdio",
    });
    expect(selected.serverName).toBe("vulnerable-stdio");
  });

  it("audits the vulnerable stdio export and executes a path containing spaces", async () => {
    const vulnerable = await importFixture("stdio-vulnerable.json");
    const vulnerableResult = await auditMcp(importedAuditOptions(vulnerable));
    expect(vulnerableResult.passed).toBe(false);
    expect(vulnerableResult.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(["MCP001", "MCP002"]),
    );

    const spaced = await importFixture("stdio-path-spaces.json");
    if (spaced.transport !== "stdio") throw new Error("expected stdio fixture");
    expect(spaced.args[0]).toContain("path with spaces");
    expect(spaced.args[1]).toBe("one argument with spaces");
    expect((await auditMcp(importedAuditOptions(spaced))).passed).toBe(true);
  });

  it("classifies Windows and POSIX paths without cross-platform mangling", () => {
    expect(classifyInspectorPath("C:\\Program Files\\nodejs\\node.exe", "win32")).toBe(
      "native-absolute",
    );
    expect(classifyInspectorPath("C:\\Program Files\\nodejs\\node.exe", "linux")).toBe(
      "foreign-absolute",
    );
    expect(classifyInspectorPath("/opt/mcp/server.js", "linux")).toBe("native-absolute");
    expect(classifyInspectorPath("/opt/mcp/server.js", "win32")).toBe("foreign-absolute");
    expect(classifyInspectorPath("build/server.js", "win32")).toBe("relative");
  });

  it("resolves declared environment references while keeping plans value-free", async () => {
    const secret = `sk-${"fixture".repeat(7)}`;
    const imported = await importFixture("stdio-environment.json", {
      environment: { RESILIREPLAY_FIXTURE_API_KEY: secret },
    });
    if (imported.transport !== "stdio") throw new Error("expected stdio fixture");
    expect(imported.env.API_KEY).toBe(secret);
    expect(imported.env.LITERAL_MODE).toContain("shell syntax");
    const serializedPlan = JSON.stringify(imported.plan);
    expect(serializedPlan).not.toContain(secret);
    expect(serializedPlan).not.toContain("reviewed literal");
    expect(imported.plan.environment).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "API_KEY", source: "variable-reference" }),
        expect.objectContaining({ name: "LITERAL_MODE", source: "literal" }),
      ]),
    );

    const legacySse = await importFixture("sse-legacy.json", {
      environment: { RESILIREPLAY_FIXTURE_HTTP_TOKEN: `Bearer ${secret}` },
    });
    expect(legacySse.transport).toBe("sse");
    expect(legacySse.plan.warnings.join(" ")).toMatch(/deprecated/iu);
    expect(JSON.stringify(legacySse.plan)).not.toContain(secret);
  });

  it("uses authenticated real Streamable HTTP for resilient and controlled-failure servers", async () => {
    for (const mode of ["resilient", "controlled-failure"] as const) {
      const directory = await artifactDirectory(`mcp-http-${mode}-`);
      const fixture = await startHttpFixture(mode);
      try {
        const config = await writeHttpConfig(
          directory,
          fixture.url,
          mode === "resilient" ? "http" : "streamable-http",
        );
        const imported = await loadInspectorConfig(config, {
          allowedRoot: root,
          environment: { RESILIREPLAY_FIXTURE_HTTP_TOKEN: fixture.authorization },
        });
        expect(JSON.stringify(imported.plan)).not.toContain(fixture.authorization);
        expect(imported.plan.headers[0]).toMatchObject({
          name: "Authorization",
          value: "[REDACTED]",
        });
        const result = await auditMcp(importedAuditOptions(imported));
        expect(result.transport).toBe("streamable-http");
        expect(result.passed).toBe(mode === "resilient");
        if (mode === "controlled-failure") {
          expect(result.findings.map((finding) => finding.id)).toEqual(
            expect.arrayContaining(["MCP001", "MCP002"]),
          );
        }
      } finally {
        await fixture.close();
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it("rejects a malformed real Streamable HTTP response and leaves no listener", async () => {
    const directory = await artifactDirectory("mcp-http-malformed-");
    const fixture = await startHttpFixture("malformed");
    try {
      const config = await writeHttpConfig(directory, fixture.url);
      const imported = await loadInspectorConfig(config, {
        allowedRoot: root,
        environment: { RESILIREPLAY_FIXTURE_HTTP_TOKEN: fixture.authorization },
      });
      await expect(
        auditMcp(importedAuditOptions(imported, { timeoutMs: 750 })),
      ).rejects.toBeInstanceOf(McpConnectionError);
    } finally {
      await fixture.close();
    }
    await expect(fetch(fixture.url)).rejects.toThrow();
    await rm(directory, { recursive: true, force: true });
  });

  it("detects malformed, ambiguous, unsupported, remote, and escaping configurations", async () => {
    const directory = await artifactDirectory("mcp-invalid-");
    const cases: Array<{ name: string; raw: string; error: string; remote?: boolean }> = [
      { name: "invalid-json", raw: "{", error: "RR_MCP_CONFIG_INVALID_JSON" },
      { name: "missing-map", raw: "{}", error: "RR_MCP_CONFIG_MISSING_SERVERS" },
      {
        name: "zero",
        raw: JSON.stringify({ mcpServers: {} }),
        error: "RR_MCP_CONFIG_ZERO_SERVERS",
      },
      {
        name: "args",
        raw: JSON.stringify({ mcpServers: { bad: { command: "node", args: "server.js" } } }),
        error: "RR_MCP_CONFIG_ARGS",
      },
      {
        name: "transport",
        raw: JSON.stringify({ mcpServers: { bad: { type: "websocket", url: "ws://localhost" } } }),
        error: "RR_MCP_CONFIG_TRANSPORT",
      },
      {
        name: "conflict",
        raw: JSON.stringify({
          mcpServers: { bad: { type: "stdio", command: "node", url: "http://localhost/mcp" } },
        }),
        error: "RR_MCP_CONFIG_CONFLICT",
      },
      {
        name: "invalid-url",
        raw: JSON.stringify({ mcpServers: { bad: { type: "http", url: "not a url" } } }),
        error: "RR_MCP_CONFIG_URL",
      },
      {
        name: "path-escape",
        raw: JSON.stringify({
          mcpServers: { bad: { command: "node", args: ["../../../../outside.js"] } },
        }),
        error: "RR_MCP_CONFIG_PATH_ESCAPE",
      },
      {
        name: "modern",
        raw: JSON.stringify({
          mcpServers: {
            bad: { type: "http", url: "http://localhost/mcp", protocolEra: "modern" },
          },
        }),
        error: "RR_MCP_CONFIG_PROTOCOL_ERA",
      },
      {
        name: "auth-disabled",
        raw: JSON.stringify({
          mcpServers: {
            bad: { command: "node", env: { DANGEROUSLY_OMIT_AUTH: "true" } },
          },
        }),
        error: "RR_MCP_CONFIG_FORBIDDEN_AUTH_SETTING",
      },
      {
        name: "remote",
        raw: JSON.stringify({
          mcpServers: { bad: { type: "http", url: "https://example.com/mcp" } },
        }),
        error: "REMOTE",
        remote: true,
      },
    ];
    try {
      for (const testCase of cases) {
        const path = join(directory, `${testCase.name}.json`);
        await writeFile(path, testCase.raw, "utf8");
        if (testCase.remote) {
          await expect(loadInspectorConfig(path, { allowedRoot: root })).rejects.toBeInstanceOf(
            McpRemoteAuthorizationError,
          );
        } else {
          await expect(loadInspectorConfig(path, { allowedRoot: root })).rejects.toMatchObject({
            errorId: testCase.error,
          });
        }
      }

      const duplicate = join(directory, "duplicate.json");
      await writeFile(
        duplicate,
        '{"mcpServers":{"one":{"command":"node","command":"other"}}}',
        "utf8",
      );
      await expect(loadInspectorConfig(duplicate, { allowedRoot: root })).rejects.toMatchObject({
        errorId: "RR_MCP_CONFIG_DUPLICATE_KEY",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("cleans up a timed-out stdio server process", async () => {
    const directory = await artifactDirectory("mcp-timeout-");
    const pidFile = join(directory, "server.pid");
    try {
      const imported = await importFixture("stdio-timeout.json", {
        environment: { RESILIREPLAY_FIXTURE_PID_FILE: pidFile },
      });
      await expect(auditMcp(importedAuditOptions(imported))).rejects.toBeInstanceOf(
        McpConnectionError,
      );
      await waitForFile(pidFile);
      const pid = Number(await readFile(pidFile, "utf8"));
      expect(await waitForProcessExit(pid)).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports startup and malformed stdio protocol failures with the connection exit code", async () => {
    for (const fixtureName of ["stdio-startup-failure.json", "stdio-malformed-response.json"]) {
      const imported = await importFixture(fixtureName);
      await expect(
        auditMcp(importedAuditOptions(imported, { timeoutMs: 500 })),
      ).rejects.toMatchObject({ exitCode: MCP_EXIT_CODES.CONNECTION });
    }
  });

  it("redacts secret-shaped MCP output from every persisted certification artifact", async () => {
    const directory = await artifactDirectory("mcp-secret-output-");
    const syntheticSecret = `sk-${"fixture".repeat(7)}`;
    try {
      const imported = await importFixture("stdio-secret-output.json");
      const result = await auditMcp(importedAuditOptions(imported));
      expect(result.secretOutputDetected).toBe(true);
      expect(result.findings.map((finding) => finding.id)).toContain("MCP007");
      await writeMcpCertification(result, directory);
      const persisted = await allText(directory);
      expect(persisted).not.toContain(syntheticSecret);
      expect(persisted).toContain("[REDACTED]");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("proves recovered and failed faults and executes the generated regression", async () => {
    const directory = await artifactDirectory("mcp-regression-");
    try {
      const imported = await importFixture("stdio-single.json");
      const recovered = await auditMcp(
        importedAuditOptions(imported, {
          fault: "mcp-tool-error",
          recoveryMode: "retry",
          seed: 42,
        }),
      );
      expect(recovered.passed).toBe(true);
      expect(recovered.recovery).toEqual({ attempted: true, succeeded: true });

      const failed = await auditMcp(
        importedAuditOptions(imported, {
          fault: "mcp-malicious-canary-instruction",
          recoveryMode: "none",
          seed: 42,
        }),
      );
      expect(failed.passed).toBe(false);
      expect(failed.events.at(-1)?.type).toBe("run_failed");
      const regression = await compileRegression(failed.events, join(directory, "generated"));
      const execution = spawnSync(process.execPath, ["--test", regression.testPath], {
        cwd: regression.outputDirectory,
        encoding: "utf8",
        windowsHide: true,
      });
      expect(execution.status, `${execution.stdout}\n${execution.stderr}`).toBe(0);
      for (const hash of [
        imported.configSha256,
        regression.sourceTraceHash,
        regression.scenarioHash,
        regression.fixtureHash,
        regression.testHash,
      ]) {
        expect(hash).toMatch(/^[a-f0-9]{64}$/u);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("exposes dry-run help and stable CLI exit codes without calling a server", async () => {
    const directory = await artifactDirectory("mcp-cli-");
    try {
      const help = spawnSync(process.execPath, [cli, "mcp", "audit", "--help"], {
        encoding: "utf8",
        windowsHide: true,
      });
      expect(help.status).toBe(0);
      expect(help.stdout).toContain("--inspector-config");
      expect(help.stdout).toContain("--dry-run");

      const secret = `sk-${"fixture".repeat(7)}`;
      const output = join(directory, "must-not-exist");
      const dryRun = spawnSync(
        process.execPath,
        [
          cli,
          "mcp",
          "audit",
          "--inspector-config",
          join(fixtures, "stdio-environment.json"),
          "--dry-run",
          "--output",
          output,
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          env: { ...process.env, RESILIREPLAY_FIXTURE_API_KEY: secret },
        },
      );
      expect(dryRun.status, dryRun.stderr).toBe(0);
      expect(dryRun.stdout).not.toContain(secret);
      expect(dryRun.stdout).toContain("[REDACTED]");
      expect(
        await access(output).then(
          () => true,
          () => false,
        ),
      ).toBe(false);

      const missingTarget = spawnSync(process.execPath, [cli, "mcp", "audit", "--dry-run"], {
        encoding: "utf8",
        windowsHide: true,
      });
      expect(missingTarget.status).toBe(MCP_EXIT_CODES.CONFIG);

      const pathEscape = spawnSync(
        process.execPath,
        [cli, "mcp", "audit", "--inspector-config", "..\\outside.json", "--dry-run"],
        { encoding: "utf8", windowsHide: true },
      );
      expect(pathEscape.status).toBe(MCP_EXIT_CODES.CONFIG);

      const remote = spawnSync(
        process.execPath,
        [cli, "mcp", "audit", "--url", "https://example.com/mcp"],
        { encoding: "utf8", windowsHide: true },
      );
      expect(remote.status).toBe(MCP_EXIT_CODES.REMOTE_AUTHORIZATION);

      const startupFailure = spawnSync(
        process.execPath,
        [
          cli,
          "mcp",
          "audit",
          "--inspector-config",
          join(fixtures, "stdio-startup-failure.json"),
          "--timeout",
          "500",
        ],
        { encoding: "utf8", windowsHide: true },
      );
      expect(startupFailure.status).toBe(MCP_EXIT_CODES.CONNECTION);

      const secretOutput = join(directory, "secret-output");
      const secretFailure = spawnSync(
        process.execPath,
        [
          cli,
          "mcp",
          "audit",
          "--inspector-config",
          join(fixtures, "stdio-secret-output.json"),
          "--output",
          secretOutput,
        ],
        { encoding: "utf8", windowsHide: true },
      );
      expect(secretFailure.status).toBe(MCP_EXIT_CODES.SECRET_OUTPUT);
      expect(await allText(secretOutput)).not.toContain(`sk-${"fixture".repeat(7)}`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
