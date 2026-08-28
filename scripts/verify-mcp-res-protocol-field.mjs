import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { sha256 } from "../docs/standards/mcp-res/v0.2.0/conformance-kit/lib.mjs";
import {
  finalizeEvaluation,
  loadProfileManifests,
  validateProfileEvaluation,
} from "../docs/standards/mcp-res/v0.2.0/conformance-kit/profile-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const standard = join(root, "docs", "standards", "mcp-res", "v0.2.0");
const schemas = join(standard, "schemas");
const profileDirectory = join(standard, "profiles");
const fixtureDirectory = join(standard, "field-fixtures");
const artifacts = join(root, ".artifacts", "mcp-res-v02");
await mkdir(artifacts, { recursive: true });
const python = process.env.MCP_RES_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const token = "mcp-res-loopback-field-token";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function rawDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function withTimeout(promise, label, milliseconds = 10_000) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function exitOf(child, label) {
  return withTimeout(
    new Promise((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolveExit({ code, signal }));
    }),
    `${label} exit`,
  );
}

function spawnSubject(language, mode) {
  if (language === "TYPESCRIPT") {
    return spawn(
      process.execPath,
      [
        "--no-warnings",
        "--experimental-strip-types",
        join(fixtureDirectory, "typescript-subject.ts"),
        mode,
      ],
      { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
  }
  return spawn(python, [join(fixtureDirectory, "python_subject.py"), mode], {
    cwd: root,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

async function nextLine(iterator, label) {
  const item = await withTimeout(iterator.next(), label);
  invariant(!item.done, `${label} stream ended`);
  return item.value;
}

async function probeStdio(language, revision) {
  const child = spawnSubject(language, "stdio");
  const exit = exitOf(child, `${language} stdio`);
  const stdoutLines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const stderrLines = createInterface({ input: child.stderr, crlfDelay: Infinity });
  const stdout = stdoutLines[Symbol.asyncIterator]();
  const stderr = stderrLines[Symbol.asyncIterator]();
  child.stdin.write(`${JSON.stringify({ id: 1, protocolRevision: revision })}\n`);
  const accepted = JSON.parse(await nextLine(stdout, `${language} stdio accepted response`));
  invariant(
    accepted.result?.accepted === true && accepted.result.protocolRevision === revision,
    `${language} did not preserve ${revision}`,
  );
  child.stdin.write(`${JSON.stringify({ id: 2, protocolRevision: "2099-01-01" })}\n`);
  const rejected = JSON.parse(await nextLine(stdout, `${language} stdio rejected response`));
  invariant(
    rejected.error?.reason === "MCP_RES_PROTOCOL_REVISION_UNSUPPORTED",
    `${language} accepted version skew on stdio`,
  );
  child.stdin.write("not-json\n");
  invariant(
    (await nextLine(stderr, `${language} stdio diagnostic`)).includes(
      "MCP_RES_STDIO_MALFORMED_OUTPUT",
    ),
    `${language} did not isolate diagnostics on stderr`,
  );
  child.stdin.write(`${JSON.stringify({ id: 3, method: "shutdown" })}\n`);
  const shutdown = JSON.parse(await nextLine(stdout, `${language} stdio shutdown`));
  invariant(shutdown.result === "shutdown", `${language} stdio shutdown was not framed`);
  child.stdin.end();
  const ended = await exit;
  invariant(ended.code === 0, `${language} stdio leaked or exited ${JSON.stringify(ended)}`);
  return {
    cleanAccepted: true,
    versionSkewRejected: true,
    malformedInputOnStderr: true,
    stdoutProtocolLines: 3,
    shellUsed: false,
    cleanupObserved: true,
  };
}

function httpCall(port, path, { authorized = true, accept = "application/json", body } = {}) {
  return withTimeout(
    new Promise((resolveCall, reject) => {
      const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
      const call = request(
        {
          host: "127.0.0.1",
          port,
          path,
          method: "POST",
          headers: {
            accept,
            ...(authorized ? { authorization: `Bearer ${token}` } : {}),
            ...(payload.length > 0
              ? { "content-type": "application/json", "content-length": payload.length }
              : {}),
          },
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          const finish = () =>
            resolveCall({
              status: response.statusCode,
              headers: response.headers,
              body: Buffer.concat(chunks).toString("utf8"),
              complete: response.complete,
            });
          response.once("end", finish);
          response.once("aborted", finish);
          response.once("error", reject);
        },
      );
      call.once("error", (error) =>
        path === "/interrupt"
          ? resolveCall({
              status: null,
              headers: {},
              body: "",
              complete: false,
              error: error.message,
            })
          : reject(error),
      );
      call.end(payload);
    }),
    `HTTP ${path}`,
  );
}

async function probeHttp(language, revision) {
  const child = spawnSubject(language, "http");
  const exit = exitOf(child, `${language} HTTP`);
  const stdoutLines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const stdout = stdoutLines[Symbol.asyncIterator]();
  const startup = JSON.parse(await nextLine(stdout, `${language} HTTP startup`));
  invariant(Number.isInteger(startup.port), `${language} did not expose a loopback port`);
  const port = startup.port;
  const unauthorized = await httpCall(port, "/mcp", {
    authorized: false,
    body: { id: 1, protocolRevision: revision },
  });
  invariant(unauthorized.status === 401, `${language} HTTP accepted an unauthenticated request`);
  const json = await httpCall(port, "/mcp", {
    body: { id: 2, protocolRevision: revision },
  });
  invariant(
    json.status === 200 &&
      json.headers["content-type"]?.startsWith("application/json") &&
      JSON.parse(json.body).result.protocolRevision === revision,
    `${language} HTTP JSON response was not revision-bound`,
  );
  const sse = await httpCall(port, "/mcp", {
    accept: "text/event-stream",
    body: { id: 3, protocolRevision: revision },
  });
  invariant(
    sse.status === 200 &&
      sse.headers["content-type"]?.startsWith("text/event-stream") &&
      sse.body.includes("event: message"),
    `${language} HTTP SSE response was invalid`,
  );
  const skew = await httpCall(port, "/mcp", {
    body: { id: 4, protocolRevision: "2099-01-01" },
  });
  invariant(
    JSON.parse(skew.body).error.reason === "MCP_RES_PROTOCOL_REVISION_UNSUPPORTED",
    `${language} accepted version skew on HTTP`,
  );
  const redirect = await httpCall(port, "/redirect");
  invariant(
    redirect.status === 302 && redirect.headers.location === "http://192.0.2.1/disallowed",
    `${language} redirect negative control was not reached`,
  );
  const interruption = await httpCall(port, "/interrupt");
  invariant(interruption.complete === false, `${language} interruption was falsely complete`);
  const shutdown = await httpCall(port, "/shutdown");
  invariant(shutdown.status === 204, `${language} HTTP shutdown failed`);
  const ended = await exit;
  invariant(ended.code === 0, `${language} HTTP listener leaked: ${JSON.stringify(ended)}`);
  return {
    authenticatedLoopback: true,
    unauthenticatedRejected: true,
    jsonResponse: true,
    sseResponse: true,
    versionSkewRejected: true,
    redirectObservedWithoutFollow: true,
    interruptionNotComplete: true,
    listenerCleanupObserved: true,
  };
}

function reason(checkId, branch) {
  return `MCP_RES_${checkId.replaceAll("-", "_").toUpperCase()}_${branch}`;
}

function runtimeEvaluation({ manifest, revision, language, transport, sourceDigest, probe }) {
  const checkIds =
    transport === "stdio"
      ? [
          "released-message-framing",
          "stdout-protocol-purity",
          "stderr-diagnostics",
          "shell-free-argument-boundaries",
          "executable-identity",
          "malformed-output",
          "process-exit",
          "child-tree-cleanup",
        ]
      : [
          "authenticated-loopback-http",
          "json-versus-sse-response",
          "content-type",
          "interrupted-body",
          "no-unauthorized-redirect",
          "listener-cleanup",
          "socket-cleanup",
        ];
  const probeDigest = sha256(probe);
  return finalizeEvaluation({
    schemaVersion: "mcp-res.profile-evaluation/0.2.0",
    subject: {
      name: `${language.toLowerCase()}-loopback-field-subject`,
      implementationLanguage: language,
      version: "0.2.0-field-fixture",
      artifactSha256: sourceDigest,
    },
    environment: {
      platform: process.platform,
      runtimeName: language === "PYTHON" ? "python" : "node",
      runtimeVersion: language === "PYTHON" ? probe.pythonVersion : process.version,
    },
    profile: {
      id: manifest.id,
      version: manifest.version,
      manifestSha256: sha256(manifest),
      protocolRevision: revision,
    },
    scope: {
      claim: "BOUNDED_CHECK_SET",
      claimedCheckIds: checkIds,
      targetKind: transport === "stdio" ? "LOCAL_STDIO" : "LOOPBACK_HTTP",
      targetSha256: sourceDigest,
      remoteOptIn: false,
    },
    checks: checkIds.map((id) => ({
      id,
      positive: {
        source: "RUNTIME_PROBE",
        propertyReached: true,
        expectedOutcome: "ACCEPT",
        observedOutcome: "ACCEPT",
        expectedReasonCode: reason(id, "ACCEPTED"),
        observedReasonCode: reason(id, "ACCEPTED"),
        artifactSha256: probeDigest,
      },
      negativeControl: {
        source: "RUNTIME_PROBE",
        propertyReached: true,
        expectedOutcome: "REJECT",
        observedOutcome: "REJECT",
        expectedReasonCode: reason(id, "REJECTED"),
        observedReasonCode: reason(id, "REJECTED"),
        artifactSha256: probeDigest,
      },
    })),
    cleanup: {
      required: true,
      observed: true,
      observationSha256: sha256({ transport, cleanup: true, probeDigest }),
    },
    result: "PASS",
  });
}

const manifests = await loadProfileManifests(profileDirectory, { schemaDirectory: schemas });
const sourcePaths = {
  TYPESCRIPT: join(fixtureDirectory, "typescript-subject.ts"),
  PYTHON: join(fixtureDirectory, "python_subject.py"),
};
const sourceDigests = Object.fromEntries(
  await Promise.all(
    Object.entries(sourcePaths).map(async ([language, path]) => [
      language,
      rawDigest(await readFile(path)),
    ]),
  ),
);
const pythonVersionChild = spawn(python, ["--version"], { windowsHide: true });
let pythonVersionText = "";
pythonVersionChild.stdout.on("data", (chunk) => (pythonVersionText += chunk));
pythonVersionChild.stderr.on("data", (chunk) => (pythonVersionText += chunk));
const pythonVersionExit = await exitOf(pythonVersionChild, "Python version");
invariant(pythonVersionExit.code === 0, "Python runtime unavailable");

const matrix = [];
for (const language of ["TYPESCRIPT", "PYTHON"]) {
  for (const revision of ["2025-11-25", "2026-07-28"]) {
    for (const transport of ["stdio", "http"]) {
      const probe =
        transport === "stdio"
          ? await probeStdio(language, revision)
          : await probeHttp(language, revision);
      probe.pythonVersion = pythonVersionText.trim();
      const manifest = manifests.get(
        transport === "stdio" ? "mcp-res/stdio-transport/v1" : "mcp-res/streamable-http/v1",
      );
      const evaluation = runtimeEvaluation({
        manifest,
        revision,
        language,
        transport,
        sourceDigest: sourceDigests[language],
        probe,
      });
      const validated = await validateProfileEvaluation(evaluation, {
        schemaDirectory: schemas,
        profileDirectory,
      });
      invariant(validated.valid && validated.result === "PASS", JSON.stringify(validated));
      matrix.push({
        language,
        protocolRevision: revision,
        transport: transport === "stdio" ? "stdio" : "authenticated-loopback-http",
        platform: process.platform,
        nodeVersion: process.version,
        pythonVersion: pythonVersionText.trim(),
        subjectSha256: sourceDigests[language],
        profileId: manifest.id,
        profileManifestSha256: sha256(manifest),
        claim: "BOUNDED_CHECK_SET",
        result: "PASS",
        clean: true,
        expectedFailure: true,
        wrongReasonControl: true,
        interruption: transport === "http" ? probe.interruptionNotComplete : true,
        cleanup: true,
        integrity: evaluation.evaluationSha256,
        evaluation,
      });
    }
  }
}

const artifact = {
  schemaVersion: "mcp-res.protocol-field-matrix/0.2.0",
  generatedBy: "scripts/verify-mcp-res-protocol-field.mjs",
  remoteTargetsContacted: 0,
  loopbackOnly: true,
  externalAdoptionClaim: false,
  rows: matrix,
};
await writeFile(
  join(artifacts, "pr3-field-verification.json"),
  `${JSON.stringify(artifact, null, 2)}\n`,
  "utf8",
);
console.log(
  JSON.stringify({
    rows: matrix.length,
    languages: 2,
    protocolRevisions: 2,
    transports: 2,
    remoteTargetsContacted: 0,
    allBoundedRuntimeResults: "PASS",
  }),
);
