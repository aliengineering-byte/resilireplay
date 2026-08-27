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
  join(docs, "assets", "everywhere-demo-transcript.txt"),
  "utf8",
);
const mcpStandardTranscript = await readFile(
  join(docs, "assets", "mcp-reliability-standard-demo-transcript.txt"),
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
for (const [name, content] of [
  ["README", readme],
  ["npm README", packageReadme],
  ["landing page", html],
]) {
  invariant(
    content.includes("resilireplay@0.6.0 demo"),
    `${name} must include the shipped v0.6.0 demo command`,
  );
  invariant(
    content.includes("resilireplay@0.6.0 connect"),
    `${name} must include the shipped v0.6.0 connect command`,
  );
  invariant(
    content.includes("resilireplay@0.6.0 mcp serve"),
    `${name} must include the shipped v0.6.0 MCP server command`,
  );
}
invariant(
  adoptGuide.includes("resilireplay@0.4.0 adopt"),
  "Historical v0.4 adoption guide lost its pinned command",
);
invariant(
  html.includes("assets/everywhere-demo.gif"),
  "Landing page must use the genuine demo GIF",
);
invariant(
  html.includes("assets/everywhere-demo.png"),
  "Landing page must link the static demo fallback",
);
invariant(
  html.includes("mcp-reliability/MCP_RELIABILITY_STANDARD.md") &&
    html.includes("assets/mcp-reliability-standard-demo.gif") &&
    html.includes("assets/mcp-reliability-standard-demo.png"),
  "Landing page must publish the MCP standard and verified demo assets",
);
invariant(
  readme.includes("docs/mcp-reliability/MCP_RELIABILITY_STANDARD.md") &&
    readme.includes("docs/assets/mcp-reliability-standard-demo.gif"),
  "README must make the MCP standard and verified demo prominent",
);
invariant(
  html.includes('href="standards/mcp-res/"') &&
    readme.includes("docs/standards/mcp-res/README.md") &&
    readme.includes("MCP-RES is independent of the official MCP specification") &&
    html.includes("does not imply MCP endorsement or security certification"),
  "MCP-RES draft or required disclaimer is not prominent",
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
  demoTranscript.includes("PASS 1 executable regression") &&
    demoTranscript.includes("original command was not retried") &&
    demoTranscript.includes("under-60s=true"),
  "Genuine agent demo transcript is incomplete",
);
invariant(
  mcpStandardTranscript.includes("Scenarios       3/3 matched expectations") &&
    mcpStandardTranscript.includes("PASSED    canary-expected-failure") &&
    mcpStandardTranscript.includes("INFO pass 1") &&
    mcpStandardTranscript.includes("INFO fail 0") &&
    !/[A-Z]:\\Users\\/u.test(mcpStandardTranscript),
  "Verified MCP standard demo transcript is incomplete or unsanitized",
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
