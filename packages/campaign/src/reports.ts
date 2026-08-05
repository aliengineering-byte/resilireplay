import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { safeOutputPath, stableStringify } from "@resilireplay/core";
import type { CampaignComparison, CampaignRun } from "./schemas.js";
import { verifyCampaignComparison } from "./baseline.js";
import { verifyCampaignRun } from "./runner.js";

function escapeXml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function campaignTerminalReport(runInput: CampaignRun, color = true): string {
  const run = verifyCampaignRun(runInput);
  const passing = run.status === "complete" && run.summary.passed;
  const green = color ? "\u001b[32m" : "";
  const red = color ? "\u001b[31m" : "";
  const cyan = color ? "\u001b[36m" : "";
  const reset = color ? "\u001b[0m" : "";
  const lines = [
    `${cyan}ResiliReplay Campaign v0.3.1${reset}  ${passing ? `${green}PASS${reset}` : `${red}FAIL${reset}`}`,
    `Campaign        ${run.campaignId}`,
    `Run status      ${run.status}`,
    `Scenarios       ${run.summary.passedCount}/${run.summary.total} matched expectations`,
    `Fault coverage  ${run.summary.faultCoverage === null ? "n/a" : `${Math.round(run.summary.faultCoverage * 100)}%`}`,
    `Evidence hash   ${run.runHash}`,
    "",
    ...run.results.map(
      (result) =>
        `${result.status.toUpperCase().padEnd(9)} ${result.id} (${result.target}; ${result.fault})${result.error ? ` - ${result.error}` : ""}`,
    ),
  ];
  return lines.join("\n");
}

export function comparisonTerminalReport(
  comparisonInput: CampaignComparison,
  color = true,
): string {
  const comparison = verifyCampaignComparison(comparisonInput);
  const passing = comparison.status === "pass";
  const green = color ? "\u001b[32m" : "";
  const red = color ? "\u001b[31m" : "";
  const cyan = color ? "\u001b[36m" : "";
  const reset = color ? "\u001b[0m" : "";
  return [
    `${cyan}ResiliReplay Baseline v0.3.1${reset}  ${passing ? `${green}PASS${reset}` : `${red}${comparison.status.toUpperCase()}${reset}`}`,
    `Campaign        ${comparison.campaignId}`,
    `Differences     ${comparison.differences.length}`,
    `Baseline hash   ${comparison.baselineHash}`,
    `Run hash        ${comparison.runHash}`,
    "",
    ...(comparison.differences.length === 0
      ? ["No reliability regressions detected."]
      : comparison.differences.map(
          (difference) =>
            `${difference.severity.toUpperCase()} ${difference.scenarioId ?? "campaign"} ${difference.metric}: ${difference.message}`,
        )),
  ].join("\n");
}

