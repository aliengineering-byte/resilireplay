import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  auditMcp,
  loadInspectorConfig,
  writeMcpCertification,
} from "../packages/mcp-chaos/dist/index.js";
import { stableStringify } from "../packages/core/dist/index.js";
import { writeReportBundle } from "../packages/reporters/dist/index.js";
import { compileRegression, writeTrace } from "../packages/trace/dist/index.js";

const root = resolve(".");
const output = join(root, "runs", "mcp-inspector-demo");
const fixtures = join(root, "tests", "fixtures", "mcp-inspector");
await mkdir(output, { recursive: true });

function auditOptions(imported, extra = {}) {
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

async function writeEvidence(name, result) {
  const directory = join(output, name);
  await mkdir(directory, { recursive: true });
  await writeTrace(join(directory, "trace.jsonl"), result.events);
  await writeMcpCertification(result, directory);
  await writeReportBundle(result.events, directory);
  return directory;
}

async function startHttpFixture() {
  const token = `fixture-${randomUUID()}`;
  const child = spawn(
    process.execPath,
    [join(root, "examples", "mcp-http-fixture-server", "dist", "index.js")],
    {
      env: {
        ...process.env,
        RESILIREPLAY_FIXTURE_HTTP_TOKEN: token,
        RESILIREPLAY_FIXTURE_MODE: "resilient",
        RESILIREPLAY_FIXTURE_PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const url = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`HTTP fixture startup timed out: ${stderr}`)),
      5_000,
    );
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`HTTP fixture exited ${code}: ${stderr}`)));
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      resolveUrl(JSON.parse(stdout.slice(0, newline)).url);
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

console.log("1/6 Importing the reviewed Inspector stdio configuration");
const resilientConfig = await loadInspectorConfig(join(fixtures, "stdio-single.json"), {
  allowedRoot: root,
});
const dryRunPath = join(output, "dry-run.json");
await writeFile(dryRunPath, `${stableStringify(resilientConfig.plan)}\n`, "utf8");
console.log(
  `Dry-run plan: server=${resilientConfig.serverName}; transport=${resilientConfig.transport}`,
);

console.log("2/6 Auditing resilient and intentionally vulnerable stdio servers");
const resilient = await auditMcp(auditOptions(resilientConfig));
await writeEvidence("stdio-resilient", resilient);
const vulnerableConfig = await loadInspectorConfig(join(fixtures, "stdio-vulnerable.json"), {
  allowedRoot: root,
});
const vulnerable = await auditMcp(auditOptions(vulnerableConfig));
await writeEvidence("stdio-vulnerable", vulnerable);
console.log(`Stdio resilient=${resilient.passed}; vulnerable expected-pass=${vulnerable.passed}`);

console.log("3/6 Injecting a recoverable MCP tool fault and verifying bounded retry");
const recovered = await auditMcp(
  auditOptions(resilientConfig, {
    fault: "mcp-tool-error",
    recoveryMode: "retry",
    seed: 42,
  }),
);
await writeEvidence("recovered-fault", recovered);
console.log(`Recovered=${recovered.recovery.succeeded}; passed=${recovered.passed}`);

console.log("4/6 Injecting an unsafe MCP fault and compiling the causal regression");
const failed = await auditMcp(
  auditOptions(resilientConfig, {
    fault: "mcp-malicious-canary-instruction",
    recoveryMode: "none",
    seed: 42,
  }),
);
const failedDirectory = await writeEvidence("failed-fault", failed);
const regression = await compileRegression(failed.events, join(output, "generated-regression"));
const generatedTest = spawn(process.execPath, ["--test", regression.testPath], {
  cwd: regression.outputDirectory,
  stdio: "inherit",
  windowsHide: true,
});
const generatedCode = await new Promise((resolveCode, reject) => {
  generatedTest.once("error", reject);
  generatedTest.once("exit", (code) => resolveCode(code ?? 1));
});
if (generatedCode !== 0) throw new Error(`Generated MCP regression exited ${generatedCode}`);

console.log("5/6 Reusing an Inspector Streamable HTTP configuration with authentication");
const http = await startHttpFixture();
let httpResult;
try {
  const httpConfigPath = join(output, "http-inspector.json");
  await writeFile(
    httpConfigPath,
    `${JSON.stringify(
      {
        mcpServers: {
          "resilient-http": {
            type: "http",
            url: http.url,
            headers: { Authorization: "${env:RESILIREPLAY_FIXTURE_HTTP_TOKEN}" },
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const importedHttp = await loadInspectorConfig(httpConfigPath, {
    allowedRoot: root,
    environment: { RESILIREPLAY_FIXTURE_HTTP_TOKEN: http.authorization },
  });
  httpResult = await auditMcp(auditOptions(importedHttp));
  await writeEvidence("http-resilient", httpResult);
} finally {
  await http.close();
}
console.log(`Streamable HTTP passed=${httpResult.passed}; authenticated=true`);

console.log("6/6 Writing source/config/scenario/fixture/test hashes");
const integrationManifest = {
  schemaVersion: "1.0",
  product: "ResiliReplay",
  productVersion: "0.6.0",
  inspectorVersion: "2.0.0",
  sourceConfigSha256: resilientConfig.configSha256,
  sourceTraceSha256: regression.sourceTraceHash,
  scenarioSha256: regression.scenarioHash,
  fixtureSha256: regression.fixtureHash,
  testSha256: regression.testHash,
  recovered: recovered.passed,
  expectedFailureDetected: !failed.passed,
  generatedRegressionExecuted: generatedCode === 0,
  streamableHttpPassed: httpResult.passed,
  failedEvidenceDirectory: failedDirectory.replace(root, "<repository>"),
};
await writeFile(
  join(output, "integration-manifest.json"),
  `${stableStringify(integrationManifest)}\n`,
  "utf8",
);

if (
  vulnerable.passed ||
  !resilient.passed ||
  !recovered.passed ||
  failed.passed ||
  !httpResult.passed
) {
  throw new Error("MCP Inspector demo outcomes did not match the reviewed expectations");
}
console.log("MCP Inspector integration demo complete: runs/mcp-inspector-demo");
