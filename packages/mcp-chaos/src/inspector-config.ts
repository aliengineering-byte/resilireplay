import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve, sep, win32 } from "node:path";
import { containsLikelySecret, sanitize } from "@resilireplay/core";

export const MCP_EXIT_CODES = {
  FINDINGS: 1,
  USAGE: 2,
  CONFIG: 10,
  REMOTE_AUTHORIZATION: 11,
  CONNECTION: 12,
  SECRET_OUTPUT: 13,
} as const;

export class McpInspectorConfigError extends Error {
  readonly exitCode = MCP_EXIT_CODES.CONFIG;

  constructor(
    message: string,
    readonly errorId: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "McpInspectorConfigError";
  }
}

export class McpRemoteAuthorizationError extends Error {
  readonly exitCode = MCP_EXIT_CODES.REMOTE_AUTHORIZATION;

  constructor(message = "Remote MCP audit requires explicit --allow-remote confirmation") {
    super(message);
    this.name = "McpRemoteAuthorizationError";
  }
}

export type ImportedValueSource = "literal" | "variable-reference";

export interface SanitizedDeclaredValue {
  name: string;
  source: ImportedValueSource;
  resolved: boolean;
  value: "[REDACTED]";
}

export interface SanitizedExecutionPlan {
  schemaVersion: "1.0";
  source: "mcp-inspector-mcp-json";
  compatibility: "MCP Inspector 2.0.0";
  configSha256: string;
  server: string;
  transport: "stdio" | "streamable-http" | "sse";
  remoteAuthorizationRequired: boolean;
  command?: string;
  arguments?: string[];
  workingDirectory?: string;
  url?: string;
  environment: SanitizedDeclaredValue[];
  headers: SanitizedDeclaredValue[];
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
  warnings: string[];
}

interface ImportedServerBase {
  serverName: string;
  configSha256: string;
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
  plan: SanitizedExecutionPlan;
}

export interface ImportedStdioServer extends ImportedServerBase {
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

export interface ImportedHttpServer extends ImportedServerBase {
  transport: "streamable-http" | "sse";
  url: string;
  headers: Record<string, string>;
}

export type ImportedInspectorServer = ImportedStdioServer | ImportedHttpServer;

export interface LoadInspectorConfigOptions {
  serverName?: string;
  allowRemote?: boolean;
  allowedRoot?: string;
  environment?: NodeJS.ProcessEnv;
}

export interface InspectorConfigSummary {
  path: string;
  configSha256: string;
  serverNames: string[];
}

const DEFAULT_TIMEOUT_MS = 5_000;
const SAFE_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;
const VARIABLE_REFERENCE = /^\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/u;
const SENSITIVE_ARGUMENT = /(?:authorization|api[-_]?key|token|secret|password|passwd)/iu;
const SENSITIVE_QUERY = /^(?:authorization|api[-_]?key|access[-_]?token|token|secret|password)$/iu;
const FORBIDDEN_ENV = new Set([
  "DANGEROUSLY_OMIT_AUTH",
  "MCP_PROXY_AUTH_TOKEN",
  "MCP_INSPECTOR_PROXY_AUTH_TOKEN",
]);
const FORBIDDEN_HEADERS = new Set(["mcp-proxy-auth-token", "x-mcp-proxy-auth-token"]);
const CONTROLLED_HEADERS = new Set(["connection", "content-length", "host", "transfer-encoding"]);
const ENTRY_FIELDS = new Set([
  "type",
  "command",
  "args",
  "env",
  "cwd",
  "url",
  "headers",
  "connectionTimeout",
  "requestTimeout",
  "note",
  "protocolEra",
  "modernLogLevel",
  "roots",
  "metadata",
  "taskTtl",
  "autoRefreshOnListChanged",
  "paginatedLists",
  "advertisedExtensions",
  "maxFetchRequests",
  "oauth",
  "requestInit",
  "eventSourceInit",
  "settings",
]);
const UNSUPPORTED_EXECUTION_FIELDS = [
  "modernLogLevel",
  "roots",
  "metadata",
  "taskTtl",
  "autoRefreshOnListChanged",
  "paginatedLists",
  "advertisedExtensions",
  "maxFetchRequests",
  "oauth",
  "requestInit",
  "eventSourceInit",
  "settings",
] as const;

function configError(errorId: string, message: string, cause?: unknown): never {
  throw new McpInspectorConfigError(message, errorId, cause === undefined ? undefined : { cause });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsAsciiControl(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) <= 0x1f);
}