function runHtml(run: CampaignRun): string {
  const rows = run.results
    .map(
      (result) =>
        `<tr><td>${escapeXml(result.id)}</td><td>${escapeXml(result.target)}</td><td>${escapeXml(result.fault)}</td><td>${escapeXml(result.status)}</td><td>${result.metrics?.deterministicScore ?? "n/a"}</td><td>${escapeXml(result.firstCriticalStep ?? "none")}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ResiliReplay campaign</title><style>body{font:16px system-ui;max-width:1100px;margin:32px auto;padding:0 20px;color:#18212f}header,section{border:1px solid #d8dee4;border-radius:12px;padding:20px;margin:16px 0}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #d8dee4;padding:8px}.pass{color:#067647}.fail{color:#b42318}</style></head><body><header><h1>Campaign ${escapeXml(run.campaignId)}</h1><p class="${run.summary.passed ? "pass" : "fail"}">${run.summary.passed ? "PASS" : "FAIL"} · ${escapeXml(run.status)} · evidence ${escapeXml(run.runHash)}</p></header><section><h2>Scenarios</h2><table><thead><tr><th>Scenario</th><th>Target</th><th>Fault</th><th>Status</th><th>Score</th><th>Cause</th></tr></thead><tbody>${rows}</tbody></table></section><footer>Generated locally by ResiliReplay v0.3.1. No telemetry was sent.</footer></body></html>\n`;
}

function runJunit(run: CampaignRun): string {
  const failures = run.results.filter((result) => result.status === "failed").length;
  const errors = run.results.filter(
    (result) => result.status === "invalid" || result.status === "cancelled",
  ).length;
  const cases = run.results
    .map((result) => {
      const body =
        result.status === "failed"
          ? `<failure message="${escapeXml(result.assertionFailures.join(" "))}"/>`
          : result.status === "invalid" || result.status === "cancelled"
            ? `<error message="${escapeXml(result.error ?? result.status)}"/>`
            : "";
      return `<testcase classname="resilireplay.campaign" name="${escapeXml(result.id)}">${body}</testcase>`;
    })
    .join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="ResiliReplay Campaign" tests="${run.results.length}" failures="${failures}" errors="${errors}" skipped="0">\n  ${cases}\n</testsuite>\n`;
}

function runSarif(run: CampaignRun): string {
  const results = run.results.flatMap((result) =>
    result.status === "passed"
      ? []
      : [
          {
            ruleId: `RESILIREPLAY-CAMPAIGN-${result.status.toUpperCase()}`,
            level: result.status === "failed" ? "warning" : "error",
            message: {
              text:
                result.error ??
                result.assertionFailures.join(" ") ??
                `Scenario ${result.id} did not pass`,
            },
            properties: { scenario: result.id, target: result.target, fault: result.fault },
          },
        ],
  );
  return `${stableStringify({
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "ResiliReplay",
            version: "0.3.1",
            informationUri: "https://github.com/aliengineering-byte/resilireplay",
            rules: [...new Set(results.map((result) => result.ruleId))].map((id) => ({
              id,
              shortDescription: { text: id },
            })),
          },
        },
        results,
      },
    ],
  })}\n`;
}

function comparisonHtml(comparison: CampaignComparison): string {
  const rows = comparison.differences
    .map(
      (difference) =>
        `<tr><td>${escapeXml(difference.severity)}</td><td>${escapeXml(difference.scenarioId ?? "campaign")}</td><td>${escapeXml(difference.metric)}</td><td>${escapeXml(difference.baseline)}</td><td>${escapeXml(difference.current)}</td><td>${escapeXml(difference.message)}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ResiliReplay baseline comparison</title><style>body{font:16px system-ui;max-width:1100px;margin:32px auto;padding:0 20px}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #d8dee4;padding:8px}.pass{color:#067647}.fail{color:#b42318}</style></head><body><h1>Baseline comparison: <span class="${comparison.status === "pass" ? "pass" : "fail"}">${escapeXml(comparison.status.toUpperCase())}</span></h1><p>Campaign ${escapeXml(comparison.campaignId)} · comparison ${escapeXml(comparison.comparisonHash)}</p><table><thead><tr><th>Severity</th><th>Scenario</th><th>Metric</th><th>Baseline</th><th>Current</th><th>Reason</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No reliability regressions.</td></tr>'}</tbody></table></body></html>\n`;
}

function comparisonJunit(comparison: CampaignComparison): string {
  const failure =
    comparison.status === "pass"
      ? ""
      : comparison.status === "regression"
        ? `<failure message="${escapeXml(comparison.differences.map((item) => item.message).join(" "))}"/>`
        : `<error message="${escapeXml(comparison.differences.map((item) => item.message).join(" "))}"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="ResiliReplay Baseline" tests="1" failures="${comparison.status === "regression" ? 1 : 0}" errors="${comparison.status === "invalid" || comparison.status === "incomplete" ? 1 : 0}" skipped="0"><testcase classname="resilireplay.baseline" name="${escapeXml(comparison.campaignId)}">${failure}</testcase></testsuite>\n`;
}

