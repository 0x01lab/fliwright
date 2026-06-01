---
module: "test_report"
package: "@fliwright/mcp"
source: "src/resources/testReport.ts"
generated: "2026-06-01"
---

# test_report

> MCP resource providing results from the most recent test run.

## Resource URI

`fliwright://test-report/latest`

## MIME Type

`application/json`

## Data Format

Returns `RunResult | { message: 'No test run yet' }`

### RunResult

| Field | Type | Description |
|-------|------|-------------|
| `passed` | `boolean` | Whether all tests passed |
| `totalTests` | `number` | Total test count |
| `passedTests` | `number` | Passed count |
| `failedTests` | `number` | Failed count |
| `duration` | `number` | Duration in ms |
| `results` | `{ name, passed, duration, error? }[]` | Per-test results |