function isContained(base: string, candidate: string): boolean {
  const relationship = relative(resolve(base), resolve(candidate));
  return (
    relationship === "" ||
    (relationship !== ".." && !relationship.startsWith(`..${sep}`) && !isAbsolute(relationship))
  );
}

async function verifyContainedExistingPath(
  base: string,
  candidate: string,
  errorId: string,
  label: string,
): Promise<string> {
  if (!isContained(base, candidate)) {
    configError(errorId, `${label} escapes the allowed repository root`);
  }
  try {
    const actual = await realpath(candidate);
    if (!isContained(base, actual)) {
      configError(errorId, `${label} resolves through a link outside the allowed repository root`);
    }
    return actual;
  } catch (error) {
    const code = isRecord(error) && typeof error.code === "string" ? error.code : undefined;
    if (code === "ENOENT") return candidate;
    configError(errorId, `Unable to resolve ${label}`, error);
  }
}

class DuplicateKeyScanner {
  private index = 0;

  constructor(private readonly raw: string) {}

  scan(): void {
    this.value("$");
  }

  private whitespace(): void {
    while (/\s/u.test(this.raw[this.index] ?? "")) this.index += 1;
  }

  private value(path: string): void {
    this.whitespace();
    const character = this.raw[this.index];
    if (character === "{") this.object(path);
    else if (character === "[") this.array(path);
    else if (character === '"') this.string();
    else {
      while (this.index < this.raw.length && !/[\s,}\]]/u.test(this.raw[this.index] ?? "")) {
        this.index += 1;
      }
    }
    this.whitespace();
  }

  private object(path: string): void {
    this.index += 1;
    this.whitespace();
    const keys = new Set<string>();
    if (this.raw[this.index] === "}") {
      this.index += 1;
      return;
    }
    while (this.index < this.raw.length) {
      const key = this.string();
      if (keys.has(key)) {
        configError("RR_MCP_CONFIG_DUPLICATE_KEY", `Duplicate JSON key at ${path}.${key}`);
      }
      keys.add(key);
      this.whitespace();
      this.index += 1; // colon; JSON.parse already established syntactic validity.
      this.value(`${path}.${key}`);
      if (this.raw[this.index] === "}") {
        this.index += 1;
        return;
      }
      this.index += 1; // comma
      this.whitespace();
    }
  }

  private array(path: string): void {
    this.index += 1;
    this.whitespace();
    if (this.raw[this.index] === "]") {
      this.index += 1;
      return;
    }
    let item = 0;
    while (this.index < this.raw.length) {
      this.value(`${path}[${item}]`);
      item += 1;
      if (this.raw[this.index] === "]") {
        this.index += 1;
        return;
      }
      this.index += 1;
      this.whitespace();
    }
  }

  private string(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.raw.length) {
      const character = this.raw[this.index];
      if (character === "\\") {
        this.index += 2;
        continue;
      }
      this.index += 1;
      if (character === '"') break;
    }
    return JSON.parse(this.raw.slice(start, this.index)) as string;
  }
}

