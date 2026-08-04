import { access, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const docs = join(root, "docs");
const htmlPath = join(docs, "index.html");
const html = await readFile(htmlPath, "utf8");

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
  invariant((await stat(target)).size > 0, `Local reference is empty: ${reference}`);
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

console.log(`Landing page verified: ${references.length} references, ${ids.size} section targets`);
