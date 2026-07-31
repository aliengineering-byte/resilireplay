import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(".");
const expectedOwner = "aliengineering-byte";
const findings = [];
const textExtensions = new Set([
  "",
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonl",
  ".md",
  ".mjs",
  ".svg",
  ".toml",
  ".ts",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const privateNames =
  /(?:^|\/)(?:\.env(?:\..+)?|credentials?(?:\..+)?|id_(?:rsa|ed25519)|.+\.(?:dpapi|key|kdbx|p12|pem|pfx))$/iu;
const personalEmail = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const windowsUserPath = /\b[A-Z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s]+/giu;
const posixUserPath = /(?:^|[\s"'(])\/(?:Users|home)\/[^/\s"'()]+/gmu;
const repositoryUrl = /https:\/\/github\.com\/([^/\s]+)\/resilireplay\b/giu;

function allowedEmail(value) {
  return (
    value.toLowerCase().endsWith("@users.noreply.github.com") ||
    /@example\.(?:com|net|org)$/iu.test(value)
  );
}

function inspectText(name, content) {
  for (const match of content.matchAll(personalEmail)) {
    if (!allowedEmail(match[0]) && name !== "pnpm-lock.yaml") {
      findings.push(`${name}: personal email address`);
    }
  }
  if (windowsUserPath.test(content)) findings.push(`${name}: absolute Windows user path`);
  windowsUserPath.lastIndex = 0;
  if (posixUserPath.test(content)) findings.push(`${name}: absolute POSIX user path`);
  posixUserPath.lastIndex = 0;
  for (const match of content.matchAll(repositoryUrl)) {
    if (match[1]?.toLowerCase() !== expectedOwner) {
      findings.push(`${name}: non-canonical ResiliReplay repository owner`);
    }
  }
}

async function inspectFile(path, name) {
  if (!textExtensions.has(extname(name).toLowerCase())) return;
  const info = await stat(path).catch(() => undefined);
  if (!info || info.size > 2_000_000) return;
  const content = await readFile(path, "utf8").catch(() => "");
  if (content.includes("\0")) return;
  inspectText(name.replaceAll("\\", "/"), content);
}

const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

for (const name of tracked) {
  const normalized = name.replaceAll("\\", "/");
  if (privateNames.test(normalized)) findings.push(`${normalized}: private-artifact filename`);
  await inspectFile(join(root, name), normalized);
}

async function inspectGenerated(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await inspectGenerated(path);
    else if (entry.isFile()) await inspectFile(path, relative(root, path));
  }
}

await inspectGenerated(join(root, "runs"));
await inspectGenerated(join(root, "docs", "assets"));

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    "Hygiene scan passed: tracked content and generated reports contain no personal emails, user paths, private artifacts, or stale repository-owner links.",
  );
}
