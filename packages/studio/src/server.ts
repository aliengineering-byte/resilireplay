import { createReadStream } from "node:fs";
import { lstat, mkdir, readdir, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import {
  CampaignRelativePathSchema,
  CampaignSchema,
  CAMPAIGN_EXIT_CODES,
  CampaignError,
  approveCampaignBaseline,
  campaignHash,
  compareCampaignRun,
  loadCampaignBaseline,
  loadCampaignFile,
  runCampaign,
  writeCampaignBaseline,
  writeCampaignComparisonReports,
  writeCampaignFile,
  writeCampaignRunReports,
  type Campaign,
  type CampaignProgress,
  type CampaignRun,
} from "@resilireplay/campaign";
import { safeOutputPath, sanitize, stableStringify } from "@resilireplay/core";
import { loadInspectorConfig, MCP_FAULT_TYPES } from "@resilireplay/mcp-chaos";
import { readTrace } from "@resilireplay/trace";
import { STUDIO_CSS, STUDIO_JS, studioHtml } from "./assets.js";

const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 65_536;
const MAX_ARTIFACTS = 250;
const REVIEW_TTL_MS = 30 * 60_000;
const SESSION_TTL_MS = 15 * 60_000;

interface ReviewedCampaign {
  campaign: Campaign;
  campaignPath: string;
  campaignHash: string;
  plans: unknown[];
  requiresToolConfirmation: boolean;
  expiresAt: number;
}

interface Artifact {
  id: string;
  path: string;
  absolutePath: string;
  bytes: number;
}

interface StudioRun {
  state: "running" | "complete" | "error";
  progress: CampaignProgress;
  controller: AbortController;
  promise: Promise<void>;
  run?: CampaignRun;
  outputDirectory?: string;
  artifacts: Artifact[];
  error?: string;
}

export interface StudioOptions {
  rootDirectory?: string;
  port?: number;
  host?: string;
}

export interface StudioInstance {
  url: string;
  host: "127.0.0.1";
  port: number;
  startupMs: number;
  close: () => Promise<void>;
}

function isContained(root: string, candidate: string): boolean {
  const relationship = relative(root, candidate);
  return relationship === "" || (relationship !== ".." && !relationship.startsWith(`..${sep}`));
}

async function containedExistingFile(root: string, pathInput: string): Promise<string> {
  const parsed = CampaignRelativePathSchema.safeParse(pathInput);
  if (!parsed.success)
    throw new StudioHttpError(400, parsed.error.issues[0]?.message ?? "Invalid path");
  const lexical = safeOutputPath(root, parsed.data);
  let actual: string;
  try {
    actual = await realpath(lexical);
  } catch (error) {
    throw new StudioHttpError(404, "Requested repository file was not found", { cause: error });
  }
  if (!isContained(root, actual)) throw new StudioHttpError(403, "Symlink escape rejected");
  if (!(await stat(actual)).isFile()) throw new StudioHttpError(400, "Expected a file");
  return actual;
}

async function containedOutputFile(root: string, pathInput: string): Promise<string> {
  const parsed = CampaignRelativePathSchema.safeParse(pathInput);
  if (!parsed.success)
    throw new StudioHttpError(400, parsed.error.issues[0]?.message ?? "Invalid path");
  const lexical = safeOutputPath(root, parsed.data);
  await mkdir(dirname(lexical), { recursive: true });
  const parent = await realpath(dirname(lexical));
  if (!isContained(root, parent)) throw new StudioHttpError(403, "Symlink escape rejected");
  return lexical;
}

class StudioHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioHttpError";
  }
}

