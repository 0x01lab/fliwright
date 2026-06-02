---
module: "test_report"
package: "@fliwright/mcp"
source: "src/resources/testReport.ts"
generated: "2026-06-02"
---

# test_report

> MCP resource providing results from the most recent test run.

## Resource URI

`fliwright://test-report/latest`

## Format

`application/json` — Same structure as `RunResult` from `fliwright_run`.

## Behavior

Returns `{ message: "No test run yet" }` if no test has been run. Otherwise returns the full `RunResult` object from the last `fliwright_run` call.
