---
module: "fliwright_record"
package: "@fliwright/mcp"
source: "src/tools/record.ts"
generated: "2026-06-02"
---

# fliwright_record

> Record user interactions on a Flutter app and generate test code.

## Input Schema

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `vmServiceUrl` | `string` | No | env | Dart VM Service WebSocket URL |
| `duration` | `number` | No | 30 | Recording duration in seconds |
| `testName` | `string` | No | "recorded test" | Test name for generated code |
| `lang` | `'ts' \| 'dart'` | No | 'ts' | Output language |

## Output Schema

```typescript
interface RecordResult {
  testCode: string;
  testName: string;
  operationCount: number;
}
```

## Behavior

1. Connects to Flutter VM Service
2. Starts recording extension
3. Waits for specified duration
4. Stops recording and generates test code
5. Returns code and operation count