function parseJson(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    configError(
      "RR_MCP_CONFIG_INVALID_JSON",
      `Inspector configuration is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
  new DuplicateKeyScanner(raw).scan();
  if (!isRecord(parsed)) {
    configError("RR_MCP_CONFIG_TOP_LEVEL", "Inspector configuration must be a JSON object");
  }
  return parsed;
}

function validateTimeout(entry: Record<string, unknown>, field: string): number | undefined {
  const value = entry[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    configError(
      "RR_MCP_CONFIG_TIMEOUT",
      `${field} must be a positive integer number of milliseconds`,
    );
  }
  return value;
}

function resolveDeclaredValue(
  name: string,
  value: string,
  environment: NodeJS.ProcessEnv,
): { value: string; plan: SanitizedDeclaredValue } {
  const match = VARIABLE_REFERENCE.exec(value);
  if (!match) {
    return {
      value,
      plan: { name, source: "literal", resolved: true, value: "[REDACTED]" },
    };
  }
  const variable = match[1]!;
  const resolvedValue = environment[variable];
  if (resolvedValue === undefined) {
    configError(
      "RR_MCP_CONFIG_ENV_REFERENCE",
      `Environment reference ${value} for ${name} is not defined`,
    );
  }
  return {
    value: resolvedValue,
    plan: { name, source: "variable-reference", resolved: true, value: "[REDACTED]" },
  };
}

function parseDeclaredMap(
  input: unknown,
  kind: "environment" | "headers",
  environment: NodeJS.ProcessEnv,
): { values: Record<string, string>; plan: SanitizedDeclaredValue[] } {
  if (input === undefined) return { values: {}, plan: [] };
  if (!isRecord(input)) {
    configError(
      kind === "environment" ? "RR_MCP_CONFIG_ENV" : "RR_MCP_CONFIG_HEADERS",
      `${kind === "environment" ? "env" : "headers"} must be an object of string values`,
    );
  }
  const values: Record<string, string> = {};
  const plan: SanitizedDeclaredValue[] = [];
  for (const [name, rawValue] of Object.entries(input)) {
    if (typeof rawValue !== "string") {
      configError(
        kind === "environment" ? "RR_MCP_CONFIG_ENV" : "RR_MCP_CONFIG_HEADERS",
        `${kind === "environment" ? "Environment" : "Header"} value for ${name} must be a string`,
      );
    }
    if (kind === "environment") {
      if (!SAFE_ENV_NAME.test(name)) {
        configError(
          "RR_MCP_CONFIG_ENV",
          `Environment name ${JSON.stringify(name)} is not portable`,
        );
      }
      if (FORBIDDEN_ENV.has(name.toUpperCase())) {
        configError(
          "RR_MCP_CONFIG_FORBIDDEN_AUTH_SETTING",
          `${name} cannot be imported because Inspector authentication must remain enabled`,
        );
      }
    } else {
      const normalized = name.toLowerCase();
      if (!HEADER_NAME.test(name)) {
        configError("RR_MCP_CONFIG_HEADERS", `Header name ${JSON.stringify(name)} is invalid`);
      }
      if (FORBIDDEN_HEADERS.has(normalized)) {
        configError(
          "RR_MCP_CONFIG_FORBIDDEN_AUTH_SETTING",
          `${name} is an Inspector proxy credential and cannot be imported`,
        );
      }
      if (CONTROLLED_HEADERS.has(normalized)) {
        configError("RR_MCP_CONFIG_HEADERS", `${name} is controlled by the HTTP transport`);
      }
      if (/\r|\n/u.test(rawValue)) {
        configError("RR_MCP_CONFIG_HEADERS", `Header ${name} contains a forbidden line break`);
      }
    }
    const resolved = resolveDeclaredValue(name, rawValue, environment);
    values[name] = resolved.value;
    plan.push(resolved.plan);
  }
  return { values, plan };
}

export function classifyInspectorPath(
  value: string,
  platform: NodeJS.Platform = process.platform,
): "bare" | "relative" | "native-absolute" | "foreign-absolute" {
  const windowsAbsolute = /^(?:[A-Za-z]:[\\/]|\\\\)/u.test(value);
  const posixAbsolute = posix.isAbsolute(value) && !value.startsWith("//");
  if (platform === "win32") {
    if (windowsAbsolute) return "native-absolute";
    if (posixAbsolute) return "foreign-absolute";
  } else {
    if (posixAbsolute) return "native-absolute";
    if (windowsAbsolute || win32.isAbsolute(value)) return "foreign-absolute";
  }
  return value.startsWith(".") ||
    value.includes("/") ||
    value.includes("\\") ||
    /\.(?:[cm]?js|ts|py|rb|sh|ps1|cmd|bat|exe)$/iu.test(value)
    ? "relative"
    : "bare";
}

function looksLikePath(value: string): boolean {
  return classifyInspectorPath(value) !== "bare";
}

async function resolvePathReference(
  value: string,
  configDirectory: string,
  allowedRoot: string,
  label: string,
): Promise<string> {
  const classification = classifyInspectorPath(value);
  if (classification === "foreign-absolute") return value;
  const candidate =
    classification === "native-absolute" ? resolve(value) : resolve(configDirectory, value);
  if (!isContained(allowedRoot, candidate)) {
    configError("RR_MCP_CONFIG_PATH_ESCAPE", `${label} escapes the allowed repository root`);
  }
  return verifyContainedExistingPath(allowedRoot, candidate, "RR_MCP_CONFIG_PATH_ESCAPE", label);
}

function sanitizedArguments(args: readonly string[]): string[] {
  let redactNext = false;
  return args.map((argument) => {
    if (redactNext) {
      redactNext = false;
      return "[REDACTED]";
    }
    const equals = argument.indexOf("=");
    if (equals > 0 && SENSITIVE_ARGUMENT.test(argument.slice(0, equals))) {
      return `${argument.slice(0, equals + 1)}[REDACTED]`;
    }
    if (argument.startsWith("-") && SENSITIVE_ARGUMENT.test(argument)) {
      redactNext = true;
      return argument;
    }
    return sanitize(argument);
  });
}

function validateEntryFields(entry: Record<string, unknown>): void {
  for (const field of Object.keys(entry)) {
    if (!ENTRY_FIELDS.has(field)) {
      configError("RR_MCP_CONFIG_UNKNOWN_FIELD", `Unsupported Inspector server field: ${field}`);
    }
  }
  for (const field of UNSUPPORTED_EXECUTION_FIELDS) {
    if (entry[field] !== undefined) {
      configError(
        "RR_MCP_CONFIG_UNSUPPORTED_FIELD",
        `Inspector field ${field} affects execution but is not supported by this ResiliReplay release`,
      );
    }
  }
  if (entry.protocolEra !== undefined && entry.protocolEra !== "legacy") {
    configError(
      "RR_MCP_CONFIG_PROTOCOL_ERA",
      "Only Inspector's legacy protocol era is supported by the current ResiliReplay MCP SDK",
    );
  }
  if (entry.note !== undefined && typeof entry.note !== "string") {
    configError("RR_MCP_CONFIG_NOTE", "Inspector note must be a string when present");
  }
}

function parseUrl(value: unknown): URL {
  if (typeof value !== "string" || value.trim() === "") {
    configError("RR_MCP_CONFIG_URL", "HTTP and SSE Inspector entries require a non-empty url");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    configError("RR_MCP_CONFIG_URL", `Invalid MCP server URL: ${value}`, error);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    configError("RR_MCP_CONFIG_URL", "MCP server URL must use http or https");
  }
  if (url.username || url.password) {
    configError(
      "RR_MCP_CONFIG_URL_CREDENTIAL",
      "Credentials are not permitted in an MCP server URL",
    );
  }
  if (url.hash) {
    configError("RR_MCP_CONFIG_URL", "MCP server URL must not contain a fragment");
  }
  for (const [key, queryValue] of url.searchParams) {
    if (SENSITIVE_QUERY.test(key) || containsLikelySecret(queryValue)) {
      configError(
        "RR_MCP_CONFIG_URL_CREDENTIAL",
        `Credential-shaped URL query parameter ${key} must be supplied as a redacted header instead`,
      );
    }
  }
  return url;
}

export function isLoopbackMcpUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export async function listInspectorServers(
  fileInput: string,
  options: Pick<LoadInspectorConfigOptions, "allowedRoot"> = {},
): Promise<InspectorConfigSummary> {
  const unresolvedFile = resolve(fileInput);
  const allowedRoot = resolve(options.allowedRoot ?? dirname(unresolvedFile));
  if (!isContained(allowedRoot, unresolvedFile)) {
    configError(
      "RR_MCP_CONFIG_PATH_ESCAPE",
      "Inspector configuration path escapes the allowed repository root",
    );
  }
  let file: string;
  try {
    file = await realpath(unresolvedFile);
    if (!isContained(allowedRoot, file)) {
      configError(
        "RR_MCP_CONFIG_PATH_ESCAPE",
        "Inspector configuration resolves through a link outside the allowed repository root",
      );
    }
    const information = await stat(file);
    if (!information.isFile()) {
      configError("RR_MCP_CONFIG_NOT_FILE", "Inspector configuration path is not a file");
    }
  } catch (error) {
    if (error instanceof McpInspectorConfigError) throw error;
    configError("RR_MCP_CONFIG_MISSING", "Inspector configuration file was not found", error);
  }
  const raw = await readFile(file, "utf8");
  const parsed = parseJson(raw);
  if (!Object.hasOwn(parsed, "mcpServers") || !isRecord(parsed.mcpServers)) {
    configError("RR_MCP_CONFIG_MISSING_SERVERS", "Inspector configuration must contain mcpServers");
  }
  if (Object.keys(parsed).some((field) => field !== "mcpServers")) {
    configError(
      "RR_MCP_CONFIG_TOP_LEVEL_FIELD",
      `Unsupported top-level Inspector field: ${Object.keys(parsed).find((field) => field !== "mcpServers")}`,
    );
  }
  const serverNames = Object.keys(parsed.mcpServers);
  if (serverNames.length === 0) {
    configError("RR_MCP_CONFIG_ZERO_SERVERS", "Inspector configuration contains zero servers");
  }
  for (const name of serverNames) {
    if (name.trim() === "" || name.length > 128 || containsAsciiControl(name)) {
      configError("RR_MCP_CONFIG_SERVER_NAME", "Inspector server names must be non-empty text");
    }
    if (containsLikelySecret(name)) {
      configError(
        "RR_MCP_CONFIG_SERVER_NAME_SECRET",
        "Inspector server names must not contain credential-shaped values",
      );
    }
  }
  return {
    path: file,
    configSha256: createHash("sha256").update(raw).digest("hex"),
    serverNames,
  };
}

export async function loadInspectorConfig(
  fileInput: string,
  options: LoadInspectorConfigOptions = {},
): Promise<ImportedInspectorServer> {
  const unresolvedFile = resolve(fileInput);
  const allowedRoot = resolve(options.allowedRoot ?? dirname(unresolvedFile));
  if (!isContained(allowedRoot, unresolvedFile)) {
    configError(
      "RR_MCP_CONFIG_PATH_ESCAPE",
      "Inspector configuration path escapes the allowed repository root",
    );
  }

  let file: string;
  try {
    file = await realpath(unresolvedFile);
    if (!isContained(allowedRoot, file)) {
      configError(
        "RR_MCP_CONFIG_PATH_ESCAPE",
        "Inspector configuration resolves through a link outside the allowed repository root",
      );
    }
    const info = await stat(file);
    if (!info.isFile()) {
      configError("RR_MCP_CONFIG_NOT_FILE", "Inspector configuration path is not a file");
    }
  } catch (error) {
    if (error instanceof McpInspectorConfigError) throw error;
    configError("RR_MCP_CONFIG_MISSING", "Inspector configuration file was not found", error);
  }

  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    configError("RR_MCP_CONFIG_READ", "Inspector configuration file could not be read", error);
  }
  const parsed = parseJson(raw);
  const topLevelFields = Object.keys(parsed);
  if (!Object.hasOwn(parsed, "mcpServers")) {
    configError("RR_MCP_CONFIG_MISSING_SERVERS", "Inspector configuration must contain mcpServers");
  }
  if (topLevelFields.some((field) => field !== "mcpServers")) {
    configError(
      "RR_MCP_CONFIG_TOP_LEVEL_FIELD",
      `Unsupported top-level Inspector field: ${topLevelFields.find((field) => field !== "mcpServers")}`,
    );
  }
  if (!isRecord(parsed.mcpServers)) {
    configError("RR_MCP_CONFIG_SERVERS_TYPE", "mcpServers must be an object keyed by server name");
  }
  const servers = parsed.mcpServers;
  const names = Object.keys(servers);
  if (names.length === 0) {
    configError("RR_MCP_CONFIG_ZERO_SERVERS", "Inspector configuration contains zero servers");
  }
  for (const name of names) {
    if (name.trim() === "" || name.length > 128 || containsAsciiControl(name)) {
      configError("RR_MCP_CONFIG_SERVER_NAME", "Inspector server names must be non-empty text");
    }
    if (containsLikelySecret(name)) {
      configError(
        "RR_MCP_CONFIG_SERVER_NAME_SECRET",
        "Inspector server names must not contain credential-shaped values",
      );
    }
  }

  let serverName = options.serverName;
  if (serverName === undefined) {
    if (names.length !== 1) {
      configError(
        "RR_MCP_CONFIG_SELECTION_REQUIRED",
        `Multiple Inspector servers require --server. Available servers: ${names.join(", ")}`,
      );
    }
    serverName = names[0]!;
  }
  if (!Object.hasOwn(servers, serverName)) {
    configError(
      "RR_MCP_CONFIG_UNKNOWN_SERVER",
      `Inspector server ${JSON.stringify(serverName)} was not found. Available servers: ${names.join(", ")}`,
    );
  }
  const selected = servers[serverName];
  if (!isRecord(selected)) {
    configError("RR_MCP_CONFIG_SERVER_TYPE", `Inspector server ${serverName} must be an object`);
  }
  validateEntryFields(selected);

  const configSha256 = createHash("sha256").update(raw).digest("hex");
  const connectionTimeoutMs = validateTimeout(selected, "connectionTimeout") ?? DEFAULT_TIMEOUT_MS;
  const requestTimeoutMs = validateTimeout(selected, "requestTimeout") ?? DEFAULT_TIMEOUT_MS;
  const environment = options.environment ?? process.env;
  const configDirectory = dirname(file);
  const rawType = selected.type;
  if (rawType !== undefined && typeof rawType !== "string") {
    configError("RR_MCP_CONFIG_TRANSPORT", "Inspector server type must be a string");
  }
  if (
    rawType !== undefined &&
    rawType !== "stdio" &&
    rawType !== "http" &&
    rawType !== "streamable-http" &&
    rawType !== "sse"
  ) {
    configError(
      "RR_MCP_CONFIG_TRANSPORT",
      `Unsupported Inspector transport ${JSON.stringify(rawType)}; use stdio, http, streamable-http, or sse`,
    );
  }

  const isStdio = rawType === undefined || rawType === "stdio";
  if (isStdio) {
    if (selected.url !== undefined || selected.headers !== undefined) {
      configError(
        "RR_MCP_CONFIG_CONFLICT",
        "Stdio Inspector entries cannot contain url or headers",
      );
    }
    if (typeof selected.command !== "string" || selected.command.trim() === "") {
      configError("RR_MCP_CONFIG_COMMAND", "Stdio Inspector entry requires a non-empty command");
    }
    if (
      selected.command.includes(String.fromCharCode(0)) ||
      selected.command.includes("\r") ||
      selected.command.includes("\n")
    ) {
      configError("RR_MCP_CONFIG_COMMAND", "Stdio command contains a forbidden control character");
    }
    if (selected.args !== undefined && !Array.isArray(selected.args)) {
      configError("RR_MCP_CONFIG_ARGS", "Stdio args must be an array of strings");
    }
    const rawArgs = selected.args ?? [];
    if (rawArgs.some((argument) => typeof argument !== "string")) {
      configError("RR_MCP_CONFIG_ARGS", "Every stdio argument must be a string");
    }
    const args = rawArgs as string[];
    if (args.some((argument) => argument.includes(String.fromCharCode(0)))) {
      configError("RR_MCP_CONFIG_ARGS", "Stdio arguments cannot contain NUL characters");
    }
    const declaredEnv = parseDeclaredMap(selected.env, "environment", environment);
    const command = looksLikePath(selected.command)
      ? await resolvePathReference(
          selected.command,
          configDirectory,
          allowedRoot,
          "Stdio command path",
        )
      : selected.command;
    const resolvedArgs = await Promise.all(
      args.map((argument, index) =>
        looksLikePath(argument) && !/^https?:\/\//iu.test(argument) && !argument.startsWith("-")
          ? resolvePathReference(
              argument,
              configDirectory,
              allowedRoot,
              `Stdio argument ${index + 1} path`,
            )
          : argument,
      ),
    );
    let cwd: string | undefined;
    if (selected.cwd !== undefined) {
      if (typeof selected.cwd !== "string" || selected.cwd.trim() === "") {
        configError("RR_MCP_CONFIG_CWD", "Stdio cwd must be a non-empty path string");
      }
      cwd = await resolvePathReference(selected.cwd, configDirectory, allowedRoot, "Stdio cwd");
    }
    const plan: SanitizedExecutionPlan = {
      schemaVersion: "1.0",
      source: "mcp-inspector-mcp-json",
      compatibility: "MCP Inspector 2.0.0",
      configSha256,
      server: serverName,
      transport: "stdio",
      remoteAuthorizationRequired: false,
      command: sanitize(selected.command),
      arguments: sanitizedArguments(args),
      workingDirectory: selected.cwd === undefined ? "<inherited>" : sanitize(selected.cwd),
      environment: declaredEnv.plan,
      headers: [],
      connectionTimeoutMs,
      requestTimeoutMs,
      warnings: [
        "This reviewed stdio configuration executes the declared command directly without a shell.",
        "Relative executable and script paths resolve from the configuration file directory.",
      ],
    };
    return {
      serverName,
      configSha256,
      transport: "stdio",
      command,
      args: resolvedArgs,
      env: declaredEnv.values,
      ...(cwd ? { cwd } : {}),
      connectionTimeoutMs,
      requestTimeoutMs,
      plan,
    };
  }

  if (
    selected.command !== undefined ||
    selected.args !== undefined ||
    selected.env !== undefined ||
    selected.cwd !== undefined
  ) {
    configError(
      "RR_MCP_CONFIG_CONFLICT",
      "HTTP and SSE Inspector entries cannot contain command, args, env, or cwd",
    );
  }
  const url = parseUrl(selected.url);
  const remote = !isLoopbackMcpUrl(url);
  if (remote && !options.allowRemote) throw new McpRemoteAuthorizationError();
  const declaredHeaders = parseDeclaredMap(selected.headers, "headers", environment);
  const transport = rawType === "sse" ? "sse" : "streamable-http";
  const plan: SanitizedExecutionPlan = {
    schemaVersion: "1.0",
    source: "mcp-inspector-mcp-json",
    compatibility: "MCP Inspector 2.0.0",
    configSha256,
    server: serverName,
    transport,
    remoteAuthorizationRequired: remote,
    url: url.toString(),
    environment: [],
    headers: declaredHeaders.plan,
    connectionTimeoutMs,
    requestTimeoutMs,
    warnings: [
      ...(transport === "sse"
        ? [
            "SSE is deprecated and supported only for backwards compatibility; prefer Streamable HTTP.",
          ]
        : []),
      "Authentication header values stay in memory and are never written to evidence artifacts.",
    ],
  };
  return {
    serverName,
    configSha256,
    transport,
    url: url.toString(),
    headers: declaredHeaders.values,
    connectionTimeoutMs,
    requestTimeoutMs,
    plan,
  };
}
