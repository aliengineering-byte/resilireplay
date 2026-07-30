import { join, resolve } from "node:path";
import { auditMcp, writeMcpCertification } from "../packages/mcp-chaos/dist/index.js";
import { writeReportBundle } from "../packages/reporters/dist/index.js";

const root = resolve(".");
const quote = (value) => `"${value.replaceAll('"', '\\"')}"`;
const serverCommand = (name) =>
  `${quote(process.execPath)} ${quote(join(root, "examples", name, "dist", "index.js"))}`;

console.log("Auditing the intentionally vulnerable toy MCP server...");
const vulnerable = await auditMcp({
  command: serverCommand("vulnerable-mcp-server"),
  timeoutMs: 5_000,
});
const vulnerableOutput = join(root, "runs", "mcp-demo", "vulnerable");
await writeMcpCertification(vulnerable, vulnerableOutput);
await writeReportBundle(vulnerable.events, vulnerableOutput);
console.log(`Expected findings: ${vulnerable.findings.length}; passed=${vulnerable.passed}`);

console.log("Auditing the resilient toy MCP server...");
const resilient = await auditMcp({
  command: serverCommand("resilient-mcp-server"),
  timeoutMs: 5_000,
});
const resilientOutput = join(root, "runs", "mcp-demo", "resilient");
await writeMcpCertification(resilient, resilientOutput);
await writeReportBundle(resilient.events, resilientOutput);
console.log(`Findings: ${resilient.findings.length}; passed=${resilient.passed}`);

if (vulnerable.passed || !resilient.passed) {
  throw new Error("MCP demo did not distinguish the vulnerable and resilient servers");
}
console.log(`MCP demo complete: ${join(root, "runs", "mcp-demo")}`);
