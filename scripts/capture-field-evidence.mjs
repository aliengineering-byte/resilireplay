import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const cases = ["mcp-everything", "playwright-mcp", "ui5-mcp"];
const browser = await chromium.launch({ headless: true });

try {
  for (const slug of cases) {
    const source = join(
      root,
      ".artifacts",
      "field-validation",
      "public-cases",
      slug,
      "run",
      "reports",
      "campaign-report.html",
    );
    const destination = join(root, "docs", "case-studies", slug, "evidence.png");
    await mkdir(resolve(destination, ".."), { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1180, height: 720 } });
    await page.goto(pathToFileURL(source).href);
    await page.getByRole("heading", { name: /Campaign/u }).waitFor();
    await page.screenshot({ path: destination, fullPage: true });
    await page.close();
    console.log(`Captured real campaign report for ${slug}`);
  }
} finally {
  await browser.close();
}
