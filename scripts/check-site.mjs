import { access, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const docs = join(root, "docs");
const htmlPath = join(docs, "index.html");
const html = await readFile(htmlPath, "utf8");
const readme = await readFile(join(root, "README.md"), "utf8");
const packageReadme = await readFile(join(root, "packages", "cli", "README.md"), "utf8");
const adoptGuide = await readFile(join(docs, "ADOPT.md"), "utf8");
const demoTranscript = await readFile(
  join(docs, "assets", "mcp-demo-v0.7.0-transcript.txt"),
  "utf8",
);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

invariant(html.includes('<html lang="en">'), "Landing page must declare its language");
invariant(html.includes('rel="canonical"'), "Landing page needs a canonical URL");
invariant(html.includes('property="og:image"'), "Landing page needs a social preview");
invariant(html.includes('http-equiv="Content-Security-Policy"'), "Landing page needs a CSP");
invariant(!/<script(?![^>]*\bsrc=)[^>]*>/iu.test(html), "Inline scripts are not allowed");
invariant(!/<style(?:\s|>)/iu.test(html), "Inline styles are not allowed");
invariant(
  !/(google-analytics|googletagmanager|segment\.com|posthog|mixpanel)/iu.test(html),
  "Analytics are not allowed",
);
for (const [name, content, demoCommand] of [
  ["README", readme, "resilireplay@0.7.0 mcp demo"],
  ["npm README", packageReadme, "resilireplay@latest mcp demo"],
  ["landing page", html, "resilireplay@latest mcp demo"],
]) {
  invariant(
    content.includes(demoCommand),
    `${name} must include the MCP-first public demo command`,
  );
  invariant(
    content.includes("resilireplay@latest mcp test"),
    `${name} must include the reviewed real-server command`,
  );
  invariant(
    content.indexOf(demoCommand) < content.indexOf("resilireplay@latest mcp test"),
    `${name} must present mcp demo before other public commands`,
  );
}
invariant(
  readme.includes("quickstart pins the released `0.7.0` artifact") &&
    readme.includes("Later `@latest` examples are"),
  "README must distinguish the reproducible release pin from @latest convenience commands",
);
invariant(
  adoptGuide.includes("resilireplay@0.4.0 adopt"),
  "Historical v0.4 adoption guide lost its pinned command",
);
invariant(
  html.includes("assets/mcp-demo-v0.7.0.gif"),
  "Landing page must use the packed-package MCP demo GIF",
);
invariant(
  html.includes("assets/mcp-demo-v0.7.0.png"),
  "Landing page must link the packed-package static fallback",
);
invariant(
  readme.includes("examples/mcp-reliability-ci/README.md") &&
    readme.includes("@modelcontextprotocol/server-everything@2026.8.18"),
  "README must link the pinned real MCP example",
);
invariant(
  html.includes('href="standards/mcp-res/"') &&
    readme.includes("docs/standards/mcp-res/README.md") &&
    readme.includes("MCP-RES is independent of the official MCP specification") &&
    html.includes("independent of the official MCP specification"),
  "MCP-RES v0.2 or its required disclaimer is missing",
);
const mcpResPagePath = join(docs, "standards", "mcp-res", "index.html");
const mcpResPage = await readFile(mcpResPagePath, "utf8");
invariant(mcpResPage.includes('<html lang="en">'), "MCP-RES page must declare its language");
invariant(mcpResPage.includes('rel="canonical"'), "MCP-RES page needs a canonical URL");
invariant(mcpResPage.includes('http-equiv="Content-Security-Policy"'), "MCP-RES page needs a CSP");
invariant(!/<script\b/iu.test(mcpResPage), "MCP-RES page must not execute scripts");
invariant(
  !/(google-analytics|googletagmanager|segment\.com|posthog|mixpanel)/iu.test(mcpResPage),
  "MCP-RES page must not use analytics",
);
for (const phrase of [
  "Problem and boundary",
  "Who can implement",
  "Initial profiles",
  "Validate safe bundled evidence",
  "Independent implementation",
  "Reference, not dependency",
  "Change control and 1.0",
]) {
  invariant(mcpResPage.includes(phrase), `MCP-RES page is missing: ${phrase}`);
}
invariant(
  demoTranscript.includes("npx --yes resilireplay@latest mcp demo") &&
    demoTranscript.includes("Duplicate effects observed: 0") &&
    demoTranscript.includes("Regression executed") &&
    !/[A-Z]:\\Users\\/u.test(demoTranscript),
  "Packed-package MCP demo transcript is incomplete or unsanitized",
);

const readmeLines = readme.split(/\r?\n/u);
invariant(readmeLines.length >= 200 && readmeLines.length <= 300, "README must be 200–300 lines");
invariant(
  !/(?:^|\n)(?:#+\s+Architecture|.*framework matrix|git clone|pnpm install)/iu.test(
    readmeLines.slice(0, 120).join("\n"),
  ),
  "README first 120 lines contain secondary architecture or maintainer onboarding",
);

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/gu)].map((match) => match[1]));
invariant(ids.size > 0, "Landing page has no linkable sections");

const references = [...html.matchAll(/\b(?:href|src)="([^"]+)"/gu)].map((match) => match[1]);
for (const reference of references) {
  if (reference.startsWith("#")) {
    invariant(ids.has(reference.slice(1)), `Missing same-page target ${reference}`);
    continue;
  }
  if (/^https?:\/\//u.test(reference)) {
    invariant(reference.startsWith("https://"), `External URL must use HTTPS: ${reference}`);
    continue;
  }
  invariant(!reference.startsWith("//"), `Protocol-relative URL is not allowed: ${reference}`);
  const clean = decodeURIComponent(reference.split(/[?#]/u)[0]);
  const target = resolve(dirname(htmlPath), clean);
  invariant(target.startsWith(`${docs}${sep}`), `Local reference escapes docs: ${reference}`);
  await access(target);
  const targetStat = await stat(target);
  invariant(
    targetStat.isDirectory() || targetStat.size > 0,
    `Local reference is empty: ${reference}`,
  );
}

const images = [...html.matchAll(/<img\b[^>]*>/giu)];
for (const [tag] of images) {
  invariant(/\balt="[^"]+"/u.test(tag), `Image needs non-empty alt text: ${tag}`);
}

const robots = await readFile(join(docs, "robots.txt"), "utf8");
const sitemap = await readFile(join(docs, "sitemap.xml"), "utf8");
invariant(
  robots.includes("https://aliengineering-byte.github.io/resilireplay/sitemap.xml"),
  "robots.txt sitemap URL is wrong",
);
invariant(
  sitemap.includes("https://aliengineering-byte.github.io/resilireplay/"),
  "sitemap canonical URL is wrong",
);
invariant(
  sitemap.includes("https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/"),
  "sitemap is missing the MCP-RES landing page",
);

console.log(`Landing page verified: ${references.length} references, ${ids.size} section targets`);
