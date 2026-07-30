import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  calculateMetrics,
  safeOutputPath,
  sha256,
  stableStringify,
  type RecoveryMetrics,
  type TraceEvent,
} from "@resilireplay/core";

export interface ReportBundle {
  directory: string;
  metrics: RecoveryMetrics;
  jsonPath: string;
  htmlPath: string;
  junitPath: string;
  sarifPath: string;
  manifestPath: string;
  badgePath: string;
  terminal: string;
}

function xml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function html(value: unknown): string {
  return xml(value);
}

export function terminalReport(metrics: RecoveryMetrics, color = true): string {
  const green = color ? "\u001b[32m" : "";
  const red = color ? "\u001b[31m" : "";
  const cyan = color ? "\u001b[36m" : "";
  const reset = color ? "\u001b[0m" : "";
  const mark = metrics.passed ? `${green}PASS${reset}` : `${red}FAIL${reset}`;
  const lines = [
    `${cyan}ResiliReplay v0.1.0${reset}  ${mark}`,
    `Recovery score  ${metrics.deterministicScore}/100`,
    `Completion      ${metrics.taskCompletion ? "yes" : "no"}`,
    `Recovery        ${metrics.recoverySuccess ? "safe" : "unrecovered"}`,
    `Retries         ${metrics.retryCount}/${metrics.retryBudget}`,
    `First critical  ${metrics.firstCriticalStep ?? "none"}`,
    `Safety          ${metrics.safetyPolicyCompliance ? "compliant" : "violation"}`,
    "",
    ...metrics.reasons.map((reason) => `• ${reason}`),
  ];
  return lines.join("\n");
}

function reportJson(events: readonly TraceEvent[], metrics: RecoveryMetrics): string {
  return `${stableStringify({
    schemaVersion: "1.0",
    product: { name: "ResiliReplay", version: "0.1.0" },
    runId: events[0]?.runId ?? "unknown",
    metrics,
    eventCount: events.length,
    faults: events
      .filter((event) => event.fault)
      .map((event) => ({
        stepId: event.stepId,
        sequence: event.sequence,
        type: event.fault?.faultType,
        scenarioId: event.fault?.scenarioId,
        recovered: events.some(
          (candidate) =>
            candidate.sequence > event.sequence &&
            (candidate.type === "retry" || candidate.type === "recovery_action"),
        ),
      })),
  })}\n`;
}