function comparisonSarif(comparison: CampaignComparison): string {
  const results = comparison.differences.map((difference) => ({
    ruleId: `RESILIREPLAY-BASELINE-${difference.severity.toUpperCase()}`,
    level: difference.severity === "invalid" ? "error" : "warning",
    message: { text: difference.message },
    properties: {
      scenario: difference.scenarioId ?? null,
      metric: difference.metric,
      baseline: difference.baseline,
      current: difference.current,
    },
  }));
  return `${stableStringify({
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "ResiliReplay",
            version: "0.3.1",
            informationUri: "https://github.com/aliengineering-byte/resilireplay",
            rules: [
              {
                id: "RESILIREPLAY-BASELINE-REGRESSION",
                shortDescription: { text: "Reliability regression" },
              },
              {
                id: "RESILIREPLAY-BASELINE-INVALID",
                shortDescription: { text: "Invalid comparison evidence" },
              },
            ],
          },
        },
        results,
      },
    ],
  })}\n`;
}

export interface CampaignReportBundle {
  directory: string;
  jsonPath: string;
  htmlPath: string;
  junitPath: string;
  sarifPath: string;
  summaryPath: string;
  terminal: string;
}

async function writeFiles(
  directoryInput: string,
  prefix: string,
  values: Record<string, string>,
): Promise<Record<string, string>> {
  const directory = resolve(directoryInput);
  await mkdir(directory, { recursive: true });
  const paths = Object.fromEntries(
    Object.keys(values).map((suffix) => [suffix, safeOutputPath(directory, `${prefix}.${suffix}`)]),
  );
  await Promise.all(
    Object.entries(values).map(([suffix, content]) => writeFile(paths[suffix]!, content, "utf8")),
  );
  return paths;
}

export async function writeCampaignRunReports(
  runInput: CampaignRun,
  directoryInput: string,
): Promise<CampaignReportBundle> {
  const run = verifyCampaignRun(runInput);
  const terminal = campaignTerminalReport(run, false);
  const summary = `## ResiliReplay campaign: ${run.summary.passed ? "PASS" : "FAIL"}\n\n- Campaign: \`${run.campaignId}\`\n- Status: \`${run.status}\`\n- Scenarios: ${run.summary.passedCount}/${run.summary.total}\n- Evidence: \`${run.runHash}\`\n`;
  const paths = await writeFiles(directoryInput, "campaign-report", {
    json: `${stableStringify(run)}\n`,
    html: runHtml(run),
    xml: runJunit(run),
    sarif: runSarif(run),
    md: summary,
    txt: `${terminal}\n`,
  });
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n${summary}\n`, "utf8");
  }
  return {
    directory: resolve(directoryInput),
    jsonPath: paths.json!,
    htmlPath: paths.html!,
    junitPath: paths.xml!,
    sarifPath: paths.sarif!,
    summaryPath: paths.md!,
    terminal,
  };
}

export async function writeCampaignComparisonReports(
  comparisonInput: CampaignComparison,
  directoryInput: string,
): Promise<CampaignReportBundle> {
  const comparison = verifyCampaignComparison(comparisonInput);
  const terminal = comparisonTerminalReport(comparison, false);
  const summary = `## ResiliReplay baseline: ${comparison.status.toUpperCase()}\n\n- Campaign: \`${comparison.campaignId}\`\n- Differences: ${comparison.differences.length}\n- Baseline: \`${comparison.baselineHash}\`\n- Run: \`${comparison.runHash}\`\n`;
  const paths = await writeFiles(directoryInput, "comparison-report", {
    json: `${stableStringify(comparison)}\n`,
    html: comparisonHtml(comparison),
    xml: comparisonJunit(comparison),
    sarif: comparisonSarif(comparison),
    md: summary,
    txt: `${terminal}\n`,
  });
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n${summary}\n`, "utf8");
  }
  return {
    directory: resolve(directoryInput),
    jsonPath: paths.json!,
    htmlPath: paths.html!,
    junitPath: paths.xml!,
    sarifPath: paths.sarif!,
    summaryPath: paths.md!,
    terminal,
  };
}

export function artifactFileName(path: string): string {
  return basename(path);
}
