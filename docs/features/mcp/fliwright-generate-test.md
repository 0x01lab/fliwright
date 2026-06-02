---
module: "fliwright_generate_test"
package: "@fliwright/mcp"
source: "src/tools/generateTest.ts"
generated: "2026-06-02"
---

# fliwright_generate_test

> Generate a Fliwright test script from Flutter/Dart source code.

## Input Schema

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source` | `string` | Yes | Flutter/Dart source code of the page or widget |
| `description` | `string` | No | Natural language description of what to test |
| `testName` | `string` | No | Name for the generated test |

## Output Schema

```typescript
interface GenerateTestResult {
  testCode: string;
  testName: string;
}
```

## Behavior

1. Parses Flutter source for widgets: AppBar titles, TextField/TextFormField with hints, button labels, Text widgets
2. Generates type operations for TextFields (click + type)
3. Generates click operations for buttons
4. Adds visibility assertion for last text widget
5. Returns complete test file content
