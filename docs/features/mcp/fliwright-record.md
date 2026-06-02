---
module: "fliwright_record"
package: "@fliwright/mcp"
source: "src/tools/record.ts"
generated: "2026-06-02"
---

# `fliwright_record`

> Record user interactions on a running Flutter app for a fixed duration, then return generated test code.

## Description

The tool connects a `FliwrightDriver` to the supplied VM Service URL, starts `RecorderController`, sleeps for `duration` seconds while the bridge captures pointer/text events, then stops and returns generated code. Used by AI agents to author tests by demonstration.

## Input Schema

```typescript
{
  vmServiceUrl?: string;   // optional, falls back to FLIWRIGHT_VM_URL
  duration?: number;       // optional, default 30 seconds
  testName?: string;       // optional, default "recorded test"
  lang?: 'ts' | 'dart';    // optional, default 'ts'
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `vmServiceUrl` | string | No | `process.env.FLIWRIGHT_VM_URL` | Dart VM Service WebSocket URL |
| `duration` | number | No | `30` | Recording duration in seconds |
| `testName` | string | No | `'recorded test'` | Test name in generated code |
| `lang` | `'ts' \| 'dart'` | No | `'ts'` | Output language |

## Output

```typescript
{
  testCode: string;          // generated source
  testName: string;
  operationCount: number;    // number of aggregated operations
}
```

## Errors

- Throws `Error('No VM Service URL provided...')` if neither parameter nor env var is set.
- Propagates `FliwrightDriver.connect()` failures (e.g. invalid VM URL).

## Example

```json
{
  "name": "fliwright_record",
  "arguments": {
    "vmServiceUrl": "ws://127.0.0.1:54321/abc=",
    "duration": 60,
    "lang": "ts",
    "testName": "checkout happy path"
  }
}
```
