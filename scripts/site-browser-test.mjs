import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, resolve, sep } from "node:path";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const docs = join(root, "docs");
const output = join(root, ".artifacts", "site");
const mime = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
]);

const server = createServer(async (request, response) => {
  try {
    const requestPath = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const relativePath =
      requestPath === "/" ? "index.html" : decodeURIComponent(requestPath.slice(1));
    const path = resolve(docs, relativePath);
    if (!path.startsWith(`${docs}${sep}`)) throw new Error("path escape");
    const body = await readFile(path);
    response.writeHead(200, {
      "content-type": mime.get(extname(path)) ?? "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

await new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveListen);
});

let browser;
try {
  await mkdir(output, { recursive: true });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Site server did not bind a port");
  browser = await chromium.launch({ headless: true });
  for (const profile of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({
      viewport: { width: profile.width, height: profile.height },
    });
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript({ path: require.resolve("axe-core/axe.min.js") });
    const response = await page.goto(`http://127.0.0.1:${address.port}/`, {
      waitUntil: "networkidle",
    });
    if (!response?.ok())
      throw new Error(`${profile.name}: landing page returned ${response?.status()}`);
    const violations = await page.evaluate(async () => {
      const result = await window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      });
      return result.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact),
      );
    });
    if (violations.length > 0) {
      throw new Error(
        `${profile.name}: serious accessibility violations: ${JSON.stringify(violations)}`,
      );
    }
    const overflow = await page.evaluate(() => {
      window.scrollTo({ left: document.documentElement.scrollWidth, top: 0 });
      const actual = window.scrollX;
      window.scrollTo({ left: 0, top: 0 });
      return actual;
    });
    if (overflow > 1) {
      const offenders = await page.evaluate(() =>
        [...document.querySelectorAll("*")]
          .map((element) => ({
            element: element.tagName.toLowerCase(),
            className: typeof element.className === "string" ? element.className : "",
            parentClass:
              typeof element.parentElement?.className === "string"
                ? element.parentElement.className
                : "",
            text: element.textContent?.slice(0, 80) ?? "",
            right: Math.round(element.getBoundingClientRect().right),
            scrollWidth: element.scrollWidth,
          }))
          .filter((item) => item.right > document.documentElement.clientWidth + 1)
          .sort((left, right) => right.right - left.right)
          .slice(0, 5),
      );
      throw new Error(
        `${profile.name}: horizontal overflow of ${overflow}px: ${JSON.stringify(offenders)}`,
      );
    }
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    if (focused !== "A") throw new Error(`${profile.name}: first keyboard focus is not a link`);
    if (errors.length > 0)
      throw new Error(`${profile.name}: console errors: ${errors.join(" | ")}`);
    await page.screenshot({ path: join(output, `${profile.name}.png`), fullPage: true });
    await page.close();
    console.log(`${profile.name}: responsive layout and WCAG A/AA checks passed`);
  }
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
