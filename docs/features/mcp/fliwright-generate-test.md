---
module: "fliwright_generate_test"
package: "@fliwright/mcp"
source: "src/tools/generateTest.ts"
generated: "2026-06-01"
---

# fliwright_generate_test

> Generate a Fliwright test script from Flutter/Dart source code.

## Input Schema

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source` | `string` | Yes | Flutter/Dart source code of the page or widget |
| `description` | `string` | No | Natural language description of what the test should verify |
| `testName` | `string` | No | Name for the generated test |

## Output: GenerateTestResult

| Field | Type | Description |
|-------|------|-------------|
| `testCode` | `string` | Generated TypeScript test code |
| `testName` | `string` | Name used for the test |

## Behavior

1. Parses Flutter source to extract widgets (AppBar title, TextField hints, button labels, Text widgets)
2. Generates test code with `click`/`type` operations for text fields
3. Generates `click` operations for buttons
4. Adds `toBeVisible` assertion for the last text widget
