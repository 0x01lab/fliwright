---
module: "fliwright_record"
package: "@fliwright/mcp"
source: "src/tools/record.ts"
generated: "2026-06-01"
---

# fliwright_record

> Record user interactions on a Flutter app and generate test code.

## Input Schema

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `vmServiceUrl` | `string` | No | `FLIWRIGHT_VM_URL` env | Dart VM Service WebSocket URL |
| `duration` | `number` | No | `30` | Recording duration in seconds |
| `testName` | `string` | No | `'recorded test'` | Test name for generated code |
| `lang` | `'ts' \| 'dart'` | No | `'ts'` | Output language |

## Output: RecordResult

| Field | Type | Description |
|-------|------|-------------|
| `testCode` | `string` | Generated test code |
| `testName` | `string` | Test name used |
| `operationCount` | `number` | Number of recorded operations |

## Behavior

1. Resolves VM Service URL
2. Creates a RecorderController and connects to the Flutter app
3. Starts recording for the specified duration
4. Stops recording and generates test code
