import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = join(root, ".artifacts", "mcp-res-v02", "source-drift.json");
const sources = [
  {
    id: "mcp-spec-latest-tag",
    url: "https://api.github.com/repos/modelcontextprotocol/modelcontextprotocol/tags?per_page=1",
    pinned: "2026-07-28",
    select: (value) => value[0]?.name,
  },
  {
    id: "mcp-spec-released",
    url: "https://api.github.com/repos/modelcontextprotocol/modelcontextprotocol/commits/5f5440bb26a62e2cf3440b92da5a667efa03b267",
    pinned: "5f5440bb26a62e2cf3440b92da5a667efa03b267",
    select: (value) => value.sha,
  },
  {
    id: "mcp-spec-main",
    url: "https://api.github.com/repos/modelcontextprotocol/modelcontextprotocol/commits/main",
    pinned: "d8fdc88fb970313247d8a180ac1ec3f6a10a8885",
    select: (value) => value.sha,
  },
  {
    id: "official-conformance-main",
    url: "https://api.github.com/repos/modelcontextprotocol/conformance/commits/main",
    pinned: "74edef34d674f563537be8c6587cebaa58e830ca",
    select: (value) => value.sha,
  },
  {
    id: "inspector-release",
    url: "https://api.github.com/repos/modelcontextprotocol/inspector/releases/latest",
    pinned: "2.4.0",
    select: (value) => String(value.tag_name).replace(/^v/u, ""),
  },
  {
    id: "tasks-extension",
    url: "https://api.github.com/repos/modelcontextprotocol/ext-tasks/commits/main",
    pinned: "0d0a6",
    select: (value) => value.sha,
  },
  {
    id: "apps-extension-release",
    url: "https://api.github.com/repos/modelcontextprotocol/ext-apps/releases/latest",
    pinned: "1.7.5",
    select: (value) => String(value.tag_name).replace(/^v/u, ""),
  },
  {
    id: "auth-extensions",
    url: "https://api.github.com/repos/modelcontextprotocol/ext-auth/commits/main",
    pinned: "fb374",
    select: (value) => value.sha,
  },
];
const results = [];
for (const source of sources) {
  const url = new URL(source.url);
  if (url.protocol !== "https:" || url.hostname !== "api.github.com")
    throw new Error("source allowlist violation");
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "resilireplay-mcp-res-source-drift",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 1_048_576) throw new Error("response byte limit exceeded");
    const observed = source.select(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    const matches =
      observed === source.pinned ||
      (source.pinned.length < 40 && observed.startsWith(source.pinned));
    results.push({
      id: source.id,
      url: source.url,
      pinned: source.pinned,
      observed,
      status: matches ? "UNCHANGED" : "DRIFT_REVIEW_REQUIRED",
    });
  } catch (error) {
    results.push({
      id: source.id,
      url: source.url,
      pinned: source.pinned,
      observed: null,
      status: "CHECK_INCOMPLETE",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
const report = {
  schemaVersion: "mcp-res.source-drift-report/0.2.0",
  generatedAt: new Date().toISOString(),
  networkPolicy: {
    hosts: ["api.github.com"],
    maxSources: 8,
    timeoutMsPerSource: 10_000,
    maxBytesPerSource: 1_048_576,
  },
  normativeFilesChanged: 0,
  profilesPromoted: 0,
  externalCommentsCreated: 0,
  results,
  reviewRequired: results.some((item) => item.status !== "UNCHANGED"),
};
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify({
    reviewRequired: report.reviewRequired,
    drift: results.filter((item) => item.status === "DRIFT_REVIEW_REQUIRED").length,
    incomplete: results.filter((item) => item.status === "CHECK_INCOMPLETE").length,
  }),
);