function htmlReport(events: readonly TraceEvent[], metrics: RecoveryMetrics): string {
  const outcome = metrics.passed ? "PASS" : "FAIL";
  const tone = metrics.passed ? "#159957" : "#c0392b";
  const rows = events
    .map(
      (event) =>
        `<tr><td>${event.sequence}</td><td>${html(event.type)}</td><td>${html(event.actor)}</td><td>${html(event.tool ?? event.model ?? "—")}</td><td>${event.fault ? html(event.fault.faultType) : "—"}</td><td><code>${html(event.stepId)}</code></td></tr>`,
    )
    .join("");
  const reasons = metrics.reasons.map((reason) => `<li>${html(reason)}</li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ResiliReplay report</title><style>
:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}body{max-width:1100px;margin:0 auto;padding:32px;background:#f6f8fa;color:#18212f}
header,.card{background:white;border:1px solid #d8dee4;border-radius:12px;padding:24px;margin-bottom:20px;box-shadow:0 3px 12px #1f23281a}
h1{margin:0 0 8px}.outcome{color:${tone};font-weight:800}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}.metric{background:#f3f5f7;border-radius:8px;padding:14px}.metric strong{display:block;font-size:1.5rem}
table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{text-align:left;border-bottom:1px solid #d8dee4;padding:9px;vertical-align:top}code{font-size:.78rem;word-break:break-all}
@media(prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}header,.card{background:#161b22;border-color:#30363d}.metric{background:#21262d}th,td{border-color:#30363d}}
</style></head><body>
<header><h1>ResiliReplay <span class="outcome">${outcome}</span></h1><p>Run ${html(events[0]?.runId ?? "unknown")} · deterministic report schema 1.0</p></header>
<section class="card grid">
<div class="metric"><span>Recovery score</span><strong>${metrics.deterministicScore}/100</strong></div>
<div class="metric"><span>Recovery</span><strong>${metrics.recoverySuccess ? "safe" : "failed"}</strong></div>
<div class="metric"><span>Retries</span><strong>${metrics.retryCount}/${metrics.retryBudget}</strong></div>
<div class="metric"><span>First critical</span><strong>${html(metrics.firstCriticalStep ?? "none")}</strong></div>
</section>
<section class="card"><h2>Why</h2><ul>${reasons}</ul></section>
<section class="card"><h2>Trace</h2><table><thead><tr><th>#</th><th>Event</th><th>Actor</th><th>Target</th><th>Fault</th><th>Step</th></tr></thead><tbody>${rows}</tbody></table></section>
<footer>Generated locally by ResiliReplay v0.1.0. No telemetry was sent.</footer>
</body></html>
`;
}

function junit(metrics: RecoveryMetrics, runId: string): string {
  const failures = metrics.passed ? 0 : 1;
  const failure = metrics.passed
    ? ""
    : `<failure message="${xml(metrics.reasons.join(" "))}">${xml(
        JSON.stringify(metrics, null, 2),
      )}</failure>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="ResiliReplay" tests="1" failures="${failures}" errors="0" skipped="0">
  <testcase classname="reliability" name="${xml(runId)}">${failure}</testcase>
</testsuite>
`;
}

function sarif(metrics: RecoveryMetrics, events: readonly TraceEvent[]): string {
  const results = metrics.passed
    ? []
    : metrics.reasons.map((reason, index) => ({
        ruleId: `RESILIREPLAY${String(index + 1).padStart(3, "0")}`,
        level: metrics.safetyPolicyCompliance ? "warning" : "error",
        message: { text: reason },
        locations: metrics.firstCriticalStep
          ? [
              {
                physicalLocation: {
                  artifactLocation: { uri: "trace.jsonl" },
                  region: {
                    startLine:
                      (events.findIndex((event) => event.stepId === metrics.firstCriticalStep) ||
                        0) + 1,
                  },
                },
              },
            ]
          : [],
      }));
  return `${stableStringify({
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "ResiliReplay",
            version: "0.1.0",
            informationUri: "https://github.com",
            rules: results.map((result) => ({
              id: result.ruleId,
              shortDescription: { text: result.message.text },
            })),
          },
        },
        results,
      },
    ],
  })}\n`;
}

function badge(metrics: RecoveryMetrics): string {
  const label = "Agent Reliability Tested";
  const value = metrics.passed ? "passing v0.1.0" : "failing v0.1.0";
  const color = metrics.passed ? "#159957" : "#c0392b";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="292" height="20" role="img" aria-label="${label}: ${value}">
<title>${label}: ${value}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".1" stop-color="#aaa" stop-opacity=".1"/><stop offset=".9" stop-opacity=".3"/><stop offset="1" stop-opacity=".5"/></linearGradient>
<clipPath id="r"><rect width="292" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="172" height="20" fill="#555"/><rect x="172" width="120" height="20" fill="${color}"/><rect width="292" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,sans-serif" font-size="11"><text x="86" y="15">${label}</text><text x="232" y="15">${value}</text></g></svg>
`;
}

export async function writeReportBundle(
  events: readonly TraceEvent[],
  directoryInput: string,
): Promise<ReportBundle> {
  const directory = resolve(directoryInput);
  await mkdir(directory, { recursive: true });
  const metrics = calculateMetrics(events);
  const jsonPath = safeOutputPath(directory, "report.json");
  const htmlPath = safeOutputPath(directory, "report.html");
  const junitPath = safeOutputPath(directory, "junit.xml");
  const sarifPath = safeOutputPath(directory, "report.sarif");
  const manifestPath = safeOutputPath(directory, "run-manifest.json");
  const badgePath = safeOutputPath(directory, "badge.svg");
  const terminalPath = safeOutputPath(directory, "terminal.txt");
  const runId = events[0]?.runId ?? "unknown";

  const artifacts = {
    [basename(jsonPath)]: reportJson(events, metrics),
    [basename(htmlPath)]: htmlReport(events, metrics),
    [basename(junitPath)]: junit(metrics, runId),
    [basename(sarifPath)]: sarif(metrics, events),
    [basename(badgePath)]: badge(metrics),
    [basename(terminalPath)]: `${terminalReport(metrics, false)}\n`,
  };
  const manifest = `${stableStringify({
    schemaVersion: "1.0",
    product: "ResiliReplay",
    productVersion: "0.1.0",
    runId,
    startedAt: events.find((event) => event.type === "run_started")?.timestamp ?? null,
    eventCount: events.length,
    traceSha256: sha256(events.map((event) => stableStringify(event)).join("\n") + "\n"),
    metricsSha256: sha256(stableStringify(metrics)),
    artifacts: Object.fromEntries(
      Object.entries(artifacts).map(([name, content]) => [name, sha256(content)]),
    ),
    telemetry: false,
  })}\n`;

  await Promise.all([
    ...Object.entries(artifacts).map(([name, content]) =>
      writeFile(safeOutputPath(directory, name), content, "utf8"),
    ),
    writeFile(manifestPath, manifest, "utf8"),
  ]);

  return {
    directory,
    metrics,
    jsonPath,
    htmlPath,
    junitPath,
    sarifPath,
    manifestPath,
    badgePath,
    terminal: terminalReport(metrics),
  };
}
