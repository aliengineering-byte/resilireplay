# Report schema 1.0

`report.json` has these stable top-level fields:

| Field           | Type    | Meaning                                                     |
| --------------- | ------- | ----------------------------------------------------------- |
| `schemaVersion` | `"1.0"` | Report contract version                                     |
| `product`       | object  | ResiliReplay name and version                               |
| `runId`         | string  | Stable source run                                           |
| `metrics`       | object  | Deterministic score, checks, values, and explanations       |
| `eventCount`    | integer | Events scored                                               |
| `faults`        | array   | Applied fault, sequence, scenario, and recovery observation |

The metrics object includes task completion, recovery success, time/steps to recovery, retry count/budget/compliance, loop detection, duplicate side effects, graceful termination, fallback correctness, schema compliance, safety compliance, canary leakage, optional token input/output/waste, injected latency, first critical step, deterministic score, pass/fail, and human-readable reasons.

`run-manifest.json` contains SHA-256 hashes for the canonical trace, metrics, and every generated report artifact. It uses the source `run_started` timestamp instead of wall-clock report time, which makes repeated report generation reproducible.

`report.sarif` is SARIF 2.1.0. A failing reason becomes one result and points at the first critical JSONL line when known. `junit.xml` emits one testcase per run. `report.html` is standalone and has no remote assets or scripts.

MCP certification uses a separate `mcp-certification.json` with target, transport, captured tool schemas, controlled mutation, findings, events, and the explicit statement that certification evidence applies only to the declared suite and version.