function safeEqual(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(request: IncomingMessage, name: string): string | undefined {
  const raw = request.headers.cookie;
  if (!raw) return undefined;
  for (const entry of raw.split(";")) {
    const [key, ...value] = entry.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader(
    "content-security-policy",
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("cross-origin-opener-policy", "same-origin");
  response.setHeader("cross-origin-resource-policy", "same-origin");
  response.setHeader(
    "permissions-policy",
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );
  response.setHeader("cache-control", "no-store");
}

function sendText(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void {
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader("content-type", contentType);
  response.setHeader("content-length", Buffer.byteLength(body));
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  sendText(
    response,
    status,
    "application/json; charset=utf-8",
    `${stableStringify(sanitize(value))}\n`,
  );
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new StudioHttpError(415, "State-changing requests require application/json");
  }
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new StudioHttpError(413, "Request body is too large");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new StudioHttpError(413, "Request body is too large");
    chunks.push(bytes);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    throw new StudioHttpError(400, "Request body is not valid JSON", { cause: error });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StudioHttpError(400, "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, field: string, max = 512): string {
  const value = body[field];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    })
  ) {
    throw new StudioHttpError(400, `${field} must be bounded non-control text`);
  }
  return value;
}

async function reviewCampaign(root: string, campaignPath: string): Promise<ReviewedCampaign> {
  const parsedPath = CampaignRelativePathSchema.safeParse(campaignPath);
  if (!parsedPath.success) {
    throw new StudioHttpError(400, parsedPath.error.issues[0]?.message ?? "Invalid campaign path");
  }
  const loaded = await loadCampaignFile(parsedPath.data, root);
  const plans: unknown[] = [];
  for (const target of loaded.campaign.targets) {
    if (target.kind === "trace") {
      await containedExistingFile(root, target.trace);
      plans.push({ target: target.id, kind: target.kind, trace: target.trace });
      continue;
    }
    if (target.allowRemote) {
      throw new StudioHttpError(403, "Studio v0.6.0 accepts loopback MCP targets only");
    }
    const imported = await loadInspectorConfig(resolve(root, target.inspectorConfig), {
      serverName: target.server,
      allowRemote: false,
      allowedRoot: root,
      environment: process.env,
    });
    plans.push({
      target: target.id,
      kind: target.kind,
      allowTools: target.allowTools,
      execution: imported.plan,
    });
  }
  return {
    campaign: loaded.campaign,
    campaignPath,
    campaignHash: loaded.campaignHash,
    plans,
    requiresToolConfirmation: loaded.campaign.targets.some(
      (target) => target.kind === "mcp" && target.allowTools.length > 0,
    ),
    expiresAt: Date.now() + REVIEW_TTL_MS,
  };
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".json":
    case ".jsonl":
    case ".sarif":
      return "application/json; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".xml":
      return "application/xml; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".yml":
    case ".yaml":
    case ".md":
    case ".txt":
    case ".mjs":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

async function collectArtifacts(root: string, directory: string): Promise<Artifact[]> {
  const output: Artifact[] = [];
  async function visit(current: string): Promise<void> {
    if (output.length >= MAX_ARTIFACTS) return;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (output.length >= MAX_ARTIFACTS) return;
      const path = resolve(current, entry.name);
      const information = await lstat(path);
      if (information.isSymbolicLink()) continue;
      if (information.isDirectory()) await visit(path);
      else if (information.isFile()) {
        const repositoryRelative = relative(root, path).replaceAll("\\", "/");
        output.push({
          id: createHash("sha256").update(repositoryRelative).digest("hex").slice(0, 20),
          path: repositoryRelative,
          absolutePath: path,
          bytes: information.size,
        });
      }
    }
  }
  await visit(directory);
  return output.sort((left, right) => left.path.localeCompare(right.path));
}

function publicRun(entry: StudioRun): Record<string, unknown> {
  return {
    state: entry.state,
    progress: entry.progress,
    ...(entry.run ? { run: entry.run } : {}),
    ...(entry.error ? { error: entry.error } : {}),
    artifacts: entry.artifacts.map(({ id, path, bytes }) => ({ id, path, bytes })),
  };
}

export async function startStudio(options: StudioOptions = {}): Promise<StudioInstance> {
  const started = performance.now();
  if (options.host !== undefined && options.host !== HOST) {
    throw new Error("Studio v0.6.0 binds only to 127.0.0.1");
  }
  const portInput = options.port ?? 0;
  if (!Number.isSafeInteger(portInput) || portInput < 0 || portInput > 65_535) {
    throw new Error("Studio port must be an integer from 0 to 65535");
  }
  const root = await realpath(resolve(options.rootDirectory ?? process.cwd()));
  const sessionSecret = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");
  const sessionExpiresAt = Date.now() + SESSION_TTL_MS;
  const reviews = new Map<string, ReviewedCampaign>();
  const confirmations = new Map<string, { campaignHash: string; expiresAt: number }>();
  const runs = new Map<string, StudioRun>();
  let origin = "";
  let expectedHost = "";
  let closed = false;

  const server = createServer(async (request, response) => {
    try {
      const hostHeader = request.headers.host;
      if (hostHeader !== expectedHost) throw new StudioHttpError(403, "Invalid Host header");
      const requestOrigin = request.headers.origin;
      if (requestOrigin !== undefined && requestOrigin !== origin) {
        throw new StudioHttpError(403, "Invalid Origin header");
      }
      const url = new URL(request.url ?? "/", origin);
      const method = request.method ?? "GET";

      if (method === "GET" && url.pathname === "/") {
        securityHeaders(response);
        response.setHeader(
          "set-cookie",
          `resilireplay_session=${sessionSecret}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${String(SESSION_TTL_MS / 1_000)}`,
        );
        sendText(response, 200, "text/html; charset=utf-8", studioHtml(csrfToken));
        return;
      }
      if (method === "GET" && url.pathname === "/app.css") {
        sendText(response, 200, "text/css; charset=utf-8", STUDIO_CSS);
        return;
      }
      if (method === "GET" && url.pathname === "/app.js") {
        sendText(response, 200, "text/javascript; charset=utf-8", STUDIO_JS);
        return;
      }

      if (
        Date.now() >= sessionExpiresAt ||
        !safeEqual(cookieValue(request, "resilireplay_session"), sessionSecret)
      ) {
        throw new StudioHttpError(401, "Studio session is missing or invalid");
      }
      if (method !== "GET") {
        if (requestOrigin !== origin) throw new StudioHttpError(403, "Origin is required");
        if (!safeEqual(request.headers["x-resilireplay-csrf"] as string | undefined, csrfToken)) {
          throw new StudioHttpError(403, "CSRF token is missing or invalid");
        }
      }

      if (method === "GET" && url.pathname === "/api/status") {
        sendJson(response, 200, {
          product: "ResiliReplay Studio",
          version: "0.6.0",
          bind: HOST,
          telemetry: false,
        });
        return;
      }

      if (method === "POST" && url.pathname === "/api/review") {
        const body = await readJson(request);
        const campaignPath = stringField(body, "campaignPath");
        const reviewed = await reviewCampaign(root, campaignPath);
        reviews.set(reviewed.campaignHash, reviewed);
        sendJson(response, 200, reviewed);
        return;
      }

      if (method === "POST" && url.pathname === "/api/campaigns") {
        const body = await readJson(request);
        const output = stringField(body, "output");
        const inspectorConfig = stringField(body, "inspectorConfig");
        const serverName = stringField(body, "server", 128);
        const fault = stringField(body, "fault", 128);
        const recovery = stringField(body, "recovery", 16);
        const seed = body.seed;
        const allowTools = body.allowTools;
        if (
          (fault !== "none" && !MCP_FAULT_TYPES.includes(fault as never)) ||
          (recovery !== "none" && recovery !== "retry") ||
          typeof seed !== "number" ||
          !Number.isSafeInteger(seed) ||
          !Array.isArray(allowTools) ||
          allowTools.length > 32 ||
          allowTools.some(
            (tool) =>
              typeof tool !== "string" ||
              tool.length === 0 ||
              tool.length > 128 ||
              [...tool].some((character) => {
                const code = character.codePointAt(0) ?? 0;
                return code <= 31 || code === 127;
              }),
          )
        ) {
          throw new StudioHttpError(400, "Invalid bounded campaign builder fields");
        }
        await loadInspectorConfig(resolve(root, inspectorConfig), {
          serverName,
          allowRemote: false,
          allowedRoot: root,
          environment: process.env,
        });
        const retryable = fault === "mcp-tool-error" || fault === "mcp-tool-timeout";
        const expectedOutcome =
          fault === "none" || (retryable && recovery === "retry") ? "passed" : "failed";
        const campaign = CampaignSchema.parse({
          schemaVersion: "1.0",
          kind: "resilireplay-campaign",
          id: `studio-${createHash("sha256").update(`${inspectorConfig}:${serverName}:${fault}`).digest("hex").slice(0, 12)}`,
          description: "Campaign created locally in ResiliReplay Studio.",
          seed,
          budgets: {
            concurrency: 1,
            retries: 1,
            scenarioTimeoutMs: 10_000,
            totalTimeoutMs: 60_000,
          },
          targets: [
            {
              id: "reviewed-mcp",
              kind: "mcp",
              inspectorConfig,
              server: serverName,
              allowTools,
              allowRemote: false,
            },
          ],
          scenarios: [
            {
              id: `scenario-${fault}`,
              target: "reviewed-mcp",
              fault,
              recovery,
              assertions: {
                outcome: expectedOutcome,
                ...(retryable && recovery === "retry" ? { safeRecovery: true } : {}),
                noDuplicateSideEffects: true,
                safetyPolicyCompliance: fault === "mcp-malicious-canary-instruction" ? false : true,
              },
            },
          ],
          thresholds: {
            maxScoreDrop: 0,
            maxRetryIncrease: 0,
            maxDuplicateSideEffectIncrease: 0,
          },
        });
        try {
          const written = await writeCampaignFile(campaign, output, root);
          sendJson(response, 201, {
            path: relative(root, written.path).replaceAll("\\", "/"),
            campaignHash: written.campaignHash,
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new StudioHttpError(409, "Campaign file already exists");
          }
          throw error;
        }
        return;
      }

      if (method === "POST" && url.pathname === "/api/confirm") {
        const body = await readJson(request);
        const hash = stringField(body, "campaignHash", 64);
        if (body.acknowledgement !== "reviewed-and-authorized") {
          throw new StudioHttpError(400, "Explicit reviewed-target acknowledgement is required");
        }
        const review = reviews.get(hash);
        if (!review || review.expiresAt < Date.now() || !review.requiresToolConfirmation) {
          throw new StudioHttpError(
            409,
            "Campaign review is missing, expired, or has no tool calls",
          );
        }
        const token = randomBytes(24).toString("base64url");
        confirmations.set(token, { campaignHash: hash, expiresAt: Date.now() + 5 * 60_000 });
        sendJson(response, 200, { confirmationToken: token });
        return;
      }

      if (method === "POST" && url.pathname === "/api/run") {
        const body = await readJson(request);
        const hash = stringField(body, "campaignHash", 64);
        const review = reviews.get(hash);
        if (!review || review.expiresAt < Date.now()) {
          throw new StudioHttpError(409, "Review the campaign again before execution");
        }
        if (campaignHash(review.campaign) !== hash) {
          throw new StudioHttpError(409, "Reviewed campaign hash no longer matches");
        }
        if (review.requiresToolConfirmation) {
          const token =
            typeof body.confirmationToken === "string" ? body.confirmationToken : undefined;
          const confirmation = token ? confirmations.get(token) : undefined;
          if (
            !token ||
            !confirmation ||
            confirmation.campaignHash !== hash ||
            confirmation.expiresAt < Date.now()
          ) {
            throw new StudioHttpError(
              403,
              "Single-use tool-call confirmation is missing or expired",
            );
          }
          confirmations.delete(token);
        }
        const runId = randomBytes(12).toString("hex");
        const controller = new AbortController();
        const entry = {} as StudioRun;
        entry.state = "running";
        entry.progress = {
          phase: "starting",
          completed: 0,
          total: review.campaign.scenarios.length,
        };
        entry.controller = controller;
        entry.artifacts = [];
        entry.promise = (async () => {
          try {
            const result = await runCampaign(review.campaign, {
              rootDirectory: root,
              outputDirectory: `runs/studio/${review.campaign.id}-${Date.now().toString(36)}-${runId.slice(0, 6)}`,
              ...(review.requiresToolConfirmation ? { confirmedToolCampaignHash: hash } : {}),
              signal: controller.signal,
              onProgress: (progress) => {
                entry.progress = progress;
              },
            });
            entry.run = result.run;
            entry.outputDirectory = result.outputDirectory;
            await writeCampaignRunReports(
              result.run,
              safeOutputPath(result.outputDirectory, "reports"),
            );
            entry.artifacts = await collectArtifacts(root, result.outputDirectory);
            entry.state = "complete";
          } catch (error) {
            entry.state = "error";
            entry.error = String(
              sanitize(error instanceof Error ? error.message : String(error)),
            ).slice(0, 1_000);
          }
        })();
        runs.set(runId, entry);
        sendJson(response, 202, { runId });
        return;
      }

      const runMatch = /^\/api\/runs\/([a-f0-9]{24})$/u.exec(url.pathname);
      if (method === "GET" && runMatch) {
        const entry = runs.get(runMatch[1]!);
        if (!entry) throw new StudioHttpError(404, "Studio run was not found");
        sendJson(response, 200, publicRun(entry));
        return;
      }

      const cancelMatch = /^\/api\/runs\/([a-f0-9]{24})\/cancel$/u.exec(url.pathname);
      if (method === "POST" && cancelMatch) {
        await readJson(request);
        const entry = runs.get(cancelMatch[1]!);
        if (!entry) throw new StudioHttpError(404, "Studio run was not found");
        entry.controller.abort(new Error("Cancelled by Studio user"));
        sendJson(response, 202, { cancelled: true });
        return;
      }

      const timelineMatch = /^\/api\/runs\/([a-f0-9]{24})\/timeline$/u.exec(url.pathname);
      if (method === "GET" && timelineMatch) {
        const entry = runs.get(timelineMatch[1]!);
        if (!entry?.run) throw new StudioHttpError(409, "Run evidence is not complete");
        const events: unknown[] = [];
        for (const result of entry.run.results) {
          if (!result.tracePath) continue;
          const tracePath = await containedExistingFile(root, result.tracePath);
          for (const event of await readTrace(tracePath)) {
            if (events.length >= 2_000) break;
            events.push({
              scenarioId: result.id,
              sequence: event.sequence,
              timestamp: event.timestamp,
              type: event.type,
              actor: event.actor,
              ...(event.tool ? { tool: event.tool } : {}),
              ...(event.model ? { model: event.model } : {}),
              ...(event.fault ? { fault: event.fault.faultType } : {}),
              stepId: event.stepId,
              ...(event.parentId ? { parentId: event.parentId } : {}),
              ...(event.causeId ? { causeId: event.causeId } : {}),
            });
          }
        }
        sendJson(response, 200, { events, truncated: events.length >= 2_000 });
        return;
      }

      const downloadMatch = /^\/api\/runs\/([a-f0-9]{24})\/downloads\/([a-f0-9]{20})$/u.exec(
        url.pathname,
      );
      if (method === "GET" && downloadMatch) {
        const entry = runs.get(downloadMatch[1]!);
        const artifact = entry?.artifacts.find((item) => item.id === downloadMatch[2]);
        if (!entry?.outputDirectory || !artifact)
          throw new StudioHttpError(404, "Artifact not found");
        const actual = await realpath(artifact.absolutePath);
        const actualOutput = await realpath(entry.outputDirectory);
        if (!isContained(actualOutput, actual) || (await lstat(actual)).isSymbolicLink()) {
          throw new StudioHttpError(403, "Artifact containment check failed");
        }
        securityHeaders(response);
        response.statusCode = 200;
        response.setHeader("content-type", contentType(actual));
        response.setHeader("content-length", artifact.bytes);
        response.setHeader(
          "content-disposition",
          `attachment; filename="${basename(actual).replaceAll('"', "_")}"`,
        );
        createReadStream(actual).pipe(response);
        return;
      }

      if (method === "POST" && url.pathname === "/api/baseline/approve") {
        const body = await readJson(request);
        const runId = stringField(body, "runId", 24);
        const pathInput = stringField(body, "path");
        const entry = runs.get(runId);
        if (!entry?.run) throw new StudioHttpError(409, "Run evidence is not complete");
        const path = await containedOutputFile(root, pathInput);
        const baseline = approveCampaignBaseline(entry.run);
        try {
          await writeCampaignBaseline(baseline, path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new StudioHttpError(409, "Baseline file already exists");
          }
          throw error;
        }
        sendJson(response, 201, {
          path: relative(root, path).replaceAll("\\", "/"),
          baselineHash: baseline.baselineHash,
        });
        return;
      }

      if (method === "POST" && url.pathname === "/api/baseline/compare") {
        const body = await readJson(request);
        const runId = stringField(body, "runId", 24);
        const pathInput = stringField(body, "path");
        const entry = runs.get(runId);
        if (!entry?.run || !entry.outputDirectory) {
          throw new StudioHttpError(409, "Run evidence is not complete");
        }
        const baselinePath = await containedExistingFile(root, pathInput);
        const baseline = await loadCampaignBaseline(baselinePath);
        const comparison = compareCampaignRun(entry.run, baseline);
        await writeCampaignComparisonReports(
          comparison,
          safeOutputPath(entry.outputDirectory, "comparison"),
        );
        entry.artifacts = await collectArtifacts(root, entry.outputDirectory);
        sendJson(response, 200, { comparison });
        return;
      }

      throw new StudioHttpError(404, "Studio route was not found");
    } catch (error) {
      const status =
        error instanceof StudioHttpError
          ? error.status
          : error instanceof CampaignError
            ? error.exitCode === CAMPAIGN_EXIT_CODES.AUTHORIZATION
              ? 403
              : error.exitCode === CAMPAIGN_EXIT_CODES.TARGET
                ? 404
                : error.exitCode === CAMPAIGN_EXIT_CODES.INTEGRITY
                  ? 409
                  : 400
            : 500;
      const message = String(
        sanitize(error instanceof Error ? error.message : String(error)),
      ).slice(0, 1_000);
      sendJson(response, status, {
        error: status === 500 ? `Studio request failed: ${message}` : message,
      });
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(portInput, HOST, () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Studio did not acquire a TCP port");
  }
  expectedHost = `${HOST}:${address.port}`;
  origin = `http://${expectedHost}`;

  return {
    url: origin,
    host: HOST,
    port: address.port,
    startupMs: Math.max(0, Math.round(performance.now() - started)),
    close: async () => {
      if (closed) return;
      closed = true;
      for (const entry of runs.values()) entry.controller.abort(new Error("Studio shutdown"));
      await Promise.allSettled([...runs.values()].map((entry) => entry.promise));
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      server.closeAllConnections();
      reviews.clear();
      confirmations.clear();
      runs.clear();
    },
  };
}
