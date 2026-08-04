import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { startStudio } from "../packages/studio/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const output = join(root, ".artifacts", "studio-capture");
const frames = join(output, "frames");
const finalPng = join(root, "docs", "assets", "studio-campaign.png");
await rm(output, { recursive: true, force: true });
await mkdir(frames, { recursive: true });

const studio = await startStudio({ rootDirectory: root, port: 0 });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const shot = async (name, path = join(frames, name)) => {
  await page.screenshot({ path });
};

try {
  await page.goto(studio.url);
  await page.getByRole("heading", { name: /Prove the recovery/i }).waitFor();
  await shot("01-welcome.png");

  await page.getByRole("button", { name: /Start the five-minute workflow/i }).click();
  await page.getByRole("button", { name: "Review target" }).click();
  await page.getByText(/Reviewed campaign/).waitFor();
  await shot("02-reviewed-target.png");

  await page.getByRole("button", { name: /04\s*Live run/ }).click();
  await page.getByLabel(/I reviewed the target/).check();
  await page.getByRole("button", { name: "Run reviewed campaign" }).click();
  await page.locator("#run-state").filter({ hasText: "PASS" }).waitFor({ timeout: 30_000 });
  await shot("03-recovery-pass.png", finalPng);
  await shot("03-recovery-pass-frame.png");

  await page.getByRole("button", { name: /05\s*Timeline/ }).click();
  await page.locator("#timeline-list .event").first().waitFor();
  await shot("04-causal-timeline.png");

  await page.getByRole("button", { name: /07\s*Baseline/ }).click();
  await page.locator("#baseline-path").fill(".artifacts/studio-capture/baseline.json");
  await page.getByRole("button", { name: "Approve current run" }).click();
  await page.locator("#toast").filter({ hasText: "Baseline approved" }).waitFor();
  await page.getByRole("button", { name: "Compare with baseline" }).click();
  await page.locator("#comparison-result").filter({ hasText: "PASS" }).waitFor();
  await shot("05-baseline-pass.png");

  await page.getByRole("button", { name: /09\s*Evidence/ }).click();
  await page.locator("#evidence-list a").first().waitFor();
  await shot("06-evidence-downloads.png");
} finally {
  await browser.close();
  await studio.close();
}

console.log(`Captured verified Studio frames in ${frames}`);
console.log(`Static Studio screenshot ${finalPng}`);
