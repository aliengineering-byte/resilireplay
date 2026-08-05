import { spawn, spawnSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAdopt } from "../packages/cli/src/adopt.js";
import { runDemo } from "../packages/cli/src/demo.js";

const cli = resolve("packages/cli/dist/bin.js");
const temporaryDirectories: string[] = [];

async function project(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `resilireplay-${name}-`));
  temporaryDirectories.push(directory);
  return directory;
}

async function allText(directory: string): Promise<string> {
  const output: string[] = [];
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else output.push(await readFile(path, "utf8"));
    }
  }
  await visit(directory);
  return output.join("\n");
}

function runSync(argumentsValue: string[], cwd: string) {
  return spawnSync(process.execPath, [cli, ...argumentsValue], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
}

async function runAsync(
  argumentsValue: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const child = spawn(process.execPath, [cli, ...argumentsValue], {
    cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: environment,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => (stdout += chunk));
  child.stderr.on("data", (chunk: string) => (stderr += chunk));
  const code = await new Promise<number>((resolveCode, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode) => resolveCode(exitCode ?? 1));
  });
  return { code, stdout, stderr };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("zero-configuration demo", () => {
  it("executes the source path directly for coverage and cleanup evidence", async () => {
    const directory = await project("demo-direct");
    const result = await runDemo({ rootDirectory: directory, seed: 42 });
    expect(result.status).toBe("passed");
    expect(result.durationMs).toBeLessThan(30_000);
    expect(await readdir(directory)).toEqual([]);
  });

  it("runs from an empty directory, is fast, deterministic, and leaves no project files", async () => {
    const directory = await project("demo-empty");
    const first = runSync(["demo", "--json", "--no-color"], directory);
    const second = runSync(["demo", "--json", "--no-color"], directory);
    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    const firstResult = JSON.parse(first.stdout) as {
      durationMs: number;
      outputDirectory: null;
      hashes: { canonicalEvidenceSha256: string };
    };
    const secondResult = JSON.parse(second.stdout) as typeof firstResult;
    expect(firstResult.durationMs).toBeLessThan(30_000);
    expect(firstResult.outputDirectory).toBeNull();
    expect(firstResult.hashes.canonicalEvidenceSha256).toBe(
      secondResult.hashes.canonicalEvidenceSha256,
    );
    expect(await readdir(directory)).toEqual([]);
  });

  it("keeps genuine evidence and an executable regression only when --output is supplied", async () => {
    const directory = await project("demo-output");
    const result = runSync(["demo", "--json", "--output", "evidence"], directory);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe("passed");
    const regression = runSync(["--version"], directory);
    expect(regression.status).toBe(0);
    const generated = spawnSync(
      process.execPath,
      ["--test", join(directory, "evidence", "regression", "regression.test.mjs")],
      { cwd: directory, encoding: "utf8", windowsHide: true },
    );
    expect(generated.status, `${generated.stdout}\n${generated.stderr}`).toBe(0);
  });

  it("rejects a persistent output junction that escapes the project", async () => {
    const directory = await project("demo-output-link");
    const outside = await project("demo-output-link-outside");
    try {
      await symlink(outside, join(directory, "evidence"), "junction");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    const result = runSync(["demo", "--output", "evidence", "--json"], directory);
    expect(result.status).toBe(31);
    expect(JSON.parse(result.stderr).error.message).toContain("outside the current project");
    expect(await readdir(outside)).toEqual([]);
  });
});

const stdioServer = `import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.id === undefined) continue;
  let result;
  if (message.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "adopt-fixture", version: "1.0.0" } };
  else if (message.method === "tools/list") result = { tools: [{ name: "read_fixture", description: "Read an inert local fixture.", inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] }, annotations: { readOnlyHint: true } }] };
  else if (message.method === "tools/call") result = { content: [{ type: "text", text: "PRIVATE_TOOL_BODY_SHOULD_NOT_PERSIST" }] };
  else { console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "not found" } })); continue; }
  console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
}
`;

async function stdioProject(name: string): Promise<string> {
  const directory = await project(name);
  await writeFile(join(directory, "server.mjs"), stdioServer, "utf8");
  await writeFile(
    join(directory, "mcp.json"),
    JSON.stringify({ mcpServers: { fixture: { command: "node", args: ["server.mjs"] } } }),
    "utf8",
  );
  return directory;
}

describe("five-minute adopt flow", () => {
  it("executes a complete source-level adoption against the real stdio fixture", async () => {
    const directory = await stdioProject("adopt-direct");
    const result = await runAdopt({
      rootDirectory: directory,
      config: "mcp.json",
      server: "fixture",
      nonInteractive: true,
      json: true,
      tool: "read_fixture",
      argumentsJson: JSON.stringify({ message: "reviewed-fixture" }),
      safety: "read-only-idempotent",
      confirmTarget: true,
      confirmToolExecution: true,
      confirmRetrySafe: true,
      seed: 42,
    });
    expect(result.status).toBe("adopted");
    expect(result.createdFiles).toHaveLength(14);
    expect(result.durationMs).toBeLessThan(300_000);
  });

  it("proves dry-run has no process or filesystem side effects", async () => {
    const directory = await project("adopt-dry");
    const sentinel = join(directory, "started.txt");
    await writeFile(
      join(directory, "server.mjs"),
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(sentinel)}, "started");`,
      "utf8",
    );
    await writeFile(
      join(directory, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          fixture: {
            command: "node",
            args: ["server.mjs"],
            env: { API_KEY: "${env:ADOPT_DRY_RUN_CANARY}" },
          },
        },
      }),
      "utf8",
    );
    const secret = `sk-${"fixture".repeat(7)}`;
    const result = spawnSync(
      process.execPath,
      [cli, "adopt", "--config", "mcp.json", "--server", "fixture", "--dry-run", "--json"],
      {
        cwd: directory,
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, ADOPT_DRY_RUN_CANARY: secret },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain(secret);
    expect(JSON.parse(result.stdout).plan.sideEffects).toEqual({
      processStarts: false,
      networkConnections: false,
      toolCalls: false,
      projectWrites: false,
    });
    expect(await readdir(directory)).toEqual(["mcp.json", "server.mjs"]);
  });

  it("fails non-interactively instead of guessing safety-critical choices", async () => {
    const directory = await stdioProject("adopt-noninteractive");
    const result = runSync(
      ["adopt", "--config", "mcp.json", "--server", "fixture", "--non-interactive", "--json"],
      directory,
    );
    expect(result.status).toBe(41);
    expect(JSON.parse(result.stderr).error).toMatchObject({
      code: 41,
      message: expect.stringContaining("--confirm-target"),
    });
    expect(await readdir(directory)).toEqual(["mcp.json", "server.mjs"]);
  });

  it("does not let --yes bypass the reviewed tool-execution boundary", async () => {
    const directory = await stdioProject("adopt-yes-boundary");
    const result = runSync(
      [
        "adopt",
        "--config",
        "mcp.json",
        "--server",
        "fixture",
        "--non-interactive",
        "--json",
        "--yes",
        "--tool",
        "read_fixture",
        "--arguments",
        JSON.stringify({ message: "reviewed-fixture" }),
        "--safety",
        "read-only-idempotent",
        "--confirm-retry-safe",
      ],
      directory,
    );
    expect(result.status).toBe(41);
    expect(JSON.parse(result.stderr).error.message).toContain("--confirm-tool-execution");
    expect(await readdir(directory)).toEqual(["mcp.json", "server.mjs"]);
  });

  it("creates metadata-only commit-ready artifacts from a real local stdio server", async () => {
    const directory = await stdioProject("adopt-stdio");
    const argumentsJson = JSON.stringify({ message: "reviewed-fixture" });
    const result = runSync(
      [
        "adopt",
        "--config",
        "mcp.json",
        "--server",
        "fixture",
        "--non-interactive",
        "--json",
        "--tool",
        "read_fixture",
        "--arguments",
        argumentsJson,
        "--safety",
        "read-only-idempotent",
        "--confirm-target",
        "--confirm-tool-execution",
        "--confirm-retry-safe",
      ],
      directory,
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const adopted = JSON.parse(result.stdout) as {
      status: string;
      durationMs: number;
      createdFiles: string[];
      campaignHash: string;
    };
    expect(adopted.status).toBe("adopted");
    expect(adopted.durationMs).toBeLessThan(300_000);
    expect(adopted.createdFiles).toHaveLength(14);
    expect(adopted.campaignHash).toMatch(/^[a-f0-9]{64}$/u);
    const persisted = [
      await allText(join(directory, ".resilireplay")),
      await allText(join(directory, "tests", "resilireplay")),
      await allText(join(directory, ".github")),
    ].join("\n");
    expect(persisted).not.toContain("PRIVATE_TOOL_BODY_SHOULD_NOT_PERSIST");
    expect(persisted).not.toMatch(/[A-Z]:\\Users\\/iu);
    expect(persisted).toContain("evidenceMode: metadata-only");
    expect(persisted).toContain("aliengineering-byte/resilireplay@v0.5.0");
    const regression = spawnSync(
      process.execPath,
      ["--test", join(directory, "tests", "resilireplay", "regression.test.mjs")],
      { cwd: directory, encoding: "utf8", windowsHide: true },
    );
    expect(regression.status, `${regression.stdout}\n${regression.stderr}`).toBe(0);
    const campaign = runSync(
      [
        "campaign",
        "run",
        ".resilireplay/campaign.yml",
        "--confirm-tools",
        adopted.campaignHash,
        "--output",
        ".resilireplay/runs/verification",
      ],
      directory,
    );
    expect(campaign.status, `${campaign.stdout}\n${campaign.stderr}`).toBe(0);
  });

  it("fails closed for credential-shaped and out-of-project arguments", async () => {
    const directory = await stdioProject("adopt-canary");
    for (const argumentsJson of [
      JSON.stringify({ message: `sk%2D${"A".repeat(24)}` }),
      JSON.stringify({ path: resolve(directory, "..", "outside.txt") }),
      JSON.stringify({ path: "../outside.txt" }),
      JSON.stringify({ path: "{{PROJECT_ROOT}}/fixtures/public.json" }),
    ]) {
      const result = runSync(
        [
          "adopt",
          "--config",
          "mcp.json",
          "--server",
          "fixture",
          "--non-interactive",
          "--json",
          "--tool",
          "read_fixture",
          "--arguments",
          argumentsJson,
          "--safety",
          "read-only-idempotent",
          "--confirm-target",
          "--confirm-tool-execution",
          "--confirm-retry-safe",
        ],
        directory,
      );
      expect(result.status).toBe(43);
    }
    expect(await readdir(directory)).toEqual(["mcp.json", "server.mjs"]);
  });

  it("rejects a non-existent argument path beneath an escaping junction", async () => {
    const directory = await stdioProject("adopt-argument-link");
    const outside = await project("adopt-argument-link-outside");
    try {
      await symlink(outside, join(directory, "linked"), "junction");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    const result = runSync(
      [
        "adopt",
        "--config",
        "mcp.json",
        "--server",
        "fixture",
        "--non-interactive",
        "--json",
        "--tool",
        "read_fixture",
        "--arguments",
        JSON.stringify({ path: join(directory, "linked", "future.txt") }),
        "--safety",
        "read-only-idempotent",
        "--confirm-target",
        "--confirm-tool-execution",
        "--confirm-retry-safe",
      ],
      directory,
    );
    expect(result.status).toBe(43);
    expect(JSON.parse(result.stderr).error.message).toContain("link outside");
    expect(await readdir(outside)).toEqual([]);
  });

  it("rejects a discovered configuration symlink that escapes the project", async () => {
    const directory = await project("adopt-config-link");
    const outside = await project("adopt-config-link-outside");
    await writeFile(join(outside, "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf8");
    try {
      await symlink(join(outside, "mcp.json"), join(directory, "mcp.json"), "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    const result = runSync(["adopt", "--dry-run", "--json"], directory);
    expect(result.status).toBe(40);
    expect(JSON.parse(result.stderr).error.message).toContain("outside the project root");
  });

  it("rejects an artifact destination symlink before starting the MCP process", async () => {
    const directory = await stdioProject("adopt-output-link");
    const outside = await project("adopt-output-link-outside");
    const sentinel = join(directory, "started.txt");
    await writeFile(
      join(directory, "server.mjs"),
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(sentinel)}, "started");`,
      "utf8",
    );
    try {
      await symlink(outside, join(directory, ".resilireplay"), "junction");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    const result = runSync(
      [
        "adopt",
        "--config",
        "mcp.json",
        "--server",
        "fixture",
        "--non-interactive",
        "--json",
        "--tool",
        "read_fixture",
        "--arguments",
        JSON.stringify({ message: "reviewed-fixture" }),
        "--safety",
        "read-only-idempotent",
        "--confirm-target",
        "--confirm-tool-execution",
        "--confirm-retry-safe",
      ],
      directory,
    );
    expect(result.status).toBe(44);
    expect(JSON.parse(result.stderr).error.message).toContain("outside the project");
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(directory)).not.toContain("started.txt");
  });

  it("proves HTTP dry-run opens no network connection", async () => {
    const directory = await project("adopt-http-dry");
    let requestCount = 0;
    const server = createServer((_request, response) => {
      requestCount += 1;
      response.writeHead(500).end();
    });
    await new Promise<void>((resolveListening) => server.listen(0, "127.0.0.1", resolveListening));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing fixture port");
    await writeFile(
      join(directory, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          fixture: { type: "streamable-http", url: `http://127.0.0.1:${address.port}/mcp` },
        },
      }),
      "utf8",
    );
    try {
      const result = await runAsync(
        ["adopt", "--config", "mcp.json", "--server", "fixture", "--dry-run", "--json"],
        directory,
      );
      expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(requestCount).toBe(0);
      expect(JSON.parse(result.stdout).plan.sideEffects.networkConnections).toBe(false);
      expect(await readdir(directory)).toEqual(["mcp.json"]);
    } finally {
      await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
    }
  });

  it("adopts a real authenticated loopback Streamable HTTP fixture", async () => {
    const directory = await project("adopt-http");
    const token = "Bearer fixture-http-token";
    const server = createServer(async (request, response) => {
      if (request.headers.authorization !== token) {
        response.writeHead(401).end();
        return;
      }
      if (request.method !== "POST") {
        response.writeHead(200).end();
        return;
      }
      const message = (await readJson(request)) as Record<string, unknown>;
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      let result: unknown;
      if (message.method === "initialize") {
        result = {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "http-adopt-fixture", version: "1.0.0" },
        };
      } else if (message.method === "tools/list") {
        result = {
          tools: [
            {
              name: "read_http_fixture",
              inputSchema: {
                type: "object",
                properties: { message: { type: "string" } },
                required: ["message"],
              },
              annotations: { readOnlyHint: true },
            },
          ],
        };
      } else {
        result = { content: [{ type: "text", text: "HTTP_PRIVATE_BODY" }] };
      }
      sendJson(response, { jsonrpc: "2.0", id: message.id, result });
    });
    await new Promise<void>((resolveListening) => server.listen(0, "127.0.0.1", resolveListening));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing fixture port");
    await writeFile(
      join(directory, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          fixture: {
            type: "streamable-http",
            url: `http://127.0.0.1:${address.port}/mcp`,
            headers: { Authorization: "${env:ADOPT_HTTP_TOKEN}" },
          },
        },
      }),
      "utf8",
    );
    try {
      const result = await runAsync(
        [
          "adopt",
          "--config",
          "mcp.json",
          "--server",
          "fixture",
          "--non-interactive",
          "--json",
          "--tool",
          "read_http_fixture",
          "--arguments",
          JSON.stringify({ message: "reviewed-http-fixture" }),
          "--safety",
          "read-only-idempotent",
          "--confirm-target",
          "--confirm-tool-execution",
          "--confirm-retry-safe",
        ],
        directory,
        { ...process.env, ADOPT_HTTP_TOKEN: token },
      );
      expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
      const persisted = await allText(directory);
      expect(persisted).not.toContain(token);
      expect(persisted).not.toContain("HTTP_PRIVATE_BODY");
      expect(persisted).toContain("streamable-http");
    } finally {
      await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
      server.closeAllConnections();
    }
  }, 30_000);
});

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}
