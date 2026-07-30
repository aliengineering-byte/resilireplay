import { spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(".");
const excluded = new Set([".git", "node_modules", "dist", "coverage", "runs", ".artifacts"]);
const findings = [];
const patterns = [
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g],
  ["OpenAI-style key", /\bsk-[A-Za-z0-9_-]{32,}\b/g],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["Bearer credential", /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}\b/g],
];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile() && (await stat(path)).size <= 2_000_000) files.push(path);
  }
  return files;
}

for (const file of await walk(root)) {
  const content = await readFile(file, "utf8").catch(() => "");
  for (const [name, pattern] of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) findings.push(`${relative(root, file)}: ${name}`);
  }
}

const history = spawnSync("git", ["rev-list", "--objects", "--all"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});
if (history.status === 0 && /(?:\.env$|id_rsa$|credentials?\.json$)/im.test(history.stdout)) {
  findings.push("Git history contains a credential-like filename");
}

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    "Secret scan passed: working tree and reachable history contain no recognized credentials.",
  );
}
