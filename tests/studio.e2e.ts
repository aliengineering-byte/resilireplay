import { createRequire } from "node:module";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const require = createRequire(import.meta.url);

test("complete Studio campaign flow is keyboard-accessible and has no serious axe violations", async ({
  page,
}) => {
  const baselinePath = `.artifacts/studio-e2e-baseline-${process.pid}.json`;
  await rm(resolve(baselinePath), { force: true });
  await page.addInitScript({ path: require.resolve("axe-core/axe.min.js") });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Prove the recovery/i })).toBeVisible();
  await expect(page.getByText("127.0.0.1 · no telemetry")).toBeVisible();

  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
    return result.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    );
  });
  expect(violations).toEqual([]);

  const quickStart = page.getByRole("button", { name: /Start the five-minute workflow/i });
  await quickStart.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Review the exact target" })).toBeVisible();
  await page.getByRole("button", { name: "Review target" }).click();
  await expect(page.getByText(/Reviewed campaign · studio-quick-start/)).toBeVisible();
  await expect(page.locator("#review-result")).toContainText("[REDACTED]");

  await page.getByRole("button", { name: /04\s*Live run/ }).click();
  await page.getByLabel(/I reviewed the target/).check();
  await page.getByRole("button", { name: "Run reviewed campaign" }).click();
  await expect(page.locator("#run-state")).toHaveText("PASS", { timeout: 30_000 });
  await expect(page.locator("#result-summary")).toContainText("4/4");

  await page.getByRole("button", { name: /05\s*Timeline/ }).click();
  await expect(page.locator("#timeline-list .event").first()).toBeVisible();
  await expect(page.locator("#timeline-list")).toContainText("mcp-tool-error");

  await page.getByRole("button", { name: /06\s*Findings/ }).click();
  await expect(page.locator("#findings-list")).toContainText("unsafe-content-regression");

  await page.getByRole("button", { name: /07\s*Baseline/ }).click();
  await page.locator("#baseline-path").fill(baselinePath);
  await page.getByRole("button", { name: "Approve current run" }).click();
  await expect(page.locator("#toast")).toContainText("Baseline approved");
  await page.getByRole("button", { name: "Approve current run" }).click();
  await expect(page.locator("#toast")).toContainText("Baseline file already exists");
  await page.getByRole("button", { name: "Compare with baseline" }).click();
  await expect(page.locator("#comparison-result")).toContainText("PASS");

  await page.getByRole("button", { name: /08\s*Regression/ }).click();
  await expect(page.locator("#regression-list a").first()).toBeVisible();

  await page.getByRole("button", { name: /09\s*Evidence/ }).click();
  await expect(page.locator("#evidence-list a").first()).toBeVisible();
  await rm(resolve(baselinePath), { force: true });
});

declare global {
  interface Window {
    axe: {
      run: (
        context: Document,
        options: Record<string, unknown>,
      ) => Promise<{
        violations: Array<{ impact: string | null; id: string; nodes: unknown[] }>;
      }>;
    };
  }
}
